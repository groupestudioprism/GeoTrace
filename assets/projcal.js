/* =====================================================================
   CALAGE DE TOUT LE PROJET (nuage de points commun)
   ---------------------------------------------------------------------
   Au lieu de caler une photo à la fois, on compare TOUTES les photos
   voisines entre elles. Chaque détail retrouvé sur deux photos est un
   point commun : son emplacement au sol doit être le même vu de l'une
   ou de l'autre. Tous ces points forment un nuage.

   Puis on cherche, pour toutes les photos en même temps, le petit réglage
   (cap, inclinaison, position, hauteur) qui fait coïncider au mieux tous
   les points communs, sans trop s'éloigner de ce que disent le GPS et la
   boussole (rappel vers la valeur d'origine). Comme chaque photo est
   tenue par plusieurs voisines, le résultat est bien plus stable qu'un
   calage photo par photo.

   On répète 3 fois (de plus en plus fin) : après chaque réglage les
   photos se superposent mieux, donc les points communs se retrouvent
   plus précisément.
   ===================================================================== */

import { makeCamera } from './photoproj.js';
import { gray, warp, track, isNadir, bestYaw, bestPose } from './autocal.js';

const NAMES = ['yaw', 'pitch', 'e', 'n', 'z', 'roll', 'zoom'];
const K = NAMES.length;
const SIG = [3, 2, 4, 4, 4, 1.5, 0.02];      // écart "normal" par paramètre (°, °, m, m, m) : sert de rappel vers le départ
const LIM = [15, 10, 15, 15, 15, 6, 0.08]; // jamais au-delà
const PRIOR_K = 3;                // poids du rappel (en pixels par écart normal)
const ROUNDS = [
  { W: 240, S: 22, T: 15, step: 14 },
  { W: 480, S: 16, T: 21, step: 24 },
  { W: 480, S: 10, T: 21, step: 20 },
  { W: 720, S: 8, T: 25, step: 26 }
];
const pause = () => new Promise(r => setTimeout(r, 0));

function dist(a, b) {
  const k = Math.PI / 180, R = 6371008.8;
  return Math.hypot((a.lon - b.lon) * k * R * Math.cos(a.lat * k), (a.lat - b.lat) * k * R);
}

// Couleurs d'une photo réduite à W px de large (RGBA)
function colorOf(img, W) {
  try {
    const h = Math.round(W * img.naturalHeight / img.naturalWidth), c = document.createElement('canvas');
    c.width = W; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, h);
    return { d: x.getImageData(0, 0, W, h).data, w: W, h: h };
  } catch (e) { return null; }
}

// Image à 720 px de large, en octets (3e passage)
function up(img) {
  const g = gray(img, 720), g8 = new Uint8Array(g.g.length);
  for (let k = 0; k < g8.length; k++) { g8[k] = g.g[k]; }
  return { g: g8, w: g.w, h: g.h };
}

// Image réduite de moitié (moyenne de 2×2), en octets
function half(im) {
  const w = im.w >> 1, h = im.h >> 1, g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * im.w + 2 * x;
      g[y * w + x] = (im.g[i] + im.g[i + 1] + im.g[i + im.w] + im.g[i + im.w + 1]) / 4;
    }
  }
  return { g: g, w: w, h: h };
}

/* opt = {
     photos : [{ key, pose, load: async () => Image }]   pose = position / cap / inclinaison (+ adj de départ)
     onProgress(text, fraction),
     cancelled() : true pour arrêter
   }
   Renvoie { adjs: {clé: réglage}, stats, points: [[lat, lon], ...] } */
