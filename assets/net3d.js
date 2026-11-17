/* Réseaux en 3D détaillée, à l'échelle réelle (mètres).
   Cotes tirées des fiches techniques fabricants :
   - tubes PEHD PE100 SDR11 (ép. = Ø/11 : 32×3,0 · 63×5,8 · 110×10 · 140×12,7), noirs à bandes ;
   - fonte ductile PAM Natural (DN250 : DE 274, emboîture Ø352 prof. 105 ; DN150 : DE 170 ; DN100 : DE 118) ;
   - tuyaux béton armé 135A (Ø300 : ép. 53, fût 406, collet 510 ; Ø400 : ép. 60, fût 520 ; longueur utile 2,40 m) ;
   - brides EN 1092-2 PN16 (DN100 : Ø220, perçage 180, 8 trous) ; vannes à opercule série courte F4 (DN100 : 190 mm) ;
   - regards PP Wavin Tegra 600/1000 (rehausse annelée Ø600/670, cône, couronne de répartition Ø980 h 186) ;
   - regards béton Ø1000 (paroi 100, tête réductrice excentrée h 600, rehausse sous cadre) ;
   - tampon fonte PAM Pamrex 600 D400 (cadre Ø850, ouverture 610, h 100) ; bouche à clé PAM/EJ (embase Ø240, h 200, tube Ø90) ;
   - poteau d'incendie Bayard DN100 (h hors sol ≈ 760, 1 × 100 + 2 × 65, carré de 30) ; bouche d'incendie (coffre 424 × 305) ;
   - compteur DN20 longueur 190, regard de comptage Ø330-400. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0), Z = V(0, 0, 1), X = V(1, 0, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- matières ---------- */
const MATS = new Map();
function mat(color, o = {}) {
  const k = color + '|' + (o.opacity || 1) + '|' + (o.shine || 0) + '|' + (o.stripe || '') + (o.n || '');
  if (MATS.has(k)) return MATS.get(k);
  const p = { color, side: THREE.DoubleSide };
  if (o.opacity && o.opacity < 1) { p.transparent = true; p.opacity = o.opacity; p.depthWrite = false; }
  if (o.stripe) { p.map = stripes(color, o.stripe, o.n || 4); p.color = '#ffffff'; }
  const m = o.shine ? new THREE.MeshPhongMaterial(Object.assign(p, { shininess: o.shine, specular: 0x555555 })) : new THREE.MeshLambertMaterial(p);
  MATS.set(k, m); return m;
}
// bandes longitudinales (liseré d'identification du réseau), répétées autour du tube
function stripes(base, col, n) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 4;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 64, 4); g.fillStyle = col; g.fillRect(26, 0, 12, 4);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(n, 1); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const C = { pe: '#17191c', pvc: '#8d949a', pvcA: '#aaa397', pp: '#c2641f', fonte: '#2f6db5', fonteOld: '#3b3e42', beton: '#b9b6ae', ac: '#cdcfca', epoxy: '#1e5aa8', galva: '#b9bec4', laiton: '#b38f3d', cast: '#2a2c2f', rouge: '#c8102e', alu: '#cfd3d6', allonge: '#70809a', ppOr: '#d2691e', vert: '#2f6b46' };

/* ---------- assemblage : on empile des formes, fusionnées par matière à la fin ---------- */
function perp(d) { const u = Math.abs(d.z) > 0.9 ? X.clone() : Z.clone(); u.addScaledVector(d, -u.dot(d)).normalize(); return [u, new THREE.Vector3().crossVectors(d, u)]; }
class B {
  constructor() { this.parts = new Map(); }
  push(g, m) { if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; } if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); (this.parts.get(m) || this.parts.set(m, []).get(m)).push(g); return this; }
  cyl(r1, r2, a, b, m, seg = 18, open = false) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length(); if (L < 1e-5) return this;
    const g = new THREE.CylinderGeometry(r2, r1, L, seg, 1, open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return this.push(g, m);
  }
  // profil [rayon, cote] tourné autour de l'axe qui part de o dans la direction dir
  lathe(prof, o, dir, m, seg = 26) {
    const g = new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(Math.max(0, p[0]), p[1])), seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize())); g.translate(o.x, o.y, o.z); return this.push(g, m);
  }
  box(sx, sy, sz, c, m, rz = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); if (rz) g.rotateZ(rz); g.translate(c.x, c.y, c.z); return this.push(g, m); }
  sphere(r, c, m, s = null) { const g = new THREE.SphereGeometry(r, 18, 12); if (s) g.scale(s.x, s.y, s.z); g.translate(c.x, c.y, c.z); return this.push(g, m); }
  // n boulons (tige, tête et écrou hexagonaux) répartis sur un cercle de rayon R autour de c, parallèles à dir
  bolts(n, R, c, dir, len, d, m, ph = 0) {
    const [u, v] = perp(dir.clone().normalize()), h = dir.clone().normalize().multiplyScalar(len / 2);
    for (let k = 0; k < n; k++) {
      const a = ph + k * 2 * Math.PI / n, p = c.clone().addScaledVector(u, Math.cos(a) * R).addScaledVector(v, Math.sin(a) * R);
      const a0 = p.clone().sub(h), b0 = p.clone().add(h), e = h.clone().setLength(d * 0.8);
      this.cyl(d / 2, d / 2, a0, b0, m, 6); this.cyl(d * 0.85, d * 0.85, a0, a0.clone().add(e), m, 6); this.cyl(d * 0.85, d * 0.85, b0.clone().sub(e), b0, m, 6);
    }
    return this;
  }
  // tube de rayon r qui suit une suite de points {p, t} (t : tangente)
  sweep(S, r, m, seg = 18) {
    const n = S.length; if (n < 2) return this;
    const pos = new Float32Array(n * (seg + 1) * 3), nor = new Float32Array(n * (seg + 1) * 3), uv = new Float32Array(n * (seg + 1) * 2), idx = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      const t = S[i].t, N = Z.clone().addScaledVector(t, -Z.dot(t)); if (N.lengthSq() < 1e-6) N.copy(X).addScaledVector(t, -X.dot(t)); N.normalize();
      const Bn = new THREE.Vector3().crossVectors(t, N); if (i) len += S[i].p.distanceTo(S[i - 1].p);
      for (let j = 0; j <= seg; j++) {
        const a = j / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), k = (i * (seg + 1) + j) * 3;
        const nx = N.x * c + Bn.x * s, ny = N.y * c + Bn.y * s, nz = N.z * c + Bn.z * s;
        pos[k] = S[i].p.x + nx * r; pos[k + 1] = S[i].p.y + ny * r; pos[k + 2] = S[i].p.z + nz * r; nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
        uv[(i * (seg + 1) + j) * 2] = j / seg; uv[(i * (seg + 1) + j) * 2 + 1] = len;
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    return this.push(g, m);
  }
  ring(ro, ri, c, dir, m) { const g = new THREE.RingGeometry(ri, ro, 24); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, dir.clone().normalize())); g.translate(c.x, c.y, c.z); return this.push(g, m); }
  finish(root, mx) {
    this.parts.forEach((list, m) => {
      const g = list.length > 1 ? mergeGeometries(list, false) : list[0]; if (!g) return;
      if (list.length > 1) list.forEach(x => x.dispose());
      if (mx) g.applyMatrix4(mx);
      const me = new THREE.Mesh(g, m); if (m.transparent) me.renderOrder = 2; root.add(me);
    });
    this.parts.clear(); return root;
  }
}

