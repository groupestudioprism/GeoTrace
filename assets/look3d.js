/* GeoTrace – rendu réaliste de la vue 3D : ciel, soleil avec ombres portées, reflets d'environnement et matériaux physiques.
   Le monde est en Z vers le haut. Tout est calculé sur place (aucune image téléchargée).
   setupLook(renderer, scene, world) → { sky, sun, frame(target, dist), setLocked(on), upgrade(obj), dispose() } */
import * as THREE from '../vendor/three/three.module.js';

const SUN_DIR = new THREE.Vector3(0.60, -0.42, 0.68).normalize(); // soleil au sud-est, fin de matinée : les ombres partent vers le nord-ouest
const ZENITH = new THREE.Color(0x3f7fd0), HORIZON = new THREE.Color(0xdbe8f4), HAZE = new THREE.Color(0xc9d9e8), SOIL = new THREE.Color(0x8c8679);

function skyDome(radius, withSun) {
  const g = new THREE.SphereGeometry(radius, 48, 24); g.rotateX(Math.PI / 2); // pôles sur l'axe Z
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getZ(i) / radius; // -1 nadir … +1 zénith
    if (h >= 0) c.copy(HORIZON).lerp(ZENITH, Math.pow(h, 0.55)); else c.copy(HAZE).lerp(SOIL, Math.min(1, -h * 6));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const grp = new THREE.Group();
  const dome = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  dome.renderOrder = -100; dome.frustumCulled = false; grp.add(dome);
  if (withSun) { // disque très lumineux : il donne les reflets nets sur les carrosseries et les vitrages
    const s = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.045, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 54, 44), fog: false }));
    s.position.copy(SUN_DIR).multiplyScalar(radius * 0.9); grp.add(s);
  }
  return grp;
}

/* ---------- Matériaux ---------- */
const CONV = new WeakMap(), hsl = { h: 0, s: 0, l: 0 };
const keep = (m, o) => Object.assign(o, { name: m.name, color: m.color.clone(), map: m.map || null, opacity: m.opacity, transparent: m.transparent, side: m.side, alphaTest: m.alphaTest, depthWrite: m.depthWrite, depthTest: m.depthTest, vertexColors: m.vertexColors, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits, visible: m.visible });
function engineMat(m) { // modèles d'engins : peinture vernie, caoutchouc, métal, vitrage, tissu
  m.color.getHSL(hsl); const n = (m.name || '').toLowerCase(), base = keep(m, {});
  if (m.transparent || m.opacity < 0.98) {
    if (m.opacity < 0.7) return new THREE.MeshPhysicalMaterial(Object.assign(base, { roughness: 0.06, metalness: 0, envMapIntensity: 1.7, specularIntensity: 1, opacity: Math.max(0.3, m.opacity), depthWrite: false }));
    return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.35, metalness: 0, emissive: m.color.clone().multiplyScalar(0.25) })); // feux, gyrophares
  }
  if (/peau/.test(n)) return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.62, metalness: 0 }));
  if (/veste|pantalon|chaussure/.test(n)) return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.94, metalness: 0 }));
  if (/pneu/.test(n) || hsl.l < 0.085) return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.93, metalness: 0 }));
  if (hsl.s < 0.13 && !/carrosserie|casque/.test(n)) {
    if (hsl.l < 0.3) return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.72, metalness: 0.35 })); // châssis, chenilles
    if (hsl.l < 0.78) return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.4, metalness: 0.75 })); // acier, vérins
  }
  return new THREE.MeshPhysicalMaterial(Object.assign(base, { roughness: 0.48, metalness: 0.06, clearcoat: 0.6, clearcoatRoughness: 0.2 })); // peinture
}
function plainMat(m) { // maquette et éléments construits : mat par défaut, vitrage si translucide
  const base = keep(m, {});
  if ((m.transparent || m.opacity < 1) && m.opacity < 0.75 && !m.map) return new THREE.MeshPhysicalMaterial(Object.assign(base, { roughness: 0.08, metalness: 0, envMapIntensity: 1.5, depthWrite: false }));
  const shine = m.isMeshPhongMaterial ? Math.min(1, (m.shininess || 30) / 100) : 0;
  return new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.88 - shine * 0.5, metalness: shine * 0.35 }));
}
function conv(m, engine) {
  if (!m) return m;
  if (!(m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial)) { if ('toneMapped' in m) m.toneMapped = false; return m; }
  if (m.userData.gtLook) return m;
  let r = CONV.get(m);
  if (!r) {
    r = engine ? engineMat(m) : (m.isMeshStandardMaterial ? m : plainMat(m));
    r.userData.gtLook = true; if (m.emissive && r.emissive && !engine) r.emissive.copy(m.emissive);
    CONV.set(m, r);
  }
  return r;
}
/* Passe sur un objet : matériaux physiques et ombres. Sans effet sur ce qui a déjà été traité. */
export function upgrade(root) {
  root.traverse(o => {
    if (!o.isMesh || o.userData.gtSeen === o.material || o.material.isShadowMaterial) return;
    let eng = false; for (let p = o; p; p = p.parent) if (p.name === 'engins') { eng = true; break; }
    o.material = Array.isArray(o.material) ? o.material.map(m => conv(m, eng)) : conv(o.material, eng);
    o.userData.gtSeen = o.material;
    const m0 = Array.isArray(o.material) ? o.material[0] : o.material, lit = m0 && m0.isMeshStandardMaterial;
    o.castShadow = !!lit && !(m0.transparent && m0.opacity < 0.5) && !m0.polygonOffset; o.receiveShadow = !!lit;
  });
}

