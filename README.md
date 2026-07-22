# OAP AceleraPyme

El acceso desde `portal.camaraceuta.workers.dev` utiliza un código de un solo uso vinculado a `gestion-jornadas`. La aplicación crea su propia sesión y vuelve a comprobar en la D1 central que el usuario continúa activo y autorizado. La entrada directa sin sesión mantiene el login de Jornadas.

Aplicación web independiente para gestionar las jornadas de la Oficina Acelera Pyme. El proyecto no modifica ni sincroniza el Excel original.

El acceso es cerrado: únicamente un administrador puede crear usuarios y asignarles los módulos disponibles.

## Funciones incluidas

- Resumen anual con presupuesto, ejecución, saldo, jornadas y tareas pendientes.
- Alta, edición y eliminación de jornadas.
- Ubicación manual por jornada, incluyendo direcciones o enlaces de reunión.
- Detección automática del trimestre según el mes y señal visual diferenciada.
- Control automático de presupuesto máximo, gastos ejecutados y saldo disponible.
- Presupuesto anual editable y suma automática del gasto ejecutado por trimestre.
- Detalle de gastos por descripción, proveedor, importe y observaciones.
- Gastos base predefinidos al crear una jornada: Sonido, Espacio, Merchandising y Ponente.
- Recuperación automática sin duplicados de las jornadas incluidas en el CSV del 21/07/2026.
- Facturas PDF asociadas a cada jornada mediante selección manual o arrastre.
- Apertura de facturas en una pestaña nueva, descarga individual y eliminación.
- Datos de Jornadas compartidos entre usuarios mediante Cloudflare D1.
- Facturas privadas compartidas mediante Cloudflare R2.
- Checklist operativo por jornada.
- Presupuesto por periodos y partidas.
- Agenda de contactos con vista privada activada por defecto.
- Filtros y búsqueda.
- Exportación de jornadas a CSV.
- Copia completa y restauración mediante JSON.
- Diseño adaptable a ordenador, tableta y móvil.
- Diseño institucional rojo y amarillo basado exclusivamente en degradados suaves.
- Selector de tema con cinco paletas: Cámara, Océano, Bosque, Violeta y Grafito.
- Login cerrado con usuarios almacenados en Cloudflare D1.
- Sesiones seguras mediante cookie `HttpOnly`, `Secure` y `SameSite=Strict`.
- Panel exclusivo para administradores con alta, baja, activación y cambio de contraseña de usuarios.
- Perfiles de acceso: Solo Jornadas, Solo Podcast, Jornadas + Podcast y Administrador.
- Módulo Podcast compartido con control de episodios, calendario editorial, indicadores y cancelados.
- Microsoft Entra ID preparado mediante OpenID Connect, Authorization Code Flow y PKCE en el Worker.
- Vinculación cerrada por correo preautorizado y por el identificador estable `tid` + `oid`.

## Cómo abrirlo

La autenticación necesita el Worker y D1. Para desarrollo local, copia `.dev.vars.example` como `.dev.vars`, completa los valores y ejecuta:

```powershell
npx wrangler pages dev . --port 8788 --d1 AUTH_DB=615aa0b9-320e-4cca-87f8-9ec9801816bb
```

Después abre `http://localhost:8788`. No guardes `.dev.vars` en Git.

## Acceso

No existe registro público. El administrador inicial se crea directamente en Cloudflare D1 y, desde la sección `Usuarios`, puede generar las demás cuentas autorizadas. Las contraseñas se almacenan mediante PBKDF2 con sal aleatoria y las sesiones se gestionan en el servidor.

La integración Microsoft SSO permanece desactivada hasta configurar las variables de Cloudflare. Consulta `MICROSOFT_ENTRA_SETUP.md`. Al activarla, Microsoft autentica la identidad y D1 conserva la autorización por usuario y módulo. El login local puede mantenerse temporalmente solo para administradores mediante `LOCAL_ADMIN_LOGIN_ENABLED=true`.

Aplica las migraciones antes de desplegar:

```powershell
npx wrangler d1 execute portal-jornadas-auth --remote --file migration-entra-sso.sql
npx wrangler d1 execute portal-jornadas-auth --remote --file migration-shared-jornadas.sql
```

La cuenta de Cloudflare debe tener R2 activado y el bucket privado `portal-jornadas-facturas` creado. El binding `INVOICE_FILES` ya está definido en `wrangler.jsonc`.

## Persistencia

Los datos de Jornadas, los usuarios, las sesiones y Podcast se guardan en Cloudflare D1 para compartirlos entre las cuentas autorizadas. El navegador conserva una copia local de respaldo y sus preferencias personales de tema y privacidad.

Los PDF se guardan de forma privada en Cloudflare R2 y sus metadatos en D1. Solo se sirven desde rutas autenticadas de la aplicación, por lo que abrir o descargar una factura exige una sesión autorizada para Jornadas. No se incluyen en la copia JSON: deben descargarse individualmente desde la jornada.

Tras el primer despliegue, un administrador debe abrir `Datos y copias de seguridad` desde el navegador que tenga la copia local correcta y pulsar una sola vez `Publicar copia local`. La operación también migra las facturas antiguas almacenadas en IndexedDB.

## Integración futura en el portal

El proyecto puede publicarse como una web independiente y enlazarse desde una nueva tarjeta del portal. No es necesario incrustarlo: la tarjeta puede abrir la URL publicada en una pestaña nueva.

## Privacidad

Los teléfonos y correos se muestran enmascarados por defecto. La exportación CSV solo incluye jornadas y no incluye contactos.