/* ---------- tables de cotes (mm) ---------- */
// brides PN16 EN 1092-2 : Ø extérieur, Ø de perçage, nombre de trous, Ø des trous, épaisseur
const FL = { 25: [115, 85, 4, 14, 14], 32: [140, 100, 4, 19, 16], 40: [150, 110, 4, 19, 16], 50: [165, 125, 4, 19, 16], 60: [175, 135, 4, 19, 16], 65: [185, 145, 4, 19, 16], 80: [200, 160, 8, 19, 19], 100: [220, 180, 8, 19, 19], 125: [250, 210, 8, 19, 19], 150: [285, 240, 8, 23, 19], 200: [340, 295, 12, 23, 20], 250: [405, 355, 12, 28, 22], 300: [460, 410, 12, 28, 24.5], 400: [580, 525, 16, 31, 28] };
const F4 = { 25: 120, 32: 130, 40: 140, 50: 150, 60: 170, 65: 170, 80: 180, 100: 190, 125: 200, 150: 210, 200: 230, 250: 250, 300: 270, 400: 310 };
const DNS = Object.keys(FL).map(Number);
const PE_DN = { 20: 25, 25: 25, 32: 25, 40: 32, 50: 40, 63: 50, 75: 65, 90: 80, 110: 100, 125: 100, 140: 125, 160: 150, 180: 150, 200: 200, 225: 200, 250: 250, 280: 250, 315: 300, 400: 400 };
const FONTE_DE = { 60: 77, 80: 98, 100: 118, 125: 144, 150: 170, 200: 222, 250: 274, 300: 326, 350: 378, 400: 429, 500: 532, 600: 635 };
const nearDN = v => DNS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a, 100);
const dnOf = (odmm, m) => m === 'FONTE' || m === 'BÉTON' || m === 'AC' ? nearDN(odmm) : (PE_DN[Math.round(odmm)] || nearDN(odmm * 0.9));

/* La conduite telle qu'elle est fabriquée : diamètre extérieur réel, épaisseur, teinte, emboîtures */
function pipeSpec(n) {
  const x = n.x || {}, d = +n.diam || 100, m = x.mat || '', aep = n.type === 'aep', old = /_e$|^ab/.test(x.net || '');
  if (m === 'PEHD') return { od: d / 1000, e: d / 11000, base: C.pe, n: 4, joint: d >= 90 ? 12 : 0, kind: 'weld', inner: '#101214' };
  if (m === 'FONTE') { const de = FONTE_DE[nearDN(d)] || d * 1.1; return { od: de / 1000, e: (5 + d / 50 + 4) / 1000, base: old ? C.fonteOld : C.fonte, n: 0, joint: 6, kind: 'bell', inner: '#c9c5ba' }; }
  if (m === 'BÉTON') { const e = d <= 300 ? 53 : d <= 400 ? 60 : d <= 500 ? 67 : 75 + (d - 600) / 10; return { od: (d + 2 * e) / 1000, e: e / 1000, base: C.beton, n: 0, joint: 2.4, kind: 'collet', inner: '#a9a69e' }; }
  if (m === 'AC') return { od: d * 1.13 / 1000, e: d * 0.065 / 1000, base: C.ac, n: 0, joint: 5, kind: 'sleeve', inner: '#bdbfba' };
  if (m === 'PP') return { od: d / 1000, e: d * 0.045 / 1000, base: C.pp, n: 0, joint: 6, kind: 'socket', inner: '#e9e2d2' };
  if (m === 'PVC') return { od: d / 1000, e: Math.max(3, d / (aep ? 21 : 34)) / 1000, base: aep ? C.pvc : C.pvcA, n: 0, joint: 6, kind: 'socket', inner: aep ? '#7d848a' : '#96907f' };
  return { od: d / 1000, e: Math.max(3, d / 20) / 1000, base: aep ? C.pe : C.pvc, n: aep ? 4 : 0, joint: 0, kind: '', inner: '#555' };
}

/* Tracé d'une conduite : les angles deviennent des coudes de rayon 1,5 Ø (repris par les raccords) */
function pathOf(P, od, bends) {
  const S = [], n = P.length, dir = i => new THREE.Vector3().subVectors(P[i + 1], P[i]).normalize();
  S.push({ p: P[0].clone(), t: dir(0) });
  for (let i = 1; i < n - 1; i++) {
    const d1 = dir(i - 1), d2 = dir(i), cs = clamp(d1.dot(d2), -1, 1), th = Math.acos(cs);
    if (th < 0.035) { S.push({ p: P[i].clone(), t: d1.clone().add(d2).normalize() }); continue; }
    if (th > 3.05) { S.push({ p: P[i].clone(), t: d1 }); S.push({ p: P[i].clone(), t: d2 }); continue; }
    const L1 = P[i].distanceTo(P[i - 1]), L2 = P[i].distanceTo(P[i + 1]), tg = Math.tan(th / 2);
    const t = Math.min(Math.max(1.5 * od, 0.12) * tg, 0.45 * L1, 0.45 * L2), R = t / tg;
    const A = P[i].clone().addScaledVector(d1, -t), n1 = d2.clone().addScaledVector(d1, -cs).normalize(), Cc = A.clone().addScaledVector(n1, R), k = Math.max(3, Math.ceil(th / 0.16));
    const arc = [];
    for (let s = 0; s <= k; s++) { const f = th * s / k; arc.push({ p: Cc.clone().addScaledVector(n1, -Math.cos(f) * R).addScaledVector(d1, Math.sin(f) * R), t: d1.clone().multiplyScalar(Math.cos(f)).addScaledVector(n1, Math.sin(f)).normalize() }); }
    arc.forEach(a => S.push(a));
    if (bends) bends.push({ V: P[i].clone(), arc, d1, d2, th, od });
  }
  S.push({ p: P[n - 1].clone(), t: dir(n - 2) });
  return S;
}