export function setupLook(renderer, scene, world) {
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const k = world.matrix.getMaxScaleOnAxis() || 1; // unités de la scène par mètre
  // reflets : le même ciel, filtré une fois
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(); envScene.add(skyDome(50, true));
  const env = pm.fromScene(envScene, 0.035, 1, 200); pm.dispose(); envScene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  scene.environment = env.texture; scene.environmentIntensity = 0.8; scene.background = null;
  const sky = skyDome(1, false); sky.scale.setScalar(20000); scene.add(sky);
  scene.fog = new THREE.Fog(HAZE.getHex(), 900 * k, 9000 * k);
  const hemi = new THREE.HemisphereLight(0xdcebff, 0xa39a88, 1.05); hemi.position.set(0, 0, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.1); sun.castShadow = true; scene.add(sun, sun.target);
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04 * k;
  // sol invisible qui ne reçoit que les ombres, posé juste au-dessus de la photo aérienne
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.5, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  catcher.receiveShadow = true; catcher.renderOrder = 1; catcher.position.z = 0.015; world.add(catcher);
  const inv = new THREE.Matrix4(), cw = new THREE.Vector3(), last = { x: 1e9, y: 1e9, half: 0 };
  let slow = 0; const force = /[?&]ombres=1\b/.test(location.search); // ?ombres=1 : garde les ombres même sur un ordinateur lent
  return {
    sky, sun, catcher,
    /* à chaque image : le ciel suit la caméra ; les ombres se recentrent sur ce que l'on regarde (renvoie true si elles doivent être recalculées) */
    frame(camera, target) {
      sky.position.copy(camera.position);
      const d = camera.position.distanceTo(target) / k; // mètres
      let half = 30; while (half < d * 1.15 && half < 600) half *= 1.6;
      const moved = Math.hypot(target.x - last.x, target.y - last.y) / k;
      if (half === last.half && moved < half * 0.3) return false;
      last.x = target.x; last.y = target.y; last.half = half;
      const H = half * k, c = new THREE.Vector3(target.x, target.y, 0); // le sol de la scène est à z = 0 dans le repère du monde ; l'écart est couvert par la profondeur
      sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN_DIR, H * 3); sun.target.updateMatrixWorld();
      const sc = sun.shadow.camera; sc.left = -H; sc.right = H; sc.top = H; sc.bottom = -H; sc.near = H * 0.5; sc.far = H * 6; sc.updateProjectionMatrix();
      sun.shadow.normalBias = Math.max(0.02, half / 900) * k;
      inv.copy(world.matrixWorld).invert(); cw.copy(c).applyMatrix4(inv); catcher.position.set(cw.x, cw.y, 0.015); catcher.scale.set(half * 2.4, half * 2.4, 1);
      return true;
    },
    setLocked(on) { sky.visible = !on; catcher.visible = !on; },
    /* ordinateur lent : on renonce aux ombres plutôt qu'à la fluidité */
    budget(ms) { if (force) return false; slow = ms > 55 ? slow + 1 : Math.max(0, slow - 1); if (slow > 25 && sun.castShadow) { sun.castShadow = false; catcher.visible = false; return true; } return false; },
    upgrade,
    dispose() { env.dispose(); sky.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); catcher.geometry.dispose(); catcher.material.dispose(); if (sun.shadow.map) sun.shadow.map.dispose(); }
  };
}
