# Prompt reutilizable

Quiero crear una aplicación web independiente para gestionar las acciones de sensibilización de la Oficina Acelera Pyme 2026 de la Cámara de Comercio de Ceuta, sustituyendo el trabajo operativo que actualmente se realiza en un Excel, pero sin modificar ni sincronizar el archivo original.

La aplicación debe incluir:

- Un login obligatorio. En la versión local, el usuario crea la contraseña en el primer acceso; no debe guardarse en texto plano, sino como una clave derivada con sal. La sesión debe poder cerrarse mediante un botón `Salir`.
- Un diseño institucional de la Cámara de Comercio de Ceuta en rojo y amarillo. Todas las superficies, botones, tarjetas y fondos deben usar degradados suaves; no utilizar colores de fondo sólidos.
- Un selector de apariencia accesible desde la cabecera. El usuario debe poder elegir entre varias paletas completas, la elección debe aplicarse inmediatamente a toda la interfaz y conservarse en el navegador.
- Un panel resumen con presupuesto anual, importe ejecutado, saldo disponible, número de jornadas, tareas pendientes, próximos eventos y alertas de exceso presupuestario.
- Gestión completa de jornadas: crear, editar y eliminar; fecha, título, formato, temática, ponente, horario, ubicación manual, presupuesto máximo, periodo y notas.
- La ubicación debe poder escribirse manualmente y admitir una dirección física o un enlace de reunión online.
- Detección automática del trimestre según la fecha: enero-marzo, abril-junio, julio-septiembre y octubre-diciembre.
- Cada jornada debe mostrar un recuadro con un degradado suave diferente según el trimestre detectado automáticamente.
- Gestión de gastos por jornada con descripción, proveedor, importe y observaciones. El ejecutado y el saldo deben calcularse automáticamente.
- Un apartado de facturas dentro de cada jornada. Debe admitir varios PDF mediante arrastre o selección manual, guardarlos asociados a la jornada, mostrar nombre, tamaño y fecha, permitir descargarlos y abrirlos en una pestaña nueva fuera de la interfaz. En la versión local, almacenar los binarios en IndexedDB y los metadatos en la jornada.
- Checklist por jornada con estados Pendiente, En curso y OK.
- Control presupuestario por periodos, partidas y jornadas.
- Agenda de contactos con búsqueda, alta, edición y eliminación. Teléfonos y correos deben aparecer enmascarados por defecto.
- Persistencia local mediante `localStorage`, exportación de copia completa en JSON, restauración desde JSON y exportación de jornadas en CSV sin incluir contactos.
- Diseño responsive para ordenador, tableta y móvil.
- El proyecto debe ser HTML, CSS y JavaScript puro, sin dependencias externas, para poder abrirse directamente o publicarse como web estática.

La solución debe quedar preparada para que, en una fase posterior, pueda publicarse en una URL y añadirse como una tarjeta nueva dentro de un portal existente. No modificar el portal durante esta fase.
