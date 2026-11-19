/* Installations de chantier et signalisation temporaire en 3D détaillée, à l'échelle réelle.
   Cotes d'après les fiches fabricants et la réglementation :
   - bungalow de chantier monobloc 6,055 × 2,435 m, h 2,60 m, fenêtre PVC 1,20 × 1,20 m avec volet et barreaux, passages de fourches ;
   - conteneur ISO 20 pieds 6,058 × 2,438 × 2,591 m ; palette 1,20 × 0,80 m ; benne amovible 15 m³ ;
   - clôture mobile de chantier 3,50 × 2,00 m sur plots béton, colliers d'assemblage ;
   - signalisation temporaire gamme normale : triangles AK 1000 mm, disques B 850 mm, KC1 800 × 600, KM 900 × 250, KD22 1300 × 300,
     barrage K2 1750 × 250, cône K5a 750 mm à deux bandes rétroréfléchissantes, feux de chantier KR11 sur chariot. */
import * as THREE from '../vendor/three/three.module.js';
import { B, nmat as mat, V } from './net3d.js';

const Z = V(0, 0, 1), X = V(1, 0, 0), Yv = V(0, 1, 0);
const G = (b) => b.finish(new THREE.Group());
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const STEEL = '#59626d', GALVA = '#b9bec4', DARK = '#23282e', GLASS = '#7fb0d8', TIRE = '#15181b', WOOD = '#a9824a', ORANGE = '#f26b1d';

/* ---------- base vie ---------- */
export function cabin(rnd) {
  const b = new B(), L = 6.055, W = 2.435, H = 2.6, z0 = 0.16, wall = mat(rnd() < 0.2 ? '#e4eaef' : '#f3f5f7'), fr = mat('#3d4a57'), blue = mat('#1f6fb5'), glass = mat(GLASS, { shine: 80 }), pvc = mat('#ffffff'), gv = mat(GALVA, { shine: 50 });
  for (const x of [-2.4, 2.4]) for (const y of [-0.9, 0.9]) b.box(0.4, 0.4, z0, V(x, y, z0 / 2), mat('#b9b6ae'));
  b.box(L, W, 0.16, V(0, 0, z0 + 0.08), fr).box(L, W, 0.14, V(0, 0, z0 + H - 0.07), blue).box(L + 0.06, W + 0.06, 0.03, V(0, 0, z0 + H + 0.015), mat('#cdd5dd'));
  for (const x of [-1, 1]) for (const y of [-1, 1]) b.box(0.13, 0.13, H, V(x * (L / 2 - 0.065), y * (W / 2 - 0.065), z0 + H / 2), fr);
  b.box(L - 0.14, W - 0.1, H - 0.3, V(0, 0, z0 + 0.16 + (H - 0.3) / 2), wall);
  // couvre-joints des panneaux sandwich, passages de fourches, descentes d'eau
  for (const s of [-1, 1]) {
    for (let x = -2.3; x <= 2.31; x += 1.15) b.box(0.03, 0.012, H - 0.32, V(x, s * (W / 2 - 0.045), z0 + 0.16 + (H - 0.32) / 2), mat('#d5dce3'));
    for (const x of [-1.03, 1.03]) b.box(0.36, 0.02, 0.1, V(x, s * (W / 2 + 0.002), z0 + 0.08), mat(DARK));
    b.cyl(0.03, 0.03, V(s * (L / 2 + 0.035), W / 2 - 0.1, z0 + 0.1), V(s * (L / 2 + 0.035), W / 2 - 0.1, z0 + H - 0.1), gv, 8);
  }
  const win = (x, s) => {
    const y = s * (W / 2 - 0.03);
    b.box(1.26, 0.07, 1.26, V(x, y, z0 + 1.55), pvc).box(1.14, 0.08, 1.14, V(x, y, z0 + 1.55), glass).box(0.04, 0.085, 1.14, V(x, y, z0 + 1.55), pvc);
    b.box(1.3, 0.14, 0.2, V(x, y + s * 0.04, z0 + 2.27), pvc);
    for (let k = 0; k < 5; k++) b.cyl(0.008, 0.008, V(x - 0.6, y + s * 0.06, z0 + 1.08 + k * 0.235), V(x + 0.6, y + s * 0.06, z0 + 1.08 + k * 0.235), gv, 6);
  };
  win(0.6, 1); win(1.2, -1); win(-1.2, -1);
  // porte, poignée, marchepied, éclairage et coffret électrique
  const yd = W / 2 - 0.03;
  b.box(0.98, 0.07, 2.08, V(-2.05, yd, z0 + 0.16 + 1.04), fr).box(0.86, 0.08, 1.98, V(-2.05, yd, z0 + 0.16 + 1.02), mat('#8c98a5')).box(0.4, 0.085, 0.5, V(-2.05, yd, z0 + 1.75), glass);
  b.box(0.13, 0.04, 0.025, V(-1.72, yd + 0.06, z0 + 1.2), gv).box(1.0, 0.32, 0.03, V(-2.05, W / 2 + 0.18, z0 + 0.12), gv).box(0.04, 0.3, z0 + 0.1, V(-2.5, W / 2 + 0.18, (z0 + 0.1) / 2), gv).box(0.04, 0.3, z0 + 0.1, V(-1.6, W / 2 + 0.18, (z0 + 0.1) / 2), gv);
  b.box(0.22, 0.09, 0.1, V(-2.05, W / 2 + 0.03, z0 + 2.38), mat('#f7f2c4')).box(0.3, 0.12, 0.4, V(L / 2 - 0.5, W / 2 + 0.05, z0 + 1.3), mat('#d8dde2'));
  return G(b);
}

