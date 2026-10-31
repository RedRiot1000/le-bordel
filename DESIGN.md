# LE BORDEL — Document de design

> Compil de mini-jeux 2D à faire entre potes, dans le navigateur.
> Statut : **brouillon à valider** (rien n'est codé).

---

## 1. Le concept en une phrase

On ouvre **un lien**, on rejoint le salon avec un code, et l'hôte enchaîne des mini-jeux
(bluff, action, dessin, quiz). Les points s'additionnent sur toute la soirée.

## 2. Règles de base

| Sujet | Décision |
|---|---|
| Joueurs | **3 à 6** |
| Support | **PC uniquement** (clavier / souris) |
| Accès | Lien web, sans compte, sans installation |
| Vocal | Pas de chat dans le jeu → on parle sur **Discord** |
| Déroulé | **L'hôte choisit** le prochain jeu dans un menu |
| Score | Score de soirée cumulé, affiché entre chaque jeu |

## 3. Mises à jour automatiques (le point important)

```
Toi (modif du code)  →  GitHub (tu envoies : "push")  →  Render (récupère et redémarre tout seul)
                                                              ↓
                                         Tes potes ouvrent le lien = dernière version
```

- **GitHub** : stocke le code (compte gratuit).
- **Render** (offre gratuite) : héberge le serveur et le redéploie à chaque push.
- Défaut connu : en gratuit, le serveur s'endort après ~15 min sans joueur.
  Le premier qui ouvre le lien attend ~50 secondes, ensuite c'est instantané.
- Pas d'appli `.exe` pour l'instant. Possible plus tard (Electron) sans rien casser.

## 4. Architecture : un hub + des mini-jeux

```
LeBordel/
├── server.js          ← le hub : salons, joueurs, choix du jeu, score de soirée
├── games/             ← un dossier par mini-jeu (côté serveur)
│   ├── imposter/
│   ├── patate/
│   └── ...
└── public/            ← ce que voit le joueur
    ├── hub/           ← écrans du salon
    └── games/         ← écrans de chaque mini-jeu
```

**Chaque mini-jeu respecte le même "contrat"** pour que le hub puisse le lancer :
- `start(joueurs, réglages)` → démarre une manche
- reçoit les actions des joueurs (touches, votes, dessins...)
- à la fin, renvoie **un classement** (1er, 2e, 3e...)

Le hub transforme ce classement en **points de soirée** (barème identique pour tous les jeux,
voir §6). Comme ça, ajouter un jeu = ajouter un dossier, sans toucher au reste.

**Technique** : Node.js + Express + Socket.IO (comme Imposter).
Pour les jeux d'action : **Phaser 3** côté navigateur, et c'est le **serveur qui décide**
(positions, collisions) → personne ne peut tricher, tout le monde voit la même chose.

## 5. Le hub (salon)

1. Accueil : *Créer un salon* ou *Rejoindre* (code à 4 lettres + lien direct).
2. Choix du pseudo + couleur/avatar simple (formes 2D, pas de modèles).
3. Salle d'attente : liste des joueurs, l'hôte voit le **menu des jeux** (grisé si pas assez de joueurs).
4. L'hôte règle le jeu choisi (ex. réglages Imposter) → lancer.
5. Fin du jeu → écran **podium + score de soirée** → retour au menu.
6. **Reconnexion** : si quelqu'un rafraîchit la page ou coupe, il revient à sa place (même pseudo, mêmes points).
7. Si l'hôte part, le rôle passe au joueur suivant.
8. **Bots** 🤖 : l'hôte peut ajouter des bots (bouton dans le salon) pour tester seul ou compléter une partie.
   Chaque jeu les fait jouer lui-même (Imposter : indices bidons + votes au hasard ; Patate : le porteur chasse, les autres fuient).

## 5 bis. Deux façons de jouer

1. **🎮 Un jeu** : l'hôte choisit un jeu, le règle, puis enchaîne les manches et clique « Terminer le jeu ».
2. **🎲 Playlist** : l'hôte coche plusieurs jeux et choisit le nombre de jeux à jouer.
   L'ordre est tiré au hasard (jamais deux fois le même d'affilée ; les jeux injouables avec ce nombre de joueurs sont sautés).
   - Réglages **par défaut** : écran « Prochain jeu » 5 s, puis difficulté Normale.
   - Réglages **au vote** : 30 s où tout le monde vote la difficulté, le nombre de manches et une option du jeu.
     Majorité ; égalité = tirage au sort ; personne n'a voté = valeur par défaut. L'hôte peut lancer avant la fin.
   - Chaque jeu a un **nombre de manches** (Imposter 2/3/4, défaut 2 · Patate 3/5/7, défaut 3).
     Après la dernière : 15 s pour voir les résultats, puis classement automatique → podium → jeu suivant.
   - Chaque jeu déclare ses options votables dans `export const playlist = { options, settingsFor(choix) }`.

