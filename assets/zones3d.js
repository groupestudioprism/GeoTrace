/* GeoTrace – installations de chantier en 3D : cabines de base vie, conteneurs, bennes, piles de tuyaux, véhicules, clôtures.
   Les objets sont de vrais volumes, répartis dans le contour dessiné sur la carte. */
import * as THREE from 'three';
import * as S from './site3d.js';
const { cabin, pallet, pipes, car, cone } = S;

const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const makeRng = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
const MATS = new Map();
const mat = (color, o = {}) => { const k = color + (o.map ? 'M' : '') + (o.transparent ? 'T' + o.opacity : ''); if (!MATS.has(k)) MATS.set(k, new THREE.MeshLambertMaterial(Object.assign({ color }, o))); return MATS.get(k); };
const box = (w, d, h, m, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m); me.position.set(x, y, z + h / 2); return me; };
const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (((p[i][1] > y) !== (p[j][1] > y)) && (x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) c = !c; return c; };

/* Repère local d'une zone : origine au centre, axe u le long du plus long côté. */
function frameOf(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let best = 0, th = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; th = Math.atan2(q[1] - p[1], q[0] - p[0]); } });
  const c = Math.cos(th), s = Math.sin(th);
  const loc = pts.map(p => [(p[0] - cx) * c + (p[1] - cy) * s, -(p[0] - cx) * s + (p[1] - cy) * c]);
  const us = loc.map(p => p[0]), vs = loc.map(p => p[1]);
  return { cx, cy, th, c, s, loc, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs),
    toW: (u, v) => [cx + u * c - v * s, cy + u * s + v * c] };
}
/* Place des objets de taille w × d sur une grille dans le contour (marge m, espacement gu, gv). */
function grid(F, w, d, gu, gv, m, cb) {
  let n = 0, iv = 0;
  for (let v = F.v0 + m + d / 2; v <= F.v1 - m - d / 2 + 1e-6; v += d + gv, iv++) {
    let iu = 0;
    for (let u = F.u0 + m + w / 2; u <= F.u1 - m - w / 2 + 1e-6; u += w + gu, iu++) {
      const ok = [[-w / 2 - m / 2, -d / 2 - m / 2], [w / 2 + m / 2, -d / 2 - m / 2], [w / 2 + m / 2, d / 2 + m / 2], [-w / 2 - m / 2, d / 2 + m / 2]].every(([a, b]) => inPoly(F.loc, u + a, v + b));
      if (ok) { cb(u, v, iu, iv, n++); }
    }
  }
  return n;
}
const put = (root, F, obj, u, v, rot = 0) => { const [x, y] = F.toW(u, v); obj.position.x += x; obj.position.y += y; obj.rotation.z = F.th + rot; root.add(obj); };

/* ---------- objets ---------- */
const CONT = [0xb23a2f, 0x2c63a8, 0x3c7f55, 0xd29a2a, 0x7a8591, 0xa65b2a];
let corrTex = null;
function corr() {
  if (corrTex) return corrTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 8; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 8); x.fillStyle = 'rgba(0,0,0,.22)'; for (let i = 0; i < 8; i++) x.fillRect(i * 8 + 4, 0, 4, 8);
  corrTex = new THREE.CanvasTexture(c); corrTex.wrapS = corrTex.wrapT = THREE.RepeatWrapping; corrTex.repeat.set(5, 1); corrTex.colorSpace = THREE.SRGBColorSpace; return corrTex;
}
function container(rnd, color) {
  const g = new THREE.Group(), col = color != null ? color : CONT[Math.floor(rnd() * CONT.length)];
  g.add(box(5.9, 2.36, 2.5, mat(col, { map: corr() }), 0, 0, 0.05));
  g.add(S.containerDetails('#' + col.toString(16).padStart(6, '0')));
  return g;
}
function noisy(geo, rnd, k) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const f = 1 + (rnd() - .5) * k; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); } geo.computeVertexNormals(); return geo; }
function dumpster(rnd) {
  const g = S.dumpsterBody(rnd), L = 5.2, W = 2.3;
  const heap = new THREE.Mesh(noisy(new THREE.IcosahedronGeometry(1, 1), rnd, .35), mat(rnd() < .5 ? 0x8a867d : 0x6b5a45)); heap.scale.set(L * .4, W * .38, .7); heap.position.set((rnd() - .5) * .8, 0, 1.0); g.add(heap);
  return g;
}
function mound(rnd, rx, ry, h, col) { const me = new THREE.Mesh(noisy(new THREE.IcosahedronGeometry(1, 2), rnd, .22), mat(col)); me.scale.set(rx, ry, h); me.position.z = h * .15; return me; }

