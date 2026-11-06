// ===================================================================
//  LE BORDEL — Aide détaillée de chaque jeu (bouton ❓)
//  Une entrée par jeu (même id que le jeu) :
//    goal     : le but en une phrase
//    steps    : comment se passe une partie, étape par étape
//    controls : (facultatif) les touches
//    points   : comment on gagne des points
//    example  : un petit exemple de partie
//  👉 Le texte peut contenir du HTML simple (<b>, <i>, <kbd>).
// ===================================================================

(() => {
  const DRIVE = [
    "<kbd>Z</kbd> / <kbd>↑</kbd> accélérer · <kbd>S</kbd> / <kbd>↓</kbd> freiner puis reculer",
    "<kbd>Q</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> tourner",
    "<kbd>Espace</kbd> frein à main → dérapage",
    "<kbd>Shift</kbd> nitro (la jauge se recharge toute seule)",
  ];

  window.GAME_HELP = {
    imposter: {
      goal: "Trouver qui n'a pas le même mot que les autres… ou, si c'est toi, ne pas te faire griller.",
      steps: [
        "Chacun reçoit un <b>mot secret</b>. Les <b>civils</b> ont tous le même mot. L'<b>Undercover</b> a un mot proche mais différent (selon les réglages, il ne sait même pas qu'il est l'imposteur !). <b>Mr White</b>, lui, n'a <b>aucun mot</b>.",
        "<b>Tour d'indices</b> : chacun son tour, tu donnes <b>un mot</b> en rapport avec ton mot secret. Pas trop précis (sinon l'imposteur devine), pas trop vague (sinon on te soupçonne).",
        "Après les tours d'indices : <b>vote</b>. Clique sur la carte de celui que tu soupçonnes. Le plus voté est éliminé et son rôle est dévoilé.",
        "Si Mr White est éliminé, il a une dernière chance : <b>deviner le mot des civils</b>. S'il trouve, il gagne tout seul !",
        "On recommence, avec cette fois <b>un seul mot chacun</b> avant de revoter, jusqu'à ce qu'un camp gagne : les civils quand tous les imposteurs sont dehors, les imposteurs quand ils sont aussi nombreux que les civils.",
      ],
      points: [
        "Civils gagnants : <b>+2</b> chacun.",
        "Undercover gagnant : <b>+6</b>.",
        "Mr White qui devine le mot : <b>+8</b> · Mr White qui survit jusqu'au bout : <b>+6</b>.",
        "(L'hôte peut changer ces valeurs dans les réglages.)",
      ],
      example: "Les civils ont <b>« Pizza »</b>, l'Undercover a <b>« Burger »</b>. Alice dit « fromage », Bob (l'Undercover) dit « pain »… tout le monde le regarde bizarrement. Mr White, qui n'a aucun mot, entend « fromage », « four », « Italie » et dit « garniture » pour se fondre dans la masse. Au vote, Bob est éliminé : c'était bien l'Undercover !",
    },

    patate: {
      goal: "Ne pas avoir la bombe quand elle explose. Le dernier en vie gagne la manche.",
      steps: [
        "Au début de la manche, on vote pour le <b>véhicule</b> (ou il est tiré au hasard) : tout le monde a le même.",
        "Une voiture reçoit la <b>bombe 💣</b>. Pour t'en débarrasser, <b>touche une autre voiture</b> : elle la récupère.",
        "La mèche est <b>cachée</b>, mais la bombe clignote de plus en plus vite. Quand elle explose, celui qui l'a est <b>éliminé</b> et son épave reste sur la map comme obstacle.",
        "Une nouvelle bombe part, et ainsi de suite jusqu'au dernier survivant.",
        "Celui qui a la bombe va un peu plus vite et a plus de nitro (réglage), pour pouvoir chasser.",
        "Attention à la map : terre, neige et flaques d'huile glissent. Taper l'arrière d'une voiture la fait partir en tête-à-queue !",
      ],
      controls: DRIVE,
      points: ["<b>1 point par joueur éliminé avant toi</b> : le dernier survivant prend le plus de points."],
      example: "Tu as la bombe 💣 et elle clignote vite. Tu mets un coup de nitro, tu fonces sur Bob qui dérape sur la neige… <b>contact !</b> La bombe passe chez lui. Il essaie de te la rendre, mais tu tournes derrière un rocher. BOUM : Bob est éliminé.",
    },

    sumo: {
      goal: "Rester sur le sol le plus longtemps possible et faire tomber les autres dans le vide.",
      steps: [
        "Au début de la manche, tu choisis ton <b>véhicule</b> parmi 3 cartes : le camion pousse fort mais tourne mal, la moto est agile mais légère…",
        "La version est tirée au hasard : 🔴 <b>Arène</b> (une plateforme ronde qui rétrécit petit à petit) ou 🏝️ <b>Îles</b> (plusieurs îles reliées par des couloirs).",
        "En Arène : <b>pousse les autres dehors</b> avant que la plateforme devienne minuscule.",
        "En Îles : une île s'allume avec un <b>chrono</b>. À 0, <b>tous ceux qui ne sont pas dessus explosent</b>. Puis une autre île s'allume…",
        "Si tu sors du sol, tu tombes : éliminé. Ramasse le 🎁 pour changer de véhicule au hasard.",
        "Avec un nombre pair de joueurs, la manche peut se jouer en <b>2 équipes</b> (rouges contre bleus).",
      ],
      controls: DRIVE,
      points: [
        "<b>1 point par joueur éliminé avant toi</b>.",
        "<b>+1</b> par voiture que tu as éjectée (la dernière à l'avoir touchée avant sa chute).",
        "En équipes : chaque membre de l'équipe gagnante prend <b>3 points</b> (+1 s'il est encore en vie).",
      ],
      example: "Tu prends le <b>camion</b>. L'arène rétrécit, Alice en moto te tourne autour. Tu fonces, elle esquive… mais tu touches Bob qui part en arrière et tombe dans le vide : « 💥 Toi as éjecté Bob ! » +1 pour toi.",
    },

    cs2map: {
      goal: "Reconnaître le plus vite possible de quelle map de Counter-Strike 2 vient une image.",
      steps: [
        "Une image prise dans une map de CS2 s'affiche, mais <b>cachée</b> : très zoomée, dans un trou noir, en morceaux… Elle se dévoile petit à petit.",
        "Clique sur le <b>nom de la map</b> dans la liste. <b>Une seule réponse</b>, pas le droit de se corriger !",
        "Quand tout le monde a répondu (ou à la fin du chrono), l'image entière s'affiche avec la réponse et les points.",
        "Image suivante, jusqu'à la fin de la série.",
      ],
      points: [
        "Bonne réponse : jusqu'à <b>10 points</b>. Plus tu réponds tôt, plus tu gagnes (4 points à la dernière seconde).",
        "Mauvaise réponse ou pas de réponse : 0.",
      ],
      example: "L'image commence zoomée sur une caisse et un mur jaune. Tu hésites entre Dust2 et Mirage… Le zoom recule, tu vois une arche : tu cliques <b>Dust2</b> au bout de 4 s → <b>9 points</b>. Bob attend la fin pour être sûr : juste, mais seulement 5 points.",
    },

    quidenous: {
      goal: "Voter pour le joueur qui colle le mieux à chaque question… et voter comme la majorité.",
      steps: [
        "Chacun <b>écrit une question</b> qui commence par « Qui… ? » (bouton 🎲 si tu n'as pas d'idée).",
        "Les questions passent une par une, <b>sans dire qui les a écrites</b>. Pour chacune, clique sur un joueur (tu peux voter pour toi).",
        "À la fin, la <b>cérémonie</b> : pour chaque question, on voit qui a voté pour qui, qui a écrit la question, et qui gagne le <b>titre</b>.",
        "Le palmarès final montre les titres gagnés par chacun.",
      ],
      points: ["<b>+1</b> chaque fois que tu as voté pour le joueur le plus désigné (tu as voté comme la majorité)."],
      example: "Question : « <b>Qui finirait en prison en premier ?</b> ». Tu votes pour Bob. À la cérémonie : 3 votes pour Bob, 1 pour Alice. Bob gagne le titre « finirait en prison en premier » 😂 et toi tu prends <b>+1</b>. Et surprise : c'est Alice qui avait écrit la question !",
    },

    neon: {
      goal: "Ne toucher aucun mur de lumière. Le dernier en vie gagne la manche.",
      steps: [
        "Tu conduis une <b>moto</b> qui avance <b>toute seule</b> : impossible de s'arrêter.",
        "Ta moto laisse derrière elle un <b>mur de lumière</b> qui disparaît après quelques secondes.",
        "Si tu touches un mur (même le tien !), un obstacle ou le bord : <b>BOUM</b>, éliminé.",
        "Le but : couper la route des autres pour qu'ils s'écrasent sur TON mur.",
        "Après un moment, la <b>zone rétrécit</b> : les bords se rapprochent et ça devient très serré.",
        "<kbd>Espace</kbd> : <b>saut</b> par-dessus un mur (recharge de 5 s). Ça peut sauver une manche !",
      ],
      controls: [
        "<kbd>Z</kbd> / <kbd>↑</kbd> accélérer · <kbd>S</kbd> / <kbd>↓</kbd> ralentir (jamais à l'arrêt)",
        "<kbd>Q</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> tourner",
        "<kbd>Espace</kbd> sauter",
      ],
      points: [
        "<b>1 point par joueur éliminé avant toi</b>.",
        "<b>+1 par kill</b> : quand quelqu'un s'écrase sur ton mur.",
      ],
      example: "Bob fonce tout droit. Tu accélères, tu le doubles et tu tournes juste devant lui : ton mur lui barre la route. Il essaie de sauter, mais son saut n'est pas rechargé… BOUM. <b>+1 kill</b> pour toi !",
    },

    carfoot: {
      goal: "Marquer plus de buts que l'équipe d'en face avec ta voiture.",
      steps: [
        "Les joueurs sont répartis en <b>2 équipes</b> au hasard : 🔵 Bleus (à gauche) et 🔴 Rouges (à droite).",
        "Pousse le <b>ballon</b> dans la <b>cage d'en face</b> en fonçant dedans avec ta voiture. Plus tu vas vite, plus tu frappes fort.",
        "Le ballon rebondit sur les murs. Tu peux entrer dans les cages (pratique pour défendre !).",
        "Après chaque but : remise en jeu au centre avec un compte à rebours.",
        "À la fin du chrono, l'équipe qui a le plus de buts gagne. En cas d'égalité : <b>but en or</b> (le prochain but gagne).",
      ],
      controls: DRIVE,
      points: [
        "L'équipe gagnante prend la <b>1re place</b>, l'autre la 2e.",
        "Match nul : tout le monde ex æquo.",
      ],
      example: "Tu es chez les 🔴. Au coup d'envoi, tu prends le nitro et frappes le ballon, qui rebondit sur le mur du haut. Ton coéquipier arrive en dérapage et le pousse dans la cage bleue : <b>⚽ BUT des Rouges !</b>",
    },

    sur10: {
      goal: "Deviner la note secrète des autres grâce à leur indice… et donner des indices faciles à deviner.",
      steps: [
        "On vote pour le <b>thème</b> de la manche parmi 3 (exemple : « Un jeu vidéo »).",
        "Chacun choisit une <b>note secrète</b> de 0 à 10. Personne ne la voit.",
        "Puis tu écris un <b>indice</b> : un truc du thème qui vaut <b>ta note</b>, selon <b>tes goûts à toi</b>.",
        "Un joueur à la fois, son indice s'affiche. Les autres <b>devinent sa note</b> : clique un chiffre puis <b>Valider</b>. C'est le moment de débattre sur Discord !",
        "<b>Révélation</b> : la vraie note s'affiche sur une réglette de 0 à 10, avec les réponses de chacun.",
        "Certains thèmes ont leur propre échelle, écrite sous le thème (« Un animal : 0 = inoffensif · 10 = mortel »).",
      ],
      points: [
        "Note exacte : <b>3 points</b> · à 1 près : <b>2</b> · à 2 près : <b>1</b>.",
        "L'auteur de l'indice : <b>+1 par joueur</b> qui l'a trouvé à 1 près ou mieux (un bon indice rapporte !).",
      ],
      example: "Thème « <b>Un jeu vidéo</b> ». Tu choisis <b>10</b> et tu écris « <b>Rust</b> » parce que pour toi c'est le meilleur jeu du monde. Alice dit 9 (+2), Bob dit 3 (« Rust c'est nul ! » → 0 point). Comme Alice t'a trouvé à 1 près, tu prends <b>+1</b>.",
    },
    classement: {
      goal: "Deviner comment ton pote classe 5 choses selon ses goûts… et être le plus prévisible quand c'est toi le juge.",
      steps: [
        "À chaque manche, un joueur est le <b>juge</b> ⚖️ (chacun son tour). Il choisit un <b>thème</b> parmi 3, comme « Un fast-food ».",
        "<b>5 choses</b> du thème s'affichent (McDo, KFC, Five Guys…).",
        "Le juge les <b>classe selon SES goûts</b>, du 1er au 5e. En même temps, les autres essaient de <b>deviner son classement</b>.",
        "Pour classer : <b>glisse</b> chaque chose sur sa place (1er à 5e). Glisse une place sur une autre pour les <b>échanger</b>, ou sur la liste pour la retirer. Tu peux aussi juste cliquer les choses dans l'ordre. Puis <b>Valider</b> (tu peux encore changer et renvoyer).",
        "<b>Révélation</b> : le classement du juge à côté de celui de chaque joueur. Vert = bonne place, jaune = à une place près.",
      ],
      points: [
        "<b>2 points</b> par chose à la bonne place, <b>1 point</b> si elle est à une place près (10 points maximum).",
        "Le juge gagne la <b>moyenne</b> des points des autres : il a intérêt à être sincère et prévisible !",
      ],
      example: "Le juge, c'est Bob, thème « <b>Un plat</b> ». Tu sais qu'il adore la raclette et déteste le foie : tu mets <b>Raclette</b> 1er et <b>Foie de veau</b> 5e. Bob avait mis Raclette 1er, Pizza 2e… et le foie 5e. Tu as 2 places exactes et 2 à une place près = <b>6 points</b>.",
    },

    chat: {
      goal: "En souris : ne pas te faire attraper. En chat : attraper toutes les souris.",
      steps: [
        "Au début de chaque manche, un joueur est le <b>chat</b> 🐱 (2 chats à partir de 5 joueurs). Tous les autres sont des <b>souris</b> 🐭. Chacun est chat à tour de rôle.",
        "Le chat conduit une <b>Sportive</b> un peu plus puissante, avec un nitro qui dure plus longtemps. Les souris ont des <b>motos</b> qui tournent très court.",
        "Les souris partent avec <b>2 secondes d'avance</b> : le chat est bloqué au départ.",
        "Si le chat <b>touche une souris</b>, elle devient <b>chat</b> à son tour ! Elle clignote 1,5 s (elle ne peut pas attraper tout de suite), puis elle chasse avec les autres.",
        "La manche s'arrête quand <b>toutes les souris sont attrapées</b>, ou à la fin du <b>chrono</b> : les souris encore libres ont gagné.",
        "Astuce de souris : tourne serré autour des obstacles, la moto vire beaucoup mieux que la Sportive.",
      ],
      controls: DRIVE,
      points: [
        "Chat : <b>+1</b> par souris attrapée (même si tu es devenu chat en cours de route).",
        "Souris : <b>+1</b> par souris attrapée avant toi.",
        "Souris encore libre à la fin : <b>+1 par souris attrapée +2</b> de bonus.",
      ],
      example: "Tu es souris. Le chat Bob fonce sur toi : tu tournes sec derrière un bloc, il dérape tout droit. Mais Alice se fait attraper et devient chat… Maintenant ils sont deux ! Le chrono tombe à 0 et tu es encore libre : 1 souris a été attrapée, donc tu prends <b>1 + 2 = 3 points</b>.",
    },
    police: {
      goal: "Échapper à la police en F1 jusqu'à la fin du chrono, puis sortir de la ville par une des 2 sorties. Si tu te fais arrêter, deviens flic et coince les autres !",
      steps: [
        "Tout le monde démarre en <b>F1</b>, éparpillé dans une <b>ville</b> générée au hasard, au milieu de la campagne. Les rues tournent : seules une grande rue et une grande avenue traversent la ville tout droit. Les trottoirs se montent ! La <b>mini-carte</b> en haut à droite montre la ville, la police et les autres (<kbd>M</kbd> = la carte en grand).",
        "Les <b>portiques jaunes et noirs</b> sont des raccourcis (ruelles, parkings, lotissements) : ta F1 passe dessous, mais pas les <b>vans</b> ni les <b>camions</b> de police. Et la police ne les connaît pas !",
        "La <b>police</b> arrive au bout de 5 s. Presque tous les flics partent du <b>commissariat</b> 🚓 (au centre-ville), quelques-uns arrivent par les sorties : des <b>Sportives</b> et des <b>motos</b> qui te chassent, des <b>vans</b> qui essaient de te couper la route.",
        "Le <b>niveau de recherche</b> ⭐ monte pendant la manche jusqu'à ⭐⭐⭐⭐⭐ : de plus en plus de flics (jusqu'à 6 par fugitif), de plus en plus rapides. À ⭐⭐⭐ arrivent les <b>supercars</b> (presque aussi rapides que ta F1) et les <b>camions</b> qui bloquent tout.",
        "À ⭐⭐⭐⭐, l'<b>hélico</b> 🚁 arrive : il suit un fugitif avec son projecteur, et la moitié des flics fonce sur lui.",
        "<b>Arrestation</b> : si tu es presque à l'arrêt pendant <b>1 seconde</b> avec <b>au moins 2 véhicules de police</b> collés à toi — ou <b>un seul joueur-flic</b> en Lamborghini — tu es arrêté. Un cercle rouge se remplit autour de toi : <b>bouge</b> avant qu'il soit plein !",
        "Arrêté ? Tu deviens <b>flic</b> en <b>Lamborghini de police</b> : puissante, lourde (elle pousse fort) et assez fine pour passer sous les portiques des ruelles. Tu aides à coincer les autres (tu comptes comme un véhicule de police).",
        "Flic : <b>clic</b> ou <kbd>E</kbd> = <b>taser</b>, un éclair tiré droit devant (recharge <b>15 s</b>). Le <b>1er véhicule touché</b> a le <b>moteur coupé 2 s</b> : il ne peut plus accélérer. Attention : ça marche aussi sur les autres flics si tu vises mal !",
        "À la fin du chrono (2 min par défaut) : <b>FUYEZ !</b> Les barrières des <b>2 sorties</b> s'ouvrent. Tu as <b>30 s</b> (réglable) pour quitter la ville : suis la flèche verte ! Attention, des flics vont se poster devant les sorties.",
        "La manche s'arrête quand tout le monde est sorti ou arrêté, ou à la fin du temps pour sortir (ceux encore en ville sont arrêtés).",
      ],
      controls: DRIVE,
      points: [
        "<b>+1</b> par tranche de 20 s passées en liberté.",
        "Sorti de la ville à temps : <b>+3</b> de bonus (en plus des 20 s). Pas sorti à temps : seulement les points de 20 s.",
        "Flic : <b>+2</b> par arrestation à laquelle tu participes.",
      ],
      example: "Tu fonces dans une grande avenue avec le nitro, deux Sportives au cul. Tu prends une ruelle étroite à droite… un van te bloque la sortie ! Tu recules, le cercle rouge commence à se remplir, tu repars en marche avant en frottant le mur : sauvé. À ⭐⭐⭐⭐⭐ Bob se fait coincer contre une rue barrée et devient flic… et c'est lui qui t'arrête à 10 s de la fin (+2 pour lui).",
    },
    pensepareil: {
      goal: "Écrire la même réponse que les autres : ici, on ne gagne pas en étant original !",
      steps: [
        "Au début (réglage par défaut), <b>chacun écrit ses propres thèmes</b> (🎲 pour en piocher un dans la banque de 360). Ils seront joués chacun leur tour, avec le nom de l'auteur. Ou l'hôte choisit la banque de thèmes.",
        "Un <b>thème</b> s'affiche, par exemple « Un truc rouge » ou « Un animal de la ferme ».",
        "Chacun écrit <b>une seule réponse</b>, en secret (30 s par défaut). Pense à ce que les AUTRES vont écrire !",
        "<b>Révélation</b> : les réponses sont regroupées par paquets identiques, le plus gros en premier (en jaune).",
        "« Le chat », « chats » et « Chat ! » comptent pareil (majuscules, accents, le/la/un et pluriels ne comptent pas).",
        "Deux réponses veulent dire la même chose (« Chaton » et « Chat ») ? Débattez sur Discord : l'<b>hôte</b> clique sur l'une puis sur l'autre pour les <b>fusionner</b>.",
      ],
      points: [
        "<b>1 point par autre joueur</b> qui a la même réponse que toi.",
        "Seul dans ton coin = 0 point.",
      ],
      example: "Thème « <b>Un truc rouge</b> ». Toi, Alice et Bob écrivez « Tomate » : 3 dans le même paquet, vous prenez <b>2 points chacun</b>. Léo a écrit « Fraise », seul : 0. Max a écrit « Les tomates » : fusionné tout seul avec vous, ça fait 4 → <b>3 points chacun</b> !",
    },

    deuxverites: {
      goal: "Démasquer les mensonges des autres… et piéger tout le monde avec le tien.",
      steps: [
        "Un <b>thème</b> est proposé (« Mes vacances », « Ma pire honte », « Mon enfance »…). Par défaut, chacun peut le <b>garder</b>, en piocher un autre 🎲 ou <b>écrire le sien</b>. (Réglage : le même thème pour tous.)",
        "Chacun écrit <b>3 phrases sur lui</b> : 2 vraies et <b>1 fausse</b>, et coche laquelle est le mensonge (elle s'encadre en rouge).",
        "Ensuite, <b>un joueur à la fois</b> : ses 3 phrases s'affichent dans le désordre (A, B, C).",
        "Les autres cliquent sur celle qu'ils pensent être le <b>mensonge</b> (on peut changer d'avis). L'auteur peut se défendre… ou embrouiller tout le monde au micro !",
        "<b>Révélation</b> : le mensonge en rouge, les vérités en vert, et qui a voté quoi.",
      ],
      points: [
        "<b>+1</b> si tu trouves le mensonge.",
        "L'auteur gagne <b>+1 par joueur piégé</b>.",
        "Astuce : une vérité qui a l'air folle, ça piège très bien !",
      ],
      example: "Thème « <b>Ce que j'ai déjà mangé</b> ». Tu écris : A « J'ai mangé du crocodile », B « J'ai mangé 3 pizzas dans la soirée », C « Je n'ai jamais mangé d'huître ». Le mensonge, c'est B. Bob vote A (« impossible ! ») et Alice vote C : tu les as piégés tous les deux → <b>+2</b> pour toi.",
    },
    sol: {
      goal: "Rester debout sur l'arène le plus longtemps possible… et pousser les autres dans le vide.",
      steps: [
        "Tout le monde est sur une <b>arène de dalles</b> au-dessus du vide. Sa forme change à chaque manche (carré, rond, croix, anneau, îlots, gruyère).",
        "Chaque dalle où tu passes <b>se fissure</b>. Si tu repasses sur une dalle fissurée, elle <b>tremble puis tombe</b> (en mode « fragiles », elle tombe dès le 1er passage).",
        "<b>Rester planté</b> sur une dalle plus d'une seconde la fait tomber aussi : il faut toujours bouger !",
        "<b>Espace = pousser</b> : tu tends les bras, et ceux qui sont <b>juste devant toi</b> sont repoussés (toi, tu ne bouges pas). Mets-toi face à quelqu'un près d'un trou… (recharge ~1 s)",
        "Une <b>dalle dorée ★</b> apparaît de temps en temps : prends-la pour devenir <b>lourd 5 s</b> (presque impossible à pousser, et tes coups sont plus forts).",
        "Tomber dans le vide = éliminé. Le <b>dernier debout</b> gagne la manche.",
      ],
      controls: [
        "<kbd>Z</kbd> <kbd>Q</kbd> <kbd>S</kbd> <kbd>D</kbd> / flèches : courir",
        "<kbd>Espace</kbd> (ou <kbd>Shift</kbd>) : pousser ceux qui sont devant toi",
      ],
      points: ["<b>1 point par joueur tombé avant toi</b> : le dernier debout prend le plus de points."],
      example: "Tu cours en laissant une traînée de dalles fissurées. Bob est coincé au bord d'un trou : tu te mets face à lui et tu appuies sur Espace, <b>BOUM</b>, il s'envole dans le vide. Mais en revenant, tu repasses sur ta propre traînée… la dalle tremble, tu sautes juste à temps sur une dalle intacte. Ouf.",
    },
    territoire: {
      goal: "Peindre la plus grande surface de l'arène à ta couleur (ou à celle de ton équipe) avant la fin du chrono.",
      steps: [
        "Chacun a sa couleur (ou celle de son équipe : 🔴 Rouges contre 🔵 Bleus, automatique à partir de 4 joueurs).",
        "<b>En marchant</b>, tu laisses une traînée de peinture derrière toi.",
        "<b>Clic gauche</b> : tu lances un jet de peinture vers ta souris. Il vole <b>par-dessus les obstacles</b> et fait une grosse tache là où il atterrit (portée limitée, recharge 0,6 s).",
        "On peut <b>repeindre</b> par-dessus la couleur des autres autant qu'on veut : rien n'est jamais acquis !",
        "Des <b>caisses</b> apparaissent : 💣 bombe (énorme tache d'un coup), 🧹 gros rouleau (traînée très large 6 s), 👟 chaussures (plus rapide 5 s).",
        "La barre en haut montre les pourcentages en direct. À la fin du chrono (90 s par défaut), la plus grande surface gagne.",
      ],
      controls: [
        "<kbd>Z</kbd> <kbd>Q</kbd> <kbd>S</kbd> <kbd>D</kbd> / flèches : marcher (et peindre)",
        "🖱️ Souris : viser · <b>clic gauche</b> : jet de peinture",
      ],
      points: [
        "Classement à la surface peinte (en équipes : toute l'équipe gagnante prend la 1re place).",
      ],
      example: "Tu es chez les 🔴. Tu fonces vers une grosse zone bleue en tirant des jets devant toi, tu ramasses le 🧹 et tu traverses toute l'arène en laissant une bande rouge énorme. À 10 s de la fin, la barre est à 48 % contre 47 %… tu attrapes la 💣 en plein milieu des bleus : victoire !",
    },
    parkour: {
      goal: "Aller le plus loin possible sans toucher d'obstacle : sauter, s'accroupir, glisser au bon moment.",
      steps: [
        "Chaque joueur a <b>sa propre ligne</b> (empilées à l'écran, la tienne est encadrée en jaune). Tout le monde a <b>exactement le même parcours</b> : c'est le réflexe qui fait la différence.",
        "Ton coureur avance <b>tout seul</b>, de plus en plus vite.",
        "<b>Sauter</b> (<kbd>Espace</kbd>, <kbd>↑</kbd> ou <kbd>Z</kbd>) par-dessus les <b>haies</b>, les <b>caisses</b> (garde appuyé pour sauter plus haut), les <b>oiseaux bas</b> et les <b>trous</b>.",
        "<b>Glisser</b> (<kbd>↓</kbd> ou <kbd>S</kbd>) sous les <b>barres</b> et les <b>oiseaux hauts</b> (garde appuyé pour rester accroupi). En l'air, ↓ te fait retomber plus vite.",
        "Plus loin, les obstacles se rapprochent et s'enchaînent (une haie puis une barre…).",
        "Un obstacle touché ou un trou = <b>éliminé</b>. La manche finit quand tout le monde est tombé.",
      ],
      controls: [
        "<kbd>Espace</kbd> / <kbd>↑</kbd> / <kbd>Z</kbd> : sauter (maintenir = plus haut)",
        "<kbd>↓</kbd> / <kbd>S</kbd> : glisser, s'accroupir · en l'air : retomber vite",
      ],
      points: [
        "Classement à la distance : <b>10, 7, 5, 3, 2, 1</b> points selon ta place.",
      ],
      example: "Une haie : saut. Une barre juste derrière : tu retombes vite avec ↓ et tu glisses dessous. Un grand trou : tu sautes en gardant appuyé… Bob tombe à 840 m, toi tu tiens jusqu'à 1 020 m : 1re place, <b>10 points</b>.",
    },
    course: {
      goal: "Gagner la course (mode Course) ou être le dernier survivant (mode Élimination) au volant de ta supersportive.",
      steps: [
        "À chaque manche, un <b>nouveau circuit</b> est tiré au hasard. L'hôte choisit le mode : <b>Course</b>, <b>Élimination</b> ou <b>Aléatoire</b> (tiré à chaque manche).",
        "Avant le départ, <b>10 s pour choisir ta voiture</b> : <b>⚡ ÉCLAIR</b> (la plus rapide en ligne droite, mais elle glisse), <b>🐍 VIPÈRE</b> (accélère et tourne le mieux, mais légère) ou <b>🦏 TITAN</b> (lourde, pousse très fort, moins rapide).",
        "🏁 <b>Course</b> : 2, 3 ou 5 tours. Dès que le premier passe la ligne, les autres ont <b>20 s</b> pour finir.",
        "💥 <b>Élimination</b> : pas de tours. <b>Toutes les 20 s, la voiture en dernière place explose !</b> Le dernier, marqué d'une 💣, doit vite remonter.",
        "🔥 La <b>nitro</b> se recharge surtout en <b>dérapant</b> (frein à main dans les virages). Plus tu es loin derrière, plus elle remonte vite (jusqu'à ×2 pour le dernier).",
        "L'herbe ralentit. Tu peux <b>pousser</b> les autres dehors. Coincé ou perdu ? <kbd>R</kbd> te remet sur la piste (tout seul après 3 s).",
      ],
      controls: [
        "<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ou <kbd>ZQSD</kbd> : conduire",
        "<kbd>Espace</kbd> : frein à main (dérapage) · <kbd>Maj</kbd> : nitro · <kbd>R</kbd> : revenir sur la piste",
      ],
      points: [
        "Course : l'ordre d'arrivée (ceux qui n'ont pas fini sont classés selon leur avancée).",
        "Élimination : le survivant est 1er, puis dans l'ordre inverse des explosions.",
        "<b>10, 7, 5, 3, 2, 1</b> points selon ta place.",
      ],
      example: "Tu prends la VIPÈRE. Dans l'épingle, tu dérapes au frein à main : ta nitro se remplit. En ligne droite, Bob en TITAN te tasse dans l'herbe… mais tu es 4e, ta nitro remonte ×1,6 : tu la vides et tu le dépasses avant la ligne. 2e : <b>7 points</b>.",
    },
    tour: {
      goal: "Être le dernier en vie : grimpe le labyrinthe plus vite que la lave.",
      steps: [
        "Tout le monde grimpe <b>le même labyrinthe vertical</b> en même temps (on se traverse, aucun contact). Un nouveau labyrinthe à chaque manche.",
        "La <b>lave</b> monte du bas, de plus en plus vite. Si elle te touche, tu es éliminé. L'écran rougit quand elle approche.",
        "À chaque étage, choisis ta route : le <b>puits</b> (tout droit, au saut mural, avec des piques sur les murs) ou le <b>zigzag</b> (sauts muraux et couloirs à passer accroupi, plus long mais plus sûr). Les routes se rejoignent à l'étage du dessus, il n'y a pas de cul-de-sac.",
        "<b>Saut mural</b> : contre un mur, saute pour rebondir de l'autre côté (pas deux fois de suite du même côté). Les rebords <b>orange s'effritent</b> juste après ton passage.",
        "<b>Accroupis-toi</b> pour passer sous les plafonds bas (bande jaune et noire). Un <b>pique</b> rouge ne t'élimine pas, mais il te <b>sonne 2 s</b> : plus de commandes, et tu retombes si tu es en l'air.",
      ],
      controls: [
        "<kbd>←</kbd><kbd>→</kbd> / <kbd>Q</kbd><kbd>D</kbd> : courir",
        "<kbd>Espace</kbd> / <kbd>↑</kbd> / <kbd>Z</kbd> : sauter (maintenir = plus haut), aussi contre les murs",
        "<kbd>↓</kbd> / <kbd>S</kbd> : s'accroupir · en l'air : retomber plus vite",
      ],
      points: [
        "Classement à l'ordre d'élimination : <b>10, 7, 5, 3, 2, 1</b> points. Le dernier en vie prend 10 points.",
      ],
      example: "La lave est proche : tu prends le puits, tu rebondis de mur en mur en évitant les piques et tu gagnes un étage d'un coup. Bob prend le zigzag, plus sûr mais plus long, et la lave le rattrape. Tu es le dernier en vie : <b>10 points</b>.",
    },
    casse: {
      goal: "Avoir le plus gros butin à la fin de la manche : pille le manoir et ramène tout à ta camionnette.",
      steps: [
        "Tout le monde cambriole <b>le même manoir</b>, chacun pour soi. Chaque joueur a <b>sa camionnette</b> dans le jardin.",
        "Tu ramasses un objet en <b>passant dessus</b>, et tu le déposes en arrivant à ta camionnette. Un seul objet à la fois : <b>plus il vaut cher, plus tu es lent</b>.",
        "🥄 Argenterie 100 $ · 🏺 Vase 300 $ · 🖼️ Tableau 600 $ · 💎 Coffre-fort 1 500 $.",
        "<kbd>Espace</kbd> : <b>pousser</b>. Celui que tu touches <b>lâche son objet</b>, et n'importe qui peut le ramasser.",
        "👮 Les <b>gardiens</b> patrouillent : s'ils t'attrapent, tu lâches ton objet et tu es sonné 2 s. Ils courent moins vite que toi les mains vides, mais plus vite qu'avec un tableau.",
        "💎 Un <b>coffre-fort</b> apparaît régulièrement, annoncé à tout le monde. 🚨 Les <b>30 dernières secondes</b>, l'alarme sonne et tout ce que tu déposes vaut <b>double</b>.",
      ],
      controls: [
        "<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ou <kbd>ZQSD</kbd> : marcher",
        "<kbd>Espace</kbd> : pousser · Pour les escaliers et passages secrets : marcher dans le mur",
      ],
      points: [
        "Classement à l'argent de la manche : <b>10, 7, 5, 3, 2, 1</b> points.",
      ],
      example: "Le coffre apparaît dans la bibliothèque : tout le monde y fonce. Bob l'attrape et se traîne vers sa camionnette. Tu le rattrapes, tu le pousses, il lâche le coffre, tu le prends… et l'alarme sonne : <b>3 000 $</b> d'un coup !",
    },
    colline: {
      goal: "Rester dans la zone dorée le plus longtemps possible, seul (ou seule ton équipe), en virant les autres à coups de batte.",
      steps: [
        "Tout le monde apparaît <b>en cercle autour de la zone dorée</b>, dans une arène fermée avec des piliers et des caisses. Chacun a une <b>batte</b>.",
        "Chaque seconde passée dans la zone rapporte <b>1 point</b>… seulement si personne d'autre (ou aucune autre équipe) n'y est. Sinon la zone est <b>contestée</b> : elle clignote en rouge et personne ne marque.",
        "<b>Clic</b> : un coup de batte dans la direction du viseur (il te suit quand tu marches ; clique une fois sur l'arène pour capturer la souris). Le coup <b>propulse fort</b> ceux qui sont juste devant toi.",
        "Toutes les <b>20 s</b>, la zone saute ailleurs : on voit 3 s avant où elle va (cercle en pointillé, compte à rebours, flèche). Tout le monde court !",
        "Modes : <b>aléatoire</b> (par défaut : chaque manche est tirée au sort), <b>équipes</b> 🔴 contre 🔵 (pas de coup ami) ou <b>chacun pour soi</b>.",
      ],
      controls: [
        "<kbd>Z</kbd> <kbd>Q</kbd> <kbd>S</kbd> <kbd>D</kbd> / flèches : bouger",
        "🖱️ Souris : viser · <b>clic</b> : coup de batte",
      ],
      points: [
        "On compte tes <b>secondes</b> passées dans la zone pendant que ton camp la tient seul.",
        "À la fin de la manche, elles sont ramenées sur <b>10 points</b> : le meilleur prend 10, les autres en proportion (une manche en équipes vaut autant qu'une manche en chacun pour soi).",
      ],
      example: "La zone va sauter près du pilier : tu cours avant les autres, tu es seul dedans, 1, 2, 3 s… Bob arrive, contesté ! Tu vises et PAF, coup de batte : il glisse hors de la zone. Tu reprends le compte jusqu'au prochain saut.",
    },
    neige: {
      goal: "Toucher les autres avec tes boules de neige sans te faire toucher. Dernier debout (ou dernière équipe) gagne la manche.",
      steps: [
        "Chacun a <b>3 cœurs ❤️</b> et commence avec <b>3 boules</b>. En équipes (automatique à partir de 4 joueurs) : 🔴 Rouges contre 🔵 Bleus, pas de tir ami.",
        "<b>Vise à la souris</b> : le viseur te suit quand tu marches (clique une fois sur l'arène pour capturer la souris, Échap pour la libérer).",
        "<b>Maintiens le clic gauche</b> pour charger (un cercle se remplit autour de toi), <b>lâche</b> pour lancer. Plus c'est chargé, plus la boule va <b>loin et vite</b>. La ligne pointillée montre la portée.",
        "Plus de boules ? <b>Clic droit</b> (ou <kbd>R</kbd>) maintenu : tu te baisses et fabriques une boule en 1 s… mais tu ne peux pas bouger pendant ce temps !",
        "Les <b>murets de neige</b> arrêtent les boules, mais chaque boule les fait <b>fondre</b> un peu : ils rétrécissent puis disparaissent.",
        "Touché = un cœur de moins (tu clignotes, invincible un court instant). 0 cœur = éliminé. Après 75 s : <b>mort subite</b>, tout le monde à 1 cœur.",
      ],
      controls: [
        "<kbd>Z</kbd> <kbd>Q</kbd> <kbd>S</kbd> <kbd>D</kbd> / flèches : bouger",
        "🖱️ Souris : viser · <b>clic gauche maintenu</b> : charger · <b>relâché</b> : lancer",
        "<b>Clic droit</b> ou <kbd>R</kbd> : fabriquer une boule (3 max)",
      ],
      points: [
        "Chacun pour soi : <b>1 point par joueur éliminé avant toi</b>.",
        "Équipes : <b>3 points</b> pour chaque membre de l'équipe gagnante.",
        "Dans les deux cas : <b>+1 par élimination</b> que tu fais (la dernière boule).",
      ],
      example: "Tu es caché derrière un muret, à court de boules : clic droit, tu en fabriques une… le muret fond sous les tirs de Bob ! Tu sors, tu charges à fond et tu vises un peu devant lui pendant qu'il court : PAF, dernier cœur, il est éliminé (+1 pour toi).",
    },
  };
})();
