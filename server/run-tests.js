/* =========================================================
 * Lance tous les tests (server/tests/*.test.js) — sans dépendance.
 *   node run-tests.js            (ou double-clic sur LANCER_TESTS.bat)
 * ========================================================= */
const fs = require('fs');
const path = require('path');
const util = require('util');

const tests = []; let suite = '';
const describe = (name, fn) => { suite = name; fn(); };
const it = (name, fn) => tests.push({ suite, name, fn });
const show = v => util.inspect(v, { depth: 4 });
const expect = actual => ({
  toBe: e => { if (!(actual === e || Object.is(actual, e))) throw new Error(`attendu ${show(e)}, reçu ${show(actual)}`); },
  toEqual: e => { if (show(actual) !== show(e)) throw new Error(`attendu ${show(e)}, reçu ${show(actual)}`); },
  toBeGreaterThan: e => { if (!(actual > e)) throw new Error(`attendu > ${show(e)}, reçu ${show(actual)}`); },
});
const T = { describe, it, expect };

fs.readdirSync(path.join(__dirname, 'tests')).filter(f => f.endsWith('.test.js')).sort()
  .forEach(f => require(path.join(__dirname, 'tests', f))(T));

(async () => {
  const filter = process.argv[2] || '';
  let ok = 0; const failed = [];
  const t0 = Date.now();
  for (const t of tests.filter(t => `${t.suite} ${t.name}`.includes(filter))) {
    try { await t.fn(); ok++; } catch (e) { failed.push(t); console.log(`❌ ${t.suite} › ${t.name}\n   ${e.message}`); }
  }
  const n = ok + failed.length;
  console.log(failed.length ? `\n${failed.length} test(s) en échec sur ${n}.` : `\n✅ ${n}/${n} tests réussis (${Date.now() - t0} ms).`);
  process.exitCode = failed.length ? 1 : 0;
})();