function buildPipe(n, P, root, bends) {
  const sp = pipeSpec(n), x = n.x || {}, ro = sp.od / 2, ri = Math.max(ro * 0.55, ro - sp.e), col = n.col || '#6b7480', ghost = x.dash === 'dashed' ? 0.55 : 1;
  const b = new B(), S = pathOf(P, sp.od, bends);
  const outer = mat(sp.base, { stripe: col, n: sp.n || 2, opacity: ghost, shine: sp.base === C.pe ? 30 : 0 }), inner = mat(sp.inner, { opacity: ghost }), body = mat(sp.base, { opacity: ghost, shine: sp.base === C.pe ? 30 : 0 });
  b.sweep(S, ro, outer, ro > 0.06 ? 22 : 14).sweep(S, ri, inner, 12);
  b.ring(ro, ri, S[0].p, S[0].t, body).ring(ro, ri, S[S.length - 1].p, S[S.length - 1].t, body);
  // emboîtures, collets, manchons ou cordons de soudure à chaque longueur de tuyau
  if (sp.joint) {
    let acc = 0, next = sp.joint, count = 0;
    for (let i = 0; i < P.length - 1 && count < 400; i++) {
      const L = P[i].distanceTo(P[i + 1]), d = new THREE.Vector3().subVectors(P[i + 1], P[i]).normalize();
      while (next < acc + L) {
        const s = next - acc; next += sp.joint;
        if (s < 0.5 || L - s < 0.5) continue;
        const o = P[i].clone().addScaledVector(d, s); count++;
        if (sp.kind === 'bell') b.lathe([[ro, -0.02], [ro * 1.1, 0], [ro * 1.285, 0.03], [ro * 1.285, 0.085], [ro * 1.2, 0.105], [ro, 0.105]], o, d, body);
        else if (sp.kind === 'collet') b.lathe([[ro, -0.05], [ro + 0.052, 0], [ro + 0.052, 0.13], [ro, 0.13]], o, d, body);
        else if (sp.kind === 'socket') b.lathe([[ro, -0.02], [ro * 1.09, 0], [ro * 1.09, ro * 0.9], [ro * 1.17, ro * 1.0], [ro * 1.17, ro * 1.25], [ro * 1.06, ro * 1.35], [ro, ro * 1.35]], o, d, body);
        else if (sp.kind === 'sleeve') b.lathe([[ro, 0], [ro * 1.22, 0.01], [ro * 1.22, 0.17], [ro, 0.18]], o, d, body);
        else if (sp.kind === 'weld') b.lathe([[ro, -0.006], [ro + 0.004, -0.002], [ro + 0.004, 0.002], [ro, 0.006]], o, d, body, 16);
      }
      acc += L;
    }
  }
  b.finish(root);
  // un fil de la couleur du réseau, toujours visible de loin
  const g = new THREE.BufferGeometry().setFromPoints(S.map(s => s.p.clone().add(V(0, 0, ro + 0.015))));
  const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col })); ln.userData.keepGeo = true; root.add(ln);
  return sp;
}

/* ---------- pièces communes ---------- */
// deux brides boulonnées en x (axe X local) : la bride de l'appareil et la contre-bride
function flanges(b, x, dn, mA, mB, sgn = 1) {
  const F = FL[dn] || FL[100], D = F[0] / 2000, th = F[4] / 1000;
  b.cyl(D, D, V(x, 0, 0), V(x + sgn * th, 0, 0), mA, 30).cyl(D, D, V(x, 0, 0), V(x - sgn * th, 0, 0), mB, 30);
  b.bolts(F[2], F[1] / 2000, V(x, 0, 0), X, 2 * th + 0.034, (F[3] - 3) / 1000, mat(C.galva, { shine: 60 }), Math.PI / F[2]);
  return th;
}
// tube allonge et tête de bouche à clé affleurant le sol (zG)
function boucheACle(b, x, y, zFrom, zG, col) {
  if (zG - zFrom > 0.3) b.cyl(0.045, 0.045, V(x, y, zFrom), V(x, y, zG - 0.19), mat(C.allonge), 14, true);
  b.lathe([[0.12, 0], [0.12, 0.018], [0.07, 0.05], [0.078, 0.2], [0.05, 0.2], [0.05, 0.02]], V(x, y, zG - 0.2), Z, mat(C.cast, { shine: 20 }));
  b.cyl(0.052, 0.052, V(x, y, zG - 0.012), V(x, y, zG + 0.002), mat(col), 18);
}
// cadre et tampon fonte Ø600 (cadre Ø850, h 100) affleurant le sol
function tampon(b, x, y, zG, col, k = 1) {
  const cast = mat(C.cast, { shine: 25 });
  b.lathe([[0.425 * k, -0.1], [0.425 * k, 0], [0.335 * k, 0], [0.322 * k, -0.1]], V(x, y, zG), Z, cast, 36);
  b.cyl(0.322 * k, 0.322 * k, V(x, y, zG - 0.03), V(x, y, zG - 0.004), cast, 36);
  for (const r of [0.29, 0.21, 0.13]) b.lathe([[r * k - 0.012, -0.004], [r * k - 0.006, 0.003], [r * k + 0.006, 0.003], [r * k + 0.012, -0.004]], V(x, y, zG), Z, cast, 30);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; b.box(0.07 * k, 0.012, 0.007, V(x + Math.cos(a) * 0.25 * k, y + Math.sin(a) * 0.25 * k, zG - 0.001), cast, a); }
  b.box(0.09 * k, 0.05, 0.02, V(x + 0.335 * k, y, zG - 0.008), cast);
  b.cyl(0.085 * k, 0.085 * k, V(x, y, zG - 0.004), V(x, y, zG + 0.004), mat(col), 20);
}
// regard en béton vu en transparence, pour laisser voir l'appareil qu'il abrite
function chambre(b, x, y, zBot, zG, col, ri = 0.5) {
  const gl = mat(C.beton, { opacity: 0.26 });
  b.lathe([[ri, zBot], [ri + 0.1, zBot], [ri + 0.1, zG - 0.3], [ri, zG - 0.3]], V(x, y, 0), Z, gl, 30);
  b.cyl(ri + 0.15, ri + 0.15, V(x, y, zBot - 0.12), V(x, y, zBot), gl, 30);
  b.lathe([[0.33, zG - 0.3], [ri + 0.1, zG - 0.3], [ri + 0.1, zG - 0.1], [0.33, zG - 0.1]], V(x, y, 0), Z, gl, 30);
  tampon(b, x, y, zG, col);
}
// profil annelé (rehausse de regard PP)
function annele(r, z0, z1, pitch = 0.07, amp = 0.032) { const p = []; for (let z = z0; z < z1 - pitch * 0.5; z += pitch) p.push([r, z], [r + amp, z + pitch * 0.25], [r + amp, z + pitch * 0.6], [r, z + pitch * 0.85]); p.push([r, z1]); return p; }

