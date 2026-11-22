/* Tests : base des vins, réception des notes (fusion, secret des votes), classements */
const path = require('path');
const { createSalon, memberIdFromSecret } = require('../lib/salon');
const { resolveStatic } = require('../app');
const ROOT = path.join(__dirname, '..', '..');
const DB = require(path.join(ROOT, 'public/salon/data/exposants.js'));
const Fiches = require(path.join(ROOT, 'public/salon/data/fiches.js'));
const Rankings = require(path.join(ROOT, 'public/salon/rankings.js'));

module.exports = ({ describe, it, expect }) => {
  const W = DB.exposants.flatMap(e => e.vins).map(w => w.id);
  const vote = (id, by, wine, note, extra = {}) => ({ id, by, wine, track: 'stand', note, at: 1000, upd: 1000, ...extra });   // « by » est ignoré : le serveur prend l'identité vérifiée
  // identités de test : l'identifiant est l'empreinte d'un secret (comme sur les vrais téléphones)
  const SEC = k => `secret-de-test-${k}-0123456789`;
  const MID = k => memberIdFromSecret(SEC(k));
  const pay = (k, name, votes, extra = {}) => ({ app: 'lhvc-salon', member: { id: MID(k), secret: SEC(k), name, pref: 'rouge' }, votes, ...extra });

  describe('Base des exposants', () => {
    it('173 exposants vins, 465 cuvées, aucun champagne', () => {
      expect(DB.exposants.length).toBe(173);
      expect(W.length).toBe(465);
      expect(DB.exposants.some(e => /champagne/i.test(e.region))).toBe(false);
    });
    it('identifiants uniques et cuvées rattachées à leur exposant', () => {
      expect(new Set(DB.exposants.map(e => e.id)).size).toBe(DB.exposants.length);
      expect(new Set(W).size).toBe(W.length);
      expect(DB.exposants.every(e => e.vins.every(w => w.id.startsWith(`${e.id}~`)))).toBe(true);
    });
    it('chaque région a sa fiche', () => {
      expect(DB.exposants.every(e => Fiches.REGIONS[e.region])).toBe(true);
    });
    it('reconnaît les cépages sans confondre cabernet-sauvignon et sauvignon', () => {
      expect(Fiches.cepageIds('Merlot 70 %, Cabernet-Sauvignon 30 %')).toEqual(['cabernet-sauvignon', 'merlot']);
      expect(Fiches.cepageIds('Sauvignon 100 %')).toEqual(['sauvignon']);
    });
  });

  describe('Réception des notes', () => {
    it('un même envoi répété ne compte qu’une fois', () => {
      const s = createSalon(null);
      const p = pay('mA', 'Titi', [vote('v1', 'mA', W[0], 15)]);
      expect(s.merge(p).added).toBe(1);
      expect(s.merge(p).added).toBe(0);
      expect(Object.keys(s.get().votes).length).toBe(1);
    });
    it('la version la plus récente d’un vote gagne', () => {
      const s = createSalon(null);
      s.merge(pay('mA', 'Titi', [vote('v1', 'mA', W[0], 15, { upd: 2000 })]));
      s.merge(pay('mA', 'Titi', [vote('v1', 'mA', W[0], 9, { upd: 1500 })]));       // vieux fichier envoyé après coup
      expect(s.get().votes.v1.note).toBe(15);
      s.merge(pay('mA', 'Titi', [vote('v1', 'mA', W[0], 17, { upd: 3000 })]));
      expect(s.get().votes.v1.note).toBe(17);
    });
    it('personne ne peut écraser le vote d’un autre', () => {
      const s = createSalon(null);
      s.merge(pay('mA', 'Titi', [vote('v1', 'mA', W[0], 15)]));
      s.merge(pay('mB', 'Momo', [vote('v1', 'mB', W[0], 2, { upd: 9999 })]));
      expect(s.get().votes.v1.note).toBe(15);
      expect(s.get().votes.v1.by).toBe(MID('mA'));
    });
    it('rejette les notes hors barème et les identifiants bizarres', () => {
      const s = createSalon(null);
      const r = s.merge(pay('mA', 'Titi', [vote('v1', 'mA', W[0], 25), vote('<x>', 'mA', W[0], 12), vote('v3', 'mA', W[1], 12.5)]));
      expect(r.added).toBe(1);
    });
    it('les téléphones ne reçoivent jamais les votes des autres', () => {
      const s = createSalon(null);
      s.merge(pay('mA', 'Titi', [vote('v1', 'mA', W[0], 15)], { wines: [{ id: `c-${MID('mA')}-abc`, nom: 'Cuvée du stand', couleur: 'rouge' }] }));
      const out = s.handle('POST', '/api/salon/sync', pay('mB', 'Momo', []), false);
      expect(out.status).toBe(200);
      expect(out.data.votes).toBe(undefined);
      expect(JSON.stringify(out.data).includes('"note"')).toBe(false);
      expect(out.data.wines[`c-${MID('mA')}-abc`].nom).toBe('Cuvée du stand');
      expect(out.data.members[MID('mA')].name).toBe('Titi');
      expect(JSON.stringify(out.data).includes(SEC('mA'))).toBe(false);
    });
    it('données complètes et import réservés à l’hôte', () => {
      const s = createSalon(null);
      expect(s.handle('GET', '/api/salon/data', {}, false).status).toBe(401);
      expect(s.handle('POST', '/api/salon/import', { payloads: [] }, false).status).toBe(401);
      const imp = s.handle('POST', '/api/salon/import', { payloads: [pay('mA', 'Titi', [vote('v1', 'mA', W[0], 15)]), { nimporte: 'quoi' }] }, true);
      expect(imp.data.results[0].ok).toBe(true);
      expect(imp.data.results[1].ok).toBe(false);
      expect(Object.keys(s.get().votes).length).toBe(1);
      s.reset();
      expect(Object.keys(s.get().votes).length).toBe(0);
    });
    it('les pages de l’appli sont servies, pas les données du serveur', () => {
      expect(resolveStatic('/public/salon/').file.endsWith('index.html')).toBe(true);
      expect(!!resolveStatic('/public/salon/data/exposants.js')).toBe(true);
      expect(resolveStatic('/server/data/salon.json')).toBe(null);
      expect(resolveStatic('/public/../server/data/salon.json')).toBe(null);
    });
  });

  describe('Classements', () => {
    const mk = () => {
      const s = createSalon(null);
      const notes = { mA: [16, 12, 14, 10], mB: [18, 11, 15, 9], mC: [15, 13, 13, 11] };
      for (const [m, ns] of Object.entries(notes)) s.merge(pay(m, m.toUpperCase(), ns.map((n, k) => vote(`${m}${k}`, m, W[k], n, { at: m === 'mA' ? 1 : 100, coeur: k === 0, via: m !== 'mA' ? MID('mA') : undefined }))));
      s.merge(pay('mD', 'Solo', [vote('d1', 'mD', W[20], 19)]));
      return Rankings.compute(s.get(), { DB, Fiches });
    };
    it('le général met en tête le vin le mieux noté (sans bonus ni malus)', () => {
      const R = mk();
      expect(R.stand.general[0].wine.id).toBe(W[0]);
      expect(R.stand.general.some(i => i.wine.id === W[20])).toBe(false);    // 1 seul vote : hors podium
    });
    it('coups de cœur, influenceur et dénicheur', () => {
      const R = mk();
      expect(R.stand.coeur[0].coeurs).toBe(3);
      expect(R.personnes.influenceur[0].name).toBe('MA');
      expect(R.personnes.denicheur[0].name).toBe('MA');
    });
    it('le loup solitaire est celui qui a goûté seul', () => {
      expect(mk().personnes.solitaire[0].name).toBe('Solo');
    });
    it('un exposant sans vote n’apparaît nulle part', () => {
      const R = mk();
      const voted = new Set([0, 1, 2, 3, 20].map(k => DB.exposants.find(e => e.vins.some(w => w.id === W[k])).id));
      expect(R.stand.visites.every(e => voted.has(e.id))).toBe(true);
      expect(R.stand.domaines.every(d => voted.has(d.key))).toBe(true);
    });
    it('les diapos se terminent par les cartes de chacun, sans planter sur une soirée vide', () => {
      const S = Rankings.slides(mk(), Fiches);
      expect(S[S.length - 1].kind).toBe('profil');
      expect(Rankings.slides(Rankings.compute({}, { DB, Fiches }), Fiches).length >= 1).toBe(true);
    });
  });
};