/* ---------- clôture et sols ---------- */
let fenceTex = null;
function fence() {
  if (fenceTex) return fenceTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d'); x.strokeStyle = 'rgba(70,78,88,.95)'; x.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke(); }
  for (let j = 0; j <= 64; j += 16) { x.beginPath(); x.moveTo(0, j); x.lineTo(128, j); x.stroke(); }
  x.lineWidth = 4; x.strokeRect(0, 0, 128, 64);
  fenceTex = new THREE.CanvasTexture(c); fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping; fenceTex.anisotropy = 4; fenceTex.colorSpace = THREE.SRGBColorSpace; return fenceTex;
}
function fences(root, pts, skip) {
  pts.forEach((p, i) => { if (skip !== i) S.fenceRun(root, p, pts[(i + 1) % pts.length]); });
}
const GROUND = { depot: 0xb7ad9b, base: 0xcfc8b8, decharge: 0x8c7b64, stock: 0xb7ad9b, parking: 0x555b62, acces: 0xc9c3b3 };
function groundPatch(root, pts, type) {
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const me = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: GROUND[type] || 0xb7ad9b, transparent: true, opacity: .93, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  me.position.z = .06; root.add(me);
}
function bayLines(root, F, w, d) {
  const lm = mat(0xf5f5f5);
  grid(F, w, d, 0, 0, 1.2, (u, v) => { const [x, y] = F.toW(u - w / 2, v); const l = box(.08, d, .01, lm, 0, 0, .09); l.position.x = x; l.position.y = y; l.rotation.z = F.th; root.add(l); });
}

/* ---------- construction d'une zone par type ---------- */
const BUILD = {
  base(root, F, rnd) { grid(F, 6, 2.45, .5, 3.2, 1.2, (u, v, iu, iv) => put(root, F, cabin(rnd), u, v, iv % 2 ? Math.PI : 0)); },
  depot(root, F, rnd) {
    let k = 0; const used = [];
    grid(F, 6.06, 2.44, .6, .9, 1.2, (u, v, iu, iv, n) => { if (n % 3 === 2) return; const c = container(rnd); put(root, F, c, u, v); if (rnd() < .35) { const c2 = container(rnd); c2.position.z = 2.59; put(root, F, c2, u, v); } used.push([u, v]); k++; });
    grid(F, 1.2, .8, .4, .4, 1.2, (u, v) => { if (used.some(([a, b]) => Math.abs(a - u) < 3.6 && Math.abs(b - v) < 1.7)) return; if (rnd() < .6) put(root, F, pallet(rnd), u, v, rnd() * .3 - .15); });
  },
  decharge(root, F, rnd) {
    const bens = []; grid(F, 5, 2, 1, 1.4, 1.4, (u, v) => { if (rnd() < .9) { put(root, F, dumpster(rnd), u, v); bens.push([u, v]); } });
    const m = mound(rnd, Math.min(4, (F.u1 - F.u0) / 5), Math.min(3.2, (F.v1 - F.v0) / 5), 1.8, 0x7a5c3a); put(root, F, m, F.u1 - Math.min(4.5, (F.u1 - F.u0) / 3), F.v0 + Math.min(3.8, (F.v1 - F.v0) / 3)); if (!inPoly(F.loc, m.position.x * 0 + F.u1 - 1, F.v0 + 1)) { /* contour étroit : le tas reste tel quel */ }
  },
  stock(root, F, rnd) { grid(F, 6.2, 2, .4, .9, 1.2, (u, v, iu, iv, n) => { if (n === 2) { put(root, F, S.digger(rnd), u - .6, v, rnd() * .6 - .3); return; } if (n % 4 === 3) { put(root, F, pallet(rnd), u - 1.5, v); put(root, F, pallet(rnd), u + 1.5, v); } else put(root, F, pipes(rnd), u, v); }); },
  parking(root, F, rnd) {
    bayLines(root, F, 2.6, 5); grid(F, 2.6, 5, 0, 0, 1.2, (u, v) => { if (rnd() < .55) put(root, F, car(rnd), u, v, Math.PI / 2 + (rnd() - .5) * .08); });
  },
  acces(root, F, rnd, pts) {
    // portail sur le plus grand côté, plots le long de l'axe d'entrée
    const i = pts.reduce((b, p, k) => { const q = pts[(k + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); return l > b[1] ? [k, l] : b; }, [0, 0])[0];
    const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]), th = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, gw = Math.min(L * .8, 6), gate = S.gate(gw);
    gate.position.set(mx, my, 0); gate.rotation.z = th; root.add(gate);
    const nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L, cx = F.cx - mx, cy = F.cy - my, sgn = (cx * nx + cy * ny) >= 0 ? 1 : -1;
    for (let k = 0; k < 6; k++) { const c = cone(); const t = (k - 2.5) / 2.5 * gw * .5; c.position.set(mx + (q[0] - p[0]) / L * t + nx * sgn * 3.5, my + (q[1] - p[1]) / L * t + ny * sgn * 3.5, 0); root.add(c); }
  },
};
export const ZONE_HEIGHT = { base: 3.2, depot: 5.2, decharge: 2.4, stock: 2.4, parking: 2.2, acces: 3 };

