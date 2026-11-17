/* =====================================================================
   CALAGE AUTOMATIQUE D'UNE PHOTO SUR SES VOISINES
   ---------------------------------------------------------------------
   Problème : la position GPS, la hauteur et le cap d'un drone sont
   approximatifs (quelques mètres, quelques degrés). Un dessin fait sur
   une photo tombe donc à côté sur la photo voisine.

   Idée : on connaît la position approximative des deux photos. On
   "redresse" la photo voisine A pour qu'elle ressemble à la photo B
   (comme si on la regardait depuis B, sur un sol plat). Si les poses
   étaient exactes, les deux images se superposeraient. Elles sont un peu
   décalées : on mesure ce décalage en plusieurs endroits, puis on
   cherche le petit réglage de la pose de B (cap, inclinaison, position,
   hauteur) qui l'annule.

   Aucune bibliothèque : tout est calculé ici, sur des images réduites.
   ===================================================================== */

import { makeCamera } from './photoproj.js';

const W = 480;       // largeur des images de travail (passages 1 et 2) ; le 3e passage affine en 900 px
const W3 = 900;
const MAXD = 250;    // au-delà (mètres) le sol n'est plus fiable
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pause = () => new Promise(r => setTimeout(r, 0)); // laisse l'écran respirer

// Image -> niveaux de gris, à la taille de travail
export function gray(img, W) {
  const w = W, h = Math.round(W * img.naturalHeight / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; }
  return { g: g, w: w, h: h };
}
function sample(im, x, y) {
  if (x < 0 || y < 0 || x > im.w - 1.001 || y > im.h - 1.001) { return -1; }
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * im.w + x0;
  return im.g[i] * (1 - fx) * (1 - fy) + im.g[i + 1] * fx * (1 - fy) + im.g[i + im.w] * (1 - fx) * fy + im.g[i + im.w + 1] * fx * fy;
}

// La photo de référence A vue depuis la pose de B : image redressée + sol touché par chaque pixel
export function warp(A, B, camA, camB) {
  const aw = new Float32Array(B.w * B.h).fill(-1), gl = new Float64Array(B.w * B.h * 2).fill(NaN);
  let ok = 0;
  for (let y = 0; y < B.h; y++) {
    for (let x = 0; x < B.w; x++) {
      const g = camB.toGround(x, y);
      if (!g || Math.hypot(g.e - camB.pos[0], g.n - camB.pos[1]) > MAXD) { continue; }
      const p = camA.toPixel(g.lat, g.lon, 0);
      if (!p) { continue; }
      const v = sample(A, p.x, p.y);
      if (v < 0) { continue; }
      const i = y * B.w + x;
      aw[i] = v; gl[i * 2] = g.lat; gl[i * 2 + 1] = g.lon; ok++;
    }
  }
  return { aw: aw, gl: gl, ok: ok };
}

/* Mesure le décalage : pour chaque point d'une grille, on cherche où le petit carré de l'image redressée
   ressemble le plus à l'image B (corrélation normalisée), dans une fenêtre de ±S pixels. */
