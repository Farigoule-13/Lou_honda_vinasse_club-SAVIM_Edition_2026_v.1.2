/* =========================================================
 * FILE STORAGE — Petits fichiers JSON, écrits de façon sûre.
 *
 * - Écriture atomique (fichier temporaire puis renommage).
 * - Avant chaque écriture, l'état précédent devient « .bak »
 *   (au plus une fois par minute) : il y a toujours une copie saine.
 * - Fichier ILLISIBLE au démarrage : il n'est JAMAIS écrasé.
 *   Il est mis de côté sous « <nom>.corrompu-<date> », puis on
 *   reprend la copie .bak si elle est lisible. L'incident est
 *   signalé (alert) : l'écran de l'hôte et la page Résultats l'affichent.
 * file = null → stockage en mémoire (tests).
 * ========================================================= */
const fs = require('fs');
const path = require('path');

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, text);        // repli (antivirus Windows qui verrouille le fichier…)
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/* Lit un fichier JSON : { ok, data } si lisible, { ok:false, missing } sinon */
function tryRead(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { ok: false, missing: e.code === 'ENOENT', error: e.message }; }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, missing: false, error: 'contenu inattendu' };
    return { ok: true, data };
  } catch (e) { return { ok: false, missing: false, error: e.message }; }
}

/* Petit fichier JSON (notes du salon, réglages) */
function createJsonFile(file, defaults, { onAlert = () => {} } = {}) {
  let data = structuredClone(defaults);
  let alert = null;
  let lastBak = 0;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = tryRead(file);
    if (r.ok) data = { ...data, ...r.data };
    else if (!r.missing) {
      // Corruption : on met l'original de côté (jamais écrasé) et on tente la copie de secours
      const kept = `${file}.corrompu-${stamp()}`;
      try { fs.copyFileSync(file, kept); } catch { /* lecture impossible : rien à copier */ }
      const b = tryRead(`${file}.bak`);
      if (b.ok) {
        data = { ...data, ...b.data };
        alert = { level: 'warn', file: path.basename(file), kept: path.basename(kept),
          message: `Le fichier ${path.basename(file)} était illisible (${r.error}). Il a été mis de côté (${path.basename(kept)}) et la copie de secours a été reprise : les toutes dernières notes reçues peuvent manquer, renvoyez-les (aucun double compte).` };
      } else {
        alert = { level: 'error', file: path.basename(file), kept: path.basename(kept),
          message: `Le fichier ${path.basename(file)} était illisible (${r.error}) et aucune copie de secours n'est lisible. L'original est conservé (${path.basename(kept)}). Les téléphones gardent leurs notes : faites-les renvoyer.` };
      }
      onAlert(alert);
    }
  }
  return {
    get: () => data,
    set: next => {
      data = next;
      if (!file) return;
      if (Date.now() - lastBak > 60e3 && fs.existsSync(file) && tryRead(file).ok) {
        try { fs.copyFileSync(file, `${file}.bak`); lastBak = Date.now(); } catch { /* sans gravité */ }
      }
      writeAtomic(file, JSON.stringify(data, null, 1));
    },
    alert: () => alert,
    clearAlert: () => { alert = null; },
  };
}

module.exports = { createJsonFile, writeAtomic, tryRead };
