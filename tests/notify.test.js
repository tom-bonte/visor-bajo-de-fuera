/**
 * Tests del proxy de avisos (netlify/functions/notify.js).
 * No despliega nada: se llama al handler directamente con peticiones simuladas
 * y se sustituye fetch para no tocar ni Google ni Make.com.
 */
const path = require('path');
const { section, check, ok, report } = require('./assert.js');

const handler = require(path.join(__dirname, '..', 'netlify', 'functions', 'notify.js')).handler;

const realFetch = global.fetch;
let fetchCalls = [];

/** Sustituye fetch: 1ª llamada = verificación del token, 2ª = reenvío a Make. */
function stubFetch({ verifyOk = true, email = 'mangamar@visor.local', makeOk = true, throwOn = null }) {
    fetchCalls = [];
    global.fetch = async (url, opts) => {
        fetchCalls.push({ url, opts });
        if (throwOn && String(url).includes(throwOn)) throw new Error('boom');
        if (String(url).includes('identitytoolkit')) {
            return { ok: verifyOk, json: async () => ({ users: email ? [{ email }] : [] }) };
        }
        return { ok: makeOk, status: makeOk ? 200 : 500 };
    };
}

const req = (over = {}) => ({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token-valido' },
    body: JSON.stringify({ message: 'AVISO: Mangamar añadió 4 plazas' }),
    ...over
});

(async () => {
    process.env.MAKE_WEBHOOK_URL = 'https://hook.example/test';

    section('Quién puede publicar en el grupo de WhatsApp');

    stubFetch({});
    let r = await handler(req());
    check('centro con sesión válida → se envía', r.statusCode, 200);
    ok('el mensaje llega a Make.com', fetchCalls.some(c => c.url === 'https://hook.example/test'));
    ok('se reenvía con el mismo formato que antes', fetchCalls.at(-1).opts.headers['Content-Type'] === 'text/plain');

    stubFetch({});
    r = await handler(req({ headers: {} }));
    check('sin token → 401', r.statusCode, 401);
    ok('ni siquiera se contacta con Make.com', fetchCalls.length === 0);

    stubFetch({ verifyOk: false });
    r = await handler(req({ headers: { authorization: 'Bearer token-falso' } }));
    check('token inválido → 401', r.statusCode, 401);
    ok('tampoco se contacta con Make.com', !fetchCalls.some(c => c.url.includes('hook.example')));

    stubFetch({ email: 'alguien@gmail.com' });
    r = await handler(req());
    check('cuenta ajena a la asociación → 403', r.statusCode, 403);
    ok('no se reenvía nada', !fetchCalls.some(c => c.url.includes('hook.example')));

    section('Peticiones malformadas o abusivas');

    stubFetch({});
    check('GET → 405', (await handler(req({ httpMethod: 'GET' }))).statusCode, 405);
    check('JSON roto → 400', (await handler(req({ body: '{no json' }))).statusCode, 400);
    check('mensaje vacío → 400', (await handler(req({ body: JSON.stringify({ message: '   ' }) }))).statusCode, 400);
    check('mensaje de 5000 caracteres → 413', (await handler(req({ body: JSON.stringify({ message: 'x'.repeat(5000) }) }))).statusCode, 413);

    section('Configuración y fallos del servicio');

    delete process.env.MAKE_WEBHOOK_URL;
    stubFetch({});
    r = await handler(req());
    check('sin MAKE_WEBHOOK_URL → 500', r.statusCode, 500);
    ok('el error no revela la configuración interna', !JSON.stringify(r.body).includes('MAKE_WEBHOOK_URL'));
    ok('la apiKey pública no se registra como variable de entorno', process.env.FIREBASE_API_KEY === undefined);
    process.env.MAKE_WEBHOOK_URL = 'https://hook.example/test';

    stubFetch({ makeOk: false });
    check('si Make.com falla → 502', (await handler(req())).statusCode, 502);

    stubFetch({ throwOn: 'identitytoolkit' });
    check('si Google no responde → 502', (await handler(req())).statusCode, 502);

    ok('la URL del webhook nunca aparece en la respuesta',
        !JSON.stringify((await (async () => { stubFetch({}); return handler(req()); })())).includes('hook.example'));

    global.fetch = realFetch;
    process.exit(report('PROXY DE AVISOS — netlify/functions/notify.js'));
})().catch(e => { console.error(e); process.exit(2); });
