const SESSION_COOKIE = "portal_jornadas_session";
const SESSION_HOURS = 180 * 24;
const PASSWORD_ITERATIONS = 100000;
const OIDC_STATE_MINUTES = 10;
const CURRENT_APP_CODE = "gestion-jornadas";
const PORTAL_LAUNCH_URL = "https://portal.camaraceuta.workers.dev/api/apps/gestion-jornadas/launch";
const PORTAL_LOGOUT_URL = "https://portal.camaraceuta.workers.dev/logout";

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

function toBase64Url(bytes) {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return fromBase64(normalized);
}

function randomToken(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  return toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sha256Base64Url(value) {
  return toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", ...headers } });
}

function entraConfig(env) {
  const tenantId = String(env.ENTRA_TENANT_ID || "").trim().toLowerCase();
  const clientId = String(env.ENTRA_CLIENT_ID || "").trim();
  const clientSecret = String(env.ENTRA_CLIENT_SECRET || "").trim();
  const redirectUri = String(env.ENTRA_REDIRECT_URI || "").trim();
  const postLogoutRedirectUri = String(env.ENTRA_POST_LOGOUT_REDIRECT_URI || "").trim();
  const configuredAuthority = String(env.ENTRA_AUTHORITY || `https://login.microsoftonline.com/${tenantId}`).trim();
  const authorityRoot = configuredAuthority.replace(/\/v2\.0\/?$/i, "").replace(/\/$/, "");
  const enabled = env.ENTRA_ENABLED === "true" && Boolean(tenantId && clientId && clientSecret && redirectUri);
  return {
    enabled,
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    postLogoutRedirectUri,
    authorityRoot,
    issuer: `${authorityRoot}/v2.0`,
    metadataUrl: `${authorityRoot}/v2.0/.well-known/openid-configuration`,
    requiredRole: String(env.ENTRA_REQUIRED_ROLE || "").trim(),
    localAdminLoginEnabled: !enabled || env.LOCAL_ADMIN_LOGIN_ENABLED === "true",
  };
}

function safeReturnTo(value) {
  const candidate = String(value || "/");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || candidate.startsWith("/api/")) return "/";
  return candidate;
}

function sameOriginUrl(value, request) {
  const requestUrl = new URL(request.url);
  const candidate = new URL(value || requestUrl.origin, requestUrl.origin);
  return candidate.origin === requestUrl.origin ? candidate.toString() : requestUrl.origin;
}

function oauthErrorRedirect(request, code) {
  const target = new URL("/", request.url);
  target.searchParams.set("auth_error", code);
  return redirect(target.toString());
}

async function createSession(request, env, userId, externalSessionId = null) {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()),
    env.AUTH_DB.prepare(
      "INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, user_agent, external_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), await sha256(token), userId, expiresAt, now.toISOString(), request.headers.get("user-agent") || "", externalSessionId),
    env.AUTH_DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now.toISOString(), userId),
  ]);
  return token;
}

