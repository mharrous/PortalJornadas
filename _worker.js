const SESSION_COOKIE = "portal_jornadas_session";
const SESSION_HOURS = 12;
const PASSWORD_ITERATIONS = 100000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      ...headers,
    },
  });
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

function toBase64(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function randomToken(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  return toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function passwordHash(password, saltBase64) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(saltBase64), iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return toBase64(bits);
}

function equalSecret(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function requestBody(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("Formato no válido");
  return request.json();
}

async function currentSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await env.AUTH_DB.prepare(
    `SELECT sessions.id AS session_id, users.id, users.username, users.display_name, users.role, users.modules
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first();
  return session || null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    modules: user.role === "admin" ? ["jornadas", "podcast"] : parseModules(user.modules),
  };
}

function parseModules(value) {
  return [...new Set(String(value || "").split(",").map((module) => module.trim()).filter((module) => ["jornadas", "podcast"].includes(module)))];
}

async function requireUser(request, env, role) {
  const session = await currentSession(request, env);
  if (!session) return { error: json({ error: "Sesión no válida" }, 401) };
  if (role && session.role !== role) return { error: json({ error: "Permisos insuficientes" }, 403) };
  return { session };
}

async function requireModule(request, env, module) {
  const access = await requireUser(request, env);
  if (access.error) return access;
  if (access.session.role !== "admin" && !parseModules(access.session.modules).includes(module)) {
    return { error: json({ error: "Permisos insuficientes" }, 403) };
  }
  return access;
}

async function login(request, env) {
  const body = await requestBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const user = await env.AUTH_DB.prepare(
    "SELECT id, username, display_name, role, modules, password_hash, password_salt FROM users WHERE username = ? COLLATE NOCASE AND active = 1",
  )
    .bind(username)
    .first();
  if (!user) return json({ error: "Usuario o contraseña incorrectos" }, 401);
  const calculatedHash = await passwordHash(password, user.password_salt);
  if (!equalSecret(calculatedHash, user.password_hash)) return json({ error: "Usuario o contraseña incorrectos" }, 401);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    env.AUTH_DB.prepare(
      "INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), await sha256(token), user.id, expiresAt, new Date().toISOString(), request.headers.get("user-agent") || ""),
    env.AUTH_DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), user.id),
  ]);
  return json(
    { user: publicUser(user) },
    200,
    { "set-cookie": sessionCookie(token, SESSION_HOURS * 60 * 60) },
  );
}

async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function listUsers(request, env) {
  const access = await requireUser(request, env, "admin");
  if (access.error) return access.error;
  const result = await env.AUTH_DB.prepare(
    "SELECT id, username, display_name, role, modules, active, created_at, last_login_at FROM users ORDER BY active DESC, display_name COLLATE NOCASE",
  ).all();
  return json({ users: result.results });
}

function validateUserInput(body, requirePassword = true) {
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || "").trim();
  const password = String(body.password || "");
  const access = accessProfile(body);
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) return { error: "El usuario debe tener entre 3 y 50 caracteres válidos" };
  if (displayName.length < 2 || displayName.length > 80) return { error: "Indica un nombre visible válido" };
  if (requirePassword && password.length < 10) return { error: "La contraseña debe tener al menos 10 caracteres" };
  return { username, displayName, password, ...access };
}

function accessProfile(body) {
  if (body.accessProfile === "admin" || body.role === "admin") return { role: "admin", modules: "jornadas,podcast" };
  const requested = body.accessProfile === "both"
    ? ["jornadas", "podcast"]
    : body.accessProfile === "podcast"
      ? ["podcast"]
      : body.accessProfile === "jornadas"
        ? ["jornadas"]
        : parseModules(Array.isArray(body.modules) ? body.modules.join(",") : body.modules || "jornadas");
  return { role: "user", modules: (requested.length ? requested : ["jornadas"]).join(",") };
}

async function createUser(request, env) {
  const access = await requireUser(request, env, "admin");
  if (access.error) return access.error;
  const input = validateUserInput(await requestBody(request));
  if (input.error) return json({ error: input.error }, 400);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  try {
    await env.AUTH_DB.prepare(
      `INSERT INTO users (id, username, display_name, role, modules, password_hash, password_salt, active, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        input.username,
        input.displayName,
        input.role,
        input.modules,
        await passwordHash(input.password, toBase64(salt)),
        toBase64(salt),
        new Date().toISOString(),
        access.session.id,
      )
      .run();
    return json({ ok: true }, 201);
  } catch (error) {
    return json({ error: "Ese nombre de usuario ya existe" }, 409);
  }
}

async function updateUser(request, env, userId) {
  const access = await requireUser(request, env, "admin");
  if (access.error) return access.error;
  const body = await requestBody(request);
  const target = await env.AUTH_DB.prepare("SELECT id, role, modules, active FROM users WHERE id = ?").bind(userId).first();
  if (!target) return json({ error: "Usuario no encontrado" }, 404);
  if (userId === access.session.id && (body.active === false || (body.accessProfile && body.accessProfile !== "admin") || (body.role && body.role !== "admin"))) {
    return json({ error: "No puedes retirar tus propios permisos" }, 400);
  }

  if (body.password) {
    if (String(body.password).length < 10) return json({ error: "La contraseña debe tener al menos 10 caracteres" }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltBase64 = toBase64(salt);
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(
        await passwordHash(String(body.password), saltBase64),
        saltBase64,
        userId,
      ),
      env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    ]);
  }

  const requestedAccess = body.accessProfile || body.role || body.modules ? accessProfile(body) : { role: target.role, modules: target.modules };
  const role = requestedAccess.role;
  const modules = requestedAccess.modules;
  const accessChanged = role !== target.role || modules !== target.modules;
  const active = typeof body.active === "boolean" ? Number(body.active) : target.active;
  if (target.role === "admin" && (role !== "admin" || !active)) {
    const adminCount = await env.AUTH_DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").first();
    if (Number(adminCount.total) <= 1) return json({ error: "Debe existir al menos un administrador activo" }, 400);
  }
  await env.AUTH_DB.prepare("UPDATE users SET role = ?, modules = ?, active = ? WHERE id = ?").bind(role, modules, active, userId).run();
  if (!active || accessChanged) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  return json({ ok: true });
}

