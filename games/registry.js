// ===================================================================
//  LE BORDEL — Catalogue des mini-jeux
//  👉 Pour ajouter un jeu : crée games/<nom>/server.js (avec `meta` et
//     `createGame`), puis ajoute-le dans GAMES ci-dessous.
// ===================================================================

import * as imposter from "./imposter/server.js";
import * as patate from "./patate/server.js";

// Les jeux jouables.
export const GAMES = {
  [imposter.meta.id]: imposter,
  [patate.meta.id]: patate,
};

// Les jeux prévus (affichés grisés "bientôt" dans le menu).
export const UPCOMING = [
  { name: "Sumo", emoji: "🤼", family: "Action" },
  { name: "Dessine et devine", emoji: "🎨", family: "Dessin" },
  { name: "Le plus proche", emoji: "🎯", family: "Quiz" },
  { name: "Qui de nous ?", emoji: "👉", family: "Quiz" },
  { name: "Menteur", emoji: "🤥", family: "Bluff" },
];
