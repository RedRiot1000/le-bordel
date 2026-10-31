// ===================================================================
//  IMPOSTER — Banque de mots
//  Des PAIRES DE CONTRAIRES : [mot A, mot B].
//  À chaque manche, le jeu tire au hasard qui reçoit quoi :
//  A pour les civils et B pour l'Undercover, ou l'inverse.
//  Classées par catégories (l'hôte peut en activer/désactiver).
//
//  👉 Pour agrandir la banque : ajoute simplement des lignes ici.
// ===================================================================

export const WORD_BANK = {
  "Vie quotidienne": [
    ["Jour", "Nuit"], ["Matin", "Soir"], ["Lundi", "Vendredi"], ["Réveil", "Dodo"],
    ["Travail", "Vacances"], ["Entrée", "Sortie"], ["Ouvert", "Fermé"], ["Allumé", "Éteint"],
    ["Propre", "Sale"], ["Rangé", "Bordel"], ["Debout", "Couché"], ["Silence", "Bruit"],
    ["Rire", "Pleurer"], ["Gagner", "Perdre"], ["Acheter", "Vendre"], ["Donner", "Prendre"],
    ["Arriver", "Partir"], ["Bonjour", "Au revoir"], ["Oui", "Non"], ["Toujours", "Jamais"],
    ["Tôt", "Tard"], ["Plein", "Vide"], ["Neuf", "Cassé"], ["Avant", "Après"],
    ["Pile", "Face"], ["Pair", "Impair"], ["Cadeau", "Facture"], ["Anniversaire", "Enterrement"],
  ],

  "Sentiments & Caractère": [
    ["Amour", "Haine"], ["Joie", "Tristesse"], ["Courage", "Peur"], ["Calme", "Colère"],
    ["Gentil", "Méchant"], ["Timide", "Frimeur"], ["Patient", "Pressé"], ["Généreux", "Radin"],
    ["Honnête", "Menteur"], ["Positif", "Négatif"], ["Feignant", "Bosseur"], ["Sage", "Turbulent"],
    ["Sportif", "Flemmard"], ["Câlin", "Bagarre"], ["Poli", "Grossier"], ["Ami", "Ennemi"],
    ["Confiance", "Méfiance"], ["Heureux", "Malheureux"], ["Fierté", "Honte"], ["Ennui", "Passion"],
    ["Stress", "Détente"], ["Sérieux", "Rigolo"], ["Content", "Fâché"], ["Bavard", "Muet"],
    ["Prudent", "Casse-cou"], ["Réveillé", "Fatigué"],
  ],

  "Nourriture": [
    ["Sucré", "Salé"], ["Chaud", "Froid"], ["Cru", "Cuit"], ["Entrée", "Dessert"],
    ["Petit-déjeuner", "Dîner"], ["Pizza", "Salade"], ["Glace", "Fondue"], ["Chocolat noir", "Chocolat blanc"],
    ["Fast-food", "Restaurant étoilé"], ["Légume", "Bonbon"], ["Régime", "Buffet à volonté"], ["Frais", "Périmé"],
    ["Croustillant", "Mou"], ["Piquant", "Doux"], ["Amer", "Sucré"], ["Pain frais", "Pain rassis"],
    ["Viande", "Légumes verts"], ["Eau plate", "Eau gazeuse"], ["Café", "Tisane"], ["Soupe", "Sorbet"],
    ["Citron", "Miel"], ["Faim", "Soif"], ["Gâteau raté", "Gâteau réussi"], ["Cantine", "Restaurant"],
    ["Surgelé", "Fait maison"], ["Vin rouge", "Vin blanc"], ["Steak saignant", "Steak bien cuit"],
  ],

  "Animaux": [
    ["Chat", "Chien"], ["Souris", "Éléphant"], ["Tortue", "Lièvre"], ["Loup", "Mouton"],
    ["Lion", "Gazelle"], ["Chouette", "Coq"], ["Pingouin", "Chameau"], ["Requin", "Dauphin"],
    ["Fourmi", "Baleine"], ["Escargot", "Guépard"], ["Aigle", "Taupe"], ["Poisson", "Oiseau"],
    ["Chat", "Souris"], ["Renard", "Poule"], ["Ours polaire", "Ours brun"], ["Moustique", "Coccinelle"],
    ["Hamster", "Tigre"], ["Girafe", "Teckel"], ["Serpent", "Ver de terre"], ["Vache", "Cheval de course"],
    ["Chauve-souris", "Pigeon"], ["Araignée", "Papillon"], ["Crocodile", "Zèbre"], ["Licorne", "Dragon"],
    ["Chiot", "Vieux chien"], ["Abeille", "Frelon"],
  ],

  "Lieux": [
    ["Plage", "Montagne"], ["Ville", "Campagne"], ["Paradis", "Enfer"], ["Désert", "Banquise"],
    ["Cave", "Grenier"], ["Prison", "Palace"], ["École", "Vacances"], ["Hôpital", "Parc d'attractions"],
    ["Bibliothèque", "Boîte de nuit"], ["Pôle Nord", "Pôle Sud"], ["Océan", "Désert"], ["Forêt", "Parking"],
    ["Château", "Cabane"], ["Rez-de-chaussée", "Dernier étage"], ["Intérieur", "Extérieur"], ["Est", "Ouest"],
    ["Nord", "Sud"], ["Gauche", "Droite"], ["Cuisine", "Salle de bain"], ["Cimetière", "Maternité"],
    ["Église", "Casino"], ["Aéroport", "Port"], ["Métro", "Téléphérique"], ["Maison", "Immeuble"],
    ["Île déserte", "Centre commercial"], ["Piscine", "Sauna"],
  ],

  "Métiers": [
    ["Policier", "Voleur"], ["Professeur", "Élève"], ["Juge", "Accusé"], ["Patron", "Stagiaire"],
    ["Pompier", "Pyromane"], ["Coiffeur", "Chauve"], ["Pilote", "Passager"], ["Serveur", "Client"],
    ["Acteur", "Spectateur"], ["Arbitre", "Supporter"], ["Médecin", "Malade"], ["Dentiste", "Gourmand"],
    ["Chanteur", "Sourd"], ["Gardien de prison", "Prisonnier"], ["Guide", "Touriste"], ["Prof de sport", "Glandeur"],
    ["Cuisinier", "Livreur de pizza"], ["Millionnaire", "Mendiant"], ["Agent secret", "Star de la télé"], ["Clown", "Croque-mort"],
    ["Astronaute", "Plongeur"], ["Maçon", "Casseur"], ["Vendeur", "Acheteur"], ["Coach", "Joueur"],
    ["Jardinier", "Bûcheron"], ["Infirmier", "Patient"],
  ],

  "Sport & Loisirs": [
    ["Attaque", "Défense"], ["Victoire", "Défaite"], ["Gardien", "Attaquant"], ["Sprint", "Marathon"],
    ["Ski", "Surf"], ["Échecs", "Rugby"], ["Yoga", "Boxe"], ["Champion", "Débutant"],
    ["Équipe", "Adversaire"], ["Plongeon", "Saut en hauteur"], ["Coup franc", "Penalty"], ["Carton jaune", "Carton rouge"],
    ["Mi-temps", "Prolongations"], ["Tricheur", "Fair-play"], ["Jeux d'été", "Jeux d'hiver"], ["Lecture", "Jeux vidéo"],
    ["Solo", "Multijoueur"], ["Tennis", "Golf"], ["Pétanque", "Parachute"], ["Spectateur", "Joueur"],
    ["Pêche", "Course de voitures"], ["Bowling", "Billard"], ["Sieste", "Footing"], ["Karaoké", "Concert"],
    ["Premier", "Dernier"],
  ],

  "Objets": [
    ["Clé", "Serrure"], ["Marteau", "Clou"], ["Stylo", "Gomme"], ["Allumette", "Extincteur"],
    ["Parapluie", "Lunettes de soleil"], ["Réveil", "Oreiller"], ["Fourchette", "Cuillère"], ["Échelle", "Toboggan"],
    ["Ventilateur", "Radiateur"], ["Lampe", "Rideau"], ["Ciseaux", "Colle"], ["Frigo", "Four"],
    ["Bonnet", "Casquette"], ["Moufles", "Tongs"], ["Aspirateur", "Poubelle"], ["Savon", "Boue"],
    ["Téléphone", "Lettre"], ["Ordinateur", "Cahier"], ["Télécommande", "Bouton"], ["Livre", "Écran"],
    ["Crayon", "Taille-crayon"], ["Bouchon", "Tire-bouchon"], ["Brosse à dents", "Bonbon"], ["Miroir", "Fenêtre"],
    ["Valise", "Placard"], ["Bougie", "Ampoule"],
  ],

  "Transports": [
    ["Avion", "Sous-marin"], ["Fusée", "Escargot"], ["Voiture", "Piéton"], ["Décollage", "Atterrissage"],
    ["Accélérateur", "Frein"], ["Autoroute", "Chemin de terre"], ["Taxi", "Auto-stop"], ["Limousine", "Trottinette"],
    ["Hélicoptère", "Métro"], ["TGV", "Tracteur"], ["Montée", "Descente"], ["Marche avant", "Marche arrière"],
    ["Feu vert", "Feu rouge"], ["Départ", "Arrivée"], ["Aller", "Retour"], ["Bateau", "Train"],
    ["Vélo", "Moto"], ["Embouteillage", "Route déserte"], ["Ascenseur", "Escalier"], ["Parachute", "Montgolfière"],
    ["Première classe", "Classe éco"], ["Camping-car", "Hôtel"], ["Skateboard", "Roller"], ["Pneu crevé", "Plein d'essence"],
  ],

  "Nature & Météo": [
    ["Soleil", "Lune"], ["Été", "Hiver"], ["Printemps", "Automne"], ["Feu", "Eau"],
    ["Pluie", "Sécheresse"], ["Chaleur", "Gel"], ["Ciel", "Terre"], ["Volcan", "Glacier"],
    ["Marée haute", "Marée basse"], ["Lever du soleil", "Coucher du soleil"], ["Tempête", "Calme plat"], ["Arc-en-ciel", "Orage"],
    ["Sommet", "Vallée"], ["Rivière", "Lac"], ["Fleur", "Épine"], ["Graine", "Arbre"],
    ["Neige", "Sable"], ["Brouillard", "Grand soleil"], ["Étoile", "Trou noir"], ["Racine", "Feuille"],
    ["Montagne", "Plaine"], ["Jungle", "Banquise"], ["Tonnerre", "Éclair"], ["Ombre", "Lumière"],
  ],

  "Personnages": [
    ["Héros", "Méchant"], ["Ange", "Démon"], ["Batman", "Joker"], ["Harry Potter", "Voldemort"],
    ["Mario", "Bowser"], ["Luke Skywalker", "Dark Vador"], ["Policier", "Arsène Lupin"], ["Blanche-Neige", "La sorcière"],
    ["Tom", "Jerry"], ["Bip Bip", "Vil Coyote"], ["Astérix", "Jules César"], ["Zeus", "Hadès"],
    ["Père Noël", "Grinch"], ["Simba", "Scar"], ["Peter Pan", "Capitaine Crochet"], ["Thor", "Loki"],
    ["Spider-Man", "Venom"], ["Shrek", "Lord Farquaad"], ["Sonic", "Docteur Eggman"], ["Aladdin", "Jafar"],
    ["Cendrillon", "La belle-mère"], ["Le Petit Chaperon rouge", "Le Grand Méchant Loup"], ["Titi", "Grosminet"], ["Bob l'éponge", "Plankton"],
    ["Les Schtroumpfs", "Gargamel"], ["Pikachu", "Team Rocket"],
  ],

  "Choses opposées": [
    ["Grand", "Petit"], ["Gros", "Maigre"], ["Rapide", "Lent"], ["Fort", "Faible"],
    ["Lourd", "Léger"], ["Dur", "Mou"], ["Rond", "Carré"], ["Noir", "Blanc"],
    ["Clair", "Foncé"], ["Haut", "Bas"], ["Large", "Étroit"], ["Long", "Court"],
    ["Jeune", "Vieux"], ["Riche", "Pauvre"], ["Beau", "Moche"], ["Intelligent", "Bête"],
    ["Facile", "Difficile"], ["Vrai", "Faux"], ["Début", "Fin"], ["Guerre", "Paix"],
    ["Vivant", "Mort"], ["Mariage", "Divorce"], ["Bébé", "Papi"], ["Mouillé", "Sec"],
    ["Bruyant", "Silencieux"], ["Dedans", "Dehors"], ["Ancien", "Moderne"], ["Rêve", "Cauchemar"],
  ],
};

// Aplatit la banque selon les catégories actives -> liste de paires.
// Chaque paire : { a, b } (le jeu décide au hasard qui reçoit quoi).
export function getPairs(activeCategories) {
  const cats = activeCategories && activeCategories.length
    ? activeCategories
    : Object.keys(WORD_BANK);
  const pairs = [];
  for (const cat of cats) {
    for (const [a, b] of WORD_BANK[cat] || []) pairs.push({ a, b });
  }
  return pairs;
}

// La liste des noms de catégories (pour les réglages de l'hôte).
export const CATEGORIES = Object.keys(WORD_BANK);