/* ---------- dépôt ---------- */
export function containerDetails(col) {
  const b = new B(), L = 6.058, W = 2.438, H = 2.591, d = mat(col), gv = mat(GALVA, { shine: 50 }), dk = mat(DARK);
  for (const x of [-1, 1]) for (const y of [-1, 1]) { b.box(0.16, 0.16, H, V(x * (L / 2 - 0.08), y * (W / 2 - 0.08), H / 2), d); for (const z of [0.06, H - 0.06]) b.box(0.18, 0.17, 0.12, V(x * (L / 2 - 0.085), y * (W / 2 - 0.08), z), mat('#8a929b')); }
  for (const y of [-1, 1]) { b.box(L, 0.07, 0.16, V(0, y * (W / 2 - 0.03), 0.08), d).box(L, 0.07, 0.12, V(0, y * (W / 2 - 0.03), H - 0.06), d); for (const x of [-1.03, 1.03]) b.box(0.36, 0.02, 0.1, V(x, y * (W / 2 + 0.006), 0.08), dk); }
  // portes : deux vantaux, quatre crémones avec poignées, charnières
  const xd = L / 2 + 0.012; b.box(0.03, W - 0.3, H - 0.3, V(xd - 0.01, 0, H / 2), d).box(0.035, 0.03, H - 0.3, V(xd, 0, H / 2), dk);
  for (const y of [-0.85, -0.3, 0.3, 0.85]) { b.cyl(0.017, 0.017, V(xd + 0.03, y, 0.12), V(xd + 0.03, y, H - 0.12), gv, 8).box(0.03, 0.32, 0.03, V(xd + 0.045, y + (y < 0 ? 0.13 : -0.13), 1.15), gv); for (const z of [0.16, H - 0.16]) b.box(0.05, 0.09, 0.07, V(xd + 0.03, y, z), gv); }
  for (const y of [-1, 1]) for (const z of [0.4, 1.0, 1.6, 2.2]) b.box(0.05, 0.1, 0.08, V(xd, y * (W / 2 - 0.17), z), gv);
  return G(b);
}
export function pallet(rnd) {
  const b = new B(), w = mat(WOOD), h = 0.5 + rnd() * 0.9, col = pick(rnd, ['#d8d1c0', '#b9c4cc', '#c9a66b', '#8aa0b5']);
  for (const y of [-0.34, 0, 0.34]) b.box(1.2, 0.1, 0.1, V(0, y, 0.05), w);
  for (let i = 0; i < 7; i++) b.box(0.1, 0.8, 0.022, V(-0.55 + i * 0.183, 0, 0.111), w);
  const n = Math.max(2, Math.round(h / 0.22)), lh = h / n;
  for (let k = 0; k < n; k++) for (const x of [-0.29, 0.29]) b.box(0.56, 0.74 - (k % 2) * 0.03, lh - 0.012, V(x + (k % 2 ? 0.01 : -0.01), 0, 0.122 + lh * (k + 0.5)), mat(col));
  b.box(1.17, 0.78, 0.03, V(0, 0, 0.122 + h * 0.55), mat('#1c1f23')).box(0.03, 0.79, h, V(0.3, 0, 0.122 + h / 2), mat('#1c1f23'));
  return G(b);
}

