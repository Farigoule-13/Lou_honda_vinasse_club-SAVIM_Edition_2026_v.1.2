/* =========================================================
 * LOU HONDA VINASSE CLUB — SAVIM EDITION
 * Serveur de l'hôte (téléphone Android sous Termux, ou PC).
 * Aucune dépendance : seul Node.js (18 ou plus) est nécessaire.
 *
 *   createApp({ dataDir, test, pin }) → { server, salon, ... }
 * Le démarrage (port, messages, ouverture du navigateur) est dans server.js.
 * ========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createSalon } = require('./lib/salon');
const { createJsonFile } = require('./lib/file-storage');
const { createTestTools } = require('./lib/testmode');
const net = require('./lib/network');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return '?'; } })();
const DB = require(path.join(PUBLIC, 'salon/data/exposants.js'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function wifiQrText({ wifiSsid, wifiPassword, wifiSecurity }) {
  if (!wifiSsid) return null;
  const e = s => String(s).replace(/([\\;,:"])/g, '\\$1');
  return wifiSecurity === 'nopass' ? `WIFI:T:nopass;S:${e(wifiSsid)};;` : `WIFI:T:WPA;S:${e(wifiSsid)};P:${e(wifiPassword || '')};;`;
}

/* Fichier servi ? Seulement ce qui est dans public/, avec une extension connue */
function resolveStatic(urlPath) {
  let p = urlPath;
  if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith('/public/') || p.includes('..') || p.includes('\\') || p.includes('\0')) return null;
  if (!/^\/public\/[\w./-]+\.(html|js|css|png|jpe?g|svg|ico|webmanifest)$/.test(p)) return null;
  const file = path.join(ROOT, p);
  if (!file.startsWith(PUBLIC + path.sep)) return null;
  return { file, type: MIME[path.extname(file)] || 'application/octet-stream' };
}

