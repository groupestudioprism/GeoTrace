/* GeoTrace – pelles articulées en 3D, construites à partir de cotes (assets/rigkin.js).
   Modèle détaillé : chenilles à patins avec barbotin, galets et roue folle (ou pneus sculptés, lame et stabilisateurs),
   tourelle carénée avec capot grillagé, échappement, contrepoids, mains courantes, cabine vitrée avec siège, phares et gyrophare,
   flèche et balancier en caisson avec axes, flexibles hydrauliques, godet creux à dents, biellettes et vérins chromés qui suivent les articulations.
   Repère local : Z vers le haut, +Y vers l'avant à 0°. */
import * as THREE from '../vendor/three/three.module.js';
import { clampP } from './rigkin.js';
const D = Math.PI / 180, PI = Math.PI;

export function buildRig(s, p0, colorRgb) {
  const main = new THREE.Color(...(colorRgb || s.color || [.88, .37, .06]));
  const fin = m => { m.userData.gtLook = true; return m; }; // matériaux définitifs : la passe de rendu ne les retouche pas
  const P = o => fin(new THREE.MeshPhysicalMaterial(o)), S = o => fin(new THREE.MeshStandardMaterial(o));
  const mMain = P({ color: main, roughness: .42, metalness: .08, clearcoat: .7, clearcoatRoughness: .18 }),
    mCw = P({ color: main.clone().multiplyScalar(.5), roughness: .5, metalness: .1, clearcoat: .4, clearcoatRoughness: .3 }),
    mDark = S({ color: 0x232427, roughness: .68, metalness: .35 }), mBlack = S({ color: 0x0e0e0f, roughness: .92, metalness: 0 }),
    mSteel = S({ color: 0x6a6e74, roughness: .42, metalness: .8 }), mTrack = S({ color: 0x2a2b2d, roughness: .6, metalness: .7 }),
    mRod = S({ color: 0xe3e6e8, roughness: .12, metalness: 1 }), mCyl = P({ color: 0x1c1d20, roughness: .4, metalness: .5, clearcoat: .5 }),
    mBucket = S({ color: 0x35373b, roughness: .55, metalness: .75 }), mEdge = S({ color: 0x9aa0a6, roughness: .35, metalness: .9 }),
    mGlass = P({ color: 0x9fc4d6, roughness: .04, metalness: 0, transparent: true, opacity: .34, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide }),
    mSeat = S({ color: 0x1b1c1f, roughness: .95, metalness: 0 }), mLens = S({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: .9, roughness: .2 }),
    mRed = S({ color: 0xb01212, emissive: 0x700808, emissiveIntensity: .8, roughness: .3 }), mAmber = P({ color: 0xff8a00, emissive: 0xff6a00, emissiveIntensity: .55, roughness: .15, transparent: true, opacity: .9 });
  const sc = s.Lb / 5.7, root = new THREE.Group(), swing = new THREE.Group(); root.add(swing);
  const add = (g, m, x, y, z, par = root) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.userData.dispose = true; par.add(o); return o; };
  const cylX = (r, w, x, y, z, m, par, seg = 32) => { const o = add(new THREE.CylinderGeometry(r, r, w, seg), m, x, y, z, par); o.rotation.z = PI / 2; return o; };
  const cylZ = (r, h, x, y, z0, m, par, seg = 24, r2 = r) => { const o = add(new THREE.CylinderGeometry(r2, r, h, seg), m, x, y, z0 + h / 2, par); o.rotation.x = PI / 2; return o; };
  const rrect = (w, l, r) => { const q = new THREE.Shape(), x = w / 2, y = l / 2; r = Math.max(.001, Math.min(r, x - .001, y - .001)); q.moveTo(-x + r, -y); q.lineTo(x - r, -y); q.quadraticCurveTo(x, -y, x, -y + r); q.lineTo(x, y - r); q.quadraticCurveTo(x, y, x - r, y); q.lineTo(-x + r, y); q.quadraticCurveTo(-x, y, -x, y - r); q.lineTo(-x, -y + r); q.quadraticCurveTo(-x, -y, -x + r, -y); return q; };
  /* boîte aux arêtes adoucies : w selon X, l selon Y, h selon Z, posée à z0 */
  const rbox = (w, l, h, x, y, z0, m, par, r = .05, b = .02) => {
    b = Math.max(.002, Math.min(b, h / 2 - .002, w / 2 - .002, l / 2 - .002));
    const g = new THREE.ExtrudeGeometry(rrect(w - 2 * b, l - 2 * b, r), { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 5 });
    return add(g, m, x, y, z0 + b, par);
  };
  /* profil extrudé : forme (u le long de Y, v vers le haut Z), épaisseur w selon X, arêtes adoucies */
  const profS = (sh, w, m, par, b = 0, x0 = 0) => {
    b = Math.min(b, w / 2 - .002); const d = w - 2 * b, g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 10 }), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { const u = a.getX(i), v = a.getY(i), z = a.getZ(i); a.setXYZ(i, z - d / 2 + x0, u, v); }
    g.computeVertexNormals(); return add(g, m, 0, 0, 0, par);
  };
  const prof = (pts, w, m, par, b = 0, x0 = 0) => profS(new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1]))), w, m, par, b, x0);
  /* plan extrudé verticalement : points (x, y) */
  const plan = (pts, h, z0, m, par, b = .03) => add(new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1]))), { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2 }), m, 0, 0, z0 + b, par);
  const tube = (pts, r, m, par) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q))), Math.max(8, pts.length * 6), r, 7, false), m, 0, 0, 0, par);
  const inst = (g, m, mats, par) => { const o = new THREE.InstancedMesh(g, m, mats.length); mats.forEach((q, i) => o.setMatrixAt(i, q)); o.userData.dispose = true; o.instanceMatrix.needsUpdate = true; par.add(o); return o; };
  const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

  /* ---------- train de roulement ---------- */
  if (s.type === 'wheels') {
    const wr = s.wr, ww = .5 * (sc > .6 ? 1 : .8), ax = s.Lu / 2;
    rbox(s.W - 2 * ww - .2, s.Lu + .9, .42, 0, 0, wr * .82, mDark, root, .08, .03);       // châssis
    [-1, 1].forEach(sy => cylX(.13, s.W - ww, 0, sy * ax, wr, mSteel));                    // essieux
    // pneu : profil arrondi tourné, sculptures rapportées, jante emboutie et écrous
    const tyreP = [[wr * .58, -ww / 2], [wr * .9, -ww / 2], [wr * .985, -ww * .36], [wr, -ww * .2], [wr, ww * .2], [wr * .985, ww * .36], [wr * .9, ww / 2], [wr * .58, ww / 2]].map(q => new THREE.Vector2(q[0], q[1]));
    const tyreG = new THREE.LatheGeometry(tyreP, 40), rimP = [[.02, ww * .1], [wr * .2, ww * .1], [wr * .26, ww * .22], [wr * .5, ww * .22], [wr * .58, ww * .42], [wr * .6, ww * .46]].map(q => new THREE.Vector2(q[0], q[1])), rimG = new THREE.LatheGeometry(rimP, 32);
    const lugG = new THREE.BoxGeometry(ww * .46, wr * .2, .035), lugs = [], nuts = [], nutG = new THREE.CylinderGeometry(.022, .022, .03, 6);
    for (let i = 0; i < 22; i++) { const a = i / 22 * 2 * PI, side = i % 2 ? 1 : -1; lugs.push(new THREE.Matrix4().makeRotationX(a).multiply(mat4(side * ww * .2, 0, wr + .008, 0, 0, side * .5))); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * PI; nuts.push(new THREE.Matrix4().makeRotationX(a).multiply(mat4(0, 0, wr * .2, 0, 0, PI / 2))); }
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const g = new THREE.Group(); g.position.set(sx * (s.W / 2 - ww / 2), sy * ax, wr); root.add(g);
      const t = add(tyreG, mBlack, 0, 0, 0, g); t.rotation.z = -PI / 2; const r = add(rimG, mMain, 0, 0, 0, g); r.rotation.z = -sx * PI / 2;
      inst(lugG, mBlack, lugs, g); const n = inst(nutG, mSteel, nuts, g); n.position.x = sx * ww * .24;
      rbox(ww + .12, wr * 1.5, .05, sx * (s.W / 2 - ww / 2), sy * ax, wr * 2 + .1, mDark, root, .12, .015);  // garde-boue
    });
    // lame avant : tablier cintré, bras et vérin
    const by = ax + wr + .5, bh = .72;
    prof([[0, 0], [.1, .03], [.2, bh * .3], [.22, bh * .7], [.12, bh], [.04, bh], [.06, bh * .6], [0, bh * .25], [-.1, .06]].map(q => [q[0] + by, q[1] + .1]), s.W - .2, mMain, root, .012);
    rbox(s.W - .18, .03, .07, 0, by + .11, .08, mEdge, root, .01, .008);
    [-1, 1].forEach(sx => { prof([[ax + .2, wr * .7], [by, .3], [by, .45], [ax + .2, wr * .95]], .09, mDark, root, .01, sx * s.W * .28); });
    // stabilisateurs arrière : jambe, patin articulé
    [-1, 1].forEach(sx => { const x = sx * (s.W / 2 - .28), y = -ax - wr - .5; rbox(.22, .2, wr * .95, x, y, .14, mDark, root, .03, .012); rbox(.5, .44, .07, x, y, .02, mSteel, root, .05, .012); cylX(.045, .3, x, y, .13, mSteel); rbox(.14, 1.0, .16, x, y + .5, wr * .78, mDark, root, .03, .012); });
    cylZ(s.Wh * .3, .2, 0, 0, wr * .82 + .42, mSteel, root, 36);
  } else {
    const tw = s.tw, th = s.th, tx = s.W / 2 - tw / 2, R = th / 2, c = (s.Lu - th) / 2, t = Math.max(.03, th * .09);
    const stadium = k => { const r = R - k, q = new THREE.Shape(); q.absarc(c, R, r, -PI / 2, PI / 2, false); q.absarc(-c, R, r, PI / 2, 1.5 * PI, false); q.closePath(); return q; };
    const belt = stadium(0); belt.holes.push(stadium(t));
    // patins et arêtes d'accroche répartis le long de la chaîne
    const per = 4 * c + 2 * PI * R, n = Math.max(24, Math.round(per / Math.max(.11, .15 * sc))), padL = per / n * .8, pads = [], grs = [];
    for (let i = 0; i < n; i++) {
      let d = i * per / n, u, v, a;
      if (d < 2 * c) { u = -c + d; v = 0; a = -PI / 2; } else if ((d -= 2 * c) < PI * R) { a = -PI / 2 + d / R; u = c + R * Math.cos(a); v = R + R * Math.sin(a); }
      else if ((d -= PI * R) < 2 * c) { u = c - d; v = th; a = PI / 2; } else { d -= 2 * c; a = PI / 2 + d / R; u = -c + R * Math.cos(a); v = R + R * Math.sin(a); }
      const nu = Math.cos(a), nv = Math.sin(a);
      pads.push(mat4(0, u + nu * .012, v + nv * .012, a - PI / 2)); grs.push(mat4(0, u + nu * .035, v + nv * .035, a - PI / 2));
    }
    const padG = new THREE.BoxGeometry(tw, padL, .03), grG = new THREE.BoxGeometry(tw * .96, padL * .22, .05);
    rbox(s.W - 2 * tw + .1, s.Lu * .62, th * .62, 0, 0, th * .24, mDark, root, .1, .03);                   // châssis en X
    cylZ(s.Wh * .3, Math.max(.12, s.deck - .28 - th * .86), 0, 0, th * .86, mSteel, root, 36);           // couronne d'orientation
    [-1, 1].forEach(sx => {
      const g = new THREE.Group(); g.position.x = sx * tx; root.add(g);
      profS(belt, tw * .92, mBlack, g); inst(padG, mTrack, pads, g); inst(grG, mTrack, grs, g);
      rbox(tw * .5, 2 * c * .96, th * .34, 0, 0, th * .3, mDark, g, .06, .02);                            // longeron
      const sp = add(new THREE.CylinderGeometry(R * .84, R * .84, tw * .3, 13), mSteel, 0, -c, R, g); sp.rotation.z = PI / 2; sp.rotation.y = .2; // barbotin
      cylX(R * .5, tw * .5, 0, -c, R, mMain, g); cylX(R * .82, tw * .42, 0, c, R, mSteel, g); cylX(R * .36, tw * .56, 0, c, R, mDark, g); // moyeu, roue folle
      const nr = Math.max(4, Math.round(2 * c / (th * .62)));
      for (let i = 0; i < nr; i++) cylX(th * .13, tw * .66, 0, -c * .8 + i * 1.6 * c / (nr - 1), t + th * .13, mSteel, g, 20);
      [-.35, .35].forEach(k => cylX(th * .09, tw * .6, 0, k * 2 * c, th - t - th * .09, mSteel, g, 16));
      rbox(tw * .2, 2 * c * .8, .05, sx * tw * .32, 0, th * .64, mDark, g, .02, .012);                    // garde-chaîne
    });
    if (s.blade) {
      const by = s.Lu / 2 + .34, bh = Math.max(.36, th * .78);
      prof([[0, 0], [.08, .02], [.16, bh * .3], [.17, bh * .7], [.1, bh], [.03, bh], [.05, bh * .6], [0, bh * .25], [-.07, .05]].map(q => [q[0] + by, q[1] + .04]), s.W, mMain, root, .01);
      rbox(s.W + .02, .025, .06, 0, by + .09, .02, mEdge, root, .008, .006);
      [-1, 1].forEach(sx => prof([[c * .5, th * .45], [by, .14], [by, .28], [c * .5, th * .7]], .08, mDark, root, .01, sx * s.W * .24));
      const vc = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1, 12), mCyl); vc.userData.dispose = true; vc.position.set(0, (c * .7 + by) / 2, th * .62); vc.rotation.x = .25; vc.scale.y = by - c * .7; root.add(vc);
    }
  }

  /* ---------- tourelle (tourne autour de Z) ---------- */
  const rear = s.rear, fh = s.frontH, Lh = rear + fh, yc = (fh - rear) / 2, dk = s.deck, hh = s.Hh - dk, hw = s.Wh / 2;
  rbox(s.Wh, Lh, .28, 0, yc, dk - .28, mDark, swing, .14, .03);                                          // plateau
  const cwL = .95 * sc * 1.3, eh = hh * .42, eL = Lh * .5 - cwL * .45, ey = -rear + cwL + eL / 2 - .04;
  // contrepoids galbé, feux arrière et anneau de levage
  { const cw = hw, r = Math.min(.45, cw * .5), y0 = -rear, pts = []; for (let i = 0; i <= 6; i++) { const a = PI + i / 6 * PI / 2; pts.push([-cw + r + Math.cos(a) * r, y0 + r + Math.sin(a) * r]); } for (let i = 0; i <= 6; i++) { const a = 1.5 * PI + i / 6 * PI / 2; pts.push([cw - r + Math.cos(a) * r, y0 + r + Math.sin(a) * r]); } pts.push([cw, y0 + cwL], [-cw, y0 + cwL]);
    plan(pts, hh * .6, dk, mCw, swing, .04);
    [-1, 1].forEach(sx => rbox(.16, .03, .07, sx * (cw - r - .05), y0 + .005, dk + hh * .42, mRed, swing, .01, .008));
    cylZ(.035, .05, 0, y0 + cwL * .45, dk + hh * .6, mSteel, swing, 12); }
  // capot moteur : grille d'aération, échappement, filtre à air
  rbox(s.Wh * .97, eL, eh, 0, ey, dk, mMain, swing, .1, .035);
  { const slats = [], nS = 9, gw = s.Wh * .42, gl = eL * .62; for (let i = 0; i < nS; i++) slats.push(mat4(hw * .42, ey - gl / 2 + (i + .5) * gl / nS, dk + eh + .004)); inst(new THREE.BoxGeometry(gw, gl / nS * .55, .012), mBlack, slats, swing);
    cylZ(.045 * sc + .02, .5 * sc + .15, -hw * .3, ey - eL * .2, dk + eh, mDark, swing, 16); cylZ(.06 * sc + .025, .06, -hw * .3, ey - eL * .2, dk + eh + .5 * sc + .15, mSteel, swing, 16, .04 * sc + .02);
    cylZ(.09 * sc + .03, .14 * sc + .06, -hw * .62, ey + eL * .2, dk + eh, mBlack, swing, 18); }
  // côté droit : réservoirs, coffre, marchepied et main courante
  rbox(s.Wh * .27, Lh * .34, hh * .3, hw - s.Wh * .135 - .01, yc * .2 + Lh * .08, dk, mMain, swing, .06, .03);
  rbox(s.Wh * .24, Lh * .16, hh * .2, hw - s.Wh * .13 - .01, fh - Lh * .1, dk, mDark, swing, .05, .02);
  { const hx = hw - .05, y1 = ey + eL / 2 - .1, y2 = fh - Lh * .22, z1 = dk + hh * .3, z2 = z1 + .42 * Math.max(sc, .6); tube([[hx, y1, z1], [hx, y1, z2], [hx, (y1 + y2) / 2, z2 + .02], [hx, y2, z2], [hx, y2, z1]], .014, mBlack, swing); }
  // cabine : soubassement, montants, vitrages, toit, siège, phares de travail, gyrophare, rétroviseur
  const cabW = Math.min(s.Wh * .46, 1.15 * Math.max(sc, .55)), cabL = 1.5 * Math.max(sc, .6), cx = -hw + cabW / 2 + .03, cy = fh - cabL / 2 - .12, cb = .5 * Math.max(sc, .7), ch = hh - cb, pz = dk + cb, pw = .055;
  rbox(cabW, cabL, cb, cx, cy, dk, mMain, swing, .07, .03);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => rbox(pw, pw, ch - .06, cx + a * (cabW / 2 - pw / 2), cy + b * (cabL / 2 - pw / 2), pz, mDark, swing, .02, .012));
  rbox(pw * .8, pw * .8, ch - .06, cx - cabW / 2 + pw / 2, cy - cabL * .12, pz, mDark, swing, .02, .01);    // montant de porte
  rbox(cabW + .06, cabL + .1, .07, cx, cy + .02, s.Hh - .07, mDark, swing, .08, .025);                       // toit
  const gl = (w, l, h, x, y, z) => add(new THREE.BoxGeometry(w, l, h), mGlass, x, y, z + h / 2, swing);
  gl(cabW - pw * 2, .012, ch - .1, cx, cy + cabL / 2 - pw / 2, pz + .02); gl(cabW - pw * 2, .012, ch - .1, cx, cy - cabL / 2 + pw / 2, pz + .02);
  gl(.012, cabL - pw * 2, ch - .1, cx - cabW / 2 + pw / 2, cy, pz + .02); gl(.012, cabL - pw * 2, ch - .1, cx + cabW / 2 - pw / 2, cy, pz + .02);
  rbox(cabW * .5, cabL * .3, .1, cx, cy - cabL * .12, dk + cb * .75, mSeat, swing, .05, .03); rbox(cabW * .5, .1, ch * .48, cx, cy - cabL * .3, dk + cb * .75, mSeat, swing, .05, .03); // siège
  [-1, 1].forEach(a => { rbox(.07, .2, .16, cx + a * cabW * .32, cy + cabL * .02, dk + cb * .75, mDark, swing, .02, .01); cylZ(.012, .14, cx + a * cabW * .32, cy + cabL * .06, dk + cb * .75 + .16, mBlack, swing, 8); }); // manipulateurs
  rbox(.012, .012, ch * .5, cx + cabW * .15, cy + cabL / 2 - pw / 2 + .012, pz + .05, mBlack, swing, .004, .003).rotation.y = .5;       // essuie-glace
  rbox(.11, .014, .03, cx - cabW / 2 + .03, cy - cabL * .02, pz + ch * .42, mBlack, swing, .01, .005);                                   // poignée
  [-1, 1].forEach(a => { rbox(.13, .07, .09, cx + a * cabW * .28, cy + cabL / 2 + .035, s.Hh - .005, mDark, swing, .02, .01); rbox(.1, .012, .065, cx + a * cabW * .28, cy + cabL / 2 + .074, s.Hh + .008, mLens, swing, .01, .004); });
  cylZ(.045, .03, cx, cy - cabL * .3, s.Hh, mDark, swing, 14); cylZ(.04, .075, cx, cy - cabL * .3, s.Hh + .03, mAmber, swing, 14, .032);
  tube([[cx - cabW / 2, cy + cabL / 2 - .05, pz + ch * .55], [cx - cabW / 2 - .14, cy + cabL / 2 + .06, pz + ch * .62]], .01, mBlack, swing); rbox(.02, .12, .2, cx - cabW / 2 - .15, cy + cabL / 2 + .06, pz + ch * .5, mDark, swing, .01, .006);
  // chape de pied de flèche : deux flasques
  { const fw = Math.max(.5 * sc + .1, .3), ft = .05 * sc + .02, fz = s.bz - dk; [-1, 1].forEach(a => prof([[s.bx - .5 * sc - .25, dk], [s.bx + .32 * sc + .1, dk], [s.bx + .3 * sc + .1, dk + fz + .16 * sc], [s.bx - .1 * sc, dk + fz + .22 * sc], [s.bx - .5 * sc - .15, dk + fz * .5]], ft, mMain, swing, .008, a * (fw / 2 + ft / 2 + .02))); }

  /* ---------- flèche, balancier, godet ---------- */
  const boomG = new THREE.Group(); boomG.position.set(0, s.bx, s.bz); swing.add(boomG);
  const stickG = new THREE.Group(); stickG.position.set(0, s.Lb, 0); boomG.add(stickG);
  const bucketG = new THREE.Group(); bucketG.position.set(0, s.Ls, 0); stickG.add(bucketG);
  const Lb = s.Lb, Ls = s.Ls, Lk = s.Lk, hb = .1 * Lb, tF = .40 * sc, tM = .28 * sc, tE = .2 * sc, bwB = .5 * sc + .1;
  const cl = u => hb * Math.sin(Math.max(0, Math.min(1, u / Lb)) * PI);
  // flèche : caisson galbé, renforts, bossages d'axes, flexibles et phare
  { const top = [], bot = [], N = 14; for (let i = 0; i <= N; i++) { const u = -.2 * sc + (Lb + .2 * sc) * i / N, k = Math.max(0, Math.min(1, u / Lb)), c0 = hb * Math.sin(k * PI), th2 = (k < .5 ? tF + (tM - tF) * k * 2 : tM + (tE - tM) * (k - .5) * 2); top.push([u, c0 + th2 + (i === 0 ? .08 * sc : 0)]); bot.unshift([u, c0 - th2]); }
    prof([...top, ...bot], bwB, mMain, boomG, .02);
    prof([[.36 * Lb, cl(.36 * Lb) - tM * 1.05], [.62 * Lb, cl(.62 * Lb) - tM * 1.05], [.56 * Lb, cl(.56 * Lb) + tM * .2], [.42 * Lb, cl(.42 * Lb) + tM * .2]], bwB + .03, mMain, boomG, .01);
    [[0, 0, .1 * sc + .03], [Lb, 0, .085 * sc + .03]].forEach(([u, v, r]) => { cylX(r * 1.7, bwB + .02, 0, u, v, mMain, boomG, 24); cylX(r, bwB + .12, 0, u, v, mSteel, boomG, 20); });
    const hz = u => hb * Math.sin(Math.max(0, Math.min(1, u / Lb)) * PI) + (u / Lb < .5 ? tF + (tM - tF) * u / Lb * 2 : tM + (tE - tM) * (u / Lb - .5) * 2) + .03;
    [-1, 1].forEach(a => tube([.06, .2, .35, .5, .65, .8, .93].map(k => [a * bwB * .22, k * Lb, hz(k * Lb)]), .016 * sc + .006, mBlack, boomG));
    rbox(.09, .06, .08, bwB / 2 + .045, .3 * Lb, cl(.3 * Lb) + tM * .3, mDark, boomG, .015, .008); rbox(.07, .012, .06, bwB / 2 + .045, .3 * Lb + .034, cl(.3 * Lb) + tM * .3 + .01, mLens, boomG, .01, .004); }
  // balancier
  const tS = .3 * sc, tS2 = .17 * sc, bwS = .38 * sc + .08;
  prof([[-.22 * sc, -tS * .7], [.05 * Ls, -tS], [Ls, -tS2], [Ls + .05 * sc, 0], [Ls, tS2], [.2 * Ls, tS], [.02 * Ls, tS * 1.25], [-.22 * sc, tS * .9]], bwS, mMain, stickG, .018);
  cylX(.085 * sc + .03, bwS + .1, 0, Ls, 0, mSteel, stickG, 20); cylX(.14 * sc + .04, bwS + .02, 0, Ls, 0, mMain, stickG, 24);
  tube([[0, .1 * Ls, tS + .04], [0, .45 * Ls, tS * .75 + .04], [0, .8 * Ls, tS2 + .05]], .014 * sc + .005, mBlack, stickG);
  // godet creux : flancs, coque cintrée, lame d'attaque, dents et oreilles
  const bwK = s.bw, shell = [[.5, .5], [.3, .53], [.12, .47], [-.06, .35], [-.18, .18], [-.12, .02], [.08, -.12], [.3, -.26], [.55, -.3], [.8, -.2], [.95, -.06], [1.02, .02]].map(q => [q[0] * Lk, q[1] * Lk]);
  { const tk = Math.max(.02, .035 * Lk), cxm = .42 * Lk, cym = .12 * Lk, inner = shell.map((q, i) => { const a = shell[Math.max(0, i - 1)], b = shell[Math.min(shell.length - 1, i + 1)]; let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; if ((cxm - q[0]) * nx + (cym - q[1]) * ny < 0) { nx = -nx; ny = -ny; } return [q[0] + nx * tk, q[1] + ny * tk]; });
    prof([...shell, ...inner.reverse()], bwK - .02, mBucket, bucketG, .004);
    [-1, 1].forEach(a => prof(shell, tk, mBucket, bucketG, .004, a * (bwK / 2 - tk / 2)));
    prof([[.86 * Lk, -.16 * Lk], [1.04 * Lk, .0], [1.03 * Lk, .045 * Lk], [.84 * Lk, -.12 * Lk]], bwK + .02, mEdge, bucketG, .003);
    const nT = Math.max(3, Math.round(bwK / .22)), tg = new THREE.ExtrudeGeometry(new THREE.Shape([[0, -.035 * Lk], [.2 * Lk, 0], [0, .05 * Lk]].map(q => new THREE.Vector2(q[0], q[1]))), { depth: .06, bevelEnabled: false }), ta = tg.attributes.position;
    for (let i = 0; i < ta.count; i++) { const u = ta.getX(i), v = ta.getY(i), z = ta.getZ(i); ta.setXYZ(i, z - .03, u, v); } tg.computeVertexNormals();
    const tm = []; for (let i = 0; i < nT; i++) tm.push(mat4(-bwK / 2 + .07 + i * (bwK - .14) / (nT - 1), 1.0 * Lk, .0 * Lk, .8)); inst(tg, mEdge, tm, bucketG);
    [-1, 1].forEach(a => prof([[-.2 * Lk, .16 * Lk], [-.02 * Lk, .42 * Lk], [.16 * Lk, .47 * Lk], [.12 * Lk, .3 * Lk], [0, -.09 * Lk], [-.1 * Lk, -.04 * Lk]], .03 * sc + .012, mBucket, bucketG, .004, a * (bwS / 2 + .03)));
    cylX(.07 * sc + .025, bwS + .14, 0, 0, 0, mSteel, bucketG, 18); }

  /* ---------- vérins et biellettes : deux extrémités accrochées à des pièces qui bougent ---------- */
  const anchor = (par, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); par.add(o); return o; };
  const cyls = [], bars = [], r0 = .075 * sc + .03;
  const cyl = (A, B, r) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 20), mCyl), rod = new THREE.Mesh(new THREE.CylinderGeometry(r * .55, r * .55, 1, 16), mRod), cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * .9, 20), mSteel);
    [body, rod, cap].forEach(o => { o.userData.dispose = true; swing.add(o); }); cyls.push({ A, B, body, rod, cap, lb: 0 });
    [A, B].forEach(q => cylX(r * .95, r * 2.6, q.position.x, q.position.y, q.position.z, mSteel, q.parent, 14));
  };
  const bar = (A, B, w, t) => { const o = new THREE.Mesh(new THREE.BoxGeometry(t, 1, w), mDark); o.userData.dispose = true; swing.add(o); bars.push({ A, B, o }); };
  [-1, 1].forEach(sx => cyl(anchor(swing, sx * (bwB / 2 + .1), s.bx - .55 * sc, s.bz - .45 * sc), anchor(boomG, sx * (bwB / 2 + .1), .3 * Lb, cl(.3 * Lb) - tM * .4), r0));
  cyl(anchor(boomG, 0, .56 * Lb, cl(.56 * Lb) + tM + .12 * sc), anchor(stickG, 0, .18 * Ls, tS + .02), r0 * 1.15);
  cyl(anchor(stickG, 0, .55 * Ls, tS2 + .12 * sc), anchor(bucketG, 0, -.04 * Lk, .3 * Lk), r0);
  [-1, 1].forEach(sx => bar(anchor(stickG, sx * (bwS / 2 + .035), .84 * Ls, tS2 * .5), anchor(bucketG, sx * (bwS / 2 + .035), -.04 * Lk, .3 * Lk), .07 * sc + .02, .025 * sc + .01));

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), dir = new THREE.Vector3();
  function set(pp) {
    const p = clampP(pp);
    swing.rotation.z = -p.sw * D; boomG.rotation.x = p.bm * D; stickG.rotation.x = p.st * D; bucketG.rotation.x = p.bk * D;
    root.updateMatrixWorld(true);
    const ends = c => { c.A.getWorldPosition(v1); c.B.getWorldPosition(v2); swing.worldToLocal(v1); swing.worldToLocal(v2); dir.copy(v2).sub(v1); const d = dir.length(); if (d) { dir.divideScalar(d); q.setFromUnitVectors(Y, dir); } return d; };
    cyls.forEach(c => {
      const d = ends(c); if (!d) return;
      if (!c.lb) c.lb = d * .62;
      const rl = Math.max(.05, d - c.lb * .5);
      c.body.quaternion.copy(q); c.body.scale.y = c.lb; c.body.position.copy(v1).addScaledVector(dir, c.lb / 2);
      c.cap.quaternion.copy(q); c.cap.position.copy(v1).addScaledVector(dir, c.lb);
      c.rod.quaternion.copy(q); c.rod.scale.y = rl; c.rod.position.copy(v1).addScaledVector(dir, c.lb * .5 + rl / 2);
    });
    bars.forEach(b => { const d = ends(b); if (!d) return; b.o.quaternion.copy(q); b.o.scale.y = d; b.o.position.copy(v1).addScaledVector(dir, d / 2); });
  }
  set(p0);
  return { group: root, set };
}