## 6. Barème de soirée (proposition)

Chaque jeu donne un classement, le hub donne :

| Place | 1er | 2e | 3e | 4e | 5e | 6e |
|---|---|---|---|---|---|---|
| Points | 10 | 7 | 5 | 3 | 2 | 1 |

Pour les jeux en équipe (ex. Imposter : civils contre imposteurs), tous les gagnants
sont 1ers ex æquo et tous les perdants sont derniers ex æquo.

## 7. Liste des mini-jeux (à trier ensemble)

### Bluff / déduction
- **Imposter / Mr White** ✅ *déjà codé* (`F:\CLAUDE CODE\Imposter\`) → à brancher sur le hub, limité à 6 joueurs.
- **Menteur** : on montre un mot rare, chacun invente une fausse définition, on vote pour la vraie.

### Action / réflexes 2D (vue de dessus)
- **Patate chaude** : un joueur a la bombe, il la passe en touchant quelqu'un. Boum = éliminé.
- **Sumo** : arène ronde qui rétrécit, on se pousse hors du cercle.
- **Sol de lave** : les dalles disparaissent une à une, dernier debout gagne.
- **Ramasse-tout** : 60 s pour ramasser un max de pièces, avec des pièges.

### Dessin / devinette
- **Dessine et devine** : un dessine un mot, les autres tapent leurs propositions, plus on trouve vite, plus on gagne.
- **Téléphone dessiné** : phrase → dessin → phrase → dessin... on regarde le carnage à la fin.

### Quiz / culture
- **Le plus proche** : questions à réponse chiffrée ("hauteur de la tour Eiffel ?"), le plus proche gagne.
- **Buzzer** : question à choix, le premier qui a juste prend le plus de points.
- **Qui de nous ?** : "Qui finirait en prison en premier ?" → tout le monde vote, on gagne si on vote comme la majorité.

## 7 bis. Patate chaude 💣 (v2 : petites voitures)

- Chaque joueur conduit une **petite voiture téléguidée** vue de dessus.
  **Z/↑** accélérer · **S/↓** freiner puis reculer · **Q D/← →** tourner · **Espace** frein à main (dérapage) · **Shift** nitro (jauge qui se recharge).
- Vraie physique : vitesse avant + glisse latérale freinée par l'adhérence. Trop vite dans un virage → l'arrière décroche.
  Les chocs sont des impulsions entre objets qui tournent : taper l'arrière d'une voiture = tête-à-queue, plus c'est rapide plus ça tape.
- **Map aléatoire** à chaque manche : sol asphalte / terre / neige (adhérence 1 / 0,65 / 0,45), 5 à 9 obstacles avec toujours 100 px de passage + une route libre le long des bords, 1 à 3 flaques d'huile.
- Une voiture a la bombe et la **refile en touchant** une autre (pas de renvoi immédiat au précédent pendant 1 s). Le porteur a un moteur +8 %.
- Mèche **cachée** mais la bombe clignote de plus en plus vite. Boum → éliminé, l'**épave reste** comme obstacle, le souffle repousse les voisins.
- Points de manche : 1 point par joueur éliminé avant toi. Plusieurs manches, puis « Terminer le jeu » → points de soirée.
- Réglages : mèche courte / normale / longue, nitro oui/non, sols glissants oui/non.
- Technique : physique partagée serveur/navigateur (`public/games/patate/physics.js`), serveur à 30 Hz qui fait foi,
  **prédiction** de sa propre voiture côté navigateur (zéro retard au volant) + autres voitures lissées avec 0,1 s de retard.

## 8. Feuille de route

| Phase | Contenu | Objectif |
|---|---|---|
| **0** | Compte GitHub + Render, hub minimal, Imposter branché | Jouer à Imposter **en ligne** avec les potes |
| **1** | Premier jeu d'action (Patate chaude) | Valider le temps réel (le plus dur techniquement) |
| **2** | Un jeu de dessin + un quiz | Avoir les 4 familles |
| **3** | Le reste de la liste, polish (sons, animations, avatars) | — |

## 9. Questions ouvertes

- Quels mini-jeux garder / virer / ajouter dans la liste du §7 ?
- Le barème du §6 te va ?
- Avatars : simples formes de couleur, ou petits persos dessinés (pixel art) ?