let labelCache = new Map();
function labelTex(text, color) {
  const k = text + color; if (labelCache.has(k)) return labelCache.get(k);
  const c = document.createElement('canvas'); c.width = 384; c.height = 80; const x = c.getContext('2d');
  x.font = '600 34px "Public Sans", system-ui, sans-serif'; const w = Math.min(360, x.measureText(text).width + 64);
  x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = 8; x.shadowOffsetY = 2; x.fillStyle = '#fff'; x.beginPath(); x.roundRect((384 - w) / 2, 10, w, 56, 28); x.fill(); x.shadowColor = 'transparent';
  x.fillStyle = color; x.beginPath(); x.arc((384 - w) / 2 + 30, 38, 12, 0, 7); x.fill();
  x.fillStyle = '#0b2342'; x.textBaseline = 'middle'; x.fillText(text, (384 - w) / 2 + 50, 40, w - 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; labelCache.set(k, t); return t;
}

/* zones : [{ id, type, name, pts:[[lat,lon],…] }] ; toEN(lat, lon) → [est, nord] en mètres. Renvoie { group, labels }. */
export function buildZones(zones, toEN, colors) {
  const group = new THREE.Group(), labels = new THREE.Group();
  group.name = 'chantier';
  zones.forEach(z => {
    if (!z.pts || z.pts.length < 3 || !BUILD[z.type]) return;
    const pts = z.pts.map(p => toEN(p[0], p[1])), F = frameOf(pts), root = new THREE.Group(), rnd = makeRng(hash(z.id || z.name || z.type));
    groundPatch(root, pts, z.type);
    try { BUILD[z.type](root, F, rnd, pts); } catch (e) { console.warn('zone', z.type, e); }
    fences(root, pts, z.type === 'acces' ? pts.reduce((b, p, k) => { const q = pts[(k + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); return l > b[1] ? [k, l] : b; }, [0, 0])[0] : null);
    root.userData.itemId = z.id; group.add(root);
    const col = (colors && colors[z.type]) || '#0585c6', s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(z.name || z.type, col), sizeAttenuation: false, depthTest: false, transparent: true }));
    s.scale.set(.19, .19 * 80 / 384, 1); s.center.set(.5, 0); s.position.set(F.cx, F.cy, (ZONE_HEIGHT[z.type] || 3) + 1.5); s.renderOrder = 18; s.userData.itemId = z.id; labels.add(s);
  });
  [group, labels].forEach(g => g.traverse(o => { if (o.isMesh || o.isSprite || o.isLine) o.userData.dispose = true; }));
  return { group, labels };
}

