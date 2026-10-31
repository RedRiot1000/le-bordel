// ===================================================================
//  IMPOSTER — Banque de mots
//  Des PAIRES de mots proches : { civil, undercover }.
//  - civil       = le mot de la majorité
//  - undercover  = le mot proche donné à l'imposteur
//  Classées par catégories (l'hôte peut en activer/désactiver).
//
//  👉 Pour agrandir la banque : ajoute simplement des lignes ici.
// ===================================================================

export const WORD_BANK = {
  "Nourriture": [
    { civil: "Pomme", undercover: "Poire" },
    { civil: "Fraise", undercover: "Framboise" },
    { civil: "Citron", undercover: "Orange" },
    { civil: "Pizza", undercover: "Tarte" },
    { civil: "Frites", undercover: "Chips" },
    { civil: "Café", undercover: "Thé" },
    { civil: "Chocolat", undercover: "Caramel" },
    { civil: "Baguette", undercover: "Croissant" },
    { civil: "Fromage", undercover: "Beurre" },
    { civil: "Crêpe", undercover: "Gaufre" },
    { civil: "Sushi", undercover: "Maki" },
    { civil: "Burger", undercover: "Sandwich" },
    { civil: "Miel", undercover: "Confiture" },
    { civil: "Yaourt", undercover: "Crème" },
    { civil: "Pâtes", undercover: "Riz" },
    { civil: "Soupe", undercover: "Bouillon" },
    { civil: "Glace", undercover: "Sorbet" },
    { civil: "Bonbon", undercover: "Sucette" },
    { civil: "Ketchup", undercover: "Mayonnaise" },
    { civil: "Concombre", undercover: "Courgette" },
  ],

  "Animaux": [
    { civil: "Chien", undercover: "Loup" },
    { civil: "Chat", undercover: "Tigre" },
    { civil: "Lapin", undercover: "Lièvre" },
    { civil: "Cheval", undercover: "Âne" },
    { civil: "Grenouille", undercover: "Crapaud" },
    { civil: "Papillon", undercover: "Libellule" },
    { civil: "Abeille", undercover: "Guêpe" },
    { civil: "Dauphin", undercover: "Requin" },
    { civil: "Aigle", undercover: "Faucon" },
    { civil: "Tortue", undercover: "Escargot" },
    { civil: "Crocodile", undercover: "Alligator" },
    { civil: "Léopard", undercover: "Guépard" },
    { civil: "Singe", undercover: "Gorille" },
    { civil: "Souris", undercover: "Rat" },
    { civil: "Poule", undercover: "Canard" },
    { civil: "Mouton", undercover: "Chèvre" },
    { civil: "Baleine", undercover: "Orque" },
    { civil: "Corbeau", undercover: "Pie" },
    { civil: "Fourmi", undercover: "Termite" },
    { civil: "Pingouin", undercover: "Manchot" },
  ],

  "Objets": [
    { civil: "Chaise", undercover: "Tabouret" },
    { civil: "Stylo", undercover: "Crayon" },
    { civil: "Fourchette", undercover: "Cuillère" },
    { civil: "Verre", undercover: "Tasse" },
    { civil: "Téléphone", undercover: "Tablette" },
    { civil: "Montre", undercover: "Réveil" },
    { civil: "Parapluie", undercover: "Parasol" },
    { civil: "Balai", undercover: "Serpillère" },
    { civil: "Marteau", undercover: "Tournevis" },
    { civil: "Bougie", undercover: "Lampe" },
    { civil: "Sac", undercover: "Valise" },
    { civil: "Lunettes", undercover: "Masque" },
    { civil: "Ciseaux", undercover: "Couteau" },
    { civil: "Clé", undercover: "Cadenas" },
    { civil: "Miroir", undercover: "Fenêtre" },
    { civil: "Oreiller", undercover: "Couette" },
    { civil: "Casque", undercover: "Écouteurs" },
    { civil: "Aspirateur", undercover: "Balayette" },
    { civil: "Bouteille", undercover: "Gourde" },
    { civil: "Livre", undercover: "Magazine" },
  ],

  "Lieux": [
    { civil: "Plage", undercover: "Désert" },
    { civil: "Montagne", undercover: "Colline" },
    { civil: "Forêt", undercover: "Jungle" },
    { civil: "École", undercover: "Université" },
    { civil: "Hôpital", undercover: "Clinique" },
    { civil: "Restaurant", undercover: "Cantine" },
    { civil: "Piscine", undercover: "Lac" },
    { civil: "Cinéma", undercover: "Théâtre" },
    { civil: "Musée", undercover: "Galerie" },
    { civil: "Château", undercover: "Palais" },
    { civil: "Gare", undercover: "Aéroport" },
    { civil: "Supermarché", undercover: "Marché" },
    { civil: "Parc", undercover: "Jardin" },
    { civil: "Église", undercover: "Cathédrale" },
    { civil: "Hôtel", undercover: "Auberge" },
    { civil: "Prison", undercover: "Cachot" },
    { civil: "Rivière", undercover: "Fleuve" },
    { civil: "Île", undercover: "Presqu'île" },
    { civil: "Grotte", undercover: "Tunnel" },
    { civil: "Ferme", undercover: "Grange" },
  ],

  "Sport & Loisirs": [
    { civil: "Football", undercover: "Rugby" },
    { civil: "Tennis", undercover: "Badminton" },
    { civil: "Ski", undercover: "Snowboard" },
    { civil: "Boxe", undercover: "Karaté" },
    { civil: "Vélo", undercover: "Trottinette" },
    { civil: "Natation", undercover: "Plongée" },
    { civil: "Basket", undercover: "Handball" },
    { civil: "Golf", undercover: "Pétanque" },
    { civil: "Course", undercover: "Marche" },
    { civil: "Danse", undercover: "Gymnastique" },
    { civil: "Échecs", undercover: "Dames" },
    { civil: "Guitare", undercover: "Ukulélé" },
    { civil: "Piano", undercover: "Orgue" },
    { civil: "Peinture", undercover: "Dessin" },
    { civil: "Poker", undercover: "Belote" },
    { civil: "Escalade", undercover: "Randonnée" },
    { civil: "Surf", undercover: "Kite" },
    { civil: "Violon", undercover: "Alto" },
    { civil: "Trompette", undercover: "Saxophone" },
    { civil: "Cerf-volant", undercover: "Frisbee" },
  ],

  "Transports": [
    { civil: "Voiture", undercover: "Camion" },
    { civil: "Avion", undercover: "Hélicoptère" },
    { civil: "Train", undercover: "Métro" },
    { civil: "Bateau", undercover: "Sous-marin" },
    { civil: "Moto", undercover: "Scooter" },
    { civil: "Bus", undercover: "Tramway" },
    { civil: "Fusée", undercover: "Navette" },
    { civil: "Vélo", undercover: "Monocycle" },
    { civil: "Taxi", undercover: "Ambulance" },
    { civil: "Voilier", undercover: "Yacht" },
    { civil: "Montgolfière", undercover: "Planeur" },
    { civil: "Trottinette", undercover: "Skateboard" },
  ],

  "Métiers": [
    { civil: "Médecin", undercover: "Infirmier" },
    { civil: "Professeur", undercover: "Instituteur" },
    { civil: "Policier", undercover: "Gendarme" },
    { civil: "Pompier", undercover: "Secouriste" },
    { civil: "Cuisinier", undercover: "Pâtissier" },
    { civil: "Avocat", undercover: "Juge" },
    { civil: "Pilote", undercover: "Steward" },
    { civil: "Coiffeur", undercover: "Barbier" },
    { civil: "Boulanger", undercover: "Boucher" },
    { civil: "Peintre", undercover: "Sculpteur" },
    { civil: "Journaliste", undercover: "Écrivain" },
    { civil: "Astronaute", undercover: "Explorateur" },
    { civil: "Jardinier", undercover: "Fleuriste" },
    { civil: "Chanteur", undercover: "Musicien" },
    { civil: "Acteur", undercover: "Comédien" },
    { civil: "Dentiste", undercover: "Chirurgien" },
  ],

  "Nature": [
    { civil: "Soleil", undercover: "Lune" },
    { civil: "Pluie", undercover: "Neige" },
    { civil: "Arbre", undercover: "Buisson" },
    { civil: "Rose", undercover: "Tulipe" },
    { civil: "Nuage", undercover: "Brouillard" },
    { civil: "Orage", undercover: "Tempête" },
    { civil: "Sable", undercover: "Gravier" },
    { civil: "Cascade", undercover: "Source" },
    { civil: "Volcan", undercover: "Geyser" },
    { civil: "Étoile", undercover: "Planète" },
    { civil: "Feuille", undercover: "Pétale" },
    { civil: "Champignon", undercover: "Mousse" },
    { civil: "Glacier", undercover: "Iceberg" },
    { civil: "Vent", undercover: "Brise" },
    { civil: "Arc-en-ciel", undercover: "Aurore" },
    { civil: "Cactus", undercover: "Palmier" },
  ],
};

// Aplatit la banque selon les catégories actives -> liste de paires.
export function getPairs(activeCategories) {
  const cats = activeCategories && activeCategories.length
    ? activeCategories
    : Object.keys(WORD_BANK);
  const pairs = [];
  for (const cat of cats) {
    if (WORD_BANK[cat]) pairs.push(...WORD_BANK[cat]);
  }
  return pairs;
}

// La liste des noms de catégories (pour les réglages de l'hôte).
export const CATEGORIES = Object.keys(WORD_BANK);
