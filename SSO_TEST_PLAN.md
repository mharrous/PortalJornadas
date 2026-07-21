# Plan de pruebas de Microsoft SSO

## Preparación

1. Aplicar `migration-entra-sso.sql` en D1.
2. Configurar Entra y Cloudflare según `MICROSOFT_ENTRA_SETUP.md`.
3. Crear tres cuentas D1 con correo: usuario autorizado, usuario desactivado y administrador.
4. Asignar el rol `PortalJornadas.Access` solo a las cuentas que deban acceder.

## Casos obligatorios

1. Sin sesión: abrir `/` y verificar redirección automática a Microsoft.
2. Inicio correcto: comprobar regreso al portal sin token ni contraseña en la URL.
3. Usuario autorizado: comprobar acceso al módulo asignado.
4. URL directa: abrir el portal en una pestaña nueva y comprobar SSO silencioso.
5. Sin permiso D1: verificar pantalla **Acceso no autorizado**.
6. Usuario desactivado: verificar denegación aunque Microsoft autentique correctamente.
7. Cerrar sesión: verificar borrado de la cookie local y redirección al logout de Microsoft.
8. Sesión caducada: borrar o caducar la fila en `sessions` y comprobar nueva autenticación.
9. Error Microsoft: cancelar el consentimiento y comprobar mensaje comprensible.
10. Permiso retirado: desactivar usuario o cambiar módulos, verificar cierre inmediato de sus sesiones.
11. Varias pestañas: abrir Jornadas y Podcast y comprobar la misma sesión local.
12. Otro tenant: verificar rechazo por `tid` e `issuer`.
13. D1 no disponible: comprobar respuesta controlada sin conceder acceso.
14. Manipular `returnTo`: probar una URL externa y verificar retorno a `/`.
15. Manipular rol o módulos en JavaScript: comprobar que las API siguen devolviendo `403`.
16. Reutilizar callback: repetir el mismo `state` y comprobar rechazo por estado consumido.
17. Cambiar correo de una cuenta vinculada: comprobar que continúa usándose `tid` + `oid`.
18. Desvincular Microsoft desde Usuarios: comprobar cierre de sesiones y nueva vinculación controlada.

## Regresión del acceso anterior

1. Con `ENTRA_ENABLED=false`, comprobar login local normal.
2. Con SSO activo y `LOCAL_ADMIN_LOGIN_ENABLED=true`, comprobar `/?local_admin=1` con administrador.
3. Verificar que un usuario local no administrador no puede usar la recuperación cuando SSO está activo.
4. Con `LOCAL_ADMIN_LOGIN_ENABLED=false`, comprobar que la recuperación local queda bloqueada.
