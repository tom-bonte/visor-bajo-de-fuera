# Visor Bajo de Fuera - Reserva Marina Cabo de Palos

Sistema interactivo de gestión de plazas y calendario oficial para el Bajo de Fuera (Reserva Marina de Cabo de Palos - Islas Hormigas).

---

## 📌 Características Principales

1. **Gestión Diaria por Cupos**:
   - Junio a Septiembre: 30 plazas diarias.
   - 1 al 15 de Octubre: 30 plazas los fines de semana (sábados y domingos); 13 plazas de lunes a viernes.
   - Resto del año: 13 plazas diarias.

2. **Intercambios y Cesiones de Plazas**:
   - **Cesión Directa**: Transferencia inmediata de plazas en un solo paso hacia otra escuela.
   - **Petición de Plazas**: Propuesta entre escuelas para solicitar plazas en una salida existente.
   - **Intercambio (Swap)**: Arrastre interactivo de barcos entre días con soporte de compensación de plazas.
   - **Bloqueo Visual con Reloj de Arena (⏳)**: Protege las salidas comprometidas en propuestas pendientes.
   - **Gestión / Retirada**: Los centros iniciadores y administradores pueden retirar o rechazar solicitudes en cualquier momento con un clic.

3. **Roles y Autenticación**:
   - Acceso para escuelas asociadas (Mangamar, Moondive, Divers, Naranjito, Planeta Azul, Islas Hormigas, X La Manga, Club).
   - Modo Administrador (Root) para control total, edición forzada y vaciado de datos.
   - Modo Consulta para usuarios sin credenciales.

4. **Herramientas de Exportación y Administración**:
   - Generación de PDF vectorial y exportación a CSV.
   - Sincronización en tiempo real con Cloud Firestore.

---

## 🚀 Despliegue en Netlify

El proyecto está configurado con [`netlify.toml`](./netlify.toml) para despliegue estático continuo sin pasos de compilación.

---

## 💾 Copias de seguridad

Todas las noches, a las 03:15 UTC, GitHub Actions ejecuta
[`scripts/backup.js`](./scripts/backup.js) y guarda una copia completa de
`bdf_days` y `bdf_history_logs` como *artefacto* del repositorio, con 90 días de
retención. No hace falta ninguna contraseña: esas dos colecciones son de lectura
pública (es lo que permite el modo consulta), así que la copia usa la misma clave
pública que ya viaja en `config.js`.

**Descargar una copia**: pestaña *Actions* → *copia de seguridad diaria* → la
ejecución del día → *Artifacts*. También se puede lanzar a mano con *Run workflow*.

**Hacer una copia ahora, en local**:

```bash
node scripts/backup.js
```

**Restaurar** (simulacro por defecto; no escribe nada hasta añadir `--apply`):

```bash
node scripts/restore.js backups/bdf-backup-2026-09-20T1544Z.json --only=2026-12-31
node scripts/restore.js backups/bdf-backup-2026-09-20T1544Z.json --only=2026-12-31 --apply
```

Restaurar `bdf_days` funciona con la cuenta de cualquier centro. El historial
(`bdf_history_logs`) es inmutable por reglas, así que sólo se puede restaurar con
la cuenta de administrador.

Cada copia lleva fecha **y hora** en el nombre, y el script se niega a
sobrescribir una copia que ya existe. Esto no es un capricho: en el primer
simulacro real, una segunda copia del mismo día pisó a la de por la mañana —
justo la buena— y la restauración devolvió el estado ya estropeado.

⚠️ Conviene repetir el simulacro de restauración una vez por temporada: una copia
que nunca se ha probado a restaurar no es una copia de seguridad, es un fichero.
Además, GitHub desactiva las tareas programadas si el repositorio pasa 60 días sin
actividad; si eso ocurre, basta con volver a activarla desde *Actions*.

---

## 🚨 Avisos de fallos (Sentry)

`error-reporter.js` es el primer script de la página. Recoge cualquier fallo del
navegador —errores sueltos, promesas rechazadas y los que la app ya capturaba y
sólo escribía en la consola— desde el primer instante de la carga.

Con `SENTRY_DSN` vacío en `config.js` (estado por defecto) **no se descarga nada
de fuera**: los fallos sólo se ven en la consola del navegador. Para activar los
avisos:

1. Crear una cuenta gratuita en [sentry.io](https://sentry.io) y un proyecto de
   tipo **Browser → JavaScript**.
2. Copiar el DSN que da Sentry (empieza por `https://…@…ingest.sentry.io/…`).
3. Pegarlo en `SENTRY_DSN` en `config.js` y desplegar.

El DSN es público por diseño: viaja en el navegador de todas las escuelas y no
es una contraseña. Aun así, antes de enviar nada se limpia el informe
(`scrub()`): se recorta la URL, se quita el usuario y se tapan los correos.
Desde `localhost` nunca se envía nada.