async function deleteUser(request, env, userId) {
  const access = await requireUser(request, env, "admin");
  if (access.error) return access.error;
  if (userId === access.session.id) return json({ error: "No puedes eliminar tu propio usuario" }, 400);
  const target = await env.AUTH_DB.prepare("SELECT role, active FROM users WHERE id = ?").bind(userId).first();
  if (!target) return json({ error: "Usuario no encontrado" }, 404);
  if (target.role === "admin" && target.active) {
    const adminCount = await env.AUTH_DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").first();
    if (Number(adminCount.total) <= 1) return json({ error: "Debe existir al menos un administrador activo" }, 400);
  }
  await env.AUTH_DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return json({ ok: true });
}

function podcastText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function podcastEpisodeInput(body, current = {}) {
  const episodeLabel = podcastText(body.episodeLabel ?? current.episode_label, 40);
  const topic = podcastText(body.topic ?? current.topic, 160);
  if (!episodeLabel || !topic) return { error: "Indica el episodio y el tema" };
  return {
    episodeLabel,
    topic,
    guest: podcastText(body.guest ?? current.guest, 180),
    recordingDate: podcastText(body.recordingDate ?? current.recording_date, 10) || null,
    recordingStatus: podcastText(body.recordingStatus ?? current.recording_status, 40) || "Pendiente",
    editingStatus: podcastText(body.editingStatus ?? current.editing_status, 40) || "Pendiente",
    publicationStatus: podcastText(body.publicationStatus ?? current.publication_status, 40) || "Pendiente",
    socialStatus: podcastText(body.socialStatus ?? current.social_status, 40) || "Pendiente",
    pressStatus: podcastText(body.pressStatus ?? current.press_status, 40) || "Pendiente",
    logos: podcastText(body.logos ?? current.logos, 160),
    responsible: podcastText(body.responsible ?? current.responsible, 100),
    cancelled: typeof body.cancelled === "boolean" ? Number(body.cancelled) : Number(current.cancelled || 0),
    cancelReason: podcastText(body.cancelReason ?? current.cancel_reason, 240),
  };
}

function podcastScheduleInput(body, current = {}) {
  const weekLabel = podcastText(body.weekLabel ?? current.week_label, 100);
  if (!weekLabel) return { error: "Indica la fecha o semana de publicación" };
  return {
    month: podcastText(body.month ?? current.month, 30),
    episodeNumber: podcastText(body.episodeNumber ?? current.episode_number, 30),
    weekLabel,
    action: podcastText(body.action ?? current.action, 100),
    responsible: podcastText(body.responsible ?? current.responsible, 100),
    status: podcastText(body.status ?? current.status, 40) || "Pendiente",
  };
}

async function getPodcast(request, env) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const [episodes, schedule] = await Promise.all([
    env.AUTH_DB.prepare("SELECT * FROM podcast_episodes ORDER BY cancelled ASC, source_order ASC, recording_date ASC").all(),
    env.AUTH_DB.prepare("SELECT * FROM podcast_schedule ORDER BY sort_order ASC").all(),
  ]);
  return json({ episodes: episodes.results, schedule: schedule.results });
}

