// Photo de groupe de synthese : salle (murs gris, sol beige), petit fond vert derriere le haut du
// groupe, personnes (peau, vetements colores, meches fines devant le fond vert).
// complet : fond vert sur tout le cadre (l'IA de groupe est alors inutile).
// Retourne { rgba, zone } ; zone : 0 salle, 1 fond vert, 2 personne.
self.synthGroupe = function (W, H, complet) {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rgba = new Uint8ClampedArray(W * H * 4), zone = new Uint8Array(W * H);
  const vert = (x, y) => complet || (x > W * 0.22 && x < W * 0.78 && y > H * 0.04 && y < H * 0.5);
  const gens = [
    { x: 0.36, y: 0.22, c: [180, 40, 50], meches: true }, { x: 0.52, y: 0.2, c: [40, 60, 170] },
    { x: 0.66, y: 0.24, c: [200, 165, 40] }, { x: 0.14, y: 0.42, c: [60, 120, 190] },
    { x: 0.86, y: 0.4, c: [170, 60, 140] }, { x: 0.45, y: 0.62, c: [190, 90, 40] },
  ];
  const personne = (x, y) => {
    for (const g of gens) {
      const hx = g.x * W, hy = g.y * H, r = H * 0.055;
      const dx = x - hx, dy = y - hy;
      if (dx * dx + dy * dy < r * r) return [225, 175, 145];
      if (y > hy + r * 0.8 && y < hy + H * 0.36 && Math.abs(dx) < r * (1.6 + (y - hy) / (H * 0.6))) return g.c;
      // meches fines (cheveux) au-dessus de la tete, devant le fond vert
      if (g.meches && y < hy - r * 0.6 && y > hy - r * 1.6) {
        for (let k = -4; k <= 4; k++) if (Math.abs(x - (hx + k * r * 0.18 + (hy - y) * 0.15 * k / 4)) < 1.2) return [110, 60, 30];
      }
    }
    return null;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = y * W + x, i = q * 4, n = (rnd() - 0.5) * 10;
    let c, z;
    const p = personne(x, y);
    if (p) { c = p; z = 2; } else if (vert(x, y)) { c = [40, 170, 70]; z = 1; } else if (y > H * 0.7) { c = [192, 182, 168]; z = 0; } else { c = [150, 146, 140]; z = 0; }
    rgba[i] = c[0] + n; rgba[i + 1] = c[1] + n; rgba[i + 2] = c[2] + n; rgba[i + 3] = 255;
    zone[q] = z;
  }
  return { rgba, zone };
};
