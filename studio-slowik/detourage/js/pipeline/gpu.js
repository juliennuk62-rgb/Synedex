// Calculs pixel par pixel sur la carte graphique (WebGL2) : cle et couleurs du sujet.
// Memes formules que cle.js et despill.js ; a defaut de carte graphique (ou si elle est simulee
// par logiciel, plus lente que le processeur), le calcul reste sur le processeur.
var SL = self.SL = self.SL || {};
SL.dt = SL.dt || {};
SL.dt.gpu = (function () {
  const MIN_PIXELS = 4e6;  // en dessous (apercu), le processeur suffit
  let gl = null, essai = false, progCle = null, progCouleurs = null, nomCarte = '';
  const etat = { forcer: false, desactiver: false };

  const VS = `#version 300 es
  in vec2 pos; void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

  // Couleur du fond a un pixel : carte d'eclairage (filtrage lineaire = interpolation de fond.js).
  const FOND = `
  uniform sampler2D carte; uniform bool eclairage; uniform vec3 cle;
  vec3 fondA(ivec2 p, vec2 taille) { return eclairage ? texture(carte, (vec2(p) + 0.5) / taille).rgb : cle; }`;

  const FS_CLE = `#version 300 es
  precision highp float; precision highp int;
  uniform sampler2D img; uniform float noir, k, ombres; uniform int largeur;
  ${FOND}
  out vec4 o;
  float alphaPixel(ivec2 p, vec2 taille) {
    if (p.x >= largeur) return 0.0;
    vec3 c = floor(texelFetch(img, p, 0).rgb * 255.0 + 0.5);
    float r = c.r, g = c.g, b = c.b;
    if (g <= r || g <= b) return 1.0;
    vec3 B = fondA(p, taille);
    float s = g - max(r, b);
    float sb = max(B.g - max(B.r, B.b), 8.0);
    float a = 1.0 - s / sb;
    if (ombres > 0.0 && g < B.g && g > 0.0) {
      float wgt = min((g / B.g - 0.15) / 0.15, 1.0);
      if (wgt > 0.0) {
        float ar = 1.0 - (s * B.g) / (g * sb);
        if (ar < a) a += (ar - a) * wgt * ombres;
      }
    }
    return clamp((a - noir) * k, 0.0, 1.0);
  }
  void main() {
    vec2 taille = vec2(textureSize(img, 0));
    ivec2 q = ivec2(gl_FragCoord.xy);
    int x = q.x * 4;
    o = vec4(alphaPixel(ivec2(x, q.y), taille), alphaPixel(ivec2(x + 1, q.y), taille),
             alphaPixel(ivec2(x + 2, q.y), taille), alphaPixel(ivec2(x + 3, q.y), taille));
  }`;

  const FS_COULEURS = `#version 300 es
  precision highp float; precision highp int;
  uniform sampler2D img, alpha, prot, inter, pur;
  uniform bool avecProt, avecInter, decont, moyenne, demix;
  uniform float force, lumin, ext, amin; uniform int pas;
  ${FOND}
  out vec4 o;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 taille = vec2(textureSize(img, 0));
    vec3 c = floor(texelFetch(img, p, 0).rgb * 255.0 + 0.5);
    float a = floor(texelFetch(alpha, p, 0).r * 255.0 + 0.5);
    if (a == 0.0) { o = vec4(c / 255.0, 0.0); return; }
    float r = c.r, g = c.g, b = c.b;
    if (decont && a < 255.0) {
      vec3 B = fondA(p, taille);
      float af = max(a / 255.0, amin), inv = 1.0 - af;
      r = clamp((r - inv * B.r) / af, 0.0, 255.0);
      g = clamp((g - inv * B.g) / af, 0.0, 255.0);
      b = clamp((b - inv * B.b) / af, 0.0, 255.0);
    }
    float pr = avecProt ? floor(texelFetch(prot, p, 0).r * 255.0 + 0.5) : 0.0;
    float f = pr > 0.0 ? force * (1.0 - pr / 255.0) : force;
    vec4 ci = avecInter ? texelFetch(inter, p / pas, 0) : vec4(0.0);
    // melange sujet - fond pres du contour (voir despill.js)
    if (avecInter && demix && (a < 255.0 ? ci.a > 0.5 : ci.a > 1.5)) {
      vec3 F = texelFetch(pur, p / pas, 0).rgb, B = fondA(p, taille), d = F - B;
      float dd = dot(d, d);
      float wv = (g / max(max(r, b), 1.0) - F.g / max(max(F.r, F.b), 1.0)) / 0.06;
      if (dd > 900.0 && wv > 0.0) {
        vec3 cb = vec3(r, g, b) - B;
        float t = dot(cb, d) / dd;
        vec3 e = cb - t * d;
        float wgt = min(1.0, wv) * clamp((1.15 - t) / 0.15, 0.0, 1.0) * clamp((t - 0.1) / 0.1, 0.0, 1.0)
          * max(0.0, 1.0 - dot(e, e) / (0.25 * dd)) * f;
        if (wgt > 0.0) {
          float k = (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * F.r + 0.587 * F.g + 0.114 * F.b + 1.0);
          r += (min(255.0, F.r * k) - r) * wgt;
          g += (min(255.0, F.g * k) - g) * wgt;
          b += (min(255.0, F.b * k) - b) * wgt;
        }
      }
    }
    if (f > 0.0) {
      float lim = (moyenne && r <= g) ? (r + b) / 2.0 : max(r, b);
      if (g > lim) {
        float ex = (g - lim) * f;
        g -= ex;
        if (lumin > 0.0) { float add = ex * lumin; r = min(r + add, 255.0); g = min(g + add, 255.0); b = min(b + add, 255.0); }
      }
    }
    if (avecInter && f > 0.0 && (a < 255.0 ? ci.a > 0.5 : ci.a > 1.5)) {
      float mi = max(ci.r, ci.b), lim = max(r, b) * (mi > 1.0 ? max(ci.g / mi, 0.5) : 1.0);
      if (g > lim) g -= (g - lim) * f;
    }
    if (avecInter && a < 255.0) {
      if (ci.a > 0.5) {
        float kk = (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * ci.r + 0.587 * ci.g + 0.114 * ci.b + 1.0);
        float wgt = ext * (1.0 - a / 255.0);
        r += (min(255.0, ci.r * kk) - r) * wgt;
        g += (min(255.0, ci.g * kk) - g) * wgt;
        b += (min(255.0, ci.b * kk) - b) * wgt;
      }
    }
    o = vec4(vec3(r, g, b) / 255.0, a / 255.0);
  }`;

  function compiler(fs) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function initialiser() {
    if (essai) return !!gl;
    essai = true;
    try {
      if (typeof OffscreenCanvas === 'undefined') return false;
      const c = new OffscreenCanvas(1, 1);
      const g = c.getContext('webgl2', { antialias: false, depth: false, preserveDrawingBuffer: false });
      if (!g || !g.getExtension('EXT_color_buffer_float')) return false;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      nomCarte = dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      gl = g;
      progCle = compiler(FS_CLE);
      progCouleurs = compiler(FS_COULEURS);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      return true;
    } catch (e) {
      gl = null;
      return false;
    }
  }

  const logiciel = () => /swiftshader|software|llvmpipe|microsoft basic/i.test(nomCarte);

  // La carte graphique est-elle utile pour une image de w x h ?
  function utile(w, h) {
    if (etat.desactiver || !initialiser()) return false;
    if (!etat.forcer && (w * h < MIN_PIXELS || logiciel())) return false;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return w <= max && h <= max;
  }

  function texture(unite, w, h, interne, format, type, data, lineaire) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unite);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lineaire ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lineaire ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, interne, w, h, 0, format, type, data);
    return t;
  }

  function uniformsFond(prog, an, p) {
    gl.uniform1i(gl.getUniformLocation(prog, 'carte'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'eclairage'), p.eclairage && (an.gw || 1) * (an.gh || 1) > 1 ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(prog, 'cle'), an.cle[0], an.cle[1], an.cle[2]);
  }

  // Carte d'eclairage en texture 16 bits flottants : le filtrage lineaire de la carte graphique
  // reproduit l'interpolation de fond.js (centres des cellules, bords bloques).
  function carteFondLineaire(an) {
    const gw = an.gw || 1, gh = an.gh || 1, n = gw * gh;
    const d = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { d[i * 4] = an.map[i * 3]; d[i * 4 + 1] = an.map[i * 3 + 1]; d[i * 4 + 2] = an.map[i * 3 + 2]; d[i * 4 + 3] = 1; }
    return texture(1, gw, gh, gl.RGBA16F, gl.RGBA, gl.FLOAT, d, true);
  }

  function dessiner(fbTex, w, h) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return fb;
  }

  function nettoyer(textures, fb) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (fb) gl.deleteFramebuffer(fb);
    textures.forEach(t => t && gl.deleteTexture(t));
  }

  // Masque de la cle (Uint8Array w*h), ou null si la carte graphique ne convient pas.
  function cle(rgba, w, h, an, p) {
    if (!utile(w, h)) return null;
    const { noir, blanc } = SL.dt.cle.seuils(p);
    const lw = Math.ceil(w / 4);
    const tImg = texture(0, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const tCarte = carteFondLineaire(an);
    const tOut = texture(2, lw, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.useProgram(progCle);
    gl.uniform1i(gl.getUniformLocation(progCle, 'img'), 0);
    uniformsFond(progCle, an, p);
    gl.uniform1f(gl.getUniformLocation(progCle, 'noir'), noir);
    gl.uniform1f(gl.getUniformLocation(progCle, 'k'), 1 / (blanc - noir));
    gl.uniform1f(gl.getUniformLocation(progCle, 'ombres'), p.ombres / 100);
    gl.uniform1i(gl.getUniformLocation(progCle, 'largeur'), w);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const fb = dessiner(tOut, lw, h);
    const out = new Uint8Array(lw * 4 * h);
    gl.readPixels(0, 0, lw, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    nettoyer([tImg, tCarte, tOut], fb);
    if (lw * 4 === w) return out;
    const a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) a.set(out.subarray(y * lw * 4, y * lw * 4 + w), y * w);
    return a;
  }

  // Couleurs du sujet (ecrit dans rgba), ou false si la carte graphique ne convient pas.
  // I : couleur interieure (voir despill.js), prot : zones protegees.
  function couleurs(rgba, alpha, w, h, an, p, prot, I, amin) {
    if (!utile(w, h)) return false;
    const tImg = texture(0, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const tCarte = carteFondLineaire(an);
    const tAlpha = texture(2, w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, alpha);
    const tProt = texture(3, prot ? w : 1, prot ? h : 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, prot || new Uint8Array(1));
    let tInter = null, tPur = null;
    if (I) {
      const gh = I.col.length / 3 / I.gw;
      const d = new Float32Array(I.gw * gh * 4);
      for (let i = 0; i < I.gw * gh; i++) { d[i * 4] = I.col[i * 3]; d[i * 4 + 1] = I.col[i * 3 + 1]; d[i * 4 + 2] = I.col[i * 3 + 2]; d[i * 4 + 3] = I.ok[i]; }
      tInter = texture(4, I.gw, gh, gl.RGBA32F, gl.RGBA, gl.FLOAT, d, false);
      const dp = new Float32Array(I.gw * gh * 4);
      for (let i = 0; i < I.gw * gh; i++) { dp[i * 4] = I.pur[i * 3]; dp[i * 4 + 1] = I.pur[i * 3 + 1]; dp[i * 4 + 2] = I.pur[i * 3 + 2]; dp[i * 4 + 3] = 1; }
      tPur = texture(6, I.gw, gh, gl.RGBA32F, gl.RGBA, gl.FLOAT, dp, false);
    } else {
      texture(4, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      texture(6, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    const tOut = texture(5, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const P = progCouleurs;
    gl.useProgram(P);
    const u = n => gl.getUniformLocation(P, n);
    gl.uniform1i(u('img'), 0); gl.uniform1i(u('alpha'), 2); gl.uniform1i(u('prot'), 3); gl.uniform1i(u('inter'), 4); gl.uniform1i(u('pur'), 6);
    uniformsFond(P, an, p);
    gl.uniform1i(u('avecProt'), prot ? 1 : 0);
    gl.uniform1i(u('avecInter'), I ? 1 : 0);
    gl.uniform1i(u('decont'), p.decontamination ? 1 : 0);
    gl.uniform1i(u('moyenne'), p.methode === 'moyenne' ? 1 : 0);
    gl.uniform1i(u('demix'), p.decontamination && p.reflet > 0 && p.demixage !== false ? 1 : 0);
    gl.uniform1f(u('force'), p.reflet / 100);
    gl.uniform1f(u('lumin'), (p.luminosite / 100) * 0.587);
    gl.uniform1f(u('ext'), (p.bords || 0) / 100);
    gl.uniform1f(u('amin'), amin);
    gl.uniform1i(u('pas'), I ? I.s : 1);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const fb = dessiner(tOut, w, h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    nettoyer([tImg, tCarte, tAlpha, tProt, tInter, tPur, tOut], fb);
    return true;
  }

  return { cle, couleurs, utile, etat, carte: () => nomCarte };
})();
