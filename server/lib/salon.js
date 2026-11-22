/* =========================================================
 * SALON — Réception et fusion des notes envoyées par les téléphones.
 *
 * Identité (audit SV-01) : chaque téléphone tire au hasard un SECRET
 * qu'il ne montre jamais. Son identifiant public = empreinte SHA-256
 * de ce secret. Le serveur recalcule l'empreinte à chaque envoi :
 * sans le secret, impossible d'envoyer (ou de modifier) des notes
 * au nom de quelqu'un, même en connaissant son identifiant.
 *
 * Fusion : chaque téléphone renvoie TOUT à chaque synchronisation.
 * Identifiant unique par vote, la version la plus récente gagne
 * (horodatages bornés : SV-06). Un même envoi répété ne compte qu'une fois.
 *
 * Règles imposées ici et pas seulement dans l'appli :
 * notes de 0 à 20 strictement numériques (SV-04), 3 coups de cœur
 * maximum par personne (SV-05), vins ajoutés et bouteilles communes
 * attribués d'après leur identifiant et non d'après leur contenu (SV-08).
 *
 * Les notes des autres ne sont JAMAIS renvoyées aux téléphones.
 * ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createJsonFile, writeAtomic } = require('./file-storage');

const LIMITS = { votes: 2000, wines: 500, communes: 300, text: 120, coeurs: 3, snapEveryMs: 10 * 60e3, snapKeep: 40 };
const ID = /^[A-Za-z0-9_~.-]{1,80}$/;
const MEMBER_ID = /^m[0-9a-f]{32}$/;
const SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const clip = (s, n = LIMITS.text) => String(s ?? '').slice(0, n);

/* Nombre strict : null, '', booléens, tableaux… sont refusés (Number(null) vaudrait 0) */
function num(x, min, max) {
  if (typeof x === 'string' && x.trim() !== '' && /^-?\d+([.,]\d+)?$/.test(x.trim())) x = Number(x.replace(',', '.'));
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) return undefined;
  return x;
}
const memberIdFromSecret = secret => 'm' + crypto.createHash('sha256').update(`lhvc-savim|${secret}`, 'utf8').digest('hex').slice(0, 32);
const ownerOf = objId => { const m = String(objId).match(/^[ck]-(m[0-9a-f]{32})-/); return m ? m[1] : null; };

function verifyMember(m) {
  if (!m || typeof m !== 'object') throw new Error('Identité du téléphone manquante.');
  const deny = msg => Object.assign(new Error(msg), { status: 403 });
  if (!SECRET.test(String(m.secret || ''))) throw deny('Ce téléphone n’a pas de clé : mets l’appli à jour (recharge la page) puis renvoie.');
  if (!MEMBER_ID.test(String(m.id || '')) || memberIdFromSecret(m.secret) !== m.id) throw deny('Identité refusée : la clé ne correspond pas à ce dégustateur.');
  return m.id;
}

function cleanVote(v, by, now) {
  if (!v || typeof v !== 'object' || !ID.test(v.id || '') || !ID.test(v.wine || '')) return null;
  const deleted = v.deleted === true;
  const note = num(v.note, 0, 20);
  if (note === undefined && !deleted) return null;
  const track = v.track === 'commune' ? 'commune' : 'stand';
  if (track === 'commune' && !ID.test(v.commune || '')) return null;
  const cap = now;                                              // une date dans le futur est ramenée à l'heure de réception
  const at = Math.min(num(v.at, 0, 9e15) ?? now, cap);
  const upd = Math.min(num(v.upd, 0, 9e15) ?? at, cap);
  return {
    id: v.id, by, wine: v.wine, track, commune: track === 'commune' ? v.commune : undefined,
    note: note === undefined ? undefined : Math.round(note * 100) / 100, deleted, coeur: v.coeur === true && !deleted, achete: v.achete === true,
    degre: num(v.degre, 0, 25), degreReel: num(v.degreReel, 0, 25), prix: num(v.prix, 0, 10000),
    couleur: ['rouge', 'blanc', 'rosé', 'orange'].includes(v.couleur) ? v.couleur : undefined,
    via: MEMBER_ID.test(v.via || '') && v.via !== by ? v.via : undefined,
    at, upd,
  };
}