/* Numéro WhatsApp au format international sans « + » (06 12 34 56 78 → 33612345678) */
function normPhone(x) {
  let d = String(x ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (/^0\d{9}$/.test(d)) d = '33' + d.slice(1);
  return /^\d{8,15}$/.test(d) ? d : '';
}

function createApp({ dataDir, test = false, pin, port = 3000, interfaces } = {}) {
  const salon = createSalon(dataDir ? path.join(dataDir, 'salon.json') : null, { snapshotsDir: dataDir ? path.join(dataDir, 'sauvegardes') : null });
  const settings = createJsonFile(dataDir ? path.join(dataDir, 'reglages.json') : null,
    { wifiSsid: '', wifiPassword: '', wifiSecurity: 'WPA', publicHost: '', adminPin: '', hostWhatsapp: '' });
  /* Code animateur (audit SV-02) : plus de code par défaut connu de tous. Au premier lancement,
     un code à 6 chiffres est tiré au hasard, enregistré, et affiché seulement sur l'appareil de l'hôte. */
  if (!pin && !process.env.LHVC_ADMIN_PIN && !/^\d{4,8}$/.test(settings.get().adminPin || '')) {
    settings.set({ ...settings.get(), adminPin: String(crypto.randomInt(0, 1e6)).padStart(6, '0') });
  }
  const adminPin = () => String(pin || process.env.LHVC_ADMIN_PIN || settings.get().adminPin);
  const tools = test ? createTestTools({ salon, DB }) : null;
  const sessions = new Set();
  const fails = new Map();                                 // anti-devinette du code : par adresse IP
  const ifaces = () => (interfaces ? interfaces() : net.lanInterfaces());
  const host = () => net.pickHost(settings.get(), ifaces());
  const origin = () => `http://${host()}:${port}`;
  const appPath = `/public/salon/${test ? '?test=1' : ''}`;

  const isLocal = ip => /^(::1|127\.|::ffff:127\.)/.test(String(ip || ''));
  function info(ip) {
    const st = settings.get(); const d = salon.get();
    return { ok: true, version: VERSION, test, host: host(), port, origin: origin(), appUrl: origin() + appPath,
      wifi: st.wifiSsid ? { ssid: st.wifiSsid, qr: wifiQrText(st), open: st.wifiSecurity === 'nopass' } : null,
      hosts: ifaces().map(i => ({ ip: i.ip, hint: i.hint || '' })),
      membres: Object.keys(d.members).length, notes: Object.values(d.votes).filter(v => !v.deleted).length,
      outage: tools ? tools.outageLeft() : 0,
      whatsapp: st.hostWhatsapp || '',
      alerts: [salon.alert(), settings.alert()].filter(Boolean).map(a => ({ level: a.level, message: a.message })),
      // le code n'est montré qu'à l'appareil de l'hôte lui-même (adresse locale), jamais aux téléphones du réseau
      pinLocal: isLocal(ip) ? adminPin() : undefined };
  }

  function login(body, ip) {
    const f = fails.get(ip) || { n: 0, until: 0 };
    if (Date.now() < f.until) return { status: 429, data: { ok: false, error: `Trop d'essais : réessaie dans ${Math.ceil((f.until - Date.now()) / 1000)} s.` } };
    const okPin = crypto.timingSafeEqual(Buffer.from(String(body.pin ?? '').padEnd(16).slice(0, 16)), Buffer.from(adminPin().padEnd(16).slice(0, 16)));
    if (!okPin) {
      f.n++; if (f.n >= 5) { f.until = Date.now() + 60e3 * Math.min(15, 2 ** (f.n - 5)); }
      fails.set(ip, f);
      return { status: 401, data: { ok: false, error: 'Code animateur incorrect.' } };
    }
    fails.delete(ip);
    const token = crypto.randomBytes(18).toString('hex'); sessions.add(token);
    return { status: 200, data: { ok: true, token } };
  }

  function route(method, p, body, token, ip) {
    const admin = sessions.has(token);
    if (method === 'GET' && p === '/api/host/info') return { status: 200, data: info(ip) };
    if (method === 'POST' && p === '/api/host/login') return login(body, ip);
    if (method === 'POST' && p === '/api/host/settings') {
      if (!admin) return { status: 401, data: { ok: false, error: 'Code animateur requis.' } };
      const cur = settings.get(); const s = v => String(v ?? '').trim().slice(0, 64);
      let pinChanged = false;
      const keepPwd = s(body.wifiPassword) === '' && s(body.wifiSsid) === cur.wifiSsid;   // champ laissé vide : on garde l'ancien mot de passe
      const next = { ...cur, wifiSsid: s(body.wifiSsid), wifiPassword: keepPwd ? cur.wifiPassword : s(body.wifiPassword),
        wifiSecurity: body.wifiSecurity === 'nopass' ? 'nopass' : 'WPA',
        hostWhatsapp: body.hostWhatsapp === undefined ? cur.hostWhatsapp : normPhone(body.hostWhatsapp), publicHost: s(body.publicHost).replace(/^https?:\/\//, '').replace(/[:/].*$/, '') };
      if (body.adminPin !== undefined && body.adminPin !== '') {
        if (!/^\d{4,8}$/.test(String(body.adminPin))) return { status: 400, data: { ok: false, error: 'Le code animateur : 4 à 8 chiffres.' } };
        if (String(body.adminPin) !== adminPin()) { next.adminPin = String(body.adminPin); pinChanged = true; }
      }
      settings.set(next);
      if (pinChanged) { sessions.clear(); return { status: 200, data: { ok: true, pinChanged: true, ...info(ip) } }; }   // anciennes sessions invalidées
      return { status: 200, data: { ok: true, ...info(ip) } };
    }
    if (p === '/api/salon/reset' && method === 'POST') {
      if (!admin) return { status: 401, data: { ok: false, error: 'Code animateur requis.' } };
      if (!test && String(body.pin ?? '') !== adminPin()) return { status: 400, data: { ok: false, error: 'Code animateur incorrect : rien n’a été effacé.' } };
      salon.reset();
      return { status: 200, data: { ok: true } };
    }
    if (p === '/api/salon/restore' && method === 'POST') {
      if (!admin) return { status: 401, data: { ok: false, error: 'Code animateur requis.' } };
      if (!test && String(body.pin ?? '') !== adminPin()) return { status: 400, data: { ok: false, error: 'Code animateur incorrect : rien n’a été restauré.' } };
      try { return { status: 200, data: { ok: true, ...salon.restore(body.sauvegarde) } }; } catch (e) { return { status: 400, data: { ok: false, error: e.message } }; }
    }
    if (p === '/api/host/alert/ok' && method === 'POST') {
      if (!admin) return { status: 401, data: { ok: false, error: 'Code animateur requis.' } };
      salon.clearAlert(); settings.clearAlert(); return { status: 200, data: { ok: true } };
    }
    if (p.startsWith('/api/salon/')) {
      if (tools && tools.outageLeft() && p === '/api/salon/sync')
        return { status: 503, data: { ok: false, error: `Panne simulée (mode test) : encore ${tools.outageLeft()} s` } };
      const out = salon.handle(method, p, body, admin);
      if (p === '/api/salon/ping' && out.data.ok) Object.assign(out.data, { test, version: VERSION });
      // les téléphones apprennent le numéro WhatsApp de l'hôte : utile pour le secours, une fois hors de son Wi-Fi
      if (p === '/api/salon/sync' && out.data.ok) out.data.hote = { whatsapp: settings.get().hostWhatsapp || '' };
      return out;
    }
    if (p.startsWith('/api/test/')) {
      if (!tools) return { status: 404, data: { ok: false, error: 'Mode test désactivé (lance le serveur avec --test).' } };
      if (method === 'GET' && p === '/api/test/status') {
        const d = salon.get();
        return { status: 200, data: { ...info(ip), pin: isLocal(ip) ? adminPin() : '(visible seulement sur le PC du serveur)', syncs: d.syncs.slice(-12).reverse().map(x => ({ ...x, name: d.members[x.member]?.name || '?' })) } };
      }
      if (method === 'POST' && p === '/api/test/bots') return { status: 200, data: { ok: true, added: tools.addBots(body.n) } };
      if (method === 'POST' && p === '/api/test/outage') return { status: 200, data: { ok: true, until: tools.outage(body.seconds) } };
      if (method === 'POST' && p === '/api/test/reset') { salon.reset(); tools.outage(0); return { status: 200, data: { ok: true } }; }
      if (method === 'GET' && p === '/api/test/retardataire') return { status: 200, data: tools.lateFile(), download: 'notes-Robert-le-retardataire.json' };
    }
    return { status: 404, data: { ok: false, error: 'Route inconnue' } };
  }

  /* ---------- HTTP ---------- */
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
  };
  const readJson = req => new Promise((ok, ko) => {
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 5e6) { ko(new Error('Requête trop volumineuse')); req.destroy(); } });
    req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); try { ok(raw ? JSON.parse(raw) : {}); } catch { ko(new Error('JSON invalide')); } });
    req.on('error', ko);
  });
  const REDIRECTS = { '/': appPath, '/salon': appPath, '/s': appPath, '/hote': '/public/hote.html', '/savim': '/public/hote.html',
    '/resultats': `/public/salon/resultats.html${test ? '?test=1' : ''}`, '/test': '/public/test.html' };
  const log = (...a) => { if (!process.env.LHVC_QUIET) console.log(new Date().toLocaleTimeString('fr-FR'), ...a); };

  const server = http.createServer(async (req, res) => {
    let url; try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'URL invalide', 'text/plain'); }
    const p = url.pathname;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    try {
      if (p.startsWith('/api/')) {
        if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', cors);
        const body = req.method === 'POST' ? await readJson(req) : Object.fromEntries(url.searchParams);
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
        const out = route(req.method, p, body, token, req.socket.remoteAddress || '');
        if (req.method === 'POST' && p !== '/api/host/login') {
          const who = body?.member?.name ? ` ${body.member.name}` : '';
          const n = out.data?.added !== undefined && !Array.isArray(out.data.added) ? ` +${out.data.added} note(s), ${out.data.updated} modifiée(s)` : '';
          log(`🥂 ${p}${who} → ${out.status}${n}${out.data?.error ? `  (${out.data.error})` : ''}`);
        }
        const extra = out.download ? { 'Content-Disposition': `attachment; filename="${out.download}"` } : {};
        return send(res, out.status, out.data, 'application/json; charset=utf-8', { ...cors, ...extra });
      }
      if (REDIRECTS[p]) { res.writeHead(302, { Location: REDIRECTS[p] }); return res.end(); }
      if (req.method !== 'GET') return send(res, 405, 'Méthode non autorisée', 'text/plain');
      const hit = resolveStatic(p);
      if (!hit) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
      fs.readFile(hit.file, (err, buf) => (err ? send(res, 404, 'Introuvable', 'text/plain; charset=utf-8') : send(res, 200, buf, hit.type)));
    } catch (e) { send(res, 400, { ok: false, error: e.message }); }
  });

  return { server, salon, settings, route, info, resolveStatic, adminPin, tools };
}

module.exports = { createApp, resolveStatic, wifiQrText, normPhone, VERSION, ROOT };
