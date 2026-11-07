// ===================================================================
//  SONAR — L'arène (partagée serveur + navigateur)
//  Des murs droits, symétriques par rapport au centre, et des départs bien
//  éloignés. Tirée d'une seed : le serveur et le navigateur ont la même.
//    globalThis.SonarMap
// ===================================================================

(function (root) {
  const S = {};
  S.W = 1280; S.H = 800;
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  S.build = function (seed) {
    const rnd = seeded(seed), W = S.W, HGT = S.H;
    const rects = [], spawns = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.3; spawns.push({ x: W / 2 + Math.cos(a) * (W / 2 - 110), y: HGT / 2 + Math.sin(a) * (HGT / 2 - 100) }); }
    const ok = (o) => !rects.some((p) => o.x < p.x + p.w + 70 && o.x + o.w + 70 > p.x && o.y < p.y + p.h + 70 && o.y + o.h + 70 > p.y)
      && spawns.every((s) => s.x < o.x - 60 || s.x > o.x + o.w + 60 || s.y < o.y - 60 || s.y > o.y + o.h + 60);
    for (let tries = 0; tries < 400 && rects.length < 18; tries++) {
      const horiz = rnd() < 0.5, L = 90 + rnd() * 170, T = 22 + rnd() * 10;
      const o = { x: Math.round(60 + rnd() * (W / 2 - 60)), y: Math.round(60 + rnd() * (HGT - 120)), w: Math.round(horiz ? L : T), h: Math.round(horiz ? T : L) };
      if (o.x + o.w > W / 2 - 20 || o.y + o.h > HGT - 60) continue;
      const m = { x: W - o.x - o.w, y: HGT - o.y - o.h, w: o.w, h: o.h };
      if (!ok(o)) continue;
      rects.push(o);
      if (ok(m)) rects.push(m); else rects.pop();
    }
    return { seed, rects, spawns };
  };
  root.SonarMap = S;
})(typeof window !== "undefined" ? window : globalThis);