function cleanWine(w) {
  if (!w || typeof w !== 'object' || !ID.test(w.id || '') || !String(w.id).startsWith('c-')) return null;
  return {
    id: w.id, by: ownerOf(w.id) || undefined, exposant: ID.test(w.exposant || '') ? w.exposant : undefined,
    exposantLibre: clip(w.exposantLibre), nom: clip(w.nom).trim() || 'Vin sans nom',
    couleur: ['rouge', 'blanc', 'rosé', 'orange', ''].includes(w.couleur) ? w.couleur : '',
    type: ['sec', 'moelleux', 'doux', 'effervescent', 'demi-doux', 'jaune'].includes(w.type) ? w.type : 'sec',
    appellation: clip(w.appellation), cepages: clip(w.cepages), millesime: num(w.millesime, 1900, 2100) ?? null,
    aromes: clip(w.aromes), at: Date.now(),
  };
}

function cleanCommune(c) {
  if (!c || typeof c !== 'object' || !ID.test(c.id || '') || !ID.test(c.wine || '')) return null;
  return { id: c.id, wine: c.wine, by: ownerOf(c.id) || undefined, prix: num(c.prix, 0, 10000), at: Date.now() };
}

/* Un objet partagé (vin ajouté, bouteille commune) appartient à celui dont l'identifiant est inscrit dans son nom.
   Son créateur fait foi ; un autre téléphone peut seulement le faire connaître s'il manque (relais). */
function mergeShared(store, obj, sender) {
  if (!obj) return;
  const old = store[obj.id];
  const owner = ownerOf(obj.id);
  if (owner && owner === sender) store[obj.id] = { ...obj, relay: undefined };
  else if (!old) store[obj.id] = { ...obj, relay: true };
}

/* Coups de cœur : 3 au maximum par personne ; on garde les plus anciens */
function enforceCoeurs(d, member) {
  const mine = Object.values(d.votes).filter(v => v.by === member && v.coeur && !v.deleted).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  mine.slice(LIMITS.coeurs).forEach(v => { d.votes[v.id] = { ...v, coeur: false, coeurRefuse: true }; });
  return Math.max(0, mine.length - LIMITS.coeurs);
}

