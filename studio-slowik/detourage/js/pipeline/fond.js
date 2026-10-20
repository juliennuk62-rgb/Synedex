// Analyse du fond vert : couleur de cle, carte d'eclairage du fond, alertes.
// Le resultat ne depend pas de la taille de l'image : il sert a l'apercu ET a la pleine definition.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.fond = (function () {
  const ANALYSE_MAX = 512;    // cote long de l'image d'analyse
  const GRILLE = 24;          // cellules de la carte d'eclairage sur le cote long
  const CLE_DEFAUT = [40, 170, 70];

  // Image reduite par moyenne de blocs (rapide, sans bruit). Retourne du RVB flottant.
  // Grande image : un pixel sur `pas` dans chaque direction suffit pour une moyenne par bloc.
  function reduire(rgba, w, h, max) {
    const s = Math.max(1, Math.ceil(Math.max(w, h) / max));
    const pas = Math.max(1, s >> 2);
    const sw = Math.ceil(w / s), sh = Math.ceil(h / s);
    const sum = new Float32Array(sw * sh * 3);
    const cnt = new Uint32Array(sw * sh);
    for (let y = 0; y < h; y += pas) {
      const ro = ((y / s) | 0) * sw;
      let i = y * w * 4;
      for (let x = 0; x < w; x += pas, i += 4 * pas) {
        const c = ro + ((x / s) | 0);
        sum[c * 3] += rgba[i]; sum[c * 3 + 1] += rgba[i + 1]; sum[c * 3 + 2] += rgba[i + 2];
        cnt[c]++;
      }
    }
    for (let c = 0; c < sw * sh; c++) { const k = 1 / cnt[c]; sum[c * 3] *= k; sum[c * 3 + 1] *= k; sum[c * 3 + 2] *= k; }
    return { rgb: sum, w: sw, h: sh };
  }

  function mediane(hist, total) {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc * 2 >= total) return v; }
    return 255;
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const s = Float64Array.from(values).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  }

  // Carte uniforme : utilisee quand la correction d'eclairage est desactivee.
  function uniforme(cle) {
    return { gw: 1, gh: 1, map: Float32Array.from(cle) };
  }

  function analyser(rgba, w, h) {
    const red = reduire(rgba, w, h, ANALYSE_MAX);
    const { rgb } = red;
    const N = red.w * red.h;
    // 1. Pixels franchement verts -> couleur de cle (mediane).
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    let nCand = 0;
    for (let p = 0; p < N; p++) {
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      if (g - Math.max(r, b) > 18 && g > 35) { hr[r | 0]++; hg[g | 0]++; hb[b | 0]++; nCand++; }
    }
    const alertes = [];
    if (nCand < N * 0.01) {
      alertes.push({ niveau: 'erreur', texte: 'Aucun fond vert détecté sur cette photo.' });
      return Object.assign({ cle: CLE_DEFAUT.slice(), couverture: 0, inegalite: 0, alertes }, uniforme(CLE_DEFAUT));
    }
    const cle = [mediane(hr, nCand), mediane(hg, nCand), mediane(hb, nCand)];
    // 2. Pixels du fond : meme teinte que la cle, quelle que soit la luminosite (ombres comprises).
    const kr = cle[0] / cle[1], kb = cle[2] / cle[1];
    const fondPx = new Uint8Array(N);
    let nFond = 0;
    for (let p = 0; p < N; p++) {
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      if (g < cle[1] * 0.2 || g - Math.max(r, b) <= 0) continue;
      if (Math.abs(r / g - kr) < 0.22 && Math.abs(b / g - kb) < 0.22) { fondPx[p] = 1; nFond++; }
    }
    // 3. Carte d'eclairage : couleur moyenne du fond par cellule, cellules vides completees.
    const cs = Math.ceil(Math.max(red.w, red.h) / GRILLE);
    let gw = Math.ceil(red.w / cs), gh = Math.ceil(red.h / cs);
    const sum = new Float64Array(gw * gh * 3), cnt = new Float64Array(gw * gh), tot = new Float64Array(gw * gh);
    for (let y = 0; y < red.h; y++) for (let x = 0; x < red.w; x++) {
      const c = ((y / cs) | 0) * gw + ((x / cs) | 0), p = y * red.w + x;
      tot[c]++;
      if (!fondPx[p]) continue;
      sum[c * 3] += rgb[p * 3]; sum[c * 3 + 1] += rgb[p * 3 + 1]; sum[c * 3 + 2] += rgb[p * 3 + 2];
      cnt[c]++;
    }
    let map = new Float32Array(gw * gh * 3);
    let known = new Uint8Array(gw * gh);
    const lums = [], lumCell = [];
    for (let c = 0; c < gw * gh; c++) {
      if (cnt[c] < tot[c] * 0.2 || cnt[c] < 4) continue;
      for (let k = 0; k < 3; k++) map[c * 3 + k] = sum[c * 3 + k] / cnt[c];
      known[c] = 1;
      const l = 0.3 * map[c * 3] + 0.59 * map[c * 3 + 1] + 0.11 * map[c * 3 + 2];
      lums.push(l);
      lumCell.push([c, l]);
    }
    // Zones « de fond » tres sombres hors du sol : forte ombre portee, ou vetement vert fonce
    // (meme teinte que le fond, impossible a distinguer par la couleur seule).
    const medLum = quantile(lums, 0.5);
    let sombres = 0;
    for (const [c, l] of lumCell) if (l < medLum * 0.5 && ((c / gw) | 0) < gh * 0.8) sombres++;
    if (!lums.length) { map = uniforme(cle).map; known = null; gw = gh = 1; }
    // Cellules sans fond visible (sujet) : moyenne des voisines connues, de proche en proche.
    let reste = known ? gw * gh - lums.length : 0;
    while (reste > 0) {
      const next = known.slice();
      const add = map.slice();
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const c = y * gw + x;
        if (known[c]) continue;
        let n = 0, r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const q = yy * gw + xx;
          if (!known[q]) continue;
          r += map[q * 3]; g += map[q * 3 + 1]; b += map[q * 3 + 2]; n++;
        }
        if (!n) continue;
        add[c * 3] = r / n; add[c * 3 + 1] = g / n; add[c * 3 + 2] = b / n;
        next[c] = 1; reste--;
      }
      map = add; known = next;
    }
    // Lissage leger (3 x 3, centre double) : supprime les marches entre cellules.
    if (gw * gh > 1) {
      const lisse = new Float32Array(map.length);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let n = 0; const acc = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const q = (yy * gw + xx) * 3, wgt = dx === 0 && dy === 0 ? 2 : 1;
          acc[0] += map[q] * wgt; acc[1] += map[q + 1] * wgt; acc[2] += map[q + 2] * wgt; n += wgt;
        }
        const c = (y * gw + x) * 3;
        lisse[c] = acc[0] / n; lisse[c + 1] = acc[1] / n; lisse[c + 2] = acc[2] / n;
      }
      map = lisse;
    }
    // 4. Alertes.
    const couverture = nFond / N;
    const med = quantile(lums, 0.5) || 1;
    const inegalite = lums.length ? (quantile(lums, 0.9) - quantile(lums, 0.1)) / med : 0;
    if (cle[1] < 70) alertes.push({ niveau: 'attention', texte: 'Fond vert sombre : éclairez davantage le fond.' });
    if (cle[1] - Math.max(cle[0], cle[2]) < 30) alertes.push({ niveau: 'attention', texte: 'Fond peu saturé (vert pâle ou tirant sur le bleu) : bords moins nets.' });
    if (inegalite > 0.45) alertes.push({ niveau: 'info', texte: 'Éclairage du fond inégal : corrigé automatiquement, vérifiez les bords.' });
    const sombre = sombres / (gw * gh);
    if (couverture < 0.15) alertes.push({ niveau: 'attention', texte: 'Peu de fond vert visible autour du sujet.' });
    return { cle, gw, gh, map, couverture, inegalite, sombre, alertes };
  }

  // Couleur du fond (carte d'eclairage) pour une ligne de l'image : out = Float32Array(w * 3).
  // Interpolation bilineaire entre les centres des cellules.
  function ligne(an, y, w, h, eclairage, out) {
    const { gw, gh } = eclairage ? an : { gw: 1, gh: 1 };
    const map = eclairage ? an.map : an.cle;
    if (gw === 1 && gh === 1) {
      for (let x = 0; x < w; x++) { out[x * 3] = map[0]; out[x * 3 + 1] = map[1]; out[x * 3 + 2] = map[2]; }
      return out;
    }
    let fy = ((y + 0.5) / h) * gh - 0.5;
    if (fy < 0) fy = 0; if (fy > gh - 1) fy = gh - 1;
    const y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    const rowv = new Float32Array(gw * 3);
    for (let c = 0; c < gw * 3; c++) rowv[c] = map[y0 * gw * 3 + c] * (1 - ty) + map[y1 * gw * 3 + c] * ty;
    for (let x = 0; x < w; x++) {
      let fx = ((x + 0.5) / w) * gw - 0.5;
      if (fx < 0) fx = 0; if (fx > gw - 1) fx = gw - 1;
      const x0 = fx | 0, x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      out[x * 3] = rowv[x0 * 3] * (1 - tx) + rowv[x1 * 3] * tx;
      out[x * 3 + 1] = rowv[x0 * 3 + 1] * (1 - tx) + rowv[x1 * 3 + 1] * tx;
      out[x * 3 + 2] = rowv[x0 * 3 + 2] * (1 - tx) + rowv[x1 * 3 + 2] * tx;
    }
    return out;
  }

  return { analyser, ligne, reduire };
})();
