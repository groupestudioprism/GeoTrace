/* =====================================================================
   PHOTO <-> TERRAIN
   ---------------------------------------------------------------------
   Permet de passer d'un point de la photo (en pixels) à un point du
   terrain (latitude / longitude), et inversement.

   Principe : on connaît la position de l'appareil, son cap, son
   inclinaison et sa focale. Un point de la photo correspond donc à une
   demi-droite dans l'espace. On cherche où cette demi-droite touche le
   sol, que l'on suppose plat (altitude 0). C'est la même caméra que
   celle de la vue 3D : le dessin tombe donc au même endroit.

   Précision : bonne près de l'appareil, moins bonne vers l'horizon ou
   sur un terrain en pente. C'est une aide au repérage, pas un levé.
   ===================================================================== */

import { makeFrame } from './geo.js';

const RAD = Math.PI / 180;

// Les réglages fins d'une photo pour les RÉSEAUX (repérage). Ils sont séparés de ceux de la maquette :
// la maquette Revit a son propre calage (vue 3D), les réseaux ont le leur.
const KEY = 'geotrace:rvue:';
export function reseauAdj(p) {
  const base = { yaw: 0, pitch: 0, roll: 0, e: 0, n: 0, z: 0, zoom: 1 };
  try {
    const own = localStorage.getItem(KEY + (p.key || p.name));
    if (own) { return Object.assign(base, JSON.parse(own)); }
  } catch (e) { /* stockage indisponible */ }
  return base;
}
export function saveReseauAdj(p, a) {
  try { localStorage.setItem(KEY + (p.key || p.name), JSON.stringify(a)); } catch (e) { /* stockage indisponible */ }
}
function adjOf(p) {
  const base = { yaw: 0, pitch: 0, roll: 0, e: 0, n: 0, z: 0, zoom: 1 };
  return p.adj ? Object.assign(base, p.adj) : reseauAdj(p);
}

// Angle de vue vertical (en degrés), d'après la focale équivalente 35 mm
function verticalFov(p, aspect) {
  let f = 26;
  if (p.f35 > 0) {
    f = p.f35;
  } else if (p.dev === 'drone') {
    f = 24;
  }
  const diag = Math.atan(43.267 / (2 * f));
  const vert = Math.atan(Math.tan(diag) / Math.sqrt(1 + aspect * aspect));
  return 2 * vert / RAD;
}

// Les trois axes de la caméra : droite (r), haut (u), avant (f)
function axes(heading, pitch, rollDeg) {
  const h = heading * RAD;
  const t = pitch * RAD;
  const f = [Math.sin(h) * Math.cos(t), Math.cos(h) * Math.cos(t), Math.sin(t)];
  const r0 = [Math.cos(h), -Math.sin(h), 0];
  const u0 = [r0[1] * f[2] - r0[2] * f[1], r0[2] * f[0] - r0[0] * f[2], r0[0] * f[1] - r0[1] * f[0]];
  const cr = Math.cos(rollDeg * RAD);
  const sr = Math.sin(rollDeg * RAD);
  const r = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
  const u = [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr];
  return { r: r, u: u, f: f };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* Crée la caméra d'une photo.
   photo = { lat, lon, heading, pitch, f35, dev, rel, key, name, adj? }
   size  = { w, h } : taille de l'image sur laquelle on dessine
   Renvoie null si la photo n'a pas de position ou de cap. */
/* Le « plan » : une vue de dessus exacte (carte), sans perspective. photo.plan = { z, x0, y0 } :
   niveau de zoom de la carte et position, en pixels de carte, du coin haut-gauche de l'image. */
const TS = 256;
const lon2px = (lon, z) => (lon + 180) / 360 * TS * Math.pow(2, z);
const lat2px = (lat, z) => (1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * TS * Math.pow(2, z);
const px2lon = (x, z) => x / (TS * Math.pow(2, z)) * 360 - 180;
const px2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (TS * Math.pow(2, z))))) / RAD;
export const planGeo = { lon2px, lat2px, px2lon, px2lat };
function planCamera(photo, size) {
  const P = photo.plan, frame = makeFrame(photo.lat, photo.lon);
  const cam = { frame: frame, size: size, pos: [0, 0, 0], plan: true };
  cam.toGround = function (px, py) {
    const lat = px2lat(P.y0 + py, P.z), lon = px2lon(P.x0 + px, P.z), en = frame.toEN(lat, lon);
    return { lat: lat, lon: lon, e: en[0], n: en[1] };
  };
  cam.toPixel = function (lat, lon) { return { x: lon2px(lon, P.z) - P.x0, y: lat2px(lat, P.z) - P.y0 }; };
  return cam;
}

