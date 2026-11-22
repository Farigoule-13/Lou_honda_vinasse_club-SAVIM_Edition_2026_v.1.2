# Construit la base des exposants (exposants.js) à partir de la liste et des cuvées relevées
import json, re, sys, unicodedata, subprocess
base = {}; exec(open(sys.argv[1]).read(), base); R = base['R']
raw = open(sys.argv[2]).read().splitlines()
out = sys.argv[3]
# couleur des cépages, depuis fiches.js
sys.argv[4] = __import__('os').path.abspath(sys.argv[4])
cep = json.loads(subprocess.check_output(['node', '-e', "const F=require(process.argv[1]);console.log(JSON.stringify({c:Object.fromEntries(Object.entries(F.CEPAGES).map(([k,v])=>[k,v.c]))}))", sys.argv[4]]))['c']
def ids(text):
    return json.loads(subprocess.check_output(['node','-e',"const F=require(process.argv[1]);console.log(JSON.stringify(F.cepageIds(process.argv[2])))", sys.argv[4], text]))
def slug(s):
    s = unicodedata.normalize('NFD', s).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',s).strip('-')[:40]
wines = {}; cur = None
for line in raw:
    line=line.strip()
    if not line: continue
    if line.startswith('#'): cur=int(line[1:]); wines.setdefault(cur,[]); continue
    p=[x.strip() for x in line.split('|')]
    while len(p)<6: p.append('-')
    wines[cur].append(p)
exps=[]; seen=set()
for i,(reg,nom,village,appel,labels,url) in enumerate(R):
    eid=slug(nom)
    while eid in seen: eid+='-2'
    seen.add(eid)
    vins=[]; dedup=set()
    for k,(n,coul,app,ceps,mil,aro) in enumerate(wines.get(i,[])):
        key=(n.lower(),mil)
        if key in dedup: continue
        dedup.add(key)
        coul=coul.lower(); typ='sec'
        if 'demi-doux' in coul: coul='rouge'; typ='demi-doux'
        if coul=='moelleux': typ='moelleux'; coul='blanc'
        if coul=='doux': typ='doux'; coul='rouge' if re.search(r'rouge',n,re.I) else 'blanc'
        if coul=='effervescent':
            typ='effervescent'; coul='rosé' if re.search(r'ros[ée]',n,re.I) else ('rouge' if re.search(r'rouge',n,re.I) else 'blanc')
        if coul=='jaune': coul='blanc'; typ='jaune'
        c_ids = ids(ceps) if ceps!='-' else []
        if coul in ('-',''):
            if re.search(r'\bros[ée]e?\b',n,re.I): coul='rosé'
            elif re.search(r'\brouge\b',n,re.I): coul='rouge'
            elif re.search(r'\bblanc\b',n,re.I): coul='blanc'
            elif c_ids and all(cep.get(c)==cep.get(c_ids[0]) for c in c_ids) and cep.get(c_ids[0]): coul=cep[c_ids[0]]
            elif app!='-' and re.search(r'Pomerol|Médoc|Fronsac|Cahors|Saint-Émilion|Gigondas|Cornas|Côte-Rôtie|Corbières|Haut-Médoc|Lalande',app): coul='rouge'
            else: coul=''
        if re.search(r'Coteaux du Layon|Quarts de Chaume|Sauternes|Loupiac|Monbazillac',app):
            if typ=='sec': typ='moelleux'
            if not coul: coul='blanc'
        m = re.search(r'(19|20)\d\d', mil); mil = int(m.group(0)) if m else None
        vins.append({'id':f'{eid}~{len(vins)+1}','nom':n,'couleur':coul,'type':typ,'appellation':'' if app=='-' else app,
                     'cepages':'' if ceps=='-' else ceps,'millesime':mil,'aromes':'' if aro=='-' else aro})
    exps.append({'id':eid,'nom':nom,'village':village,'region':reg,'appellations':appel,'labels':[l.strip() for l in labels.split(',') if l.strip()],
                 'site':url,'vins':vins})
# Compléments vérifiés (fichiers séparés, champs historiques non écrasés).
from pathlib import Path
supplement_dir = Path(__file__).resolve().parent / 'donnees'
with open(supplement_dir / 'savim_verifie_2026-11-21.json', encoding='utf-8') as f:
    savim_meta = json.load(f)
with open(supplement_dir / 'cuvees_verifiees_2026-11-21.json', encoding='utf-8') as f:
    published_wines = json.load(f)
by_id = {e['id']:e for e in exps}
for eid, fields in savim_meta.items():
    if eid not in by_id: raise ValueError(f"Exposant absent pour ses métadonnées : {eid}")
    for field, value in fields.items():
        if field in by_id[eid] and by_id[eid][field] not in ('', None, []):
            raise ValueError(f"Tentative d'écrasement de données existantes : {eid}/{field}")
        by_id[eid][field] = value
for item in published_wines:
    eid = item['exposant']
    if eid not in by_id: raise ValueError(f"Exposant absent pour une cuvée : {eid}")
    dest = by_id[eid]['vins']
    # Idempotence, seulement si même nom et même millésime. Les données d'origine sont préservées.
    if any(v['nom'].casefold() == item['nom'].casefold() and v['millesime'] == item.get('millesime') for v in dest): continue
    entry = {key: item.get(key, default) for key,default in {
        'nom':'','couleur':'','type':'','appellation':'','cepages':'',
        'millesime':None,'aromes':'','sourceFiche':'','provenance':''}.items()}
    entry['id'] = f'{eid}~{len(dest)+1}'
    if item.get('noteVerification'): entry['noteVerification'] = item['noteVerification']
    dest.append(entry)
data={'source':'https://www.salons-savim.fr/exposants/vins-champagnes/','releve':'2026-11-21','salon':'SAVIM d\'automne, Parc Chanot, Marseille, 20-23 novembre 2026','exposants':exps}
js = ("/* Base des exposants vins du SAVIM d'automne 2026 (hors champagnes et gastronomie).\n"
      " * Liste : site du salon (relevé du 21/11/2026, « liste non exhaustive »).\n"
      " * Cuvées historiques conservées ; compléments sourcés sur les sites des producteurs,\n"
      " * un champ vide = information non confirmée ; non garantie de présence au stand. Généré par tools/build_db.py. */\n"
      "(function (root) {\n  const DB = " + json.dumps(data, ensure_ascii=False, indent=0) + ";\n"
      "  if (typeof module === 'object' && module.exports) module.exports = DB;\n"
      "  else (root.LHVC_SALON = root.LHVC_SALON || {}).DB = DB;\n})(typeof window !== 'undefined' ? window : globalThis);\n")
open(out,'w').write(js)
n=sum(len(e['vins']) for e in exps); w=sum(1 for e in exps if e['vins'])
print(len(exps),'exposants,',w,'avec cuvées,',n,'cuvées;', sum(1 for e in exps for v in e['vins'] if not v['couleur']),'sans couleur')
