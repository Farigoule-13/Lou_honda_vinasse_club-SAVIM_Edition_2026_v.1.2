/* Tests du serveur de l'hôte : vraies requêtes HTTP sur un port libre */
const { createApp, wifiQrText } = require('../app');
const { memberIdFromSecret } = require('../lib/salon');
process.env.LHVC_QUIET = '1';

async function start(opts) {
  const app = createApp({ interfaces: () => [{ ip: '192.168.1.20', name: 'wlan0' }], ...opts });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, location: r.headers.get('location'), headers: r.headers };
  };
  return { app, call, stop: () => new Promise(r => app.server.close(r)) };
}
const SEC = k => `secret-de-test-${k}-0123456789`;
const pay = (k, name, votes) => ({ app: 'lhvc-salon', member: { id: memberIdFromSecret(SEC(k)), secret: SEC(k), name }, votes, wines: [], communes: [] });
const W = 'domaine-philippe-plantevin~1';

module.exports = ({ describe, it, expect }) => {
  describe('Serveur › Pages', () => {
    it('/ mène à l’appli, /hote, /resultats et /test à leur page', async () => {
      const s = await start({ pin: '4321' });
      try {
        expect((await s.call('GET', '/')).location).toBe('/public/salon/');
        expect((await s.call('GET', '/hote')).location).toBe('/public/hote.html');
        expect((await s.call('GET', '/resultats')).location).toBe('/public/salon/resultats.html');
        const page = await s.call('GET', '/public/salon/');
        expect(page.status).toBe(200);
        expect(page.headers.get('content-type').startsWith('text/html')).toBe(true);
        expect((await s.call('GET', '/public/salon/data/exposants.js')).status).toBe(200);
        expect((await s.call('GET', '/server/app.js')).status).toBe(404);
      } finally { await s.stop(); }
    });
    it('en mode test, l’appli a son adresse à part (?test=1)', async () => {
      const s = await start({ test: true });
      try {
        expect((await s.call('GET', '/')).location).toBe('/public/salon/?test=1');
        const i = (await s.call('GET', '/api/host/info')).data;
        expect(i.test).toBe(true);
        expect(i.appUrl.endsWith('/public/salon/?test=1')).toBe(true);
        expect(i.appUrl.startsWith('http://192.168.1.20:')).toBe(true);
      } finally { await s.stop(); }
    });
  });

  describe('Serveur › Code animateur', () => {
    it('mauvais code refusé, bon code accepté, données réservées à l’hôte', async () => {
      const s = await start({ pin: '4321' });
      try {
        await s.call('POST', '/api/salon/sync', pay('mA', 'Titi', [{ id: 'v1', wine: W, track: 'stand', note: 15 }]));
        expect((await s.call('GET', '/api/salon/data')).status).toBe(401);
        expect((await s.call('POST', '/api/host/login', { pin: '0000' })).status).toBe(401);
        const tok = (await s.call('POST', '/api/host/login', { pin: '4321' })).data.token;
        const d = await s.call('GET', '/api/salon/data', null, tok);
        expect(d.data.data.votes.v1.note).toBe(15);
      } finally { await s.stop(); }
    });
    it('5 mauvais codes → pause forcée', async () => {
      const s = await start({ pin: '4321' });
      try {
        for (let i = 0; i < 5; i++) await s.call('POST', '/api/host/login', { pin: '1111' });
        expect((await s.call('POST', '/api/host/login', { pin: '4321' })).status).toBe(429);
      } finally { await s.stop(); }
    });
    it('remise à zéro du vrai salon : il faut retaper le code', async () => {
      const s = await start({ pin: '4321' });
      try {
        await s.call('POST', '/api/salon/sync', pay('mA', 'Titi', [{ id: 'v1', wine: W, track: 'stand', note: 15 }]));
        const tok = (await s.call('POST', '/api/host/login', { pin: '4321' })).data.token;
        expect((await s.call('POST', '/api/salon/reset', { pin: '9' }, tok)).status).toBe(400);
        expect((await s.call('GET', '/api/host/info')).data.notes).toBe(1);
        expect((await s.call('POST', '/api/salon/reset', { pin: '4321' }, tok)).status).toBe(200);
        expect((await s.call('GET', '/api/host/info')).data.notes).toBe(0);
      } finally { await s.stop(); }
    });
    it('réglages Wi-Fi : QR généré, mot de passe gardé si le champ reste vide', async () => {
      const s = await start({ pin: '4321' });
      try {
        const tok = (await s.call('POST', '/api/host/login', { pin: '4321' })).data.token;
        await s.call('POST', '/api/host/settings', { wifiSsid: 'Vinasse', wifiPassword: 'pastis51' }, tok);
        await s.call('POST', '/api/host/settings', { wifiSsid: 'Vinasse', wifiPassword: '', publicHost: 'http://10.0.0.7:3000/' }, tok);
        const i = (await s.call('GET', '/api/host/info')).data;
        expect(i.wifi.qr).toBe('WIFI:T:WPA;S:Vinasse;P:pastis51;;');
        expect(i.host).toBe('10.0.0.7');
        expect(wifiQrText({ wifiSsid: 'a;b', wifiPassword: 'x:y' })).toBe('WIFI:T:WPA;S:a\\;b;P:x\\:y;;');
      } finally { await s.stop(); }
    });
  });

  describe('Serveur › Mode test', () => {
    it('les outils de test n’existent pas dans le vrai salon', async () => {
      const s = await start({});
      try { expect((await s.call('POST', '/api/test/bots', { n: 3 })).status).toBe(404); } finally { await s.stop(); }
    });
    it('faux dégustateurs : des notes, des vins notés par plusieurs, des classements remplis', async () => {
      const s = await start({ test: true });
      try {
        const r = await s.call('POST', '/api/test/bots', { n: 5 });
        expect(r.data.added.length).toBe(5);
        const d = s.app.salon.get();
        expect(Object.keys(d.members).length).toBe(5);
        const Rk = require('../../public/salon/rankings.js');
        const R = Rk.compute(d, { DB: require('../../public/salon/data/exposants.js'), Fiches: require('../../public/salon/data/fiches.js') });
        expect(R.stand.general.length).toBeGreaterThan(2);
        expect(R.commune.items.length).toBe(1);
      } finally { await s.stop(); }
    });
    it('panne simulée : les envois sont refusés puis acceptés au rétablissement', async () => {
      const s = await start({ test: true });
      try {
        await s.call('POST', '/api/test/outage', { seconds: 60 });
        const p = pay('mA', 'Titi', [{ id: 'v1', wine: W, track: 'stand', note: 15 }]);
        expect((await s.call('POST', '/api/salon/sync', p)).status).toBe(503);
        expect((await s.call('GET', '/api/host/info')).data.outage).toBeGreaterThan(0);
        await s.call('POST', '/api/test/outage', { seconds: 0 });
        expect((await s.call('POST', '/api/salon/sync', p)).data.added).toBe(1);
      } finally { await s.stop(); }
    });
    it('fichier du retardataire : téléchargeable et importable une seule fois', async () => {
      const s = await start({ test: true, pin: '4321' });
      try {
        const f = await s.call('GET', '/api/test/retardataire');
        expect(f.headers.get('content-disposition').includes('attachment')).toBe(true);
        const tok = (await s.call('POST', '/api/host/login', { pin: '4321' })).data.token;
        const a = await s.call('POST', '/api/salon/import', { payloads: [f.data] }, tok);
        const b = await s.call('POST', '/api/salon/import', { payloads: [f.data] }, tok);
        expect(a.data.results[0].added).toBeGreaterThan(0);
        expect(b.data.results[0].added).toBe(0);
      } finally { await s.stop(); }
    });
    it('remise à zéro du test sans code', async () => {
      const s = await start({ test: true });
      try {
        await s.call('POST', '/api/test/bots', { n: 2 });
        await s.call('POST', '/api/test/reset');
        expect((await s.call('GET', '/api/host/info')).data.membres).toBe(0);
      } finally { await s.stop(); }
    });
  });
};