async function oidcMetadata(config) {
  const response = await fetch(config.metadataUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("No se pudo consultar Microsoft Entra");
  const metadata = await response.json();
  const endpoints = [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri, metadata.issuer];
  if (endpoints.some((value) => typeof value !== "string" || !value.startsWith("https://"))) throw new Error("Metadatos OIDC no válidos");
  if (metadata.issuer !== config.issuer) throw new Error("Emisor OIDC inesperado");
  return metadata;
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
}

async function validateIdToken(idToken, expectedNonce, config, metadata) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Token de identidad no válido");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Firma de token no permitida");
  const jwksResponse = await fetch(metadata.jwks_uri, { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new Error("No se pudieron obtener las claves de Microsoft");
  const jwks = await jwksResponse.json();
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((item) => item.kid === header.kid && item.kty === "RSA") : null;
  if (!jwk) throw new Error("Clave de firma no encontrada");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    fromBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) throw new Error("Firma de token no válida");
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) throw new Error("Audiencia no válida");
  if (claims.iss !== metadata.issuer || String(claims.tid || "").toLowerCase() !== config.tenantId) throw new Error("Tenant no autorizado");
  if (!claims.exp || claims.exp < now - 60 || (claims.nbf && claims.nbf > now + 60)) throw new Error("Token caducado o aún no válido");
  if (!claims.nonce || !equalSecret(String(claims.nonce), String(expectedNonce))) throw new Error("Nonce no válido");
  if (!claims.oid) throw new Error("Identificador de usuario no disponible");
  if (config.requiredRole && (!Array.isArray(claims.roles) || !claims.roles.includes(config.requiredRole))) throw new Error("Rol de aplicación no autorizado");
  return claims;
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
    `SELECT sessions.id AS session_id, sessions.external_session_id, users.id, users.username, users.display_name, users.email, users.role, users.modules, users.auth_provider
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first();
  if (!session) return null;
  if (!String(session.external_session_id || "").startsWith("portal:")) {
    await env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.session_id).run();
    return null;
  }
  if (String(session.external_session_id || "").startsWith("portal:")) {
    if (!env.PORTAL_AUTH_DB) return null;
    const centralUserId = Number(String(session.external_session_id).slice("portal:".length));
    const allowed = await env.PORTAL_AUTH_DB.prepare(`
      SELECT u.id
      FROM users u
      LEFT JOIN user_application_permissions p
        ON p.user_id = u.id AND p.application_code = ?
      WHERE u.id = ? AND u.active = 1
        AND (u.role = 'admin' OR p.active = 1)
    `).bind(CURRENT_APP_CODE, centralUserId).first();
    if (!allowed) {
      await env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.session_id).run();
      return null;
    }
  }
  return session;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email || "",
    role: user.role,
    authProvider: user.auth_provider || "local",
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

async function microsoftStart(request, env) {
  const config = entraConfig(env);
  if (!config.enabled) return json({ error: "Microsoft Entra no está configurado" }, 503);
  const existingSession = await currentSession(request, env);
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
  if (existingSession) return redirect(new URL(returnTo, requestUrl.origin).toString());

  const metadata = await oidcMetadata(config);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OIDC_STATE_MINUTES * 60 * 1000).toISOString();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare("DELETE FROM oidc_states WHERE expires_at <= ?").bind(now.toISOString()),
    env.AUTH_DB.prepare("INSERT INTO oidc_states (state_hash, code_verifier, nonce, return_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await sha256(state), codeVerifier, nonce, returnTo, expiresAt, now.toISOString()),
  ]);
  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_mode", "form_post");
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return redirect(authorizeUrl.toString());
}

async function microsoftCallback(request, env) {
  const config = entraConfig(env);
  if (!config.enabled) return oauthErrorRedirect(request, "sso_not_configured");
  const form = await request.formData();
  const state = String(form.get("state") || "");
  if (!state) return oauthErrorRedirect(request, "invalid_state");
  const stateHash = await sha256(state);
  const savedState = await env.AUTH_DB.prepare(
    "SELECT state_hash, code_verifier, nonce, return_to, expires_at FROM oidc_states WHERE state_hash = ?",
  ).bind(stateHash).first();
  await env.AUTH_DB.prepare("DELETE FROM oidc_states WHERE state_hash = ?").bind(stateHash).run();
  if (!savedState || savedState.expires_at <= new Date().toISOString()) return oauthErrorRedirect(request, "invalid_state");
  if (form.get("error")) return oauthErrorRedirect(request, "microsoft_error");
  const code = String(form.get("code") || "");
  if (!code) return oauthErrorRedirect(request, "missing_code");

  try {
    const metadata = await oidcMetadata(config);
    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: savedState.code_verifier,
        scope: "openid profile email",
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.id_token) throw new Error("Microsoft no devolvió un token válido");
    const claims = await validateIdToken(tokenData.id_token, savedState.nonce, config, metadata);
    const claimedEmail = [claims.email, claims.preferred_username]
      .map((value) => String(value || "").trim().toLowerCase())
      .find((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
    let user = await env.AUTH_DB.prepare(
      "SELECT id, username, display_name, email, role, modules, active, auth_provider, entra_oid, entra_tenant_id FROM users WHERE entra_tenant_id = ? AND entra_oid = ?",
    ).bind(config.tenantId, String(claims.oid)).first();
    if (!user && claimedEmail) {
      user = await env.AUTH_DB.prepare(
        "SELECT id, username, display_name, email, role, modules, active, auth_provider, entra_oid, entra_tenant_id FROM users WHERE email = ? COLLATE NOCASE",
      ).bind(claimedEmail).first();
      if (user && user.entra_oid && (user.entra_oid !== claims.oid || user.entra_tenant_id !== config.tenantId)) {
        return oauthErrorRedirect(request, "identity_mismatch");
      }
      if (user) {
        await env.AUTH_DB.prepare(
          "UPDATE users SET entra_oid = ?, entra_tenant_id = ?, auth_provider = 'entra' WHERE id = ?",
        ).bind(String(claims.oid), config.tenantId, user.id).run();
        user.entra_oid = String(claims.oid);
        user.entra_tenant_id = config.tenantId;
        user.auth_provider = "entra";
      }
    }
    if (!user || !user.active || (!parseModules(user.modules).length && user.role !== "admin")) return oauthErrorRedirect(request, "access_denied");
    const token = await createSession(request, env, user.id, claims.sid ? String(claims.sid) : null);
    const target = new URL(safeReturnTo(savedState.return_to), new URL(request.url).origin).toString();
    return redirect(target, { "set-cookie": sessionCookie(token, SESSION_HOURS * 60 * 60) });
  } catch (error) {
    console.error(JSON.stringify({ event: "entra_callback_failed", app: CURRENT_APP_CODE, message: error.message }));
    return oauthErrorRedirect(request, "validation_failed");
  }
}

async function microsoftFrontChannelLogout(request, env) {
  const config = entraConfig(env);
  const url = new URL(request.url);
  const sid = String(url.searchParams.get("sid") || "");
  const issuer = String(url.searchParams.get("iss") || "");
  if (config.enabled && sid && issuer === config.issuer) {
    await env.AUTH_DB.prepare("DELETE FROM sessions WHERE external_session_id = ?").bind(sid).run();
  }
  return new Response(null, { status: 200, headers: { "set-cookie": sessionCookie("", 0), "cache-control": "no-store" } });
}

async function portalLogin(request, env) {
  if (!env.PORTAL_AUTH_DB) return json({ error: "El acceso desde el portal no está configurado" }, 503);
  const code = String(new URL(request.url).searchParams.get("code") || "");
  if (!code) return json({ error: "Código de acceso no válido" }, 400);
  const loginCode = await env.PORTAL_AUTH_DB.prepare(`
    DELETE FROM login_codes
    WHERE code_hash = ? AND application_code = ? AND expires_at > CURRENT_TIMESTAMP
    RETURNING user_id
  `).bind(await sha256Base64Url(code), CURRENT_APP_CODE).first();
  if (!loginCode) return json({ error: "El acceso ha caducado o ya fue utilizado" }, 403);
  const centralUser = await env.PORTAL_AUTH_DB.prepare(`
    SELECT u.id, u.display_name, u.email, u.role, u.entra_oid, u.entra_tenant_id, p.role AS application_role
    FROM users u
    LEFT JOIN user_application_permissions p ON p.user_id = u.id AND p.application_code = ?
    WHERE u.id = ? AND u.active = 1 AND (u.role = 'admin' OR p.active = 1)
  `).bind(CURRENT_APP_CODE, loginCode.user_id).first();
  if (!centralUser?.email) return json({ error: "Usuario sin correo corporativo autorizado" }, 403);

  let localUser = await env.AUTH_DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(centralUser.email).first();
  if (!localUser) {
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const password = randomToken(32);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const role = centralUser.role === "admin" || centralUser.application_role === "admin" ? "admin" : "user";
    await env.AUTH_DB.prepare(`
      INSERT INTO users (id, username, display_name, role, modules, email, entra_oid, entra_tenant_id, auth_provider, password_hash, password_salt, active, created_at)
      VALUES (?, ?, ?, ?, 'jornadas', ?, ?, ?, 'entra', ?, ?, 1, ?)
    `).bind(userId, `portal_${centralUser.id}`, centralUser.display_name || centralUser.email, role, centralUser.email, centralUser.entra_oid, centralUser.entra_tenant_id, await passwordHash(password, salt), salt, now).run();
    localUser = await env.AUTH_DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  }
  if (!localUser.active) return json({ error: "Usuario desactivado en Jornadas" }, 403);
  if (localUser.role !== "admin" && !parseModules(localUser.modules).includes("jornadas")) {
    const modules = [...parseModules(localUser.modules), "jornadas"].join(",");
    await env.AUTH_DB.prepare("UPDATE users SET modules = ? WHERE id = ?").bind(modules, localUser.id).run();
    localUser.modules = modules;
  }
  const token = await createSession(request, env, localUser.id, `portal:${centralUser.id}`);
  return redirect(new URL("/", request.url).toString(), {
    "set-cookie": sessionCookie(token, SESSION_HOURS * 60 * 60),
    "referrer-policy": "no-referrer",
  });
}

async function login(request, env) {
  const config = entraConfig(env);
  const body = await requestBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const user = await env.AUTH_DB.prepare(
    "SELECT id, username, display_name, email, role, modules, auth_provider, password_hash, password_salt FROM users WHERE username = ? COLLATE NOCASE AND active = 1",
  )
    .bind(username)
    .first();
  if (!user) return json({ error: "Usuario o contraseña incorrectos" }, 401);
  if (config.enabled && (!config.localAdminLoginEnabled || user.role !== "admin")) return json({ error: "Utiliza el acceso corporativo de Microsoft" }, 403);
  const calculatedHash = await passwordHash(password, user.password_salt);
  if (!equalSecret(calculatedHash, user.password_hash)) return json({ error: "Usuario o contraseña incorrectos" }, 401);

  const token = await createSession(request, env, user.id);
  return json(
    { user: publicUser(user) },
    200,
    { "set-cookie": sessionCookie(token, SESSION_HOURS * 60 * 60) },
  );
}

async function logout(request, env) {
  const session = await currentSession(request, env);
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true, logoutUrl: PORTAL_LOGOUT_URL }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function listUsers(request, env) {
  const access = await requireUser(request, env, "admin");
  if (access.error) return access.error;
  const result = await env.AUTH_DB.prepare(
    "SELECT id, username, display_name, email, role, modules, auth_provider, entra_oid, entra_tenant_id, active, created_at, last_login_at FROM users ORDER BY active DESC, display_name COLLATE NOCASE",
  ).all();
  return json({ users: result.results });
}

function validateUserInput(body, requirePassword = true) {
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || "").trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const access = accessProfile(body);
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) return { error: "El usuario debe tener entre 3 y 50 caracteres válidos" };
  if (displayName.length < 2 || displayName.length > 80) return { error: "Indica un nombre visible válido" };
  if (body.email && !email) return { error: "Indica un correo corporativo válido" };
  if (requirePassword && password.length < 10) return { error: "La contraseña debe tener al menos 10 caracteres" };
  return { username, displayName, email, password, ...access };
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
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
      `INSERT INTO users (id, username, display_name, email, role, modules, auth_provider, password_hash, password_salt, active, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?, 1, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        input.username,
        input.displayName,
        input.email || null,
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
    return json({ error: "Ese usuario o correo corporativo ya existe" }, 409);
  }
}