/* ---------- décharge : benne amovible 15 m³ ---------- */
export function dumpsterBody(rnd) {
  const b = new B(), col = rnd() < 0.5 ? '#d9a21b' : '#2f7d53', m = mat(col), dk = mat('#333a42'), L = 5.2, W = 2.3, H = 1.5, z0 = 0.28;
  b.box(L, W, 0.08, V(0, 0, z0 + 0.04), m);
  for (const s of [-1, 1]) { b.box(L, 0.06, H, V(0, s * (W / 2 - 0.03), z0 + H / 2), m).box(L + 0.08, 0.12, 0.1, V(0, s * (W / 2 - 0.03), z0 + H), dk); for (let x = -L / 2 + 0.3; x < L / 2; x += 0.75) b.box(0.08, 0.06, H - 0.1, V(x, s * (W / 2 + 0.03), z0 + H / 2), m); b.box(L - 0.2, 0.12, 0.2, V(0, s * 0.53, z0 - 0.1), dk); }
  b.box(0.06, W, H, V(-L / 2 + 0.03, 0, z0 + H / 2), m).box(0.06, W, H, V(L / 2 - 0.03, 0, z0 + H / 2), m);
  // avant : potence et anneau de préhension ; arrière : porte, charnières, rouleaux
  for (const s of [-1, 1]) b.cyl(0.05, 0.05, V(L / 2, s * 0.5, z0 + 0.1), V(L / 2 + 0.12, 0, z0 + 1.45), dk, 8);
  b.cyl(0.03, 0.03, V(L / 2 + 0.13, -0.16, z0 + 1.45), V(L / 2 + 0.13, 0.16, z0 + 1.45), mat(GALVA, { shine: 50 }), 8);
  for (const s of [-1, 1]) { b.cyl(0.11, 0.11, V(-L / 2 + 0.2, s * 0.62, 0.11), V(-L / 2 + 0.2, s * 0.44, 0.11), dk, 14); for (const z of [0.4, 1.1]) b.box(0.07, 0.12, 0.14, V(-L / 2 - 0.02, s * (W / 2 - 0.08), z0 + z), dk); }
  b.box(0.05, 0.06, H - 0.2, V(-L / 2 - 0.02, 0, z0 + H / 2), dk);
  return G(b);
}

/* ---------- stock : tuyaux en fardeau sur chevrons ---------- */
export function pipes(rnd) {
  const b = new B(), kind = pick(rnd, [['#17191c', 0.11, 0], ['#2f6db5', 0.137, 1], ['#aaa397', 0.1, 1], ['#c2641f', 0.1, 1], ['#b9b6ae', 0.2, 2]]), r = kind[1], len = kind[2] === 2 ? 2.4 : 6, m = mat(kind[0], { shine: kind[2] ? 0 : 30 });
  const rows = kind[2] === 2 ? 2 : 4, per = kind[2] === 2 ? 3 : 5, ri = r * (kind[2] === 2 ? 0.74 : 0.84);
  for (const x of (len > 3 ? [-2, 0, 2] : [-0.8, 0.8])) { b.box(0.1, per * r * 2.3, 0.08, V(x, 0, 0.04), mat(WOOD)); for (const s of [-1, 1]) b.box(0.1, 0.16, 0.1, V(x, s * (per * r + 0.02), 0.12), mat(WOOD)); }
  for (let k = 0; k < rows; k++) { const n = per - k; for (let i = 0; i < n; i++) {
    const y = (i - (n - 1) / 2) * r * 2.04, z = 0.08 + r + k * r * 1.78, flip = (i + k) % 2 ? 1 : -1, o = V(-flip * len / 2, y, z), d = V(flip, 0, 0);
    const prof = [[ri, 0], [r, 0], [r, len - (kind[2] ? 0.14 : 0)]]; if (kind[2] === 1) prof.push([r * 1.26, len - 0.1], [r * 1.26, len], [r * 1.05, len]); else if (kind[2] === 2) prof.push([r + 0.05, len - 0.1], [r + 0.05, len], [r, len]); else prof.push([ri, len]);
    b.lathe(prof, o, d, m, 16);
  } }
  return G(b);
}

