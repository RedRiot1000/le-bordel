// ===================================================================
//  SUMO — Générateur de maps
//   - Arène : un grand rond au milieu d'un écran 1280 x 800.
//   - Îles  : 4 à 6 grandes îles rondes dans une grande map, reliées par
//             des couloirs (toutes les îles sont toujours accessibles).
// ===================================================================

const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export const ARENA = { w: 1280, h: 800, r0: 370 };

export function arenaMap(nPlayers) {
  const cx = ARENA.w / 2, cy = ARENA.h / 2;
  const spawns = Array.from({ length: nPlayers }, (_, i) => {
    const t = (i / nPlayers) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(t) * ARENA.r0 * 0.62, y = cy + Math.sin(t) * ARENA.r0 * 0.62;
    return { x, y, a: Math.atan2(cy - y, cx - x) };   // tournées vers le centre
  });
  return { id: Math.random().toString(36).slice(2, 8), kind: "arena", w: ARENA.w, h: ARENA.h, cx, cy, r0: ARENA.r0, spawns, seed: Math.floor(Math.random() * 1e6) };
}

export function islandsMap(nPlayers) {
  const W = 2700, H = 1800;
  // 6 emplacements possibles (grille 3 x 2 un peu décalée), on en garde 4 à 6.
  const slots = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      slots.push({ x: 450 + col * 900 + rand(-90, 90), y: 470 + row * 860 + rand(-80, 80) });
    }
  }
  const count = Math.floor(rand(4, 7));
  const islands = shuffle(slots).slice(0, count).map((s) => ({ x: Math.round(s.x), y: Math.round(s.y), r: Math.round(rand(240, 310)) }));

  // Couloirs : on relie d'abord tout le monde au plus court (arbre), puis 1 ou 2 couloirs en plus.
  const corridors = [];
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const have = new Set();
  const dist = (a, b) => Math.hypot(islands[a].x - islands[b].x, islands[a].y - islands[b].y);
  const linked = [0];
  while (linked.length < islands.length) {
    let best = null;
    for (const a of linked) for (let b = 0; b < islands.length; b++) {
      if (linked.includes(b)) continue;
      if (!best || dist(a, b) < dist(best[0], best[1])) best = [a, b];
    }
    corridors.push({ a: best[0], b: best[1], w: 120 });
    have.add(key(best[0], best[1]));
    linked.push(best[1]);
  }
  const extras = [];
  for (let a = 0; a < islands.length; a++) for (let b = a + 1; b < islands.length; b++) {
    if (!have.has(key(a, b)) && dist(a, b) < 1350) extras.push([a, b]);
  }
  for (const [a, b] of shuffle(extras).slice(0, Math.floor(rand(1, 3)))) corridors.push({ a, b, w: 120 });

  // Départs : les joueurs sont répartis sur les îles au hasard.
  const spawns = [];
  const order = shuffle(islands.map((_, i) => i));
  const base = islands.map(() => rand(0, Math.PI * 2));          // angle de départ de chaque île
  const perIsland = Math.ceil(nPlayers / order.length);          // joueurs max sur une même île
  for (let p = 0; p < nPlayers; p++) {
    const n = order[p % order.length];
    const isl = islands[n];
    const k = Math.floor(p / order.length);
    const t = base[n] + (k * Math.PI * 2) / perIsland;
    const x = isl.x + Math.cos(t) * isl.r * 0.45, y = isl.y + Math.sin(t) * isl.r * 0.45;
    spawns.push({ x, y, a: Math.atan2(isl.y - y, isl.x - x) });
  }
  return { id: Math.random().toString(36).slice(2, 8), kind: "islands", w: W, h: H, islands, corridors, spawns, seed: Math.floor(Math.random() * 1e6) };
}
