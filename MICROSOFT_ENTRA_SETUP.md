# Configuración de Microsoft Entra ID

## Arquitectura aplicada

Este repositorio no usa React, Vite, MSAL ni Supabase. Es una aplicación HTML/CSS/JavaScript alojada en Cloudflare Pages, con un Worker (`_worker.js`) y Cloudflare D1. Por ello, el inicio de sesión se implementa como una aplicación web confidencial mediante OpenID Connect y Authorization Code Flow con PKCE en el Worker.

- El navegador nunca recibe el `client_secret`.
- El Worker intercambia el código y valida criptográficamente el ID token.
- Solo se solicitan `openid`, `profile` y `email`; Microsoft Graph no es necesario.
- D1 conserva la autorización: el usuario debe existir, estar activo, tener correo corporativo y permisos de Jornadas o Podcast.
- El vínculo estable se guarda con `tid` + `oid`; el correo solo se usa en el primer acceso.
- El acceso local anterior se conserva únicamente como recuperación administrativa cuando `LOCAL_ADMIN_LOGIN_ENABLED=true`.

## URLs existentes

- Aplicación OAP AceleraPyme: `https://portal-jornadas.pages.dev/`
- Callback de producción: `https://portal-jornadas.pages.dev/api/auth/microsoft/callback`
- Cierre de sesión: `https://portal-jornadas.pages.dev/?signed_out=1`
- Front-channel logout: `https://portal-jornadas.pages.dev/api/auth/microsoft/front-channel-logout`
- Desarrollo local: `http://localhost:8788/`
- Callback local: `http://localhost:8788/api/auth/microsoft/callback`
- Cierre local: `http://localhost:8788/?signed_out=1`

El calendario `https://calendario.camaradeceuta.workers.dev/` es una aplicación externa enlazada o incrustada, pero su código no está en este repositorio. Agenda, Reservas y el portal principal tampoco están presentes aquí y deben aplicar la misma comprobación en sus propios backends.

## 1. Crear el registro

1. Entra en **Microsoft Entra admin center → Identity → Applications → App registrations**.
2. Selecciona **New registration**.
3. Nombre recomendado: `OAP AceleraPyme - Portal Jornadas`.
4. Selecciona **Accounts in this organizational directory only**.
5. No uses una aplicación multitenant.

## 2. Configurar autenticación

1. En **Authentication → Add a platform**, elige **Web**.
2. Añade estas redirect URI:
   - `https://portal-jornadas.pages.dev/api/auth/microsoft/callback`
   - `http://localhost:8788/api/auth/microsoft/callback`
3. Configura la URL de cierre de sesión frontal:
   - `https://portal-jornadas.pages.dev/api/auth/microsoft/front-channel-logout`
4. Registra también como URI permitida de retorno:
   - `https://portal-jornadas.pages.dev/?signed_out=1`
   - `http://localhost:8788/?signed_out=1`
5. No habilites implicit grant; el proyecto utiliza código de autorización con PKCE.

## 3. Crear el secreto del backend

1. Abre **Certificates & secrets → Client secrets → New client secret**.
2. Usa una caducidad ajustada a la política de la organización.
3. Copia el **Value** inmediatamente.
4. Guárdalo únicamente como secreto cifrado `ENTRA_CLIENT_SECRET` en Cloudflare.
5. Programa una renovación antes de su caducidad.

## 4. Crear el rol de aplicación

1. Abre **App roles → Create app role**.
2. Display name: `Portal Jornadas - Acceso`.
3. Allowed member types: `Users/Groups`.
4. Value: `PortalJornadas.Access`.
5. Activa el rol.
6. En **Enterprise applications → OAP AceleraPyme - Portal Jornadas → Properties**, activa **Assignment required**.
7. En **Users and groups**, asigna usuarios o grupos al rol.

El Worker comprueba este rol si `ENTRA_REQUIRED_ROLE=PortalJornadas.Access`. Además, el usuario debe estar preautorizado en D1; ninguna de las dos capas sustituye a la otra.

## 5. Permisos mínimos

No añadas permisos de Microsoft Graph. Los scopes OIDC `openid`, `profile` y `email` son suficientes. Si la política del tenant solicita consentimiento, concede únicamente el consentimiento necesario para esos scopes y para el rol de aplicación.

## 6. Identificadores necesarios

- **Application (client) ID**: App registrations → Overview.
- **Directory (tenant) ID**: App registrations → Overview.
- **Client secret Value**: Certificates & secrets, visible solo al crearlo.

## 7. Configurar Cloudflare Pages

En **Workers & Pages → portal-jornadas → Settings → Variables and Secrets**, configura para producción:

| Variable | Tipo | Valor |
|---|---|---|
| `ENTRA_ENABLED` | Texto | `true` |
| `ENTRA_CLIENT_ID` | Texto | Application client ID |
| `ENTRA_TENANT_ID` | Texto | Directory tenant ID |
| `ENTRA_AUTHORITY` | Texto | `https://login.microsoftonline.com/TENANT_ID` |
| `ENTRA_REDIRECT_URI` | Texto | Callback de producción indicado arriba |
| `ENTRA_POST_LOGOUT_REDIRECT_URI` | Texto | `https://portal-jornadas.pages.dev/?signed_out=1` |
| `ENTRA_REQUIRED_ROLE` | Texto | `PortalJornadas.Access` |
| `LOCAL_ADMIN_LOGIN_ENABLED` | Texto | `true` durante la transición |
| `ENTRA_CLIENT_SECRET` | **Secreto cifrado** | Client secret Value |

Después de guardar las variables, vuelve a desplegar el último commit. No uses nombres `VITE_*`: esta aplicación no usa Vite y la autenticación se ejecuta en el backend.

## 8. Preparar usuarios

1. Entra con el administrador local.
2. Abre **Usuarios**.
3. Crea o edita cada usuario y añade su correo corporativo exacto.
4. Asigna `Solo Jornadas`, `Solo Podcast`, `Jornadas + Podcast` o `Administrador`.
5. En el primer acceso con Microsoft, el Worker vinculará ese registro con `tid` + `oid`.

Un usuario de Microsoft sin registro activo en D1 verá **Acceso no autorizado**, aunque pertenezca al dominio o tenga una sesión de Microsoft válida.

## 9. Recuperación y retirada del acceso antiguo

- Recuperación temporal: `https://portal-jornadas.pages.dev/?local_admin=1`.
- Con SSO activo, esta ruta solo permite cuentas D1 con rol `admin`.
- Cuando Microsoft se haya validado, cambia `LOCAL_ADMIN_LOGIN_ENABLED=false` y redespliega.
- No elimines todavía `password_hash`, `password_salt`, `login()` ni el formulario local.
- Para volver atrás, establece `ENTRA_ENABLED=false` y redespliega; las cuentas y contraseñas anteriores permanecen intactas.

## 10. Aplicaciones adicionales

Cada aplicación independiente debe tener su propio registro o configuración OIDC, su redirect URI fija y un `CURRENT_APP_CODE` no manipulable. Pueden usar el mismo tenant: la sesión existente en Microsoft hará que el salto entre aplicaciones sea automático, sin compartir contraseñas ni tokens por URL.