/* ---------- véhicules ---------- */
function extrudeXZ(pts, w) { const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))), { depth: w, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, w / 2, 0); return g; }
function wheels(b, xs, y, r) { const t = mat(TIRE), rim = mat('#c4c9cf', { shine: 60 }); for (const x of xs) for (const s of [-1, 1]) { b.cyl(r, r, V(x, s * y, r), V(x, s * (y - 0.24), r), t, 18).cyl(r * 0.6, r * 0.6, V(x, s * (y + 0.004), r), V(x, s * (y - 0.03), r), rim, 14); } }
export function car(rnd) {
  const b = new B();
  if (rnd() < 0.4) {
    // fourgon de chantier : gyrophare, bandes rouge et blanc à l'arrière
    const m = mat('#f2f3f4', { shine: 30 }), W = 2.0, gl = mat('#1d2a36', { shine: 90 });
    b.push(extrudeXZ([[-2.7, 0.42], [-2.7, 2.35], [1.15, 2.35], [1.72, 1.52], [2.6, 1.18], [2.72, 0.75], [2.72, 0.42]], W), m);
    b.push(extrudeXZ([[1.2, 2.26], [1.7, 1.54], [1.78, 1.54], [1.28, 2.26]], W - 0.24), gl);
    for (const s of [-1, 1]) { b.box(0.75, 0.02, 0.55, V(0.75, s * (W / 2 + 0.004), 1.85), gl).box(0.06, 0.1, 0.16, V(1.25, s * (W / 2 + 0.07), 1.62), mat(DARK)); b.box(0.02, W / 2 - 0.08, 1.7, V(-2.705, s * (W / 4), 1.35), mat('#e7e9eb')); }
    for (let i = 0; i < 8; i++) b.box(0.025, W / 8, 0.14, V(-2.715, -W / 2 + W / 16 + i * W / 8, 0.62), mat(i % 2 ? '#ffffff' : '#d6402b'));
    b.cyl(0.07, 0.06, V(0.6, 0, 2.35), V(0.6, 0, 2.47), mat('#ff9d1e', { shine: 90 }), 12).box(0.03, 1.5, 0.12, V(2.725, 0, 0.62), mat(DARK));
    for (const s of [-1, 1]) b.box(0.03, 0.3, 0.12, V(2.7, s * 0.7, 0.98), mat('#fff6d0', { shine: 90 })).box(0.03, 0.12, 0.3, V(-2.71, s * 0.9, 1.0), mat('#c0392b'));
    wheels(b, [-1.75, 1.75], W / 2, 0.36);
  } else {
    const col = pick(rnd, ['#2b3a55', '#b3b8be', '#c0392b', '#1f2933', '#e9ecef', '#2f6f4e']), m = mat(col, { shine: 60 }), W = 1.78, gl = mat('#1d2a36', { shine: 90 });
    b.push(extrudeXZ([[-2.1, 0.32], [-2.12, 0.78], [-1.95, 0.96], [-1.2, 1.0], [1.22, 1.0], [2.0, 0.88], [2.12, 0.6], [2.1, 0.32]], W), m);
    b.push(extrudeXZ([[-1.22, 1.0], [-0.8, 1.42], [0.66, 1.42], [1.24, 1.0]], W - 0.1), gl);
    b.box(1.5, W - 0.16, 0.035, V(-0.07, 0, 1.435), m);
    for (const s of [-1, 1]) { b.box(0.05, 0.015, 0.42, V(-0.05, s * (W / 2 - 0.045), 1.21), m).box(0.1, 0.12, 0.08, V(0.95, s * (W / 2 + 0.05), 1.03), m); b.box(0.03, 0.34, 0.1, V(2.1, s * 0.6, 0.72), mat('#fff6d0', { shine: 90 })).box(0.03, 0.34, 0.1, V(-2.11, s * 0.6, 0.8), mat('#c0392b')); }
    b.box(0.03, 0.5, 0.11, V(2.125, 0, 0.45), mat('#f5f5f5')).box(0.03, 0.5, 0.11, V(-2.13, 0, 0.5), mat('#f5f5f5'));
    wheels(b, [-1.3, 1.32], W / 2, 0.32);
  }
  return G(b);
}
/* mini-pelle sur chenilles : tourelle, cabine, flèche, balancier, godet, vérins */
export function digger(rnd) {
  const b = new B(), y = mat('#f2b61b', { shine: 30 }), dk = mat(DARK), gv = mat(GALVA, { shine: 70 }), a = (rnd() - 0.5) * 1.2, c = Math.cos(a), s = Math.sin(a), T = (x, yy, z) => V(x * c - yy * s, x * s + yy * c, z);
  for (const sd of [-1, 1]) { b.box(2.1, 0.4, 0.42, V(0, sd * 0.75, 0.3), mat(TIRE)); for (const x of [-1.05, 1.05]) b.cyl(0.29, 0.29, V(x, sd * 0.55, 0.3), V(x, sd * 0.95, 0.3), mat(TIRE), 14); for (const x of [-0.6, 0, 0.6]) b.cyl(0.1, 0.1, V(x, sd * 0.56, 0.16), V(x, sd * 0.54, 0.16), gv, 10); }
  b.box(1.5, 1.1, 0.2, V(0, 0, 0.42), dk).box(2.3, 0.08, 0.36, V(1.2, 0, 0.26), dk, Math.PI / 2).cyl(0.4, 0.4, V(0, 0, 0.5), V(0, 0, 0.62), dk, 16);
  const body = new THREE.BoxGeometry(1.9, 1.5, 0.62); body.translate(-0.15, 0, 0.93); body.rotateZ(a); b.push(body, y);
  const cab = new THREE.BoxGeometry(1.0, 0.8, 1.2); cab.translate(0.15, 0.3, 1.84); cab.rotateZ(a); b.push(cab, y);
  const gl = new THREE.BoxGeometry(0.86, 0.82, 0.8); gl.translate(0.2, 0.3, 1.92); gl.rotateZ(a); b.push(gl, mat('#1d2a36', { shine: 90 }));
  const cw = new THREE.BoxGeometry(0.5, 1.5, 0.75); cw.translate(-1.0, 0, 1.0); cw.rotateZ(a); b.push(cw, dk);
  const p0 = T(0.75, -0.25, 1.0), p1 = T(2.3, -0.25, 2.7), p2 = T(3.6, -0.25, 1.3), p3 = T(3.45, -0.25, 0.45);
  b.cyl(0.16, 0.13, p0, p1, y, 4).cyl(0.12, 0.1, p1, p2, y, 4).cyl(0.035, 0.035, T(1.0, -0.25, 1.15), T(1.75, -0.25, 1.9), gv, 8).cyl(0.035, 0.035, T(2.0, -0.25, 2.75), T(2.75, -0.25, 2.45), gv, 8);
  const bk = new THREE.CylinderGeometry(0.42, 0.42, 0.6, 10, 1, false, 0, Math.PI * 1.1); bk.translate(3.45, 0, 0); const q = new THREE.Matrix4().makeRotationX(Math.PI / 2); bk.applyMatrix4(new THREE.Matrix4().makeTranslation(-3.45, 0, 0)); bk.applyMatrix4(q); bk.translate(3.5, -0.25, 0.75); bk.rotateZ(a); b.push(bk, dk);
  b.cyl(0.05, 0.05, p2, p3, dk, 6);
  return G(b);
}

