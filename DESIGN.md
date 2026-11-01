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

## 7 ter. Sumo 🤼 (validé)

**Principe** : mêmes petites voitures que Patate chaude (même conduite, dérapages, nitro, chocs), mais on ne doit
**pas tomber dans le vide**. Une voiture qui sort du sol tombe (elle rétrécit en tournant ~1 s) → éliminée.

### À chaque manche, tirés au hasard
- **La version** : 🔴 *Arène* ou 🏝️ *Îles* (50/50).
- **Le mode** : nombre de joueurs **impair → toujours FFA** (chacun pour soi).
  Nombre **pair → FFA ou équipes au hasard** (50/50). Équipes = **toujours 2 équipes** (2 contre 2, 3 contre 3),
  tirées au hasard à chaque manche, voitures **rouges / bleues** (+ un liseré de la couleur du joueur).
  On peut pousser ses coéquipiers (la physique ne fait pas de différence) — attention aux accidents !

### Version 🔴 Arène (qui rétrécit)
- Une grande plateforme ronde, toute la map tient à l'écran (comme Patate).
- Après 10 s de jeu, le bord **rétrécit petit à petit** (bord rouge clignotant), jusqu'à une petite arène au bout d'environ 1 min.
- Le but : **pousser les autres dehors**. Dernière voiture (ou dernière équipe) sur la plateforme = gagnant.

### Version 🏝️ Îles
- Une **grande map** générée au hasard : 4 à 6 **grandes plateformes** entourées de vide, reliées par des **couloirs**
  (assez larges pour 2 voitures). Tomber = éliminé.
- **Caméra qui suit ta voiture** + **mini-carte** en coin (îles, couloirs, joueurs, zone sûre).
- **Zone sûre** : une île est tirée **au hasard parmi toutes les îles** (même si des joueurs y sont déjà) et s'allume.
  - **Chrono de 15 s.** Quand il arrive à 0, **tous ceux qui ne sont pas sur l'île explosent** (et seulement eux).
    (Changé le 01/11 : plus de « dernier arrivé explose », jugé nul en jeu.)
  - Pause de 5 s, puis une nouvelle île s'allume, et ainsi de suite.