function createSalon(file, { snapshotsDir } = {}) {
  const store = createJsonFile(file, { members: {}, votes: {}, wines: {}, communes: {}, syncs: [] });
  let lastSnap = 0;
  const get = () => {
    const d = store.get();
    for (const k of ['members', 'votes', 'wines', 'communes']) d[k] = d[k] || {};
    d.syncs = d.syncs || [];
    return d;
  };
  function snapshot(reason = 'auto', force = false) {
    if (!snapshotsDir || (!force && Date.now() - lastSnap < LIMITS.snapEveryMs)) return null;
    try {
      fs.mkdirSync(snapshotsDir, { recursive: true });
      const name = `salon-${new Date().toISOString().replace(/[:.]/g, '-')}-${reason}.json`;
      writeAtomic(path.join(snapshotsDir, name), JSON.stringify(get()));
      lastSnap = Date.now();
      const all = fs.readdirSync(snapshotsDir).filter(f => /^salon-.*\.json$/.test(f)).sort();
      all.slice(0, Math.max(0, all.length - LIMITS.snapKeep)).forEach(f => fs.unlinkSync(path.join(snapshotsDir, f)));
      return name;
    } catch { return null; }
  }

  function merge(payload, source = 'wifi') {
    if (!payload || typeof payload !== 'object') throw new Error('Envoi vide.');
    const id = verifyMember(payload.member);
    const m = payload.member;
    const now = Date.now();
    const d = get();
    const name = clip(m.name, 30).trim() || 'Anonyme';
    d.members[id] = { ...(d.members[id] || {}), name, pref: ['rouge', 'blanc', 'rosé', ''].includes(m.pref) ? m.pref : '', last: now };
    let added = 0, updated = 0, rejected = 0;
    for (const raw of (Array.isArray(payload.votes) ? payload.votes : []).slice(0, LIMITS.votes)) {
      const v = cleanVote(raw, id, now);
      if (!v) { rejected++; continue; }
      const old = d.votes[v.id];
      if (old && old.by !== id) { rejected++; continue; }        // le vote d'un autre : intouchable
      if (!old) { d.votes[v.id] = v; added++; }
      else {
        const oldUpd = Math.min(old.upd || 0, now);                // anciennes dates aberrantes (v1.0) : ramenées à maintenant
        const same = JSON.stringify({ ...old, upd: 0 }) === JSON.stringify({ ...v, upd: 0 });
        if (v.upd > oldUpd || (v.upd === oldUpd && !same)) { d.votes[v.id] = v; updated++; }
      }
    }
    for (const raw of (Array.isArray(payload.wines) ? payload.wines : []).slice(0, LIMITS.wines)) mergeShared(d.wines, cleanWine(raw), id);
    for (const raw of (Array.isArray(payload.communes) ? payload.communes : []).slice(0, LIMITS.communes)) mergeShared(d.communes, cleanCommune(raw), id);
    const coeursRefuses = enforceCoeurs(d, id);
    d.syncs.push({ at: now, member: id, source, added, updated, rejected });
    d.syncs = d.syncs.slice(-300);
    store.set(d);
    snapshot('auto');
    const mine = Object.values(d.votes).filter(v => v.by === id && !v.deleted).length;
    return { added, updated, rejected, coeursRefuses, mine };
  }

  /* Ce qu'un téléphone a le droit de recevoir (jamais les notes, jamais de clé) */
  function shared() {
    const d = get();
    return {
      members: Object.fromEntries(Object.entries(d.members).map(([id, x]) => [id, { name: x.name }])),
      wines: d.wines, communes: d.communes,
    };
  }

  /* Restauration d'une sauvegarde complète de l'hôte (l'état actuel est d'abord sauvegardé) */
  function restore(full) {
    if (!full || typeof full !== 'object' || typeof full.votes !== 'object' || typeof full.members !== 'object') throw new Error('Ce fichier n’est pas une sauvegarde complète du salon.');
    snapshot('avant-restauration', true);
    const d = { members: {}, votes: {}, wines: {}, communes: {}, syncs: get().syncs };
    for (const [id, mb] of Object.entries(full.members)) if (MEMBER_ID.test(id)) d.members[id] = { name: clip(mb?.name, 30) || 'Anonyme', pref: mb?.pref || '', last: num(mb?.last, 0, 9e15) || 0 };
    const now = Date.now();
    for (const v of Object.values(full.votes)) { if (v && d.members[v.by]) { const c = cleanVote(v, v.by, now); if (c) d.votes[c.id] = c; } }
    for (const w of Object.values(full.wines || {})) { const c = cleanWine(w); if (c) d.wines[c.id] = { ...c, relay: w.relay === true || undefined }; }
    for (const k of Object.values(full.communes || {})) { const c = cleanCommune(k); if (c) d.communes[c.id] = { ...c, relay: k.relay === true || undefined }; }
    Object.keys(d.members).forEach(id => enforceCoeurs(d, id));
    store.set(d);
    return { membres: Object.keys(d.members).length, notes: Object.values(d.votes).filter(v => !v.deleted).length };
  }

  function reset() { snapshot('avant-remise-a-zero', true); store.set({ members: {}, votes: {}, wines: {}, communes: {}, syncs: [] }); }

  /* Routes ; isAdmin = jeton de l'hôte vérifié par app.js */
  function handle(method, p, body, isAdmin) {
    try {
      if (method === 'GET' && p === '/api/salon/ping') {
        const d = get();
        return { status: 200, data: { ok: true, salon: true, at: Date.now(), membres: Object.keys(d.members).length, notes: Object.values(d.votes).filter(v => !v.deleted).length } };
      }
      if (method === 'POST' && p === '/api/salon/sync') {
        const r = merge(body, 'wifi');
        return { status: 200, data: { ok: true, ...r, ...shared(), at: Date.now() } };
      }
      if (!isAdmin) return { status: 401, data: { ok: false, error: 'Accès hôte requis (code animateur).' } };
      if (method === 'GET' && p === '/api/salon/data') {
        const d = get();
        return { status: 200, data: { ok: true, data: { members: d.members, votes: d.votes, wines: d.wines, communes: d.communes }, syncs: d.syncs.slice(-50), alert: store.alert() } };
      }
      if (method === 'GET' && p === '/api/salon/backup') {
        const d = get();
        return { status: 200, data: { app: 'lhvc-salon-sauvegarde', v: 1, at: Date.now(), members: d.members, votes: d.votes, wines: d.wines, communes: d.communes },
          download: `sauvegarde-salon-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json` };
      }
      if (method === 'POST' && p === '/api/salon/import') {
        const list = Array.isArray(body.payloads) ? body.payloads.slice(0, 100) : [body];
        const out = list.map(x => { try { return { ok: true, name: x?.member?.name, ...merge(x, 'fichier') }; } catch (e) { return { ok: false, name: x?.member?.name, error: e.message }; } });
        return { status: 200, data: { ok: true, results: out } };
      }
      return { status: 404, data: { ok: false, error: 'Route inconnue' } };
    } catch (e) {
      return { status: e.status || 400, data: { ok: false, error: e.message } };
    }
  }

  return { handle, merge, shared, get, restore, reset, snapshot, alert: () => store.alert(), clearAlert: () => store.clearAlert() };
}

module.exports = { createSalon, cleanVote, cleanWine, memberIdFromSecret, ownerOf, LIMITS };
