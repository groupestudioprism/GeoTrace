/* GeoTrace – pelles articulées en 3D, construites à partir de cotes (assets/rigkin.js) : train de roulement (chenilles ou pneus),
   tourelle avec cabine et contrepoids, flèche, balancier, godet et vérins qui suivent les articulations.
   Repère local : Z vers le haut, +Y vers l'avant à 0°. */
import * as THREE from 'three';
import { clampP } from './rigkin.js';
const D = Math.PI / 180;

export function buildRig(s, p0, colorRgb) {
  const main = new THREE.Color(...(colorRgb || s.color || [.88, .37, .06]));
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .62, metalness: .12, ...o });
  const mMain = M(main), mDark = M(0x2b2b2e), mBlack = M(0x131314, { roughness: .9 }), mSteel = M(0x56595e, { metalness: .3 }), mCw = M(main.clone().multiplyScalar(.55)),
    mGlass = M(0x8fb6cc, { transparent: true, opacity: .55, roughness: .1, metalness: .4 }), mRod = M(0xd9dde0, { metalness: .85, roughness: .25 }), mCyl = M(0x303033, { metalness: .4 }), mBucket = M(0x3a3a3e, { metalness: .3 });
  const sc = s.Lb / 5.7, root = new THREE.Group(), swing = new THREE.Group(); root.add(swing);
  const add = (g, m, x, y, z, par = root) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.userData.dispose = true; par.add(o); return o; };
  const box = (w, l, h, x, y, z0, m, par) => add(new THREE.BoxGeometry(w, l, h), m, x, y, z0 + h / 2, par);
  const cylX = (r, w, x, y, z, m, par) => { const o = add(new THREE.CylinderGeometry(r, r, w, 28), m, x, y, z, par); o.rotation.z = Math.PI / 2; return o; };
  /* profil extrudé : points (u le long de Y, v vers le haut Z), épaisseur w selon X */
  const prof = (pts, w, m, par) => {
    const sh = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1]))), g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { const u = a.getX(i), v = a.getY(i), d = a.getZ(i); a.setXYZ(i, d - w / 2, u, v); }
    g.computeVertexNormals(); return add(g, m, 0, 0, 0, par);
  };
  /* plan extrudé verticalement : points (x, y) */
  const plan = (pts, h, z0, m, par) => {
    const sh = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1]))), g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
    return add(g, m, 0, 0, z0, par);
  };

  /* ---------- train de roulement ---------- */
  if (s.type === 'wheels') {
    const wr = s.wr, ww = .5 * (sc > .6 ? 1 : .8);
    box(s.W - .5, s.Lu + .6, .45, 0, 0, wr * .9, mSteel);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => { const x = sx * (s.W / 2 - ww / 2), y = sy * s.Lu / 2; cylX(wr, ww, x, y, wr, mBlack); cylX(wr * .55, ww + .04, x, y, wr, mSteel); });
    box(s.W - .3, .35, .75, 0, s.Lu / 2 + wr + .55, wr * .5, mMain); // lame avant
    [-1, 1].forEach(sx => { box(.55, .5, .12, sx * (s.W / 2 - .35), -s.Lu / 2 - wr - .55, 0, mDark); box(.16, .16, wr * .9, sx * (s.W / 2 - .35), -s.Lu / 2 - wr - .55, .1, mSteel); }); // stabilisateurs arrière
  } else {
    const tw = s.tw, th = s.th, tx = s.W / 2 - tw / 2;
    box(s.W - 2 * tw + .05, s.Lu * .7, th * .8, 0, 0, th * .2, mSteel);
    [-1, 1].forEach(sx => {
      box(tw, s.Lu - th, th, sx * tx, 0, 0, mBlack);
      [-1, 1].forEach(sy => { const o = add(new THREE.CylinderGeometry(th / 2, th / 2, tw, 24), mBlack, sx * tx, sy * (s.Lu - th) / 2, th / 2); o.rotation.z = Math.PI / 2; cylX(th * .3, tw + .03, sx * tx, sy * (s.Lu - th) / 2, th / 2, mSteel); });
      box(tw * .6, s.Lu - th, th * .18, sx * tx, 0, th * .92, mDark);
      for (let i = 0; i < 5; i++) cylX(th * .13, tw * .8, sx * tx, -s.Lu * .3 + i * s.Lu * .15, th * .22, mSteel);
    });
    if (s.blade) { box(s.W, .3, .38, 0, s.Lu / 2 + .45, .12, mMain); [-1, 1].forEach(sx => box(.12, .7, .12, sx * s.W * .3, s.Lu / 2 + .1, .3, mSteel)); }
  }

  /* ---------- tourelle (tourne autour de Z) ---------- */
  const rear = s.rear, fh = s.frontH, Lh = rear + fh, yc = (fh - rear) / 2, dk = s.deck, hh = s.Hh - dk;
  box(s.Wh, Lh, .28, 0, yc, dk - .28, mDark, swing);
  box(s.Wh * .96, Lh * .5, hh * .38, 0, -rear + Lh * .5 * .5 + .35 * sc, dk, mMain, swing);                       // capot moteur
  const cwL = .95 * sc * 1.3, cw = s.Wh * .5;
  plan([[-cw, -rear + .4], [-cw + .25, -rear], [cw - .25, -rear], [cw, -rear + .4], [cw, -rear + cwL], [-cw, -rear + cwL]], hh * .62, dk, mCw, swing); // contrepoids
  box(s.Wh * .22, Lh * .3, hh * .28, s.Wh * .39, yc * .2, dk, mMain, swing);                                      // réservoirs, côté droit
  const cabW = Math.min(s.Wh * .46, 1.15 * Math.max(sc, .55)), cabL = 1.5 * Math.max(sc, .6), cx = -s.Wh / 2 + cabW / 2 + .03, cy = fh - cabL / 2 - .12;
  box(cabW, cabL, .55, cx, cy, dk, mMain, swing);
  box(cabW - .04, cabL - .04, hh - .55 - .08, cx, cy, dk + .55, mGlass, swing);
  box(cabW + .1, cabL + .1, .08, cx, cy, s.Hh - .08, mDark, swing);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => box(.06, .06, hh - .55, cx + a * (cabW / 2 - .02), cy + b * (cabL / 2 - .02), dk + .55, mDark, swing));
  box(s.Wh * .26, .7 * sc + .3, .55 * sc + .25, 0, s.bx - .05, dk, mMain, swing);                                   // support de flèche

  /* ---------- flèche, balancier, godet ---------- */
  const boomG = new THREE.Group(); boomG.position.set(0, s.bx, s.bz); swing.add(boomG);
  const stickG = new THREE.Group(); stickG.position.set(0, s.Lb, 0); boomG.add(stickG);
  const bucketG = new THREE.Group(); bucketG.position.set(0, s.Ls, 0); stickG.add(bucketG);
  const Lb = s.Lb, Ls = s.Ls, Lk = s.Lk, hb = .1 * Lb, tF = .40 * sc, tM = .28 * sc, tE = .2 * sc, bwB = .5 * sc + .1;
  const cl = u => u <= .5 * Lb ? hb * u / (.5 * Lb) : hb * (Lb - u) / (.5 * Lb);
  prof([[-.2 * sc, -tF], [.5 * Lb, hb - tM], [Lb, -tE], [Lb, tE], [.5 * Lb, hb + tM], [-.2 * sc, tF + .1 * sc]], bwB, mMain, boomG);
  const tS = .3 * sc, tS2 = .17 * sc;
  prof([[-.2 * sc, -tS], [Ls, -tS2], [Ls, tS2], [.15 * Ls, tS], [-.2 * sc, tS]], .38 * sc + .08, mMain, stickG);
  const bwK = s.bw;
  prof([[-.18 * Lk, .18 * Lk], [.3 * Lk, .52 * Lk], [.85 * Lk, .36 * Lk], [Lk, .03 * Lk], [.95 * Lk, -.05 * Lk], [.55 * Lk, -.3 * Lk], [.1 * Lk, -.1 * Lk]], bwK, mBucket, bucketG);
  for (let i = 0; i < 5; i++) box(.07, .2 * Lk, .12 * Lk, -bwK / 2 + .12 + i * (bwK - .24) / 4, .98 * Lk, -.02 * Lk, mDark, bucketG);
  cylX(.09 * sc + .02, bwB + .1, 0, 0, 0, mSteel, boomG); cylX(.08 * sc + .02, .6 * sc + .1, 0, 0, 0, mSteel, stickG); cylX(.08 * sc + .02, bwK * .4, 0, 0, 0, mSteel, bucketG);

  /* ---------- vérins : deux extrémités accrochées à des pièces qui bougent ---------- */
  const anchor = (par, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); par.add(o); return o; };
  const cyls = [], r0 = .075 * sc + .03;
  const cyl = (A, B, r) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14), mCyl), rod = new THREE.Mesh(new THREE.CylinderGeometry(r * .6, r * .6, 1, 12), mRod);
    body.userData.dispose = rod.userData.dispose = true; swing.add(body, rod); cyls.push({ A, B, body, rod, lb: 0 });
  };
  [-1, 1].forEach(sx => cyl(anchor(swing, sx * (bwB / 2 + .1), s.bx - .55 * sc, s.bz - .45 * sc), anchor(boomG, sx * (bwB / 2 + .1), .3 * Lb, cl(.3 * Lb) - tM * .4), r0));
  cyl(anchor(boomG, 0, .56 * Lb, cl(.56 * Lb) + tM + .12 * sc), anchor(stickG, 0, .18 * Ls, tS + .02), r0 * 1.15);
  cyl(anchor(stickG, 0, .55 * Ls, tS2 + .12 * sc), anchor(bucketG, 0, -.04 * Lk, .3 * Lk), r0);

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  function set(pp) {
    const p = clampP(pp);
    swing.rotation.z = -p.sw * D; boomG.rotation.x = p.bm * D; stickG.rotation.x = p.st * D; bucketG.rotation.x = p.bk * D;
    root.updateMatrixWorld(true);
    cyls.forEach(c => {
      c.A.getWorldPosition(v1); c.B.getWorldPosition(v2); swing.worldToLocal(v1); swing.worldToLocal(v2);
      const dir = v2.clone().sub(v1), d = dir.length(); if (!d) return; dir.divideScalar(d);
      if (!c.lb) c.lb = d * .62;
      const q = new THREE.Quaternion().setFromUnitVectors(Y, dir), rl = Math.max(.05, d - c.lb * .5);
      c.body.quaternion.copy(q); c.body.scale.y = c.lb; c.body.position.copy(v1).addScaledVector(dir, c.lb / 2);
      c.rod.quaternion.copy(q); c.rod.scale.y = rl; c.rod.position.copy(v1).addScaledVector(dir, c.lb * .5 + rl / 2);
    });
  }
  set(p0);
  return { group: root, set };
}
