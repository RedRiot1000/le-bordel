// ===================================================================
//  DEVINE LA MAP — Import des icônes des maps
//  Usage : node tools/icons-cs2.mjs [dossier]   (par défaut : Téléchargements)
//  Prend les fichiers de_xxx.png / cs_xxx.png (ex. de_dust2.png, cs_office.png,
//  de_ancient_night.png) et les range, réduits à 192 px, dans
//  public/games/cs2map/icons/<map>.png  (ex. dust2.png, office.png, ancient.png).
// ===================================================================

import { readdirSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] || path.join(os.homedir(), "Downloads");
const OUT = path.join(ROOT, "public", "games", "cs2map", "icons");

let sharp;
try { sharp = (await import("sharp")).default; }
catch { console.error("❌ Il manque l'outil d'images. Lance d'abord :  npm install"); process.exit(1); }

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const file of readdirSync(SRC)) {
  const m = file.match(/^(?:de|cs)_([a-z0-9]+)(?:_[a-z]+)?\.(png|webp|jpg)$/i);   // "de_ancient_night.png" -> "ancient"
  if (!m) continue;
  const id = m[1].toLowerCase();
  await sharp(path.join(SRC, file)).resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT, id + ".png"));
  console.log(`  ${file.padEnd(24)} -> icons/${id}.png`);
  n++;
}
console.log(`\n✅ ${n} icône(s) prête(s) dans ${OUT}`);
