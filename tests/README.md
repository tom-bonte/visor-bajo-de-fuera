# Tests — Visor Bajo de Fuera

La app **no tiene build ni dependencias**: se sirve tal cual. Estos tests viven
aparte, en esta carpeta, y no afectan a lo que se despliega en Netlify.

## Ejecutarlos

```bash
cd tests
npm install     # sólo la primera vez
npm test
```

- `npm run test:logic` — lógica de negocio. Rápido, no necesita nada instalado.
- `npm run test:rules` — reglas de seguridad contra el emulador de Firestore.
  Necesita Java.

Se ejecutan solos en cada push gracias a `.github/workflows/tests.yml`.

## Qué cubren

**`logic.test.js`** carga los ficheros REALES de la app (`config.js`, `utils.js`,
`state.js`, `firebase-service.js`) en un contexto de Node con lo mínimo del
navegador simulado — no son copias del código, es el mismo que se despliega.
Comprueba:

- el cupo diario de `INTERACTION_LOGIC.md` §0.1, incluido el corte estricto del
  15 de octubre y que los festivos no lo alteran;
- el intercambio con split del §5 Caso 2, con el ejemplo literal del spec;
- que ninguna operación crea ni pierde plazas (§0);
- cesiones, borrados y los mensajes de error al usuario.

**`rules.test.js`** levanta el emulador de Firestore y comprueba que las reglas:

- dejan hacer a la app todo lo que necesita (incluido escribir un día con los
  registros de DOS escuelas, como pasa en un intercambio);
- impiden suplantar a otra escuela al proponer o al firmar el historial;
- impiden dejar un día en un estado imposible (más de 30 plazas, centros que no
  existen, más de 8 registros…);
- no han cambiado nada para el visor de Cabo de Palos ni para la app Mangamar.

## Si un test falla

No lo "arregles" cambiando el test. Estos tests describen reglas de negocio
acordadas con la asociación y escritas en `INTERACTION_LOGIC.md`. Si el
comportamiento correcto ha cambiado de verdad, actualiza primero el spec.
