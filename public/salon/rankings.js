/* =========================================================
 * RANKINGS (mode SAVIM) — Tous les classements du salon,
 * calculés à partir des votes fusionnés. Aucun bonus/malus :
 * ni prix, ni caviste, ni distance, ni charclage.
 * Utilisé par la page Résultats (navigateur) et par les tests (Node).
 * ========================================================= */
(function (root) {
  const RULES = {
    minVotes: 2,          // votes minimum pour un podium « vin »
    minVotesSd: 3,        // pour clivant / corda / olympique
    bayesK: 2,            // poids de la moyenne générale pour les vins peu notés
    minPerson: 3,         // votes minimum pour les classements de personnes
    minCommon: 3,         // vins en commun pour comparer deux palais
    top: 5,
  };

  const MAX_COEURS = 3;
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;

  /* Garde le dernier vote de chacun pour un même vin dans une même « piste » */
  function latestVotes(votes) {
    const by = new Map();
    for (const v0 of votes) {
      if (!v0 || v0.deleted || typeof v0.note !== 'number' || !isFinite(v0.note) || v0.note < 0 || v0.note > 20) continue;
      const v = { ...v0 };
      const k = `${v.by}|${v.track}|${v.track === 'commune' ? v.commune : v.wine}`;
      const prev = by.get(k);
      if (!prev || (v.upd || v.at || 0) >= (prev.upd || prev.at || 0)) by.set(k, v);
    }
    // 3 coups de cœur au plus par personne, même pour des fichiers importés sans serveur (les plus anciens comptent)
    const out = [...by.values()];
    const seen = {};
    out.filter(v => v.coeur).sort((a, b) => (a.at || 0) - (b.at || 0)).forEach(v => {
      seen[v.by] = (seen[v.by] || 0) + 1;
      if (seen[v.by] > MAX_COEURS) v.coeur = false;
    });
    return out;
  }

  function compute(data, ctx) {
    const { DB, Fiches } = ctx;
    const members = data.members || {};
    const allVotes = latestVotes(Object.values(data.votes || {}));
    const customWines = data.wines || {};
    const communes = data.communes || {};
    const expById = Object.fromEntries(DB.exposants.map(e => [e.id, e]));
    const wineById = {};
    DB.exposants.forEach(e => e.vins.forEach(w => { wineById[w.id] = { ...w, exposant: e.id }; }));
    Object.values(customWines).forEach(w => { wineById[w.id] = { ...w }; });
    const nameOf = id => members[id]?.name || '???';
    const wine = id => wineById[id] || { id, nom: 'Vin inconnu', couleur: '', type: 'sec', cepages: '' };
    const colorOf = (v, w) => v.couleur || w.couleur || '';

    function trackRankings(track) {
      const votes = allVotes.filter(v => v.track === track);
      const keyOf = v => track === 'commune' ? v.commune : v.wine;
      const groups = new Map();
      for (const v of votes) { const k = keyOf(v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
      const globalMean = mean(votes.map(v => v.note));
      const overallSd = sd(votes.map(v => v.note)) || 1;
      // normalisation : z-score de chaque votant (s'il a assez de votes)
      const voterStats = {};
      for (const v of votes) (voterStats[v.by] = voterStats[v.by] || []).push(v.note);
      const norm = v => {
        const a = voterStats[v.by];
        if (a.length < RULES.minPerson || sd(a) === 0) return v.note;
        return globalMean + ((v.note - mean(a)) / sd(a)) * overallSd;
      };
      const items = [...groups.entries()].map(([k, vs]) => {
        const c = track === 'commune' ? communes[k] || {} : null;
        const wId = track === 'commune' ? (c.wine || vs[0].wine) : k;
        const w = wine(wId);
        const notes = vs.map(v => v.note).sort((a, b) => a - b);
        const n = notes.length;
        const m = mean(notes);
        const prix = track === 'commune' ? (c.prix || mean(vs.map(v => v.prix).filter(x => x > 0)) || null) : null;
        return {
          key: k, wine: w, exposant: expById[w.exposant] || null, n,
          couleur: colorOf(vs.find(v => v.couleur) || {}, w), type: w.type || 'sec',
          mean: r2(m), bayes: r2((n * m + RULES.bayesK * globalMean) / (n + RULES.bayesK)),
          norm: r2(mean(vs.map(norm))), sd: r2(sd(notes)),
          olymp: n >= 3 ? r2(mean(notes.slice(1, -1))) : null,
          coeurs: vs.filter(v => v.coeur).length, achats: vs.filter(v => v.achete).length,
          voters: vs.map(v => v.by), prix: prix ? r2(prix) : null,
        };
      });
      const enough = items.filter(i => i.n >= RULES.minVotes);
      // groupe séparé : si trop peu de vins ont 2 votes, on accepte les vins à 1 vote (signalé)
      const pool = enough.length >= 3 ? enough : items;
      const top = (arr, f, asc = false) => [...arr].sort((a, b) => asc ? f(a) - f(b) : f(b) - f(a)).slice(0, RULES.top);
      const sdPool = items.filter(i => i.n >= RULES.minVotesSd);
      const byColor = pred => top(pool.filter(pred), i => i.bayes);

      // regroupements (domaine, région, cépage, label)
      const agg = (keyFn) => {
        const g = {};
        for (const v of votes) {
          const it = items.find(i => i.key === keyOf(v)); if (!it) continue;
          for (const k of [].concat(keyFn(it) || [])) (g[k] = g[k] || []).push(v.note);
        }
        return Object.entries(g).filter(([, a]) => a.length >= RULES.minVotes)
          .map(([k, a]) => ({ key: k, mean: r2(mean(a)), n: a.length })).sort((a, b) => b.mean - a.mean);
      };
      const labelGroup = it => {
        const l = it.exposant?.labels || [];
        return l.some(x => /AB|Demeter/i.test(x)) ? '🌱 Bio / biodynamie' : l.some(x => /HVE/i.test(x)) ? '🍃 HVE' : '⚙️ Sans label';
      };
      return {
        track, items, nVotes: votes.length, globalMean: r2(globalMean || 0), lowData: pool !== enough,
        general: top(pool, i => i.bayes),
        normalise: top(pool, i => i.norm),
        olympique: top(sdPool, i => i.olymp),
        clivant: sdPool.length >= 3 ? top(sdPool, i => i.sd) : [],
        corda: sdPool.length >= 3 ? top(sdPool, i => i.sd, true) : [],
        rouge: byColor(i => i.couleur === 'rouge' && !['moelleux', 'doux', 'effervescent'].includes(i.type)),
        blanc: byColor(i => i.couleur === 'blanc' && !['moelleux', 'doux', 'effervescent'].includes(i.type)),
        rose: byColor(i => i.couleur === 'rosé' && i.type !== 'effervescent'),
        orange: byColor(i => i.couleur === 'orange'),
        doux: byColor(i => ['moelleux', 'doux', 'demi-doux'].includes(i.type)),
        bulles: byColor(i => i.type === 'effervescent'),
        coeur: top(items.filter(i => i.coeurs), i => i.coeurs * 100 + i.bayes),
        portefeuille: top(items.filter(i => i.achats), i => i.achats * 100 + i.bayes),
        pepite: track === 'commune' ? top(items.filter(i => i.prix), i => i.mean / i.prix) : [],
        domaines: track === 'stand' ? agg(it => it.exposant?.id).map(x => ({ ...x, exposant: expById[x.key] })) : [],
        regions: agg(it => it.exposant?.region),
        cepages: agg(it => Fiches.cepageIds(it.wine.cepages)).map(x => ({ ...x, fiche: Fiches.CEPAGES[x.key] })),
        labels: agg(labelGroup),
        visites: [...new Set(items.map(i => i.exposant?.id).filter(Boolean))].map(id => expById[id]),
      };
    }

    const stand = trackRankings('stand');
    const commune = trackRankings('commune');

    /* ---------- Classements de personnes (toutes pistes confondues) ---------- */
    const itemOf = v => (v.track === 'commune' ? commune : stand).items.find(i => i.key === (v.track === 'commune' ? v.commune : v.wine));
    const keyV = v => `${v.track}:${v.track === 'commune' ? v.commune : v.wine}`;
    const byWine = {};
    allVotes.forEach(v => (byWine[keyV(v)] = byWine[keyV(v)] || []).push(v));
    const ids = Object.keys(members).filter(id => allVotes.some(v => v.by === id));
    const P = ids.map(id => {
      const mine = allVotes.filter(v => v.by === id);
      const devs = [], abs = [];
      for (const v of mine) {
        const others = byWine[keyV(v)].filter(o => o.by !== id).map(o => o.note);
        if (others.length) { devs.push(v.note - mean(others)); abs.push(Math.abs(v.note - mean(others))); }
      }
      const its = mine.map(v => ({ v, it: itemOf(v) })).filter(x => x.it);
      const regions = new Set(its.map(x => x.it.exposant?.region).filter(Boolean));
      const ceps = new Set(its.flatMap(x => Fiches.cepageIds(x.it.wine.cepages)));
      const solo = Object.values(byWine).filter(a => a.length === 1 && a[0].by === id).length;
      const shared = allVotes.filter(v => v.via === id && v.by !== id).length;
      // dénicheur : vins qu'il a notés en premier, puis notés par d'autres
      const firsts = Object.values(byWine).filter(a => a.length > 1 && [...a].sort((x, y) => (x.at || 0) - (y.at || 0))[0].by === id);
      const denich = firsts.flatMap(a => a.filter(o => o.by !== id).map(o => o.note));
      const pref = members[id].pref;
      const colAvg = c => mean(its.filter(x => (x.v.couleur || x.it.couleur) === c).map(x => x.v.note));
      const other = pref === 'rouge' ? 'blanc' : pref === 'blanc' ? 'rouge' : null;
      const best = [...its].sort((a, b) => b.v.note - a.v.note)[0];
      const fav = (arr) => { const g = {}; arr.forEach(([k, n]) => k && (g[k] = g[k] || []).push(n));
        return Object.entries(g).filter(([, a]) => a.length >= 2).sort((a, b) => mean(b[1]) - mean(a[1]))[0]?.[0] || null; };
      return {
        id, name: nameOf(id), n: mine.length, mean: r2(mean(mine.map(v => v.note))),
        dev: devs.length >= RULES.minPerson ? r2(mean(devs)) : null,
        absDev: abs.length >= RULES.minPerson ? r2(mean(abs)) : null,
        regions: regions.size, cepages: ceps.size, explo: regions.size * 2 + ceps.size,
        solo, shared, denich: denich.length ? r2(mean(denich)) : null, denichN: firsts.length,
        ouvert: other && !isNaN(colAvg(other)) && !isNaN(colAvg(pref)) ? r2(colAvg(other) - colAvg(pref)) : null, pref,
        coeurs: mine.filter(v => v.coeur).map(v => itemOf(v)?.wine.nom).filter(Boolean),
        best: best ? { nom: best.it.wine.nom, note: best.v.note, exposant: best.it.exposant?.nom } : null,
        regionFav: fav(its.map(x => [x.it.exposant?.region, x.v.note])),
        cepageFav: fav(its.flatMap(x => Fiches.cepageIds(x.it.wine.cepages).map(c => [c, x.v.note]))),
        couleurFav: fav(its.map(x => [x.v.couleur || x.it.couleur, x.v.note])),
      };
    });
    const topP = (f, filter, asc = false) => P.filter(filter).sort((a, b) => asc ? f(a) - f(b) : f(b) - f(a)).slice(0, RULES.top);

    // paires de palais
    const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j]; const diffs = [];
      for (const arr of Object.values(byWine)) {
        const va = arr.find(v => v.by === a), vb = arr.find(v => v.by === b);
        if (va && vb) diffs.push(Math.abs(va.note - vb.note));
      }
      if (diffs.length) pairs.push({ a: nameOf(a), b: nameOf(b), common: diffs.length, diff: r2(mean(diffs)) });
    }
    const goodPairs = pairs.filter(p => p.common >= RULES.minCommon);
    const personnes = {
      brave: topP(p => p.dev, p => p.dev !== null),
      encule: topP(p => p.dev, p => p.dev !== null, true),
      mouton: topP(p => p.absDev, p => p.absDev !== null, true),
      rebelle: topP(p => p.absDev, p => p.absDev !== null),
      explorateur: topP(p => p.explo, p => p.n > 0),
      solitaire: topP(p => p.solo, p => p.solo > 0),
      influenceur: topP(p => p.shared, p => p.shared > 0),
      denicheur: topP(p => p.denich * 10 + p.denichN, p => p.denich !== null),
      ouvert: topP(p => p.ouvert, p => p.ouvert !== null && p.ouvert > 0),
      jumeaux: [...goodPairs].sort((x, y) => x.diff - y.diff).slice(0, 3),
      chienchat: [...goodPairs].sort((x, y) => y.diff - x.diff).slice(0, 3),
      inseparables: [...pairs].sort((x, y) => y.common - x.common).slice(0, 3),
      profils: P.sort((a, b) => b.n - a.n),
    };

    // degré : l'empégué (degré deviné le plus proche du vrai, quand il est connu)
    const reel = {};
    allVotes.forEach(v => { if (v.degreReel > 0) (reel[keyV(v)] = reel[keyV(v)] || []).push(v.degreReel); });
    const guess = {};
    allVotes.forEach(v => {
      const r = reel[keyV(v)]; if (!(v.degre > 0) || !r) return;
      const real = [...r].sort((a, b) => a - b)[Math.floor(r.length / 2)];
      (guess[v.by] = guess[v.by] || []).push(Math.abs(v.degre - real));
    });
    personnes.empegue = Object.entries(guess).map(([id, a]) => ({ name: nameOf(id), ecart: r2(mean(a)), n: a.length, bons: a.filter(x => x <= 0.5).length }))
      .sort((a, b) => b.bons - a.bons || a.ecart - b.ecart).slice(0, RULES.top);

    return { stand, commune, personnes, nMembers: ids.length, nVotes: allVotes.length, rules: RULES };
  }

  /* ---------- Les diapos de la révélation, dans l'ordre ---------- */
  function slides(R, Fiches) {
    const S = [];
    const f = x => String(Math.round(x * 10) / 10).replace('.', ',');
    const wineRow = (i, val) => ({ title: i.wine.nom, sub: [i.exposant?.nom, i.wine.millesime].filter(Boolean).join(' · '), val, n: i.n, couleur: i.couleur });
    const add = (o) => { if (o.rows && o.rows.length) S.push(o); };
    S.push({ kind: 'intro', title: '🍷 Le palmarès du SAVIM', text: `${R.nMembers} dégustateurs · ${R.nVotes} notes · ${R.stand.visites.length} exposants visités` });
    const P = R.personnes;
    S.push({ kind: 'section', title: '👥 Et vous, les dégustateurs ?', text: 'Qui a le palais de qui, qui a ouvert la voie, qui n\'a rien voulu partager…' });
    const pr = (p, val) => ({ title: p.name, val });
    add({ title: '😇 Le brave (notes les plus généreuses)', rows: P.brave.slice(0, 3).map(p => pr(p, `${p.dev > 0 ? '+' : ''}${f(p.dev)} pt`)) });
    add({ title: '😈 L\'enculé (notes les plus sévères)', rows: P.encule.slice(0, 3).map(p => pr(p, `${p.dev > 0 ? '+' : ''}${f(p.dev)} pt`)) });
    add({ title: '🐑 Le mouton (toujours d\'accord avec le groupe)', rows: P.mouton.slice(0, 3).map(p => pr(p, `±${f(p.absDev)} pt`)) });
    add({ title: '🤘 Le rebelle (jamais d\'accord)', rows: P.rebelle.slice(0, 3).map(p => pr(p, `±${f(p.absDev)} pt`)) });
    add({ title: '🧭 L\'explorateur', rows: P.explorateur.slice(0, 3).map(p => pr(p, `${p.regions} région${p.regions > 1 ? 's' : ''} · ${p.cepages} cépage${p.cepages > 1 ? 's' : ''}`)) });
    add({ title: '🐺 Le loup solitaire (vins goûtés par lui seul)', rows: P.solitaire.slice(0, 3).map(p => pr(p, `${p.solo} vin${p.solo > 1 ? 's' : ''}`)) });
    add({ title: '📣 L\'influenceur (ses QR codes ont été scannés)', rows: P.influenceur.slice(0, 3).map(p => pr(p, `${p.shared} scan${p.shared > 1 ? 's' : ''}`)) });
    add({ title: '🔎 Le dénicheur (ses trouvailles plaisent aux autres)', rows: P.denicheur.slice(0, 3).map(p => pr(p, `${f(p.denich)}/20 sur ${p.denichN} vin${p.denichN > 1 ? 's' : ''}`)) });
    add({ title: '🔄 L\'ouvert d\'esprit (il note mieux la couleur qu\'il dit ne pas préférer)', rows: P.ouvert.slice(0, 3).map(p => pr(p, `+${f(p.ouvert)} pt pour le ${p.pref === 'rouge' ? 'blanc' : 'rouge'}`)) });
    add({ title: '🎯 L\'empégué (degré deviné)', rows: P.empegue.slice(0, 3).map(p => ({ title: p.name, val: `${p.bons}/${p.n} à 0,5° près` })) });
    add({ title: '👯 Les jumeaux de palais', rows: P.jumeaux.map(p => ({ title: `${p.a} & ${p.b}`, sub: `${p.common} vins en commun`, val: `±${f(p.diff)} pt` })) });
    add({ title: '🐶🐱 Chien et chat', rows: P.chienchat.map(p => ({ title: `${p.a} & ${p.b}`, sub: `${p.common} vins en commun`, val: `±${f(p.diff)} pt` })) });
    add({ title: '🫂 Les inséparables (le plus de vins en commun)', rows: P.inseparables.map(p => ({ title: `${p.a} & ${p.b}`, val: `${p.common} vins` })) });
    for (const [T, label] of [[R.stand, '🥂 Dégustations aux stands'], [R.commune, '🍾 Bouteilles communes']]) {
      if (!T.items.length) continue;
      S.push({ kind: 'section', title: label, text: `${T.items.length} vins · ${T.nVotes} notes · moyenne ${f(T.globalMean)}/20${T.lowData ? ' · ⚠️ peu de vins notés par plusieurs personnes : les vins à 1 vote comptent' : ''}` });
      add({ title: '🤝 Vin qui met tout le monde corda', rows: T.corda.slice(0, 3).map(i => wineRow(i, `écart ${f(i.sd)}`)) });
      add({ title: '⚡ Vin le plus clivant', rows: T.clivant.slice(0, 3).map(i => wineRow(i, `écart ${f(i.sd)}`)) });
      add({ title: '❤️ Coups de cœur', rows: T.coeur.map(i => wineRow(i, `${i.coeurs} ❤️`)) });
      add({ title: '🛒 Le vin qui fait sortir le portefeuille', rows: T.portefeuille.map(i => wineRow(i, `${i.achats} achat${i.achats > 1 ? 's' : ''}`)) });
      add({ title: '💎 La pépite (note / prix)', rows: T.pepite.map(i => wineRow(i, `${f(i.mean)}/20 pour ${f(i.prix)} €`)) });
      for (const [k, t] of [['rouge', '🔴 Meilleurs rouges'], ['blanc', '⚪ Meilleurs blancs'], ['rose', '🌸 Meilleurs rosés'], ['orange', '🟠 Meilleurs vins orange'], ['doux', '🍯 Meilleurs moelleux & doux'], ['bulles', '🫧 Meilleures bulles']])
        add({ title: t, rows: T[k].slice(0, 3).map(i => wineRow(i, `${f(i.bayes)}/20`)) });
      add({ title: '🍇 Le cépage roi', rows: T.cepages.slice(0, 5).map(c => ({ title: c.fiche?.nom || c.key, sub: c.fiche?.gout || '', val: `${f(c.mean)}/20`, n: c.n })) });
      add({ title: '🗺️ Le Tour de France (et d\'ailleurs)', rows: T.regions.map(r => ({ title: `${Fiches.REGIONS[r.key]?.emoji || ''} ${r.key}`, val: `${f(r.mean)}/20`, n: r.n })) });
      add({ title: '🌱 Bio, HVE ou sans label ?', rows: T.labels.map(r => ({ title: r.key, val: `${f(r.mean)}/20`, n: r.n })) });
      add({ title: '🏰 Le domaine du jour', rows: T.domaines.slice(0, 5).map(d => ({ title: d.exposant?.nom || d.key, sub: d.exposant ? `${d.exposant.region} · ${d.exposant.appellations}` : '', val: `${f(d.mean)}/20`, n: d.n })) });
      add({ title: '🥉🥈 Classement olympique (sans la meilleure ni la pire note)', rows: T.olympique.map(i => wineRow(i, `${f(i.olymp)}/20`)) });
      add({ title: '⚖️ Classement normalisé (chacun ramené à son propre barème)', rows: T.normalise.map(i => wineRow(i, `${f(i.norm)}/20`)) });
      add({ kind: 'podium', title: `🏆 Classement général — ${label.slice(3)}`, rows: T.general.map(i => wineRow(i, `${f(i.bayes)}/20`)) });
    }
    for (const p of P.profils) {
      S.push({ kind: 'profil', title: `🪪 La carte de ${p.name}`, rows: [
        { title: 'Vins notés', val: String(p.n) }, { title: 'Note moyenne', val: `${f(p.mean)}/20` },
        p.best && { title: 'Son meilleur vin', sub: p.best.exposant || '', val: `${p.best.nom} (${p.best.note})` },
        p.regionFav && { title: 'Sa région', val: p.regionFav },
        p.cepageFav && { title: 'Son cépage', val: Fiches.CEPAGES[p.cepageFav]?.nom || p.cepageFav },
        p.couleurFav && { title: 'Sa couleur', val: p.couleurFav },
        p.coeurs.length && { title: 'Ses coups de cœur', val: p.coeurs.join(', ') },
      ].filter(Boolean) });
    }
    return S;
  }

  const api = { RULES, compute, slides, latestVotes };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.LHVC_SALON = root.LHVC_SALON || {}).Rankings = api;
})(typeof window !== 'undefined' ? window : globalThis);