export function track(Wp, B, S, TT, ST) {
  const T = TT || 21, STEP = ST || 24;
  const r = (T - 1) / 2, w = B.w, h = B.h, out = [];
  // sommes cumulées de B et B² : la moyenne et la variance d'une fenêtre se lisent en 4 additions
  const I1 = new Float64Array((w + 1) * (h + 1)), I2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let s1 = 0, s2 = 0;
    for (let x = 0; x < w; x++) {
      const v = B.g[y * w + x]; s1 += v; s2 += v * v;
      I1[(y + 1) * (w + 1) + x + 1] = I1[y * (w + 1) + x + 1] + s1;
      I2[(y + 1) * (w + 1) + x + 1] = I2[y * (w + 1) + x + 1] + s2;
    }
  }
  const box = (I, x0, y0, x1, y1) => I[(y1 + 1) * (w + 1) + x1 + 1] - I[y0 * (w + 1) + x1 + 1] - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  const tpl = new Float32Array(T * T), side = 2 * S + 1, score = new Float32Array(side * side);
  for (let y = S + r; y < h - r - S; y += STEP) {
    for (let x = S + r; x < w - r - S; x += STEP) {
      // le carré doit être entièrement valide
      let good = true, mean = 0;
      for (let j = -r; j <= r && good; j++) { for (let i = -r; i <= r; i++) { const v = Wp.aw[(y + j) * w + x + i]; if (v < 0) { good = false; break; } mean += v; } }
      if (!good) { continue; }
      mean /= T * T;
      let n2 = 0;
      for (let j = 0; j < T; j++) { for (let i = 0; i < T; i++) { const v = Wp.aw[(y - r + j) * w + x - r + i] - mean; tpl[j * T + i] = v; n2 += v * v; } }
      if (Math.sqrt(n2 / (T * T)) < 8) { continue; } // trop uni (ciel, champ lisse) : rien à mesurer
      const tn = Math.sqrt(n2);
      let best = -2, bx = 0, by = 0;
      for (let dy = -S; dy <= S; dy++) {
        for (let dx = -S; dx <= S; dx++) {
          const cx = x + dx, cy = y + dy;
          let num = 0;
          for (let j = 0; j < T; j++) {
            const row = (cy - r + j) * w + cx - r;
            for (let i = 0; i < T; i++) { num += tpl[j * T + i] * B.g[row + i]; }
          }
          const s1 = box(I1, cx - r, cy - r, cx + r, cy + r), s2 = box(I2, cx - r, cy - r, cx + r, cy + r);
          const vr = s2 - s1 * s1 / (T * T);
          const sc = vr > 1 ? num / (tn * Math.sqrt(vr)) : -1;
          score[(dy + S) * side + dx + S] = sc;
          if (sc > best) { best = sc; bx = dx; by = dy; }
        }
      }
      if (best < 0.55) { continue; }
      // un deuxième pic presque aussi fort, loin du premier : mesure ambiguë
      let second = -2;
      for (let dy = -S; dy <= S; dy++) { for (let dx = -S; dx <= S; dx++) { if (Math.abs(dx - bx) + Math.abs(dy - by) > 5) { const v = score[(dy + S) * side + dx + S]; if (v > second) { second = v; } } } }
      if (best - second < 0.03) { continue; }
      out.push({ lat: Wp.gl[(y * w + x) * 2], lon: Wp.gl[(y * w + x) * 2 + 1], qx: x + bx, qy: y + by, sc: best });
    }
  }
  return out;
}

/* Cherche le petit réglage de B (cap, inclinaison, décalage est / nord, hauteur) qui ramène chaque point du sol
   sur l'endroit mesuré. Moindres carrés avec pondération qui écarte les mesures aberrantes (arbres, véhicules...). */
export function fit(photoB, size, pts, a0) {
  const names = ['yaw', 'pitch', 'e', 'n', 'z'], scale = [1, 1, 1, 1, 1];
  const resid = function (x) {
    const adj = Object.assign({}, a0);
    names.forEach((k, i) => { adj[k] = a0[k] + x[i]; });
    const cam = makeCamera(Object.assign({}, photoB, { adj: adj }), size), out = [];
    pts.forEach(function (q) {
      const p = cam ? cam.toPixel(q.lat, q.lon, 0) : null;
      out.push(p ? p.x - q.qx : 300, p ? p.y - q.qy : 300);
    });
    return out;
  };
  let x = [0, 0, 0, 0, 0];
  for (let outer = 0; outer < 12; outer++) {
    const r = resid(x), wts = [];
    for (let i = 0; i < r.length; i += 2) { const d = Math.hypot(r[i], r[i + 1]), k = 2.5; const wv = d <= k ? 1 : k / d; wts.push(wv, wv); }
    const J = [];
    for (let j = 0; j < 5; j++) {
      const y = x.slice(), h = j < 2 ? 0.05 : 0.1;
      y[j] += h;
      const r2 = resid(y);
      J.push(r2.map((v, i) => (v - r[i]) / h));
    }
    // équations normales (5×5) avec un léger rappel vers zéro pour éviter les dérives
    const A = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, k) => J[i].reduce((t, v, m) => t + v * J[k][m] * wts[m], 0) + (i === k ? 0.5 : 0)));
    const b = J.map((row, i) => -row.reduce((t, v, m) => t + v * r[m] * wts[m], 0) - 0.5 * x[i] * 0);
    for (let i = 0; i < 5; i++) {
      let m = i;
      for (let j = i + 1; j < 5; j++) { if (Math.abs(A[j][i]) > Math.abs(A[m][i])) { m = j; } }
      [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) { continue; }
      for (let j = i + 1; j < 5; j++) { const f = A[j][i] / A[i][i]; for (let l = i; l < 5; l++) { A[j][l] -= f * A[i][l]; } b[j] -= f * b[i]; }
    }
    const d = [0, 0, 0, 0, 0];
    for (let i = 4; i >= 0; i--) { let t = b[i]; for (let j = i + 1; j < 5; j++) { t -= A[i][j] * d[j]; } d[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : t / A[i][i]; }
    // pas limité : on avance prudemment
    let step = 1;
    const mx = Math.max(Math.abs(d[0]) / 3, Math.abs(d[1]) / 3, Math.abs(d[2]) / 6, Math.abs(d[3]) / 6, Math.abs(d[4]) / 6);
    if (mx > 1) { step = 1 / mx; }
    x = x.map((v, i) => v + d[i] * step);
    if (Math.max(...d.map(Math.abs)) * step < 1e-3) { break; }
  }
  const r = resid(x), dist = [];
  for (let i = 0; i < r.length; i += 2) { dist.push(Math.hypot(r[i], r[i + 1])); }
  dist.sort((a, b) => a - b);
  const adj = Object.assign({}, a0);
  names.forEach((k, i) => { adj[k] = a0[k] + x[i]; });
  return { adj: adj, med: dist[dist.length >> 1] || 999, delta: x, res: r };
}