/* ---------- regards ---------- */
function buildRegard(n, e, root) {
  const x = n.x || {}, col = n.col || '#6b7480', D = (+n.diam || 1000) / 1000, depth = Math.max(0.7, n.depth || 1.8), nat = (x.nat || n.name || '').toLowerCase(), b = new B(), zb = -depth;
  const concrete = mat(C.beton), O = V(0, 0, 0);
  if (/branchement|bo[iî]te/.test(nat) || D < 0.45) {
    // boîte de branchement : tabouret et tube Ø315, cadre fonte carré, tampon rond
    const r = Math.max(0.125, D / 2), pv = mat(C.pvcA);
    b.lathe([[r * 1.25, zb - 0.05], [r * 1.25, zb + 0.22], [r, zb + 0.3], [r, -0.14]], O, Z, pv);
    b.box(0.5, 0.5, 0.1, V(0, 0, -0.17), concrete).box(0.4, 0.4, 0.06, V(0, 0, -0.03), mat(C.cast, { shine: 25 }));
    b.cyl(0.15, 0.15, V(0, 0, -0.01), V(0, 0, 0.003), mat(C.cast, { shine: 25 }), 24).cyl(0.06, 0.06, V(0, 0, 0), V(0, 0, 0.005), mat(col), 16);
  } else if (/\bpp\b|pehd|polypro/.test(nat)) {
    // regard polypropylène : fond, rehausse annelée, cône, couronne de répartition béton, tampon fonte
    const or = mat(C.ppOr), r = D / 2 + 0.035, big = D > 0.7, zt = -0.29, zc = big ? zt - 0.6 : zt;
    b.lathe([[r + 0.03, zb - 0.06], [r + 0.03, zb + 0.4], [r, zb + 0.45]], O, Z, or).cyl(r + 0.03, r + 0.03, V(0, 0, zb - 0.07), V(0, 0, zb - 0.05), or, 26);
    b.lathe(annele(r, zb + 0.45, zc), O, Z, or, 30);
    if (big) b.lathe([[r, zc], [r + 0.02, zc + 0.05], [0.37, zt - 0.08], [0.335, zt]], O, Z, or, 30);
    b.lathe([[0.3435, zt], [0.49, zt], [0.49, zt + 0.186], [0.3435, zt + 0.186]], O, Z, concrete, 32);
    tampon(b, 0, 0, 0, col);
  } else {
    // regard béton : radier, éléments droits (joints tous les 60 cm), tête réductrice excentrée ou dalle, rehausse sous cadre
    const ri = D / 2, r = ri + 0.1, chamber = /chambre/.test(nat), zt = chamber ? -0.32 : -0.87;
    b.cyl(r + 0.08, r + 0.08, V(0, 0, zb - 0.15), V(0, 0, zb), concrete, 30);
    const p = [[r, zb]]; for (let z = zb + 0.6; z < zt - 0.15; z += 0.6) p.push([r, z - 0.012], [r - 0.012, z - 0.006], [r - 0.012, z + 0.006], [r, z + 0.012]); p.push([r, zt]);
    b.lathe(p, O, Z, concrete, 32);
    const sx = chamber ? 0 : r - 0.4;
    if (chamber) b.lathe([[0.31, zt], [r, zt], [r, zt + 0.2], [0.31, zt + 0.2]], O, Z, concrete, 32);
    else {
      const g = new THREE.LatheGeometry([[r, 0], [0.4, 0.6]].map(q => new THREE.Vector2(q[0], q[1])), 32); g.rotateX(Math.PI / 2);
      const a = g.attributes.position; for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) + sx * a.getZ(i) / 0.6); g.translate(0, 0, zt); g.computeVertexNormals(); b.push(g, concrete);
      b.lathe([[0.31, -0.27], [0.4, -0.27], [0.4, -0.1], [0.31, -0.1]], V(sx, 0, 0), Z, concrete, 30);
    }
    tampon(b, sx, 0, 0, col);
  }
  b.finish(root, new THREE.Matrix4().makeTranslation(e.x, e.y, 0));
}