export function makeCamera(photo, size) {
  if (photo && photo.plan && size && size.w) { return planCamera(photo, size); }
  if (!photo || photo.lat == null || photo.lon == null || photo.heading == null || !size || !size.w) {
    return null;
  }
  const a = adjOf(photo);
  const frame = makeFrame(photo.lat, photo.lon);
  const aspect = size.w / size.h;
  let height = 1.6;
  if (photo.dev === 'drone') {
    height = photo.rel != null ? photo.rel : 30;
  }
  const pos = [a.e, a.n, height + a.z];
  const heading = photo.heading + a.yaw;
  const pitch = Math.max(-89, Math.min(89, (photo.pitch || 0) + a.pitch));
  const ax = axes(heading, pitch, a.roll);
  const vfov = 2 * Math.atan(Math.tan(verticalFov(photo, aspect) * RAD / 2) / a.zoom);
  const tv = Math.tan(vfov / 2);

  const cam = { frame: frame, size: size, pos: pos };

  // Point de la photo -> position sur le sol, en latitude / longitude (ou null)
  cam.toGround = function (px, py) {
    const nx = (px / size.w - 0.5) * 2;
    const ny = (0.5 - py / size.h) * 2;
    const d = [
      ax.f[0] + ax.r[0] * nx * tv * aspect + ax.u[0] * ny * tv,
      ax.f[1] + ax.r[1] * nx * tv * aspect + ax.u[1] * ny * tv,
      ax.f[2] + ax.r[2] * nx * tv * aspect + ax.u[2] * ny * tv
    ];
    // Trop près de l'horizon (moins de 1,5° sous l'horizontale), la position sur le sol n'est plus fiable
    if (d[2] / Math.hypot(d[0], d[1], d[2]) > -0.026) {
      return null;
    }
    const t = -pos[2] / d[2];
    if (t > 400) {
      return null; // trop loin pour être fiable
    }
    const e = pos[0] + d[0] * t;
    const n = pos[1] + d[1] * t;
    const ll = frame.toLL(e, n);
    return { lat: ll[0], lon: ll[1], e: e, n: n };
  };

  // Rayon d'un point de la photo : origine (latitude, longitude, hauteur) et direction (est, nord, haut)
  cam.ray = function (px, py) {
    const nx = (px / size.w - 0.5) * 2, ny = (0.5 - py / size.h) * 2;
    const d = [0, 1, 2].map(i => ax.f[i] + ax.r[i] * nx * tv * aspect + ax.u[i] * ny * tv);
    const l = Math.hypot(d[0], d[1], d[2]), ll = frame.toLL(pos[0], pos[1]);
    return { lat: ll[0], lon: ll[1], h: pos[2], d: [d[0] / l, d[1] / l, d[2] / l] };
  };

  // Position sur le sol (latitude / longitude) -> point de la photo (ou null)
  cam.toPixel = function (lat, lon, z) {
    const en = frame.toEN(lat, lon);
    const d = [en[0] - pos[0], en[1] - pos[1], (z || 0) - pos[2]];
    const zc = dot(d, ax.f);
    if (zc < 0.3) {
      return null; // derrière l'appareil
    }
    const nx = dot(d, ax.r) / (zc * tv * aspect);
    const ny = dot(d, ax.u) / (zc * tv);
    return { x: (nx / 2 + 0.5) * size.w, y: (0.5 - ny / 2) * size.h };
  };

  return cam;
}


/* Cale la photo à partir de points connus : pairs = [{ g: [lat, lon], px: { x, y } }]
   g est un point du terrain, px l'endroit où il doit apparaître sur la photo.
   Comme dans la vue 3D : 1 point règle le cap et l'inclinaison, 2 points ou plus règlent aussi le roulis et le zoom.
   Renvoie les nouveaux réglages (yaw, pitch, roll, zoom changent, le reste est gardé). */
export function solveAdj(photo, size, pairs) {
  const a0 = adjOf(photo);
  if (!pairs.length) { return a0; }
  const full = pairs.length >= 2;
  const k = full ? 4 : 2;
  const get = x => Object.assign({}, a0, { yaw: x[0], pitch: x[1], roll: full ? x[2] : a0.roll, zoom: full ? Math.exp(x[3]) : a0.zoom });
  const res = function (x) {
    const cam = makeCamera(Object.assign({}, photo, { adj: get(x) }), size);
    const out = [];
    pairs.forEach(function (q) {
      const px = cam ? cam.toPixel(q.g[0], q.g[1], 0) : null;
      out.push(px ? (px.x - q.px.x) / size.w : 3, px ? (px.y - q.px.y) / size.w : 3);
    });
    if (full) { out.push(x[2] * 0.004, (x[3] - Math.log(a0.zoom)) * 0.3); }
    return out;
  };
  let x = [a0.yaw, a0.pitch, a0.roll, Math.log(a0.zoom)];
  let lam = 1e-3, r = res(x), cost = r.reduce((t, v) => t + v * v, 0);
  for (let it = 0; it < 40; it++) {
    const J = [];
    for (let j = 0; j < k; j++) {
      const y = x.slice(), h = j === 3 ? 1e-3 : 0.02;
      y[j] += h;
      const r2 = res(y);
      J.push(r2.map((v, i) => (v - r[i]) / h));
    }
    const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => J[i].reduce((t, v, m) => t + v * J[j][m], 0) + (i === j ? lam : 0)));
    const b = J.map(row => -row.reduce((t, v, m) => t + v * r[m], 0));
    for (let i = 0; i < k; i++) { // élimination de Gauss
      let m = i;
      for (let j = i + 1; j < k; j++) { if (Math.abs(A[j][i]) > Math.abs(A[m][i])) { m = j; } }
      [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
      if (Math.abs(A[i][i]) < 1e-14) { continue; }
      for (let j = i + 1; j < k; j++) {
        const f = A[j][i] / A[i][i];
        for (let l = i; l < k; l++) { A[j][l] -= f * A[i][l]; }
        b[j] -= f * b[i];
      }
    }
    const dx = Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) {
      let t = b[i];
      for (let j = i + 1; j < k; j++) { t -= A[i][j] * dx[j]; }
      dx[i] = Math.abs(A[i][i]) < 1e-14 ? 0 : t / A[i][i];
    }
    const y = x.slice();
    for (let j = 0; j < k; j++) { y[j] += dx[j]; }
    const r2 = res(y), c2 = r2.reduce((t, v) => t + v * v, 0);
    if (c2 < cost) { const gain = cost - c2; x = y; r = r2; cost = c2; lam = Math.max(lam / 3, 1e-9); if (gain < 1e-14) { break; } } else { lam *= 5; }
  }
  const out = get(x);
  out.zoom = Math.max(0.3, Math.min(4, out.zoom));
  return out;
}
