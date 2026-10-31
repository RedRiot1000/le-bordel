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
    ["Tôt", "Tard"], ["Plein", "Vide"], ["Neuf", "Usé"], ["Avant", "Après"],
    ["Pile", "Face"], ["Pair", "Impair"], ["Cadeau", "Facture"], ["Anniversaire", "Enterrement"],
  ],

  "Sentiments & Caractère": [
    ["Amour", "Haine"], ["Joie", "Tristesse"], ["Courage", "Peur"], ["Calme", "Colère"],
    ["Gentil", "Méchant"], ["Timide", "Frimeur"], ["Patient", "Pressé"], ["Généreux", "Radin"],
    ["Honnête", "Menteur"], ["Optimiste", "Pessimiste"], ["Paresseux", "Bosseur"], ["Sage", "Turbulent"],
    ["Modeste", "Vantard"], ["Fidèle", "Infidèle"], ["Poli", "Grossier"], ["Ami", "Ennemi"],
    ["Confiance", "Méfiance"], ["Espoir", "Désespoir"], ["Fierté", "Honte"], ["Ennui", "Passion"],
    ["Stress", "Détente"], ["Sérieux", "Rigolo"], ["Curieux", "Indifférent"], ["Bavard", "Muet"],
    ["Prudent", "Casse-cou"], ["Jaloux", "Confiant"],
  ],

  "Nourriture": [
    ["Sucré", "Salé"], ["Chaud", "Froid"], ["Cru", "Cuit"], ["Entrée", "Dessert"],
    ["Petit-déjeuner", "Dîner"], ["Apéro", "Digestif"], ["Glace", "Fondue"], ["Chocolat noir", "Chocolat blanc"],
    ["Fast-food", "Restaurant étoilé"], ["Légume", "Bonbon"], ["Régime", "Buffet à volonté"], ["Frais", "Périmé"],
    ["Croustillant", "Mou"], ["Piquant", "Doux"], ["Amer", "Sucré"], ["Pain frais", "Pain rassis"],
    ["Végétarien", "Boucher"], ["Eau plate", "Eau gazeuse"], ["Café", "Tisane"], ["Soupe", "Sorbet"],
    ["Citron", "Miel"], ["Faim", "Satiété"], ["Gâteau raté", "Gâteau réussi"], ["Cantine", "Gastronomie"],
    ["Surgelé", "Fait maison"], ["Vin rouge", "Vin blanc"], ["Steak saignant", "Steak bien cuit"],
  ],

  "Animaux": [
    ["Chat", "Chien"], ["Souris", "Éléphant"], ["Tortue", "Lièvre"], ["Loup", "Mouton"],
    ["Lion", "Gazelle"], ["Chouette", "Coq"], ["Pingouin", "Chameau"], ["Requin", "Dauphin"],
    ["Fourmi", "Baleine"], ["Escargot", "Guépard"], ["Aigle", "Taupe"], ["Poisson", "Oiseau"],
    ["Chat", "Souris"], ["Renard", "Poule"], ["Ours polaire", "Ours brun"], ["Moustique", "Hirondelle"],
    ["Paresseux", "Colibri"], ["Girafe", "Teckel"], ["Serpent", "Mangouste"], ["Vache", "Cheval de course"],
    ["Hibou", "Alouette"], ["Araignée", "Papillon"], ["Crocodile", "Zèbre"], ["Licorne", "Dragon"],
    ["Chiot", "Vieux chien"], ["Abeille", "Frelon"],
  ],

  "Lieux": [
    ["Plage", "Montagne"], ["Ville", "Campagne"], ["Paradis", "Enfer"], ["Désert", "Banquise"],
    ["Cave", "Grenier"], ["Prison", "Palace"], ["École", "Vacances"], ["Hôpital", "Salle de sport"],
    ["Bibliothèque", "Boîte de nuit"], ["Pôle Nord", "Pôle Sud"], ["Océan", "Désert"], ["Forêt", "Parking"],
    ["Château", "Cabane"], ["Rez-de-chaussée", "Dernier étage"], ["Intérieur", "Extérieur"], ["Est", "Ouest"],
    ["Nord", "Sud"], ["Gauche", "Droite"], ["Cuisine", "Salle de bain"], ["Cimetière", "Maternité"],
    ["Église", "Casino"], ["Aéroport", "Port"], ["Métro", "Téléphérique"], ["Village", "Mégalopole"],
    ["Île déserte", "Centre commercial"], ["Tribunal", "Fête foraine"],
  ],

  "Métiers": [
    ["Policier", "Voleur"], ["Professeur", "Élève"], ["Juge", "Accusé"], ["Patron", "Stagiaire"],
    ["Pompier", "Pyromane"], ["Avocat", "Procureur"], ["Pilote", "Passager"], ["Serveur", "Client"],
    ["Acteur", "Spectateur"], ["Arbitre", "Supporter"], ["Médecin", "Malade"], ["Dentiste", "Gourmand"],
    ["Chanteur", "Sourd"], ["Gardien de prison", "Évadé"], ["Douanier", "Contrebandier"], ["Prof de sport", "Glandeur"],
    ["Chef cuisinier", "Critique gastronomique"], ["Banquier", "Endetté"], ["Agent secret", "Espion ennemi"], ["Clown", "Croque-mort"],
    ["Astronaute", "Plongeur"], ["Maçon", "Démolisseur"], ["Vendeur", "Acheteur"], ["Coach", "Joueur"],
    ["Jardinier", "Bûcheron"], ["Infirmier", "Patient"],
  ],

  "Sport & Loisirs": [
    ["Attaque", "Défense"], ["Victoire", "Défaite"], ["Gardien", "Attaquant"], ["Sprint", "Marathon"],
    ["Ski", "Surf"], ["Échecs", "Rugby"], ["Yoga", "Boxe"], ["Champion", "Débutant"],
    ["Domicile", "Extérieur"], ["Plongeon", "Escalade"], ["Coup franc", "Penalty"], ["Carton jaune", "Carton rouge"],
    ["Mi-temps", "Prolongations"], ["Tricheur", "Fair-play"], ["Jeux d'été", "Jeux d'hiver"], ["Lecture", "Jeux vidéo"],
    ["Solo", "Multijoueur"], ["Tennis", "Golf"], ["Pétanque", "Parachute"], ["Supporter", "Hooligan"],
    ["Pêche", "Course de voitures"], ["Bowling", "Billard"], ["Sieste", "Footing"], ["Karaoké", "Concert"],
    ["Premier", "Dernier"],
  ],

  "Objets": [
    ["Clé", "Serrure"], ["Marteau", "Clou"], ["Stylo", "Gomme"], ["Allumette", "Extincteur"],
    ["Parapluie", "Lunettes de soleil"], ["Réveil", "Oreiller"], ["Fourchette", "Cuillère"], ["Échelle", "Toboggan"],
    ["Ventilateur", "Radiateur"], ["Lampe", "Rideau"], ["Aimant", "Ciseaux"], ["Frigo", "Four"],
    ["Bonnet", "Casquette"], ["Moufles", "Tongs"], ["Aspirateur", "Poubelle"], ["Savon", "Boue"],
    ["Téléphone", "Lettre"], ["Calculatrice", "Boulier"], ["Télécommande", "Bouton"], ["Livre", "Écran"],
    ["Crayon", "Taille-crayon"], ["Bouchon", "Tire-bouchon"], ["Colle", "Scotch"], ["Miroir", "Fenêtre"],
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
    ["Source", "Embouchure"], ["Jungle", "Toundra"], ["Tonnerre", "Éclair"], ["Ombre", "Lumière"],
  ],

  "Personnages": [
    ["Héros", "Méchant"], ["Ange", "Démon"], ["Batman", "Joker"], ["Harry Potter", "Voldemort"],
    ["Mario", "Bowser"], ["Luke Skywalker", "Dark Vador"], ["Sherlock Holmes", "Moriarty"], ["Blanche-Neige", "La sorcière"],
    ["Tom", "Jerry"], ["Bip Bip", "Vil Coyote"], ["Astérix", "Jules César"], ["Zeus", "Hadès"],
    ["Père Noël", "Grinch"], ["Simba", "Scar"], ["Peter Pan", "Capitaine Crochet"], ["Superman", "Lex Luthor"],
    ["Spider-Man", "Bouffon Vert"], ["Gandalf", "Sauron"], ["Sonic", "Docteur Eggman"], ["Aladdin", "Jafar"],
    ["Cendrillon", "La belle-mère"], ["Le Petit Chaperon rouge", "Le Grand Méchant Loup"], ["Robin des Bois", "Shérif de Nottingham"], ["Bob l'éponge", "Plankton"],
    ["Les Schtroumpfs", "Gargamel"], ["Pikachu", "Team Rocket"],
  ],

  "Choses opposées": [
    ["Grand", "Petit"], ["Gros", "Maigre"], ["Rapide", "Lent"], ["Fort", "Faible"],
    ["Lourd", "Léger"], ["Dur", "Mou"], ["Lisse", "Rugueux"], ["Noir", "Blanc"],
    ["Clair", "Foncé"], ["Haut", "Bas"], ["Large", "Étroit"], ["Long", "Court"],
    ["Jeune", "Vieux"], ["Riche", "Pauvre"], ["Beau", "Moche"], ["Intelligent", "Bête"],
    ["Facile", "Difficile"], ["Vrai", "Faux"], ["Début", "Fin"], ["Guerre", "Paix"],
    ["Vivant", "Mort"], ["Mariage", "Divorce"], ["Naissance", "Retraite"], ["Mouillé", "Sec"],
    ["Bruyant", "Silencieux"], ["Sauvage", "Domestique"], ["Ancien", "Moderne"], ["Réel", "Imaginaire"],
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
