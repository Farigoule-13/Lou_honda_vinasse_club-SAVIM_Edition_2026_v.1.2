/* =========================================================
 * Non-régression de l'audit indépendant du 21/11/2026 (v1.0).
 * Chaque constat SV-xx est rejoué tel que décrit, et doit désormais
 * être REFUSÉ / CORRIGÉ. Voir docs/Reponse_audit_v1.1.md.
 * ========================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { createSalon, memberIdFromSecret } = require('../lib/salon');
const { createApp } = require('../app');
const { sha256Hex, memberIdFromSecret: browserId } = require('../../public/salon/vendor/sha256.js');
const Rankings = require('../../public/salon/rankings.js');
process.env.LHVC_QUIET = '1';

const W = 'domaine-philippe-plantevin~1', W2 = 'domaine-philippe-plantevin~2', W3 = 'domaine-philippe-plantevin~3', W4 = 'domaine-philippe-plantevin~4';
const SEC = k => `secret-audit-${k}-abcdefghijklmnop`;
const me = (k, name = k) => ({ id: memberIdFromSecret(SEC(k)), secret: SEC(k), name });
const pay = (member, votes, extra = {}) => ({ app: 'lhvc-salon', member, votes, ...extra });
const v = (id, wine, note, extra = {}) => ({ id, wine, track: 'stand', note, at: Date.now() - 60e3, upd: Date.now() - 60e3, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lhvc-audit-'));

async function http(opts) {
  const app = createApp({ interfaces: () => [{ ip: '192.168.1.20', name: 'wlan0' }], ...opts });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  return { app, call, stop: () => new Promise(r => app.server.close(r)) };
}

module.exports = ({ describe, it, expect }) => {
  describe('Audit SV-01 › Identité des téléphones', () => {
    it('I-01 : un autre appareil ne peut ni modifier la note ni le prénom d’un participant connu', () => {
      const s = createSalon(null);
      const victim = me('victim', 'Titi');
      s.merge(pay(victim, [v('v1', W, 16)]));
      // l'attaquant connaît l'identifiant public (QR, liste des prénoms) mais pas le secret
      const forged = { id: victim.id, secret: SEC('attaquant'), name: 'Pirate' };
      let err = null;
      try { s.merge(pay(forged, [v('v1', W, 1, { upd: Date.now() })])); } catch (e) { err = e; }
      expect(err && err.status).toBe(403);
      expect(s.get().votes.v1.note).toBe(16);
      expect(s.get().members[victim.id].name).toBe('Titi');
    });
    it('sans secret, ou avec un identifiant inventé : refusé', () => {
      const s = createSalon(null);
      const tries = [{ id: 'mabc', name: 'x' }, { id: me('a').id, name: 'x' }, { id: 'm' + '0'.repeat(32), secret: SEC('a'), name: 'x' }];
      for (const m of tries) { let st = 0; try { s.merge(pay(m, [v('v1', W, 12)])); } catch (e) { st = e.status; } expect(st).toBe(403); }
      expect(Object.keys(s.get().votes).length).toBe(0);
    });
    it('par HTTP : 403, et le secret n’est jamais renvoyé ni stocké', async () => {
      const h = await http({ pin: '482913' });
      try {
        const a = me('alice', 'Alice');
        await h.call('POST', '/api/salon/sync', pay(a, [v('v1', W, 16)]));
        const r = await h.call('POST', '/api/salon/sync', pay({ ...a, secret: SEC('mallory') }, [v('v1', W, 1, { upd: Date.now() })]));
        expect(r.status).toBe(403);
        const ok = await h.call('POST', '/api/salon/sync', pay(me('bob'), []));
        expect(JSON.stringify(ok.data).includes(a.secret)).toBe(false);
        expect(JSON.stringify(h.app.salon.get()).includes(a.secret)).toBe(false);
      } finally { await h.stop(); }
    });
    it('l’empreinte du navigateur (SHA-256 en JS) est identique à celle du serveur', () => {
      for (const t of ['', 'abc', 'é🍷x', 'a'.repeat(55), 'a'.repeat(64), 'z'.repeat(300)]) expect(sha256Hex(t)).toBe(crypto.createHash('sha256').update(t, 'utf8').digest('hex'));
      expect(browserId(SEC('x'))).toBe(memberIdFromSecret(SEC('x')));
    });
    it('import d’un fichier falsifié (secret faux) refusé ; le vrai fichier passe', () => {
      const s = createSalon(null);
      const a = me('alice');
      const out = s.handle('POST', '/api/salon/import', { payloads: [pay({ ...a, secret: SEC('faux') }, [v('v1', W, 3)]), pay(a, [v('v2', W2, 14)])] }, true);
      expect(out.data.results[0].ok).toBe(false);
      expect(out.data.results[1].ok).toBe(true);
    });
  });

  describe('Audit SV-02 › Code animateur', () => {
    it('I-02 : plus de code par défaut : 1664 refusé sur une installation neuve', async () => {
      const dir = tmp();
      const h = await http({ dataDir: dir });
      try {
        expect((await h.call('POST', '/api/host/login', { pin: '1664' })).status).toBe(401);
        const pin = h.app.adminPin();
        expect(/^\d{6}$/.test(pin)).toBe(true);
        expect((await h.call('POST', '/api/host/login', { pin })).status).toBe(200);
        // le code tiré est conservé d'un lancement à l'autre
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'reglages.json'), 'utf8')).adminPin).toBe(pin);
      } finally { await h.stop(); }
    });
    it('deux installations neuves n’ont (presque jamais) le même code', () => {
      const pins = new Set(Array.from({ length: 20 }, () => createApp({}).adminPin()));
      expect(pins.size > 15).toBe(true);
    });
    it('le code n’est montré qu’à l’appareil du serveur (pas aux téléphones du réseau)', () => {
      const app = createApp({ pin: '482913' });
      expect(app.route('GET', '/api/host/info', {}, null, '127.0.0.1').data.pinLocal).toBe('482913');
      expect(app.route('GET', '/api/host/info', {}, null, '192.168.1.42').data.pinLocal).toBe(undefined);
    });
    it('changer le code ferme les anciennes sessions', async () => {
      const h = await http({ dataDir: tmp() });
      try {
        const t1 = (await h.call('POST', '/api/host/login', { pin: h.app.adminPin() })).data.token;
        const r = await h.call('POST', '/api/host/settings', { wifiSsid: '', adminPin: '731905' }, t1);
        expect(r.data.pinChanged).toBe(true);
        expect((await h.call('GET', '/api/salon/data', null, t1)).status).toBe(401);
        expect((await h.call('POST', '/api/host/login', { pin: '731905' })).status).toBe(200);
      } finally { await h.stop(); }
    });
  });

  describe('Audit SV-03 › Fichier corrompu', () => {
    it('I-06 : l’original corrompu est conservé, la copie de secours reprise, l’incident signalé', () => {
      const dir = tmp(); const f = path.join(dir, 'salon.json');
      const s1 = createSalon(f);
      s1.merge(pay(me('a'), [v('v1', W, 15)]));
      s1.merge(pay(me('b'), [v('v2', W, 12)]));               // 2e écriture : la 1re version devient .bak
      fs.writeFileSync(f, '{INVALID_JSON');
      const s2 = createSalon(f);
      const kept = fs.readdirSync(dir).find(n => n.startsWith('salon.json.corrompu-'));
      expect(!!kept).toBe(true);
      expect(fs.readFileSync(path.join(dir, kept), 'utf8')).toBe('{INVALID_JSON');
      expect(s2.alert().level).toBe('warn');
      expect(Object.keys(s2.get().votes).length >= 1).toBe(true);
      // un nouvel envoi n'efface jamais la pièce corrompue
      s2.merge(pay(me('c'), [v('v3', W, 11)]));
      expect(fs.readFileSync(path.join(dir, kept), 'utf8')).toBe('{INVALID_JSON');
    });
    it('sans copie lisible : alerte « error », original conservé', () => {
      const dir = tmp(); const f = path.join(dir, 'salon.json');
      fs.writeFileSync(f, '{oups');
      const s = createSalon(f);
      expect(s.alert().level).toBe('error');
      expect(fs.readdirSync(dir).some(n => n.startsWith('salon.json.corrompu-'))).toBe(true);
    });
    it('l’alerte est visible par l’écran de l’hôte', () => {
      const dir = tmp(); fs.writeFileSync(path.join(dir, 'salon.json'), 'xx');
      const app = createApp({ dataDir: dir, pin: '482913' });
      expect(app.info().alerts.length).toBe(1);
    });
    it('copies horodatées automatiques et restauration d’une sauvegarde complète', async () => {
      const dir = tmp();
      const h = await http({ dataDir: dir, pin: '482913' });
      try {
        await h.call('POST', '/api/salon/sync', pay(me('a'), [v('v1', W, 15), v('v2', W2, 13)]));
        expect(fs.readdirSync(path.join(dir, 'sauvegardes')).length >= 1).toBe(true);
        const tok = (await h.call('POST', '/api/host/login', { pin: '482913' })).data.token;
        const backup = (await h.call('GET', '/api/salon/backup', null, tok)).data;
        expect(backup.app).toBe('lhvc-salon-sauvegarde');
        expect((await h.call('POST', '/api/salon/reset', { pin: '482913' }, tok)).status).toBe(200);
        expect((await h.call('POST', '/api/salon/restore', { sauvegarde: backup, pin: '000000' }, tok)).status).toBe(400);
        const r = await h.call('POST', '/api/salon/restore', { sauvegarde: backup, pin: '482913' }, tok);
        expect(r.data.notes).toBe(2);
        expect(h.app.salon.get().votes.v1.note).toBe(15);
      } finally { await h.stop(); }
    });
  });

  describe('Audit SV-04 › Notes non numériques', () => {
    it('I-03 : null, chaîne vide, booléen, tableau, texte : refusés (jamais convertis en 0)', () => {
      const s = createSalon(null);
      const r = s.merge(pay(me('a'), [v('n1', W, null), v('n2', W, ''), v('n3', W, true), v('n4', W, [12]), v('n5', W, 'douze'), v('n6', W, -1), v('n7', W, 20.5), v('ok', W2, 14.5)]));
      expect(r.added).toBe(1);
      expect(r.rejected).toBe(7);
      expect(Object.keys(s.get().votes)).toEqual(['ok']);
    });
    it('degré ou prix à null : simplement absent (pas 0)', () => {
      const s = createSalon(null);
      s.merge(pay(me('a'), [v('x', W, 12, { degre: null, prix: null, degreReel: '' })]));
      const x = s.get().votes.x;
      expect([x.degre, x.prix, x.degreReel]).toEqual([undefined, undefined, undefined]);
    });
  });

  describe('Audit SV-05 › Trois coups de cœur', () => {
    it('I-04 : 4 cœurs envoyés → 3 gardés (les plus anciens), le 4e signalé', () => {
      const s = createSalon(null);
      const t = Date.now() - 3600e3;
      const r = s.merge(pay(me('a'), [W, W2, W3, W4].map((w, i) => v(`c${i}`, w, 15, { coeur: true, at: t + i * 1000, upd: t + i * 1000 }))));
      expect(r.coeursRefuses).toBe(1);
      expect(Object.values(s.get().votes).filter(x => x.coeur).map(x => x.id)).toEqual(['c0', 'c1', 'c2']);
    });
    it('envois successifs : la limite tient aussi sur plusieurs synchronisations', () => {
      const s = createSalon(null); const a = me('a');
      s.merge(pay(a, [v('c0', W, 15, { coeur: true }), v('c1', W2, 15, { coeur: true }), v('c2', W3, 15, { coeur: true })]));
      s.merge(pay(a, [v('c3', W4, 15, { coeur: true, at: Date.now(), upd: Date.now() })]));
      expect(Object.values(s.get().votes).filter(x => x.coeur).length).toBe(3);
    });
    it('les classements appliquent aussi la limite (fichiers importés sans serveur)', () => {
      const votes = Object.fromEntries([W, W2, W3, W4].map((w, i) => [`c${i}`, { id: `c${i}`, by: 'mX', wine: w, track: 'stand', note: 15, coeur: true, at: i }]));
      const lv = Rankings.latestVotes(Object.values(votes));
      expect(lv.filter(x => x.coeur).length).toBe(3);
    });
  });

  describe('Audit SV-06 › Horodatages', () => {
    it('I-05 : un vote daté de l’an 285 000 est ramené à « maintenant » et reste corrigeable', () => {
      const s = createSalon(null); const a = me('a');
      s.merge(pay(a, [v('v1', W, 16, { at: 9e15, upd: 9e15 })]));
      expect(s.get().votes.v1.upd <= Date.now()).toBe(true);
      expect(s.get().votes.v1.at <= Date.now()).toBe(true);
      // correction ordinaire, avec l'heure normale du téléphone
      s.merge(pay(a, [v('v1', W, 9, { upd: Date.now() })]));
      expect(s.get().votes.v1.note).toBe(9);
      // et un renvoi identique ne compte pas comme une modification
      expect(s.merge(pay(a, [s.get().votes.v1])).updated).toBe(0);
    });
    it('un vote déjà stocké avec une date aberrante (ancienne version) peut être corrigé', () => {
      const s = createSalon(null); const a = me('a');
      s.merge(pay(a, [v('v1', W, 16)]));
      s.get().votes.v1.upd = 9e15;                              // simule un fichier issu de la v1.0
      s.merge(pay(a, [v('v1', W, 8, { upd: Date.now() })]));
      expect(s.get().votes.v1.note).toBe(8);
    });
  });

  describe('Audit SV-07 › Installateur Termux', () => {
    const script = path.join(__dirname, '..', '..', 'INSTALLER_SAVIM_TERMUX.sh');
    it('le script s’arrête en erreur dès qu’une commande échoue (pipefail)', () => {
      const t = fs.readFileSync(script, 'utf8');
      expect(/^set -euo pipefail$/m.test(t)).toBe(true);
      expect(/run-tests\.js[^\n]*\|\| \{/.test(t)).toBe(true);
    });
    it('tests en échec → l’ancienne version reste active, code de sortie non nul', function () {
      if (process.platform === 'win32') return;                 // simulation bash : Linux / Mac / Termux
      try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); execFileSync('bash', ['--version'], { stdio: 'ignore' }); } catch { return; }   // outils absents (Termux sans zip) : contrôle statique seul
      const home = tmp(); const bin = path.join(home, 'bin'); fs.mkdirSync(bin);
      fs.mkdirSync(path.join(home, 'storage', 'downloads'), { recursive: true });
      for (const c of ['pkg', 'termux-setup-storage']) { fs.writeFileSync(path.join(bin, c), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(bin, c), 0o755); }
      // ancienne version active
      const old = path.join(home, 'Lou_Honda_Vinasse_Club_Savim_Edition_v1.0'); fs.mkdirSync(path.join(old, 'server', 'data'), { recursive: true });
      fs.writeFileSync(path.join(old, 'server', 'data', 'salon.json'), '{"votes":{}}'); fs.symlinkSync(old, path.join(home, 'lhvc-savim'));
      // archive piégée : ses tests échouent
      const src = path.join(home, 'src', 'Lou_Honda_Vinasse_Club_Savim_Edition_v9.9', 'server'); fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, 'server.js'), ''); fs.writeFileSync(path.join(src, 'run-tests.js'), 'console.log("1 test en échec"); process.exit(1)');
      execFileSync('zip', ['-qr', path.join(home, 'storage', 'downloads', 'Lou_Honda_Vinasse_Club_Savim_Edition_v9.9.zip'), 'Lou_Honda_Vinasse_Club_Savim_Edition_v9.9'], { cwd: path.join(home, 'src') });
      let code = 0;
      try { execFileSync('bash', [script], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, stdio: 'pipe' }); } catch (e) { code = e.status; }
      expect(code).toBe(1);
      expect(fs.realpathSync(path.join(home, 'lhvc-savim'))).toBe(fs.realpathSync(old));
      expect(fs.existsSync(path.join(home, 'Lou_Honda_Vinasse_Club_Savim_Edition_v9.9'))).toBe(false);
    });
  });

  describe('Audit SV-08 › Objets partagés', () => {
    it('un vin ajouté appartient à son créateur : un autre ne peut pas le réécrire', () => {
      const s = createSalon(null); const a = me('alice'), m = me('mallory');
      const id = `c-${a.id}-xyz`;
      s.merge(pay(a, [], { wines: [{ id, nom: 'Cuvée des Fadas', couleur: 'rouge', by: a.id }] }));
      s.merge(pay(m, [], { wines: [{ id, nom: 'Piquette', couleur: 'blanc', by: a.id }] }));
      expect(s.get().wines[id].nom).toBe('Cuvée des Fadas');
      expect(s.get().wines[id].by).toBe(a.id);
    });
    it('relais : un copain peut faire connaître un vin absent, le créateur garde le dernier mot', () => {
      const s = createSalon(null); const a = me('alice'), b = me('bob');
      const id = `c-${a.id}-xyz`;
      s.merge(pay(b, [], { wines: [{ id, nom: 'Nom approximatif', by: b.id }] }));
      expect(s.get().wines[id].relay).toBe(true);
      expect(s.get().wines[id].by).toBe(a.id);                 // attribué d'après l'identifiant, pas d'après « by »
      s.merge(pay(a, [], { wines: [{ id, nom: 'Cuvée des Fadas' }] }));
      expect(s.get().wines[id].nom).toBe('Cuvée des Fadas');
      expect(s.get().wines[id].relay).toBe(undefined);
    });
    it('bouteille commune : même règle ; « via » ne peut pas désigner soi-même ni un faux identifiant', () => {
      const s = createSalon(null); const a = me('alice'), m = me('mallory');
      const k = `k-${a.id}-1`;
      s.merge(pay(a, [], { communes: [{ id: k, wine: W, prix: 12 }] }));
      s.merge(pay(m, [v('x1', W, 12, { via: m.id }), v('x2', W2, 12, { via: 'nimporte' })], { communes: [{ id: k, wine: W2, prix: 99 }] }));
      expect(s.get().communes[k].prix).toBe(12);
      expect(s.get().votes.x1.via).toBe(undefined);
      expect(s.get().votes.x2.via).toBe(undefined);
    });
  });
};
