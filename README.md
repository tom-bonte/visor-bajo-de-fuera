# Visor Bajo de Fuera - Reserva Marina Cabo de Palos

Sistema interactivo de gestión de plazas y calendario oficial para el Bajo de Fuera (Reserva Marina de Cabo de Palos - Islas Hormigas).

---

## 📌 Características Principales

1. **Gestión Diaria por Cupos**:
   - Junio a Septiembre: 30 plazas diarias.
   - 1 al 15 de Octubre: 30 plazas los fines de semana (sábados y domingos); 13 plazas de lunes a viernes.
   - Resto del año: 13 plazas diarias.
   - Bloques visuales de hasta 12 buceadores por boya/barco.

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