/* ---------- balisage ---------- */
export function cone() {
  const b = new B(), o = mat(ORANGE), w = mat('#f7f7f7', { shine: 60 }), r = z => 0.145 - (z - 0.04) * 0.158;
  b.box(0.4, 0.4, 0.04, V(0, 0, 0.02), mat('#20262c'));
  [[0.04, 0.3, o], [0.3, 0.44, w], [0.44, 0.53, o], [0.53, 0.64, w], [0.64, 0.75, o]].forEach(([z0, z1, m]) => b.cyl(r(z0), r(z1), V(0, 0, z0), V(0, 0, z1), m, 16, true));
  b.cyl(r(0.75), r(0.75), V(0, 0, 0.745), V(0, 0, 0.75), o, 12);
  return G(b);
}
let meshTex = null;
function meshMat() {
  if (!meshTex) { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.strokeStyle = 'rgba(96,104,114,.95)'; x.lineWidth = 2; for (let i = 0; i <= 128; i += 12.8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); } for (let j = 0; j <= 128; j += 42.6) { x.beginPath(); x.moveTo(0, j); x.lineTo(128, j); x.stroke(); } meshTex = new THREE.CanvasTexture(c); meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping; meshTex.anisotropy = 4; meshTex.colorSpace = THREE.SRGBColorSpace; }
  return new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
}
/* clôture mobile : panneaux de 3,50 × 2,00 m (cadre tubulaire, treillis), plots béton, colliers */
export function fenceRun(root, p, q) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.5) return;
  const n = Math.max(1, Math.round(L / 3.5)), w = L / n, th = Math.atan2(q[1] - p[1], q[0] - p[0]), b = new B(), gv = mat(GALVA, { shine: 40 }), g = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const x0 = k * w + 0.03, x1 = (k + 1) * w - 0.03;
    b.cyl(0.021, 0.021, V(x0, 0, 0.1), V(x0, 0, 2.1), gv, 8).cyl(0.021, 0.021, V(x1, 0, 0.1), V(x1, 0, 2.1), gv, 8).cyl(0.015, 0.015, V(x0, 0, 2.02), V(x1, 0, 2.02), gv, 6).cyl(0.015, 0.015, V(x0, 0, 0.2), V(x1, 0, 0.2), gv, 6);
    const pl = new THREE.PlaneGeometry(x1 - x0, 1.82); pl.rotateX(Math.PI / 2); pl.translate((x0 + x1) / 2, 0, 1.11); pl.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * 4 : v * 3.5; }); g.add(new THREE.Mesh(pl, meshMat()));
  }
  for (let k = 0; k <= n; k++) { b.box(0.24, 0.72, 0.14, V(k * w, 0, 0.07), mat('#a9a69e')); if (k && k < n) b.box(0.1, 0.05, 0.05, V(k * w, 0, 1.75), mat(DARK)).box(0.1, 0.05, 0.05, V(k * w, 0, 0.5), mat(DARK)); }
  b.finish(g); g.position.set(p[0], p[1], 0); g.rotation.z = th; root.add(g);
}

