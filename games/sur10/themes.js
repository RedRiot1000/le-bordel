// ===================================================================
//  SUR 10 — Banque de thèmes
//  Chaque ligne : [ "le thème", "l'échelle" (ou null = 0 nul · 10 génial),
//                   "exemples:note|exemples:note|..." ]
//  Les exemples servent aux bots (ils piochent un indice et la note qui va avec).
//  👉 Pour ajouter un thème : copie une ligne, change le texte. C'est tout.
// ===================================================================

const RAW = [
  // Jeux vidéo & écrans
  ["Un jeu vidéo", null, "Rust:10|Minecraft:8|FIFA:5|Candy Crush:2|E.T. sur Atari:0"],
  ["Un jeu de société", null, "Loup-garou:9|Uno:7|Monopoly:4|Les petits chevaux:2|Le jeu de l'oie:1"],
  ["Une série", null, "Breaking Bad:10|Game of Thrones:8|Plus belle la vie:3|Friends:7|Les Feux de l'amour:1"],
  ["Un film", null, "Le Seigneur des anneaux:10|Titanic:7|Taxi 4:4|Fast & Furious 9:3|Catwoman:1"],
  ["Un dessin animé de ton enfance", null, "Dragon Ball Z:10|Pokémon:9|Les Razmoket:6|Caillou:1|Oui-Oui:2"],
  ["Une appli sur ton téléphone", null, "Discord:9|YouTube:8|Waze:6|Facebook:3|L'appli de ta banque:1"],
  ["Un youtuber ou streamer", null, "Squeezie:8|Mister V:6|Un streamer à 3 viewers:2|Cyprien:5|Le mec qui unboxe des chaussures:1"],
  ["Un personnage de jeu vidéo", null, "Kratos:9|Mario:8|Link:8|Navi de Zelda:2|Le chien de Duck Hunt:0"],
  ["Une console", null, "PS2:10|Switch:8|Wii U:3|Xbox One:5|Virtual Boy:0"],
  ["Une émission de télé", null, "Koh-Lanta:8|Qui veut gagner des millions:6|Les Marseillais:2|Le JT de 13h:4|La Ferme Célébrités:1"],
  // Bouffe
  ["Un plat", null, "Raclette:10|Pizza:9|Couscous:8|Endives au jambon:2|Foie de veau:0"],
  ["Un fast-food", null, "Five Guys:9|McDo:7|KFC:6|Quick:4|La sandwicherie de la gare:1"],
  ["Une boisson", null, "Coca:8|Bière fraîche:9|Thé:5|Eau tiède:1|Jus de tomate:0"],
  ["Un dessert", null, "Tiramisu:10|Crêpes:8|Île flottante:4|Compote:3|Fruit au sirop:1"],
  ["Un goût de chips", null, "Barbecue:9|Paprika:7|Nature:6|Vinaigre:3|Poulet rôti:5"],
  ["Un légume", null, "Pomme de terre:10|Carotte:7|Courgette:5|Brocoli:3|Navet:0"],
  ["Un truc qu'on mange au petit-déj", null, "Pain au chocolat:10|Céréales:8|Tartine beurre:6|Yaourt nature:3|Rien, juste un café:2"],
  ["Une sauce", null, "Samouraï:9|Mayo:8|Ketchup:7|Moutarde:5|Sauce menthe:1"],
  ["Une glace", null, "Cookie dough:10|Chocolat:8|Vanille:6|Pistache:5|Réglisse:1"],
  ["Un fromage", null, "Comté:10|Camembert:8|Raclette:9|Roquefort:4|Fromage en tranche industriel:2"],
  // Vie quotidienne
  ["Une corvée", "0 = l'enfer · 10 = j'adore", "Passer l'aspirateur:4|Faire les courses:6|Le repassage:1|La vaisselle:3|Sortir les poubelles:5"],
  ["Un jour de la semaine", null, "Vendredi:10|Samedi:9|Dimanche:6|Mercredi:5|Lundi:0"],
  ["Une saison ou une météo", null, "L'été en terrasse:10|Une nuit d'orage:7|La neige:6|Le crachin:1|La canicule à 40°:2"],
  ["Une excuse pour être en retard", "0 = personne n'y croit · 10 = imparable", "Il y avait des bouchons:7|Mon réveil n'a pas sonné:4|J'ai été enlevé par des aliens:0|Accident sur la ligne:8|Mon chat a mangé mes clés:1"],
  ["Un moyen de transport", null, "Voiture:8|TGV:7|Avion:6|Bus de nuit:2|Trottinette électrique:4"],
  ["Un métier", null, "Testeur de jeux vidéo:10|Pompier:8|Prof:5|Comptable:3|Égoutier:1"],
  ["Une matière à l'école", null, "Sport:9|Histoire:7|Maths:4|Philo:5|Allemand:1"],
  ["Un endroit où partir en vacances", null, "Japon:10|Espagne:8|La Bretagne:6|Chez la belle-famille:2|Un camping sous la pluie:1"],
  ["Une ville", null, "New York:9|Paris:6|Barcelone:8|Las Vegas:7|Une ZAC à 3 h du matin:0"],
  ["Une musique ou un artiste", null, "Daft Punk:10|Queen:9|Jul:5|La chenille qui redémarre:2|Crazy Frog:1"],
  ["Une fête", null, "Noël:9|Le Nouvel An:8|Halloween:7|La Saint-Valentin:3|La fête des voisins:4"],
  ["Un sport", null, "Foot:8|Basket:7|Tennis:5|Curling:3|Marathon:2"],
  ["Une marque", null, "Nintendo:9|Apple:6|Ikea:7|Lidl:5|Comcast:0"],
  ["Une odeur", null, "Le pain chaud:10|L'herbe coupée:8|L'essence:5|Le chou:2|Les chaussettes après le sport:0"],
  ["Un bruit", "0 = insupportable · 10 = un régal", "La pluie sur le toit:10|Le chat qui ronronne:9|Une craie sur un tableau:0|Un moustique la nuit:1|Le micro-ondes qui bipe:3"],
  // Animaux & trucs bizarres
  ["Un animal", "0 = inoffensif · 10 = mortel", "Requin blanc:9|Grizzli:10|Oie:4|Chihuahua:2|Hamster:0"],
  ["Un animal de compagnie", null, "Chien:10|Chat:9|Lapin:6|Poisson rouge:3|Mygale:1"],
  ["Un super-pouvoir", null, "Téléportation:10|Voler:9|Lire dans les pensées:7|Parler aux poissons:2|Faire pousser ses ongles:0"],
  ["Une arme pour survivre à une invasion zombie", "0 = tu meurs · 10 = tu survis", "Fusil à pompe:10|Katana:8|Batte de baseball:6|Poêle à frire:3|Une baguette de pain:0"],
  ["Un objet à emmener sur une île déserte", "0 = inutile · 10 = vital", "Couteau suisse:10|Briquet:9|Une corde:7|Un smartphone sans réseau:2|Un fer à repasser:0"],
  ["Une phobie", "0 = rien à faire · 10 = terrifiant", "Les araignées:8|Le vide:7|Les clowns:6|Les papillons:1|Les ballons de baudruche:2"],
  ["Un super-héros ou méchant", null, "Batman:10|Spider-Man:9|Iron Man:8|Aquaman:4|Hawkeye:3"],
  ["Une invention", "0 = inutile · 10 = révolutionnaire", "Internet:10|Le frigo:9|La roue:10|Le fidget spinner:1|Le Segway:3"],
  ["Une mort dans un film d'horreur", "0 = ridicule · 10 = traumatisant", "Se cacher dans le placard:4|Aller voir à la cave:2|Se séparer du groupe:1|Le tueur dans la banquette arrière:9|Le clown dans l'égout:10"],
  ["Une technique de drague", "0 = la honte · 10 = efficace", "Faire rire:10|Inviter au resto:7|Un compliment sincère:8|Une blague sur sa mère:0|Liker toutes ses photos de 2014:1"],
  ["Une insulte (gentille)", "0 = ça passe · 10 = ça pique", "Patate:2|Andouille:3|Boloss:6|Tête de gland:5|Moule à gaufres:4"],
  ["Une situation gênante", "0 = tranquille · 10 = je veux disparaître", "Appeler la prof « maman »:9|Saluer quelqu'un qui saluait la personne derrière:7|Tomber dans la rue:6|Rire seul devant son téléphone:2|Pousser une porte marquée tirer:3"],
  ["Un bonbon", null, "Dragibus:9|Fraise Tagada:9|Carambar:6|Bonbon à la réglisse:2|Bonbon à la violette:1"],
  ["Une façon de dormir", null, "Grasse mat' du dimanche:10|Sieste après le repas:9|Dans le train:4|Sur un clic-clac:2|Dans une tente sur un caillou:0"],
  ["Un cadeau de Noël", null, "Une console:10|Des places de concert:9|Un livre:5|Des chaussettes:2|Un pull moche:3"],
  ["Une boisson pour une soirée", null, "Bière:8|Mojito:9|Vin rouge:6|Pastis:4|Champomy:2"],
  ["Une star", null, "Keanu Reeves:10|Omar Sy:8|Jean Dujardin:7|Kim Kardashian:2|Un influenceur crypto:0"],
  ["Une destination dans l'espace", null, "La Lune:9|Mars:8|Un trou noir:3|La Station spatiale:7|Pluton:4"],
  ["Une période de l'histoire", "0 = horrible pour y vivre · 10 = le rêve", "Les années 80:9|La Préhistoire:2|Le Moyen Âge:1|La Belle Époque:7|L'Empire romain:5"],
  ["Une voiture", null, "Lamborghini:10|Tesla:7|Twingo:5|Fiat Multipla:1|Voiture sans permis:2"],
  ["Une coupe de cheveux", null, "Dégradé propre:9|Cheveux longs:7|Crâne rasé:6|Coupe au bol:1|La mulet:3"],
  ["Une tâche de bureau", "0 = l'enfer · 10 = le pied", "La pause café:10|Le pot de départ:9|Une réunion qui aurait pu être un mail:0|Remplir un tableau Excel:3|Ranger ses mails:4"],
  ["Une façon de se réveiller", null, "Tout seul, reposé:10|Odeur de café:9|Le réveil:3|Le chat sur la tête:5|Les travaux du voisin à 7 h:0"],
  ["Un sport extrême", "0 = tranquille · 10 = complètement fou", "Saut en parachute:8|Base jump:10|Accrobranche:3|Saut à l'élastique:7|Mini-golf:0"],
  ["Une soirée", null, "Soirée jeux entre potes:10|Un concert:9|Un resto:7|Un anniversaire d'enfant:3|Un repas de famille qui dure 6 h:1"],
];

export const THEMES = RAW.map(([title, scale, ex]) => ({
  title,
  scale: scale || "0 = nul · 10 = génial",
  examples: ex.split("|").map((s) => {
    const i = s.lastIndexOf(":");
    return { text: s.slice(0, i), note: Number(s.slice(i + 1)) };
  }),
}));
