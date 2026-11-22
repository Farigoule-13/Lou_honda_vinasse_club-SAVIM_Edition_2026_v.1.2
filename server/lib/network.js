/* =========================================================
 * NETWORK — Adresses IP du PC sur le réseau local, pour
 * fabriquer l'adresse mise dans les QR codes.
 * ========================================================= */
const os = require('os');
const { execFileSync } = require('child_process');

const HOTSPOT_IP = '192.168.137.1';   // adresse fixe du point d'accès mobile de Windows

/* Points d'accès de téléphone : Android (anciens : 192.168.43.1 ; récents : 192.168.x.x tiré au hasard,
   carte « ap0 », « swlan0 », « wlan1 »…) et iPhone (172.20.10.1). */
const isPhoneHotspot = i => i.ip === '192.168.43.1' || i.ip === '172.20.10.1' || /^(ap|swlan|softap|wlan[1-9])/i.test(i.name || '');

/* Android 11 et plus (Termux) interdit à Node de lister les cartes réseau.
   Repli : les commandes « ifconfig » ou « ip », souvent encore autorisées. */
function parseIfconfig(txt) {
  const out = [];
  let name = '';
  String(txt).split('\n').forEach(line => {
    const h = line.match(/^(\S+?):?\s/);
    if (h && !/^\s/.test(line)) name = h[1];
    const m = line.match(/inet (?:addr:)?(\d+\.\d+\.\d+\.\d+)/);
    if (m && !m[1].startsWith('127.')) out.push({ ip: m[1], name });
  });
  return out;
}
function parseIpAddr(txt) {
  return String(txt).split('\n').map(l => l.match(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/))
    .filter(Boolean).map(m => ({ ip: m[2], name: m[1] })).filter(i => !i.ip.startsWith('127.'));
}
function fromCommands(run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })) {
  for (const [cmd, args, parse] of [['ifconfig', [], parseIfconfig], ['ip', ['-4', '-o', 'addr'], parseIpAddr]]) {
    try { const list = parse(run(cmd, args)); if (list.length) return list; } catch { /* commande absente ou refusée */ }
  }
  return [];
}
const withHint = i => ({ ...i, hint: i.ip === HOTSPOT_IP ? "point d'accès Windows" : isPhoneHotspot(i) ? "point d'accès du téléphone" : '' });

function lanInterfaces() {
  let all;
  try { all = os.networkInterfaces(); }          // Android (Termux) peut refuser : on essaie les commandes système
  catch { return process.platform === 'win32' ? [] : fromCommands().map(withHint); }
  const list = Object.entries(all)
    .flatMap(([name, list]) => (list || []).map(i => ({ ...i, name })))
    .filter(i => (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map(i => withHint({ ip: i.address, name: i.name }));
  return list.length || process.platform === 'win32' ? list : fromCommands().map(withHint);
}

/* Choix par défaut : réglage manuel > point d'accès Windows > point d'accès d'un téléphone > box (192.168.x) > le reste */
function pickHost(settings, interfaces = lanInterfaces()) {
  if (settings.publicHost) return settings.publicHost;
  const score = i => (i.ip === HOTSPOT_IP ? 5 : isPhoneHotspot(i) ? 4 : i.ip.startsWith('192.168.') ? 3 : i.ip.startsWith('10.') ? 2 : 0);
  const best = [...interfaces].sort((a, b) => score(b) - score(a))[0];
  return best ? best.ip : 'localhost';
}

module.exports = { lanInterfaces, pickHost, HOTSPOT_IP, parseIfconfig, parseIpAddr, fromCommands };
