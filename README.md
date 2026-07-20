# OAP 2026 · Gestión de Jornadas

Aplicación web independiente para gestionar las jornadas de la Oficina Acelera Pyme. El proyecto no modifica ni sincroniza el Excel original.

La aplicación se entrega limpia, sin jornadas, contactos, partidas presupuestarias, facturas ni credenciales precargadas. En el primer acceso se crea el usuario administrador y la contraseña local.

## Funciones incluidas

- Resumen anual con presupuesto, ejecución, saldo, jornadas y tareas pendientes.
- Alta, edición y eliminación de jornadas.
- Ubicación manual por jornada, incluyendo direcciones o enlaces de reunión.
- Detección automática del trimestre según el mes y señal visual diferenciada.
- Control automático de presupuesto máximo, gastos ejecutados y saldo disponible.
- Detalle de gastos por descripción, proveedor, importe y observaciones.
- Facturas PDF asociadas a cada jornada mediante selección manual o arrastre.
- Apertura de facturas en una pestaña nueva, descarga individual y eliminación.
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

## Cómo abrirlo

La opción más sencilla es abrir `index.html` en un navegador moderno.

Para servirlo localmente desde esta carpeta:

```powershell
python -m http.server 8080
```

Después abre `http://localhost:8080`.

## Acceso

No existe registro público. El administrador inicial se crea directamente en Cloudflare D1 y, desde la sección `Usuarios`, puede generar las demás cuentas autorizadas. Las contraseñas se almacenan mediante PBKDF2 con sal aleatoria y las sesiones se gestionan en el servidor.

## Persistencia

Los cambios se guardan en `localStorage`, dentro del navegador y equipo donde se utiliza. Para compartir datos entre varios usuarios hará falta añadir un backend, una base de datos y autenticación antes del despliegue definitivo.

Los PDF se guardan como archivos binarios en `IndexedDB`, dentro del mismo navegador. No se incluyen en la copia JSON: deben descargarse individualmente desde la jornada. Borrar los datos del sitio o cambiar de navegador elimina este almacenamiento local. Para producción será necesario usar almacenamiento privado de servidor o de objetos.

## Integración futura en el portal

El proyecto puede publicarse como una web independiente y enlazarse desde una nueva tarjeta del portal. No es necesario incrustarlo: la tarjeta puede abrir la URL publicada en una pestaña nueva.

## Privacidad

Los teléfonos y correos se muestran enmascarados por defecto. La exportación CSV solo incluye jornadas y no incluye contactos.
