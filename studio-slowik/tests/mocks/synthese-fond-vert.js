// Image de synthese pour les tests du detourage : fond vert inegal, ombre au sol, sujet, meches fines.
// La transparence exacte (verite terrain) est connue. Charge dans la page par les tests.
// corps : couleur du vetement (ex : vert pour tester le score de confiance).
function synth(W, H, seed = 1, corps = [40, 60, 150]) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rgba = new Uint8ClampedArray(W * H * 4), truth = new Float32Array(W * H);
  const SS = 4;
  const cx = W * 0.5;
  const shapes = [
    { t: 'ell', x: cx, y: H * 0.78, rx: W * 0.22, ry: H * 0.32, c: corps },   // corps (pull bleu)
    { t: 'ell', x: cx, y: H * 0.38, rx: W * 0.11, ry: H * 0.16, c: [225, 175, 140] }, // visage
    { t: 'ell', x: cx, y: H * 0.27, rx: W * 0.13, ry: H * 0.10, c: [120, 80, 40] },   // cheveux
  ];
  const lines = [];
  for (let k = 0; k < 40; k++) { const a = -Math.PI * (0.15 + 0.7 * k / 39); lines.push({ x0: cx + Math.cos(a) * W * 0.12, y0: H * 0.27 + Math.sin(a) * H * 0.09, len: H * (0.05 + 0.06 * rnd()), a, wdt: 0.8 + rnd() * 0.6 }); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    // fond : vert, plus sombre en bas et dans les coins, ombre au sol
    const vx = (x / W - 0.5), vy = (y / H - 0.5);
    let L = 1 - 0.35 * (vx * vx + vy * vy) * 2 - 0.25 * (y / H);
    const sh = ((x - cx) / (W * 0.35)) ** 2 + ((y - H * 0.97) / (H * 0.06)) ** 2;
    if (sh < 1) L *= 0.55 + 0.45 * sh;
    let B = [45 * L, 175 * L, 80 * L].map(v => v + (rnd() - 0.5) * 8);
    // couverture par sur-echantillonnage
    let col = [0, 0, 0], cov = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      let c = null;
      for (const sp of shapes) if (((px - sp.x) / sp.rx) ** 2 + ((py - sp.y) / sp.ry) ** 2 <= 1) c = sp.c;
      if (!c) for (const l of lines) {
        const dx = px - l.x0, dy = py - l.y0; const t = dx * Math.cos(l.a) + dy * Math.sin(l.a);
        if (t < 0 || t > l.len) continue; const d = Math.abs(-dx * Math.sin(l.a) + dy * Math.cos(l.a));
        if (d < l.wdt / 2) { c = [140, 95, 50]; break; }
      }
      if (c) { cov++; col[0] += c[0]; col[1] += c[1]; col[2] += c[2]; }
    }
    const a = cov / (SS * SS);
    truth[p] = a;
    const F = cov ? col.map(v => v / cov) : [0, 0, 0];
    // reflet vert sur le sujet (spill) pres des bords
    const spill = a > 0 && a < 1 ? 25 : 6;
    F[1] += spill;
    for (let k = 0; k < 3; k++) rgba[p * 4 + k] = a * F[k] + (1 - a) * B[k];
    rgba[p * 4 + 3] = 255;
  }
  return { rgba, truth, shadowBox: [cx - W * 0.3, H * 0.93, cx + W * 0.3, H] };
}
function metrics(alpha, truth, W, H, box) {
  let sad = 0, edge = 0, ne = 0, sh = 0, ns = 0, inner = 0, ni = 0, hair = 0, nh = 0;
  for (let p = 0; p < W * H; p++) {
    const a = alpha[p] / 255, t = truth[p]; sad += Math.abs(a - t);
    if (t > 0 && t < 1) { edge += (a - t) ** 2; ne++; if (t < 0.6) { hair += a; nh++; } }
    if (t === 1) { inner += a; ni++; }
    const x = p % W, y = (p / W) | 0;
    if (t === 0 && x > box[0] && x < box[2] && y > box[1] && y < box[3]) { sh += a; ns++; }
  }
  return { sad: +(sad / (W * H) * 1000).toFixed(2), edgeMSE: +(edge / ne).toFixed(4), ombre: +(sh / ns).toFixed(4), interieur: +(inner / ni).toFixed(4), meches: +(hair / nh).toFixed(3) };
}
window.synthFondVert = synth;
window.mesuresDetourage = metrics;