async function createPodcastEpisode(request, env) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const input = podcastEpisodeInput(await requestBody(request));
  if (input.error) return json({ error: input.error }, 400);
  const order = await env.AUTH_DB.prepare("SELECT COALESCE(MAX(source_order), 0) + 1 AS next_order FROM podcast_episodes").first();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.AUTH_DB.prepare(
    `INSERT INTO podcast_episodes
     (id, episode_label, topic, guest, recording_date, recording_status, editing_status, publication_status, social_status, press_status, logos, responsible, cancelled, cancel_reason, source_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.episodeLabel, input.topic, input.guest, input.recordingDate, input.recordingStatus, input.editingStatus,
    input.publicationStatus, input.socialStatus, input.pressStatus, input.logos, input.responsible, input.cancelled,
    input.cancelReason, Number(order.next_order), now, now,
  ).run();
  return json({ id }, 201);
}

async function updatePodcastEpisode(request, env, episodeId) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const current = await env.AUTH_DB.prepare("SELECT * FROM podcast_episodes WHERE id = ?").bind(episodeId).first();
  if (!current) return json({ error: "Episodio no encontrado" }, 404);
  const input = podcastEpisodeInput(await requestBody(request), current);
  if (input.error) return json({ error: input.error }, 400);
  await env.AUTH_DB.prepare(
    `UPDATE podcast_episodes SET episode_label = ?, topic = ?, guest = ?, recording_date = ?, recording_status = ?, editing_status = ?, publication_status = ?, social_status = ?, press_status = ?, logos = ?, responsible = ?, cancelled = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    input.episodeLabel, input.topic, input.guest, input.recordingDate, input.recordingStatus, input.editingStatus,
    input.publicationStatus, input.socialStatus, input.pressStatus, input.logos, input.responsible, input.cancelled,
    input.cancelReason, new Date().toISOString(), episodeId,
  ).run();
  return json({ ok: true });
}

async function deletePodcastEpisode(request, env, episodeId) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const result = await env.AUTH_DB.prepare("DELETE FROM podcast_episodes WHERE id = ?").bind(episodeId).run();
  if (!result.meta.changes) return json({ error: "Episodio no encontrado" }, 404);
  return json({ ok: true });
}

async function createPodcastSchedule(request, env) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const input = podcastScheduleInput(await requestBody(request));
  if (input.error) return json({ error: input.error }, 400);
  const order = await env.AUTH_DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM podcast_schedule").first();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.AUTH_DB.prepare(
    `INSERT INTO podcast_schedule (id, month, episode_number, week_label, action, responsible, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.month, input.episodeNumber, input.weekLabel, input.action, input.responsible, input.status, Number(order.next_order), now, now).run();
  return json({ id }, 201);
}

async function updatePodcastSchedule(request, env, scheduleId) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const current = await env.AUTH_DB.prepare("SELECT * FROM podcast_schedule WHERE id = ?").bind(scheduleId).first();
  if (!current) return json({ error: "Publicación no encontrada" }, 404);
  const input = podcastScheduleInput(await requestBody(request), current);
  if (input.error) return json({ error: input.error }, 400);
  await env.AUTH_DB.prepare(
    "UPDATE podcast_schedule SET month = ?, episode_number = ?, week_label = ?, action = ?, responsible = ?, status = ?, updated_at = ? WHERE id = ?",
  ).bind(input.month, input.episodeNumber, input.weekLabel, input.action, input.responsible, input.status, new Date().toISOString(), scheduleId).run();
  return json({ ok: true });
}

async function deletePodcastSchedule(request, env, scheduleId) {
  const access = await requireModule(request, env, "podcast");
  if (access.error) return access.error;
  const result = await env.AUTH_DB.prepare("DELETE FROM podcast_schedule WHERE id = ?").bind(scheduleId).run();
  if (!result.meta.changes) return json({ error: "Publicación no encontrada" }, 404);
  return json({ ok: true });
}

async function handleApi(request, env) {
  if (!env.AUTH_DB) return json({ error: "La base de datos de acceso no está configurada" }, 503);
  if (["POST", "PATCH", "DELETE"].includes(request.method) && !assertSameOrigin(request)) return json({ error: "Origen no permitido" }, 403);
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const access = await requireUser(request, env);
    return access.error || json({ user: publicUser(access.session) });
  }
  if (url.pathname === "/api/users" && request.method === "GET") return listUsers(request, env);
  if (url.pathname === "/api/users" && request.method === "POST") return createUser(request, env);
  if (url.pathname === "/api/podcast" && request.method === "GET") return getPodcast(request, env);
  if (url.pathname === "/api/podcast/episodes" && request.method === "POST") return createPodcastEpisode(request, env);
  if (url.pathname === "/api/podcast/schedule" && request.method === "POST") return createPodcastSchedule(request, env);
  const podcastEpisodeMatch = url.pathname.match(/^\/api\/podcast\/episodes\/([^/]+)$/);
  if (podcastEpisodeMatch && request.method === "PATCH") return updatePodcastEpisode(request, env, podcastEpisodeMatch[1]);
  if (podcastEpisodeMatch && request.method === "DELETE") return deletePodcastEpisode(request, env, podcastEpisodeMatch[1]);
  const podcastScheduleMatch = url.pathname.match(/^\/api\/podcast\/schedule\/([^/]+)$/);
  if (podcastScheduleMatch && request.method === "PATCH") return updatePodcastSchedule(request, env, podcastScheduleMatch[1]);
  if (podcastScheduleMatch && request.method === "DELETE") return deletePodcastSchedule(request, env, podcastScheduleMatch[1]);
  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && request.method === "PATCH") return updateUser(request, env, userMatch[1]);
  if (userMatch && request.method === "DELETE") return deleteUser(request, env, userMatch[1]);
  return json({ error: "Ruta no encontrada" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "Error interno" }, 500);
    }
  },
};
