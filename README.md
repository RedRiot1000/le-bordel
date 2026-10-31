# 🎉 Le Bordel

Compil de mini-jeux 2D entre potes, dans le navigateur, de 3 à 6 joueurs.
Le design complet est dans [DESIGN.md](DESIGN.md).

## Jouer en local

```bash
npm install
npm start
```

Ensuite, ouvre http://localhost:3000.
Pour lancer le test automatique (le serveur doit tourner) : `npm test`.

## Mettre en ligne (à faire une seule fois)

1. **GitHub** : crée un compte sur https://github.com, puis un dépôt **vide** nommé `le-bordel`
   (sans README ni .gitignore).
2. **Envoyer le code** : dans le dossier du projet, lance ces commandes en remplaçant `TON-PSEUDO` :
   ```bash
   git remote add origin https://github.com/TON-PSEUDO/le-bordel.git
   git push -u origin main
   ```
   Une fenêtre GitHub s'ouvre pour te connecter la première fois.
3. **Render** : crée un compte sur https://render.com avec « Sign in with GitHub ».
   Clique sur **New → Blueprint**, choisis le dépôt `le-bordel`, puis **Apply**.
   Render lit `render.yaml` et lance le serveur. Au bout de 2 ou 3 minutes, tu obtiens une
   adresse du type `https://le-bordel-xxxx.onrender.com`.
4. Envoie cette adresse à tes potes. **C'est la seule fois où tu leur envoies quelque chose.**

## Publier une mise à jour

```bash
git add -A
git commit -m "ce que j'ai changé"
git push
```

Render redéploie tout seul en 1 ou 2 minutes, et les joueurs ont la nouvelle version
(la page se recharge toute seule). La version affichée en bas à droite change.

⚠️ Une mise à jour **redémarre le serveur** : les salons en cours sont perdus.
Pousse tes mises à jour en dehors des soirées de jeu.

## Ajouter un mini-jeu

1. `games/<nom>/server.js` : exporte `meta` (nom, emoji, nombre de joueurs) et `createGame(ctx)`.
   Copie la structure de `games/imposter/server.js`.
2. `public/games/<nom>/client.js` : s'enregistre dans `window.GAMES["<nom>"]`
   avec `mount`, `update`, `message` et `unmount`.
3. Ajoute le jeu dans `games/registry.js` et la balise `<script>` dans `public/index.html`.
4. Quand le jeu se termine, il appelle `ctx.finish(classement)` et le hub donne les points de soirée.