/* ---------- accessoires (repère local : X le long de la conduite, Z vers le haut, origine sur l'axe) ---------- */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
function kindOf(x, name) {
  const s = norm((x.sym || '') + ' ' + (x.an || '') + ' ' + (name || ''));
  if (/REDUCTEUR DE PRESSION|STAB|LIMITEUR|REGUL/.test(s)) return 'prv';
  if (/POTEAU|_PI\b|AEP_PI/.test(s)) return 'pi';
  if (/BOUCHE D.?INCENDIE|_BI\b/.test(s)) return 'bi';
  if (/VENTOUSE/.test(s)) return 'ventouse';
  if (/PURG|VIDANGE/.test(s)) return 'purge';
  if (/COMPTEUR|CITERN/.test(s)) return 'compteur';
  if (/CLAPET/.test(s)) return 'clapet';
  if (/COUDE/.test(s)) return 'coude';
  if (/RAC_TE|\bTE\b|PERPENDICULAIRE/.test(s)) return 'te';
  if (/CONE|REDUCTION/.test(s)) return 'cone';
  if (/BOUCHON|TAMPONNAGE|PLAQUE PLEINE/.test(s)) return 'bouchon';
  if (/COLLIER|PRISE DE BRANCHEMENT|PRISE EN CHARGE/.test(s)) return 'collier';
  if (/CROISEMENT|FRANCHISSEMENT/.test(s)) return 'cadre';
  if (/VANNE|ROBINET/.test(s)) return 'vanne';
  if (/MANCHON|RACCORD|TRANSITION|JOINT|ADAPTATEUR/.test(s)) return 'manchon';
  return 'autre';
}
// corps d'appareil à brides le long de X, avec ses contre-brides sur la conduite
function corpsBrides(b, dn, L, rp, m, mCB) {
  const F = FL[dn] || FL[100], th = F[4] / 1000, rn = Math.max(dn / 1000 * 0.62, rp * 1.06), D = F[0] / 2000;
  flanges(b, -L / 2, dn, m, mCB, 1); flanges(b, L / 2, dn, m, mCB, -1);
  b.cyl(rp * 1.1, rp * 1.1, V(-L / 2 - th - 0.05, 0, 0), V(-L / 2 - th, 0, 0), mCB, 20).cyl(rp * 1.1, rp * 1.1, V(L / 2 + th, 0, 0), V(L / 2 + th + 0.05, 0, 0), mCB, 20);
  return { th, rn, D };
}
const A = {
  vanne(b, o) {
    const dn = o.dn, L = F4[dn] / 1000, m = mat(C.epoxy, { shine: 40 }), k = dn / 1000, H = 0.12 + 2.15 * k, f = corpsBrides(b, dn, L, o.rp, m, o.mCB);
    b.lathe([[f.rn, -L / 2 + f.th], [k * 0.8, -L * 0.18], [k * 0.8, L * 0.18], [f.rn, L / 2 - f.th]], V(0, 0, 0), X, m);
    b.lathe([[k * 0.8, 0], [k * 0.72, k * 0.75], [k * 0.86, k * 0.78], [k * 0.86, k * 0.98], [k * 0.5, k * 1.05], [k * 0.36, H * 0.72], [0.034, H * 0.78], [0.034, H - 0.03]], V(0, 0, 0), Z, m);
    b.bolts(Math.max(4, Math.round(dn / 25)), k * 0.78, V(0, 0, k * 0.88), Z, k * 0.2 + 0.03, 0.014, mat(C.galva, { shine: 60 }));
    b.box(0.03, 0.03, 0.035, V(0, 0, H - 0.012), mat(C.galva, { shine: 60 }), Math.PI / 4);
    b.lathe([[0.06, H * 0.8], [0.075, H * 0.8], [0.06, H + 0.03], [0.045, H + 0.03]], V(0, 0, 0), Z, mat(C.cast));
    boucheACle(b, 0, 0, H + 0.03, o.zG, o.col);
  },
  clapet(b, o) {
    const dn = o.dn, L = Math.max(0.18, dn / 1000 * 3), m = mat(C.epoxy, { shine: 40 }), k = dn / 1000, f = corpsBrides(b, dn, L, o.rp, m, o.mCB);
    b.lathe([[f.rn, -L / 2 + f.th], [k * 0.85, -L * 0.2], [k * 0.9, L * 0.1], [f.rn, L / 2 - f.th]], V(0, 0, 0), X, m);
    b.cyl(k * 0.7, k * 0.7, V(-L * 0.08, 0, k * 0.5), V(-L * 0.08, 0, k * 1.05), m, 20).cyl(k * 0.85, k * 0.85, V(-L * 0.08, 0, k * 1.05), V(-L * 0.08, 0, k * 1.05 + 0.022), m, 20);
    b.bolts(6, k * 0.74, V(-L * 0.08, 0, k * 1.06), Z, 0.05, 0.014, mat(C.galva, { shine: 60 }));
    b.box(k * 0.5, 0.012, 0.012, V(0.02, 0, k * 1.09), mat('#f2f2f2'));
  },
  prv(b, o) {
    const dn = o.dn, L = Math.max(0.2, dn / 1000 * 3.5), m = mat(C.epoxy, { shine: 40 }), k = dn / 1000, f = corpsBrides(b, dn, L, o.rp, m, o.mCB), gv = mat(C.galva, { shine: 60 });
    b.sphere(k * 0.95, V(0, 0, 0), m, V(1.15, 1, 1)).cyl(f.rn, f.rn, V(-L / 2 + f.th, 0, 0), V(L / 2 - f.th, 0, 0), m, 20);
    b.lathe([[k * 0.95, k * 0.7], [k * 1.05, k * 0.75], [k * 1.05, k * 0.95], [k * 0.8, k * 1.0], [k * 0.75, k * 1.9], [k * 0.4, k * 2.3], [0.02, k * 2.35], [0.02, k * 2.75]], V(0, 0, 0), Z, m);
    b.bolts(8, k * 0.95, V(0, 0, k * 0.85), Z, k * 0.25 + 0.03, 0.014, gv);
    for (const s of [-1, 1]) { b.cyl(0.006, 0.006, V(s * L * 0.3, 0, k * 0.6), V(s * L * 0.3, 0, k * 1.3), mat(C.laiton, { shine: 60 }), 8); b.cyl(0.04, 0.04, V(s * L * 0.3, -0.012, k * 1.3 + 0.04), V(s * L * 0.3, 0.012, k * 1.3 + 0.04), gv, 20); b.cyl(0.034, 0.034, V(s * L * 0.3, -0.0135, k * 1.3 + 0.04), V(s * L * 0.3, -0.0125, k * 1.3 + 0.04), mat('#fafafa'), 20); }
    chambre(b, 0, 0, -o.rp - 0.35, o.zG, o.col, 0.6);
  },
  ventouse(b, o) {
    const m = mat(C.epoxy, { shine: 40 }), rp = o.rp, gv = mat(C.galva, { shine: 60 });
    b.cyl(rp * 1.2, rp * 1.2, V(-0.09, 0, 0), V(0.09, 0, 0), m, 22).cyl(0.04, 0.04, V(0, 0, rp), V(0, 0, rp + 0.12), m, 16);
    const z0 = rp + 0.12; b.cyl(0.0875, 0.0875, V(0, 0, z0), V(0, 0, z0 + 0.016), m, 26).cyl(0.0875, 0.0875, V(0, 0, z0 + 0.016), V(0, 0, z0 + 0.032), m, 26).bolts(4, 0.0675, V(0, 0, z0 + 0.016), Z, 0.06, 0.014, gv);
    // robinet d'arrêt puis corps de ventouse à flotteur
    b.cyl(0.045, 0.045, V(0, 0, z0 + 0.032), V(0, 0, z0 + 0.13), m, 16).cyl(0.02, 0.02, V(0, 0, z0 + 0.08), V(0, 0.11, z0 + 0.08), m, 10).cyl(0.045, 0.045, V(0, 0.11, z0 + 0.08), V(0, 0.125, z0 + 0.08), mat(C.rouge), 14);
    b.lathe([[0.0875, z0 + 0.13], [0.0875, z0 + 0.146], [0.07, z0 + 0.15], [0.092, z0 + 0.2], [0.092, z0 + 0.36], [0.105, z0 + 0.365], [0.105, z0 + 0.385], [0.06, z0 + 0.43], [0.02, z0 + 0.44], [0.02, z0 + 0.46]], V(0, 0, 0), Z, m);
    b.bolts(6, 0.098, V(0, 0, z0 + 0.375), Z, 0.05, 0.012, gv);
    chambre(b, 0, 0, -rp - 0.35, o.zG, o.col, 0.5);
  },
  purge(b, o) {
    const m = mat(C.epoxy, { shine: 40 }), rp = o.rp, pe = mat(C.pe, { shine: 30 });
    b.cyl(rp * 1.2, rp * 1.2, V(-0.07, 0, 0), V(0.07, 0, 0), m, 22).cyl(0.03, 0.03, V(0, 0, 0), V(0, rp + 0.14, 0), m, 14);
    const y = rp + 0.2; b.sphere(0.055, V(0, y, 0), m, V(1, 1.2, 1)).cyl(0.03, 0.022, V(0, y, 0.03), V(0, y, 0.16), m, 12).box(0.03, 0.03, 0.03, V(0, y, 0.17), mat(C.galva, { shine: 60 }), Math.PI / 4);
    boucheACle(b, 0, y, 0.19, o.zG, o.col);
    const y2 = y + 0.3, S = [{ p: V(0, y + 0.05, 0), t: Y }, { p: V(0, y2 - 0.08, 0), t: Y }]; for (let i = 1; i <= 5; i++) { const a = i * Math.PI / 10; S.push({ p: V(0, y2 - 0.08 + Math.sin(a) * 0.08, 0.08 - Math.cos(a) * 0.08), t: V(0, Math.cos(a), Math.sin(a)) }); } S.push({ p: V(0, y2, o.zG - 0.2), t: Z });
    b.sweep(S, 0.025, pe, 12); boucheACle(b, 0, y2, o.zG, o.zG, o.col);
  },
  pi(b, o) {
    // poteau d'incendie DN100 : coude à patin, colonne, corps rouge hors sol, 1 prise de 100 et 2 de 65, carré de manœuvre
    const m = mat(C.epoxy, { shine: 40 }), red = mat(C.rouge, { shine: 50 }), alu = mat(C.alu, { shine: 70 }), zG = o.zG, gv = mat(C.galva, { shine: 60 });
    const S = [{ p: V(-0.3, 0, 0), t: X }, { p: V(-0.16, 0, 0), t: X }]; for (let i = 1; i <= 6; i++) { const a = i * Math.PI / 12; S.push({ p: V(-0.16 + Math.sin(a) * 0.16, 0, 0.16 - Math.cos(a) * 0.16), t: V(Math.cos(a), 0, Math.sin(a)) }); }
    b.sweep(S, 0.062, m, 18).box(0.26, 0.26, 0.03, V(0, 0, -0.105), m).box(0.03, 0.2, 0.1, V(0, 0, -0.05), m);
    flanges(b, -0.3, 100, m, o.mCB, 1);
    b.cyl(0.11, 0.11, V(0, 0, 0.16), V(0, 0, 0.179), m, 28).cyl(0.11, 0.11, V(0, 0, 0.179), V(0, 0, 0.198), m, 28).bolts(8, 0.09, V(0, 0, 0.179), Z, 0.07, 0.016, gv);
    b.cyl(0.07, 0.07, V(0, 0, 0.198), V(0, 0, zG - 0.04), m, 20);
    b.lathe([[0.15, zG - 0.05], [0.15, zG + 0.01], [0.115, zG + 0.04], [0.098, zG + 0.06], [0.098, zG + 0.36], [0.125, zG + 0.4], [0.125, zG + 0.6], [0.11, zG + 0.66], [0.06, zG + 0.72], [0.035, zG + 0.735]], V(0, 0, 0), Z, red, 30);
    b.bolts(6, 0.132, V(0, 0, zG + 0.012), Z, 0.05, 0.016, gv);
    b.cyl(0.022, 0.022, V(0, 0, zG + 0.735), V(0, 0, zG + 0.775), gv, 5);
    const prise = (ang, z, r, len) => { const d = V(Math.cos(ang), Math.sin(ang), 0); b.cyl(r, r, d.clone().multiplyScalar(0.09).setZ(z), d.clone().multiplyScalar(0.125 + len).setZ(z), red, 18); b.lathe([[r * 1.25, 0], [r * 1.25, 0.03], [r * 0.9, 0.045], [0, 0.045]], d.clone().multiplyScalar(0.125 + len).setZ(z), d, alu, 18); for (const s of [-1, 1]) b.box(0.02, 0.02, 0.03, d.clone().multiplyScalar(0.14 + len).setZ(z + s * r * 1.25), alu, ang); };
    prise(Math.PI / 2, zG + 0.43, 0.062, 0.07); prise(Math.PI / 2 + 65 * Math.PI / 180, zG + 0.535, 0.043, 0.06); prise(Math.PI / 2 - 65 * Math.PI / 180, zG + 0.535, 0.043, 0.06);
  },
  bi(b, o) {
    const m = mat(C.epoxy, { shine: 40 }), zG = o.zG, cast = mat(C.cast, { shine: 25 });
    const S = [{ p: V(-0.3, 0, 0), t: X }, { p: V(-0.16, 0, 0), t: X }]; for (let i = 1; i <= 6; i++) { const a = i * Math.PI / 12; S.push({ p: V(-0.16 + Math.sin(a) * 0.16, 0, 0.16 - Math.cos(a) * 0.16), t: V(Math.cos(a), 0, Math.sin(a)) }); }
    b.sweep(S, 0.062, m, 18).box(0.26, 0.26, 0.03, V(0, 0, -0.105), m); flanges(b, -0.3, 100, m, o.mCB, 1);
    b.cyl(0.07, 0.07, V(0, 0, 0.16), V(0, 0, zG - 0.34), m, 20).lathe([[0.07, zG - 0.34], [0.12, zG - 0.3], [0.12, zG - 0.16], [0.075, zG - 0.12], [0.075, zG - 0.05]], V(0, 0, 0), Z, m);
    b.lathe([[0.062, 0], [0.085, 0.01], [0.085, 0.04], [0.062, 0.04]], V(0, 0, zG - 0.08), Z, mat(C.laiton, { shine: 60 }));
    b.box(0.5, 0.38, 0.2, V(0.03, 0, zG - 0.105), mat(C.cast, { opacity: 0.45 })).box(0.424, 0.305, 0.012, V(0.03, 0, zG - 0.003), cast).box(0.3, 0.2, 0.004, V(0.03, 0, zG + 0.004), mat(C.rouge));
  },
  compteur(b, o) {
    // regard de comptage (corps vu en transparence), compteur DN20 de 190 mm entre deux robinets
    const br = mat(C.laiton, { shine: 70 }), zG = o.zG;
    b.lathe([[0.2, -0.2], [0.2, zG - 0.05], [0.165, zG - 0.02]], V(0, 0, 0), Z, mat('#5b6470', { opacity: 0.22 }), 28).cyl(0.2, 0.2, V(0, 0, -0.22), V(0, 0, -0.2), mat('#5b6470', { opacity: 0.22 }), 28);
    b.lathe([[0.19, zG - 0.03], [0.19, zG], [0, zG]], V(0, 0, 0), Z, mat(C.vert), 28).cyl(0.05, 0.05, V(0, 0, zG), V(0, 0, zG + 0.004), mat(o.col), 16);
    b.cyl(0.02, 0.02, V(-0.095, 0, 0), V(0.095, 0, 0), br, 14).cyl(0.038, 0.038, V(0, 0, -0.02), V(0, 0, 0.05), br, 20).cyl(0.04, 0.04, V(0, 0, 0.05), V(0, 0, 0.062), mat('#1b4f9c', { shine: 40 }), 20);
    for (const s of [-1, 1]) { b.cyl(0.024, 0.024, V(s * 0.095, 0, 0), V(s * 0.108, 0, 0), br, 6).box(0.045, 0.036, 0.036, V(s * 0.135, 0, 0), br).cyl(0.008, 0.008, V(s * 0.135, 0, 0.018), V(s * 0.135, 0, 0.045), br, 8).box(0.07, 0.016, 0.01, V(s * 0.135, 0, 0.05), mat(s < 0 ? C.rouge : '#1b4f9c')); b.cyl(o.rp, o.rp, V(s * 0.158, 0, 0), V(s * 0.21, 0, 0), mat(C.pe), 12); }
  },
  collier(b, o) {
    // collier de prise en charge en deux demi-coquilles, robinet de prise, départ du branchement, bouche à clé
    const m = mat(C.epoxy, { shine: 40 }), br = mat(C.laiton, { shine: 70 }), rp = o.rp, gv = mat(C.galva, { shine: 60 }), up = Math.max(0.1, o.up || 0.12);
    b.cyl(rp * 1.16 + 0.004, rp * 1.16 + 0.004, V(-0.045, 0, 0), V(0.045, 0, 0), m, 24);
    for (const s of [-1, 1]) { b.box(0.09, 0.03, 0.034, V(0, s * (rp * 1.16 + 0.016), 0), m); for (const t of [-1, 1]) b.bolts(1, 0, V(t * 0.028, s * (rp * 1.16 + 0.018), 0), Z, 0.062, 0.011, gv); }
    b.cyl(0.026, 0.022, V(0, 0, rp), V(0, 0, rp + 0.05), m, 12).box(0.05, 0.05, 0.06, V(0, 0, rp + 0.075), br).cyl(0.012, 0.012, V(0, 0, rp + 0.1), V(0, 0, rp + 0.14), br, 8).box(0.022, 0.022, 0.022, V(0, 0, rp + 0.145), br, Math.PI / 4);
    const d = o.brDir || V(0, 1, 0), z = rp + 0.075; b.cyl(0.017, 0.017, V(0, 0, z), d.clone().multiplyScalar(0.07).setZ(z), br, 10).cyl(0.024, 0.024, d.clone().multiplyScalar(0.05).setZ(z), d.clone().multiplyScalar(0.075).setZ(z), br, 6);
    boucheACle(b, 0, 0, rp + 0.16, o.zG, o.col);
  },
  manchon(b, o) {
    // manchon large tolérance : virole, deux contre-brides, tirants boulonnés
    const m = mat(C.epoxy, { shine: 40 }), rp = o.rp, L = clamp(rp * 2.2 + 0.1, 0.14, 0.34), r = rp * 1.22 + 0.006, n = rp > 0.09 ? 6 : rp > 0.04 ? 4 : 2;
    b.cyl(r, r, V(-L * 0.3, 0, 0), V(L * 0.3, 0, 0), m, 24);
    for (const s of [-1, 1]) b.lathe([[rp * 1.04, 0], [r + 0.03, 0], [r + 0.03, 0.022], [rp * 1.04, 0.03]], V(s * L / 2, 0, 0), V(-s, 0, 0), m);
    b.bolts(n, r + 0.016, V(0, 0, 0), X, L + 0.05, 0.014, mat(C.galva, { shine: 60 }), Math.PI / n);
  },
  cone(b, o) {
    const m = o.mFit, r1 = o.rp, r2 = Math.max(0.012, Math.min(...(o.ods.length > 1 ? o.ods : [o.rp * 2000 * 0.6])) / 2000), L = clamp((r1 - r2) * 5, 0.12, 0.5);
    b.lathe([[r1 * 1.2, -L / 2 - r1], [r1 * 1.2, -L / 2], [r2 * 1.2, L / 2], [r2 * 1.2, L / 2 + r2 + 0.03]], V(0, 0, 0), X, m);
    b.lathe([[r1 * 1.2, 0], [r1 * 1.32, 0.005], [r1 * 1.32, 0.03], [r1 * 1.2, 0.035]], V(-L / 2 - r1, 0, 0), X, m).lathe([[r2 * 1.2, 0], [r2 * 1.36, 0.005], [r2 * 1.36, 0.025], [r2 * 1.2, 0.03]], V(L / 2 + r2, 0, 0), X, m);
  },
  bouchon(b, o) {
    // l'extrémité de la conduite : collet, bride pleine boulonnée (ou bouchon électrosoudable sur les petits diamètres)
    const dn = o.dn, m = mat(C.epoxy, { shine: 40 });
    if (o.rp < 0.03) { b.lathe([[o.rp * 1.3, 0.06], [o.rp * 1.3, 0], [o.rp * 1.1, -0.02], [0, -0.022]], V(0, 0, 0), X, mat(C.pe, { shine: 30 })); return; }
    const th = flanges(b, 0, dn, o.mCB, m, 1); b.cyl(o.rp * 1.1, o.rp * 1.1, V(th, 0, 0), V(th + 0.06, 0, 0), o.mCB, 20);
  },
  cadre(b, o) {
    // franchissement : la conduite passe en fourreau au-dessus d'un cadre béton
    const c = mat(C.beton), rp = o.rp, zt = -rp - 0.25;
    for (const s of [-1, 1]) b.box(0.15, 4, 1.0, V(s * 0.675, 0, zt - 0.5), c);
    b.box(1.5, 4, 0.15, V(0, 0, zt - 0.075), c).box(1.5, 4, 0.15, V(0, 0, zt - 0.925), c);
    b.lathe([[rp * 1.7, -1.2], [rp * 1.7, 1.2]], V(0, 0, 0), X, mat(C.galva, { opacity: 0.5 }), 22);
    for (const x of [-0.9, 0, 0.9]) b.lathe([[rp * 1.05, -0.03], [rp * 1.6, -0.03], [rp * 1.6, 0.03], [rp * 1.05, 0.03]], V(x, 0, 0), X, mat(C.pe));
  },
  autre(b, o) {
    b.cyl(o.rp * 1.25, o.rp * 1.25, V(-0.06, 0, 0), V(0.06, 0, 0), mat(o.col), 22).cyl(0.012, 0.012, V(0, 0, o.rp), V(0, 0, o.zG - 0.2), mat(C.galva), 8);
    boucheACle(b, 0, 0, o.zG, o.zG, o.col);
  }
};

