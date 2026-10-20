// Resolution (dpi) et profil couleur : lus sur la photo d'origine, reecrits dans les fichiers
// exportes (le navigateur les perd en enregistrant une image).
// JPEG : JFIF / Exif / ICC_PROFILE. PNG : pHYs / iCCP. TIFF : etiquettes 282, 296, 34675.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.meta = (function () {
  const ascii = (d, o, n) => String.fromCharCode(...d.subarray(o, o + n));

  async function inflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function deflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // Resolution dans un bloc TIFF / Exif (etiquettes 282 XResolution, 296 ResolutionUnit).
  function dpiTiff(d, base) {
    const le = ascii(d, base, 2) === 'II';
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const u16 = o => v.getUint16(base + o, le), u32 = o => v.getUint32(base + o, le);
    const ifd = u32(4), n = u16(ifd);
    let res = 0, unit = 2;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, tag = u16(e);
      if (tag === 282) { const off = u32(e + 8); const den = u32(off + 4); res = den ? u32(off) / den : 0; }
      if (tag === 296) unit = u16(e + 8);
    }
    if (!res) return null;
    return unit === 3 ? res * 2.54 : unit === 1 ? null : res;
  }

  function lireJpeg(d) {
    let dpi = null, dpiExif = null;
    const icc = [];
    let o = 2;
    while (o + 4 < d.length && d[o] === 0xff) {
      const m = d[o + 1];
      if (m === 0xda || m === 0xd9) break; // debut de l'image : plus de metadonnees
      const len = (d[o + 2] << 8) | d[o + 3];
      const s = o + 4;
      if (m === 0xe0 && ascii(d, s, 5) === 'JFIF\0') {
        const units = d[s + 7], x = (d[s + 8] << 8) | d[s + 9];
        if (x && units === 1) dpi = x;
        if (x && units === 2) dpi = x * 2.54;
      }
      if (m === 0xe1 && ascii(d, s, 6) === 'Exif\0\0') { try { dpiExif = dpiTiff(d, s + 6); } catch (e) { /* Exif abime */ } }
      if (m === 0xe2 && ascii(d, s, 12) === 'ICC_PROFILE\0') icc.push({ n: d[s + 12], data: d.subarray(s + 14, o + 2 + len) });
      o += 2 + len;
    }
    icc.sort((a, b) => a.n - b.n);
    let profil = null;
    if (icc.length) {
      profil = new Uint8Array(icc.reduce((t, c) => t + c.data.length, 0));
      let p = 0;
      for (const c of icc) { profil.set(c.data, p); p += c.data.length; }
    }
    return { dpi: dpiExif || dpi, icc: profil };
  }

  async function lirePng(d) {
    let dpi = null, icc = null, o = 8;
    while (o + 8 <= d.length) {
      const len = new DataView(d.buffer, d.byteOffset + o).getUint32(0);
      const type = ascii(d, o + 4, 4), s = o + 8;
      if (type === 'pHYs' && d[s + 8] === 1) dpi = new DataView(d.buffer, d.byteOffset + s).getUint32(0) * 0.0254;
      if (type === 'iCCP') {
        let z = s;
        while (d[z] !== 0 && z < s + 80) z++;
        try { icc = await inflate(d.subarray(z + 2, s + len)); } catch (e) { /* profil abime */ }
      }
      if (type === 'IDAT' || type === 'IEND') break;
      o = s + len + 4;
    }
    return { dpi, icc };
  }

  function lireTiff(d) {
    if (!self.UTIF) return { dpi: null, icc: null };
    const ifd = UTIF.decode(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))[0] || {};
    let dpi = ifd.t282 ? Number(ifd.t282[0]) : null;
    const unit = ifd.t296 ? ifd.t296[0] : 2;
    if (dpi && unit === 3) dpi *= 2.54;
    if (unit === 1) dpi = null;
    const icc = ifd.t34675 ? Uint8Array.from(ifd.t34675) : null;
    return { dpi, icc };
  }

  // { dpi, icc (Uint8Array ou null), srgb (profil sRGB ou absent), tiff }
  async function lire(file) {
    const tete = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    let r = { dpi: null, icc: null };
    const tiff = (tete[0] === 0x49 && tete[1] === 0x49) || (tete[0] === 0x4d && tete[1] === 0x4d);
    try {
      if (tete[0] === 0xff && tete[1] === 0xd8) r = lireJpeg(new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer()));
      else if (tete[0] === 0x89 && tete[1] === 0x50) r = await lirePng(new Uint8Array(await file.arrayBuffer()));
      else if (tiff) r = lireTiff(new Uint8Array(await file.arrayBuffer()));
    } catch (e) { /* metadonnees illisibles : on continue sans */ }
    const desc = r.icc ? ascii(r.icc, 0, Math.min(r.icc.length, 600)) : '';
    if (r.dpi) r.dpi = Math.round(r.dpi * 100) / 100;
    return Object.assign(r, { srgb: !r.icc || /sRGB/.test(desc), tiff });
  }

  // --- ecriture -----------------------------------------------------------------------
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // PNG : nos blocs pHYs / iCCP remplacent ceux du navigateur (et sRGB, gAMA, cHRM s'il y a un profil).
  async function ecrirePng(d, meta) {
    const ajouts = [];
    if (meta.dpi) {
      const p = new Uint8Array(9), v = new DataView(p.buffer), ppm = Math.round(meta.dpi / 0.0254);
      v.setUint32(0, ppm); v.setUint32(4, ppm); p[8] = 1;
      ajouts.push(chunk('pHYs', p));
    }
    if (meta.icc) {
      const nom = 'ICC Profile';
      const z = await deflate(meta.icc);
      const p = new Uint8Array(nom.length + 2 + z.length);
      for (let i = 0; i < nom.length; i++) p[i] = nom.charCodeAt(i);
      p.set(z, nom.length + 2);
      ajouts.push(chunk('iCCP', p));
    }
    if (!ajouts.length) return null;
    const retirer = new Set(meta.dpi ? ['pHYs'] : []);
    if (meta.icc) ['iCCP', 'sRGB', 'gAMA', 'cHRM'].forEach(t => retirer.add(t));
    const parts = [d.subarray(0, 8)];
    let o = 8;
    while (o + 8 <= d.length) {
      const len = new DataView(d.buffer, d.byteOffset + o).getUint32(0), type = ascii(d, o + 4, 4), fin = o + 12 + len;
      if (!retirer.has(type)) parts.push(d.subarray(o, fin));
      if (type === 'IHDR') parts.push(...ajouts);
      o = fin;
    }
    return parts;
  }

  // JPEG : notre JFIF (dpi) et nos blocs ICC_PROFILE remplacent ceux du navigateur.
  function ecrireJpeg(d, meta) {
    const dpi = Math.max(1, Math.min(65535, Math.round(meta.dpi || 72)));
    const parts = [d.subarray(0, 2), new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, meta.dpi ? 1 : 0,
      dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0])];
    if (meta.icc) {
      const MAX = 65519, n = Math.ceil(meta.icc.length / MAX);
      for (let i = 0; i < n; i++) {
        const data = meta.icc.subarray(i * MAX, (i + 1) * MAX);
        const len = data.length + 16;
        const h = new Uint8Array(18);
        h.set([0xff, 0xe2, len >> 8, len & 255]);
        for (let k = 0; k < 12; k++) h[4 + k] = 'ICC_PROFILE\0'.charCodeAt(k);
        h[16] = i + 1; h[17] = n;
        parts.push(h, data);
      }
    }
    let o = 2;
    while (o + 4 < d.length && d[o] === 0xff) {
      const m = d[o + 1];
      if (m === 0xda) break; // debut de l'image : la suite est recopiee telle quelle
      const len = (d[o + 2] << 8) | d[o + 3], s = o + 4;
      const jfif = m === 0xe0 && ascii(d, s, 5) === 'JFIF\0';
      const icc = m === 0xe2 && ascii(d, s, 12) === 'ICC_PROFILE\0';
      if (!jfif && !(icc && meta.icc)) parts.push(d.subarray(o, o + 2 + len));
      o += 2 + len;
    }
    parts.push(d.subarray(o));
    return parts;
  }

  // Blob exporte (PNG ou JPEG) avec dpi et profil ; autres formats : inchange.
  async function ecrire(blob, meta) {
    if (!meta || (!meta.dpi && !meta.icc)) return blob;
    const d = new Uint8Array(await blob.arrayBuffer());
    let parts = null;
    if (blob.type === 'image/png') parts = await ecrirePng(d, meta);
    else if (blob.type === 'image/jpeg') parts = ecrireJpeg(d, meta);
    return parts ? new Blob(parts, { type: blob.type }) : blob;
  }

  return { lire, ecrire, crc32 };
})();
