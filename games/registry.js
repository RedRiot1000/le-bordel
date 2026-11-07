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
import * as carfoot from "./carfoot/server.js";
import * as sur10 from "./sur10/server.js";
import * as classement from "./classement/server.js";
import * as chat from "./chat/server.js";
import * as police from "./police/server.js";
import * as pensepareil from "./pensepareil/server.js";
import * as deuxverites from "./deuxverites/server.js";
import * as sol from "./sol/server.js";
import * as territoire from "./territoire/server.js";
import * as neige from "./neige/server.js";
import * as casse from "./casse/server.js";
import * as colline from "./colline/server.js";
import * as parkour from "./parkour/server.js";
import * as course from "./course/server.js";
import * as tour from "./tour/server.js";
import * as cavale from "./cavale/server.js";
import * as ricochet from "./ricochet/server.js";
import * as puck from "./puck/server.js";
import * as sonar from "./sonar/server.js";
import * as foule from "./foule/server.js";

// Les jeux jouables.
export const GAMES = {
  [imposter.meta.id]: imposter,
  [patate.meta.id]: patate,
  [sumo.meta.id]: sumo,
  [cs2map.meta.id]: cs2map,
  [quidenous.meta.id]: quidenous,
  [neon.meta.id]: neon,
  [carfoot.meta.id]: carfoot,
  [sur10.meta.id]: sur10,
  [classement.meta.id]: classement,
  [chat.meta.id]: chat,
  [police.meta.id]: police,
  [pensepareil.meta.id]: pensepareil,
  [deuxverites.meta.id]: deuxverites,
  [sol.meta.id]: sol,
  [territoire.meta.id]: territoire,
  [neige.meta.id]: neige,
  [casse.meta.id]: casse,
  [colline.meta.id]: colline,
  [parkour.meta.id]: parkour,
  [course.meta.id]: course,
  [tour.meta.id]: tour,
  [cavale.meta.id]: cavale,
  [ricochet.meta.id]: ricochet,
  [puck.meta.id]: puck,
  [sonar.meta.id]: sonar,
  [foule.meta.id]: foule,
};

// Les jeux prévus (affichés grisés "bientôt" dans le menu).
export const UPCOMING = [
];
