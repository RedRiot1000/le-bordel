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
| Joueurs | **3 à 8** (passé de 6 à 8 le 01/11) |
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

## 5 ter. Pause (jeux de réflexion)

Jeux concernés (`meta.pausable`) : Imposter, Qui de nous ?, Sur 10, Classement, Pense pareil, 2 vérités 1 mensonge.
- Bouton **⏸ Pause** dans la barre du haut. L’**hôte** met en pause / relance quand il veut (sa reprise efface aussi les demandes).
- Les autres **demandent** la pause : elle démarre quand **au moins la moitié** des joueurs humains connectés la demande,
  et repart dès que **moins de la moitié** la demande encore (chacun peut retirer sa demande).
- Pendant la pause : grand écran « PAUSE », toutes les actions de jeu sont refusées, et l’**horloge du jeu** est arrêtée
  (chronos, bots, passage à l’étape suivante). Technique : le hub donne au jeu `ctx.now()` / `ctx.setTimeout()` / `ctx.clearTimeout()`.
- Pas de pause dans les jeux d’action (voitures) ni Devine la map (images qui se dévoilent en temps réel).

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
- Bonne réponse : **10 points × rapidité** (10 si tu réponds tout de suite, 4 à la dernière seconde). Passé de 100 à 10 le 02/11 pour être à la même échelle que les autres jeux.
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
2. **Votes (15 s par question)** : les questions passent une par une, **anonymes**, dans un ordre au hasard.
   Chacun clique sur un joueur (**on peut voter pour soi**). Tous les votes secrets. Question suivante dès
   que tout le monde a voté.