function buildAcc(n, P, toEN, root, bends, col) {
  const x = n.x || {}, kind = kindOf(x, n.name), depth = Math.max(0.3, n.depth > 0 ? n.depth : 1.2);
  const odmm = x.od || (x.dn ? x.dn * 1.1 : 110), m = x.mat || 'PEHD', rp = odmm / 2000 * (m === 'FONTE' ? (FONTE_DE[nearDN(odmm)] || odmm) / odmm : 1);
  const dirs = (x.dirs || []).map(d => { const e = toEN(d[0], d[1]); return V(e[0] - P.x, e[1] - P.y, 0).normalize(); }).filter(d => d.lengthSq() > 0.5);
  const aep = n.type === 'aep', pe = m === 'PEHD' || !m;
  const mFit = pe ? mat(C.pe, { shine: 35 }) : aep ? mat(C.epoxy, { shine: 40 }) : mat(pipeSpec({ diam: odmm, type: n.type, x: { mat: m } }).base);
  const b = new B();
  // coude : il épouse exactement le cintrage de la conduite
  if (kind === 'coude') {
    const bd = bends.find(q => q.V.distanceTo(P) < Math.max(0.08, rp * 2));
    let S;
    if (bd) S = bd.arc;
    else if (dirs.length >= 2) S = pathOf([P.clone().addScaledVector(dirs[0], 0.6), P, P.clone().addScaledVector(dirs[1], 0.6)], rp * 2, null).slice(1, -1);
    if (S && S.length > 1) {
      const a = S[0], z = S[S.length - 1], s = rp * 1.3 + 0.02, rf = rp * 1.2 + 0.003;
      const full = [{ p: a.p.clone().addScaledVector(a.t, -s), t: a.t }].concat(S, [{ p: z.p.clone().addScaledVector(z.t, s), t: z.t }]);
      b.sweep(full, rf, mFit, 20);
      for (const [q, sg] of [[full[0], 1], [full[full.length - 1], -1]]) { const t = q.t.clone().multiplyScalar(sg); b.lathe([[rp * 1.02, 0], [rf * 1.1, 0], [rf * 1.1, s * 0.75], [rf, s * 0.8]], q.p, t, mFit, 20); if (pe) for (const k of [0.25, 0.6]) b.cyl(0.006, 0.006, q.p.clone().addScaledVector(t, s * k).add(V(0, 0, rf)), q.p.clone().addScaledVector(t, s * k).add(V(0, 0, rf * 1.1 + 0.016)), mat(C.laiton), 8); }
      b.finish(root); return;
    }
  }
  // repère local de l'accessoire
  let ax = dirs[0] ? dirs[0].clone() : V(1, 0, 0), brDir = null;
  if (kind === 'te' && dirs.length >= 3) { let best = [0, 1], bs = 2; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const d = dirs[i].dot(dirs[j]); if (d < bs) { bs = d; best = [i, j]; } } ax = dirs[best[0]].clone(); brDir = dirs[3 - best[0] - best[1]]; }
  if (kind === 'bouchon' && dirs.length) ax = dirs[0].clone();   // X local vers la conduite
  if ((kind === 'pi' || kind === 'bi') && dirs.length) ax = dirs[0].clone().negate();   // la bride d'arrivée (côté −X) regarde la conduite
  const side = new THREE.Vector3().crossVectors(Z, ax).normalize(), mx = new THREE.Matrix4().makeBasis(ax, side, Z).setPosition(P);
  const loc = d => V(d.dot(ax), d.dot(side), 0).normalize();
  const dn = x.dn && FL[Math.round(x.dn)] ? Math.round(x.dn) : dnOf(odmm, m);
  const o = { dn, rp, zG: depth, col, mCB: pe ? mat(C.pe, { shine: 30 }) : mat(C.epoxy, { shine: 40 }), mFit, ods: x.ods || [], up: 0 };
  if (x.brTo) { const e = toEN(x.brTo[0], x.brTo[1]); o.brDir = loc(V(e[0] - P.x, e[1] - P.y, 0).normalize()); }
  if (kind === 'te') {
    // té : corps le long de la conduite, tubulure vers le branchement, manchons aux trois sorties
    const d = brDir ? loc(brDir) : V(0, 1, 0), rb = Math.max(0.012, (o.ods.length > 1 ? Math.min(...o.ods) : odmm) / 2000), rf = rp * 1.2 + 0.003, rbf = Math.min(rf, rb * 1.2 + 0.003), Lm = rp * 2.2 + rb + 0.06, Lb = rp * 2.1 + 0.05;
    b.cyl(rf, rf, V(-Lm, 0, 0), V(Lm, 0, 0), mFit, 22).cyl(rbf, rbf, V(0, 0, 0), d.clone().multiplyScalar(Lb), mFit, 20);
    for (const [c, t, r] of [[V(-Lm, 0, 0), X, rf], [V(Lm, 0, 0), V(-1, 0, 0), rf], [d.clone().multiplyScalar(Lb), d.clone().negate(), rbf]]) { b.lathe([[r * 0.9, 0], [r * 1.1, 0], [r * 1.1, r * 0.9], [r, r]], c, t, mFit, 20); if (pe) for (const k of [0.3, 0.75]) b.cyl(0.006, 0.006, c.clone().addScaledVector(t, r * k).add(V(0, 0, r)), c.clone().addScaledVector(t, r * k).add(V(0, 0, r * 1.1 + 0.016)), mat(C.laiton), 8); }
  } else (A[kind] || A.autre)(b, o);
  b.finish(root, mx);
}