export async function calibrateProject(opt) {
  const say = opt.onProgress || (() => {});
  const stop = opt.cancelled || (() => false);

  // 1. Lire les photos (images réduites en niveaux de gris)
  const P = [];
  for (let i = 0; i < opt.photos.length; i++) {
    const ph = opt.photos[i];
    if (ph.pose.lat == null || ph.pose.heading == null) { continue; }
    say('Lecture des photos ' + (i + 1) + '/' + opt.photos.length + '…', 0.05 * i / opt.photos.length);
    if (stop()) { return { cancelled: true }; }
    let img = null;
    try { img = await ph.load(); } catch (e) { img = null; }
    if (!img || !img.naturalWidth) { continue; }
    const g = gray(img, 480), g8 = new Uint8Array(g.g.length);
    for (let k = 0; k < g8.length; k++) { g8[k] = g.g[k]; }
    const full = { g: g8, w: g.w, h: g.h };
    P.push({ key: ph.key, pose: ph.pose, col: colorOf(img, 480), im: { 480: full, 240: half(full), 720: up(img) }, adj: Object.assign({ yaw: 0, pitch: 0, roll: 0, e: 0, n: 0, z: 0, zoom: 1 }, ph.pose.adj || {}) });
    await pause();
  }
  if (P.length < 2) { return { error: 'Il faut au moins 2 photos avec position GPS et direction.' }; }
  P.forEach(p => { p.x0 = NAMES.map(k => p.adj[k]); });

  // 2. Paires de photos voisines (les 3 plus proches, moins de 100 m)
  const pairs = [], seen = {};
  P.forEach(function (p, i) {
    // Voisines : proches ET d'inclinaison semblable (une vue de dessus se compare mal à une vue très rasante).
    // Une vue de dessus a plus de voisines et un rayon plus large.
    const nad = isNadir(p.pose), near = [];
    P.forEach(function (q, j) { if (j !== i) { const d = dist(p.pose, q.pose); if (d < (nad ? 260 : 150)) { near.push([d + (nad ? 0.4 : 2) * Math.abs((p.pose.pitch || 0) - (q.pose.pitch || 0)), j]); } } });
    near.sort((a, b) => a[0] - b[0]);
    near.slice(0, nad ? 14 : 6).forEach(function (n) {
      const a = Math.min(i, n[1]), b = Math.max(i, n[1]), k = a + '_' + b;
      if (!seen[k]) { seen[k] = 1; pairs.push({ a: a, b: b, obs: [] }); }
    });
  });
  if (!pairs.length) { return { error: 'Aucune paire de photos voisines (moins de 150 m).' }; }

  let stats = { photos: P.length, pairs: pairs.length, obs: 0 };
  let points = [];

  for (let rd = 0; rd < ROUNDS.length; rd++) {
    const R = ROUNDS[rd];
    // 3. Chercher les points communs de chaque paire, avec les réglages actuels
    const cams = P.map(function (p) { const im = p.im[R.W]; return makeCamera(Object.assign({}, p.pose, { adj: p.adj }), { w: im.w, h: im.h }); });
    let total = 0;
    for (let k = 0; k < pairs.length; k++) {
      if (stop()) { return { cancelled: true }; }
      const pr = pairs[k], A = P[pr.a].im[R.W], B = P[pr.b].im[R.W], ca = cams[pr.a], cb = cams[pr.b];
      pr.obs = [];
      if (k % 4 === 0) { say('Passe ' + (rd + 1) + '/' + ROUNDS.length + ' : points communs, paire ' + (k + 1) + '/' + pairs.length + ' (' + total + ' points)…', 0.05 + 0.8 * (rd + k / pairs.length) / ROUNDS.length); await pause(); }
      if (!ca || !cb) { continue; }
      let cw = cb;
      if (rd === 0 && (isNadir(Object.assign({}, P[pr.a].pose, { adj: P[pr.a].adj })) || isNadir(Object.assign({}, P[pr.b].pose, { adj: P[pr.b].adj })))) {
        // vue de dessus : cap peu fiable, on cherche la rotation qui superpose le mieux les deux photos
        const bp = bestPose(A, B, ca, P[pr.b].pose, P[pr.b].adj, R.S, R.T, R.step), ab = P[pr.b].adj;
        cw = makeCamera(Object.assign({}, P[pr.b].pose, { adj: Object.assign({}, ab, { yaw: ab.yaw + bp.dy, e: ab.e + bp.de, n: ab.n + bp.dn }) }), { w: B.w, h: B.h });
      }
      const wp = warp(A, B, ca, cw);
      if (wp.ok < B.w * B.h * 0.05) { continue; }
      const found = track(wp, B, R.S, R.T, R.step);
      found.forEach(function (f) {
        const pa = ca.toPixel(f.lat, f.lon, 0);
        if (!pa) { return; }
        pr.obs.push({ au: pa.x / A.w, av: pa.y / A.h, bu: f.qx / B.w, bv: f.qy / B.h });
      });
      total += pr.obs.length;
    }
    stats.obs = total;
    if (total < 30) { return { error: 'Trop peu de points communs trouvés (' + total + ').' }; }

    // 4. Régler toutes les photos ensemble
    say('Passe ' + (rd + 1) + '/' + ROUNDS.length + ' : réglage global de ' + P.length + ' photos (' + total + ' points)…', 0.05 + 0.8 * (rd + 0.9) / ROUNDS.length);
    await pause();
    const r = await solveAll(P, pairs, stop);
    if (!r) { return { cancelled: true }; }
    stats['before' + rd] = r.before; stats['after' + rd] = r.after;
    stats.before = stats.before == null ? r.before : stats.before;
    stats.after = r.after;
    points = r.points;
  }

  const scanPairs = await scanPass(P, pairs, say, stop);
  if (scanPairs === null) { return { cancelled: true }; }
  const scan = triangulate(P, scanPairs);
  stats.scanPts = scan.n;
  stats.pairObs = pairs.map(pr => [P[pr.a].key, P[pr.b].key, pr.obs.length]);
  const adjs = {};
  P.forEach(p => { adjs[p.key] = p.adj; });
  return { adjs: adjs, stats: stats, points: points, scan: scan };
}

