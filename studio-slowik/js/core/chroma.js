// Detourage fond vert (HSV) et composition sur le fond.
var SL = self.SL = self.SL || {};
SL.chroma = (function () {
  const GREEN_HUE = 85; // 120 degres sur une echelle 0-255
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Calcule le masque (0-255) et retire le reflet vert, directement dans `d` (RGBA).
  function keyPixels(d, tolerance, softness, spill) {
    const hueW = 6 + tolerance * 0.4;
    const softH = 2 + softness * 0.25;
    const satMin = 100 - tolerance * 0.7;
    const softS = 4 + softness * 0.5;
    const sp = spill / 100;
    const alpha = new Uint8Array(d.length / 4);
    // Raccourci exact : si le vert n'est pas la composante dominante, la teinte est hors de
    // 60-180 degres ; tant que la fenetre de teinte reste plus etroite, le pixel est garde tel quel.
    const fast = hueW + softH <= 42.5;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (fast && g <= r || fast && g <= b) { alpha[p] = 255; continue; }
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      let green = 0;
      if (mx !== mn) {
        const c = mx - mn;
        let h = mx === r ? (g - b) / c : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
        h /= 6;
        if (h < 0) h += 1;
        h *= 255;
        let dh = Math.abs(h - GREEN_HUE);
        if (dh > 128) dh = 256 - dh;
        const hs = clamp01((hueW + softH - dh) / softH);
        if (hs > 0) {
          const s = (c * 255) / mx;
          green = hs * clamp01((s - satMin + softS) / softS) * clamp01((mx - 30) / 25);
        }
      }
      alpha[p] = ((1 - green) * 255 + 0.5) | 0;
      if (sp > 0) {
        const lim = r > b ? r : b;
        if (g > lim) d[i + 1] = (g - (g - lim) * sp + 0.5) | 0;
      }
    }
    return alpha;
  }

  // Flou gaussien approche (3 flous en boite), bords etendus.
  function boxSizes(sigma, n) {
    const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(ideal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }

  function boxH(src, dst, w, h, r) {
    const inv = 1 / (2 * r + 1);
    const last = w - 1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[o + (k < 0 ? 0 : k > last ? last : k)];
      for (let x = 0; x < w; x++) {
        dst[o + x] = acc * inv;
        let add = x + r + 1;
        if (add > last) add = last;
        let sub = x - r;
        if (sub < 0) sub = 0;
        acc += src[o + add] - src[o + sub];
      }
    }
  }

  // Passe verticale parcourue ligne par ligne (beaucoup plus rapide).
  function boxV(src, dst, w, h, r) {
    const inv = 1 / (2 * r + 1);
    const last = h - 1;
    const acc = new Float64Array(w);
    for (let k = -r; k <= r; k++) {
      const o = (k < 0 ? 0 : k > last ? last : k) * w;
      for (let x = 0; x < w; x++) acc[x] += src[o + x];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) dst[o + x] = acc[x] * inv;
      const ao = (y + r + 1 > last ? last : y + r + 1) * w;
      const so = (y - r < 0 ? 0 : y - r) * w;
      for (let x = 0; x < w; x++) acc[x] += src[ao + x] - src[so + x];
    }
  }

  function blur(alpha, w, h, sigma) {
    let a = Float32Array.from(alpha);
    let b = new Float32Array(a.length);
    for (const size of boxSizes(sigma, 3)) {
      const r = (size - 1) / 2;
      if (r < 1) continue;
      boxH(a, b, w, h, r);
      boxV(b, a, w, h, r);
    }
    return a;
  }

  // Flou limite a la zone de transition du masque (le long de la silhouette).
  // Les zones uniformes (fond entier, sujet entier) ne changent pas avec un flou :
  // on decoupe l'image en carreaux et on ne calcule que les carreaux proches d'un bord.
  // Resultat identique au flou complet, en bien moins de temps.
  function blurEdges(alpha, w, h, sigma) {
    const sizes = boxSizes(sigma, 3).map(sz => (sz - 1) / 2).filter(r => r >= 1);
    if (!sizes.length) return alpha;
    const reach = sizes.reduce((a, r) => a + r, 0);   // portee totale des 3 flous
    const M = reach + 1;                              // marge autour d'un carreau
    const T = 64;
    const tw = Math.ceil(w / T), th = Math.ceil(h / T);
    // Valeurs mini / maxi de chaque carreau.
    const tmin = new Uint8Array(tw * th), tmax = new Uint8Array(tw * th);
    for (let ty = 0; ty < th; ty++) {
      const y0 = ty * T, y1 = Math.min(h, y0 + T);
      for (let tx = 0; tx < tw; tx++) {
        const x0 = tx * T, x1 = Math.min(w, x0 + T);
        let lo = 255, hi = 0;
        for (let y = y0; y < y1; y++) {
          const o = y * w;
          for (let x = x0; x < x1; x++) { const v = alpha[o + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
        }
        tmin[ty * tw + tx] = lo; tmax[ty * tw + tx] = hi;
      }
    }
    // Un carreau est a calculer si lui et ses voisins (a portee du flou) ne sont pas d'une seule valeur.
    const d = Math.ceil(M / T);
    const need = new Uint8Array(tw * th);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      let lo = 255, hi = 0;
      for (let yy = Math.max(0, ty - d); yy <= Math.min(th - 1, ty + d); yy++) {
        for (let xx = Math.max(0, tx - d); xx <= Math.min(tw - 1, tx + d); xx++) {
          const k = yy * tw + xx;
          if (tmin[k] < lo) lo = tmin[k];
          if (tmax[k] > hi) hi = tmax[k];
        }
      }
      need[ty * tw + tx] = lo !== hi ? 1 : 0;
    }
    const out = new Uint8Array(alpha);
    let a = new Float32Array(0), b = new Float32Array(0);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      if (!need[ty * tw + tx]) continue;
      const cx0 = tx * T, cy0 = ty * T;
      const cx1 = Math.min(w, cx0 + T), cy1 = Math.min(h, cy0 + T);
      // zone de calcul = carreau + marge (bornee a l'image : bords etendus comme le flou complet)
      const rx0 = Math.max(0, cx0 - M), ry0 = Math.max(0, cy0 - M);
      const rx1 = Math.min(w, cx1 + M), ry1 = Math.min(h, cy1 + M);
      const rw = rx1 - rx0, rh = ry1 - ry0;
      if (a.length < rw * rh) { a = new Float32Array(rw * rh); b = new Float32Array(rw * rh); }
      for (let y = 0; y < rh; y++) {
        const so = (ry0 + y) * w + rx0, ro = y * rw;
        for (let x = 0; x < rw; x++) a[ro + x] = alpha[so + x];
      }
      for (const r of sizes) {
        boxH(a, b, rw, rh, r);
        boxV(b, a, rw, rh, r);
      }
      for (let y = cy0; y < cy1; y++) {
        const ro = (y - ry0) * rw - rx0, o = y * w;
        for (let x = cx0; x < cx1; x++) out[o + x] = (a[ro + x] + 0.5) | 0;
      }
    }
    return out;
  }

  // Sujet detoure sur un OffscreenCanvas transparent.
  function extract(source, opts) {
    const w = source.width, h = source.height;
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    if (!opts.chromaOn) return cv;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let alpha = keyPixels(d, opts.tolerance, opts.softness, opts.spill);
    const radius = (opts.softness / 100) * Math.max(w, h) / 1500;
    if (radius >= 0.3) alpha = blurEdges(alpha, w, h, radius);
    for (let i = 3, p = 0; i < d.length; i += 4, p++) {
      const a = alpha[p];
      if (a < d[i]) d[i] = a;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function hasTransparency(cv) {
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  }

  // Position du fond : cover (remplir), stretch (etirer), contain (bords blancs).
  function drawBackground(ctx, bg, w, h, mode) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (mode === 'stretch') {
      ctx.drawImage(bg, 0, 0, w, h);
      return;
    }
    if (mode === 'contain') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w / bg.width, h / bg.height);
      const dw = bg.width * s, dh = bg.height * s;
      ctx.drawImage(bg, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return;
    }
    const s = Math.max(w / bg.width, h / bg.height);
    const sw = w / s, sh = h / s;
    ctx.drawImage(bg, (bg.width - sw) / 2, (bg.height - sh) / 2, sw, sh, 0, 0, w, h);
  }

  // Fond deja ajuste a une taille donnee (a garder en memoire pour toute une seance).
  function fit(bg, w, h, mode) {
    const cv = new OffscreenCanvas(w, h);
    drawBackground(cv.getContext('2d'), bg, w, h, mode);
    return cv;
  }

  function compose(subject, bg, mode) {
    const w = subject.width, h = subject.height;
    const out = new OffscreenCanvas(w, h);
    const ctx = out.getContext('2d');
    if (bg) {
      drawBackground(ctx, bg, w, h, mode);
    } else {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(subject, 0, 0);
    return out;
  }

  return { keyPixels, extract, hasTransparency, fit, compose, blur, blurEdges };
})();
