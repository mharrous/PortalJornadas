(function () {
  "use strict";

  window.OAP_CHECKLIST = [
    "Jornada / formato",
    "Ponente",
    "Espacio",
    "Sonido",
    "Viaje y hotel",
    "Publicidad",
    "Encuesta",
    "Actualizar web",
    "Agendar presidencia y secretaría",
    "Mail pleno",
    "Avisar medios",
    "Material",
    "Transporte",
    "Avisar presidencia móvil",
  ];

  window.OAP_DEFAULT_EXPENSE_DESCRIPTIONS = ["Sonido", "Espacio", "Merchandising", "Ponente"];

  function checklistDone(prefix) {
    return window.OAP_CHECKLIST.map((name, index) => ({ id: `${prefix}-task-${index + 1}`, name, status: "done" }));
  }

  function recoveredExpenses(prefix, executed) {
    const expenses = window.OAP_DEFAULT_EXPENSE_DESCRIPTIONS.map((description, index) => ({
      id: `${prefix}-expense-${index + 1}`,
      description,
      provider: "",
      amount: 0,
      notes: "",
    }));
    if (executed > 0) {
      expenses.push({
        id: `${prefix}-expense-recovered`,
        description: "Ejecutado recuperado del CSV",
        provider: "",
        amount: executed,
        notes: "Total recuperado del CSV del 21/07/2026; pendiente de desglosar.",
      });
    }
    return expenses;
  }

  const recoveredEvents = [
    {
      id: "recovery-2026-04-16",
      date: "2026-04-16",
      format: "Desayuno",
      theme: "JORNADA PRODUCTIVIDAD",
      title: "Tu negocio en piloto automático: Herramientas para recuperar tu tiempo",
      location: "HOTEL ULISES",
      speaker: "ALICIA PUGA",
      budget: 1350,
      executed: 1926.28,
    },
    {
      id: "recovery-2026-05-07",
      date: "2026-05-07",
      format: "Desayuno",
      theme: "JORNADA PRÁCTICA DE MARKETING",
      title: "Jornada Google My Business y redes sociales 2.0",
      location: "HOTEL ULISES",
      speaker: "MARIA BADIMÓN",
      budget: 1350,
      executed: 2653.13,
    },
    {
      id: "recovery-2026-05-14",
      date: "2026-05-14",
      format: "Webinar",
      theme: "JORNADA BIG DATA",
      title: "De la información a la acción: Utiliza los datos para hacer crecer tu negocio.",
      location: "ONLINE",
      speaker: "NICOLÁS MILLÁN",
      budget: 1350,
      executed: 250,
    },
    {
      id: "recovery-2026-06-04",
      date: "2026-06-04",
      format: "Desayuno",
      theme: "JORNADA VENTAS",
      title: "¿Cómo puedes vender más con IA?",
      location: "ONLINE",
      speaker: "JESÚS PYME UP",
      budget: 1350,
      executed: 0,
    },
    {
      id: "recovery-2026-06-30",
      date: "2026-06-30",
      format: "Desayuno",
      theme: "IA + BASES DE DATOS",
      title: "IA sin riesgos: claves para cumplir con la protección de datos en tu empresa",
      location: "HOTEL ULISES",
      speaker: "SALVADOR ZOTANO Y DIEGO FERNANDEZ",
      budget: 1350,
      executed: 663.33,
    },
  ].map((item) => ({
    id: item.id,
    date: item.date,
    format: item.format,
    theme: item.theme,
    title: item.title,
    speaker: item.speaker,
    location: item.location,
    time: "",
    budget: item.budget,
    period: "Abril - junio",
    expenses: recoveredExpenses(item.id, item.executed),
    invoices: [],
    checklist: checklistDone(item.id),
    notes: "Jornada recuperada de la copia CSV del 21/07/2026.",
  }));

  window.OAP_RECOVERY_EVENTS_20260721 = recoveredEvents;

  window.OAP_SEED = {
    settings: {
      annualBudget: 0,
      privacyMode: true,
      theme: "camara",
      organization: "Oficina Acelera Pyme · Cámara de Comercio de Ceuta",
      recovery20260721Applied: true,
    },
    budgetLines: [],
    events: recoveredEvents,
    contacts: [],
  };
})();
