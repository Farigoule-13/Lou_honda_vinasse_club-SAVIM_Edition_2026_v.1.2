/* =========================================================
 * Démarrage du serveur de l'hôte.
 *   node server.js            → le vrai salon (données dans server/data)
 *   node server.js --test     → MODE TEST (données dans server/data-test, outils /test)
 *   node server.js --open     → ouvre aussi la bonne page dans le navigateur
 * Variables : PORT (3000 par défaut), LHVC_ADMIN_PIN
 * ========================================================= */
const path = require('path');
const { exec } = require('child_process');
const { createApp, VERSION } = require('./app');

const TEST = process.argv.includes('--test');
const OPEN = process.argv.includes('--open');
const PORT = Number(process.env.PORT) || 3000;
const DATA = path.join(__dirname, TEST ? 'data-test' : 'data');
const app = createApp({ dataDir: DATA, test: TEST, port: PORT });

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"`
    : process.env.PREFIX?.includes('com.termux') ? `termux-open-url "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

process.on('uncaughtException', e => console.error('⚠️  Erreur inattendue (le serveur continue) :', e));
process.on('unhandledRejection', e => console.error('⚠️  Erreur inattendue (le serveur continue) :', e));

app.server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n❌ Le port ${PORT} est déjà utilisé : le serveur tourne sans doute déjà dans une autre fenêtre.\n`);
  else console.error('❌', e);
  process.exit(1);
});

app.server.listen(PORT, '0.0.0.0', () => {
  const i = app.info();
  console.log(`\n🍷  Lou Honda Vinasse Club · SAVIM Edition v${VERSION}${TEST ? '   🧪 MODE TEST' : ''}\n`);
  if (TEST) {
    console.log(`   🧪 Page de test (sur ce PC)  : http://localhost:${PORT}/test`);
    console.log(`   📱 Appli pour le téléphone   : ${i.appUrl}`);
    console.log(`      (le téléphone doit être sur le MÊME Wi-Fi que ce PC)`);
    console.log(`   🔐 Code animateur            : ${app.adminPin()}`);
  } else {
    console.log(`   🔐 Code animateur    : ${app.adminPin()}   (à garder pour toi ; modifiable dans l'écran de l'hôte → Réglages)`);
    console.log(`   📱 Écran de l'hôte   : http://localhost:${PORT}/hote   (QR codes à montrer)`);
    console.log(`   🥂 Appli du salon    : ${i.appUrl}`);
    console.log(`   🏆 Résultats         : http://localhost:${PORT}/resultats`);
  }
  if (i.hosts.length > 1) console.log(`      autres adresses : ${i.hosts.filter(h => h.ip !== i.host).map(h => h.ip + (h.hint ? ` (${h.hint})` : '')).join(', ')}`);
  if (i.host === 'localhost') console.log('   ⚠️  Aucune adresse réseau trouvée : saisis-la dans l\'écran de l\'hôte → ⚙️ Réglages.');
  console.log(`   💾 Données           : ${DATA}   (copies automatiques dans « sauvegardes »)\n`);
  for (const a of i.alerts) console.log(`   ${a.level === 'error' ? '❌' : '⚠️ '} ${a.message}\n`);
  console.log('   Laisse cette fenêtre ouverte. Ctrl+C pour arrêter : tout est sauvegardé à chaque note reçue.\n');
  if (OPEN) setTimeout(() => openBrowser(`http://localhost:${PORT}${TEST ? '/test' : '/hote'}`), 600);
});
