// ===================================================================
//  DEVINE LA MAP — Import des screenshots CS2
//  Usage : npm run images
//
//  1. Mets tes screenshots dans  screenshots-cs2/<map>/  (ex. screenshots-cs2/mirage/)
//     (png, jpg ou webp, n'importe quel nom).
//  2. Lance  npm run images
//  -> Chaque image est réduite (1280 px de large, JPEG léger) et copiée dans
//     public/games/cs2map/img/ avec un NOM AU HASARD (on ne peut pas tricher
//     en lisant le nom du fichier), et la liste "image -> map" est écrite
//     dans games/cs2map/manifest.json (côté serveur uniquement).
//  On peut relancer autant qu'on veut : les images déjà faites sont gardées,
//  celles supprimées du dossier disparaissent du jeu.
// ===================================================================

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.SRC || path.join(ROOT, "screenshots-cs2");
const OUT_DIR = path.join(ROOT, "public", "games", "cs2map", "img");
const MANIFEST = path.join(ROOT, "games", "cs2map", "manifest.json");
const EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

let sharp;
try { sharp = (await import("sharp")).default; }
catch { console.error("❌ Il manque l'outil d'images. Lance d'abord :  npm install"); process.exit(1); }

if (!existsSync(SRC)) {
  mkdirSync(SRC, { recursive: true });
  console.log(`📁 Dossier créé : ${SRC}\n   Mets tes screenshots dedans, un sous-dossier par map (mirage, inferno, dust2...), puis relance.`);
  process.exit(0);
}
mkdirSync(OUT_DIR, { recursive: true });

const entries = [];
const perMap = {};
for (const mapDir of readdirSync(SRC)) {
  const full = path.join(SRC, mapDir);
  if (!statSync(full).isDirectory()) continue;
  const map = mapDir.toLowerCase().replace(/^de_|^cs_/, "");   // "de_mirage" -> "mirage"
  for (const file of readdirSync(full)) {
    if (!EXT.has(path.extname(file).toLowerCase())) continue;
    const src = path.join(full, file);
    // Nom de sortie = empreinte du contenu : même image = même nom (pas de doublons si on relance).
    const id = createHash("sha1").update(readFileSync(src)).digest("hex").slice(0, 14);
    const out = path.join(OUT_DIR, id + ".jpg");
    if (!existsSync(out)) {
      await sharp(src).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
      console.log(`  + ${mapDir}/${file}`);
    }
    entries.push({ file: id + ".jpg", map });
    perMap[map] = (perMap[map] || 0) + 1;
  }
}

// On retire du jeu les images qui ne sont plus dans le dossier.
const keep = new Set(entries.map((e) => e.file));
let removed = 0;
for (const f of readdirSync(OUT_DIR)) if (!keep.has(f)) { unlinkSync(path.join(OUT_DIR, f)); removed++; }

writeFileSync(MANIFEST, JSON.stringify(entries, null, 1));
console.log(`\n✅ ${entries.length} screenshot(s) dans le jeu${removed ? `, ${removed} retiré(s)` : ""} :`);
for (const [m, n] of Object.entries(perMap).sort()) console.log(`   ${m.padEnd(10)} ${n}`);
console.log("\nPour les mettre en ligne :  git add -A  puis  git commit -m \"screenshots\"  puis  git push");
