/** Mini-runner sin dependencias: nada de Jest ni frameworks. */
let pass = 0, fail = 0;
const lines = [];

function section(title) { lines.push('\n' + title); }

function check(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    lines.push(ok ? `  ✓ ${label}` : `  ✗ ${label}\n      esperado: ${JSON.stringify(want)}\n      obtenido: ${JSON.stringify(got)}`);
    ok ? pass++ : fail++;
}

function ok(label, value) { check(label, !!value, true); }

function report(title) {
    console.log(`\n${title}`);
    console.log(lines.join('\n'));
    console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} correctas, ${fail} fallidas\n`);
    return fail === 0 ? 0 : 1;
}

module.exports = { section, check, ok, report };