/* ---------- panneaux : pictogrammes dessinés, plaque et dos galvanisé ---------- */
const TEX = new Map();
function signTex(kind, txt) {
  const key = kind + '|' + (txt || ''); if (TEX.has(key)) return TEX.get(key);
  const R = { tri: [256, 256], disc: [256, 256], rect: [320, 240], km: [360, 100], kd: [416, 96], k2: [448, 64], k8: [256, 256], big: [384, 256] };
  const shape = /^AK/.test(kind) ? 'tri' : /^B\d/.test(kind) ? 'disc' : kind === 'KM' ? 'km' : kind === 'KD22' ? 'kd' : kind === 'K2' ? 'k2' : kind === 'K8' ? 'k8' : kind === 'CHANTIER' ? 'big' : 'rect';
  const [w, h] = R[shape], mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const c = mk(), x = c.getContext('2d'), back = mk(), y = back.getContext('2d');
  const tri = g => { g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 6, h - 22); g.lineTo(6, h - 22); g.closePath(); };
  const rr = (g, a, bb, ww, hh, r) => { g.beginPath(); g.roundRect(a, bb, ww, hh, r); };
  const text = (t, px, cy, col = '#111', maxw = w - 30) => { x.fillStyle = col; x.font = `800 ${px}px "Barlow", Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, w / 2, cy, maxw); };
  const arrow = (cx, cy, len, dir, col = '#111') => { x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 14; x.beginPath(); x.moveTo(cx - dir * len / 2, cy); x.lineTo(cx + dir * len / 4, cy); x.stroke(); x.beginPath(); x.moveTo(cx + dir * len / 2, cy); x.lineTo(cx + dir * len / 6, cy - 22); x.lineTo(cx + dir * len / 6, cy + 22); x.closePath(); x.fill(); };
  if (shape === 'tri') {
    tri(x); x.fillStyle = '#ffd21f'; x.fill(); x.lineWidth = 22; x.lineJoin = 'round'; x.strokeStyle = '#d6202b'; x.stroke(); tri(y); y.fillStyle = '#aab0b6'; y.lineWidth = 22; y.lineJoin = 'round'; y.strokeStyle = '#aab0b6'; y.fill(); y.stroke();
    x.fillStyle = '#111'; x.strokeStyle = '#111'; x.lineCap = 'round';
    if (kind === 'AK5') { x.beginPath(); x.arc(112, 108, 13, 0, 7); x.fill(); x.lineWidth = 13; x.beginPath(); x.moveTo(108, 128); x.lineTo(124, 168); x.lineTo(108, 208); x.moveTo(124, 168); x.lineTo(146, 206); x.moveTo(110, 136); x.lineTo(150, 160); x.stroke(); x.lineWidth = 7; x.beginPath(); x.moveTo(132, 132); x.lineTo(170, 200); x.stroke(); x.beginPath(); x.moveTo(150, 212); x.quadraticCurveTo(182, 160, 214, 212); x.closePath(); x.fill(); }
    else if (kind === 'AK17') { rr(x, 106, 86, 44, 118, 10); x.fill(); [['#e03b2b', 108], ['#ffb71b', 145], ['#2ed16b', 182]].forEach(([cc, cy]) => { x.fillStyle = cc; x.beginPath(); x.arc(128, cy, 13, 0, 7); x.fill(); }); }
    else { x.font = '800 120px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('!', w / 2, 150); }
  } else if (shape === 'disc') {
    const ring = (g, f) => { g.beginPath(); g.arc(128, 128, 122, 0, 7); g.fillStyle = f; g.fill(); }; ring(y, '#aab0b6');
    if (kind === 'B1') { ring(x, '#d6202b'); x.fillStyle = '#fff'; x.fillRect(48, 106, 160, 44); }
    else { ring(x, '#d6202b'); x.beginPath(); x.arc(128, 128, 92, 0, 7); x.fillStyle = '#fff'; x.fill(); if (kind === 'B14') text(txt || '30', 96, 134); }
  } else if (shape === 'k2') {
    for (let i = -1; i < 9; i++) { x.fillStyle = i % 2 ? '#fff' : '#d6202b'; x.beginPath(); x.moveTo(i * 56, 0); x.lineTo(i * 56 + 56, 0); x.lineTo(i * 56 + 112, h); x.lineTo(i * 56 + 56, h); x.closePath(); x.fill(); } y.fillStyle = '#aab0b6'; y.fillRect(0, 0, w, h);
  } else if (shape === 'k8') {
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#d6202b'; for (let i = 0; i < 3; i++) { const a = 20 + i * 84; x.beginPath(); x.moveTo(a, 10); x.lineTo(a + 44, 10); x.lineTo(a + 94, 128); x.lineTo(a + 44, 246); x.lineTo(a, 246); x.lineTo(a + 50, 128); x.closePath(); x.fill(); } y.fillStyle = '#aab0b6'; y.fillRect(0, 0, w, h);
  } else if (shape === 'kd') {
    const pth = g => { g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 60, 4); g.lineTo(w - 4, h / 2); g.lineTo(w - 60, h - 4); g.lineTo(4, h - 4); g.closePath(); };
    pth(x); x.fillStyle = '#ffd21f'; x.fill(); x.lineWidth = 6; x.strokeStyle = '#111'; x.stroke(); pth(y); y.fillStyle = '#aab0b6'; y.fill(); x.fillStyle = '#111'; x.font = '800 54px "Barlow", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt || 'Déviation', w / 2 - 24, h / 2 + 3, w - 110);
  } else if (shape === 'big') {
    rr(x, 3, 3, w - 6, h - 6, 10); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 8; x.strokeStyle = '#d6202b'; x.stroke(); text('CHANTIER', 58, 54, '#d6202b'); text('INTERDIT AU PUBLIC', 34, 108, '#111'); text('Port du casque et des EPI obligatoire', 19, 150, '#111');
    [[110, 'casque'], [192, 'gilet'], [274, 'chaussures']].forEach(([cx]) => { x.beginPath(); x.arc(cx, 204, 32, 0, 7); x.fillStyle = '#1b5fb4'; x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, 208, 15, Math.PI, 0); x.fill(); x.fillRect(cx - 19, 207, 38, 5); }); y.fillStyle = '#aab0b6'; y.fillRect(0, 0, w, h);
  } else {
    rr(x, 3, 3, w - 6, h - 6, 12); x.fillStyle = kind === 'KM' || kind !== 'PIETONS' ? '#ffd21f' : '#ffd21f'; x.fill(); x.lineWidth = 7; x.strokeStyle = '#111'; x.stroke(); y.fillStyle = '#aab0b6'; y.fillRect(0, 0, w, h);
    if (kind === 'KM') text(txt || '150 m', 62, h / 2 + 4);
    else if (kind === 'BARREE') { text('ROUTE', 62, 78); text('BARRÉE', 62, 160); }
    else if (kind === 'PIETONS') { text('PIÉTONS', 58, 78); arrow(w / 2, 168, 170, txt === 'g' ? -1 : 1); }
    else { text('DÉVIATION', 52, 76); arrow(w / 2, 166, 190, txt === 'g' ? -1 : 1); }
  }
  const mkT = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const r = { f: new THREE.MeshBasicMaterial({ map: mkT(c), transparent: true, alphaTest: 0.5, side: THREE.FrontSide }), b: new THREE.MeshBasicMaterial({ map: mkT(back), transparent: true, alphaTest: 0.5, side: THREE.BackSide }) };
  TEX.set(key, r); return r;
}
const SIZE = { AK5: [1, 0.87], AK17: [1, 0.87], AK14: [1, 0.87], B1: [0.85, 0.85], B0: [0.85, 0.85], B14: [0.85, 0.85], KM: [0.9, 0.25], KC1: [0.8, 0.6], BARREE: [0.8, 0.6], PIETONS: [0.8, 0.6], KD22: [1.3, 0.3], K2: [1.75, 0.25], K8: [0.9, 0.9], CHANTIER: [1.2, 0.8] };
// une plaque dont la face regarde +X, centrée en (0, y, z)
function plate(g, kind, txt, y, z) {
  const [w, h] = SIZE[kind] || [0.8, 0.6], t = signTex(kind, txt);
  const mk = m => { const p = new THREE.PlaneGeometry(w, h); p.rotateX(Math.PI / 2); p.rotateZ(Math.PI / 2); p.translate(0.012, y, z); return new THREE.Mesh(p, m); };
  g.add(mk(t.f)); const bk = mk(t.b); g.add(bk); return h;
}
/* panneau temporaire sur chevalet lesté : liste de plaques empilées du haut vers le bas */
export function sign(list) {
  const g = new THREE.Group(), b = new B(), gv = mat(GALVA, { shine: 40 });
  let z = 0.55; const hs = list.map(k => (SIZE[Array.isArray(k) ? k[0] : k] || [0.8, 0.6])[1]); const top = z + hs.reduce((a, c) => a + c + 0.04, 0);
  let zz = top; list.forEach((k, i) => { const kind = Array.isArray(k) ? k[0] : k, txt = Array.isArray(k) ? k[1] : ''; zz -= hs[i]; plate(g, kind, txt, 0, zz + hs[i] / 2); zz -= 0.04; });
  for (const s of [-1, 1]) { b.cyl(0.016, 0.016, V(0.16, s * 0.34, 0), V(0, s * 0.2, top - 0.1), gv, 6).cyl(0.016, 0.016, V(-0.55, s * 0.3, 0), V(-0.01, s * 0.2, top - 0.25), gv, 6); }
  b.cyl(0.014, 0.014, V(-0.3, -0.26, 0.42), V(-0.3, 0.26, 0.42), gv, 6).cyl(0.014, 0.014, V(0.1, -0.3, 0.3), V(0.1, 0.3, 0.3), gv, 6);
  b.sphere(0.2, V(-0.2, 0, 0.09), mat('#e06d1e'), V(1.25, 1, 0.42));
  b.finish(g); return g;
}
/* barrage K2 : lisse rayée rouge et blanc de 1,75 × 0,25 m sur deux pieds */
export function barrierK2(width) {
  const g = new THREE.Group(), b = new B(), gv = mat(GALVA, { shine: 40 }), n = Math.max(1, Math.round(width / 1.85)), w = width / n;
  for (let k = 0; k < n; k++) {
    const y = -width / 2 + w * (k + 0.5), t = signTex('K2');
    for (const z of [0.95, 0.55]) { const p = new THREE.PlaneGeometry(Math.min(1.75, w - 0.08), 0.25); p.rotateX(Math.PI / 2); p.rotateZ(Math.PI / 2); p.translate(0.02, y, z); g.add(new THREE.Mesh(p, new THREE.MeshBasicMaterial({ map: t.f.map, side: THREE.DoubleSide }))); }
    for (const s of [-1, 1]) { const yy = y + s * (Math.min(1.75, w - 0.08) / 2 - 0.12); b.cyl(0.018, 0.018, V(0, yy, 0), V(0, yy, 1.1), gv, 6).box(0.6, 0.06, 0.04, V(0, yy, 0.02), gv); }
  }
  b.finish(g); return g;
}
/* barrière de chantier pour cheminement piéton : 2 m, cadre, bandeau rayé, pieds pivotants */
export function barrierPieton(len) {
  const g = new THREE.Group(), b = new B(), o = mat(ORANGE), L = len - 0.06;
  b.cyl(0.02, 0.02, V(-L / 2, 0, 0.05), V(-L / 2, 0, 1.05), o, 8).cyl(0.02, 0.02, V(L / 2, 0, 0.05), V(L / 2, 0, 1.05), o, 8).cyl(0.02, 0.02, V(-L / 2, 0, 1.05), V(L / 2, 0, 1.05), o, 8).cyl(0.016, 0.016, V(-L / 2, 0, 0.25), V(L / 2, 0, 0.25), o, 8);
  for (let x = -L / 2 + 0.2; x < L / 2; x += 0.2) b.cyl(0.008, 0.008, V(x, 0, 0.25), V(x, 0, 0.78), o, 6);
  for (let i = 0; i < 8; i++) b.box(L / 8, 0.012, 0.2, V(-L / 2 + L / 16 + i * L / 8, 0, 0.9), mat(i % 2 ? '#ffffff' : '#d6402b'));
  for (const s of [-1, 1]) b.box(0.05, 0.5, 0.04, V(s * L / 2, 0, 0.02), mat(DARK));
  b.finish(g); return g;
}
/* feu tricolore de chantier sur chariot : coffre batterie, roues, mât, tête à trois optiques avec visières */
export function trafficLight(green) {
  const g = new THREE.Group(), b = new B(), yl = mat('#f2c21b'), dk = mat('#1d2126'), gv = mat(GALVA, { shine: 40 });
  b.box(0.6, 0.5, 0.45, V(-0.1, 0, 0.42), yl).box(0.62, 0.52, 0.03, V(-0.1, 0, 0.66), dk).box(0.5, 0.02, 0.12, V(-0.1, -0.26, 0.5), mat('#111'));
  for (const s of [-1, 1]) b.cyl(0.14, 0.14, V(-0.25, s * 0.3, 0.14), V(-0.25, s * 0.38, 0.14), mat(TIRE), 14); b.cyl(0.02, 0.02, V(0.15, 0.2, 0), V(0.15, 0.2, 0.2), gv, 6).cyl(0.02, 0.02, V(0.15, -0.2, 0), V(0.15, -0.2, 0.2), gv, 6);
  b.cyl(0.03, 0.03, V(-0.1, 0, 0.65), V(-0.1, 0, 2.05), gv, 10).cyl(0.02, 0.02, V(-0.38, 0, 0.7), V(-0.55, 0, 1.0), gv, 6);
  b.box(0.2, 0.3, 0.86, V(-0.1, 0, 2.45), dk);
  const cols = green ? ['#3a1512', '#3a2f12', '#2ed16b'] : ['#ff3b2b', '#3a2f12', '#123a1f'];
  cols.forEach((c, i) => { const z = 2.73 - i * 0.28; g.add(Object.assign(new THREE.Mesh(new THREE.CircleGeometry(0.1, 18).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0.002, 0, z), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })))); b.lathe([[0.115, 0], [0.115, 0.14]], V(0.0, 0, z), X, dk, 14); });
  b.finish(g); return g;
}
/* portail de chantier : deux vantaux de clôture, poteaux, panneau d'interdiction */
export function gate(gw) {
  const g = new THREE.Group(), b = new B(), gv = mat(GALVA, { shine: 40 }), pm = mat(STEEL);
  for (const s of [-1, 1]) { b.box(0.14, 0.14, 2.3, V(s * gw / 2, 0, 1.15), pm).box(0.4, 0.4, 0.1, V(s * gw / 2, 0, 0.05), mat('#a9a69e')); const x0 = s * 0.03, x1 = s * (gw / 2 - 0.1);
    for (const z of [0.2, 1.1, 2.0]) b.cyl(0.02, 0.02, V(x0, 0, z), V(x1, 0, z), gv, 8); b.cyl(0.02, 0.02, V(x0, 0, 0.2), V(x0, 0, 2.0), gv, 8).cyl(0.012, 0.012, V(x0, 0, 0.2), V(x1, 0, 2.0), gv, 6);
    const pl = new THREE.PlaneGeometry(Math.abs(x1 - x0), 1.8); pl.rotateX(Math.PI / 2); pl.translate((x0 + x1) / 2, 0, 1.1); g.add(new THREE.Mesh(pl, meshMat())); }
  b.box(0.3, 0.04, 0.14, V(0, 0.03, 1.1), mat(DARK));
  const sg = new THREE.Group(); plate(sg, 'CHANTIER', '', 0, 1.45); sg.rotation.z = -Math.PI / 2; sg.position.set(gw / 4, -0.05, 0); g.add(sg);
  b.finish(g); return g;
}