/* Moindres carrés pondérés (Levenberg-Marquardt) sur les 5 paramètres de chaque photo.
   Pour un point commun vu en (a) et (b) : sa position au sol déduite de (a) doit retomber sur (b), et inversement. */
async function solveAll(P, pairs, stop) {
  const n = P.length, N = K * n, S0 = 480;
  const sizes = P.map(p => ({ w: S0, h: p.im[480].h }));
  const mk = (i, adj) => makeCamera(Object.assign({}, P[i].pose, { adj: adj }), sizes[i]);
  const all = [];
  pairs.forEach(pr => pr.obs.forEach(o => all.push({ a: pr.a, b: pr.b, o: o })));
  const withAdj = (i, x, idx, d) => { const a = Object.assign({}, P[i].adj); NAMES.forEach((k, m) => { a[k] = x[i * K + m] + (m === idx ? d : 0); }); return a; };

  // résidus d'un point commun (4 nombres) à partir de deux caméras
  const resid = function (ca, cb, o, sa, sb) {
    const out = [0, 0, 0, 0];
    if (!ca || !cb) { return out; }
    const pa = [o.au * sa.w, o.av * sa.h], pb = [o.bu * sb.w, o.bv * sb.h];
    const ga = ca.toGround(pa[0], pa[1]), gb = cb.toGround(pb[0], pb[1]);
    if (ga) { const q = cb.toPixel(ga.lat, ga.lon, 0); if (q) { out[0] = q.x - pb[0]; out[1] = q.y - pb[1]; } else { out[0] = 40; out[1] = 40; } }
    if (gb) { const q = ca.toPixel(gb.lat, gb.lon, 0); if (q) { out[2] = q.x - pa[0]; out[3] = q.y - pa[1]; } else { out[2] = 40; out[3] = 40; } }
    return out;
  };
  const x = new Float64Array(N);
  P.forEach((p, i) => p.x0.forEach((v, m) => { x[i * K + m] = v; }));

  const costOf = function (xv) {
    const cams = P.map((p, i) => mk(i, withAdj(i, xv, -1, 0)));
    let c = 0;
    all.forEach(function (e) { const r = resid(cams[e.a], cams[e.b], e.o, sizes[e.a], sizes[e.b]); for (let k = 0; k < 4; k++) { const d = Math.abs(r[k]); c += d < 3 ? d * d : 6 * d - 9; } });
    for (let i = 0; i < N; i++) { const m = i % K, z = PRIOR_K * (xv[i] - P[(i / K) | 0].x0[m]) / SIG[m]; c += z * z; }
    return c;
  };
  const medOf = function (xv) {
    const cams = P.map((p, i) => mk(i, withAdj(i, xv, -1, 0))), d = [];
    all.forEach(function (e) { const r = resid(cams[e.a], cams[e.b], e.o, sizes[e.a], sizes[e.b]); d.push(Math.hypot(r[0], r[1]), Math.hypot(r[2], r[3])); });
    d.sort((a, b) => a - b);
    return d.length ? d[d.length >> 1] : 0;
  };
  const before = medOf(x);
  let lambda = 1, cost = costOf(x);
  for (let it = 0; it < 7; it++) {
    if (stop()) { return null; }
    // caméras de base et caméras légèrement décalées (un paramètre à la fois)
    const base = P.map((p, i) => mk(i, withAdj(i, x, -1, 0)));
    const H = [0.05, 0.05, 0.1, 0.1, 0.1, 0.05, 0.003];
    const pert = P.map((p, i) => NAMES.map((k, m) => mk(i, withAdj(i, x, m, H[m]))));
    const A = new Float64Array(N * N), g = new Float64Array(N);
    for (let e = 0; e < all.length; e++) {
      const E = all[e], sa = sizes[E.a], sb = sizes[E.b];
      const r0 = resid(base[E.a], base[E.b], E.o, sa, sb);
      // pondération robuste, par résidu
      const w = r0.map(v => { const d = Math.abs(v); return d <= 3 ? 1 : 3 / d; });
      const J = []; // 2K colonnes : K de a, K de b
      for (let m = 0; m < K; m++) { const r1 = resid(pert[E.a][m], base[E.b], E.o, sa, sb); J.push(r1.map((v, k) => (v - r0[k]) / H[m])); }
      for (let m = 0; m < K; m++) { const r1 = resid(base[E.a], pert[E.b][m], E.o, sa, sb); J.push(r1.map((v, k) => (v - r0[k]) / H[m])); }
      const idx = [];
      for (let m = 0; m < K; m++) { idx.push(E.a * K + m); }
      for (let m = 0; m < K; m++) { idx.push(E.b * K + m); }
      for (let u = 0; u < 2 * K; u++) {
        let gu = 0;
        for (let k = 0; k < 4; k++) { gu += J[u][k] * w[k] * r0[k]; }
        g[idx[u]] -= gu;
        for (let v = u; v < 2 * K; v++) {
          let s = 0;
          for (let k = 0; k < 4; k++) { s += J[u][k] * w[k] * J[v][k]; }
          A[idx[u] * N + idx[v]] += s;
          if (v !== u) { A[idx[v] * N + idx[u]] += s; }
        }
      }
      if (e % 4000 === 0) { await pause(); }
    }
    for (let i = 0; i < N; i++) {
      const m = i % K, kk = PRIOR_K / SIG[m];
      A[i * N + i] += kk * kk;
      g[i] -= kk * kk * (x[i] - P[(i / K) | 0].x0[m]);
    }
    // essais avec un amortissement croissant jusqu'à ce que le coût baisse
    let ok = false;
    for (let t = 0; t < 6 && !ok; t++) {
      const d = cholSolve(A, g, N, lambda);
      if (!d) { lambda *= 10; continue; }
      const xn = new Float64Array(N);
      for (let i = 0; i < N; i++) { const m = i % K, x0 = P[(i / K) | 0].x0[m]; xn[i] = Math.max(x0 - LIM[m], Math.min(x0 + LIM[m], x[i] + d[i])); }
      const cn = costOf(xn);
      if (cn < cost) { x.set(xn); const gain = cost - cn; cost = cn; lambda = Math.max(lambda / 3, 1e-3); ok = true; if (gain < 1e-3 * cost) { it = 99; } } else { lambda *= 5; }
    }
    if (!ok) { break; }
    await pause();
  }
  P.forEach((p, i) => { NAMES.forEach((k, m) => { p.adj[k] = x[i * K + m]; }); });
  const after = medOf(x);

  // le nuage : milieu des deux positions au sol de chaque point commun (au plus 12 000 points)
  const cams = P.map((p, i) => mk(i, p.adj)), pts = [], stepK = Math.max(1, Math.ceil(all.length / 12000));
  for (let e = 0; e < all.length; e += stepK) {
    const E = all[e], ga = cams[E.a] && cams[E.a].toGround(E.o.au * sizes[E.a].w, E.o.av * sizes[E.a].h), gb = cams[E.b] && cams[E.b].toGround(E.o.bu * sizes[E.b].w, E.o.bv * sizes[E.b].h);
    if (ga && gb && Math.hypot(ga.e - gb.e, ga.n - gb.n) < 6) { pts.push([(ga.lat + gb.lat) / 2, (ga.lon + gb.lon) / 2]); }
  }
  return { before: before, after: after, points: pts };
}

