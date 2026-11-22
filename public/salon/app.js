/* =========================================================
 * APPLI DU SALON — Lou Honda Vinasse Club · SAVIM Edition v1.2
 * - Tout est gardé sur le téléphone (localStorage) : on peut
 *   noter sans réseau, toute la journée.
 * - Dès que le téléphone retrouve le serveur de l'hôte, il lui
 *   renvoie ses notes (automatique), sinon : fichier à envoyer.
 * - Navigation par vignettes, 3 touches pour noter un vin.
 * ========================================================= */
(() => {
  'use strict';
  const { DB, Fiches } = window.LHVC_SALON;
  const VERSION = '1.2';
  const TEST = new URLSearchParams(location.search).has('test');
  const KEY = TEST ? 'lhvc_salon_test' : 'lhvc_salon_v1';      // le mode test a sa propre mémoire : les vraies notes ne sont jamais mélangées
  const MAX_COEURS = 3;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
  const rid = (p = '') => { const a = new Uint8Array(9); crypto.getRandomValues(a); return p + [...a].map(b => (b % 36).toString(36)).join(''); };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* ---------- Mémoire du téléphone ---------- */
  const blank = () => ({ v: 1, me: null, votes: {}, wines: {}, communes: {}, known: { members: {}, wines: {}, communes: {} },
    host: '', changed: 0, lastSyncOk: 0, lastTry: 0, recent: [], serverSeen: false });
  let S = blank();
  let storageOk = true;
  try { S = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; S.known = { ...blank().known, ...S.known }; } catch { storageOk = false; }
  /* Identité (audit SV-01) : un secret tiré au hasard, gardé sur ce téléphone ; l'identifiant public en est l'empreinte.
     Le serveur refuse toute note envoyée avec un identifiant qui ne correspond pas au secret. */
  const newSecret = () => rid('') + rid('') + rid('') + rid('');
  function makeIdentity(name, pref) { const secret = newSecret(); return { id: window.LHVC_SHA.memberIdFromSecret(secret), secret, name, pref }; }
  /* Téléphone inscrit avec la v1.0 (sans secret) : on lui donne une clé et on renomme ce qu'il a créé */
  function migrateIdentity() {
    if (!S.me || S.me.secret) return;
    const old = S.me.id; const me = makeIdentity(S.me.name, S.me.pref); S.me = me;
    const ren = {};
    for (const w of Object.values(S.wines)) { if (!/^c-m[0-9a-f]{32}-/.test(w.id)) { const nid = `c-${me.id}-${rid('')}`; ren[w.id] = nid; delete S.wines[w.id]; S.wines[nid] = { ...w, id: nid, by: me.id }; } }
    for (const c of Object.values(S.communes)) { if (!/^k-m[0-9a-f]{32}-/.test(c.id)) { const nid = `k-${me.id}-${rid('')}`; ren[c.id] = nid; delete S.communes[c.id]; S.communes[nid] = { ...c, id: nid, by: me.id, wine: ren[c.wine] || c.wine }; } }
    for (const v of Object.values(S.votes)) { v.by = me.id; if (ren[v.wine]) v.wine = ren[v.wine]; if (v.commune && ren[v.commune]) v.commune = ren[v.commune]; if (v.via === old) v.via = undefined; v.upd = Date.now(); }
    S.lastSyncOk = 0;
  }
  function save(changed = true) {
    if (changed) S.changed = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOk = true; } catch { storageOk = false; }
    paintDot();
  }

  if (S.me && !S.me.secret) { migrateIdentity(); S.changed = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { storageOk = false; } }   // pas save() : l'affichage n'existe pas encore

  /* ---------- Index de la base ---------- */
  const EXP = DB.exposants.map((e, i) => ({ ...e, num: i + 1 }));
  const EXP_BY = Object.fromEntries(EXP.map(e => [e.id, e]));
  const DBW = {};
  EXP.forEach(e => e.vins.forEach((w, j) => { DBW[w.id] = { ...w, exposant: e.id, code: `${e.num}.${j + 1}` }; }));
  const wine = id => DBW[id] || S.wines[id] || S.known.wines[id] || null;
  const winesOf = expId => [...(EXP_BY[expId]?.vins || []).map(w => DBW[w.id]),
    ...Object.values({ ...S.known.wines, ...S.wines }).filter(w => w.exposant === expId)];
  const communeOf = id => S.communes[id] || S.known.communes[id] || null;
  const memberName = id => id === S.me?.id ? S.me.name : (S.known.members[id]?.name || 'un copain');
  const myVotes = () => Object.values(S.votes).filter(v => !v.deleted);
  const myVoteFor = (wineId, track = 'stand', commune) => myVotes().find(v => v.track === track && (track === 'commune' ? v.commune === commune : v.wine === wineId));
  const coeursUsed = except => myVotes().filter(v => v.coeur && v.id !== except).length;
  const colorLabel = w => w ? ({ effervescent: '🫧 Bulles', moelleux: '🍯 Moelleux', doux: '🍯 Doux', 'demi-doux': '🍯 Demi-doux', jaune: '🟡 Vin jaune' }[w.type]
    || { rouge: '🔴 Rouge', blanc: '⚪ Blanc', 'rosé': '🌸 Rosé', orange: '🟠 Orange' }[w.couleur] || '❔ Couleur ?') : '';
  const dotClass = w => (['effervescent', 'moelleux', 'doux'].includes(w.type) ? w.type : w.couleur) || '';
  const labelTags = e => e.labels.map(l => `<span class="tag ${/HVE/.test(l) ? 'hve' : ''}">${esc(l)}</span>`).join('');

  /* ---------- Navigation ---------- */
  let view = { name: 'home', p: {} }, depth = 0, cleanup = null;
  const draft = {};
  /* Adresse mise dans les QR : sur le téléphone de l'hôte (localhost), on prend son adresse réseau, sinon les copains ne pourraient pas l'ouvrir */
  let SHARE_ORIGIN = location.origin;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    fetch('/api/host/info', { cache: 'no-store' }).then(r => r.json()).then(i => { if (i.origin && !/localhost/.test(i.origin)) SHARE_ORIGIN = i.origin; }).catch(() => {});
  }                                         // saisie en cours d'un vote (gardée si on va lire une fiche)
  function go(name, p = {}, { replace = false } = {}) {
    view = { name, p };
    if (replace) history.replaceState(view, ''); else { history.pushState(view, ''); depth++; }
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', e => { depth = Math.max(0, depth - 1); view = e.state || { name: 'home', p: {} }; render(); });
  $('#back').addEventListener('click', () => history.back());

  function render() {
    if (cleanup) { try { cleanup(); } catch { /* rien */ } cleanup = null; }
    // Mode consultation (sans profil) : on peut tout regarder, mais noter demande un prénom
    const NEED_PROFILE = ['vote', 'done', 'qr', 'commune', 'mine', 'sync', 'newwine', 'scan', 'code', 'settings', 'secours'];
    if (!S.me && view.name !== 'onboarding' && (!S.guest || NEED_PROFILE.includes(view.name))) {
      if (S.guest) toast('Pour noter, il faut d\'abord un prénom 🙂');
      view = { name: 'onboarding', p: {} };
    }
    const V = VIEWS[view.name] || VIEWS.home;
    const out = V(view.p || {});
    $('#app').innerHTML = (storageOk ? '' : '<p class="notice err">⚠️ Ce navigateur refuse de garder les notes (navigation privée ?). Ouvre l\'appli dans un onglet normal.</p>') + out.html;
    $('#title').innerHTML = out.title ? esc(out.title) : '<img src="img/logo.jpg" alt="" class="logo-mini">Vinasse Club · SAVIM';
    $('#back').hidden = view.name === 'home' || view.name === 'onboarding' || depth === 0;
    $('#tabbar').hidden = view.name === 'onboarding';
    document.querySelectorAll('#tabbar [data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === (out.tab || view.name)));
    if (out.after) cleanup = out.after() || null;
  }

  function toast(msg, kind = '') {
    const t = $('#toast'); t.textContent = msg; t.className = `toast show ${kind}`;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  /* ---------- Morceaux d'interface ---------- */
  const tile = (go, ico, label, small = '', cls = '', p) => `<button class="tile ${cls}" data-go="${go}" ${p ? `data-p='${esc(JSON.stringify(p))}'` : ''}><span class="ico">${ico}</span>${label}${small ? `<small>${small}</small>` : ''}</button>`;
  const expRow = (e, mode) => {
    const mine = myVotes().filter(v => wine(v.wine)?.exposant === e.id).length;
    return `<button class="rowc" data-go="exposant" data-p='${esc(JSON.stringify({ id: e.id, mode }))}'>
      <span class="num">${e.num}</span><span class="main"><span class="t">${esc(e.nom)}${labelTags(e)}</span>
      <span class="s">${esc(e.region)} · ${esc(e.appellations)}${e.vins.length ? ` · ${e.vins.length} vins` : ''}</span></span>
      ${mine ? `<span class="end">✓${mine}</span>` : '<span class="end">›</span>'}</button>`;
  };
  const wineRow = (w, p) => {
    const v = myVoteFor(w.id);
    const sub = [w.millesime, w.appellation, w.cepages].filter(Boolean).join(' · ');
    return `<button class="rowc" data-go="vote" data-p='${esc(JSON.stringify({ wine: w.id, ...p }))}'>
      <span class="main"><span class="t"><span class="dot ${dotClass(w)}"></span>${esc(w.nom)}${w.id.startsWith('c-') ? ' <span class="tag hve">ajouté</span>' : ''}</span>
      <span class="s">${esc(sub || colorLabel(w))}${w.aromes ? `<br>👃 ${esc(w.aromes)}` : ''}</span></span>
      <span class="end">${v ? `${fmt(v.note)}${v.coeur ? '❤️' : ''}` : '›'}</span></button>`;
  };
  const chip = (label, act, pressed, data = {}) => `<button class="chip" data-act="${act}" aria-pressed="${!!pressed}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${label}</button>`;
  const cepChips = text => Fiches.cepageIds(text).map(id => `<button class="chip link" data-go="cepage" data-p='{"id":"${id}"}'>🍇 ${esc(Fiches.CEPAGES[id].nom)}</button>`).join('');
  const mood = n => n === null || n === undefined ? 'Choisis ta note' : n < 6 ? '🤮 Vinaigre' : n < 8 ? '🤢 Piquette' : n < 10 ? '😕 Bof' : n < 12 ? '🙂 Ça se boit'
    : n < 14 ? '😊 Bon' : n < 16 ? '😍 Très bon' : n < 18 ? '🤩 Superbe' : '👑 Exceptionnel';

  /* ---------- Les écrans ---------- */
  const VIEWS = {};

  VIEWS.onboarding = () => ({
    html: `<div class="card center"><img src="img/logo.jpg" alt="" style="width:120px;border-radius:50%;border:3px solid var(--gold)">
      <h2>Bienvenue au SAVIM !</h2>
      <p class="hint">Tes notes restent sur ton téléphone, même sans réseau. Elles partent chez l'hôte dès que tu te reconnectes à son partage de connexion.</p></div>
      <div class="card"><label class="f" for="ob-name">Ton prénom (ou surnom)</label>
      <input id="ob-name" type="text" maxlength="30" autocomplete="nickname" value="${esc(S.me?.name || '')}" placeholder="Ex. : Titi">
      <label class="f">Ta couleur préférée</label>
      <div class="chips" id="ob-pref">${[['rouge', '🔴 Rouge'], ['blanc', '⚪ Blanc'], ['rosé', '🌸 Rosé'], ['', '🤷 Sans avis']].map(([k, l]) => chip(l, 'ob-pref', k === '', { v: k })).join('')}</div>
      <p class="hint">Sert seulement au badge « l'ouvert d'esprit » des résultats.</p>
      <button class="btn" data-act="ob-go">C'est parti 🍷</button></div>
      ${S.me ? '' : `<div class="card center"><p class="hint">Tu veux seulement préparer ta visite (exposants, cuvées, fiches) ?</p>
      <button class="btn ghost" data-act="ob-guest">👀 Juste consulter, sans profil</button></div>`}`,
  });

  VIEWS.home = () => {
    if (!S.me) return { html: `
      <div class="card center"><img src="img/logo.jpg" alt="" style="width:90px;border-radius:50%;border:3px solid var(--gold)">
        <h2>Prépare ta visite du SAVIM</h2>
        <p class="hint">${EXP.length} exposants, ${Object.keys(DBW).length} cuvées relevées, des fiches pour apprendre. Repère les stands qui te tentent !</p></div>
      <div class="tiles">
        ${tile('exposants', '🗺️', 'Exposants', 'filtres, cuvées', 'big')}
        ${tile('learn', '📚', 'Apprendre', 'cépages, régions…')}
        ${tile('pick', '🔎', 'Chercher', 'nom, village, cépage')}
      </div>
      <div class="card" style="margin-top:.8rem"><p class="hint">🥂 <strong>Le jour J</strong>, pour noter, ouvre l'appli depuis le QR de l'hôte
        (sur son partage de connexion). Tes notes seront alors reçues toutes seules.</p>
        <button class="btn ghost" data-act="ob-start">✍️ Créer mon profil maintenant</button></div>` };
    const n = myVotes().length;
    const pend = pending();
    const recent = S.recent.map(id => EXP_BY[id]).filter(Boolean).slice(0, 6);
    const comm = Object.values({ ...S.known.communes, ...S.communes }).sort((a, b) => b.at - a.at).slice(0, 3);
    return { html: `
      <p style="margin:.2rem 0 .7rem">Salut <strong>${esc(S.me.name)}</strong> 👋 ${n ? `· ${n} note${n > 1 ? 's' : ''}` : ''}</p>
      ${secoursOn() ? secoursCard() : ''}
      ${pend && !secoursOn() ? `<button class="notice" data-go="sync" style="width:100%;text-align:left">📤 ${pend} note${pend > 1 ? 's' : ''} pas encore chez l'hôte : rien ne presse, elles sont au chaud ici. Touche pour envoyer.</button>` : ''}
      <div class="tiles">
        ${tile('pick', '🥂', 'Je goûte au stand', 'exposant → vin → note', 'big')}
        ${tile('commune', '🍾', 'Bouteille commune', 'on la partage, on la note')}
        ${tile('scan', '📷', 'Scanner un QR', 'le vin d\'un copain')}
        ${tile('code', '🔢', 'Code d\'un vin', 'ex. : 47.3')}
        ${tile('exposants', '🗺️', 'Exposants', `${EXP.length} domaines`)}
        ${tile('learn', '📚', 'Apprendre', 'cépages, régions…')}
        ${tile('mine', '📒', 'Mes notes', n ? `${n} vin${n > 1 ? 's' : ''}` : 'aucune encore')}
        ${tile('sync', '📤', 'Envoyer à l\'hôte', S.lastSyncOk ? `dernier envoi ${new Date(S.lastSyncOk).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'pas encore envoyé')}
        ${tile('settings', '⚙️', 'Réglages', '')}
      </div>
      ${recent.length ? `<h3>Derniers stands</h3><div class="rows">${recent.map(e => expRow(e, 'taste')).join('')}</div>` : ''}
      ${comm.length ? `<h3>Bouteilles communes</h3><div class="rows">${comm.map(communeRow).join('')}</div>` : ''}` };
  };

  const communeRow = c => {
    const w = wine(c.wine) || { nom: 'Bouteille', couleur: '' }; const v = myVoteFor(c.wine, 'commune', c.id);
    return `<button class="rowc" data-go="vote" data-p='${esc(JSON.stringify({ wine: c.wine, track: 'commune', commune: c.id }))}'>
      <span class="num">🍾</span><span class="main"><span class="t"><span class="dot ${dotClass(w)}"></span>${esc(w.nom)}</span>
      <span class="s">proposée par ${esc(memberName(c.by))}${c.prix ? ` · ${fmt(c.prix)} €` : ''}</span></span>
      <span class="end">${v ? fmt(v.note) : 'Noter ›'}</span></button>`;
  };

  /* Choisir un exposant (pour goûter au stand, ou pour une bouteille commune) */
  VIEWS.pick = (p) => {
    const mode = p.mode || 'taste';
    const q = p.q || '';
    const reg = p.region || '';
    const regions = [...new Set(EXP.map(e => e.region))];
    const list = filterExp({ q, region: reg });
    const recent = S.recent.map(id => EXP_BY[id]).filter(Boolean);
    return { title: mode === 'commune' ? '🍾 Quelle bouteille ?' : '🥂 Quel stand ?', tab: mode === 'commune' ? 'home' : 'pick', html: `
      <input type="search" id="q" placeholder="🔎 Nom, village, appellation ou n°" value="${esc(q)}" data-input="pick-q" autocomplete="off">
      ${!q && !reg ? `${recent.length ? `<h3>Récents</h3><div class="rows">${recent.slice(0, 4).map(e => expRow(e, mode)).join('')}</div>` : ''}
        <h3>Par région</h3><div class="tiles three">${regions.map(r => `<button class="tile" data-act="pick-region" data-r="${esc(r)}"><span class="ico">${Fiches.REGIONS[r]?.emoji || '🍷'}</span>${esc(r)}<small>${EXP.filter(e => e.region === r).length}</small></button>`).join('')}</div>`
        : `${reg ? `<div class="chips" style="margin-top:.5rem">${chip(`✕ ${esc(reg)}`, 'pick-region', true, { r: '' })}</div>` : ''}
           <div class="rows" style="margin-top:.5rem" id="pick-list">${list.map(e => expRow(e, mode)).join('') || '<p class="hint">Aucun exposant trouvé. Le stand n\'est pas dans la liste ? Utilise « Autre stand » ci-dessous.</p>'}</div>`}
      <button class="btn ghost" data-go="newwine" data-p='${esc(JSON.stringify({ mode }))}'>➕ Autre stand (pas dans la liste)</button>` };
  };

  function filterExp({ q = '', region = '', couleur = '', label = '', cuvees = false }) {
    const n = norm(q).trim();
    return EXP.filter(e => {
      if (region && e.region !== region) return false;
      if (label === 'bio' && !e.labels.some(l => /AB|Demeter/.test(l))) return false;
      if (label === 'hve' && !e.labels.some(l => /HVE/.test(l))) return false;
      if (cuvees && !e.vins.length) return false;
      if (couleur && !winesOf(e.id).some(w => couleur === 'bulles' ? w.type === 'effervescent' : couleur === 'doux' ? ['moelleux', 'doux', 'demi-doux'].includes(w.type) : w.couleur === couleur)) return false;
      if (!n) return true;
      if (/^\d+$/.test(n)) return String(e.num) === n;
      return norm(`${e.nom} ${e.village} ${e.appellations} ${e.region}`).includes(n)
        || winesOf(e.id).some(w => norm(`${w.nom} ${w.cepages}`).includes(n));
    });
  }

  /* Parcourir les exposants (avec filtres) */
  VIEWS.exposants = (p) => {
    const f = { q: p.q || '', region: p.region || '', couleur: p.couleur || '', label: p.label || '', cuvees: !!p.cuvees };
    const sort = p.sort || 'num';
    let list = filterExp(f);
    if (sort === 'nom') list = [...list].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    if (sort === 'region') list = [...list].sort((a, b) => a.region.localeCompare(b.region, 'fr') || a.num - b.num);
    const regions = [...new Set(EXP.map(e => e.region))];
    const set = (k, v) => ({ k, v });
    return { title: '🗺️ Exposants', html: `
      <input type="search" placeholder="🔎 Domaine, village, cépage, n°…" value="${esc(f.q)}" data-input="exp-q" autocomplete="off">
      <div class="chips" style="margin-top:.5rem">${chip('Toutes régions', 'exp-f', !f.region, set('region', ''))}${regions.map(r => chip(`${Fiches.REGIONS[r]?.emoji || ''} ${esc(r)}`, 'exp-f', f.region === r, set('region', r))).join('')}</div>
      <div class="chips">${[['', 'Toutes couleurs'], ['rouge', '🔴 Rouge'], ['blanc', '⚪ Blanc'], ['rosé', '🌸 Rosé'], ['bulles', '🫧 Bulles'], ['doux', '🍯 Doux'], ['orange', '🟠 Orange']].map(([k, l]) => chip(l, 'exp-f', f.couleur === k, set('couleur', k))).join('')}</div>
      <div class="chips">${chip('🌱 Bio', 'exp-f', f.label === 'bio', set('label', f.label === 'bio' ? '' : 'bio'))}${chip('🍃 HVE', 'exp-f', f.label === 'hve', set('label', f.label === 'hve' ? '' : 'hve'))}${chip('📋 Avec cuvées', 'exp-f', f.cuvees, set('cuvees', f.cuvees ? '' : '1'))}
        ${chip('Tri : n°', 'exp-f', sort === 'num', set('sort', 'num'))}${chip('A→Z', 'exp-f', sort === 'nom', set('sort', 'nom'))}${chip('Région', 'exp-f', sort === 'region', set('sort', 'region'))}</div>
      <p class="hint">${list.length} exposant${list.length > 1 ? 's' : ''}${f.couleur ? ' (seulement ceux dont on connaît les cuvées)' : ''}</p>
      <div class="rows">${list.map(e => expRow(e, 'browse')).join('')}</div>` };
  };

  /* Fiche d'un exposant et liste de ses vins */
  VIEWS.exposant = (p) => {
    const e = EXP_BY[p.id]; if (!e) return VIEWS.home();
    const mode = p.mode || 'taste';
    const ws = winesOf(e.id);
    const colors = [...new Set(ws.map(dotClass).filter(Boolean))];
    const fc = p.c || '';
    const sort = p.sort || 'nom';
    let list = ws.filter(w => !fc || dotClass(w) === fc);
    if (sort === 'mil') list = [...list].sort((a, b) => (b.millesime || 0) - (a.millesime || 0));
    else if (sort === 'couleur') list = [...list].sort((a, b) => dotClass(a).localeCompare(dotClass(b)));
    const apps = Fiches.appellationsFor(e.appellations);
    const reg = Fiches.REGIONS[e.region];
    const track = mode === 'commune' ? { track: 'commune', newCommune: true } : {};
    return { title: `${e.num} · ${e.nom}`, tab: mode === 'browse' ? 'exposants' : 'pick', html: `
      <div class="card"><div class="t" style="font:1.2rem var(--serif);color:var(--wine)">${esc(e.nom)} ${labelTags(e)}</div>
        <p class="hint">📍 ${esc(e.village)} · ${esc(e.appellations)}</p>
        <div class="chips">${reg ? `<button class="chip link" data-go="region" data-p='${esc(JSON.stringify({ id: e.region }))}'>${reg.emoji} ${esc(e.region)}</button>` : ''}
          ${apps.map(a => `<button class="chip link" data-act="toggle" data-t="app-${esc(norm(a.nom).replace(/\W/g, ''))}">📜 ${esc(a.nom)}</button>`).join('')}
          ${e.labels.length ? `<button class="chip link" data-go="notion" data-p='{"id":"labels"}'>🌱 C'est quoi ${esc(e.labels[0])} ?</button>` : ''}</div>
        ${apps.map(a => `<div class="fiche hidden" id="app-${esc(norm(a.nom).replace(/\W/g, ''))}"><p><strong>${esc(a.nom)}</strong> : ${esc(a.cepages)}.</p><p class="fun">💡 ${esc(a.fait)}</p></div>`).join('')}
        ${e.site ? `<p class="hint" style="margin-top:.5rem">🌐 <a href="${esc(e.site)}" target="_blank" rel="noopener">Site du domaine</a> (s'il y a du réseau)</p>` : ''}</div>
      ${mode === 'commune' ? '<p class="notice">🍾 Choisis la bouteille que vous partagez.</p>' : ''}
      ${ws.length ? `<div class="chips">${chip('Toutes', 'exp-c', !fc, { c: '' })}${colors.map(c => chip(`<span class="dot ${c}"></span>${{ rouge: 'Rouge', blanc: 'Blanc', 'rosé': 'Rosé', orange: 'Orange', effervescent: 'Bulles', moelleux: 'Moelleux', doux: 'Doux' }[c] || c}`, 'exp-c', fc === c, { c })).join('')}
        ${chip('A→Z', 'exp-s', sort === 'nom', { s: 'nom' })}${chip('Millésime', 'exp-s', sort === 'mil', { s: 'mil' })}${chip('Couleur', 'exp-s', sort === 'couleur', { s: 'couleur' })}</div>
        <div class="rows">${list.map(w => wineRow(w, track)).join('')}</div>`
        : '<p class="notice">📋 Ses cuvées n\'ont pas pu être relevées sur son site. Ajoute celles que tu goûtes : elles serviront aux copains.</p>'}
      <button class="btn ghost" data-go="newwine" data-p='${esc(JSON.stringify({ exposant: e.id, mode }))}'>➕ Un vin qui n'est pas dans la liste</button>` };
  };

  /* Ajouter un vin (ou un stand) absent de la base */
  VIEWS.newwine = (p) => {
    const e = EXP_BY[p.exposant];
    return { title: '➕ Nouveau vin', html: `<div class="card">
      ${e ? `<p class="hint">Chez <strong>${esc(e.nom)}</strong></p>` : `<label class="f" for="nw-exp">Nom du stand / domaine</label><input id="nw-exp" type="text" maxlength="80" placeholder="Ex. : Domaine du Pastis">`}
      <label class="f" for="nw-nom">Nom de la cuvée</label><input id="nw-nom" type="text" maxlength="80" placeholder="Ex. : Cuvée des Fadas">
      <label class="f">Couleur</label><div class="chips" id="nw-c">${[['rouge', '🔴 Rouge'], ['blanc', '⚪ Blanc'], ['rosé', '🌸 Rosé'], ['orange', '🟠 Orange']].map(([k, l]) => chip(l, 'nw-c', false, { v: k })).join('')}</div>
      <label class="f">Type</label><div class="chips" id="nw-t">${[['sec', 'Sec / tranquille'], ['effervescent', '🫧 Bulles'], ['moelleux', '🍯 Moelleux'], ['doux', '🍯 Doux (VDN)']].map(([k, l]) => chip(l, 'nw-t', k === 'sec', { v: k })).join('')}</div>
      <details class="more"><summary>Plus de détails (facultatif)</summary>
        <label class="f" for="nw-mil">Millésime</label><input id="nw-mil" type="number" inputmode="numeric" min="1900" max="2100" placeholder="2023">
        <label class="f" for="nw-app">Appellation</label><input id="nw-app" type="text" maxlength="80" placeholder="Ex. : Bandol">
        <label class="f" for="nw-cep">Cépages</label><input id="nw-cep" type="text" maxlength="120" placeholder="Ex. : mourvèdre, grenache">
      </details>
      <button class="btn" data-act="nw-save" data-exp="${esc(p.exposant || '')}" data-mode="${esc(p.mode || 'taste')}">Continuer → noter</button></div>` };
  };

  /* Noter un vin */
  VIEWS.vote = (p) => {
    const w = wine(p.wine);
    if (!w) return { html: '<p class="notice err">Vin introuvable sur ce téléphone.</p>' };
    const e = EXP_BY[w.exposant];
    const track = p.track === 'commune' ? 'commune' : 'stand';
    const old = myVoteFor(w.id, track, p.commune);
    const dk = `${track}|${p.commune || w.id}`;
    const d = draft[dk] || (draft[dk] = old ? { ...old } : { note: null, coeur: false, achete: false, couleur: w.couleur ? undefined : '' });
    const c = track === 'commune' ? communeOf(p.commune) : null;
    const left = MAX_COEURS - coeursUsed(old?.id);
    const q = [10, 12, 14, 15, 16, 18];
    return { title: track === 'commune' ? '🍾 Bouteille commune' : '🥂 Ma note', tab: track === 'commune' ? 'home' : 'pick', html: `
      <div class="card wine-head"><div class="t"><span class="dot ${dotClass(w)}"></span>${esc(w.nom)}</div>
        <p class="hint">${esc([e?.nom || w.exposantLibre, w.millesime, w.appellation].filter(Boolean).join(' · '))}${w.code ? ` · code ${w.code}` : ''}</p>
        ${w.aromes ? `<p class="hint">👃 Annoncé : ${esc(w.aromes)}</p>` : ''}
        ${w.sourceFiche ? `<p class="hint">📖 D'après le catalogue du domaine : présence au stand non confirmée.</p>` : ''}
        ${p.via && p.via !== S.me.id ? `<p class="hint">📣 Partagé par ${esc(memberName(p.via))}</p>` : ''}
        ${c ? `<p class="hint">Proposée par ${esc(memberName(c.by))}${c.prix ? ` · ${fmt(c.prix)} €` : ''}</p>` : ''}
        <div class="chips">${cepChips(w.cepages)}${e && Fiches.REGIONS[e.region] ? `<button class="chip link" data-go="region" data-p='${esc(JSON.stringify({ id: e.region }))}'>${Fiches.REGIONS[e.region].emoji} ${esc(e.region)}</button>` : ''}</div></div>
      <div class="card">
        <div class="note-big" id="nb">${d.note === null ? '—' : fmt(d.note)}<small>/20</small></div>
        <div class="note-mood" id="nm">${mood(d.note)}</div>
        <input type="range" min="0" max="20" step="0.5" value="${d.note ?? 13}" data-input="note" aria-label="Note sur 20">
        <div class="quick">${q.map(n => `<button data-act="qnote" data-n="${n}" aria-pressed="${d.note === n}">${n}</button>`).join('')}</div>
        ${!w.couleur ? `<label class="f">Couleur ?</label><div class="chips">${[['rouge', '🔴 Rouge'], ['blanc', '⚪ Blanc'], ['rosé', '🌸 Rosé'], ['orange', '🟠 Orange']].map(([k, l]) => chip(l, 'v-col', d.couleur === k, { v: k })).join('')}</div>` : ''}
        <div class="toggles">
          <button class="toggle" data-act="v-coeur" aria-pressed="${!!d.coeur}" ${!d.coeur && left <= 0 ? 'disabled' : ''}>❤️ Coup de cœur<br><small>${d.coeur ? 'oui !' : `${left} restant${left > 1 ? 's' : ''}`}</small></button>
          <button class="toggle" data-act="v-achat" aria-pressed="${!!d.achete}">🛒 J'en ai acheté</button>
        </div>
        <details class="more" ${d.degre || d.degreReel || d.prix ? 'open' : ''}><summary>🌡️ Degré${track === 'commune' ? ', prix' : ''} (facultatif)</summary>
          <div class="btns2"><div><label class="f" for="v-deg">Je devine</label><input id="v-deg" type="number" inputmode="decimal" step="0.5" min="5" max="22" placeholder="13,5" value="${d.degre ?? ''}"></div>
          <div><label class="f" for="v-degr">Vrai (étiquette)</label><input id="v-degr" type="number" inputmode="decimal" step="0.1" min="5" max="22" placeholder="14" value="${d.degreReel ?? ''}"></div></div>
          ${track === 'commune' ? `<label class="f" for="v-prix">Prix de la bouteille (€)</label><input id="v-prix" type="number" inputmode="decimal" step="0.5" min="0" value="${d.prix ?? c?.prix ?? ''}">` : ''}
          <p class="hint">Rien n'est obligatoire : ça sert au badge « l'empégué »${track === 'commune' ? ' et à « la pépite »' : ''}.</p>
        </details>
        <label class="f" for="v-memo">📝 Mémo perso <small class="hint">(reste sur ton téléphone)</small></label>
        <input id="v-memo" type="text" maxlength="120" placeholder="Ex. : à racheter pour Noël" value="${esc(d.memo || '')}">
        <button class="btn" id="v-ok" data-act="v-save" data-p='${esc(JSON.stringify({ wine: w.id, track, commune: p.commune || null, via: p.via || null, newCommune: !!p.newCommune }))}' ${d.note === null ? 'disabled style="opacity:.5"' : ''}>✓ Valider ma note</button>
        ${old ? `<button class="btn ghost" data-act="v-del" data-id="${old.id}">🗑️ Supprimer cette note</button>` : ''}
      </div>`,
      after: () => { const r = document.querySelector('input[type=range]'); if (r && d.note === null) r.style.opacity = '.6'; },
    };
  };

  /* Après un vote : partager, continuer, apprendre un truc */
  VIEWS.done = (p) => {
    const v = S.votes[p.id]; if (!v) return VIEWS.home();
    const w = wine(v.wine) || {}; const e = EXP_BY[w.exposant];
    const ceps = Fiches.cepageIds(w.cepages);
    const facts = [...ceps.map(id => `🍇 ${Fiches.CEPAGES[id].nom} : ${Fiches.CEPAGES[id].fun}`),
      ...Fiches.appellationsFor(w.appellation || e?.appellations).map(a => `📜 ${a.nom} : ${a.fait}`),
      ...(e && Fiches.REGIONS[e.region] ? Fiches.REGIONS[e.region].faits.map(f => `${Fiches.REGIONS[e.region].emoji} ${f}`) : [])];
    const fact = facts.length ? facts[Math.floor(Math.random() * facts.length)] : null;
    return { title: '✅ Noté !', html: `
      <div class="card center"><div class="note-big">${fmt(v.note)}<small>/20</small></div><p>${mood(v.note)} ${v.coeur ? '❤️' : ''}</p>
        <p class="hint">${esc(w.nom)}${e ? ` · ${esc(e.nom)}` : ''}</p></div>
      ${fact ? `<div class="card fiche"><p class="fun">💡 <strong>Le savais-tu ?</strong> ${esc(fact)}</p></div>` : ''}
      <div class="tiles">
        ${tile('qr', '📤', v.track === 'commune' ? 'Montrer le QR aux copains' : 'Faire goûter aux copains', 'ils scannent, ils notent', 'big', { vote: v.id })}
        ${e && v.track === 'stand' ? tile('exposant', '🥂', 'Autre vin ici', esc(e.nom), '', { id: e.id, mode: 'taste' }) : ''}
        ${tile('pick', '🗺️', 'Autre stand', '')}
        ${tile('home', '🏠', 'Accueil', '')}
      </div>` };
  };

  /* QR à montrer : il ouvre directement la note du même vin chez le copain */
  VIEWS.qr = (p) => {
    const v = S.votes[p.vote]; if (!v) return VIEWS.home();
    const w = wine(v.wine);
    const payload = { t: v.track === 'commune' ? 'c' : 'w', by: S.me.id, n: S.me.name };
    if (DBW[w.id]) payload.w = w.id; else payload.wd = { id: w.id, nom: w.nom, couleur: w.couleur, type: w.type, exposant: w.exposant, exposantLibre: w.exposantLibre, appellation: w.appellation, cepages: w.cepages, millesime: w.millesime };
    if (v.track === 'commune') { const c = communeOf(v.commune); payload.c = { id: c.id, wine: c.wine, by: c.by, prix: c.prix, at: c.at }; }
    const url = `${SHARE_ORIGIN}${location.pathname}${location.search}#q=${b64e(JSON.stringify(payload))}`;
    return { title: '📤 À scanner', html: `
      <div class="qr">${qrSvg(url)}<p><strong>${esc(w.nom)}</strong></p>${w.code ? `<p class="hint">ou code</p><div class="code-big">${w.code}</div>` : ''}</div>
      <p class="hint center">Le copain scanne avec <strong>📷 Scanner</strong> dans son appli${w.code ? `, ou tape le code dans <strong>🔢 Code d'un vin</strong>` : ''}. Sa note reste secrète, la tienne aussi.</p>
      <button class="btn ghost" data-go="home">🏠 Accueil</button>` };
  };

  /* Scanner un QR (caméra de l'appli) */
  VIEWS.scan = () => {
    const can = window.isSecureContext && navigator.mediaDevices?.getUserMedia;
    return { title: '📷 Scanner', tab: 'scan', html: can
      ? `<div class="scan-box"><video id="cam" playsinline muted></video></div><p class="hint center" id="scan-msg">Vise le QR d'un copain…</p>
         <button class="btn ghost" data-go="code">🔢 Taper un code à la place</button>`
      : `<div class="notice">📷 Le navigateur bloque la caméra sur cette adresse (http). Deux solutions :<br>
         1) le copain te donne le <strong>code du vin</strong> (ex. 47.3) ;<br>2) scanne son QR avec l'<strong>appareil photo du téléphone</strong> : ça ouvre la note, si tu es sur le Wi-Fi de l'hôte ou sur la version en ligne de l'appli.</div>
         <button class="btn" data-go="code">🔢 Taper un code</button>`,
      after: can ? startScan : null };
  };

  function startScan() {
    let stream = null, stop = false, timer = null;
    const video = $('#cam');
    const done = text => { if (stop) return; stop = true; handleScanned(text); };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return stream.getTracks().forEach(t => t.stop());
        video.srcObject = stream; await video.play();
        let detector = null;
        if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; } }
        if (!detector) await loadScript('vendor/jsQR.js');
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
          if (stop) return;
          try {
            if (video.readyState >= 2) {
              if (detector) { const r = await detector.detect(video); if (r[0]) return done(r[0].rawValue); }
              else {
                const s = 480 / Math.max(video.videoWidth, video.videoHeight);
                canvas.width = video.videoWidth * s; canvas.height = video.videoHeight * s;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (r?.data) return done(r.data);
              }
            }
          } catch { /* image suivante */ }
          timer = setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        const m = $('#scan-msg'); if (m) m.innerHTML = `📷 Caméra refusée ou indisponible (${esc(e.name || e.message)}). Autorise la caméra pour ce site, ou tape le code.`;
      }
    })();
    return () => { stop = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); };
  }
  function loadScript(src) {
    return new Promise((ok, ko) => { if (window.jsQR) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  }
  function handleScanned(text) {
    const t = String(text || '');
    const m = t.match(/#q=([A-Za-z0-9_-]+)/);
    if (m) return openPayload(m[1], { replace: true });
    const h = t.match(/#host=([^&\s]+)/) || t.match(/^(https?:\/\/[^/]+)\/(salon|public\/salon\/?)?$/);
    if (h) { S.host = decodeURIComponent(h[1]).replace(/\/$/, ''); save(false); toast('📶 Adresse de l\'hôte enregistrée', 'ok'); return go('sync', {}, { replace: true }); }
    toast('Ce QR n\'est pas un vin du club 🤔', 'err'); go('home', {}, { replace: true });
  }
  function openPayload(b64, opts) {
    let d; try { d = JSON.parse(b64d(b64)); } catch { toast('QR illisible 🤔', 'err'); return go('home', {}, opts); }
    if (d.by && d.n && d.by !== S.me?.id) S.known.members[d.by] = { name: String(d.n).slice(0, 30) };
    if (d.wd && d.wd.id && String(d.wd.id).startsWith('c-') && !wine(d.wd.id)) S.known.wines[d.wd.id] = { ...d.wd, by: d.by };
    const wId = d.w || d.wd?.id;
    if (!wine(wId)) { save(false); toast('Vin inconnu sur ce téléphone', 'err'); return go('home', {}, opts); }
    if (d.t === 'c' && d.c?.id) { if (!communeOf(d.c.id)) S.known.communes[d.c.id] = { ...d.c }; save(false); return go('vote', { wine: wId, track: 'commune', commune: d.c.id, via: d.by }, opts); }
    save(false);
    go('vote', { wine: wId, via: d.by }, opts);
  }

  /* Taper le code d'un vin (n° exposant . n° cuvée) */
  VIEWS.code = () => ({ title: '🔢 Code d\'un vin', html: `<div class="card">
      <p class="hint">Le code est affiché sous chaque QR, et sur l'écran « Ma note ». Ex. <strong>47.3</strong> = 3e vin de l'exposant n°47. Juste <strong>47</strong> ouvre l'exposant.</p>
      <input id="code" type="text" inputmode="decimal" placeholder="47.3" style="font-size:1.6rem;text-align:center" autocomplete="off">
      <button class="btn" data-act="code-go">Ouvrir</button></div>`,
    after: () => { $('#code')?.focus(); } });

  /* Bouteille commune */
  VIEWS.commune = () => {
    const comm = Object.values({ ...S.known.communes, ...S.communes }).sort((a, b) => b.at - a.at);
    return { title: '🍾 Bouteille commune', tab: 'home', html: `
      <div class="card"><p>Vous ouvrez une bouteille ensemble ? Choisissez-la d'un commun accord, puis <strong>une seule personne</strong> la crée ici et montre le QR aux autres.</p>
      <button class="btn" data-go="pick" data-p='{"mode":"commune"}'>➕ Choisir la bouteille</button></div>
      ${comm.length ? `<h3>Déjà ouvertes</h3><div class="rows">${comm.map(communeRow).join('')}</div>` : '<p class="hint center">Aucune bouteille commune pour l\'instant.</p>'}` };
  };

  /* Mes notes */
  VIEWS.mine = (p) => {
    const t = p.t || 'stand';
    const vs = myVotes().filter(v => v.track === t).sort((a, b) => b.upd - a.upd);
    const all = myVotes();
    const avg = all.length ? all.reduce((s, v) => s + v.note, 0) / all.length : 0;
    return { title: '📒 Mes notes', html: `
      <div class="tiles three"><div class="tile"><span class="ico">${all.length}</span><small>vins notés</small></div>
        <div class="tile"><span class="ico">${all.length ? fmt(avg) : '—'}</span><small>ma moyenne</small></div>
        <div class="tile"><span class="ico">${coeursUsed()}/${MAX_COEURS}</span><small>❤️ donnés</small></div></div>
      <div class="chips" style="margin-top:.7rem">${chip('🥂 Aux stands', 'mine-t', t === 'stand', { t: 'stand' })}${chip('🍾 Communes', 'mine-t', t === 'commune', { t: 'commune' })}</div>
      <div class="rows">${vs.map(v => { const w = wine(v.wine) || { nom: '?' }; const e = EXP_BY[w.exposant];
        return `<button class="rowc" data-go="vote" data-p='${esc(JSON.stringify({ wine: v.wine, track: v.track, commune: v.commune }))}'>
          <span class="main"><span class="t"><span class="dot ${dotClass(w)}"></span>${esc(w.nom)}</span><span class="s">${esc(e?.nom || w.exposantLibre || '')}${v.memo ? ` · 📝 ${esc(v.memo)}` : ''}</span></span>
          <span class="end">${fmt(v.note)}${v.coeur ? '❤️' : ''}${v.achete ? '🛒' : ''}</span></button>`; }).join('') || '<p class="hint center">Rien ici pour l\'instant.</p>'}</div>
      <p class="hint center">Les notes des copains restent secrètes jusqu'aux résultats 🤫</p>` };
  };

  /* Apprendre */
  VIEWS.learn = (p) => {
    const t = p.t || 'cepages'; const c = p.c || '';
    let body = '';
    if (t === 'cepages') {
      const list = Object.entries(Fiches.CEPAGES).filter(([, x]) => !c || x.c === c).sort((a, b) => a[1].nom.localeCompare(b[1].nom, 'fr'));
      const count = id => EXP.filter(e => winesOf(e.id).some(w => Fiches.cepageIds(w.cepages).includes(id))).length;
      body = `<div class="chips">${chip('Tous', 'learn-c', !c, { c: '' })}${chip('🔴 Rouges', 'learn-c', c === 'rouge', { c: 'rouge' })}${chip('⚪ Blancs', 'learn-c', c === 'blanc', { c: 'blanc' })}</div>
        <div class="rows">${list.map(([id, x]) => { const n = count(id); return `<button class="rowc" data-go="cepage" data-p='{"id":"${id}"}'><span class="num"><span class="dot ${x.c}"></span></span>
          <span class="main"><span class="t">${esc(x.nom)}</span><span class="s">${esc(x.gout)}</span></span><span class="end">${n ? `${n} 🏠` : '›'}</span></button>`; }).join('')}</div>`;
    } else if (t === 'regions') {
      body = `<div class="tiles">${Object.entries(Fiches.REGIONS).map(([k, r]) => tile('region', r.emoji, esc(k), `${EXP.filter(e => e.region === k).length} exposants`, '', { id: k })).join('')}</div>`;
    } else {
      body = `<div class="rows">${Fiches.NOTIONS.map(n => `<button class="rowc" data-go="notion" data-p='{"id":"${n.id}"}'><span class="main"><span class="t">${esc(n.titre)}</span><span class="s">${esc(n.txt)}</span></span><span class="end">›</span></button>`).join('')}</div>`;
    }
    return { title: '📚 Apprendre', tab: 'home', html: `<div class="chips">${chip('🍇 Cépages', 'learn-t', t === 'cepages', { t: 'cepages' })}${chip('🗺️ Régions', 'learn-t', t === 'regions', { t: 'regions' })}${chip('💡 Les bases', 'learn-t', t === 'notions', { t: 'notions' })}</div>${body}` };
  };

  VIEWS.cepage = (p) => {
    const x = Fiches.CEPAGES[p.id]; if (!x) return VIEWS.learn({});
    const exps = EXP.filter(e => winesOf(e.id).some(w => Fiches.cepageIds(w.cepages).includes(p.id)));
    const regs = Object.entries(Fiches.REGIONS).filter(([, r]) => r.cepages.includes(p.id)).map(([k]) => k);
    return { title: `🍇 ${x.nom}`, tab: 'home', html: `<div class="card fiche"><h2><span class="dot ${x.c}"></span>${esc(x.nom)}</h2>
      <p>📍 <strong>Où :</strong> ${esc(x.ou)}</p><p>👅 <strong>Le goût :</strong> ${esc(x.gout)}</p><p class="fun">💡 ${esc(x.fun)}</p></div>
      ${exps.length ? `<h3>À goûter au salon (cuvées relevées)</h3><div class="rows">${exps.map(e => expRow(e, 'taste')).join('')}</div>` : ''}
      ${regs.length ? `<h3>Régions où il est chez lui</h3><div class="chips">${regs.map(r => `<button class="chip link" data-go="region" data-p='${esc(JSON.stringify({ id: r }))}'>${Fiches.REGIONS[r].emoji} ${esc(r)}</button>`).join('')}</div>` : ''}` };
  };

  VIEWS.region = (p) => {
    const r = Fiches.REGIONS[p.id]; if (!r) return VIEWS.learn({ t: 'regions' });
    const n = EXP.filter(e => e.region === p.id).length;
    return { title: `${r.emoji} ${p.id}`, tab: 'home', html: `<div class="card fiche"><h2>${r.emoji} ${esc(p.id)}</h2><p>${esc(r.resume)}</p>
      <ul>${r.faits.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      <h3>Ses cépages</h3><div class="chips" style="flex-wrap:wrap">${r.cepages.map(id => `<button class="chip link" data-go="cepage" data-p='{"id":"${id}"}'>🍇 ${esc(Fiches.CEPAGES[id]?.nom || id)}</button>`).join('')}</div></div>
      ${n ? `<button class="btn" data-go="exposants" data-p='${esc(JSON.stringify({ region: p.id }))}'>🗺️ Voir les ${n} exposants</button>` : ''}` };
  };

  VIEWS.notion = (p) => {
    const n = Fiches.NOTIONS.find(x => x.id === p.id); if (!n) return VIEWS.learn({ t: 'notions' });
    return { title: n.titre, tab: 'home', html: `<div class="card fiche"><h2>${esc(n.titre)}</h2><p>${esc(n.txt)}</p></div>
      <button class="btn ghost" data-go="learn" data-p='{"t":"notions"}'>💡 Les autres bases</button>` };
  };

  /* Envoyer à l'hôte */
  VIEWS.sync = () => {
    const n = myVotes().length, pend = pending();
    const here = S.serverSeen && location.protocol === 'http:';
    const last = S.lastSyncOk ? new Date(S.lastSyncOk).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';
    return { title: '📤 Envoyer à l\'hôte', tab: 'home', html: `${n ? `<div class="card"><h3 style="margin-top:0">🛟 Secours par Internet (4G)</h3>
        <p class="hint">Loin du Wi-Fi de l'hôte : un message WhatsApp contient toutes tes notes ; l'hôte le colle dans sa page Résultats.</p>
        <button class="btn" data-act="sec-wa">💬 Envoyer par WhatsApp${S.hostWa ? ' à l\'hôte' : ''}</button></div>` : ''}
      <div class="card"><p><strong>${n}</strong> note${n > 1 ? 's' : ''} sur ce téléphone · dernier envoi réussi : <strong>${esc(last)}</strong></p>
        ${pend ? `<p class="notice">⏳ ${pend} note${pend > 1 ? 's' : ''} à envoyer.</p>` : n ? '<p class="notice ok">✅ L\'hôte a tout reçu.</p>' : ''}
        <p class="hint">Rien ne se perd : tes notes restent ici tant que tu ne vides pas le navigateur. Tu peux les renvoyer autant de fois que tu veux, rien n'est compté deux fois.</p></div>
      ${here || !location.protocol.startsWith('https') ? `<div class="card"><h3>📶 Par le Wi-Fi de l'hôte (automatique)</h3>
        <p class="hint">Reconnecte-toi au partage de connexion de l'hôte : l'envoi se fait tout seul. Ou touche :</p>
        <button class="btn" data-act="sync-now">📡 Envoyer maintenant</button></div>` : `<div class="card"><h3>📶 Par le Wi-Fi de l'hôte</h3>
        <p class="hint">1) Connecte-toi au partage de connexion de l'hôte. 2) Touche le bouton : une page de son serveur s'ouvre et reçoit tes notes.</p>
        <label class="f" for="host">Adresse de l'hôte</label><input id="host" type="text" placeholder="http://192.168.43.1:3000" value="${esc(S.host)}">
        <p class="hint">Plus simple : scanne le QR « Adresse » affiché sur le téléphone de l'hôte.</p>
        <button class="btn" data-act="sync-host">📶 Envoyer à l'hôte</button></div>`}
      <div class="card"><h3>📎 Par message (WhatsApp, SMS, mail…)</h3>
        <p class="hint">Si le Wi-Fi ne marche pas : envoie ce petit fichier à l'hôte. Il l'importe sur sa page Résultats.</p>
        <button class="btn gold" data-act="share-file">📎 Envoyer le fichier</button>
        <button class="btn ghost" data-act="copy-text">📋 Copier en texte</button></div>` };
  };

  VIEWS.settings = () => ({ title: '⚙️ Réglages', tab: 'home', html: `
    <div class="card"><label class="f" for="s-name">Prénom</label><input id="s-name" type="text" maxlength="30" value="${esc(S.me.name)}">
      <label class="f">Couleur préférée</label><div class="chips">${[['rouge', '🔴 Rouge'], ['blanc', '⚪ Blanc'], ['rosé', '🌸 Rosé'], ['', '🤷 Sans avis']].map(([k, l]) => chip(l, 's-pref', (S.me.pref || '') === k, { v: k })).join('')}</div>
      <label class="f" for="s-host">Adresse du serveur de l'hôte</label><input id="s-host" type="text" placeholder="http://192.168.43.1:3000" value="${esc(S.host)}">
      <button class="btn" data-act="s-save">Enregistrer</button></div>
    <div class="card"><h3>💾 Sauvegarde</h3>
      <button class="btn ghost" data-act="share-file">💾 Exporter mes notes (fichier)</button>
      <label class="btn ghost" style="cursor:pointer">📥 Restaurer un fichier<input type="file" accept=".json,application/json,text/plain" data-input="restore" hidden></label>
      <button class="btn red" data-act="wipe">🧹 Tout effacer sur ce téléphone</button></div>
    <p class="hint center">SAVIM Edition v${VERSION}${TEST ? ' · 🧪 MODE TEST' : ''} · ${EXP.length} exposants · ${Object.keys(DBW).length} cuvées relevées le ${esc(DB.releve.split('-').reverse().join('/'))}<br>
    Mode ${location.protocol === 'https:' ? 'en ligne (marche hors connexion)' : 'Wi-Fi de l\'hôte'} · <a href="resultats.html${location.search}">🏆 Page Résultats (hôte)</a></p>` });

  /* ---------- Actions ---------- */
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { let p = {}; try { p = JSON.parse(g.dataset.p || '{}'); } catch { /* rien */ } return go(g.dataset.go, p); }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = ACTS[a.dataset.act]; if (act) act(a, e);
  });
  const setP = (patch) => { view.p = { ...view.p, ...patch }; history.replaceState(view, ''); render(); };
  const dk = () => `${view.p.track === 'commune' ? 'commune' : 'stand'}|${view.p.commune || view.p.wine}`;
  const ACTS = {
    'ob-pref': a => { document.querySelectorAll('#ob-pref .chip').forEach(c => c.setAttribute('aria-pressed', c === a)); },
    'ob-go': () => {
      const name = $('#ob-name').value.trim(); if (!name) return toast('Ton prénom d\'abord 🙂', 'err');
      const pref = document.querySelector('#ob-pref [aria-pressed=true]')?.dataset.v || '';
      S.me = S.me?.secret ? { ...S.me, name: name.slice(0, 30), pref } : makeIdentity(name.slice(0, 30), pref); S.guest = false; save(); history.replaceState({ name: 'home', p: {} }, ''); view = { name: 'home', p: {} }; render(); trySync();
      const pq = sessionStorage.getItem('lhvc_pending_q'); if (pq) { sessionStorage.removeItem('lhvc_pending_q'); openPayload(pq, {}); }
    },
    'ob-guest': () => { S.guest = true; save(false); history.replaceState({ name: 'home', p: {} }, ''); view = { name: 'home', p: {} }; render(); },
    'ob-start': () => go('onboarding'),
    'sec-wa': () => { location.href = whatsappUrl(); },
    'pick-region': a => setP({ region: a.dataset.r, q: '' }),
    'exp-f': a => setP({ [a.dataset.k]: a.dataset.v }),
    'exp-c': a => setP({ c: a.dataset.c }),
    'exp-s': a => setP({ sort: a.dataset.s }),
    'learn-t': a => setP({ t: a.dataset.t, c: '' }),
    'learn-c': a => setP({ c: a.dataset.c }),
    'mine-t': a => setP({ t: a.dataset.t }),
    toggle: a => document.getElementById(a.dataset.t)?.classList.toggle('hidden'),
    qnote: a => setNote(Number(a.dataset.n)),
    'v-col': a => { draft[dk()].couleur = a.dataset.v; keepInputs(); render(); },
    'v-coeur': () => { const d = draft[dk()]; d.coeur = !d.coeur; keepInputs(); render(); },
    'v-achat': () => { const d = draft[dk()]; d.achete = !d.achete; keepInputs(); render(); },
    'v-save': a => saveVote(JSON.parse(a.dataset.p)),
    'v-del': a => {
      if (!confirm('Supprimer cette note ?')) return;
      const v = S.votes[a.dataset.id]; v.deleted = true; v.upd = Date.now(); delete draft[dk()]; save(); toast('Note supprimée'); trySync(); history.back();
    },
    'nw-c': a => { document.querySelectorAll('#nw-c .chip').forEach(c => c.setAttribute('aria-pressed', c === a)); },
    'nw-t': a => { document.querySelectorAll('#nw-t .chip').forEach(c => c.setAttribute('aria-pressed', c === a)); },
    'nw-save': a => {
      const nom = $('#nw-nom').value.trim(); if (!nom) return toast('Le nom de la cuvée 🙂', 'err');
      const libre = $('#nw-exp')?.value.trim() || '';
      if (!a.dataset.exp && !libre) return toast('Le nom du stand 🙂', 'err');
      const w = { id: `c-${S.me.id}-${rid('')}`, by: S.me.id, exposant: a.dataset.exp || undefined, exposantLibre: libre, nom: nom.slice(0, 80),
        couleur: document.querySelector('#nw-c [aria-pressed=true]')?.dataset.v || '', type: document.querySelector('#nw-t [aria-pressed=true]')?.dataset.v || 'sec',
        millesime: Number($('#nw-mil').value) || null, appellation: $('#nw-app').value.trim().slice(0, 80), cepages: $('#nw-cep').value.trim().slice(0, 120), aromes: '', at: Date.now() };
      S.wines[w.id] = w; save();
      go('vote', a.dataset.mode === 'commune' ? { wine: w.id, track: 'commune', newCommune: true } : { wine: w.id }, { replace: true });
    },
    'code-go': () => {
      const m = $('#code').value.trim().replace(',', '.').match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
      const e = m && EXP[Number(m[1]) - 1];
      if (!e) return toast('Code inconnu 🤔', 'err');
      if (!m[2]) return go('exposant', { id: e.id, mode: 'taste' }, { replace: true });
      const w = e.vins[Number(m[2]) - 1]; if (!w) return toast(`L'exposant ${m[1]} n'a pas de vin n°${m[2]}`, 'err');
      go('vote', { wine: w.id }, { replace: true });
    },
    'sync-now': async () => { const r = await trySync(true); toast(r ? '✅ Notes envoyées à l\'hôte' : '📡 Serveur de l\'hôte injoignable : es-tu sur son Wi-Fi ?', r ? 'ok' : 'err'); render(); },
    'sync-host': () => {
      const h = ($('#host').value.trim() || S.host).replace(/\/$/, '');
      if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(h)) return toast('Adresse du type http://192.168.43.1:3000', 'err');
      S.host = h; save(false);
      location.href = `${h}/public/salon/recu.html#d=${b64e(JSON.stringify(payload()))}`;
    },
    'share-file': () => shareFile(),
    'copy-text': async () => { try { await navigator.clipboard.writeText(JSON.stringify(payload())); toast('📋 Copié : colle-le dans un message à l\'hôte', 'ok'); } catch { prompt('Copie ce texte :', JSON.stringify(payload())); } },
    's-pref': a => { document.querySelectorAll('[data-act=s-pref]').forEach(c => c.setAttribute('aria-pressed', c === a)); },
    's-save': () => {
      const name = $('#s-name').value.trim(); if (!name) return toast('Prénom vide 🙂', 'err');
      S.me.name = name.slice(0, 30); S.me.pref = document.querySelector('[data-act=s-pref][aria-pressed=true]')?.dataset.v ?? S.me.pref;
      S.host = $('#s-host').value.trim().replace(/\/$/, ''); save(); toast('✅ Enregistré', 'ok'); trySync();
    },
    wipe: () => {
      if (TEST ? !confirm('Effacer toutes les notes de TEST de ce téléphone ?') : prompt('Pour tout effacer (tes notes aussi !), tape EFFACER') !== 'EFFACER') return;
      S = blank(); save(); history.replaceState({ name: 'onboarding', p: {} }, ''); view = { name: 'onboarding', p: {} }; render();
    },
  };

  function keepInputs() {
    const d = draft[dk()]; if (!d) return;
    const val = id => { const el = document.getElementById(id); if (!el || el.value === '') return undefined; const n = Number(String(el.value).replace(',', '.')); return isFinite(n) ? n : undefined; };
    d.degre = val('v-deg'); d.degreReel = val('v-degr'); if ($('#v-prix')) d.prix = val('v-prix');
    const memo = $('#v-memo'); if (memo) d.memo = memo.value.slice(0, 120);
  }
  function setNote(n) {
    const d = draft[dk()]; if (!d) return;
    d.note = Math.max(0, Math.min(20, Math.round(n * 2) / 2));
    $('#nb').innerHTML = `${fmt(d.note)}<small>/20</small>`; $('#nm').textContent = mood(d.note);
    const r = document.querySelector('input[type=range]'); if (r) { r.value = d.note; r.style.opacity = 1; }
    document.querySelectorAll('[data-act=qnote]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.n) === d.note));
    const ok = $('#v-ok'); ok.disabled = false; ok.style.opacity = 1;
  }

  function saveVote(p) {
    keepInputs();
    const key = `${p.track}|${p.commune || p.wine}`;
    const d = draft[key]; if (!d || d.note === null) return toast('Choisis une note 🙂', 'err');
    const w = wine(p.wine);
    let commune = p.commune;
    if (p.track === 'commune' && !commune) {                 // première note d'une nouvelle bouteille commune
      commune = `k-${S.me.id}-${rid('')}`; S.communes[commune] = { id: commune, wine: w.id, by: S.me.id, prix: d.prix, at: Date.now() };
    }
    const old = myVoteFor(w.id, p.track, commune);
    const now = Date.now();
    const v = { ...(old || {}), id: old?.id || rid('v'), by: S.me.id, wine: w.id, track: p.track, commune: p.track === 'commune' ? commune : undefined,
      note: d.note, coeur: !!d.coeur && (d.coeur && coeursUsed(old?.id) < MAX_COEURS), achete: !!d.achete,
      degre: d.degre, degreReel: d.degreReel, prix: p.track === 'commune' ? d.prix : undefined, couleur: d.couleur || undefined,
      memo: d.memo || '', via: old?.via || (p.via && p.via !== S.me.id ? p.via : undefined), at: old?.at || now, upd: now, deleted: false };
    S.votes[v.id] = v;
    if (w.exposant) S.recent = [w.exposant, ...S.recent.filter(x => x !== w.exposant)].slice(0, 8);
    delete draft[key]; delete draft[`${p.track}|${p.wine}`];
    save(); setTimeout(() => trySync(), 800);
    go('done', { id: v.id }, { replace: true });
  }

  document.addEventListener('input', e => {
    const k = e.target.dataset.input; if (!k) return;
    if (k === 'note') return setNote(Number(e.target.value));
    if (k === 'pick-q' || k === 'exp-q') {
      clearTimeout(document.t); const v = e.target.value;
      document.t = setTimeout(() => { view.p = { ...view.p, q: v, ...(k === 'pick-q' ? { region: '' } : {}) }; history.replaceState(view, ''); render();
        const el = document.querySelector(`[data-input=${k}]`); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 220);
    }
  });
  document.addEventListener('change', async e => {
    if (e.target.dataset.input !== 'restore') return;
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'lhvc-salon' || !d.member?.secret || window.LHVC_SHA.memberIdFromSecret(d.member.secret) !== d.member.id) throw new Error('format');
      if (S.me && d.member.id !== S.me.id && !confirm(`Ce fichier appartient à ${d.member.name}. Le restaurer ici remplace ton identité. Continuer ?`)) return;
      S.me = d.member; S.guest = false; (d.votes || []).forEach(v => { if (!S.votes[v.id] || (v.upd || 0) > (S.votes[v.id].upd || 0)) S.votes[v.id] = v; });
      (d.wines || []).forEach(w => { S.wines[w.id] = w; }); (d.communes || []).forEach(c => { S.communes[c.id] = c; });
      save(); toast('✅ Notes restaurées', 'ok'); go('home', {}, { replace: true });
    } catch { toast('Fichier illisible 🤔', 'err'); }
  });

  /* ---------- Envoi à l'hôte ---------- */
  function payload() {
    return { app: 'lhvc-salon', v: 1, at: Date.now(), member: S.me,
      votes: Object.values(S.votes).map(({ memo, ...v }) => v),          // le mémo perso ne quitte jamais le téléphone
      // mes créations, plus celles des copains que j'ai notées (relais : utile si le copain n'a pas encore envoyé)
      wines: [...Object.values(S.wines), ...Object.values(S.votes).map(v => !S.wines[v.wine] && S.known.wines[v.wine]).filter(Boolean)],
      communes: [...Object.values(S.communes), ...Object.values(S.votes).map(v => v.commune && !S.communes[v.commune] && S.known.communes[v.commune]).filter(Boolean)] };
  }
  const pending = () => Object.values(S.votes).filter(v => (v.upd || 0) > S.lastSyncOk).length;
  let syncing = false;
  async function trySync(manual = false) {
    if (!S.me || syncing) return false;
    if (location.protocol === 'https:' && !manual) return false;        // version en ligne : pas de serveur ici
    syncing = true; paintDot('wait');
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
    try {
      const sent = Date.now();
      const r = await fetch('/api/salon/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()), signal: ctl.signal, cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) { if (r.status === 403) toast(`⚠️ ${d.error}`, 'err'); throw new Error(d.error); }
      S.serverSeen = true; S.lastSyncOk = sent; S.lostAt = 0; secoursWarned = false;
      if (d.hote && typeof d.hote.whatsapp === 'string') S.hostWa = d.hote.whatsapp;
      for (const [id, m] of Object.entries(d.members || {})) if (id !== S.me.id) S.known.members[id] = m;
      for (const [id, w] of Object.entries(d.wines || {})) if (!S.wines[id]) S.known.wines[id] = w;
      for (const [id, c] of Object.entries(d.communes || {})) if (!S.communes[id]) S.known.communes[id] = c;
      save(false);
      if (['home', 'sync', 'commune'].includes(view.name)) render();
      return true;
    } catch {
      // déjà vu l'hôte, et il ne répond plus : on a quitté son partage de connexion
      if (S.serverSeen && location.protocol === 'http:' && !S.lostAt) { S.lostAt = Date.now(); save(false); }
      if (secoursOn() && !secoursWarned) { secoursWarned = true; toast(`🛟 Hors du Wi-Fi de l'hôte : ${pending()} note(s) pas encore reçue(s). Accueil → Secours`, 'err'); if (view.name === 'home') render(); }
      paintDot(); return false;
    } finally { clearTimeout(to); syncing = false; paintDot(); }
  }

  /* ---------- Secours : notes à l'abri même loin du partage de connexion ----------
     Un téléphone qui a quitté le partage ne peut plus joindre le serveur de l'hôte (il n'est pas sur Internet).
     Le secours passe donc par Internet (4G) : un message WhatsApp prêt à envoyer à l'hôte, en un geste,
     ou le fichier. L'hôte colle le message dans Résultats → « Coller un texte reçu ». */
  let secoursWarned = false;
  const secoursOn = () => !!S.me && pending() > 0 && (location.protocol === 'https:' || (!!S.lostAt && Date.now() - S.lostAt > 60e3));
  function secoursText() {
    return `🍷 LHVC · notes de ${S.me.name} (${myVotes().length} vins). Hôte : copie tout ce message et colle-le dans Résultats → « Coller un texte reçu ».\nLHVC1:${b64e(JSON.stringify(payload()))}`;
  }
  const whatsappUrl = () => `https://wa.me/${S.hostWa || ''}?text=${encodeURIComponent(secoursText())}`;
  function secoursCard() {
    const n = pending();
    return `<div class="card" style="border:2px solid var(--red)"><h3 style="margin-top:0">🛟 Secours : ${n} note${n > 1 ? 's' : ''} pas encore chez l'hôte</h3>
      <p class="hint">${location.protocol === 'https:' ? 'Tu utilises la version en ligne.' : 'Tu as quitté le Wi-Fi de l\'hôte.'} Rien n'est perdu : elles sont sur ce téléphone.
      Pour les mettre aussi à l'abri chez l'hôte dès maintenant (par la 4G) :</p>
      <button class="btn" data-act="sec-wa">💬 Envoyer par WhatsApp${S.hostWa ? ' à l\'hôte' : ''}</button>
      <button class="btn ghost" data-act="share-file">📎 Envoyer le fichier</button>
      <p class="hint">Revenir sur son Wi-Fi suffit aussi : l'envoi repart tout seul, sans double compte.</p></div>`;
  }
  function paintDot(state) {
    const d = $('#syncDot'); if (!d) return;
    const pend = pending();
    d.className = `sync-dot ${state || (pend ? 'wait' : S.lastSyncOk ? 'ok' : 'off')}`;
    d.title = pend ? `${pend} note(s) à envoyer à l'hôte` : S.lastSyncOk ? 'Tout est chez l\'hôte' : 'Jamais envoyé';
  }
  async function shareFile() {
    const txt = JSON.stringify(payload());
    const name = `notes-${norm(S.me.name).replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    try {
      const file = new File([txt], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Mes notes du SAVIM', text: `Notes de ${S.me.name} (${myVotes().length} vins)` }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('💾 Fichier enregistré dans Téléchargements : envoie-le à l\'hôte', 'ok');
  }

  /* ---------- Outils ---------- */
  function b64e(str) { const b = new TextEncoder().encode(str); let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
  function qrSvg(text) {
    if (!window.qrcode) return '<p>QR indisponible</p>';
    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    const q = window.qrcode(0, 'L'); q.addData(String(text), 'Byte'); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  /* ---------- Démarrage ---------- */
  const h = location.hash;
  const qm = h.match(/#q=([A-Za-z0-9_-]+)/);
  const hm = h.match(/#host=([^&]+)/);
  if (hm) { S.host = decodeURIComponent(hm[1]).replace(/\/$/, ''); save(false); }
  if (h) history.replaceState(null, '', location.pathname + location.search);
  if (TEST) { const b = document.createElement('div'); b.className = 'testband'; b.textContent = '🧪 MODE TEST · notes d\'essai, séparées des vraies'; document.querySelector('.topbar').after(b); }
  history.replaceState(view, '');
  render();
  if (qm && S.me) openPayload(qm[1], {});
  else if (qm) { sessionStorage.setItem('lhvc_pending_q', qm[1]); }
  const pq = sessionStorage.getItem('lhvc_pending_q');
  if (pq && S.me) { sessionStorage.removeItem('lhvc_pending_q'); openPayload(pq, {}); }
  paintDot();
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  trySync();
  setInterval(() => { if (pending() || Date.now() - S.lastSyncOk > 120000) trySync(); }, 15000);
  window.addEventListener('online', () => trySync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') trySync(); });
  window.LHVC_SALON.debug = { get S() { return S; }, get share() { return SHARE_ORIGIN; }, go, trySync };
})();
