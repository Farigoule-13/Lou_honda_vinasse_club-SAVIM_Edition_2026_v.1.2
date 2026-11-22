# Enrichissement SAVIM — 21 novembre 2026

**Statut : ajout documentaire et données uniquement, sans modification fonctionnelle de l'application.**

## Sources et méthode

- Liste officielle des exposants : https://www.salons-savim.fr/exposants/vins-champagnes/ (page se déclarant **« liste non exhaustive »**).
- Archive de départ `Lou_Honda_Vinasse_Club_v2.6.zip` : SHA-256 `7443e4a8932d5fa06b6f7b2c9670b6153c59e75902125273997c10e6ec35c8d9`.
- La page officielle présente **174 entrées viticoles**, dont **Domaine Courlovin cité deux fois** ; donc **173 exposants distincts** hors Champagne, hors armoires à vins, hors gastronomie.
- Les fiches de 173 exposants figurent déjà dans l'archive originale : **aucun ajout d'exposant** non prouvé.
- Codes postaux, saisons annoncées et labels affichés : ajoutés en **champs distincts** `codePostalSavim`, `participationDeclareeSavim`, `labelsAffichesSavim`, sans remplacer automatiquement la fiche initiale.
- Les nouveaux vins sont ajoutés avec un champ `sourceFiche` et un champ `provenance`. **Il s'agit de catalogues des producteurs et non d'une attestation de présence des bouteilles au salon**.

## Résultats comptabilisés

- **Exposants** : 173 avant → 173 après.
- **Cuvées** : 400 avant + 65 vérifiées au catalogue = **465** après.
- **Domaines avec au moins une cuvée** : 74 avant → 77 après.
- **Codes postaux explicitement publiés** : 161 / 173.
- **Saisons explicitement publiées** : 165 / 173.
- **Labels explicitement affichés** : 78 / 173. Ce n'est **pas** une attestation de certification actuelle.
- Champs historiques conservés : tous, **sauf l'ajout du site vide** du Domaine de la Citadelle, vérifié.
- Exclusion : 9 producteurs de Champagne et EUROCAVE ; aucune fiche de gastronomie ajoutée.

## Catalogues ayant permis des ajouts

- **Domaine de la Citadelle** : 26 cuvée(s) — https://www.domaine-citadelle.com/collections/vins
- **Domaine Roustan** : 8 cuvée(s) — https://domaineroustan.fr/index.php/nos-produits/
- **Domaine Finon** : 11 cuvée(s) — https://www.domaine-finon.fr/categorie-produit/vins-blancs/, https://www.domaine-finon.fr/categorie-produit/vins-rouges/
- **Domaine Victor Hertz** : 20 cuvée(s) — https://www.vinsvictorhertz.com/fr/les-vins/

## Ce qui n'est PAS vérifié

La page SAVIM ne publie pas la liste complète des vins exposés ni les stocks du stand. Elle ne permet pas de confirmer indépendamment les **400 cuvées historiques**, leurs millésimes, leurs cépages ou leurs arômes, même si le producteur est listé. Les cuvées non confirmées ont été **conservées sans être qualifiées de vérifiées**. Le fichier `CONTROLE_ENRICHISSEMENT_SAVIM_2026-11-21.json` contient les anomalies documentaires non arbitrées.

**Deux cas à ne pas masquer :** le nom Domaine Courlovin est cité à deux emplacements, codes postaux 84240 et 84120. Le lien SAVIM libellé Domaine Gavoty conduit à une URL contenant `vignoble-courlovin` : il n'a donc pas été enregistré comme site Gavoty sans confirmation supplémentaire. Ces points restent à confirmer auprès des intéressés.

## Reconstruction reproductible

Exécuter depuis le répertoire du projet, avec Python 3 et Node :

```bash
python3 tools/build_db.py tools/donnees/exposants_base.py tools/donnees/raw.txt public/salon/data/exposants.js public/salon/data/fiches.js
node -e "const d=require('./public/salon/data/exposants.js');console.log(d.exposants.length,d.exposants.reduce((n,e)=>n+e.vins.length,0))"
```

Les données complémentaires sont isolées dans `tools/donnees/savim_verifie_2026-11-21.json` et `tools/donnees/cuvees_verifiees_2026-11-21.json`, pour que les re-générations ne les effacent pas. Aucune correction fonctionnelle des défauts de l'audit initial n'a été réalisée ici.