/* ---------- entrée : tous les réseaux ---------- */
export function buildNets(nets, toEN, colors) {
  const group = new THREE.Group(); group.name = 'reseaux';
  const colOf = n => n.col || (colors && colors[n.type]) || '#6b7480', zOf = d => d > 0 ? -d : d < 0 ? -d : 0.15;
  const bends = [], later = [];
  let count = 0;
  nets.forEach(n => {
    if (!n.pts || n.pts.length < (n.kind ? 1 : 2) || count > 4000) return;
    const root = new THREE.Group(); root.userData.itemId = n.id; group.add(root); count++;
    if (n.kind) { later.push([n, root]); return; }
    const x = n.x || {}, z = zOf(n.depth), P = [];
    n.pts.forEach(p => { const e = toEN(p[0], p[1]), v = V(e[0], e[1], z); if (!P.length || P[P.length - 1].distanceTo(v) > 0.02) P.push(v); });
    if (P.length < 2) return;
    // un branchement descend de sa profondeur jusqu'à la conduite principale
    if (x.ends && (x.ends[0] != null || x.ends[1] != null)) {
      const r = (+n.diam || 32) / 2000, L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1]));
      const z0 = x.ends[0] != null ? -(x.ends[0] - 0.14 - r) : z, z1 = x.ends[1] != null ? -(x.ends[1] - 0.14 - r) : z, T = L[L.length - 1] || 1, run = Math.min(1.2, T * 0.5);
      P.forEach((p, i) => { const a = clamp(1 - L[i] / run, 0, 1), c = clamp(1 - (T - L[i]) / run, 0, 1); p.z = z + (z0 - z) * a + (z1 - z) * c; });
      if (x.ends[0] != null && T > 0.6) P.splice(1, 0, P[0].clone().lerp(P[1], Math.min(0.9, run / Math.max(run, P[0].distanceTo(P[1])))).setZ(z));
      if (x.ends[1] != null && T > 0.6) { const k = P.length - 1; P.splice(k, 0, P[k].clone().lerp(P[k - 1], Math.min(0.9, run / Math.max(run, P[k].distanceTo(P[k - 1])))).setZ(z)); }
    }
    try { buildPipe(n, P, root, bends); } catch (e) { console.warn('conduite 3D', e); }
  });
  later.forEach(([n, root]) => {
    const e = toEN(n.pts[0][0], n.pts[0][1]);
    try {
      if (n.kind === 'regard') buildRegard(n, V(e[0], e[1], 0), root);
      else buildAcc(n, V(e[0], e[1], zOf(n.depth > 0 ? n.depth : 1.2)), toEN, root, bends, colOf(n));
    } catch (er) { console.warn('accessoire 3D', n.name, er); }
  });
  group.traverse(o => { if (o.isMesh) o.userData.keepGeo = true; });
  return { group };
}

// outils de modélisation partagés avec les installations de chantier et la signalisation (site3d.js)
export { B, mat as nmat, V };