// Résout (A + lambda·diag(A)) d = g par Cholesky ; renvoie null si la matrice n'est pas définie positive
function cholSolve(A, g, N, lambda) {
  const L = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * N + j];
      if (i === j) { s += lambda * A[i * N + i] + 1e-9; }
      for (let k = 0; k < j; k++) { s -= L[i * N + k] * L[j * N + k]; }
      if (i === j) { if (s <= 1e-12) { return null; } L[i * N + i] = Math.sqrt(s); }
      else { L[i * N + j] = s / L[j * N + j]; }
    }
  }
  const y = new Float64Array(N), d = new Float64Array(N);
  for (let i = 0; i < N; i++) { let s = g[i]; for (let k = 0; k < i; k++) { s -= L[i * N + k] * y[k]; } y[i] = s / L[i * N + i]; }
  for (let i = N - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < N; k++) { s -= L[k * N + i] * d[k]; } d[i] = s / L[i * N + i]; }
  return d;
}


/* Balayage de plans pour le scan 3D : une fois les photos réglées, on cherche les points communs en supposant
   que le sol est à 0, 4, 9, 16, 28 m de hauteur (toits, arbres, talus…). Un point n'est gardé que s'il se croise
   à peu près à la hauteur du plan où on l'a trouvé. */
const PLANES = [0, 4, 9, 16, 28];
async function scanPass(P, pairs, say, stop) {
  const W = 480, out = [];
  // les 3 meilleures paires de chaque photo (le plus de points communs déjà trouvés, et un vrai écart entre les prises de vue)
  const per = P.map(() => []);
  pairs.forEach((pr, i) => { if (pr.obs.length >= 8) { per[pr.a].push([pr.obs.length, i]); per[pr.b].push([pr.obs.length, i]); } });
  const pick = new Set();
  per.forEach(l => { l.sort((x, y) => y[0] - x[0]); l.slice(0, 4).forEach(x => pick.add(x[1])); });
  const list = [...pick];
  for (let n = 0; n < list.length; n++) {
    if (stop()) { return null; }
    const pr = pairs[list[n]], A = P[pr.a].im[W], B = P[pr.b].im[W];
    if (n % 3 === 0) { say('Scan 3D : paire ' + (n + 1) + '/' + list.length + '…', 0.85 + 0.14 * n / list.length); await pause(); }
    const obs = [];
    PLANES.forEach(function (h) {
      const mk = (i, sz) => { const a = Object.assign({}, P[i].adj); a.z = a.z - h; return makeCamera(Object.assign({}, P[i].pose, { adj: a }), sz); };
      const ca = mk(pr.a, { w: A.w, h: A.h }), cb = mk(pr.b, { w: B.w, h: B.h });
      if (!ca || !cb) { return; }
      const wp = warp(A, B, ca, cb);
      if (wp.ok < B.w * B.h * 0.05) { return; }
      track(wp, B, 6, 21, 12).forEach(function (f) {
        if (f.sc < 0.6) { return; }
        const pa = ca.toPixel(f.lat, f.lon, 0);
        if (pa) { obs.push({ au: pa.x / A.w, av: pa.y / A.h, bu: f.qx / B.w, bv: f.qy / B.h, h: h }); }
      });
    });
    out.push({ a: pr.a, b: pr.b, obs: obs });
  }
  return out;
}