/* ---------- déviations : chaussée, flèches, panneaux, cônes, barrières, feux ---------- */
const DEV3 = {
  vehicule: { road: 0x4a5058, edge: 0xffffff, arrow: 0xffd23f },
  pieton:   { road: 0x2f8f63, edge: 0xffffff, arrow: 0xffffff },
  ferme:    { road: 0x4a5058, edge: 0xffffff, arrow: 0xd6402b },
  alternat: { road: 0x4a5058, edge: 0xffffff, arrow: 0xffd23f },
};
export const DEV_HEIGHT = 3;
function walk(P, step, start = step / 2) {
  const out = []; let next = start, acc = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (next <= acc + L) { const f = (next - acc) / L; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, th]); next += step; }
    acc += L;
  }
  return out;
}
function offsetLine(P, o) {
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    let nx = -ty, ny = tx, k = 1;
    if (i > 0 && i < P.length - 1) { const c = P[i - 1], d = P[i + 1], t1x = p[0] - c[0], t1y = p[1] - c[1], t2x = d[0] - p[0], t2y = d[1] - p[1], l1 = Math.hypot(t1x, t1y) || 1, l2 = Math.hypot(t2x, t2y) || 1; const dot = (t1x * t2x + t1y * t2y) / (l1 * l2); k = Math.min(2, 1 / Math.sqrt(Math.max(.25, (1 + dot) / 2))); }
    return [p[0] + nx * o * k, p[1] + ny * o * k];
  });
}
function strip(P, o0, o1, z, color, extra = {}) {
  const A = offsetLine(P, o0), B = offsetLine(P, o1), pos = [], idx = [];
  P.forEach((_, i) => { pos.push(A[i][0], A[i][1], z, B[i][0], B[i][1], z); if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial(Object.assign({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, extra)));
  return m;
}
function chevron(color, w, l) {
  const g = new THREE.BufferGeometry(), t = w * .22;
  const v = [-l / 2, -w / 2, 0, l / 2, 0, 0, -l / 2 + t * 1.5, 0, 0, -l / 2, w / 2, 0, l / 2, 0, 0, -l / 2 + t * 1.5, 0, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute([-l / 2, -w / 2, 0, l / 2, 0, 0, -l / 2 + l * .35, 0, 0, -l / 2, w / 2, 0], 3)); g.setIndex([0, 1, 2, 3, 2, 1]);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  return m;
}
function dirTo(P, i, j) { const a = P[i], b = P[j]; return Math.atan2(b[1] - a[1], b[0] - a[0]); }

/* devs : [{ id, type, name, width, pts:[[lat,lon],…] }]. Renvoie { group, labels }. */
export function buildDevs(devs, toEN, colors) {
  const group = new THREE.Group(), labels = new THREE.Group(); group.name = 'deviations';
  devs.forEach(d => {
    const cfg = DEV3[d.type]; if (!cfg || !d.pts || d.pts.length < 2) return;
    const P = d.pts.map(p => toEN(p[0], p[1])), w = Math.max(1, Math.min(20, +d.width || (d.type === 'pieton' ? 1.5 : 6))), root = new THREE.Group();
    try {
      root.add(strip(P, -w / 2, w / 2, .05, cfg.road));
      if (d.type === 'pieton') root.add(strip(P, -w / 2, w / 2, .06, 0x2f8f63));
      root.add(strip(P, w / 2 - .25, w / 2 - .1, .08, cfg.edge)); root.add(strip(P, -w / 2 + .1, -w / 2 + .25, .08, cfg.edge));
      if (d.type !== 'pieton') walk(P, 6, 3).forEach(([x, y, th]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, .12), new THREE.MeshBasicMaterial({ color: 0xf5f5f5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); m.position.set(x, y, .09); m.rotation.z = th; root.add(m); });
      const aw = Math.min(w * .5, 2.2), al = Math.min(w * .9, 3);
      if (d.type !== 'ferme') walk(P, Math.max(7, w * 2.2), 3.5).forEach(([x, y, th]) => { const c = chevron(cfg.arrow, aw, al); c.position.set(x, y, .1); c.rotation.z = th; root.add(c); });
      const L = []; P.forEach((p, i) => { if (i) L.push(Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1])); });
      // glissières : plots tous les 4 m (véhicules) ou barrières légères (piétons)
      [-1, 1].forEach(s => {
        const E = offsetLine(P, s * (w / 2 + .35));
        if (d.type === 'pieton') walk(E, 2.05, 1).slice(0, 160).forEach(([x, y, th]) => { const b = S.barrierPieton(2); b.position.set(x, y, 0); b.rotation.z = th; root.add(b); });
        else walk(E, 4, 0).forEach(([x, y]) => { const c = cone(); c.position.set(x, y, 0); root.add(c); });
      });
      const a0 = dirTo(P, 0, 1), a1 = dirTo(P, P.length - 2, P.length - 1), sd = w / 2 + 1.3;
      // un objet posé en (x, y), tourné de th, décalé de « side » sur sa droite
      const at = (obj, x, y, th, side) => { obj.position.set(x + Math.cos(th + Math.PI / 2) * side, y + Math.sin(th + Math.PI / 2) * side, 0); obj.rotation.z = th; root.add(obj); };
      const place = (obj, i, th, side) => at(obj, P[i][0], P[i][1], th, side), n = P.length - 1;
      const back = (i, th, dist) => [P[i][0] - Math.cos(th) * dist, P[i][1] - Math.sin(th) * dist];
      // signalisation d'approche dans les deux sens : AK5 travaux et sa distance
      place(S.sign(['AK5', ['KM', '150 m']]), 0, a0 + Math.PI, sd); place(S.sign(['AK5', ['KM', '150 m']]), n, a1, sd);
      if (d.type === 'vehicule') {
        place(S.sign([['KC1', 'd']]), 0, a0 + Math.PI, -sd); place(S.sign([['KD22', 'Déviation']]), n, a1, -sd);
        for (let i = 1; i < n; i++) { const t1 = dirTo(P, i - 1, i), t2 = dirTo(P, i, i + 1), dt = Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)); if (Math.abs(dt) > .6) at(S.sign(['K8']), P[i][0] + Math.cos(t1) * (w / 2 + .9), P[i][1] + Math.sin(t1) * (w / 2 + .9), t1 + Math.PI, 0); }
      }
      if (d.type === 'ferme') {
        place(S.barrierK2(w), 0, a0 + Math.PI, 0); place(S.barrierK2(w), n, a1, 0);
        place(S.sign(['B0', 'BARREE']), 0, a0 + Math.PI, -sd); place(S.sign(['B0', 'BARREE']), n, a1, -sd);
      }
      if (d.type === 'alternat') {
        place(S.trafficLight(false), 0, a0 + Math.PI, w / 2 + .9); place(S.trafficLight(true), n, a1, w / 2 + .9);
        const p0 = back(0, a0, 30), p1 = back(n, a1 + Math.PI, 30);
        at(S.sign(['AK17', ['KM', '100 m']]), p0[0], p0[1], a0 + Math.PI, sd); at(S.sign(['AK17', ['KM', '100 m']]), p1[0], p1[1], a1, sd);
        const q0 = back(0, a0, 15), q1 = back(n, a1 + Math.PI, 15);
        at(S.sign([['B14', '30']]), q0[0], q0[1], a0 + Math.PI, sd); at(S.sign([['B14', '30']]), q1[0], q1[1], a1, sd);
      }
      if (d.type === 'pieton') { place(S.sign([['PIETONS', 'd']]), 0, a0 + Math.PI, -sd + .6); place(S.sign([['PIETONS', 'g']]), n, a1, -sd + .6); }
    } catch (e) { console.warn('déviation', d.type, e); }
    root.userData.itemId = d.id; group.add(root);
    const mid = walk(P, 1e9, 0)[0] || [P[0][0], P[0][1]]; let tot = 0; for (let i = 1; i < P.length; i++) tot += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const m = walk(P, tot * 2, tot / 2)[0] || mid, col = (colors && colors[d.type]) || '#0585c6';
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(d.name || d.type, col), sizeAttenuation: false, depthTest: false, transparent: true }));
    s.scale.set(.19, .19 * 80 / 384, 1); s.center.set(.5, 0); s.position.set(m[0], m[1], DEV_HEIGHT + 1.2); s.renderOrder = 18; s.userData.itemId = d.id; labels.add(s);
  });
  [group, labels].forEach(g => g.traverse(o => { if (o.isMesh || o.isSprite || o.isLine) o.userData.dispose = true; }));
  return { group, labels };
}

/* ---------- réseaux existants : tuyaux enterrés (z négatif) ou aériens (profondeur négative) ---------- */
// Les réseaux sont modélisés en détail (tuyaux, regards, robinetterie) dans net3d.js
export { buildNets } from './net3d.js';