- On peut aussi pousser les autres dans le vide pendant la course (dans les couloirs, c'est le chaos 😈).

### Fin de manche et points
- **FFA** : comme Patate → 1 point par joueur éliminé avant toi (le gagnant a n−1).
  **Bonus +1** par voiture que tu as **éjectée** (le dernier à l'avoir touchée dans les 3 s avant sa chute).
  Un fil d'info annonce « 💥 Bob a éjecté Michel ! ».
- **Équipes** : l'équipe gagnante = celle qui a encore au moins une voiture. Chaque membre gagne **3 points**
  (+1 s'il est encore en vie), plus les bonus d'éjection.
- Plusieurs manches, puis classement → points de soirée (comme les autres jeux).

### Réglages
- **Mode « Un jeu »** (hôte) : version (au hasard / Arène / Îles), mode (auto / FFA / équipes si pair),
  vitesse de rétrécissement de l'arène, durée du chrono des îles, nitro oui/non.
- **Mode Playlist** (vote) : difficulté (Facile = arène lente + chrono 20 s · Normal · Difficile = arène rapide + chrono 10 s),
  manches **3** / 5 / 7, nitro oui/non. La version et le mode restent tirés au hasard à chaque manche.

### Bots
- Arène : ils foncent sur le plus proche en évitant le bord, et fuient quand ils sont près du vide.
- Îles : ils calculent le chemin d'île en île par les couloirs pour rejoindre la zone sûre, et poussent en passant.

### Véhicules (v2 — validé, codé)
5 véhicules, chacun avec sa **taille réelle** (ça change les chocs) et sa conduite.
La **poussée** vient du poids et du moteur : un camion lourd déplace tout, une moto légère rebondit sur tout le monde.

| Véhicule | Vitesse | Accélération | Poids | Maniabilité | Poussée | Taille | En bref |
|---|---|---|---|---|---|---|---|
| 🏎️ Formule 1 | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | longue et basse | La plus rapide, colle à la route, mais se fait sortir si on la tape |
| 🚗 Sportive | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | normale (actuelle) | L'équilibrée, la voiture d'aujourd'hui |
| 🚐 Minivan | ★★★☆☆ | ★★★☆☆ | ★★★★☆ | ★★☆☆☆ | ★★★★☆ | large | Lourde et costaude, lente à tourner |
| 🚚 Camion | ★★☆☆☆ | ★☆☆☆☆ | ★★★★★ | ★☆☆☆☆ | ★★★★★ | très grand | Un bulldozer : lent mais rien ne l'arrête |
| 🏍️ Moto | ★★★★☆ | ★★★★★ | ★☆☆☆☆ | ★★★★★ | ★☆☆☆☆ | toute fine | Vire très court, esquive tout… mais ne pousse presque rien |

Réglages physiques de départ (à ajuster en jouant) : la Sportive garde ceux d'aujourd'hui ;
Camion ≈ 3× plus lourd, vitesse max ≈ 260 ; Minivan ≈ 1,7× ; F1 vitesse max ≈ 480 et très grosse adhérence ;
Moto ≈ 0,4× le poids, braquage ≈ 1,4× plus serré.

### Cartes de véhicules (début de chaque manche)
- **10 s** : 3 cartes tirées au hasard s'affichent chez tout le monde, avec les **étoiles des stats** et la silhouette.
  Chacun clique sur sa carte. Pas de choix au bout de 10 s → une des 3 au hasard. Ensuite le compte à rebours 3-2-1.
- Réglage de l'hôte : **les mêmes 3 cartes pour tout le monde** (défaut) ou **3 cartes différentes par joueur**.
- Les bots choisissent au hasard parmi leurs cartes.

### Power-up 🎁 « Changement de véhicule »
- **Un seul à la fois** sur la map, à un endroit au hasard (sur le sol). Premier 5 s après le départ ;
  quand quelqu'un le prend, un nouveau réapparaît ailleurs **~10 s** plus tard.
- Le prendre = tu changes **au hasard pour un autre véhicule** (jamais le même), tu ne choisis pas. Petite explosion de fumée.
- **Recharge de 35 s par joueur** : pendant ce temps tu passes dessus sans le prendre (il reste là pour les autres).
  Ton écran affiche « 🎁 dans 23 s ».
- Si l'arène rétrécit sous lui, il réapparaît ailleurs.
- Les bots vont le chercher s'il est proche et qu'ils peuvent le prendre.

### Playlist
Option votable en plus : **Cartes véhicules** — « les mêmes pour tous » / « différentes ».

### Technique (pour moi)
- Réutilise `physics.js` (même conduite) + un test « est-ce qu'il y a du sol sous la voiture ? ».
- v2 : chaque voiture porte son type ; la physique lit taille, poids, moteur, braquage, adhérence de ce type
  (côté serveur ET navigateur, pour garder la prédiction exacte). Patate chaude garde la Sportive.
- Chocs un peu plus « costauds » qu'à Patate si besoin, pour que pousser soit satisfaisant (à régler en jouant).
- Caméra + mini-carte côté navigateur ; prédiction de sa voiture comme Patate (zéro retard).

## 7 quater. Devine la map 🗺️ (CS2) — validé

**Principe** : un screenshot pris dans une map de Counter-Strike 2 s'affiche chez tout le monde ;
chacun clique sur la map qu'il pense reconnaître. Les plus rapides marquent le plus.
**Pas de catégories facile/difficile** : les screenshots sont tirés au hasard, la difficulté dépend
seulement de ce que les joueurs connaissent (c'est la même image pour tout le monde).

### Une partie
- Une série d'**images** (10 par défaut), **20 s** par image, jamais deux fois la même image dans la partie.
- On répond en cliquant parmi **la liste de toutes les maps** du jeu.
  **Une seule réponse** par image (pas le droit de se corriger).
- **Mode de révélation tiré au hasard pour chaque image** (le même pour tout le monde), parmi ceux cochés par l'hôte :
  - 🔍 **Zoom qui recule** : zoomée ×4 sur un détail, se dézoome jusqu'à l'image entière.
  - 🕳️ **Trou noir** : écran noir, un cercle s'ouvre depuis un point au hasard et grandit.
  - ▦ **Un tiers à la fois** : 3 bandes (verticales ou horizontales), 1 visible au départ, +1 à chaque tiers du chrono.
  - 💥 **Écran cassé** : des éclats de verre noir qui tombent, de plus en plus vers la fin.
  - ⬅️➡️⬆️⬇️ **Balayage** : le noir recule dans un des 4 sens.
- Quand tout le monde a répondu (ou à 0) : **révélation** 5 s — l'image entière, le nom de la map,
  qui a trouvé et combien de points. Puis image suivante.

### Points
- Bonne réponse : **100 points × rapidité** (100 si tu réponds tout de suite, 40 si tu réponds à la dernière seconde).
  Mauvaise réponse ou pas de réponse : 0.
- À la fin : classement → points de soirée (comme les autres jeux).

### Maps
Active Duty + classiques : **Mirage, Inferno, Nuke, Ancient, Anubis, Dust2, Train, Overpass, Vertigo, Cache, Office, Italy**.
Seules les maps qui ont au moins un screenshot apparaissent dans la liste.

### Les screenshots (c'est toi qui les prends)
- Pas d'images récupérées sur internet : elles sont prises par toi dans CS2.
- Astuce : partie privée/entraînement, `sv_cheats 1`, `noclip`, **`cl_drawhud 0`** (sinon le radar donne la réponse !),
  `r_drawviewmodel 0` (cache l'arme), puis **F12** (capture Steam).
- Tu ranges tes images dans `screenshots-cs2/<map>/` (ex. `screenshots-cs2/mirage/`), n'importe quel nom de fichier.
  Ce dossier n'est pas envoyé sur GitHub (trop lourd) : seules les versions réduites le sont.
- Un outil (`npm run images`) les redimensionne (1280 px, JPEG léger) et les ajoute au jeu.
  Les fichiers publiés ont des **noms au hasard** (sinon un malin lirait « mirage_03.jpg » dans le navigateur) ;
  la réponse reste uniquement sur le serveur.
- Objectif de départ : ~10 screenshots par map (≈ 100 images), mais le jeu marche avec moins.

### Réglages
- Mode « Un jeu » : nombre d'images (5 / 10 / 15 / 20), temps par image (15 / 20 / 30 s),
  zoom de départ (×2 / **×4** / ×6).
- Playlist (vote) : zoom de départ (Facile ×2 / Normal ×4 / Difficile ×6), nombre d'images (**5** / 10 / 15).

### Bots
Ils répondent après un petit délai au hasard, justes environ une fois sur deux.

## 7 quinquies. Qui de nous ? 👉 (validé)

**Principe** : chacun écrit des questions du genre « Qui finirait en prison en premier ? »,
puis on vote pour un joueur sur chaque question, et tout est dévoilé à la fin dans une « cérémonie ».
Partie rapide : ~2 min à 5 joueurs.

### Déroulé
1. **Écriture (45 s)** : chacun écrit **1 question** (réglable 1 à 3). Bouton 🎲 « Idée au hasard » qui
   propose une question parmi une banque d'environ 100 (on peut la modifier avant d'envoyer).
   Ceux qui n'ont rien écrit à la fin reçoivent une question au hasard. Les bots aussi.
2. **Votes (10 s par question)** : les questions passent une par une, **anonymes**, dans un ordre au hasard.
   Chacun clique sur un joueur (**on peut voter pour soi**). Tous les votes secrets. Question suivante dès
   que tout le monde a voté.
3. **La cérémonie (reveal)** : chaque question revient, avec roulement de tambour, les barres de votes qui
   montent, **qui a voté pour qui** (avatars), **qui a écrit la question**, et le gagnant en grand avec son
   **titre** (le texte de la question : « 🏆 Bob — finirait en prison en premier »). Égalité = titre partagé.
   ~6 s par question (l'hôte peut passer plus vite).
4. **Fin** : le palmarès des titres de chaque joueur + les points.

### Points
**+1 point** chaque fois que tu as voté pour la personne la plus désignée (tu connais bien le groupe !).
Égalité en tête : voter pour n'importe lequel des premiers compte. À la fin → points de soirée.

### Réglages
- Un jeu : questions par joueur (1 / 2 / 3), temps d'écriture (30 / **45** / 60 s), temps de vote (**10** / 15 / 20 s).
- Playlist (vote) : questions par joueur (**1** / 2 / 3).

### Bots
Ils écrivent une question de la banque et votent au hasard (parfois pour eux-mêmes).

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