3. **La cérémonie (reveal)** : chaque question revient, avec roulement de tambour, les barres de votes qui
   montent, **qui a voté pour qui** (avatars), **qui a écrit la question**, et le gagnant en grand avec son
   **titre** (le texte de la question : « 🏆 Bob — finirait en prison en premier »). Égalité = titre partagé.
   ~11 s par question (l'hôte peut passer plus vite).
4. **Fin** : le palmarès des titres de chaque joueur + les points.

### Points
**+1 point** chaque fois que tu as voté pour la personne la plus désignée (tu connais bien le groupe !).
Égalité en tête : voter pour n'importe lequel des premiers compte. À la fin → points de soirée.

### Réglages
- Un jeu : questions par joueur (1 / 2 / 3), temps d'écriture (30 / **45** / 60 s), temps de vote (10 / **15** / 20 s).
- Playlist (vote) : questions par joueur (**1** / 2 / 3).

### Bots
Ils écrivent une question de la banque et votent au hasard (parfois pour eux-mêmes).

## 7 sexies. Néon 🏍️ (style « Tron ») — validé
> Idée du user : chaque moto laisse un mur de lumière, toucher un mur = éliminé, dernier en vie gagne.
> Simple, très tendu, manches courtes. Nom provisoire « Néon » (on peut le renommer). 2 à 8 joueurs (en duel aussi).

### Une manche
- **Motos uniquement**, physique de la Patate (`P.VEHICLES.moto`) : **virages libres**, la moto peut glisser.
- **Toujours en mouvement** : la moto avance seule à une **vitesse minimum**. Z / ↑ accélère,
  S / ↓ ralentit jusqu'à ce minimum (jamais en dessous), pas de marche arrière.
  Si la vitesse tombe sous le minimum (obstacle, choc entre motos…) → **explosion**.
- **Mur de lumière** derrière chaque moto, à sa couleur. Il **s'efface au bout de ~8 s**
  (traînée de longueur limitée). Toucher un mur (même le sien), un obstacle ou le bord = **éliminé**.
- **Saut** (Espace) : la moto passe au-dessus des murs pendant ~0,5 s, recharge 5 s (jauge affichée).
- **Zone qui rétrécit** : après ~40 s, le bord de l'arène se resserre pour finir la manche.
- Départ : compte à rebours 3 s, motos réparties sur le bord, tournées vers le centre.
  Les 0,5 premières secondes, pas de mur (le temps de s'écarter).
- Dernier en vie = gagnant de la manche. Plusieurs manches (3 / **5** / 7).

### Maps
Aléatoires comme la Patate : sol, **quelques obstacles** (moins que la Patate),
arène **plus grande quand il y a plus de joueurs** (3 joueurs = petite, 6 = grande, la caméra suit / dézoome).

### Points
- Survie : 1 point par joueur éliminé avant toi (comme la Patate), le gagnant a n-1.
- **+1 point par kill** : celui dont le mur t'a tué marque 1 point (pas si c'est ton propre mur).

### Réglages
- Un jeu : manches (3 / **5** / 7), durée des murs (5 / **8** / 12 s), saut on/off, zone qui rétrécit on/off.
- Playlist (vote) : manches, durée des murs.

### Bots
Ils évitent les murs (regardent devant eux à gauche/droite et tournent vers le côté le plus libre), sautent quand c'est bouché.

### Technique (pour moi)
Le serveur fait foi (murs + collisions) ; ma moto est prédite chez moi comme à la Patate.
Mur = suite de points (un toutes les ~6 px) avec l'heure de création ; collision = distance moto ↔ segments.

## 7 septies. Car-foot ⚽ — validé (« go »)
> Du foot avec les petites voitures, vu de dessus. 2 équipes, un gros ballon, des cages.
> Réutilise la physique, la prédiction et les bots de la Patate.

### Un match
- **2 équipes** (🔵 Bleus / 🔴 Rouges) tirées au hasard à chaque match, équilibrées (3 contre 2 si impair). 2 à 8 joueurs (jusqu’à 4 contre 4).
- Tout le monde en **Sportive** à la couleur de son équipe (sa propre couleur sur le toit).
- Commandes de la Patate : ZQSD, Espace frein à main, Shift **nitro**.
- **Ballon** : léger, rebondit sur les murs, les voitures le frappent (plus tu vas vite, plus il part fort).
- **Cages** au milieu des petits côtés : on peut rentrer dedans en voiture. Le ballon doit passer entièrement la ligne.
- **But** : « BUT ! » 3 s, puis remise en jeu (chacun dans son camp, compte à rebours 3 s).
- **Durée** : 2 / **3** / 5 min (le chrono s'arrête pendant les célébrations).
- Égalité à la fin : **but en or** (prolongation, le 1er but gagne ; 90 s max, sinon match nul) — réglable.

### Points de soirée
Équipe gagnante = 1re place (tous ses joueurs), perdante = 2e. Match nul = tout le monde ex æquo.
L'écran de fin montre aussi les buteurs (et les buts contre son camp 😅).

### Réglages
- Un jeu : durée (2 / **3** / 5 min), but en or (oui / non).
- Playlist (vote) : durée.

### Bots
Ils se placent derrière le ballon (côté de leur cage) et foncent dedans vers la cage adverse ; nitro en ligne droite.

### Technique (pour moi)
Physique du ballon partagée (`public/games/carfoot/ball.js`). Le serveur fait foi ; ma voiture est prédite
comme à la Patate, le ballon est affiché « au présent » (avancé selon sa vitesse).

## 7 octies. Sur 10 🔟 — validé (« go »)

Idée de Scotty : chacun a une note secrète de 0 à 10 et donne un indice qui « vaut » cette note pour lui.
Les autres devinent la note. Ex. : thème « Un jeu vidéo », j'ai 10 → j'écris « Rust ».

### Une manche
1. **Vote du thème** : 3 thèmes au hasard (environ 60 dans `games/sur10/themes.js`), 15 s, le plus voté gagne
   (égalité = au sort). Un thème joué ne revient pas dans la partie. Certains thèmes ont leur propre échelle
   (« Un animal : 0 = inoffensif · 10 = mortel »).
2. **Note + indice** : chacun **choisit** sa note (0-10) en secret et écrit son indice (60 s par défaut).
   Celui qui n'envoie rien ne passe pas cette manche.
3. **On devine** : un joueur à la fois (ordre au hasard), son indice en grand, les autres choisissent une note
   et valident (20 s, ou dès que tout le monde a validé).
4. **Révélation** : roulement de tambour, puis la réglette 0→10 avec la vraie note et les avatars des devineurs
   (10 s, l'hôte peut passer).

### Points
- Devineur : pile = 3, à 1 près = 2, à 2 près = 1.
- Auteur de l'indice : +1 par joueur qui l'a trouvé à 1 près ou mieux (récompense les bons indices).

### Réglages
Manches 1/2/3/5 (défaut 3), temps note+indice 45/60/90 s, temps pour deviner 15/20/30 s.
Playlist : option « Manches » 1/2/3 (défaut 2).

### Bots
Ils votent un thème au hasard, piochent un exemple du thème avec sa note (« Raclette » = 10), et devinent
bien si l'indice vient de la liste, au pif autour de 5 sinon.

### À surveiller
Les joueurs risquent de toujours choisir 0 ou 10 (le plus facile à faire deviner). Si ça arrive :
réglage « note tirée au hasard ».

## 7 nonies. Classement 📊 — validé (« fait », choix par défaut)

À chaque manche, un **juge** (chacun son tour, 1 ou 2 fois) choisit un thème parmi 3. Les thèmes viennent
de Sur 10 : chaque thème a déjà 5 exemples, ce sont les **5 choses à classer**.
- Le juge classe les 5 choses selon **ses goûts** (1er = le haut de l'échelle du thème, ex. « génial »).
  En même temps, les autres devinent **son** classement. On clique les choses dans l'ordre ; on peut corriger et renvoyer.
- Points : **2** par chose à la bonne place, **1** à une place près (max 10). Le juge gagne la **moyenne** des autres.
- Révélation : une colonne par joueur (vert = bonne place, jaune = à une place près), 14 s, l'hôte peut passer.
- Réglages : chacun juge 1 ou 2 fois, temps pour classer 30/45/60 s. Playlist : « Chacun est juge » 1/2 fois.
- Bots : le juge suit les notes de Sur 10 (avec du hasard), les devineurs aussi mais avec plus de hasard.

## 7 decies. Chat et souris 🐱 — validé (« fait », choix par défaut)

Un chat chasse les souris ; une souris touchée devient chat (« infection »).
- **Chat = Sportive** (moteur +10 %, nitro boosté comme le porteur de la Patate), **souris = moto** (vire très court).
- 1 chat au départ (2 à partir de 5 joueurs), chacun est chat à tour de rôle. Les souris partent **2 s avant** le chat.
- Un nouveau chat clignote 1,5 s et ne peut pas attraper pendant ce temps (pas de réaction en chaîne).
- Fin de manche : plus aucune souris, ou fin du chrono (60/90/120 s, défaut 90).
- Points : chat +1 par souris attrapée ; souris +1 par souris attrapée avant elle ; souris libre à la fin : +1 par souris attrapée +2.
- Maps : celles de la Patate (sol aléatoire, obstacles, huile). Réglages : manches 3/5/7 (défaut 5). Playlist : 3/5 (défaut 3).
- À surveiller en jouant : en test bots contre bots, les souris tombent vite (7 à 30 s). Si c'est pareil entre humains :
  réduire encore le boost du chat ou allonger l'avance des souris.

## 7 undecies. Avis de recherche 🚨 — validé (« go »)

Idée de Scotty : tout le monde en **F1**, la police (IA) arrive de plus en plus nombreuse dans une ville aléatoire.
- **Ville** (`public/games/police/city.js`, partagée serveur/navigateur, tirée d'une seed) : quadrillage de pâtés de 250 px,
  rues de 150 px, 12 % de places (fontaine, arbres), 28 % de pâtés coupés par une ruelle de 80 px, quelques rues barrées.
  Taille selon le nombre de joueurs (7×4 pâtés à 2 joueurs → 9×6 à 8). Caméra qui suit sa voiture + mini-carte.
- **Police IA** : Sportives (chassent) et vans (visent devant le joueur pour couper la route). Elles suivent les rues grâce à
  une grille de navigation (cases de 40 px, distances recalculées 3 fois/s). Apparaissent à plus de 700 px des fugitifs.
- **Niveau de recherche** ⭐→⭐⭐⭐⭐⭐ (5 paliers sur la durée) : max 2/3/4/5/6 flics par fugitif libre (40 en tout au maximum),
  moteur ×0,92 → ×1,2. Véhicules (demande de Scotty) : Sportive + moto dès ⭐, van à ⭐⭐, **Supercar** (nouveau véhicule réservé à la
  police, presque aussi rapide qu'une F1) et **camion** à ⭐⭐⭐ (tableau COP_MIX dans le serveur). **Hélico** à ⭐⭐⭐⭐ : arrive de loin, **tourne autour** de sa cible (~240 px, 430 px/s : une F1 peut le semer) ; projecteur
  allumé seulement à moins de 420 px, qui rattrape la cible ; la moitié des flics ne la vise que quand le projecteur est dessus.
- **Arrestation** : vitesse < 65 px/s pendant 1 s avec ≥ 2 véhicules de police à moins de 110 px, ou un seul s'il est conduit par un joueur-flic (demande de Scotty) (jauge rouge visible).
- **Durci** (« trop facile ») : flics ×1 → ×1,25 (une Sportive à ⭐⭐⭐ va aussi vite qu’une F1), nitro pour les flics, 1 flic sur 3 + vans/camions
  coupent la route (ils visent où le fugitif sera dans 1,3 s), apparition à 550-1200 px, max 3→7 par fugitif.
  Arrêté → **flic** (van de police), il compte pour la règle des 2.
- **Points** : +1 par 20 s de liberté, +3 si libre à la fin, +2 par arrestation pour un joueur-flic.
- Réglages : manches 2/3/5 (défaut 3), durée 1 min 30 / 2 min / 3 min (défaut 2 min). Playlist : 2/3 manches.
- Bots fugitifs : choisissent un point loin des flics (par la route) et y vont ; arrêtés, ils deviennent flics IA.
- Simulation bots contre police (2 min) : 4 joueurs → arrestations entre 30 s et 110 s, 1-2 survivants ; 8 joueurs → 2-3 survivants.

### Refonte de la ville + commissariat + sorties (brainstorm validé, « Go »)
- **Ville** (`city.js`) :
  - **3 quartiers** : centre-ville au milieu (tours, ruelles), zone industrielle et banlieue dans deux coins opposés.
    Chaque pâté prend le quartier dont le centre est le plus proche.
  - **Rivière** : une colonne ou une rangée de pâtés remplie d'eau. On la traverse par 2-3 ponts, plus le périphérique des deux côtés.
  - **Boulevards** : 1 ou 2 rues élargies de 50 px de chaque côté, avec un terre-plein arboré. L'un d'eux passe forcément par un pont.
  - **Ronds-points** : 2-3, de préférence aux croisements de boulevards. L'îlot est fait de 2 rectangles en croix (la physique ne gère que des rectangles).
  - **Avenue en diagonale** : 3 esplanades en escalier, avec des kiosques dans les coins.
  - **Périphérique** : la rue du bord, élargie de 110 px. Au-delà, 240 px de campagne (obstacle).
  - **2 sorties** : deux bretelles sur un même bord, fermées par une barrière (`exitGate`) jusqu'à « FUYEZ ! ».
- **Raccourcis à portique** : `gate: true`. Dans `physics.js`, un portique est ignoré par les véhicules de moins de 26 px de large : F1, sportive, supercar et moto passent ; van et camion sont bloqués.
  - On en trouve dans les ruelles du centre (50 %), les parkings clôturés de la zone industrielle (camions garés) et les lotissements de banlieue (4 maisons, allées en croix).
  - La grille de navigation de l'IA les traite comme des murs : **la police ne connaît pas les raccourcis**.
  - Cette grille ne garde que la zone reliée au périphérique.
- **Commissariat** : le pâté du centre le plus central, avec le bâtiment au fond et une cour ouverte sur la rue (3 places).
  - **90 % des flics** sortent de la cour et **10 %** arrivent par les sorties.
  - Si un fugitif est à moins de 400 px, ils arrivent par l'autre endroit. En dernier recours, dans une rue à 550-1200 px.
  - Cour embouteillée : on réessaie 0,25 s plus tard.
  - Les joueurs démarrent à plus de 900 px du commissariat.
- **« FUYEZ ! »** (fin du chrono) :
  - les barrières des sorties sautent, la police passe à ⭐⭐⭐⭐⭐ ;
  - on a 20/30/45 s pour entrer dans la zone de sortie (réglage `flee`, 30 s par défaut). Une flèche verte pointe vers la sortie la plus proche ;
  - sorti = rôle `out` : la voiture disparaît et la caméra suit un fugitif encore en ville ;
  - 1 flic sur 3 va se poster devant une sortie (sauf si un fugitif est à moins de 300 px) ;
  - les bots foncent vers la sortie la plus proche.
- **Points** : sorti à temps = points de 20 s + 3. Pas sorti à temps = points de 20 s seulement. Les points de temps sont plafonnés à la durée de la manche.
- **Look** :
  - trottoirs avec voitures garées et lampadaires ;
  - toits de tour : héliport, piscine, panneaux solaires, jardin, climatiseurs ;
  - ombres plus longues pour les grands immeubles ; entrepôts en tôle avec verrières ; maisons à 2 pentes avec jardins et piscines ;
  - campagne et arbres, rivière, ponts avec garde-corps, panneaux « SORTIE ».
- **Mini-carte** : rues claires, quartiers colorés, rivière, commissariat 🚓, sorties en vert (elles clignotent pendant « FUYEZ ! »). **M** = la carte en grand au milieu de l'écran.
- **Serveur** : il ne teste que les obstacles proches de chaque voiture (cases de 200 px, `C.near`).
- **Retouches (demande de Scotty)** :
  - **3 zones bien séparées** : colonnes [banlieue ou industrie] [rivière] [centre-ville, 3 colonnes] [rivière] [l autre zone]. Les 2 rivières sont larges (colonne de 600 px) : des **ponts d environ 450 px** (2 par rivière + le périphérique). Le boulevard horizontal traverse les deux.
  - **Pâtés de tailles variées** : colonnes et rangées de 380 à 520 px. Ville d environ 5 100 px de large (jusqu à 4 joueurs) ou 6 200 px (8 joueurs).
  - **Trottoirs partout** (18 px, à l intérieur des rectangles qui bloquent : on ne roule pas dessus) : autour de chaque bâtiment (donc des deux côtés des ruelles), des parcs, des parkings (le grillage est posé sur le trottoir), sur les quais, et au bord du périphérique côté campagne. Bordure, dalles, lampadaires, arbres.
  - **Commissariat** : un bâtiment en U autour d un **garage** (100 px de large) ouvert sur la rue. Les flics apparaissent dans le garage (2 places) ou juste devant la porte. Le pâté choisi fait au moins 240 px de côté, et aucune rue barrée devant.
  - **Formes variées** (dessin seulement, tiré de la seed) : tour simple, rangée de 2 à 4 immeubles de hauteurs différentes, tour sur esplanade, immeuble en L avec jardin, immeuble autour d une cour, entrepôt + bureaux, entrepôt + silos.
- **Simulation** (bots, 2 min) : arrestations entre 15 s et 140 s. Les bots sont presque tous pris avant la fin, l'un d'eux est sorti à 93 s (manche de 90 s).

### Ville refaite (demande de Scotty : « trop grille », trottoirs incohérents, ronds-points au hasard, périph collé)
- **Monde en tuiles de 30 px** (`city.js`). Une tuile est soit roulable (route, trottoir, place, pont, périphérique, ruelle, cour, bretelle, garage), soit bloquante (terrain, eau, îlot, clôture).
  - Les obstacles = les tuiles bloquantes regroupées en rectangles.
  - **Tous les trottoirs se montent** : ce qui ressemble à du bitume ou du pavé se roule, le reste (bâtiments, jardins, parcs, champs) bloque.
  - Grille de navigation = les tuiles (une tuile roulable qui ne touche pas d'obstacle), sans les raccourcis à portique.
- **3 villes séparées** côte à côte : zone industrielle et banlieue de chaque côté (au hasard), centre-ville au milieu. Entre elles, la campagne et une rivière (8 tuiles).
  - Une **grande rue est-ouest** traverse les 3 villes (même ligne) et passe les rivières par de longs ponts.
  - Chaque ville a une **grande avenue nord-sud**, prolongée par des **voies d'accès** jusqu'au périphérique.
  - **Un seul rond-point par ville**, au croisement avenue × grande rue (place centrale).
  - Le reste de chaque quart de ville est découpé au hasard (BSP) : des rues en T, jamais de quadrillage régulier, pas de route qui fait le tour de la ville.
  - Rues de 3 tuiles (centre, banlieue) ou 4 (usines).
- **Périphérique** (7 tuiles, 2 × 2 voies) loin des villes (8 tuiles de campagne), voies d'insertion dessinées en face de chaque accès, panneaux bleus avec le nom de la ville. 2 sorties : des bretelles vers l'extérieur, au-dessus des villes de côté.
- **Pâtés** (trottoir d'1 tuile tout autour) :
  - centre : îlot d'immeubles à l'alignement de la rue, de hauteurs différentes, avec cour intérieure ; tours sur pelouse ; place pavée roulable avec fontaine ; parc ; parfois une ruelle à portiques ;
  - usines : entrepôt, usine (cheminées), cour clôturée traversable (portiques aux 2 entrées, conteneurs) ;
  - banlieue : maisons sur les 4 côtés face à la rue (jardins, piscines, haies), impasse avec rond de retournement, parc, terrain de foot, allée à portiques.
- **Commissariat** : le grand pâté du centre-ville le plus central, garage ouvert sur l'avenue.

### Flics joueurs : Lamborghini + taser (demande de Scotty)
- Un joueur arrêté devient flic en **Lamborghini de police** (`lambo` dans physics.js, réservée) : masse 1,75 (pousse comme un van), moteur 640, largeur 24 (passe sous les portiques des ruelles, contrairement aux vans).
- **Taser** (bit 64 : clic ou E) : un éclair droit devant (950 px/s, portée 650, recharge **15 s**), arrêté par les murs et par le **premier véhicule** touché (fugitif, flic IA ou autre joueur, sauf le tireur), qui a le **moteur coupé 2 s** (`car.empUntil` : plus d'accélération ni de nitro, on peut encore tourner et freiner ; la prédiction du navigateur fait pareil). Les bots devenus flics tirent quand un fugitif est droit devant.

### Ville simple (dernière version, demande de Scotty)
Problèmes de la version « 3 villes » : on passait à travers certains bâtiments, des rues s'arrêtaient dans le vide. Scotty a demandé une ville simple : 1 seul quartier, pas de rivière, pas de pont, pas de périphérique, mais une ville qu'on ne traverse pas tout droit.
- **Une seule ville** (centre-ville), entourée de 7 tuiles de campagne. 7×5 pâtés (8×6 à partir de 5 joueurs), de tailles différentes. Rues de 5 tuiles (150 px, demande de Scotty : ×1,5).
- **Réseau de rues** :
  - on part d'une grille de rues, puis on en retire environ 35 %, et les pâtés de part et d'autre fusionnent ;
  - sur chaque ligne de la grille, au moins un tronçon disparaît, sauf **la grande rue** et **la grande avenue** (tirées au hasard), qui vont tout droit d'un bout à l'autre ;
  - jamais de cul-de-sac : un carrefour garde 0 ou au moins 2 rues ;
  - tout reste relié (vérifié à chaque tronçon retiré).
  - **virages** (demande de Scotty) : là où une rue tourne (carrefour en L à 2 rues, pas sur les bords gauche/droite des sorties, jamais autour du commissariat), 65 % des coins sont arrondis en quart de cercle (rayon intérieur 3 à 5 tuiles). La courbe est redessinée bien lisse, le trottoir la suit, de la verdure dedans et dehors. ~11 virages par ville, le test vérifie que tout reste relié.
- **Trottoirs** : toutes les tuiles de terrain qui touchent une rue (diagonales comprises). Ils se roulent.
- **Bâtiments posés uniquement sur des tuiles qui bloquent** : îlots d'immeubles, tours, ruelles à portiques, places pavées avec fontaine, parcs. Une rue retirée devient un immeuble (façade continue). Le test vérifie sur 60 villes qu'aucun bâtiment n'est posé sur une tuile roulable.
- **2 sorties** : une route qui quitte la ville à gauche, une à droite (bretelles vers le bord de la carte).
- **Commissariat** : un pâté entouré de 4 rues, près du centre, garage ouvert sur une rue.
- **Bug corrigé** : le mélange des rues utilisait `sort(() => rnd() - 0.5)`, dont le résultat change selon le moteur JavaScript. Sur un navigateur autre que Chrome, la ville affichée n'était pas celle du serveur : on passait « à travers » des bâtiments et les flics semblaient sortir d'un immeuble. Remplacé par un mélange rejouable (`shuffle(arr, rnd)`, aussi dans le manoir de Lampe torche). Le test vérifie qu'il n'y a plus de `sort` avec du hasard.

## 7 duodecies. Pense pareil 🧠 — validé (« Go les deux »)

Un thème (360 dans `games/pensepareil/prompts.js`), chacun écrit UNE réponse en secret (20/30/45 s).
- **Thèmes écrits par les joueurs** (réglage, ACTIF par défaut) : au début, chacun écrit ceil(thèmes / joueurs) thèmes (1 à 3, 🎲 pour piocher),
  joués à tour de rôle avec « Thème de X », complétés par la banque s'il en manque. Sur un thème inventé, les bots copient souvent une réponse déjà donnée.
- Révélation par paquets identiques (le plus gros en jaune). Fusion automatique : majuscules, accents, ponctuation,
  articles (le/la/un/des…), pluriels (s/x, -aux → -al). L'**hôte** peut fusionner deux paquets à la main (clic, clic) pendant la révélation.
- Points : 1 par autre joueur avec la même réponse. Partie : 5/8/12 thèmes (défaut 8) ; playlist 5/8.
- Bots : chaque thème a une liste de réponses courantes, ils piochent surtout les premières.

## 7 terdecies. 2 vérités, 1 mensonge 🤥 — validé (« Go les deux »)

Un thème proposé par manche (79 dans `games/deuxverites/themes.js`, avec une aide pour écrire).
- **Chacun choisit son thème** (réglage, ACTIF par défaut) : le thème proposé est pré-rempli, on le garde, on pioche 🎲 ou on écrit le sien ;
  le vote affiche le thème de l'auteur. Réglage « le même pour tous » = ancien fonctionnement.
- Chacun écrit 3 phrases sur lui et coche la fausse (60/90/120 s). Un joueur à la fois : ses phrases mélangées (A/B/C),
  les autres votent (20/25/35 s, on peut changer d'avis), révélation (mensonge en rouge, vérités en vert).
- Points : +1 si on trouve, l'auteur +1 par joueur piégé. Manches 1/2/3 (défaut 2) ; playlist 1/2.
- Bots : 3 phrases prêtes du thème, une déclarée fausse au hasard ; ils votent juste environ 1 fois sur 3.

## 7 quaterdecies. Moteur « bonhomme » + Sol qui s'effondre 🌋 — validé (« Go »)

**Moteur bonhomme** (`public/games/pieton/engine.js` = `globalThis.Pieton`, partagé serveur/navigateur comme `physics.js`) :
déplacement 8 directions avec inertie (230 px/s), dash (Espace, 680 px/s, 0,16 s, recharge 2 s), chocs entre joueurs
(un dash projette l'autre, « lourd » = masse ×3), murs (bord + rectangles), visée optionnelle (angle souris). Prédiction réseau
comme les voitures. **Dessin** (`hero-art.js` = `window.HeroArt`) : personnage **vu de dessus** (épaules à la couleur du joueur,
bras qui balancent, mains, tête avec cheveux à l'arrière, yeux et nez vers l'avant). Peau/cheveux stables selon l'id du joueur.
Servira à Territoire, Boules de neige, Lampe torche.

**Sol qui s'effondre** : arène de petites dalles (40 px, grille 32 × 19) au-dessus du vide, forme tirée au sort
(carré, rond, croix, anneau, îlots, gruyère), un peu plus grande à 5+ joueurs.
- Réglage **Dalles** : **solides** (défaut) = 1er passage fissure, 2e passage → tombe 0,9 s après ; **fragiles** = tombe dès le 1er
  passage (l'idée d'origine). Rester planté plus de 1,1 s fait tomber la dalle. On ne tombe que si aucun pied ne touche une dalle (passage en diagonale par un coin OK). Après 60 s, le bord s'effrite tout seul.
  (Simulation : en « fragiles » l'arène se découpe en ~5-10 s de jeu à 4 ; en « solides » 12-22 s → défaut « solides ».)
- **Espace = pousser** (demande de Scotty, à la place du dash) : bras tendus, ceux qui sont juste devant (≈ 30 px, ±70°) sont
  repoussés (330 px/s ≈ 2 dalles de glissade, moins s’ils sont lourds), on ne bouge pas ; recharge 0,9 s. Dalle dorée ★ toutes les ~7-11 s = **lourd 5 s**.
- Points : 1 par joueur tombé avant toi. Manches 3/5/7 (défaut 3) ; playlist 3/5. Fin de manche : 1,5 s pour voir la dernière chute.
- Bots : chemin de dalle intacte en dalle intacte (sans couper les coins) vers la zone la plus sûre ; dash sur un voisin
  au bord seulement si l'atterrissage est sûr.

## 7 quindecies. Territoire 🎨 — validé (« Go »)

Arène 1280 × 800 vue en entier, 5 à 8 obstacles au hasard. Grille de peinture de 80 × 50 cases (16 px), on compte les cases.
- **Marcher** peint (traînée de 20 px de rayon). **Clic gauche** = jet vers la souris (portée 180 px, vole par-dessus les
  obstacles, tache de 42 px, recharge 0,6 s). On repeint par-dessus les autres. **Pas de contact** entre joueurs (choix de Scotty).
- **Viseur relatif** (demande de Scotty) : il garde sa position par rapport au bonhomme (il le suit quand on marche) ;
  1er clic sur l’arène = souris capturée (pointer lock), Échap la libère.
- Mode (réglage) : auto (équipes 🔴/🔵 dès 4 joueurs) / chacun pour soi / 2 équipes.
- Bonus (caisse toutes les 7-10 s, 2 max) : 💣 bombe (tache de 115 px), 🧹 rouleau (traînée 46 px, 6 s), 👟 chaussures (×1,4, 5 s).
- Durée 60/90/120 s (défaut 90) ; playlist 60/90. Classement à la surface (égalité = même place).
- Réseau : seulement les cases changées à chaque envoi + la grille complète 1 fois/s (obstacles/équipes aussi 1 fois/s).
  Dessin : chaque case peinte = un petit rond (bords arrondis façon peinture).
- Bots : vont vers les zones « pas à eux » (adversaire > vide), visent la plus grosse zone adverse à portée, vont aux caisses.

## 7 sedecies. Boules de neige ❄️ — validé (« Go »)

Arène 1280 × 800 enneigée, 6 à 9 **murets** (4 points de vie : chaque boule les fait fondre et rétrécir, puis ils disparaissent).
- **3 cœurs**, 3 boules au départ (3 max). **Clic gauche maintenu = charger** (1 s pour le max), **relâché = lancer** :
  vitesse 520 → 1000 px/s, portée 230 → 630 px selon la charge. Boules en ligne droite, arrêtées par les murets.
- **Clic droit / R maintenu** : fabriquer une boule en 1 s, **immobile**. Viseur relatif (comme Territoire), souris capturée au 1er clic.
- Touché : −1 cœur, petit recul, invincible 0,6 s. 0 cœur = éliminé. Mort subite à 75 s (tout le monde à 1 cœur).
- Mode auto (équipes 🔴/🔵 dès 4) / chacun pour soi / équipes ; pas de tir ami. Manches 3/5/7 (défaut 3) ; playlist 3/5.
- Points : chacun pour soi = 1 par joueur éliminé avant toi ; équipes = 3 pour l'équipe gagnante ; + 1 par élimination.
- Bots : visent devant leur cible (anticipation), chargent selon la distance, tournent autour, se cachent derrière un muret
  pour refaire des boules. Simulation : manches de 15 à 50 s, ~1 touche pour 3-4 lancers.

## 7 septendecies. Lampe torche 👻 — validé (« Go »)

Choix de Scotty : contagion, lumière qui révèle + étourdit, manoir hanté aléatoire, batterie de lampe.
- **Manoir** (`public/games/lampe/manor.js`, globalThis.Manoir, partagé, tiré d une seed) :
  - grille de pièces de 300×260 (5×3 à 8×4 selon les joueurs), labyrinthe (tout est relié) + 35 % de portes en plus, 14 % de grandes ouvertures ;
  - pièces typées (salon, chambre, cuisine, bibliothèque, salle de bain, grande salle) avec leurs meubles : contre les murs sans porte (au milieu du mur) ou au centre, toujours à plus de 50 px d une porte et des autres meubles ;
  - grille de navigation de 20 px pour les bots ;
  - la lumière : `M.inCone` (portée 340, demi-angle 0,42, les murs l arrêtent, pas les meubles), `M.cone` (contour du cône par lancer de rayons, pour le dessin).
- **Rôles** : 1 fantôme de départ (chacun son tour, `firstGhosts`), endormi 3 s. **Contagion** : un humain touché devient fantôme, figé 1,5 s.
- **Les fantômes** :
  - même vitesse que les humains ; ils traversent les autres joueurs (pas les murs) ;
  - **dans la lumière** : visibles et ralentis ×0,55 ; éclairés **1,5 s** d affilée = **étourdis** 2,5 s (repoussés), puis insensibles à la lumière 2 s ;
  - vision de nuit à 420 px ; les lampes allumées se voient de partout.
- **Humains** : lampe vers le viseur (relatif + pointer lock), clic = allumer/éteindre, Espace = pousser (marche aussi sur les fantômes).
- **Batterie** : vide en 25 s allumée ; piles (+45 %, n+2 dans le manoir, réapparaissent ailleurs 8 s après).
- **Points** : humain +1 par 15 s, +3 s il est encore humain à la fin ; fantôme +2 par humain touché.
- **Réglages** : manches 3/5/8 (défaut 3), durée 60/90/120 s (défaut 90). Playlist : 3 ou 5 manches.
- **Écran** (client) : calque noir percé par les auras et les cônes (arrêtés par les murs) + lueur chaude ; le fantôme n apparaît que s il est éclairé (`seen`) ; quand un fantôme est à moins de 200 px, l écran tremble et rougit (« 💓 IL EST TOUT PRÈS ! »). Le fantôme voit un cercle autour de lui et les lampes.
- **Bots** :
  - humains : ils sentent un fantôme à moins de 230 px (ou éclairé), fuient en remontant le champ de distance, braquent la lampe dessus et poussent ; sans menace, la lampe n est allumée que de temps en temps ; ils vont chercher une pile si la batterie est basse ;
  - fantômes : ils ne voient que les lampes allumées et les humains à moins de 420 px ; sinon ils rôdent de pièce en pièce.
- **Simulation** (bots) : humains attrapés entre 20 s et 90 s, rarement un survivant (les bots humains sont plus faibles que de vrais joueurs).

### Refonte du manoir (brainstorm validé, « Go »)
- **Forme** (`manor.js`, cases de 150×130) :
  - les cases sont regroupées en pièces de 1×1 à 3×2 : placard, salle de bain, bureau, salon, chambre, cuisine, bibliothèque, salle à manger ;
  - pièces imposées : **hall** 3×2 (avec la grande porte), **long couloir** horizontal (tapis rouge), parfois un couloir vertical, **salle de bal** 4×2 ou 4×3 ;
  - portes : un arbre couvrant (tout est relié) + des portes en plus (55 % autour des couloirs, du hall et de la salle de bal, 25 % ailleurs) ;
  - murs fusionnés par ligne de la grille ; 8 + 0,9 × n cases de large, 6 ou 7 de haut.
- **Jardin** (340 px autour) : allées, haies, arbres, fontaine devant la grande porte, petit cimetière dans un coin, clôture. 2 ou 3 portes vers le jardin, fermées au départ.
- **Cave** : à droite, à part (dans le vide), 5 ou 6 × 4 cases (caves à vin, chaufferie). On y descend par 1 ou 2 **escaliers**.
- **Passages secrets** (2 ou 3, entre deux pièces éloignées) : une bibliothèque contre un mur.
  - On y entre en marchant **vers le mur** (sinon on se ferait téléporter en frôlant), et on ressort 46 px devant l'autre bout, 1,2 s avant le suivant.
  - Les fantômes les voient (cercle violet). Un passage dont la sortie est bloquée est retiré ; un manoir sans escalier utilisable est re-tiré (seed + 7919).
- **Portes** (`doors` en "0101…") : Espace à moins de 52 px = claquer ou rouvrir (pas sur quelqu'un). Une porte fermée bloque les humains, la lumière et le regard ; un fantôme qui pousse dessus la défonce en 2 s.
- **Lustres** : un interrupteur dans les grandes pièces ; Espace = 20 s de lumière (fantôme dedans révélé et ralenti, pas étourdi), puis 15 s d'attente. Un fantôme qui touche l'interrupteur l'éteint. Ça grésille les 3 dernières secondes.
- **Pièges** : planches qui craquent (repéré 2 s par les fantômes, onde visible), toiles d'araignée (humains ×0,6, déchirées en sortant).
- **Ambiance** : fenêtres sur les murs extérieurs avec rayons de lune ; éclair toutes les 15 à 30 s (tout s'illumine 0,26 s, sauf la cave) ; tableaux, armures, plantes mortes, lustres, toiles ; traces d'ectoplasme derrière les fantômes (visibles seulement dans la lumière).
- **Regard du fantôme** (demande de Scotty) :
  - cône de **520 px / 110°** vers son viseur (relatif + pointer lock aussi), arrêté par les murs et les portes fermées ;
  - il voit aussi les humains « exposés » de partout : lampe allumée, lune, lustre, planche qui craque, éclair ;
  - vitesse ×1,1 dans le noir ; les cônes des fantômes alliés sont dessinés en violet.
- **Bots** :
  - humains : ils ouvrent les portes quand ils sont coincés et allument un lustre si un fantôme approche ;
  - fantômes : ils ne voient que ce que voit un vrai fantôme, retiennent le dernier endroit où ils ont vu (ou entendu) un humain pendant 6 s, et balaient du regard.
- **Simulation** : équilibré (selon les manches, le fantôme gagne ou 1 à 3 humains survivent).
- **Retouches (Scotty)** :
  - cases ×1,2 (180×156) ;
  - jardin seulement **devant** (520 px : jardin à la française avec allée, portail, fontaine, parterres, buis, statues, bancs, lanternes, kiosque, haies, arbres) et **sur un côté** tiré au hasard (460 px : cimetière clôturé avec crypte, serre, puits, potager de citrouilles, arbres morts) ; derrière et de l'autre côté, le mur d'enceinte ;
  - caméra zoomée ×1,3 pour les humains (le fantôme garde ×1).

## 7 octodecies. La Nuit du Tueur 🔪 — validé (« Go »)

Idée de Scotty : le manoir de Lampe torche, tout le monde est humain sauf un tueur en série. Il y a autant de manches que de joueurs, et chacun est le tueur une fois.
Choix : s'échapper par les fusibles, 2 coups pour tuer, cachettes + portes + objets, noir + lampes.
- **Code partagé** :
  - le manoir (`public/games/lampe/manor.js`, + `M.hideSpots` : cachettes devant les armoires, lits, buffets, commodes et casiers posés contre un mur) ;
  - son dessin, sorti de Lampe torche dans `public/games/lampe/manor-art.js` (`ManoirArt.paint` pour le décor fixe, `ManoirArt.dynamic` pour les portes, interrupteurs et toiles).
- **Manches** : l'ordre des tueurs est tiré au début (`g.order`), avec `rounds` = nombre de joueurs. Si le tueur prévu est parti, on prend le suivant. Réglage : durée 2 / 3 / 4 min (3 par défaut). Playlist : pas d'option.
- **Objectif** :
  - 3 fusibles (4 à partir de 5 joueurs) éparpillés, loin du tableau électrique (cave ou pièce du fond). On en porte un à la fois ; un mort lâche le sien.
  - Tous branchés = alarme, et **le portail du jardin s'ouvre** ; entrer dans la zone devant le portail = échappé.
  - Fin de manche : plus aucun humain dedans, ou fin du temps (ceux qui restent sont « pris »).
- **Le tueur** :
  - il se réveille 4 s après le départ, va aussi vite qu'un humain ;
  - couteau au clic (44 px devant, ±0,85 rad, recharge 1 s, puis 1,5 s immobile pour essuyer la lame). 1er coup = blessé (adrénaline ×1,35 pendant 2 s, puis ×0,85, traînée de sang que le tueur voit), 2e coup = mort ;
  - il défonce une porte fermée en 2 s ; Espace devant une cachette = fouiller (1 s) : si quelqu'un est dedans, c'est un coup ;
  - il voit dans son cône de regard (520 px / 110°, arrêté par les murs et les portes fermées). Les humains « exposés » (lampe, lustre, planche qui craque, éclair) se voient de partout ;
  - les **bruits** apparaissent pour lui comme des ondes : porte claquée ou défoncée, planche qui craque, piège qui claque, pétard, alarme.
- **Humains** :
  - lampe (clic, batterie 25 s, piles) ;
  - Espace : porte (claquer / rouvrir), cachette (invisible, immobile, lampe éteinte ; Espace pour ressortir), lustre ;
  - **objets** (un seul, clic droit ou E) : 🪤 piège à loup (le tueur reste coincé 3 s, invisible pour lui), 🧨 pétard (lancé à 230 px, explose 1,2 s après = bruit), 🩹 trousse (soigne). Ils réapparaissent 25 s après avoir été ramassés.
- **Points** : humain +1 par fusible branché, +4 s'il s'échappe ; tueur +1 par blessure, +1 par victime (les mêmes pour tout le monde, puisque chacun est tueur une fois).
- **Bots** :
  - humains : fusibles → tableau → portail ; ils fuient en remontant le champ de distance, se cachent si une cachette est tout près, posent leur piège, lancent leur pétard sur le côté, se soignent, ouvrent les portes ;
  - tueur : il ne voit que ce que voit un vrai tueur, va voir les bruits, se souvient 7 s du dernier endroit, patrouille autour des fusibles et du tableau, fouille les cachettes qu'il croise.
- **Simulation** : le tueur bot gagne souvent contre les bots humains (qui fuient mal) ; une partie des humains branche des fusibles et s'échappe de temps en temps.

## 7 novodecies. Roi de la colline 👑 — validé (« Go »)

Idée de Scotty : tout le monde a une batte, apparaît en cercle autour d'une zone dorée ; chaque seconde dans la zone = 1 point.
Choix : la zone se déplace, une zone contestée ne rapporte rien, coup de batte simple, obstacles.
- **Arène** sur un écran (1280×800), palissade autour, 6 à 9 obstacles (piliers, caisses) loin du centre. Tout le monde apparaît en cercle (rayon 250) autour de la zone, chaque équipe de son côté.
- **Zone dorée** : rayon 110, au centre au départ, puis elle saute ailleurs toutes les 20 s (loin de l'ancienne, pas sur un obstacle). On voit la suivante 3 s avant : cercle en pointillé, compte à rebours, flèche.
- **Points** : chaque seconde, si un seul camp (un joueur, ou une équipe) est dans la zone, ceux qui y sont gagnent 1 s. Plusieurs camps = contestée (anneau rouge qui clignote), personne ne marque. À la fin de la manche, les secondes personnelles sont ramenées sur 10 points (le meilleur prend 10, les autres en proportion), pour qu'une manche en équipes ne pèse pas plus qu'une manche en chacun pour soi (demande de Scotty).
- **Batte** : clic, 64 px devant soi, ±1,05 rad, recharge 0,5 s. La victime part à 640 px/s (direction du coup et un peu vers l'extérieur) et contrôle mal pendant 0,45 s. Pas de coup ami en équipes.
- **Modes** : `aleatoire` (défaut : 1 chance sur 2 d'être en équipes, seulement à 4, 6 ou 8 joueurs pour des équipes égales), `equipes` (à partir de 3), `solo`. Manches 3 / 5 / 7, durée 60 / 90 / 120 s.
- **Bots** : ils vont dans la zone (ou la suivante juste avant le saut) ; près d'un ennemi, ils se placent pour le frapper vers l'extérieur de la zone.
- **Simulation** : zone contestée 20 à 40 % du temps, des centaines de coups par manche.

## 7 vicies. Parkour 🏃 — validé (« Go »)

Idée de Scotty : un jeu de réflexe comme le dinosaure de Chrome, chaque joueur sur sa ligne, le plus loin gagne.
Choix : éliminé au 1er choc, le même parcours pour tout le monde, sauter + s'accroupir + glisser + trous, rien d'autre que la course.
- **Moteur partagé** (`public/games/parkour/course.js`, globalThis.Parkour) :
  - le parcours, tiré d'une seed et généré au fur et à mesure, toujours dans le même ordre ;
  - le pas de course (1/30 s), identique sur le serveur et le navigateur.
- **Coureur** :
  - vitesse 420 px/s + 16 px/s par seconde jusqu'à 1060 (40 s), puis +14 px/s par seconde jusqu'à 1700 ;
  - saut vif et court : 900 px/s, gravité 4200 (2400 si on garde appuyé pendant 0,15 s = saut plus haut), ↓ en l'air = plongeon (7500). Saut simple ≈ 96 px de haut et 0,43 s en l'air, saut maintenu ≈ 143 px ;
  - glissade 0,55 s (ou tant qu'on garde ↓) : hauteur 26 au lieu de 50 (le dessin du bonhomme tient exactement dans cette zone) ;
  - atterrissage : dès qu'on touche le sol on s'y pose, même en plongeon très rapide (avant, on « passait sous le sol » et on mourait comme dans un trou).
- **Obstacles** : haie (0–38), caisse (0–72), barre (bloque au-dessus de 40), oiseau haut (40–72), oiseau bas (10–40), trous de 90 à 240 px. Dès ~450 m, des enchaînements haie + barre. 2e palier de 3000 à 8000 m : enchaînements de plus en plus fréquents (triple haie/barre/haie, trou puis oiseau bas, double caisse), trous plus larges, temps entre deux obstacles jusqu'à ~0,35 s. Vérifié par calcul : 15 parcours restent passables jusqu'à 25 000 m par un joueur parfait.
- **Serveur** :
  - un pas de course par touche reçue (comme la prédiction du navigateur), jamais plus vite que le temps réel (+ 8 pas de marge réseau) ;
  - un joueur qui n'envoie plus rien depuis 1 s (onglet en pause) court quand même, sans toucher aux commandes (un petit lag ne fait jamais rater un saut) ;
  - fin de manche quand tout le monde est tombé, ou quand le dernier en course a fait 1000 m de plus que l'avant-dernier (compteur « 🏆 encore X m » sur sa ligne) ; au plus 3 min ;
  - classement à la distance : 10, 7, 5, 3, 2, 1 points.
- **Écran** : une ligne par joueur (empilées), avec à GAUCHE un panneau pseudo + distance en très gros ; la mienne a un gros cadre doré, l'étiquette « TOI » et une flèche au-dessus du bonhomme, les autres sont un peu assombries. Ville au crépuscule (ciel clair), 2 plans d'immeubles bas qui ne changent jamais de forme (chacun attaché à sa place), obstacles en couleurs vives avec halo clair + contour noir et un triangle rouge au sol devant chacun (haie rayée rouge/blanc, caisse orange, barre jaune/noir, oiseau rouge), tous dessinés à la taille exacte de leur zone de choc, trous noirs avec bords rayés + cônes, coureur en bâtons (course, saut, glissade) avec halo clair + contour noir pour ressortir du décor, distance en mètres (10 px = 1 m).
- **Bots** : temps de réaction de 0,16 à 0,28 s, une petite erreur de timing qui grandit avec la vitesse, et un raté de temps en temps.
- **Simulation** : manches de 25 à 45 s entre bots, avec des écarts nets.

## 7 unvicies. Grand Prix 🏁 — validé (« Go »)

Idée de Scotty : une course sur un circuit généré au hasard, chacun choisit sa supersportive (3 voitures uniques).
Choix : vue de dessus, course en X tours, nitro + poussettes, virages variés + obstacles. Ajouts : nitro de rattrapage, 2 modes (course / élimination / aléatoire par défaut), barrières tout autour.
- **Circuit** (`public/games/course/track.js`, globalThis.CourseTrack, partagé serveur + navigateur) :
  - 12 à 17 points de contrôle autour d'un centre (certains rentrés = épingles/chicanes, d'autres sortis = grandes courbes), courbe lisse fermée, ~1300 m le tour, piste à 3 voies (240 px, 2 lignes pointillées) ;
  - refusé et refait (seed + 7919) si un virage est trop serré (rayon < 150 px) ou si la piste se touche elle-même (le test vérifie 300 circuits sans échec) ;
  - départ au milieu de la plus longue ligne droite, grille en 3 colonnes (une par voie) ;
  - environ 2 circuits sur 3 ont 1 à 3 portions étroites, à 2 voies ou à 1 seule (480 à 1000 px), annoncées par des plots, puis la piste revient à 3 voies ; de l'herbe sur les côtés ;
  - un circuit sur deux a de vraies épingles (au moins 2 virages de rayon 125 à 165 px) ;
  - barrières de sécurité des 2 côtés, reculées de 60 px (segments, physique « murs en segments ») : on ne peut pas sortir. Entre le vibreur et la barrière, de l'herbe sans aucune adhérence : on y glisse comme sur de la glace ;
  - pneus derrière la barrière dans les virages serrés, bottes de paille sur les longues lignes droites (à éviter), plots à la corde (on les renverse, pur décor).
- **Voitures** (dans `physics.js`, réservées à la course) :
  - ⚡ ÉCLAIR : la plus rapide en ligne droite, glisse plus ;
  - 🐍 VIPÈRE : accélère et tourne le mieux, légère (se fait pousser) ;
  - 🦏 TITAN : lourde (×2,1), pousse très fort, colle à la route, moins rapide.
  - Vitesse max : ÉCLAIR ≈ 645, VIPÈRE ≈ 609, TITAN ≈ 585 px/s (ÉCLAIR freinée et les 2 autres remontées à la demande de Scotty : l'écart est passé de 28 % à 10 %).
  - Simulation entre bots : places moyennes ≈ 2,7 à 4,3 sur 6 selon les circuits.
- **Nitro** : un peu avec le temps (0,05/s) + beaucoup en dérapant (+0,22/s), × rattrapage : 1 pour le 1er → 2 pour le dernier.
- **Déroulé** : 10 s pour choisir sa voiture (le mode de la manche est annoncé), grille (le leader au classement part derrière), feux, GO.
  - 🏁 Course : 2/3/5 tours ; après l'arrivée du 1er, 20 s pour finir ; classement arrivée puis avancée.
  - 💥 Élimination : toutes les 20 s, le dernier (marqué 💣, nom en rouge) explose (souffle autour) ; le survivant est 1er.
  - Coincé 3 s (bots 2 s) ou touche R : retour sur la piste au dernier endroit sûr.
  - Points 10, 7, 5, 3, 2, 1. Au plus 6 min par manche.
- **Écran** : caméra qui suit (dézoome un peu avec la vitesse), position + tour, classement en direct, km/h + jauge de nitro (avec le ×rattrapage), mini-carte, compte à rebours d'explosion, cartes de choix de voiture avec aperçu et étoiles.
- **Bots** : suivent le milieu (un peu décalés), freinent selon le virage qui arrive, évitent la paille, nitro en ligne droite.

### Nitro et taser sous la mini-carte

Demande de Scotty : la barre en haut était trop loin des yeux pendant une poursuite ; l'arc autour de la voiture gênait la vue. Dans Avis de recherche et Chat et souris, une grosse barre 🔥 NITRO est dessinée juste SOUS la mini-carte (bleu, orange qui clignote pendant la nitro, rouge sous 25 %), et pour les flics une barre ⚡ TASER (jaune qui se remplit, secondes restantes, « PRÊT ! » qui clignote). Partagé : VehicleArt.bar (vehicles-art.js). La touche M (grande carte) et le texte « M = carte » ont été retirés.

## 7 duovicies. La Tour 🌋 — refaite en labyrinthe (« Go »)

Idée de Scotty : un parkour vertical, on court, on saute, on s'accroupit, on saute sur les murs, le dernier en vie gagne. La 1re version (plateformes dans le vide) ne lui plaisait pas : il voulait un espace serré, des murs partout, plusieurs chemins.
Choix : labyrinthe vertical, routes rapide/risquée ou lente/sûre, caméra zoomée, mouvement inchangé, aucun contact entre joueurs.
- **Moteur partagé** (`public/games/tour/tower.js`, globalThis.Tower) : le labyrinthe (seed, étage par étage), le pas du perso (1/30 s) et le bot, identiques sur le serveur et le navigateur.
- **Perso** : course 340 px/s, accroupi 190 ; saut 760 px/s (129 px, 170 px en maintenant) ; ↓ en l'air = chute rapide ; temps de grâce au bord (0,08 s), saut mémorisé (0,1 s).
- **Saut mural** : contre un mur on glisse, sauter rebondit de l'autre côté ; pas deux fois de suite le même côté.
- **Double saut** : ressauter en l'air (680 px/s, ~105 px de plus, 280 px en tout), une fois ; il revient au sol et après un saut mural.
- **Types d'étages** (Scotty trouvait ça encore trop répétitif) : tirés dans un sac, jamais deux fois de suite le même.
  - **multi** : 2 ou 3 routes au choix (puits, zigzag, corniches) ;
  - **goulet** : un seul zigzag sur toute la largeur ; **puits** : un seul puits, n'importe où ;
  - **sauts** : salle ouverte, des morceaux du temple dépassent des murs à gauche puis à droite (3 ou 4 cases de haut, sauts simples). Plus de plateformes fines, Scotty les trouvait moches ;
  - **double** : même salle en pierre polie turquoise (pas de saut mural dessus), 5 ou 6 cases entre deux morceaux, annoncés par des chevrons dorés : impossible sans double saut.
  - **Largeurs au hasard** : puits de 2 à 5 cases, cheminées de 2 à 4, couloirs de 2 à 4 de haut, salles de 12 à 26 cases, puits avec plus ou moins de piques.
  - Les arrivées d'étage sont de gros linteaux de pierre.
- **Décor** : temple aztèque dans la jungle. Fond clair de jungle et pyramides en parallaxe, pierre chaude avec motifs gravés et turquoise, mousse, lianes, fougères, torches rares. Pas d'effet sur le jeu.
- **Version** : le serveur envoie l'empreinte de la tour (P.sig) ; si le navigateur a une autre tour (page d'avant une mise à jour), il se recharge une fois.
- **Labyrinthe** (tracé au hasard, Scotty trouvait que c'était toujours le même plan) : cases de 40 px, 28 de large. Chaque étage tire sa hauteur (21 à 29 cases), son nombre de routes (2 ou 3), leur ordre et leur largeur. Un hall bas (120 px, plafonds bas), puis un bloc de murs où sont creusées les routes. Un seul rebord par route, à l'arrivée (orange parfois sur les zigzags : il s'effrite).
  - **puits** (rapide, risqué) : 120 px de large, tout droit au saut mural, quelques piques seuls sur les murs ;
  - **zigzag** (lent, sûr) : une suite tirée au hasard de montées au saut mural (cheminées de 120 px) et de couloirs de 80 px, dans un sens ou dans l'autre, avec un plafond bas à passer accroupi (ou rarement un pique au sol) ;
  - entrée de chaque couloir plus haute (on y arrive en plein vol), 2 cases de sol avant un plafond bas (on ne s'accroupit pas en l'air). Pas de cul-de-sac.
  - **Piques** : toujours un seul à la fois. Ils n'éliminent pas : sonné 0,5 s (plus de commandes, on retombe si on est en l'air), puis 1 s de protection. Dessinés avec une seule pointe. Seule la lave élimine.
- **Vérifié** : une recherche exhaustive des touches trouve une solution pour chaque montée de chaque route (puits et zigzags).
- **Lave** : hauteur = -400 + 26 t + t². Saut mural : 800 px/s. L'écran rougit sous 34 m.
- **Fin** : 2,5 s après qu'il ne reste qu'un joueur ; points 10, 7, 5, 3, 2, 1 (survivant, puis ordre inverse des éliminations). Au plus 4 min.
- **Écran** : caméra zoomée ×1,4 qui suit dans les 2 sens (spectateur : le plus haut en vie), couloirs clairs et murs de pierre avec bord clair, hauteur en gros à gauche, distance à la lave, barre de position à droite.
- **Bots** : à chaque étage, ils choisissent une route selon leur goût du risque et la suivent point par point, avec des pauses.

## 7 tervicies. Cambrioleurs 💰 — validé (« Go »)

Lampe torche et La Nuit du Tueur ont été retirés (trop lents, rôles déséquilibrés ; le code reste dans l'historique Git). Le manoir est gardé (`public/games/manoir/`) pour ce jeu, où tout le monde joue à égalité.
- **Principe** : chacun pour soi dans le même manoir, un seul van pour tous au milieu du parking (l'argent déposé va à celui qui dépose). 2 manches de 2 min par défaut, classement à l'argent (10, 7, 5, 3, 2, 1).
- **Manoir** : `M.build(seed, n, { small: true })`, plus petit, tout éclairé (le décor de nuit est peint plus clair). Dehors, un parking vide. 5 à 7 sorties (devant et sur le côté) : personne ne peut attendre les autres à une seule porte. Pas de portes, de lustres, d'interrupteurs, de toiles ; escaliers et passages secrets gardés.
- **Butin** (`public/games/casse/loot.js`) : un seul objet à la fois, ramassé en passant dessus, déposé en arrivant à sa camionnette. Argenterie 100 $ (vitesse ×1,05), vase 300 $ (×0,9), tableau 600 $ (×0,72), coffre 1 500 $ (×0,5) ; mains vides ×1,15. Nouveaux objets toutes les 2,5 s.
- **Touche E** (ou F) : échange son objet avec l'objet par terre le plus proche (à moins de 62 px), sinon pose le sien. L'objet posé ne se reprend qu'après 1,2 s. Une étiquette sous le bonhomme dit ce que fait E.
- **Pousser** (Espace) : seulement à l'intérieur (ni le pousseur ni la cible sur le parking). Fait lâcher l'objet, n'importe qui peut le ramasser (1,2 s de délai pour celui qui l'a lâché).
- **Gardiens** : 2 à 4, vitesse ×0,82, se promènent dans le manoir (pas la cave, pas le parking), voient à 240 px (pas à travers les murs). Ils ignorent ceux qui n'ont rien. Attrapé = ils reprennent l'objet, sonné 1 s, puis 3,5 s de tranquillité ; le gardien va poser l'objet dans une autre pièce au hasard (un coffre rangé est annoncé).
- **Coffre-fort** : un par 40 s, annoncé avec sa pièce. **Alarme** : les 30 dernières secondes, le butin déposé vaut double.
- **Écran** : caméra qui suit, classement en direct, flèche vers le van quand je porte, annonces en bas à gauche. Pas de mini-carte.
- **Passages** : portail animé bien visible, même couleur aux 2 bouts d'un passage secret, jaune pour les escaliers ; flèche vers le mur, et de près une étiquette qui dit ce que c'est et quoi faire.
- **Bots** : meilleur objet selon valeur et distance, retour au van, poussent ceux qui portent à côté d'eux (à l'intérieur).

### Temps de réflexion doublés

Demande de Scotty : Classement, Pense pareil, 2 vérités 1 mensonge, Sur 10 et Qui de nous ? laissent environ 2 fois plus de temps (écrire, classer, voter, choisir le thème).

### Choix de la couleur

Dans le salon, chaque joueur choisit sa couleur parmi 12. Elle sert dans tous les jeux (sauf quand un jeu impose celle d'une équipe ou d'un rôle). Une couleur prise par un bot reste disponible : le bot récupère l'ancienne couleur du joueur. La couleur d'un autre joueur est barrée. Elle est mémorisée dans le navigateur pour les salons suivants.

### Imposter : un seul mot après un vote

Le 1er tour garde le nombre de tours d'indices réglé. Dès que la manche continue après un vote (élimination d'un civil, ou égalité), chacun ne donne plus qu'un mot avant de revoter.

### Playlist et manches

- **Playlist** : boutons Tout, Rien et une catégorie (Action, Ambiance, Bluff, Quiz). L'hôte règle chaque jeu avec l'engrenage ⚙️ sur sa tuile (mode, manches, difficulté…) ; il n'y a plus de vote ni d'écran de réglages avant les jeux, juste une annonce de 5 s.
- **Mode Alterné** (à la place d'aléatoire) : Roi de la colline, Sumo, Boules de neige : manche 1 chacun pour soi, manche 2 en équipes, etc., quand c'est possible (équipes égales, dès 4 joueurs pour les jeux à pied). Territoire : d'une partie à l'autre. Grand Prix : course puis élimination.
- **Plus de manches** dans les jeux courts : Néon 8, Parkour et Chat et souris 7, Patate, Sumo, Avis de recherche, Sol qui s'effondre, Boules de neige, Roi de la colline, La Tour et Grand Prix 5.

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

## Textes des jeux d'ambiance

Scotty trouvait certaines descriptions trop complexes. Règle : la carte du jeu tient en une phrase, les règles du salon en 3 ou 4 lignes courtes, l'aide explique seulement le déroulé. Les détails des points restent dans la section Points de l'aide.

## 7 quatervicies. Cavale 🚨 — validé (« Go »)

Inspiré du mode Cops and Runners de Garry's Mod. Jeu à pied, vue de dessus, 3 à 8 joueurs, en équipes qui tournent.
- **Équipes** : 1 flic à 3-4 joueurs, 2 à 5-6, 3 à 7-8. Les rôles tournent à chaque manche, chacun joue flic à son tour. 4 manches de 2 min par défaut.
- **Quartier** (`public/games/cavale/quartier.js`, globalThis.Quartier, partagé serveur + navigateur) : tiré d'une seed, en cases de 32 px, 104 × 70. Rues de 4 cases, ruelles, maisons à traverser, cours clôturées (on tire à travers), parcs, immeubles, voitures garées et poubelles. Dessin réaliste : asphalte, passages piétons, bordures, toits variés avec machines, ombres portées, lampadaires.
- **Prison** : un gardien (le premier flic de la manche) la pose où il veut, clic ou Espace, avec un aperçu au sol. Il a 10 s, sinon elle se pose à ses pieds. C'est un simple cercle à bordure transparente (rayon 210 px), sans murs. Il ne change rien au décor : bâtiments et voitures restent, c'est au gardien de bien choisir (impasse, ruelle…). Les prisonniers arrivent sur une case accessible du cercle. Le taser ne marche qu'une fois la prison posée et les 5 s passées.
- **Vitesse** : ×1,8 (414 px/s) à la demande de Scotty, sprint ×1,4.
- **Déroulé** : les runners partent 5 s avant les flics. Le taser (clic gauche, tir instantané, portée 340 px, recharge 5 s) sonne le runner 1,5 s ; le flic reste figé 0,4 s après un tir ; il doit toucher le runner sonné pour l'envoyer en prison. Un prisonnier ne peut pas sortir du cercle (`env.circle` dans le moteur à pied), tous les autres y entrent et en sortent librement. Un runner libre touche un prisonnier : il est libéré et protégé 1,5 s, sur place.
- **Fin** : les flics gagnent si tous les runners sont en prison, les runners s'ils tiennent 2 min.
- **Anti-camping** : un flic qui reste 8 s près de la prison (340 px) ralentit de 35 %.
- **Gadgets** : caisses jaunes (9, retour en 20 s), un seul à la fois, Espace / E. Fumigène : clic droit maintenu pour viser (320 px, s'arrête au premier mur), clic gauche pour lancer ; clic gauche sans viser ou Espace : à ses pieds. Runners : sprint, fumigène (bloque les tirs et la vue), peau de banane. Flics : sprint, barrage (8 s), taser rapide (10 s, recharge 1,5 s).
- **Points** : +2 par arrestation, +2 par prisonnier libéré, +3 si libre à la fin, +2 pour l'équipe gagnante.
- **Écart avec la proposition** : portée 340 au lieu de 380, stun 1,5 s au lieu de 2 s, recharge 5 s au lieu de 4 s et 0,4 s de recul, pour équilibrer d'après les simulations.
- **Bots** : chemin par carte des distances. Le flic ne poursuit que ceux qu'il voit (520 px), sinon il va où il les a perdus ou fait sa ronde. Le runner fuit, ramasse des gadgets et va toucher les prisonniers si aucun flic ne garde le cercle.
- **Écran** : caméra qui suit, chrono en haut, mini-carte en bas à droite pour les runners seulement (prison, coéquipiers). Les flics n'en ont pas, à la demande de Scotty : ils ont juste leurs barres de taser et de gadget.

