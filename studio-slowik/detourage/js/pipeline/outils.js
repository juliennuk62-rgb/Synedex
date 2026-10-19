// Outils de calcul du detourage : flou en boite, filtres mini / maxi, zones connexes.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.outils = (function () {
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Moyenne sur une fenetre (2r+1) x (2r+1), bords etendus. src et dst : Float32Array (w*h).
  function boxMean(src, dst, tmp, w, h, r) {
    const inv = 1 / (2 * r + 1);
    const lastX = w - 1, lastY = h - 1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[o + (k < 0 ? 0 : k > lastX ? lastX : k)];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = acc * inv;
        const add = x + r + 1 > lastX ? lastX : x + r + 1;
        const sub = x - r < 0 ? 0 : x - r;
        acc += src[o + add] - src[o + sub];
      }
    }
    const acc = new Float64Array(w);
    for (let k = -r; k <= r; k++) {
      const o = (k < 0 ? 0 : k > lastY ? lastY : k) * w;
      for (let x = 0; x < w; x++) acc[x] += tmp[o + x];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) dst[o + x] = acc[x] * inv;
      const ao = (y + r + 1 > lastY ? lastY : y + r + 1) * w;
      const so = (y - r < 0 ? 0 : y - r) * w;
      for (let x = 0; x < w; x++) acc[x] += tmp[ao + x] - tmp[so + x];
    }
  }

  // Filtre mini (erosion) ou maxi (dilatation) sur une fenetre carree (2r+1), bords etendus.
  // Algorithme de van Herk / Gil-Werman : 3 comparaisons par pixel, quel que soit le rayon.
  // La passe verticale travaille ligne par ligne (rapide en memoire).
  function minMax(src, w, h, r, isMax) {
    if (r < 1) return new Uint8Array(src);
    const k = 2 * r + 1;
    const op = isMax ? (a, b) => (a > b ? a : b) : (a, b) => (a < b ? a : b);
    const mid = new Uint8Array(w * h);
    // horizontal
    const n = w + 2 * r;
    const P = new Uint8Array(n), g = new Uint8Array(n), hh = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let i = 0; i < n; i++) { const x = i - r; P[i] = src[o + (x < 0 ? 0 : x >= w ? w - 1 : x)]; }
      for (let i = 0; i < n; i++) g[i] = i % k === 0 ? P[i] : op(g[i - 1], P[i]);
      for (let i = n - 1; i >= 0; i--) hh[i] = (i % k === k - 1 || i === n - 1) ? P[i] : op(hh[i + 1], P[i]);
      for (let x = 0; x < w; x++) mid[o + x] = op(hh[x], g[x + k - 1]);
    }
    // vertical, par lignes entieres
    const m = h + 2 * r;
    const G = new Uint8Array(m * w), H = new Uint8Array(m * w);
    const row = i => { const y = i - r; return (y < 0 ? 0 : y >= h ? h - 1 : y) * w; };
    for (let i = 0; i < m; i++) {
      const so = row(i), go = i * w;
      if (i % k === 0) G.set(mid.subarray(so, so + w), go);
      else for (let x = 0; x < w; x++) G[go + x] = op(G[go - w + x], mid[so + x]);
    }
    for (let i = m - 1; i >= 0; i--) {
      const so = row(i), ho = i * w;
      if (i % k === k - 1 || i === m - 1) H.set(mid.subarray(so, so + w), ho);
      else for (let x = 0; x < w; x++) H[ho + x] = op(H[ho + w + x], mid[so + x]);
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w, ho = y * w, go = (y + k - 1) * w;
      for (let x = 0; x < w; x++) out[o + x] = op(H[ho + x], G[go + x]);
    }
    return out;
  }

  // Zones connexes (8 voisins) des pixels dont la valeur est dans [lo, hi].
  // Travail par segments de ligne : peu de memoire meme sur 45 Mpx.
  function zones(alpha, w, h, lo, hi) {
    let cap = 1 << 15;
    let X0 = new Int32Array(cap), X1 = new Int32Array(cap), Y = new Int32Array(cap);
    let n = 0;
    const rowStart = new Int32Array(h + 1);
    for (let y = 0; y < h; y++) {
      rowStart[y] = n;
      const o = y * w;
      let x = 0;
      while (x < w) {
        const v = alpha[o + x];
        if (v < lo || v > hi) { x++; continue; }
        const s = x;
        while (x < w && alpha[o + x] >= lo && alpha[o + x] <= hi) x++;
        if (n === cap) {
          cap *= 2;
          const a = new Int32Array(cap); a.set(X0); X0 = a;
          const b = new Int32Array(cap); b.set(X1); X1 = b;
          const c = new Int32Array(cap); c.set(Y); Y = c;
        }
        X0[n] = s; X1[n] = x - 1; Y[n] = y; n++;
      }
    }
    rowStart[h] = n;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let y = 1; y < h; y++) {
      let j = rowStart[y - 1];
      const endPrev = rowStart[y];
      for (let i = rowStart[y]; i < rowStart[y + 1]; i++) {
        while (j < endPrev && X1[j] + 1 < X0[i]) j++;
        for (let q = j; q < endPrev && X0[q] <= X1[i] + 1; q++) {
          const a = find(i), b = find(q);
          if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
        }
      }
    }
    const area = new Float64Array(n);
    const border = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const root = find(i);
      parent[i] = root;
      area[root] += X1[i] - X0[i] + 1;
      if (Y[i] === 0 || Y[i] === h - 1 || X0[i] === 0 || X1[i] === w - 1) border[root] = 1;
    }
    return { n, X0, X1, Y, root: parent, area, border };
  }

  // Remplit d'une valeur les segments des zones retenues par `keep(root)`.
  function fillZones(alpha, w, z, test, value) {
    let count = 0;
    for (let i = 0; i < z.n; i++) {
      const root = z.root[i];
      if (!test(z.area[root], z.border[root])) continue;
      alpha.fill(value, z.Y[i] * w + z.X0[i], z.Y[i] * w + z.X1[i] + 1);
      count += z.X1[i] - z.X0[i] + 1;
    }
    return count;
  }

  return { clamp01, boxMean, minMax, zones, fillZones };
})();
