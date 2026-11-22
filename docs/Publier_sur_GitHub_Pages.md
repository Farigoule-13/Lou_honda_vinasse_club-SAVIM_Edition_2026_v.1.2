# 🌐 Mettre l'appli en ligne avec GitHub Pages (gratuit, ~10 min, sans rien installer)

Tu obtiens une adresse du type **https://ton-pseudo.github.io/vinasse-savim/** à envoyer aux collègues.
Ils y consultent les 173 exposants, les cuvées et les fiches **avant de venir**, sans créer de profil
(bouton « 👀 Juste consulter »). En https, l'appli se garde ensuite dans le téléphone : elle s'ouvre même sans réseau.

## 1. Créer le compte et le dépôt
1. Va sur **github.com** → *Sign up* (gratuit). Choisis ton pseudo : il sera dans l'adresse.
2. En haut à droite : **+** → **New repository**.
   - *Repository name* : `vinasse-savim` (ou ce que tu veux, sans espace ni accent) ;
   - coche **Public** (GitHub Pages est gratuit pour les dépôts publics) ;
   - coche *Add a README file* ;
   - **Create repository**.

## 2. Déposer les fichiers du site
1. Dézippe **`Site_GitHub_Pages_SAVIM_v1.2.zip`** sur ton PC. Il contient directement `index.html`, `app.js`, les dossiers `data`, `img`, `vendor`…
   (c'est le dossier `public/salon` du projet, **rien d'autre** : ni serveur, ni notes, ni code animateur).
2. Dans le dépôt : **Add file** → **Upload files**.
3. **Ouvre le dossier dézippé, sélectionne TOUT son contenu** (Ctrl+A) et glisse-le dans la page.
   Attention : glisse le *contenu*, pas le dossier lui-même, sinon l'adresse aura un étage de plus.
4. En bas : **Commit changes**.

## 3. Activer la publication
1. Dans le dépôt : **Settings** → menu de gauche **Pages**.
2. *Source* : **Deploy from a branch** ; *Branch* : **main** et **/ (root)** → **Save**.
3. Attends 1 à 2 minutes, recharge la page : l'adresse apparaît (« Your site is live at… »). Ouvre-la pour vérifier.

## 4. Envoyer aux collègues
Colle l'adresse dans le groupe WhatsApp, par exemple :
> 🍷 Pour préparer le SAVIM : https://ton-pseudo.github.io/vinasse-savim/ → « 👀 Juste consulter ».
> Sur place, pour noter, on ouvrira l'appli depuis le QR de mon téléphone.

## Mettre à jour plus tard
Même chemin : **Add file → Upload files**, glisse les nouveaux fichiers (ils remplacent les anciens), **Commit changes**.
Les téléphones prennent la nouvelle version à la visite suivante (parfois la d'après, à cause du mode hors connexion).

## Bon à savoir
- **Deux adresses = deux mémoires.** Un collègue qui crée son profil et note sur la version en ligne garde ses notes *dans cette version*.
  Elles ne partent pas toutes seules vers ton serveur : il devra les envoyer par 💬 WhatsApp, 📎 fichier ou « Envoyer à l'hôte ».
  Le plus simple : **en ligne = consulter**, **au salon = noter depuis ton QR**.
- Le dépôt est **public** : n'y mets jamais le dossier `server`, ni des fichiers de notes, ni de sauvegarde.
- GitHub Pages ne peut que **montrer** des pages : il ne peut pas **recevoir** des notes. Il ne peut donc pas servir de point de secours (voir le LISEZ-MOI, « Secours »).
