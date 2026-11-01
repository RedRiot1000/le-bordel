// ===================================================================
//  LE BORDEL — Catalogue des mini-jeux
//  👉 Pour ajouter un jeu : crée games/<nom>/server.js (avec `meta` et
//     `createGame`), puis ajoute-le dans GAMES ci-dessous.
// ===================================================================

import * as imposter from "./imposter/server.js";
import * as patate from "./patate/server.js";
import * as sumo from "./sumo/server.js";
import * as cs2map from "./cs2map/server.js";
import * as quidenous from "./quidenous/server.js";
import * as neon from "./neon/server.js";

// Les jeux jouables.
export const GAMES = {
  [imposter.meta.id]: imposter,
  [patate.meta.id]: patate,
  [sumo.meta.id]: sumo,
  [cs2map.meta.id]: cs2map,
  [quidenous.meta.id]: quidenous,
  [neon.meta.id]: neon,
};

// Les jeux prévus (affichés grisés "bientôt" dans le menu).
export const UPCOMING = [
  { name: "Dessine et devine", emoji: "🎨", family: "Dessin" },
  { name: "Le plus proche", emoji: "🎯", family: "Quiz" },
  { name: "Menteur", emoji: "🤥", family: "Bluff" },
];
