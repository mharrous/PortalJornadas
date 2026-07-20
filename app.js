(function () {
  "use strict";

  const STORAGE_KEY = "portal-jornadas-data-v1";
  const AUTH_KEY = "portal-jornadas-auth-v1";
  const SESSION_KEY = "portal-jornadas-session-v1";
  const INVOICE_DB_NAME = "portal-jornadas-files-v1";
  const INVOICE_STORE_NAME = "invoices";
  const MAX_INVOICE_SIZE = 20 * 1024 * 1024;
  const viewTitles = {
    dashboard: "Resumen anual",
    events: "Gestión de jornadas",
    budget: "Control presupuestario",
    contacts: "Agenda de contactos",
    data: "Datos y copias de seguridad",
  };
  const themes = [
    { id: "camara", name: "Cámara", description: "Rojo y amarillo", colors: ["#9c2030", "#d7aa31", "#fbf8f2"] },
    { id: "oceano", name: "Océano", description: "Azul y celeste", colors: ["#17517a", "#4aa3c7", "#f4f9fb"] },
    { id: "bosque", name: "Bosque", description: "Verde y arena", colors: ["#276653", "#d5aa55", "#f6f7ef"] },
    { id: "violeta", name: "Violeta", description: "Morado y lavanda", colors: ["#63408a", "#c07ccf", "#faf6fc"] },
    { id: "grafito", name: "Grafito", description: "Gris y ámbar", colors: ["#37404a", "#d39b3b", "#f7f6f2"] },
  ];

  const appView = document.querySelector("#appView");
  const viewTitle = document.querySelector("#viewTitle");
  const modalBackdrop = document.querySelector("#modalBackdrop");
  const modalBody = document.querySelector("#modalBody");
  const modalTitle = document.querySelector("#modalTitle");
  const modalEyebrow = document.querySelector("#modalEyebrow");
  const toast = document.querySelector("#toast");
  const authGate = document.querySelector("#authGate");
  const authContent = document.querySelector("#authContent");
  const appShell = document.querySelector("#appShell");
  let currentView = "dashboard";
  let eventFilter = { search: "", period: "Todos", status: "Todos" };
  let contactSearch = "";
  let modalDraft = null;
  let modalPendingFiles = new Map();
  let modalRemovedInvoiceIds = new Set();

  const uid = () =>
    globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : clone(window.OAP_SEED);
    } catch (error) {
      console.warn("No se pudo recuperar el estado guardado", error);
      return clone(window.OAP_SEED);
    }
  }

  let state = normalizeState(loadState());

  function normalizeState(value) {
    value.settings ||= {};
    value.settings.theme ||= "camara";
    value.events = (value.events || []).map((item) => {
      const venueExpense = (item.expenses || []).find((expense) =>
        String(expense.description || "").toLowerCase().includes("alquiler de espacio"),
      );
      return {
        ...item,
        location: item.location || (item.format === "Webinar" ? "Online" : venueExpense?.provider || ""),
        period: item.period || periodForDate(item.date),
        invoices: item.invoices || [],
      };
    });
    return value;
  }

  function openInvoiceDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(INVOICE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(INVOICE_STORE_NAME)) {
          const store = database.createObjectStore(INVOICE_STORE_NAME, { keyPath: "id" });
          store.createIndex("eventId", "eventId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runInvoiceTransaction(mode, action) {
    const database = await openInvoiceDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(INVOICE_STORE_NAME, mode);
      const store = transaction.objectStore(INVOICE_STORE_NAME);
      action(store, resolve, reject);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => database.close();
    });
  }

  function storeInvoiceFile(eventId, metadata, file) {
    return runInvoiceTransaction("readwrite", (store, resolve, reject) => {
      const request = store.put({ ...metadata, eventId, blob: file });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function getInvoiceFile(id) {
    return runInvoiceTransaction("readonly", (store, resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function deleteInvoiceFile(id) {
    return runInvoiceTransaction("readwrite", (store, resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function clearInvoiceFiles() {
    return runInvoiceTransaction("readwrite", (store, resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function saveState(message = "Cambios guardados") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showToast(message);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function currency(value) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return "Sin fecha";
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
  }

  function quarterForDate(date) {
    if (!date) return "quarter-none";
    const month = Number(date.slice(5, 7));
    if (month <= 3) return "quarter-q1";
    if (month <= 6) return "quarter-q2";
    if (month <= 9) return "quarter-q3";
    return "quarter-q4";
  }

  function quarterLabel(date) {
    const quarter = quarterForDate(date);
    return {
      "quarter-q1": "1.er trimestre",
      "quarter-q2": "2.º trimestre",
      "quarter-q3": "3.er trimestre",
      "quarter-q4": "4.º trimestre",
      "quarter-none": "Sin trimestre",
    }[quarter];
  }

  function eventSpent(item) {
    return item.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  }

  function eventRemaining(item) {
    return Number(item.budget || 0) - eventSpent(item);
  }

  function checklistProgress(item) {
    if (!item.checklist.length) return 0;
    const complete = item.checklist.filter((task) => task.status === "done").length;
    return Math.round((complete / item.checklist.length) * 100);
  }

  function eventStatus(item) {
    const today = new Date();
    const eventDate = item.date ? new Date(`${item.date}T23:59:59`) : null;
    if (checklistProgress(item) === 100) return "Completada";
    if (eventDate && eventDate < today) return "Seguimiento";
    return "Planificada";
  }

  function periodForDate(date) {
    if (!date) return "Sin periodo";
    const month = Number(date.slice(5, 7));
    if (month <= 3) return "Enero - marzo";
    if (month <= 6) return "Abril - junio";
    if (month <= 9) return "Julio - septiembre";
    return "Octubre - diciembre";
  }

  function statusClass(status) {
    return status === "Completada" ? "success" : status === "Seguimiento" ? "warning" : "info";
  }

  function render() {
    viewTitle.textContent = viewTitles[currentView];
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === currentView);
    });

    const renderers = {
      dashboard: renderDashboard,
      events: renderEvents,
      budget: renderBudget,
      contacts: renderContacts,
      data: renderData,
    };
    appView.innerHTML = renderers[currentView]();
    bindViewEvents();
  }

  function renderDashboard() {
    const totalSpent = state.events.reduce((sum, item) => sum + eventSpent(item), 0);
    const totalPlanned = state.events.reduce((sum, item) => sum + Number(item.budget || 0), 0);
    const remaining = state.settings.annualBudget - totalSpent;
    const completeEvents = state.events.filter((item) => eventStatus(item) === "Completada").length;
    const pendingTasks = state.events.reduce(
      (sum, item) => sum + item.checklist.filter((task) => task.status !== "done").length,
      0,
    );
    const periods = ["Enero - marzo", "Abril - junio", "Julio - septiembre", "Octubre - diciembre"];
    const upcoming = [...state.events]
      .filter((item) => item.date && new Date(`${item.date}T23:59:59`) >= new Date())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    const overspent = state.events
      .filter((item) => eventRemaining(item) < 0)
      .sort((a, b) => eventRemaining(a) - eventRemaining(b));

    return `
      <div class="hero-panel">
        <div>
          <p class="eyebrow">Plan anual de sensibilización</p>
          <h2>Controla jornadas, gastos y tareas en un solo lugar</h2>
          <p>La información se guarda en este navegador y funciona de forma independiente al Excel original.</p>
        </div>
        <div class="hero-budget">
          <span>Presupuesto anual</span>
          <strong>${currency(state.settings.annualBudget)}</strong>
          <small>${Math.max(0, Math.round((totalSpent / state.settings.annualBudget) * 100))}% ejecutado</small>
        </div>
      </div>

      <div class="metric-grid">
        ${metricCard("Ejecutado", currency(totalSpent), `${currency(remaining)} disponibles`, "navy")}
        ${metricCard("Jornadas", state.events.length, `${completeEvents} completadas`, "green")}
        ${metricCard("Planificado", currency(totalPlanned), "Suma de presupuestos máximos", "gold")}
        ${metricCard("Tareas pendientes", pendingTasks, "En todas las jornadas", "coral")}
      </div>

      <div class="dashboard-grid">
        <section class="panel wide-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Ejecución</p><h3>Seguimiento por periodos</h3></div>
            <button class="text-button" data-go="budget">Ver presupuesto →</button>
          </div>
          <div class="period-list">
            ${periods
              .map((period) => {
                const events = state.events.filter((item) => (item.period || periodForDate(item.date)) === period);
                const spent = events.reduce((sum, item) => sum + eventSpent(item), 0);
                const planned = events.reduce((sum, item) => sum + Number(item.budget || 0), 0);
                const percent = planned ? Math.min(100, Math.round((spent / planned) * 100)) : 0;
                return `
                  <div class="period-row">
                    <div><strong>${period}</strong><span>${events.length} jornadas</span></div>
                    <div class="progress-wrap"><div class="progress-bar"><span style="width:${percent}%"></span></div><small>${percent}%</small></div>
                    <strong>${currency(spent)}</strong>
                  </div>`;
              })
              .join("")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-heading"><div><p class="eyebrow">Agenda</p><h3>Próximas jornadas</h3></div></div>
          <div class="compact-list">
            ${upcoming.length ? upcoming.map(upcomingItem).join("") : emptyState("No hay próximas jornadas")}
          </div>
        </section>

        <section class="panel wide-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Control</p><h3>Alertas presupuestarias</h3></div>
            <span class="count-pill">${overspent.length}</span>
          </div>
          <div class="alert-list">
            ${overspent.length
              ? overspent
                  .map(
                    (item) => `
                    <button class="alert-row" data-open-event="${item.id}">
                      <span class="alert-icon">!</span>
                      <span><strong>${escapeHtml(item.title)}</strong><small>Supera el presupuesto máximo en ${currency(Math.abs(eventRemaining(item)))}</small></span>
                      <span>Revisar →</span>
                    </button>`,
                  )
                  .join("")
              : emptyState("No hay desviaciones presupuestarias")}
          </div>
        </section>
      </div>`;
  }

  function metricCard(label, value, caption, accent) {
    return `<article class="metric-card ${accent}"><span>${label}</span><strong>${value}</strong><small>${caption}</small></article>`;
  }

  function upcomingItem(item) {
    return `
      <button class="compact-row ${quarterForDate(item.date)}" data-open-event="${item.id}">
        <span class="date-tile"><b>${new Date(`${item.date}T12:00:00`).getDate()}</b><small>${new Intl.DateTimeFormat("es-ES", { month: "short" }).format(new Date(`${item.date}T12:00:00`))}</small></span>
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.format)} · ${escapeHtml(item.speaker || "Sin ponente")}</small></span>
      </button>`;
  }

  function emptyState(message) {
    return `<div class="empty-state"><span>○</span><p>${message}</p></div>`;
  }

  function renderEvents() {
    const filtered = state.events.filter((item) => {
      const haystack = `${item.title} ${item.theme} ${item.speaker} ${item.format} ${item.location || ""}`.toLowerCase();
      const matchesSearch = haystack.includes(eventFilter.search.toLowerCase());
      const period = item.period || periodForDate(item.date);
      const matchesPeriod = eventFilter.period === "Todos" || eventFilter.period === period;
      const matchesStatus = eventFilter.status === "Todos" || eventFilter.status === eventStatus(item);
      return matchesSearch && matchesPeriod && matchesStatus;
    });

    return `
      <div class="toolbar-panel">
        <label class="search-field"><span>⌕</span><input id="eventSearch" type="search" placeholder="Buscar por título, temática o ponente" value="${escapeHtml(eventFilter.search)}" /></label>
        <select id="periodFilter" aria-label="Filtrar por periodo">
          ${["Todos", "Enero - marzo", "Abril - junio", "Julio - septiembre", "Octubre - diciembre"].map((value) => `<option ${eventFilter.period === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
        <select id="statusFilter" aria-label="Filtrar por estado">
          ${["Todos", "Planificada", "Seguimiento", "Completada"].map((value) => `<option ${eventFilter.status === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
        <button class="primary-button" data-new-event>+ Nueva jornada</button>
      </div>

      <section class="panel table-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">Propuesta anual</p><h3>${filtered.length} jornadas</h3></div>
          <span class="muted">Haz clic en una jornada para editarla</span>
        </div>
        <div class="responsive-table">
          <table>
            <thead><tr><th>Fecha</th><th>Jornada</th><th>Formato</th><th>Ubicación</th><th>Ponente</th><th>Presupuesto</th><th>Ejecutado</th><th>Estado</th></tr></thead>
            <tbody>
              ${filtered
                .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
                .map(
                  (item) => `
                    <tr class="event-row ${quarterForDate(item.date)}" data-open-event="${item.id}" tabindex="0">
                      <td><strong>${formatDate(item.date)}</strong><small>${quarterLabel(item.date)} · ${escapeHtml(item.period || periodForDate(item.date))}</small></td>
                      <td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.theme)}${item.invoices?.length ? ` · 📎 ${item.invoices.length} factura${item.invoices.length === 1 ? "" : "s"}` : ""}</small></td>
                      <td><span class="tag">${escapeHtml(item.format)}</span></td>
                      <td>${escapeHtml(item.location || "Por definir")}</td>
                      <td>${escapeHtml(item.speaker || "—")}</td>
                      <td>${currency(item.budget)}</td>
                      <td class="${eventRemaining(item) < 0 ? "negative" : ""}">${currency(eventSpent(item))}</td>
                      <td><span class="status-badge ${statusClass(eventStatus(item))}">${eventStatus(item)}</span></td>
                    </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderBudget() {
    const executed = state.events.reduce((sum, item) => sum + eventSpent(item), 0);
    const available = state.settings.annualBudget - executed;
    const periodGroups = ["Enero - marzo", "Abril - diciembre"];

    return `
      <div class="metric-grid budget-metrics">
        ${metricCard("Presupuesto anual", currency(state.settings.annualBudget), "Techo global configurado", "navy")}
        ${metricCard("Ejecutado", currency(executed), `${Math.round((executed / state.settings.annualBudget) * 100)}% del presupuesto anual`, "green")}
        ${metricCard("Disponible", currency(available), available >= 0 ? "Saldo positivo" : "Presupuesto superado", available >= 0 ? "gold" : "coral")}
      </div>

      <div class="budget-layout">
        ${periodGroups
          .map((period) => {
            const lines = state.budgetLines.filter((line) => line.period === period);
            return `
              <section class="panel">
                <div class="panel-heading"><div><p class="eyebrow">2026</p><h3>${period}</h3></div></div>
                <div class="budget-lines">
                  ${lines.map(budgetLine).join("")}
                </div>
              </section>`;
          })
          .join("")}
      </div>

      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Por jornada</p><h3>Presupuesto máximo frente a ejecución</h3></div></div>
        <div class="budget-event-list">
          ${state.events
            .map((item) => {
              const spent = eventSpent(item);
              const percent = item.budget ? Math.min(100, Math.round((spent / item.budget) * 100)) : 0;
              return `<button data-open-event="${item.id}" class="budget-event-row">
                <span><strong>${escapeHtml(item.title)}</strong><small>${currency(spent)} de ${currency(item.budget)}</small></span>
                <span class="progress-bar ${spent > item.budget ? "over" : ""}"><i style="width:${percent}%"></i></span>
                <strong class="${eventRemaining(item) < 0 ? "negative" : "positive"}">${currency(eventRemaining(item))}</strong>
              </button>`;
            })
            .join("")}
        </div>
      </section>`;
  }

  function budgetLine(line) {
    const relevantEvents = state.events.filter((item) => {
      if (line.category !== "Acciones de sensibilización") return false;
      return line.period === "Enero - marzo"
        ? (item.period || periodForDate(item.date)) === "Enero - marzo"
        : (item.period || periodForDate(item.date)) !== "Enero - marzo";
    });
    const spent = relevantEvents.reduce((sum, item) => sum + eventSpent(item), 0);
    const remaining = line.allocated - spent;
    return `
      <button class="budget-line" data-edit-budget="${line.id}">
        <span><strong>${escapeHtml(line.category)}</strong><small>${line.unavailable ? "No disponible" : "Haz clic para editar"}</small></span>
        <span><small>Asignado</small><b>${line.unavailable ? "—" : currency(line.allocated)}</b></span>
        <span><small>Ejecutado</small><b>${line.category === "Acciones de sensibilización" ? currency(spent) : "—"}</b></span>
        <span><small>Saldo</small><b class="${remaining < 0 ? "negative" : "positive"}">${line.category === "Acciones de sensibilización" && !line.unavailable ? currency(remaining) : "—"}</b></span>
      </button>`;
  }

  function renderContacts() {
    const filtered = state.contacts.filter((contact) =>
      `${contact.firstName} ${contact.lastName} ${contact.organization} ${contact.role}`
        .toLowerCase()
        .includes(contactSearch.toLowerCase()),
    );
    return `
      <div class="toolbar-panel">
        <label class="search-field"><span>⌕</span><input id="contactSearch" type="search" placeholder="Buscar contacto o entidad" value="${escapeHtml(contactSearch)}" /></label>
        <button class="secondary-button" id="togglePrivacy">${state.settings.privacyMode ? "Mostrar datos de contacto" : "Ocultar datos sensibles"}</button>
        <button class="primary-button" data-new-contact>+ Nuevo contacto</button>
      </div>
      <div class="privacy-banner ${state.settings.privacyMode ? "" : "revealed"}">
        <span>${state.settings.privacyMode ? "◉" : "◎"}</span>
        <div><strong>${state.settings.privacyMode ? "Vista privada activa" : "Datos de contacto visibles"}</strong><p>Teléfonos y correos ${state.settings.privacyMode ? "permanecen ocultos por defecto" : "se muestran en esta sesión"}.</p></div>
      </div>
      <section class="panel table-panel">
        <div class="responsive-table">
          <table>
            <thead><tr><th>Nombre</th><th>Entidad</th><th>Cargo</th><th>Email</th><th>Teléfono</th><th>Próxima acción</th></tr></thead>
            <tbody>
              ${filtered
                .map(
                  (contact) => `<tr data-open-contact="${contact.id}" tabindex="0">
                    <td><strong>${escapeHtml(contact.firstName)} ${escapeHtml(contact.lastName)}</strong></td>
                    <td>${escapeHtml(contact.organization || "—")}</td>
                    <td>${escapeHtml(contact.role || "—")}</td>
                    <td>${state.settings.privacyMode ? maskEmail(contact.email) : escapeHtml(contact.email || "—")}</td>
                    <td>${state.settings.privacyMode ? maskPhone(contact.phone) : escapeHtml(contact.phone || "—")}</td>
                    <td>${escapeHtml(contact.nextAction || "Sin acción")}</td>
                  </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function maskPhone(phone) {
    if (!phone) return "—";
    return `${String(phone).slice(0, 3)} ··· ·${String(phone).slice(-2)}`;
  }

  function maskEmail(email) {
    if (!email) return "—";
    const [name, domain] = email.split("@");
    return `${name.slice(0, 2)}···@${domain}`;
  }

  function renderData() {
    const storedKb = Math.round(new Blob([JSON.stringify(state)]).size / 1024);
    const invoiceCount = state.events.reduce((sum, item) => sum + (item.invoices || []).length, 0);
    return `
      <div class="data-grid">
        <section class="panel data-card">
          <span class="data-icon">↓</span>
          <h3>Descargar copia completa</h3>
          <p>Exporta jornadas, gastos, checklist, presupuesto y contactos. Los PDF se descargan individualmente desde cada jornada.</p>
          <button class="primary-button" id="exportJson">Descargar JSON</button>
        </section>
        <section class="panel data-card">
          <span class="data-icon">≡</span>
          <h3>Exportar jornadas a CSV</h3>
          <p>Genera un listado compatible con Excel. Los contactos no se incluyen en esta exportación.</p>
          <button class="secondary-button" id="exportCsv">Descargar CSV</button>
        </section>
        <section class="panel data-card">
          <span class="data-icon">↑</span>
          <h3>Restaurar una copia</h3>
          <p>Carga un JSON generado por esta aplicación. Sustituirá los datos guardados en este navegador.</p>
          <label class="secondary-button file-button">Seleccionar JSON<input id="importJson" type="file" accept="application/json,.json" /></label>
        </section>
        <section class="panel data-card danger-card">
          <span class="data-icon">↺</span>
          <h3>Restablecer datos iniciales</h3>
          <p>Elimina los cambios locales y recupera la copia inicial importada del Excel.</p>
          <button class="danger-button" id="resetData">Restablecer</button>
        </section>
      </div>
      <section class="panel storage-panel">
        <div><p class="eyebrow">Almacenamiento</p><h3>Estado de la aplicación</h3></div>
        <dl><div><dt>Jornadas</dt><dd>${state.events.length}</dd></div><div><dt>Facturas PDF</dt><dd>${invoiceCount}</dd></div><div><dt>Contactos</dt><dd>${state.contacts.length}</dd></div><div><dt>Datos estructurados</dt><dd>${storedKb} KB</dd></div><div><dt>Ubicación</dt><dd>Navegador local</dd></div></dl>
      </section>`;
  }

  function bindViewEvents() {
    appView.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
    appView.querySelectorAll("[data-open-event]").forEach((element) => {
      element.addEventListener("click", () => openEventModal(element.dataset.openEvent));
      element.addEventListener("keydown", (event) => event.key === "Enter" && openEventModal(element.dataset.openEvent));
    });
    appView.querySelectorAll("[data-new-event]").forEach((button) => button.addEventListener("click", () => openEventModal()));
    appView.querySelectorAll("[data-open-contact]").forEach((element) => {
      element.addEventListener("click", () => openContactModal(element.dataset.openContact));
      element.addEventListener("keydown", (event) => event.key === "Enter" && openContactModal(element.dataset.openContact));
    });
    appView.querySelectorAll("[data-new-contact]").forEach((button) => button.addEventListener("click", () => openContactModal()));
    appView.querySelectorAll("[data-edit-budget]").forEach((button) => button.addEventListener("click", () => openBudgetModal(button.dataset.editBudget)));

    document.querySelector("#eventSearch")?.addEventListener("input", (event) => {
      eventFilter.search = event.target.value;
      render();
      document.querySelector("#eventSearch")?.focus();
    });
    document.querySelector("#periodFilter")?.addEventListener("change", (event) => {
      eventFilter.period = event.target.value;
      render();
    });
    document.querySelector("#statusFilter")?.addEventListener("change", (event) => {
      eventFilter.status = event.target.value;
      render();
    });
    document.querySelector("#contactSearch")?.addEventListener("input", (event) => {
      contactSearch = event.target.value;
      render();
      document.querySelector("#contactSearch")?.focus();
    });
    document.querySelector("#togglePrivacy")?.addEventListener("click", () => {
      state.settings.privacyMode = !state.settings.privacyMode;
      saveState(state.settings.privacyMode ? "Vista privada activada" : "Datos de contacto visibles");
      render();
    });
    document.querySelector("#exportJson")?.addEventListener("click", exportJson);
    document.querySelector("#exportCsv")?.addEventListener("click", exportCsv);
    document.querySelector("#importJson")?.addEventListener("change", importJson);
    document.querySelector("#resetData")?.addEventListener("click", resetData);
  }

  function navigate(view) {
    currentView = view;
    document.querySelector("#sidebar").classList.remove("open");
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModal(title, eyebrow, content) {
    modalTitle.textContent = title;
    modalEyebrow.textContent = eyebrow;
    modalBody.innerHTML = content;
    modalBackdrop.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    document.body.classList.remove("modal-open");
    modalDraft = null;
    modalPendingFiles = new Map();
    modalRemovedInvoiceIds = new Set();
  }

  function openEventModal(id) {
    const existing = id ? state.events.find((item) => item.id === id) : null;
    modalPendingFiles = new Map();
    modalRemovedInvoiceIds = new Set();
    modalDraft = existing
      ? clone(existing)
      : {
          id: uid(),
          date: "",
          format: "Desayuno",
          theme: "",
          title: "",
          speaker: "",
          location: "",
          time: "",
          budget: 1350,
          period: "",
          expenses: [],
          invoices: [],
          checklist: window.OAP_CHECKLIST.map((name) => ({ id: uid(), name, status: "pending" })),
          notes: "",
        };
    renderEventModal(Boolean(existing));
  }

  function renderEventModal(isExisting) {
    const spent = eventSpent(modalDraft);
    const remaining = Number(modalDraft.budget || 0) - spent;
    openModal(
      isExisting ? "Editar jornada" : "Nueva jornada",
      "Ficha de jornada",
      `<form id="eventForm" class="form-stack">
        <div class="form-grid">
          ${inputField("Fecha", "date", "date", modalDraft.date, true)}
          ${selectField("Formato", "format", ["Desayuno", "Webinar", "Jornada", "Taller", "Otro"], modalDraft.format)}
          ${inputField("Horario", "time", "text", modalDraft.time, false, "09:00–11:00")}
          ${inputField("Presupuesto máximo", "budget", "number", modalDraft.budget, true, "0.00", "0.01")}
          <label class="field span-2"><span>Título</span><input name="title" required value="${escapeHtml(modalDraft.title)}" /></label>
          ${inputField("Temática", "theme", "text", modalDraft.theme)}
          ${inputField("Ponente", "speaker", "text", modalDraft.speaker)}
          ${inputField("Ubicación", "location", "text", modalDraft.location || "", false, "Escribe una ubicación o enlace")}
          ${selectField("Periodo", "period", ["", "Enero - marzo", "Abril - junio", "Julio - septiembre", "Octubre - diciembre"], modalDraft.period)}
          <div class="quarter-preview ${quarterForDate(modalDraft.date)}" id="quarterPreview"><span>Trimestre automático</span><strong>${quarterLabel(modalDraft.date)}</strong></div>
          <label class="field span-2"><span>Notas internas</span><textarea name="notes" rows="3">${escapeHtml(modalDraft.notes)}</textarea></label>
        </div>

        <div class="summary-strip">
          <div><span>Presupuesto</span><strong>${currency(modalDraft.budget)}</strong></div>
          <div><span>Ejecutado</span><strong>${currency(spent)}</strong></div>
          <div><span>Disponible</span><strong class="${remaining < 0 ? "negative" : "positive"}">${currency(remaining)}</strong></div>
        </div>

        <section class="form-section">
          <div class="section-heading"><div><p class="eyebrow">Gastos</p><h3>Detalle de ejecución</h3></div><button type="button" class="secondary-button" id="addExpense">+ Añadir gasto</button></div>
          <div class="expense-editor">
            ${modalDraft.expenses.length ? modalDraft.expenses.map(expenseEditorRow).join("") : emptyState("No hay gastos registrados")}
          </div>
        </section>

        <section class="form-section invoice-section">
          <div class="section-heading"><div><p class="eyebrow">Documentación</p><h3>Facturas PDF</h3></div><span class="count-pill">${modalDraft.invoices.length}</span></div>
          <div class="invoice-dropzone" id="invoiceDropzone" tabindex="0" role="button" aria-label="Adjuntar facturas PDF">
            <span class="invoice-drop-icon">PDF</span>
            <div><strong>Arrastra aquí las facturas</strong><small>Solo PDF · máximo 20 MB por archivo</small></div>
            <button type="button" class="secondary-button" id="selectInvoices">Seleccionar archivos</button>
            <input id="invoiceInput" type="file" accept="application/pdf,.pdf" multiple hidden />
          </div>
          <div class="invoice-list">
            ${modalDraft.invoices.length ? modalDraft.invoices.map(invoiceEditorRow).join("") : emptyState("No hay facturas adjuntas a esta jornada")}
          </div>
        </section>

        <section class="form-section">
          <div class="section-heading"><div><p class="eyebrow">Preparación</p><h3>Checklist del evento</h3></div><span class="count-pill">${checklistProgress(modalDraft)}%</span></div>
          <div class="checklist-grid">
            ${modalDraft.checklist.map(checklistEditorRow).join("")}
          </div>
        </section>

        <footer class="modal-actions">
          ${isExisting ? '<button type="button" class="danger-link" id="deleteEvent">Eliminar jornada</button>' : "<span></span>"}
          <div><button type="button" class="secondary-button" id="cancelModal">Cancelar</button><button type="submit" class="primary-button">Guardar jornada</button></div>
        </footer>
      </form>`,
    );
    bindEventModal(isExisting);
  }

  function inputField(label, name, type, value, required = false, placeholder = "", step = "") {
    return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${required ? "required" : ""} ${placeholder ? `placeholder="${placeholder}"` : ""} ${step ? `step="${step}"` : ""} /></label>`;
  }

  function selectField(label, name, options, value) {
    return `<label class="field"><span>${label}</span><select name="${name}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${option || "Automático según fecha"}</option>`).join("")}</select></label>`;
  }

  function expenseEditorRow(expense, index) {
    return `<div class="expense-edit-row" data-expense-row="${index}">
      <input data-field="description" value="${escapeHtml(expense.description)}" placeholder="Descripción" />
      <input data-field="provider" value="${escapeHtml(expense.provider)}" placeholder="Proveedor" />
      <input data-field="amount" value="${Number(expense.amount || 0)}" type="number" min="0" step="0.01" placeholder="Importe" />
      <input data-field="notes" value="${escapeHtml(expense.notes)}" placeholder="Observaciones" />
      <button type="button" class="icon-button remove-expense" data-remove-expense="${index}" aria-label="Eliminar gasto">×</button>
    </div>`;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function invoiceEditorRow(invoice) {
    const uploaded = invoice.uploadedAt ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(invoice.uploadedAt)) : "Ahora";
    return `<article class="invoice-row">
      <span class="invoice-file-icon">PDF</span>
      <span class="invoice-file-info"><strong>${escapeHtml(invoice.name)}</strong><small>${formatFileSize(invoice.size)} · ${uploaded}${modalPendingFiles.has(invoice.id) ? " · Pendiente de guardar" : ""}</small></span>
      <span class="invoice-actions">
        <button type="button" class="text-button" data-view-invoice="${invoice.id}">Abrir ↗</button>
        <button type="button" class="text-button" data-download-invoice="${invoice.id}">Descargar</button>
        <button type="button" class="icon-button remove-invoice" data-remove-invoice="${invoice.id}" aria-label="Eliminar factura">×</button>
      </span>
    </article>`;
  }

  function checklistEditorRow(task, index) {
    return `<label class="check-item"><span>${escapeHtml(task.name)}</span><select data-task-status="${index}"><option value="pending" ${task.status === "pending" ? "selected" : ""}>Pendiente</option><option value="progress" ${task.status === "progress" ? "selected" : ""}>En curso</option><option value="done" ${task.status === "done" ? "selected" : ""}>OK</option></select></label>`;
  }

  function addInvoiceFiles(files, isExisting) {
    syncEventDraftFromForm();
    const existingKeys = new Set(modalDraft.invoices.map((invoice) => `${invoice.name}-${invoice.size}`));
    let added = 0;
    let rejected = 0;

    [...files].forEach((file) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const duplicateKey = `${file.name}-${file.size}`;
      if (!isPdf || file.size > MAX_INVOICE_SIZE || existingKeys.has(duplicateKey)) {
        rejected += 1;
        return;
      }
      const metadata = {
        id: uid(),
        name: file.name,
        type: "application/pdf",
        size: file.size,
        uploadedAt: new Date().toISOString(),
      };
      modalDraft.invoices.push(metadata);
      modalPendingFiles.set(metadata.id, file);
      existingKeys.add(duplicateKey);
      added += 1;
    });

    if (added) showToast(`${added} factura${added === 1 ? "" : "s"} preparada${added === 1 ? "" : "s"}`);
    if (rejected) showToast(`${rejected} archivo${rejected === 1 ? "" : "s"} rechazado${rejected === 1 ? "" : "s"}`);
    renderEventModal(isExisting);
  }

  async function resolveInvoiceRecord(id) {
    if (modalPendingFiles.has(id)) {
      const metadata = modalDraft.invoices.find((invoice) => invoice.id === id);
      return { ...metadata, blob: modalPendingFiles.get(id) };
    }
    return getInvoiceFile(id);
  }

  function viewInvoice(id) {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      showToast("El navegador bloqueó la pestaña de visualización");
      return;
    }
    previewWindow.opener = null;
    previewWindow.document.write("<title>Cargando factura…</title><p style='font-family:system-ui;padding:24px'>Cargando factura PDF…</p>");
    resolveInvoiceRecord(id)
      .then((record) => {
        if (!record?.blob) throw new Error("Archivo no encontrado");
        const url = URL.createObjectURL(record.blob);
        previewWindow.location.replace(url);
        window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      })
      .catch(() => {
        previewWindow.close();
        showToast("No se encontró el PDF guardado");
      });
  }

  async function downloadInvoice(id) {
    try {
      const record = await resolveInvoiceRecord(id);
      if (!record?.blob) throw new Error("Archivo no encontrado");
      const url = URL.createObjectURL(record.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = record.name || "factura.pdf";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast("Factura descargada");
    } catch (error) {
      showToast("No se pudo descargar la factura");
    }
  }

  async function persistInvoiceChanges(eventId) {
    for (const [id, file] of modalPendingFiles) {
      const metadata = modalDraft.invoices.find((invoice) => invoice.id === id);
      if (metadata) await storeInvoiceFile(eventId, metadata, file);
    }
    for (const id of modalRemovedInvoiceIds) await deleteInvoiceFile(id);
    modalPendingFiles = new Map();
    modalRemovedInvoiceIds = new Set();
  }

  function syncEventDraftFromForm() {
    const form = document.querySelector("#eventForm");
    if (!form) return;
    const formData = new FormData(form);
    ["date", "format", "time", "title", "theme", "speaker", "location", "period", "notes"].forEach((key) => {
      modalDraft[key] = String(formData.get(key) || "");
    });
    modalDraft.budget = Number(formData.get("budget") || 0);
    form.querySelectorAll("[data-expense-row]").forEach((row) => {
      const index = Number(row.dataset.expenseRow);
      modalDraft.expenses[index] = {
        ...modalDraft.expenses[index],
        description: row.querySelector('[data-field="description"]').value,
        provider: row.querySelector('[data-field="provider"]').value,
        amount: Number(row.querySelector('[data-field="amount"]').value || 0),
        notes: row.querySelector('[data-field="notes"]').value,
      };
    });
    form.querySelectorAll("[data-task-status]").forEach((select) => {
      modalDraft.checklist[Number(select.dataset.taskStatus)].status = select.value;
    });
  }

  function bindEventModal(isExisting) {
    document.querySelector("#cancelModal").addEventListener("click", closeModal);
    document.querySelector('[name="date"]').addEventListener("input", (event) => {
      const preview = document.querySelector("#quarterPreview");
      preview.className = `quarter-preview ${quarterForDate(event.target.value)}`;
      preview.querySelector("strong").textContent = quarterLabel(event.target.value);
    });
    document.querySelector("#addExpense").addEventListener("click", () => {
      syncEventDraftFromForm();
      modalDraft.expenses.push({ id: uid(), description: "", provider: "", amount: 0, notes: "" });
      renderEventModal(isExisting);
    });
    document.querySelectorAll("[data-remove-expense]").forEach((button) => {
      button.addEventListener("click", () => {
        syncEventDraftFromForm();
        modalDraft.expenses.splice(Number(button.dataset.removeExpense), 1);
        renderEventModal(isExisting);
      });
    });
    const invoiceInput = document.querySelector("#invoiceInput");
    const invoiceDropzone = document.querySelector("#invoiceDropzone");
    document.querySelector("#selectInvoices").addEventListener("click", () => invoiceInput.click());
    invoiceInput.addEventListener("change", () => addInvoiceFiles(invoiceInput.files, isExisting));
    invoiceDropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") invoiceInput.click();
    });
    invoiceDropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      invoiceDropzone.classList.add("drag-active");
    });
    invoiceDropzone.addEventListener("dragleave", () => invoiceDropzone.classList.remove("drag-active"));
    invoiceDropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      invoiceDropzone.classList.remove("drag-active");
      addInvoiceFiles(event.dataTransfer.files, isExisting);
    });
    document.querySelectorAll("[data-view-invoice]").forEach((button) => button.addEventListener("click", () => viewInvoice(button.dataset.viewInvoice)));
    document.querySelectorAll("[data-download-invoice]").forEach((button) => button.addEventListener("click", () => downloadInvoice(button.dataset.downloadInvoice)));
    document.querySelectorAll("[data-remove-invoice]").forEach((button) => {
      button.addEventListener("click", () => {
        syncEventDraftFromForm();
        const id = button.dataset.removeInvoice;
        if (modalPendingFiles.has(id)) modalPendingFiles.delete(id);
        else modalRemovedInvoiceIds.add(id);
        modalDraft.invoices = modalDraft.invoices.filter((invoice) => invoice.id !== id);
        renderEventModal(isExisting);
      });
    });
    document.querySelector("#eventForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      syncEventDraftFromForm();
      modalDraft.period ||= periodForDate(modalDraft.date);
      try {
        await persistInvoiceChanges(modalDraft.id);
      } catch (error) {
        showToast("No se pudieron guardar las facturas");
        return;
      }
      const index = state.events.findIndex((item) => item.id === modalDraft.id);
      if (index >= 0) state.events[index] = clone(modalDraft);
      else state.events.push(clone(modalDraft));
      saveState(index >= 0 ? "Jornada actualizada" : "Jornada creada");
      closeModal();
      render();
    });
    document.querySelector("#deleteEvent")?.addEventListener("click", async () => {
      if (!window.confirm("¿Eliminar esta jornada de la aplicación? Esta acción no afecta al Excel original.")) return;
      const invoiceIds = [...(modalDraft.invoices || []).map((invoice) => invoice.id), ...modalRemovedInvoiceIds];
      await Promise.all(invoiceIds.map((id) => deleteInvoiceFile(id).catch(() => null)));
      state.events = state.events.filter((item) => item.id !== modalDraft.id);
      saveState("Jornada eliminada");
      closeModal();
      render();
    });
  }

  function openContactModal(id) {
    const existing = id ? state.contacts.find((item) => item.id === id) : null;
    modalDraft = existing
      ? clone(existing)
      : { id: uid(), firstName: "", lastName: "", organization: "", role: "", email: "", phone: "", nextAction: "", notes: "", relatedEvent: "" };
    openModal(
      existing ? "Editar contacto" : "Nuevo contacto",
      "Agenda",
      `<form id="contactForm" class="form-stack">
        <div class="form-grid">
          ${inputField("Nombre", "firstName", "text", modalDraft.firstName, true)}
          ${inputField("Apellidos", "lastName", "text", modalDraft.lastName)}
          ${inputField("Empresa / entidad", "organization", "text", modalDraft.organization)}
          ${inputField("Cargo", "role", "text", modalDraft.role)}
          ${inputField("Email", "email", "email", modalDraft.email)}
          ${inputField("Teléfono", "phone", "tel", modalDraft.phone)}
          ${inputField("Próxima acción", "nextAction", "text", modalDraft.nextAction)}
          ${selectField("Relacionado con jornada", "relatedEvent", ["", ...state.events.map((item) => item.id)], modalDraft.relatedEvent).replaceAll(/>jornada-(\d+)</g, ">Jornada $1<")}
          <label class="field span-2"><span>Observaciones</span><textarea name="notes" rows="4">${escapeHtml(modalDraft.notes)}</textarea></label>
        </div>
        <footer class="modal-actions">
          ${existing ? '<button type="button" class="danger-link" id="deleteContact">Eliminar contacto</button>' : "<span></span>"}
          <div><button type="button" class="secondary-button" id="cancelModal">Cancelar</button><button type="submit" class="primary-button">Guardar contacto</button></div>
        </footer>
      </form>`,
    );
    document.querySelector("#cancelModal").addEventListener("click", closeModal);
    document.querySelector("#contactForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const updated = { ...modalDraft };
      ["firstName", "lastName", "organization", "role", "email", "phone", "nextAction", "notes", "relatedEvent"].forEach((key) => {
        updated[key] = String(formData.get(key) || "");
      });
      const index = state.contacts.findIndex((item) => item.id === updated.id);
      if (index >= 0) state.contacts[index] = updated;
      else state.contacts.push(updated);
      saveState(index >= 0 ? "Contacto actualizado" : "Contacto creado");
      closeModal();
      render();
    });
    document.querySelector("#deleteContact")?.addEventListener("click", () => {
      if (!window.confirm("¿Eliminar este contacto de la aplicación?")) return;
      state.contacts = state.contacts.filter((item) => item.id !== modalDraft.id);
      saveState("Contacto eliminado");
      closeModal();
      render();
    });
  }

  function openBudgetModal(id) {
    const line = state.budgetLines.find((item) => item.id === id);
    modalDraft = clone(line);
    openModal(
      "Editar partida",
      modalDraft.period,
      `<form id="budgetForm" class="form-stack">
        <div class="form-grid">
          ${inputField("Categoría", "category", "text", modalDraft.category, true)}
          ${inputField("Importe asignado", "allocated", "number", modalDraft.allocated, true, "0.00", "0.01")}
          <label class="check-field span-2"><input type="checkbox" name="unavailable" ${modalDraft.unavailable ? "checked" : ""} /><span>Marcar como no disponible</span></label>
        </div>
        <footer class="modal-actions"><span></span><div><button type="button" class="secondary-button" id="cancelModal">Cancelar</button><button type="submit" class="primary-button">Guardar partida</button></div></footer>
      </form>`,
    );
    document.querySelector("#cancelModal").addEventListener("click", closeModal);
    document.querySelector("#budgetForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const index = state.budgetLines.findIndex((item) => item.id === modalDraft.id);
      state.budgetLines[index] = {
        ...modalDraft,
        category: String(formData.get("category")),
        allocated: Number(formData.get("allocated") || 0),
        unavailable: formData.get("unavailable") === "on",
      };
      saveState("Partida actualizada");
      closeModal();
      render();
    });
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportJson() {
    downloadFile(`oap-gestion-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), "application/json");
    showToast("Copia JSON descargada");
  }

  function exportCsv() {
    const rows = [["Fecha", "Trimestre", "Formato", "Temática", "Título", "Ubicación", "Ponente", "Presupuesto", "Ejecutado", "Disponible", "Periodo", "Progreso checklist"]];
    state.events.forEach((item) => rows.push([item.date, quarterLabel(item.date), item.format, item.theme, item.title, item.location || "", item.speaker, item.budget, eventSpent(item), eventRemaining(item), item.period || periodForDate(item.date), `${checklistProgress(item)}%`]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
    downloadFile(`jornadas-oap-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    showToast("CSV descargado");
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported.events) || !Array.isArray(imported.contacts)) throw new Error("Formato inválido");
        await clearInvoiceFiles();
        imported.events = imported.events.map((item) => ({ ...item, invoices: [] }));
        state = normalizeState(imported);
        applyTheme(state.settings.theme);
        saveState("Copia restaurada; los PDF no forman parte del JSON");
        render();
      } catch (error) {
        showToast("No se pudo importar el archivo");
      }
    };
    reader.readAsText(file);
  }

  async function resetData() {
    if (!window.confirm("¿Restablecer todos los datos locales? El Excel original no se verá afectado.")) return;
    await clearInvoiceFiles().catch(() => null);
    state = clone(window.OAP_SEED);
    state = normalizeState(state);
    applyTheme(state.settings.theme);
    saveState("Datos iniciales restaurados");
    render();
  }

  function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  async function derivePasswordHash(password, saltBase64) {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const salt = Uint8Array.from(atob(saltBase64), (character) => character.charCodeAt(0));
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 },
      passwordKey,
      256,
    );
    return bytesToBase64(new Uint8Array(bits));
  }

  function authMessage(message, type = "error") {
    const element = document.querySelector("#authMessage");
    if (!element) return;
    element.textContent = message;
    element.className = `auth-message ${type}`;
  }

  function renderAuth() {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    if (!auth) {
      authContent.innerHTML = `
        <div class="auth-intro">
          <span class="auth-kicker">Primera configuración</span>
          <h2>Crea el acceso a la aplicación</h2>
          <p>La contraseña se transforma en una clave cifrada y no se guarda ni aparece en el código.</p>
        </div>
        <form class="auth-form" id="setupForm">
          <label class="field"><span>Usuario</span><input name="username" value="Administrador OAP" autocomplete="username" required /></label>
          <label class="field"><span>Contraseña</span><input name="password" type="password" minlength="8" autocomplete="new-password" required /></label>
          <label class="field"><span>Repetir contraseña</span><input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required /></label>
          <p class="auth-message" id="authMessage"></p>
          <button class="primary-button auth-submit" type="submit">Crear acceso y entrar</button>
        </form>`;
      document.querySelector("#setupForm").addEventListener("submit", setupAccess);
      return;
    }

    authContent.innerHTML = `
      <div class="auth-intro">
        <span class="auth-kicker">Acceso restringido</span>
        <h2>Bienvenido de nuevo</h2>
        <p>Introduce la contraseña configurada para entrar en la gestión OAP.</p>
      </div>
      <form class="auth-form" id="loginForm">
        <label class="field"><span>Usuario</span><input value="${escapeHtml(auth.username)}" autocomplete="username" readonly /></label>
        <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required autofocus /></label>
        <p class="auth-message" id="authMessage"></p>
        <button class="primary-button auth-submit" type="submit">Entrar</button>
      </form>`;
    document.querySelector("#loginForm").addEventListener("submit", login);
  }

  async function setupAccess(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") || "Administrador OAP").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password.length < 8) return authMessage("Usa al menos 8 caracteres.");
    if (password !== confirmPassword) return authMessage("Las contraseñas no coinciden.");
    try {
      authMessage("Creando acceso…", "info");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltBase64 = bytesToBase64(salt);
      const hash = await derivePasswordHash(password, saltBase64);
      localStorage.setItem(AUTH_KEY, JSON.stringify({ username, salt: saltBase64, hash, createdAt: new Date().toISOString() }));
      sessionStorage.setItem(SESSION_KEY, "active");
      unlockApp();
    } catch (error) {
      authMessage("No se pudo crear el acceso en este navegador.");
    }
  }

  async function login(event) {
    event.preventDefault();
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    const password = String(new FormData(event.currentTarget).get("password") || "");
    try {
      authMessage("Comprobando…", "info");
      const hash = await derivePasswordHash(password, auth.salt);
      if (hash !== auth.hash) return authMessage("Contraseña incorrecta.");
      sessionStorage.setItem(SESSION_KEY, "active");
      unlockApp();
    } catch (error) {
      authMessage("No se pudo validar el acceso.");
    }
  }

  function unlockApp() {
    authGate.hidden = true;
    appShell.hidden = false;
    render();
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    appShell.hidden = true;
    authGate.hidden = false;
    renderAuth();
  }

  function applyTheme(themeId) {
    const validTheme = themes.some((theme) => theme.id === themeId) ? themeId : "camara";
    document.documentElement.dataset.theme = validTheme;
  }

  function openThemeModal() {
    const selectedTheme = state.settings.theme || "camara";
    openModal(
      "Elegir tema",
      "Apariencia",
      `<div class="theme-picker">
        <p class="theme-intro">Selecciona una paleta. La elección se guarda automáticamente en este navegador.</p>
        <div class="palette-grid">
          ${themes
            .map(
              (theme) => `<button class="palette-option ${selectedTheme === theme.id ? "selected" : ""}" data-theme-option="${theme.id}">
                <span class="palette-swatches" aria-hidden="true">
                  ${theme.colors.map((color, index) => `<i style="--swatch:${color};--swatch-light:${theme.colors[Math.min(index + 1, theme.colors.length - 1)]}"></i>`).join("")}
                </span>
                <span><strong>${theme.name}</strong><small>${theme.description}</small></span>
                <b>${selectedTheme === theme.id ? "✓" : ""}</b>
              </button>`,
            )
            .join("")}
        </div>
        <footer class="modal-actions theme-actions"><span></span><button class="secondary-button" type="button" id="cancelModal">Cerrar</button></footer>
      </div>`,
    );
    document.querySelector("#cancelModal").addEventListener("click", closeModal);
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.theme = button.dataset.themeOption;
        applyTheme(state.settings.theme);
        saveState(`Tema ${themes.find((theme) => theme.id === state.settings.theme).name} activado`);
        closeModal();
        render();
      });
    });
  }

  function initAuth() {
    applyTheme(state.settings.theme);
    const auth = localStorage.getItem(AUTH_KEY);
    if (auth && sessionStorage.getItem(SESSION_KEY) === "active") unlockApp();
    else renderAuth();
  }

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.querySelector("#quickAddEvent").addEventListener("click", () => openEventModal());
  document.querySelector("#themeButton").addEventListener("click", openThemeModal);
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#closeModal").addEventListener("click", closeModal);
  document.querySelector("#modalBackdrop").addEventListener("click", (event) => event.target === modalBackdrop && closeModal());
  document.querySelector("#menuToggle").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
  document.addEventListener("keydown", (event) => event.key === "Escape" && !modalBackdrop.hidden && closeModal());

  initAuth();
})();