/* Cale la photo B sur les photos de référence.
   opt = {
     photo : la pose de B (avec ses réglages actuels dans photo.adj),
     img   : l'image de B (déjà chargée),
     refs  : [{ photo, img }]   les photos voisines (leurs réglages sont gardés tels quels),
     onProgress(texte)
   }
   Renvoie { adj, n, med, refs } ou { error } si le calage n'est pas assez sûr. */
export async function autoCalibrate(opt) {
  const say = opt.onProgress || (() => {});
  let B = gray(opt.img, W), sizeB = { w: B.w, h: B.h };
  let refs = opt.refs.map(r => ({ photo: r.photo, img: r.img, im: gray(r.img, W) }));
  let adj = Object.assign({ yaw: 0, pitch: 0, roll: 0, e: 0, n: 0, z: 0, zoom: 1 }, opt.photo.adj || {});
  const adj0 = Object.assign({}, adj);
  let total = 0, med = 999, inl = 0;
  for (let pass = 0; pass < 3; pass++) {
    const S = pass === 0 ? 44 : pass === 1 ? 20 : 14; // large recherche, puis affinages
    if (pass === 2) { B = gray(opt.img, W3); sizeB = { w: B.w, h: B.h }; refs.forEach(r => { r.im = gray(r.img, W3); }); }
    let camB = makeCamera(Object.assign({}, opt.photo, { adj: adj }), sizeB);
    if (!camB) { return { error: 'Cette photo n’a pas de position ou de direction.' }; }
    if (pass === 0 && isNadir(Object.assign({}, opt.photo, { adj: adj }))) {
      say('Vue de dessus : recherche du bon cap…');
      await pause();
      const votes = {};
      refs.forEach(function (r) {
        const ca = makeCamera(r.photo, { w: r.im.w, h: r.im.h });
        if (ca) { const dy = bestYaw(r.im, B, ca, opt.photo, adj, 30, 21, 24); votes[dy] = (votes[dy] || 0) + 1; }
      });
      let pick = 0, mx = 0; for (const k in votes) { if (votes[k] > mx) { mx = votes[k]; pick = +k; } }
      if (pick) { adj = Object.assign({}, adj, { yaw: adj.yaw + pick }); camB = makeCamera(Object.assign({}, opt.photo, { adj: adj }), sizeB); }
    }
    const pts = [];
    for (let k = 0; k < refs.length; k++) {
      say('Calage automatique : photo voisine ' + (k + 1) + '/' + refs.length + (pass ? ' (affinage ' + pass + ')' : '') + '…');
      await pause();
      const camA = makeCamera(refs[k].photo, { w: refs[k].im.w, h: refs[k].im.h });
      if (!camA) { continue; }
      const wp = warp(refs[k].im, B, camA, camB);
      if (wp.ok < B.w * B.h * 0.05) { continue; } // les deux photos ne regardent pas le même endroit
      await pause();
      pts.push(...track(wp, B, S));
    }
    if (pts.length < 10) { return { error: 'Pas assez de détails communs avec les photos voisines (' + pts.length + ' points).' }; }
    let f = fit(opt.photo, sizeB, pts, adj);
    // Beaucoup de mesures fausses (arbres, bâtiments, vue de dessus contre vue rasante) : on ne garde que les 45 %
    // qui s'accordent le mieux, puis on recale sur celles-là.
    const dd = [];
    for (let i = 0; i < pts.length; i++) { dd.push([Math.hypot(f.res[2 * i], f.res[2 * i + 1]), i]); }
    dd.sort((a, b) => a[0] - b[0]);
    const keep = Math.max(15, Math.floor(pts.length * 0.45));
    if (f.med > 3 && pts.length >= 33) {
      const sub = dd.slice(0, keep).map(x => pts[x[1]]);
      f = fit(opt.photo, sizeB, sub, adj);
      const all = [];
      pts.forEach(q => {
        const c = makeCamera(Object.assign({}, opt.photo, { adj: f.adj }), sizeB), pp = c ? c.toPixel(q.lat, q.lon, 0) : null;
        all.push(pp ? Math.hypot(pp.x - q.qx, pp.y - q.qy) : 999);
      });
      all.sort((a, b) => a - b);
      f.med = all[keep >> 1]; // écart typique des points retenus
      inl = all.filter(v => v < 4).length;
    } else { inl = pts.length; }
    adj = f.adj; med = f.med; total = pts.length;
  }
  // garde-fous : si le résultat reste incertain ou extrême, on ne touche à rien
  const d = { yaw: adj.yaw - adj0.yaw, pitch: adj.pitch - adj0.pitch, e: adj.e - adj0.e, n: adj.n - adj0.n, z: adj.z - adj0.z };
  if (inl < 20) { return { error: 'Pas assez de points communs fiables avec les photos voisines (' + inl + ').' }; }
  if (med > 9) { return { error: 'Les photos se ressemblent trop peu pour un calage sûr (écart restant ' + med.toFixed(1) + ' px).' }; }
  if (Math.abs(d.yaw) > 12 || Math.abs(d.pitch) > 12 || Math.hypot(d.e, d.n) > 25 || Math.abs(d.z) > 25) { return { error: 'Le réglage trouvé est trop grand pour être crédible.' }; }
  adj.yaw = clamp(adj.yaw, -60, 60); adj.pitch = clamp(adj.pitch, -40, 40);
  return { adj: adj, n: total, med: med, delta: d };
}

