# Visor Bajo de Fuera

Sistema de gestión y calendario de plazas para el bajo de fuera en la Reserva Marina de Cabo de Palos - Islas Hormigas.

---

## 📌 Contexto y Reglas del Proyecto

Este visor es una aplicación web independiente (al estilo de **Visor Reserva Interior** y **Visor Cabo Tiñoso / La Azohía**) adaptada a la normativa y operativa específica de **Bajo de Fuera**.

### 1. Modelo Operativo
- **Sin franjas horarias estrictas**: Las salidas se gestionan a nivel de **Día y Centro** (no hay cuadrante 09:00, 10:30, 12:00, etc.).
- **Cupo diario fijo**: Asignado por reparto/sorteo oficial (aprox. 30 plazas/día repartidas en bloques como 8, 8, 8, 6).
- **Capacidad por barco**: Hasta 11–12 buceadores máximo por barco en boya.
- **Días independientes y autocontenidos**: Si hay mal tiempo o no se sale, las plazas de ese día finalizan (no hay traspaso de plazas entre días).

### 2. Centros y Entidades Participantes
- **Balky**
- **Divers Cabo de Palos**
- **Islas Hormigas**
- **Mangamar**
- **Naranjito**
- **Planeta Azul**
- **X** (X La Manga)
- **Clubes** (Club)

### 3. Operaciones de Plazas
1. **Cesión Directa**: El Centro A transfiere X plazas al Centro B en esa fecha.
2. **Liberar Plazas**: El Centro A libera X plazas al pool de "Plazas Libres" del día si no llena el barco.
3. **Coger Plazas Libres**: Cualquier centro autorizado puede coger plazas disponibles del pool libre (para ampliar su salida hasta 11-12 o añadir salida).
4. **Notificación Instantánea**: Cada cesión, liberación o reserva dispara un webhook a Make.com para notificar automáticamente al grupo de WhatsApp de Bajo de Fuera.

---

## 📂 Estructura de Referencia
En la carpeta `reference/visor-reserva/` (ignorada en git mediante .gitignore) se encuentra una copia de solo lectura del visor de la Reserva Interior para reutilizar:
- Diseño visual, tipografía Inter y paleta de colores de los centros.
- Sistema de login por PIN y modal de selección de centro.
- Conexión a Firebase Firestore en tiempo real (onSnapshot).
- Estilos de modales, alertas toast y componentes responsive.

> ⚠️ **IMPORTANTE**: La carpeta `reference/` es únicamente de consulta/lectura. Todos los archivos nuevos deben crearse en la raíz del proyecto visor-bajo-de-fuera.
