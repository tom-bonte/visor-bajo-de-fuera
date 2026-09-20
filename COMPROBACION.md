# Comprobación manual antes de dar por buena una versión

Los tests automáticos (`cd tests && npm test`) comprueban 384 cosas, pero hay
partes de la app que ningún test puede mirar: si el calendario se ve bien, si el
PDF sale derecho, si el aviso llega de verdad al grupo de WhatsApp. Esta lista
cubre justo eso.

**Se hace sobre el 31 de diciembre de 2026**, que es la fecha que usamos para
pruebas. Son unos 15 minutos. Antes de empezar, conviene tener una copia:
`node scripts/backup.js`.

---

## 1. Entrar y ver (2 min)

- [ ] La página abre sin sesión y el calendario se ve completo (modo consulta)
- [ ] Iniciar sesión como un centro: aparece su nombre arriba a la derecha
- [ ] El menú del usuario se abre y **"Cerrar sesión" se puede pulsar**
      (estuvo tapado por la barra de filtros en septiembre de 2026)
- [ ] Cambiar de mes con las flechas, y de año con las flechas del año
- [ ] El cupo del día es correcto: 30 plazas en julio, 13 en enero

## 2. Plazas (5 min)

Cada una de estas debe reflejarse en el calendario en uno o dos segundos:

- [ ] **Añadir** plazas en el 31/12/2026
- [ ] **Editar** ese número (el aviso de WhatsApp nombra TU escuela, no
      "Centro desconocido")
- [ ] **Mover** plazas a otro día arrastrando
- [ ] **Ceder** plazas a otra escuela
- [ ] **Eliminar** la salida
- [ ] Intentar poner más plazas de las que caben: lo impide y explica por qué

## 3. Entre dos escuelas (4 min)

Hacen falta dos navegadores (uno normal y uno en ventana privada):

- [ ] Escuela A **propone un intercambio** a la escuela B
- [ ] A B le aparece la notificación (campana)
- [ ] B **acepta**: las plazas cambian de sitio en los dos días
- [ ] El total de plazas de esos dos días **no ha cambiado**
- [ ] Repetir y que B **rechace**: todo vuelve a quedar como estaba
- [ ] A **retira** una propuesta suya

## 4. La puerta cerrada (1 min)

Con la consola del navegador abierta (⌘+Option+J), como una escuela:

```javascript
db.collection('bdf_days').doc('2026-12-31').set({ salidas: [] }, { merge: true });
```

- [ ] Falla con `Missing or insufficient permissions`

Si esto **no** falla, las reglas de Firestore no están publicadas. Es lo primero
que hay que arreglar: significa que cualquier escuela puede borrar las plazas de
las demás.

## 5. Papeles y avisos (2 min)

- [ ] Exportar a **PDF**: se descarga y se ve bien
- [ ] Exportar a **CSV**: se descarga y se abre en Excel/Numbers
- [ ] **Imprimir** (botón de la impresora): la vista previa sale completa
- [ ] Un cambio real hecho por un centro **llega al grupo de WhatsApp**
- [ ] La pestaña de **Historial** muestra lo que acabas de hacer
- [ ] La pestaña de **Estadísticas** cuadra con el calendario

## 6. Como administrador (1 min)

- [ ] Entrar como admin y **cambiar el cupo** de un día
- [ ] **Importar el cuadrante CSV**: la vista previa dice qué años va a tocar
- [ ] Cambiar una salida **de centro** (sólo el admin puede)

## 7. Sin conexión (1 min)

- [ ] Poner el móvil/ordenador en modo avión y abrir la app: el calendario se
      sigue viendo (viene guardado)
- [ ] Intentar cambiar algo: avisa de que no hay conexión y **no** dice que se
      haya guardado
- [ ] Al volver la conexión, todo sigue coherente

---

## Si algo falla

1. No sigas tocando: apunta **qué hiciste y qué salió**, con captura si puedes.
2. La copia de la noche anterior está en GitHub → *Actions* → *copia de
   seguridad diaria* → *Artifacts*.
3. Restaurar un solo día:
   `node scripts/restore.js <copia>.json --only=2026-12-31 --apply`