/* Scan 3D : chaque point commun est vu par deux photos. Les deux rayons se croisent en un point de l'espace,
   avec sa hauteur. On garde les croisements nets (les rayons passent à moins de 0,8 m l'un de l'autre,
   avec un angle d'au moins 2°) et on prend la couleur des deux photos.
   Résultat : { n, lat0, lon0, xyz: Float32Array (est, nord, hauteur en m autour de lat0/lon0), rgb: Uint8Array } */
function triangulate(P, pairs) {
  const lat0 = P.reduce((a, p) => a + p.pose.lat, 0) / P.length, lon0 = P.reduce((a, p) => a + p.pose.lon, 0) / P.length;
  const k = Math.PI / 180, R = 6371008.8, cl = Math.cos(lat0 * k);
  const toEN = (la, lo) => [(lo - lon0) * k * R * cl, (la - lat0) * k * R];
  const cams = P.map(p => { const im = p.im[720]; return makeCamera(Object.assign({}, p.pose, { adj: p.adj }), { w: im.w, h: im.h }); });
  const xyz = [], rgb = [];
  const col = (p, u, v) => { const c = p.col; if (!c) { return [150, 150, 150]; } const x = Math.min(c.w - 1, Math.max(0, Math.round(u * c.w))), y = Math.min(c.h - 1, Math.max(0, Math.round(v * c.h))), i = 4 * (y * c.w + x); return [c.d[i], c.d[i + 1], c.d[i + 2]]; };
  pairs.forEach(function (pr) {
    const ca = cams[pr.a], cb = cams[pr.b]; if (!ca || !cb) { return; }
    const A = P[pr.a].im[720], B = P[pr.b].im[720];
    pr.obs.forEach(function (o) {
      const ra = ca.ray(o.au * A.w, o.av * A.h), rb = cb.ray(o.bu * B.w, o.bv * B.h);
      const oa = toEN(ra.lat, ra.lon), ob = toEN(rb.lat, rb.lon);
      const p0 = [oa[0], oa[1], ra.h], q0 = [ob[0], ob[1], rb.h], u = ra.d, v = rb.d;
      const w = [p0[0] - q0[0], p0[1] - q0[1], p0[2] - q0[2]];
      const a = 1, b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], c = 1, d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], e = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
      const den = a * c - b * b;
      if (den < 1.2e-3) { return; }                       // rayons presque parallèles (angle < 2°)
      const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
      if (s < 3 || t < 3 || s > 500 || t > 500) { return; }
      const P1 = [p0[0] + s * u[0], p0[1] + s * u[1], p0[2] + s * u[2]], P2 = [q0[0] + t * v[0], q0[1] + t * v[1], q0[2] + t * v[2]];
      if (Math.hypot(P1[0] - P2[0], P1[1] - P2[1], P1[2] - P2[2]) > 0.8) { return; }
      const X = (P1[0] + P2[0]) / 2, Y = (P1[1] + P2[1]) / 2, Z = (P1[2] + P2[2]) / 2;
      if (Z < -4 || Z > 70 || (o.h != null && Math.abs(Z - o.h) > 2.5)) { return; }
      xyz.push(X, Y, Z);
      const c1 = col(P[pr.a], o.au, o.av), c2 = col(P[pr.b], o.bu, o.bv);
      rgb.push((c1[0] + c2[0]) >> 1, (c1[1] + c2[1]) >> 1, (c1[2] + c2[2]) >> 1);
    });
  });
  // on enlève les doublons (même case de 0,25 m)
  const seen = new Set(), ox = [], oc = [];
  for (let i = 0; i < xyz.length; i += 3) {
    const key = Math.round(xyz[i] * 4) + '_' + Math.round(xyz[i + 1] * 4) + '_' + Math.round(xyz[i + 2] * 4);
    if (seen.has(key)) { continue; }
    seen.add(key); ox.push(xyz[i], xyz[i + 1], xyz[i + 2]); oc.push(rgb[i], rgb[i + 1], rgb[i + 2]);
  }
  return { n: ox.length / 3, lat0: lat0, lon0: lon0, xyz: new Float32Array(ox), rgb: new Uint8Array(oc) };
}
