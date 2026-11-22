/* =========================================================
 * MODE TEST — Outils pour essayer l'appli sur un PC (+ un téléphone)
 * avant le salon : faux dégustateurs, panne simulée, faux retardataire.
 * Ces routes n'existent QUE si le serveur est lancé avec --test.
 * ========================================================= */
const { memberIdFromSecret } = require('./salon');
const NAMES = ['Momo', 'Fanny', 'Zé', 'Titi', 'Nico', 'Babeth', 'Toinou', 'Marius', 'César', 'Honorine', 'Panisse', 'Escartefigue'];

function rng(seed) {                                  // petit hasard reproductible
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function createTestTools({ salon, DB }) {
  let outageUntil = 0;
  let botCount = 0;
  // un « parcours » commun : les faux dégustateurs passent surtout par les mêmes stands (sinon aucun vin n'aurait 2 notes)
  const pool = DB.exposants.filter(e => e.vins.length >= 3).slice(0, 14).flatMap(e => e.vins.slice(0, 3).map(w => w.id));

  function fakePayload(secret, name, r, { nVotes, commune } = {}) {
    const id = memberIdFromSecret(secret);
    const votes = [];
    const picked = new Set();
    const n = nVotes || 6 + Math.floor(r() * 7);
    let coeurs = 0;
    const kind = r();                                         // sévère, généreux ou entre les deux
    const base = kind < .3 ? 11 : kind > .7 ? 15 : 13;
    for (let k = 0; k < n; k++) {
      const w = pool[Math.floor(r() * pool.length)];
      if (picked.has(w)) continue;
      picked.add(w);
      const at = Date.now() - Math.floor(r() * 4 * 3600e3);
      const coeur = coeurs < 3 && r() < .15; if (coeur) coeurs++;
      votes.push({ id: `${id.slice(0, 20)}v${k}`, wine: w, track: 'stand', note: Math.max(0, Math.min(20, Math.round((base + (r() - .5) * 8) * 2) / 2)),
        coeur, achete: r() < .1, degre: r() < .5 ? Math.round((12.5 + r() * 2) * 2) / 2 : undefined,
        degreReel: r() < .3 ? 13.5 : undefined, at, upd: at });
    }
    if (commune) votes.push({ id: `${id.slice(0, 20)}k`, wine: commune.wine, track: 'commune', commune: commune.id, note: Math.round((base + (r() - .5) * 6) * 2) / 2, at: Date.now(), upd: Date.now() });
    return { app: 'lhvc-salon', v: 1, member: { id, secret, name, pref: r() < .5 ? 'rouge' : 'blanc' }, votes, wines: [], communes: commune ? [commune] : [] };
  }

  /* Ajoute n faux dégustateurs qui « synchronisent » comme de vrais téléphones */
  function addBots(n = 3) {
    n = Math.max(1, Math.min(10, Number(n) || 3));
    const r = rng(Date.now());
    const d = salon.get();
    let commune = Object.values(d.communes)[0];
    const names = [];
    let firstId = Object.keys(d.members).find(id => /🤖/.test(d.members[id].name)) || null;
    for (let i = 0; i < n; i++) {
      botCount++;
      const name = `${NAMES[(botCount - 1) % NAMES.length]} 🤖${botCount > NAMES.length ? botCount : ''}`;
      const secret = `bot-${botCount}-${Math.floor(r() * 1e12)}-${Date.now()}`;
      const id = memberIdFromSecret(secret);
      if (!commune) commune = { id: `k-${id}-bot`, wine: pool[1], prix: 14, at: Date.now() };
      const p = fakePayload(secret, name, r, { commune });
      // quelques votes « recommandés » par le premier bot (pour l'influenceur et le dénicheur)
      if (firstId) p.votes.forEach(v => { if (r() < .2) v.via = firstId; }); else firstId = id;
      salon.merge(p, 'bot');
      names.push(name);
    }
    return names;
  }

  /* Faux retardataire : un fichier à importer à la main sur la page Résultats */
  function lateFile() {
    const r = rng(42);
    return fakePayload('retardataire-robert-cle-de-test', 'Robert le retardataire', r, { nVotes: 6 });
  }

  return {
    addBots, lateFile,
    outage: seconds => { outageUntil = Date.now() + Math.max(0, Math.min(600, Number(seconds) || 0)) * 1000; return outageUntil; },
    outageLeft: () => Math.max(0, Math.ceil((outageUntil - Date.now()) / 1000)),
  };
}

module.exports = { createTestTools };