async function updateUser(request, env, userId) {
  const access = await requireUser(request, env, "admin");
  if (access.error) return access.error;
  const body = await requestBody(request);
  if (Object.keys(body).some((key) => key !== "accessProfile")) {
    return json({ error: "La identidad se gestiona desde el portal central" }, 400);
  }
  const target = await env.AUTH_DB.prepare("SELECT id, username, display_name, email, role, modules, active, entra_oid FROM users WHERE id = ?").bind(userId).first();
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
  const username = Object.prototype.hasOwnProperty.call(body, "username") ? String(body.username || "").trim() : target.username;
  const displayName = Object.prototype.hasOwnProperty.call(body, "displayName") ? String(body.displayName || "").trim() : target.display_name;
  const email = Object.prototype.hasOwnProperty.call(body, "email") ? normalizeEmail(body.email) : target.email;
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) return json({ error: "El usuario debe tener entre 3 y 50 caracteres válidos" }, 400);
  if (displayName.length < 2 || displayName.length > 80) return json({ error: "Indica un nombre visible válido" }, 400);
  if (Object.prototype.hasOwnProperty.call(body, "email") && body.email && !email) return json({ error: "Indica un correo corporativo válido" }, 400);
  if (target.role === "admin" && (role !== "admin" || !active)) {
    const adminCount = await env.AUTH_DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").first();
    if (Number(adminCount.total) <= 1) return json({ error: "Debe existir al menos un administrador activo" }, 400);
  }
  try {
    await env.AUTH_DB.prepare("UPDATE users SET username = ?, display_name = ?, role = ?, modules = ?, email = ?, active = ? WHERE id = ?")
      .bind(username, displayName, role, modules, email || null, active, userId)
      .run();
  } catch (error) {
    return json({ error: "Ese usuario o correo corporativo ya pertenece a otra cuenta" }, 409);
  }
  if (body.resetEntraLink === true) {
    await env.AUTH_DB.prepare("UPDATE users SET entra_oid = NULL, entra_tenant_id = NULL, auth_provider = 'local' WHERE id = ?").bind(userId).run();
  }
  if (!active || accessChanged || body.resetEntraLink === true) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
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
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/portal" && request.method === "GET") return portalLogin(request, env);
  if (["POST", "PATCH", "DELETE"].includes(request.method) && !assertSameOrigin(request)) return json({ error: "Origen no permitido" }, 403);
  if (url.pathname === "/api/auth/config" && request.method === "GET") {
    return json({ microsoftEnabled: true, localAdminLoginEnabled: false, portalLaunchUrl: PORTAL_LAUNCH_URL });
  }
  if (url.pathname === "/api/auth/microsoft/start" && request.method === "GET") return redirect(PORTAL_LAUNCH_URL);
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const access = await requireUser(request, env);
    return access.error || json({ user: publicUser(access.session) });
  }
  if (url.pathname === "/api/users" && request.method === "GET") return listUsers(request, env);
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