// Distance en mètres entre deux photos (pour choisir les voisines)
export function distance(a, b) {
  const k = Math.PI / 180, R = 6371008.8;
  return Math.hypot((a.lon - b.lon) * k * R * Math.cos(a.lat * k), (a.lat - b.lat) * k * R);
}

/* Vue de dessus : le cap d'un drone qui regarde à la verticale est souvent faux de plusieurs degrés (confusion
   cap / roulis), et les photos ne se superposent plus. On essaie plusieurs rotations de la photo B et on garde
   celle qui donne les points communs les plus nets. Renvoie l'écart de cap (en degrés) à ajouter à B. */
export function isNadir(photo) { return photo && photo.pitch != null && photo.pitch + ((photo.adj && photo.adj.pitch) || 0) < -70; }
export function bestYaw(A, B, camA, photoB, adj, S, T, STEP) {
  let best = 0, bestScore = -1;
  [0, -8, 8, -16, 16, -26, 26].forEach(function (dy) {
    const cam = makeCamera(Object.assign({}, photoB, { adj: Object.assign({}, adj, { yaw: (adj.yaw || 0) + dy }) }), { w: B.w, h: B.h });
    if (!cam) { return; }
    const wp = warp(A, B, camA, cam);
    if (wp.ok < B.w * B.h * 0.05) { return; }
    const pts = track(wp, B, S, T, STEP);
    let sc = 0;
    pts.forEach(q => { sc += q.sc - 0.5; });
    if (sc > bestScore + 0.5 || (sc > bestScore && dy === 0)) { bestScore = sc; best = dy; }
  });
  return best;
}
