// ===================================================================
//  PATATE CHAUDE — Générateur de maps aléatoires
//  À chaque manche : un sol (asphalte / terre / neige), des obstacles
//  placés au hasard et quelques flaques d'huile. On garde toujours au
//  moins 100 px de passage, et une "route" libre tout autour.
// ===================================================================

const SURFACES = {
  asphalte: { grip: 1 },
  terre: { grip: 0.65 },
  neige: { grip: 0.45 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Les rectangles a et b (agrandis de "gap") se chevauchent-ils ?
function overlaps(a, b, gap) {
  return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x &&
         a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
}

// Distance d'un point à un rectangle.
function distToRect(px, py, r) {
  const qx = Math.max(r.x, Math.min(px, r.x + r.w));
  const qy = Math.max(r.y, Math.min(py, r.y + r.h));
  return Math.hypot(px - qx, py - qy);
}

// Points de départ : en ellipse, voitures tournées vers le centre.
export function spawnPoints(n, W, H) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2 + Math.PI / 2;
    const x = W / 2 + Math.cos(t) * (W / 2 - 150);
    const y = H / 2 + Math.sin(t) * (H / 2 - 120);
    return { x, y, a: Math.atan2(H / 2 - y, W / 2 - x) };
  });
}

// size = combien de fois plus de surface que la map de base (plus d'obstacles et d'huile).
// asphaltChance = chance d'avoir de l'asphalte quand les sols glissants sont permis.
export function generateMap({ W, H, players, slippery, size = 1, asphaltChance = 0.5 }) {
  const surface = !slippery || Math.random() < asphaltChance ? "asphalte" : pick(["terre", "neige"]);
  const spawns = spawnPoints(players, W, H);
  const MARGIN = 100;     // route libre le long des bords
  const GAP = 100;        // passage minimum entre deux obstacles

  // --- Obstacles ---
  const obstacles = [];
  const wanted = Math.floor(rand(5, 10) * size);
  for (let tries = 0; tries < 400 * size && obstacles.length < wanted; tries++) {
    const kind = pick(["bloc", "bloc", "mur-h", "mur-v", "pilier"]);
    let w, h;
    if (kind === "bloc") { w = rand(70, 160); h = rand(70, 150); }
    else if (kind === "mur-h") { w = rand(180, 340); h = 34; }
    else if (kind === "mur-v") { w = 34; h = rand(160, 300); }
    else { w = h = rand(40, 60); }
    const o = {
      x: Math.round(rand(MARGIN, W - MARGIN - w)),
      y: Math.round(rand(MARGIN, H - MARGIN - h)),
      w: Math.round(w), h: Math.round(h),
    };
    if (obstacles.some((p) => overlaps(o, p, GAP))) continue;
    if (spawns.some((s) => distToRect(s.x, s.y, o) < 90)) continue;
    obstacles.push(o);
  }

  // --- Flaques d'huile (elles ne bloquent pas, elles font glisser) ---
  const oils = [];
  const nOils = Math.floor(rand(1, 4) * size);
  for (let tries = 0; tries < 100 * size && oils.length < nOils; tries++) {
    const o = { x: Math.round(rand(150, W - 150)), y: Math.round(rand(150, H - 150)), r: Math.round(rand(45, 80)) };
    if (spawns.some((s) => Math.hypot(s.x - o.x, s.y - o.y) < o.r + 60)) continue;
    if (oils.some((p) => Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r)) continue;
    oils.push(o);
  }

  return {
    id: Math.random().toString(36).slice(2, 8),
    surface,
    grip: SURFACES[surface].grip,
    obstacles,
    oils,
    spawns,
    seed: Math.floor(Math.random() * 1e6),   // pour le décor (dessiné côté navigateur)
  };
}
