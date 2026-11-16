/* GeoTrace – maquette 3D (IFC ou GLB) : lecture, calage GPS, calque sur la carte, vue 3D.
   Chargé à la demande, pour ne pas alourdir le démarrage de l'application. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { IfcAPI, IFCMAPCONVERSION, IFCPROJECTEDCRS, IFCSIUNIT, IFCSITE, IFCGEOMETRICREPRESENTATIONCONTEXT } from '../vendor/web-ifc/web-ifc-api.js';
import { makeFrame, solveSimilarity, applyTo, CRS_LIST, latLonToProj, projToLatLon, crsFromName, guessCrs } from './geo.js';

export const crsLabel = code => code === 'SITE' ? 'lieu du projet' : (CRS_LIST.find(c => c.code === code) || { label: code }).label;
export { makeFrame, solveSimilarity, applyTo, projToLatLon, latLonToProj };

const L = window.L;
const RAD = Math.PI / 180;
const tick = () => new Promise(r => setTimeout(r, 30));

/* ================= État ================= */
export const state = {
  model: null,          // { name, kind, group, box, stats, api, id }
  geo: { pairs: [], angle: 0, fixScale: true },   // pairs : [{ m: [x, y], ll: [lat, lon] }]
  frame: null,          // repère local terrain autour d'une origine GPS
  sol: null,            // calage courant { s, theta, t, rms, residuals }
  visible: true,
  opacity: 0.75,
};

/* ================= Lecture ================= */
let ifcApi = null;
async function getIfc() {
  if (ifcApi) return ifcApi;
  const api = new IfcAPI();
  api.SetWasmPath(new URL('../vendor/web-ifc/', import.meta.url).href, true);
  await api.Init();
  return (ifcApi = api);
}

function summarize(group) {
  let meshes = 0, tris = 0;
  group.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return { meshes, tris: Math.round(tris) };
}

async function readIfc(buffer) {
  const api = await getIfc();
  await tick();
  const id = api.OpenModel(new Uint8Array(buffer), { COORDINATE_TO_ORIGIN: true });
  const group = new THREE.Group();
  const cache = new Map(); // géométries partagées entre éléments identiques
  api.StreamAllMeshes(id, mesh => {
    const list = mesh.geometries;
    for (let i = 0; i < list.size(); i++) {
      const pg = list.get(i);
      let geo = cache.get(pg.geometryExpressID);
      if (!geo) {
        const g = api.GetGeometry(id, pg.geometryExpressID);
        const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        geo = new THREE.BufferGeometry();
        const buf = new THREE.InterleavedBuffer(verts.slice(), 6);
        geo.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
        geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(buf, 3, 3));
        geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
        g.delete(); cache.set(pg.geometryExpressID, geo);
      }
      const c = pg.color, blank = c.x > .96 && c.y > .96 && c.z > .96; // éléments sans couleur : gris-bleu lisible sur fond clair comme sur photo
      const mat = new THREE.MeshLambertMaterial({ color: blank ? new THREE.Color(0xa9b8c9) : new THREE.Color(c.x, c.y, c.z), opacity: c.w, transparent: c.w < 1, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
      m.userData.expressID = mesh.expressID;
      group.add(m);
    }
  });
  // web-ifc fournit la géométrie avec Y vers le haut : on la remet Z vers le haut comme dans Revit.
  const up = new THREE.Group(); up.add(group); up.rotation.x = Math.PI / 2; up.updateMatrixWorld(true);
  let coord = null; try { coord = Array.from(api.GetCoordinationMatrix(id)); } catch (e) { /* absent */ }
  return { group: up, api, id, coord };
}

function readGlb(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', gltf => {
      const group = new THREE.Group();
      gltf.scene.rotation.x = Math.PI / 2; // glTF est orienté Y vers le haut, la maquette Z vers le haut
      group.add(gltf.scene); group.updateMatrixWorld(true);
      resolve({ group, api: null, id: null });
    }, reject);
  });
}

/* Charge la maquette, la recentre sur son emprise (x, y) et garde z d'origine. */
export async function loadModel(buffer, name) {
  unloadModel();
  const isGlb = /\.(glb|gltf)$/i.test(name);
  const { group, api, id, coord } = isGlb ? await readGlb(buffer) : await readIfc(buffer);
  const stats = summarize(group);
  if (!stats.meshes) throw new Error('empty');
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group(); inner.add(group); group.position.set(-c.x, -c.y, 0); inner.updateMatrixWorld(true);
  const lbox = new THREE.Box3().setFromObject(inner);
  state.georef = null;
  state.model = { name, kind: isGlb ? 'GLB' : 'IFC', group: inner, box: lbox, stats, api, id, offset: [c.x, c.y], coord };
  try { state.georef = isGlb ? null : readGeoref(state.model); } catch (e) { console.warn('géoréférencement illisible', e); state.georef = null; }
  return { name, kind: state.model.kind, ...stats, size: lbox.getSize(new THREE.Vector3()).toArray() };
}
export function unloadModel() {
  if (state.model && state.model.api) { try { state.model.api.CloseModel(state.model.id); } catch (e) { /* déjà fermé */ } }
  state.model = null; state.sol = null; state.georef = null;
  closePlan(); close3D();
  if (ovl) { if (ovl.holder) ovl.scene.remove(ovl.holder); ovl.holder = null; renderOverlay(); }
}
export function describe(expressID) {
  const m = state.model; if (!m || !m.api) return null;
  try {
    const line = m.api.GetLine(m.id, expressID, false);
    const type = m.api.GetNameFromTypeCode(m.api.GetLineType(m.id, expressID));
    const val = v => v && v.value != null ? v.value : null;
    return { type: String(type || '').replace(/^IFC/i, 'Ifc'), name: val(line.Name), tag: val(line.Tag) || val(line.ObjectType) };
  } catch (e) { return null; }
}

/* ================= Géoréférencement lu dans le fichier IFC (Revit) ================= */
const val = v => (v && v.value != null ? v.value : v);
function lines(api, id, type) { const out = [], v = api.GetLineIDsWithType(id, type); for (let i = 0; i < v.size(); i++) out.push(v.get(i)); return out; }
/* Coefficient qui ramène une longueur de la maquette (en mètres) dans l'unité du projet IFC. */
function projectUnitM(api, id) {
  for (const e of lines(api, id, IFCSIUNIT)) {
    const u = api.GetLine(id, e, false);
    if (String(val(u.UnitType)) !== 'LENGTHUNIT') continue;
    const f = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[String(val(u.Prefix))];
    return f || 1;
  }
  return 1;
}
/* Repère d'origine de l'IFC : « brut = position dans la scène + décalage ». web-ifc recentre la géométrie, la matrice de coordination dit de combien. */
function rawOffset(model) {
  const t = model.coord ? [model.coord[12], model.coord[13], model.coord[14]] : [0, 0, 0];
  return [model.offset[0] - t[0], model.offset[1] + t[2]];
}
const plausible = ll => !!ll && ll[0] > 40 && ll[0] < 52 && ll[1] > -6 && ll[1] < 10;
function readGeoref(model) {
  const g = readMapGeoref(model), at0 = g && g.crs && g.fn ? projToLatLon(g.crs, ...g.fn([0, 0])) : null;
  if (g && plausible(at0)) return g;
  if (g && g.fn) { // le système écrit par Revit (souvent Web Mercator par défaut) ne colle pas aux valeurs : on cherche un système français qui convient
    const cands = guessCrs(...g.fn([0, 0])).map(c => c.code);
    if (cands.length) return Object.assign(g, { crs: cands[0], candidates: cands, corrected: g.crsName });
  }
  const site = readSiteGeoref(model);   // pas de position utilisable dans IfcMapConversion : lieu du projet défini dans Revit
  return site || g;
}
/* Latitude/longitude du lieu du projet (IfcSite), avec l'angle du nord vrai. Position approximative : c'est le lieu choisi dans Revit, pas un relevé. */
function readSiteGeoref(model) {
  const api = model.api, id = model.id, off = rawOffset(model);
  const sites = lines(api, id, IFCSITE); if (!sites.length) return null;
  const site = api.GetLine(id, sites[0], false);
  const list = a => Array.isArray(a) ? a : (a && Array.isArray(a.value) ? a.value : null);
  const dms = raw => { const a = list(raw); if (!a || a.length < 3) return null; const v = a.map(x => +val(x) || 0), sg = v.some(x => x < 0) ? -1 : 1; return sg * (Math.abs(v[0]) + Math.abs(v[1]) / 60 + (Math.abs(v[2]) + Math.abs(v[3] || 0) / 1e6) / 3600); };
  const lat = dms(site.RefLatitude), lon = dms(site.RefLongitude);
  if (lat == null || lon == null || (!lat && !lon)) return null;
  let phi = 90; // direction du nord vrai dans le repère de la maquette, en degrés depuis l'axe X (90 = nord vers +Y)
  try {
    for (const e of lines(api, id, IFCGEOMETRICREPRESENTATIONCONTEXT)) {
      const c = api.GetLine(id, e, false), tn = val(c.TrueNorth); if (tn == null) continue;
      const d = list(api.GetLine(id, tn, false).DirectionRatios).map(x => +val(x));
      if (Math.hypot(d[0], d[1]) > 1e-9) { phi = Math.atan2(d[1], d[0]) / RAD; break; }
    }
  } catch (e) { /* nord par défaut */ }
  const rot = (90 - phi) * RAD, cr = Math.cos(rot), sr = Math.sin(rot), Rt = 6371008.8;
  return { source: 'IfcSite', crs: 'SITE', crsName: 'lieu du projet', candidates: ['SITE'], off, site: [lat, lon],
    ll: m => { const x = m[0] + off[0], y = m[1] + off[1], e = cr * x - sr * y, n = sr * x + cr * y;
      return [lat + n / Rt / RAD, lon + e / (Rt * Math.cos(lat * RAD)) / RAD]; } };
}
function readMapGeoref(model) {
  const api = model.api, id = model.id, off = rawOffset(model);
  const maps = lines(api, id, IFCMAPCONVERSION);
  if (maps.length) {
    const mc = api.GetLine(id, maps[0], false);
    let name = null;
    try { const ref = val(mc.TargetCRS); if (ref != null) name = val(api.GetLine(id, ref, false).Name); } catch (e) { /* nom absent */ }
    if (!name) { const c = lines(api, id, IFCPROJECTEDCRS); if (c.length) name = val(api.GetLine(id, c[0], false).Name); }
    const E = +val(mc.Eastings), N = +val(mc.Northings);
    const a = val(mc.XAxisAbscissa) != null ? +val(mc.XAxisAbscissa) : 1, b = val(mc.XAxisOrdinate) != null ? +val(mc.XAxisOrdinate) : 0;
    const norm = Math.hypot(a, b) || 1, ca = a / norm, sa = b / norm;
    const k = (val(mc.Scale) != null ? +val(mc.Scale) : 1) / projectUnitM(api, id);
    const crs = crsFromName(name);
    return { source: 'IfcMapConversion', crsName: name, crs, candidates: crs ? [crs] : [], off,
      fn: m => { const x = m[0] + off[0], y = m[1] + off[1]; return [E + k * (ca * x - sa * y), N + k * (sa * x + ca * y)]; } };
  }
  // Pas de IfcMapConversion : Revit a pu exporter les coordonnées partagées directement (ex. Lambert-93) dans les positions.
  const b = model.box, cx = (b.min.x + b.max.x) / 2 + off[0], cy = (b.min.y + b.max.y) / 2 + off[1];
  const cands = guessCrs(cx, cy).map(c => c.code);
  if (!cands.length) return null;
  return { source: 'coordonnées', crs: cands[0], candidates: cands, off, fn: m => [m[0] + off[0], m[1] + off[1]] };
}
/* Deux points de calage déduits des coordonnées de la maquette (coins opposés de l'emprise). */
export function georefPairs(crs) {
  const g = state.georef, m = state.model; if (!g || !m) return null;
  const code = crs || g.crs; if (!code) return null;
  const b = m.box, pts = [[b.min.x, b.min.y], [b.max.x, b.max.y]];
  const pairs = pts.map(p => { const ll = g.ll ? g.ll(p) : projToLatLon(code, ...g.fn(p)); return ll && { m: p, ll }; });
  if (pairs.some(p => !p || !plausible(p.ll))) return null;
  return pairs;
}
/* Place la maquette d'après le géoréférencement du fichier. Rend false si le fichier n'en contient pas d'utilisable. */
export function applyGeoref(crs) {
  const pairs = georefPairs(crs); if (!pairs) return false;
  state.geo = { pairs, angle: 0, fixScale: true, auto: crs || state.georef.crs };
  return true;
}

/* ================= Calage ================= */
export function setFrameAt(lat, lon) { state.frame = makeFrame(lat, lon); }
export function solve() {
  const g = state.geo;
  if (g.pairs.length) state.frame = makeFrame(g.pairs[0].ll[0], g.pairs[0].ll[1]);
  if (!state.frame) return null;
  if (!g.pairs.length) { state.sol = { s: 1, theta: g.angle * RAD, t: [0, 0], rms: 0, residuals: [], placeholder: true }; return state.sol; }
  const pairs = g.pairs.map(p => ({ m: p.m, e: state.frame.toEN(p.ll[0], p.ll[1]) }));
  state.sol = solveSimilarity(pairs, { fixScale: g.fixScale, angle: g.angle });
  return state.sol;
}
export const isPlaced = () => !!(state.model && state.sol && !state.sol.placeholder);
export function applyTransform(obj) {
  const s = state.sol; if (!s) return;
  obj.position.set(s.t[0], s.t[1], 0); obj.rotation.set(0, 0, s.theta); obj.scale.setScalar(s.s);
  obj.updateMatrixWorld(true);
}
/* Position GPS (lat, lon) d'un point de la maquette. */
export const modelToLatLon = m => state.sol && state.frame ? state.frame.toLL(...applyTo(state.sol, m)) : null;
export function sceneToGeo() { return state.frame; }

export function exportCalage() {
  return JSON.stringify({ geotrace: 'calage', version: 1, maquette: state.model ? state.model.name : null,
    fixScale: state.geo.fixScale, angle: state.geo.angle,
    points: state.geo.pairs.map(p => ({ maquette: p.m.map(v => +v.toFixed(3)), lat: +p.ll[0].toFixed(8), lon: +p.ll[1].toFixed(8) })),
    resultat: state.sol && !state.sol.placeholder ? { echelle: +state.sol.s.toFixed(5), rotation_deg: +(state.sol.theta / RAD).toFixed(3), ecart_moyen_m: +state.sol.rms.toFixed(3) } : null }, null, 2);
}
export function importCalage(text) {
  const j = JSON.parse(text);
  if (!j || j.geotrace !== 'calage' || !Array.isArray(j.points)) throw new Error('format');
  state.geo = { fixScale: j.fixScale !== false, angle: +j.angle || 0,
    pairs: j.points.filter(p => Array.isArray(p.maquette) && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => ({ m: [+p.maquette[0], +p.maquette[1]], ll: [p.lat, p.lon] })) };
}

/* ================= Calque sur la carte ================= */
let ovl = null;
export function attachMap(map) {
  if (ovl) return;
  map.createPane('maquette'); const pane = map.getPane('maquette'); pane.style.zIndex = 450; pane.style.pointerEvents = 'none';
  const canvas = document.createElement('canvas'); canvas.style.position = 'absolute'; canvas.style.pointerEvents = 'none'; canvas.classList.add('leaflet-zoom-animated'); pane.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.5)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-1, -1.5, 3); scene.add(dl);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000); camera.up.set(0, 1, 0);
  ovl = { map, canvas, renderer, scene, camera, holder: null, raf: 0 };
  const sched = () => { if (!ovl.raf) ovl.raf = requestAnimationFrame(() => { ovl.raf = 0; renderOverlay(); }); };
  map.on('move zoom viewreset resize zoomend moveend', sched);
  // Pendant le zoom animé de la carte, la maquette suit l'animation comme les tuiles (sinon elle reste collée à l'écran).
  map.on('zoomanim', e => {
    if (!ovl.drawn) return;
    const scale = map.getZoomScale(e.zoom, ovl.drawn.zoom), off = map._latLngToNewLayerPoint(map.layerPointToLatLng(ovl.drawn.topLeft), e.zoom, e.center);
    L.DomUtil.setTransform(canvas, off, scale);
  });
  ovl.sched = sched;
}
export function refreshOverlay() {
  if (!ovl) return;
  solve();
  if (ovl.holder) { ovl.scene.remove(ovl.holder); ovl.holder = null; }
  if (state.model && state.sol) {
    ovl.holder = new THREE.Group(); ovl.holder.add(state.model.group.clone()); applyTransform(ovl.holder); ovl.scene.add(ovl.holder);
  }
  renderOverlay();
}
export function renderOverlay() {
  if (!ovl) return;
  const { map, canvas, renderer, camera } = ovl;
  const show = !!(ovl.holder && state.visible && state.frame);
  canvas.style.display = show ? 'block' : 'none';
  if (!show) return;
  const size = map.getSize(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) { renderer.setPixelRatio(dpr); renderer.setSize(size.x, size.y, false); }
  canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
  const topLeft = map.containerPointToLayerPoint([0, 0]);
  L.DomUtil.setPosition(canvas, topLeft);
  ovl.drawn = { zoom: map.getZoom(), topLeft };
  canvas.style.opacity = state.opacity;
  const f = state.frame, tl = f.toEN(...llArr(map.containerPointToLatLng([0, 0]))), br = f.toEN(...llArr(map.containerPointToLatLng([size.x, size.y])));
  camera.left = tl[0]; camera.right = br[0]; camera.top = tl[1]; camera.bottom = br[1];
  camera.position.set((tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2, 2000); camera.lookAt((tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2, 0);
  camera.updateProjectionMatrix();
  renderer.render(ovl.scene, camera);
}
const llArr = ll => [ll.lat, ll.lng];
export function setVisible(v) { state.visible = v; renderOverlay(); }
export function setOpacity(v) { state.opacity = v; renderOverlay(); }
/* Emprise de la maquette sur la carte, pour zoomer dessus. */
export function mapBounds() {
  if (!state.model || !state.sol || !state.frame) return null;
  const b = state.model.box, pts = [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]].map(p => state.frame.toLL(...applyTo(state.sol, p)));
  return pts;
}

/* ================= Vue plan : choix des points de calage ================= */
let plan = null;
export function openPlan(host, { onPick }) {
  closePlan();
  const m = state.model; if (!m) return null;
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0xe9eff6, 1);
  host.appendChild(renderer.domElement); renderer.domElement.className = 'plan-canvas';
  const scene = new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff, 1.5)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-1, -1.5, 3); scene.add(dl);
  scene.add(m.group.clone());
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000); camera.up.set(0, 1, 0);
  const size = m.box.getSize(new THREE.Vector3());
  const view = { cx: 0, cy: 0, half: Math.max(size.y, size.x * 0.6, 5) * 0.6 };
  const markers = document.createElement('div'); markers.className = 'plan-marks'; host.appendChild(markers);
  plan = { host, renderer, scene, camera, view, markers, pairs: [], pending: null, onPick, dead: false };
  const fit = () => {
    const w = host.clientWidth || 400, h = host.clientHeight || 300; renderer.setSize(w, h);
    const a = w / h; camera.left = -view.half * a; camera.right = view.half * a; camera.top = view.half; camera.bottom = -view.half; camera.updateProjectionMatrix();
    camera.position.set(view.cx, view.cy, 2000); camera.lookAt(view.cx, view.cy, 0);
    renderer.render(scene, camera); placeMarks();
  };
  const toWorld = (px, py) => { const r = host.getBoundingClientRect(); const a = r.width / r.height; return [view.cx + ((px - r.left) / r.width * 2 - 1) * view.half * a, view.cy - ((py - r.top) / r.height * 2 - 1) * view.half]; };
  const toPx = (x, y) => { const r = host.getBoundingClientRect(); const a = r.width / r.height; return [((x - view.cx) / (view.half * a) + 1) / 2 * r.width, (1 - (y - view.cy) / view.half) / 2 * r.height]; };
  function placeMarks() {
    markers.textContent = '';
    const add = (xy, label, cls) => { const d = document.createElement('i'); d.className = cls; d.textContent = label; const p = toPx(xy[0], xy[1]); d.style.left = p[0] + 'px'; d.style.top = p[1] + 'px'; markers.appendChild(d); };
    plan.pairs.forEach((p, i) => add(p.m, String(i + 1), 'pm'));
    if (plan.pending) add(plan.pending, '?', 'pm pend');
  }
  plan.redraw = fit; plan.placeMarks = placeMarks;
  host.style.touchAction = 'none';
  let drag = null; const pts = new Map();
  const dn = e => { host.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); drag = { x: e.clientX, y: e.clientY, moved: false, cx: view.cx, cy: view.cy }; };
  const mv = e => {
    if (!drag || !pts.has(e.pointerId)) return;
    const r = host.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (drag.moved) { const per = view.half * 2 / r.height; view.cx = drag.cx - dx * per; view.cy = drag.cy + dy * per; fit(); }
  };
  const up = e => {
    if (!drag) return;
    if (!drag.moved) { const w = toWorld(e.clientX, e.clientY); onPick(w); }
    drag = null; pts.delete(e.pointerId);
  };
  const wheel = e => {
    e.preventDefault(); const before = toWorld(e.clientX, e.clientY);
    view.half = Math.min(Math.max(view.half * Math.exp(e.deltaY * .0012), 0.3), 5000);
    const after = toWorld(e.clientX, e.clientY); view.cx += before[0] - after[0]; view.cy += before[1] - after[1]; fit();
  };
  host.addEventListener('pointerdown', dn); host.addEventListener('pointermove', mv); host.addEventListener('pointerup', up); host.addEventListener('wheel', wheel, { passive: false });
  plan.ro = new ResizeObserver(fit); plan.ro.observe(host);
  plan.cleanup = () => { host.removeEventListener('pointerdown', dn); host.removeEventListener('pointermove', mv); host.removeEventListener('pointerup', up); host.removeEventListener('wheel', wheel); };
  fit();
  return plan;
}
export function planSet(pairs, pending) { if (!plan) return; plan.pairs = pairs; plan.pending = pending; plan.placeMarks(); }
export function planFit() { if (!plan) return; const s = state.model.box.getSize(new THREE.Vector3()); plan.view.cx = 0; plan.view.cy = 0; plan.view.half = Math.max(s.y, s.x * 0.6, 5) * 0.6; plan.redraw(); }
export function closePlan() {
  if (!plan) return;
  plan.ro.disconnect(); plan.cleanup(); plan.renderer.dispose(); plan.renderer.domElement.remove(); plan.markers.remove(); plan.scene.clear(); plan = null;
}

/* ================= Vue 3D ================= */
let v3 = null;
const WMTS_ORTHO = (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => (1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * 2 ** z;
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) / RAD;

async function buildGround(frame, bounds) {
  // bounds : [minE, minN, maxE, maxN] en mètres autour de l'origine ; choisit le niveau de zoom qui garde ≤ 36 tuiles
  const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]].map(p => frame.toLL(p[0], p[1]));
  let z = 19, x0, x1, y0, y1;
  for (; z >= 15; z--) {
    x0 = Math.floor(lon2x(corners[0][1], z)); x1 = Math.floor(lon2x(corners[1][1], z));
    y0 = Math.floor(lat2y(corners[1][0], z)); y1 = Math.floor(lat2y(corners[0][0], z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 36) break;
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, canvas = document.createElement('canvas'); canvas.width = nx * 256; canvas.height = ny * 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#9aa7b5'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let ok = 0;
  await Promise.all(Array.from({ length: nx * ny }, (_, k) => new Promise(res => {
    const tx = x0 + (k % nx), ty = y0 + Math.floor(k / nx), img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256); ok++; res(); }; img.onerror = () => res();
    img.src = WMTS_ORTHO(z, tx, ty);
  })));
  const ll = (tx, ty) => frame.toEN(y2lat(ty, z), x2lon(tx, z));
  const q = [ll(x0, y1 + 1), ll(x1 + 1, y1 + 1), ll(x1 + 1, y0), ll(x0, y0)]; // SO, SE, NE, NO
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(p => [p[0], p[1], 0]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { mesh: new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ok ? tex : null, color: ok ? 0xffffff : 0xb7c2cf })), tiles: ok };
}

const DEVCOL = { phone: 0xf26b1d, tab: 0x0fa37f, drone: 0x7b4fd6 };
/* photos : [{ id, name, lat, lon, heading, dev, rel }] ; focus : id d'une photo pour placer la caméra comme à la prise de vue. */
export async function open3D(host, { photos = [], focus = null, onPhoto, onElement }) {
  close3D();
  const m = state.model; if (!m || !state.sol || !state.frame) return null;
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement); renderer.domElement.className = 'v3-canvas';
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbcd3e6);
  scene.add(new THREE.AmbientLight(0xffffff, 1.7)); const dl = new THREE.DirectionalLight(0xffffff, 1.8); dl.position.set(-60, -80, 120); scene.add(dl);
  const holder = new THREE.Group(); holder.add(m.group.clone()); applyTransform(holder); scene.add(holder);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000); camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495;
  // emprise terrain de la maquette et des photos proches
  const bb = new THREE.Box3().setFromObject(holder), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  const radius = Math.max(60, Math.max(sz.x, sz.y) * 0.9);
  const bounds = [c.x - radius * 1.2, c.y - radius * 1.2, c.x + radius * 1.2, c.y + radius * 1.2];
  v3 = { host, renderer, scene, camera, controls, holder, raf: 0, dead: false, photoMeshes: [], ground: null, onPhoto, onElement, center: c, radius };
  // photos
  const markers = new THREE.Group(); scene.add(markers);
  photos.filter(p => p.lat != null).forEach(p => {
    const [e, n] = state.frame.toEN(p.lat, p.lon);
    if (Math.abs(e - c.x) > radius * 3 || Math.abs(n - c.y) > radius * 3) return;
    const z = p.dev === 'drone' ? (p.rel != null ? p.rel : 30) : 1.6;
    const mat = new THREE.MeshBasicMaterial({ color: DEVCOL[p.dev] || 0xf26b1d });
    const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, radius / 90), 16, 12), mat); s.position.set(e, n, z); s.userData.photoId = p.id; markers.add(s); v3.photoMeshes.push(s);
    if (p.heading != null) {
      const len = Math.max(3, radius / 12), cone = new THREE.Mesh(new THREE.ConeGeometry(len * .22, len, 14), mat);
      const h = p.heading * RAD; // cône : sommet à l'appareil, base vers la direction visée (le cône pointe vers +Y par défaut)
      cone.rotation.z = Math.PI - h; cone.position.set(e + Math.sin(h) * len / 2, n + Math.cos(h) * len / 2, z); cone.userData.photoId = p.id; markers.add(cone); v3.photoMeshes.push(cone);
    }
    p._e = e; p._n = n; p._z = z;
  });
  v3.photos = photos;
  const fitSize = () => { const w = host.clientWidth || 800, h = host.clientHeight || 500; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  v3.ro = new ResizeObserver(fitSize); v3.ro.observe(host); fitSize();
  v3.overview = () => { const d = radius * 1.6; camera.position.set(c.x - d * .5, c.y - d * .9, Math.max(sz.z, 5) + d * .7); controls.target.set(c.x, c.y, 0); controls.update(); };
  v3.fromPhoto = id => {
    const p = photos.find(x => x.id === id); if (!p || p._e == null) return false;
    const h = (p.heading != null ? p.heading : Math.atan2(c.x - p._e, c.y - p._n) / RAD) * RAD;
    camera.position.set(p._e, p._n, p._z); controls.target.set(p._e + Math.sin(h) * 12, p._n + Math.cos(h) * 12, p._z - 0.3); controls.update(); return true;
  };
  if (!(focus && v3.fromPhoto(focus))) v3.overview();
  // sélection par clic
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; down = null;
    const r = renderer.domElement.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const hitP = ray.intersectObjects(v3.photoMeshes, false)[0];
    if (hitP && onPhoto) { onPhoto(hitP.object.userData.photoId); return; }
    const hit = ray.intersectObject(holder, true)[0];
    if (hit && onElement) { const info = describe(hit.object.userData.expressID); onElement(info, hit.point); } else if (onElement) onElement(null);
  });
  const loop = () => { if (!v3 || v3.dead) return; v3.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  // fond photo aérienne, chargé en arrière-plan
  buildGround(state.frame, bounds).then(g => { if (!v3 || v3.dead) return; v3.ground = g.mesh; v3.groundTiles = g.tiles; scene.add(g.mesh); }).catch(() => { /* fond uni */ });
  return v3;
}
export function v3Ground(on) { if (v3 && v3.ground) v3.ground.visible = on; }
export function v3Overview() { if (v3) v3.overview(); }
export function v3FromPhoto(id) { return v3 ? v3.fromPhoto(id) : false; }
export function v3Has() { return !!v3; }
export function close3D() {
  if (!v3) return;
  v3.dead = true; cancelAnimationFrame(v3.raf); v3.ro.disconnect(); v3.controls.dispose();
  v3.scene.traverse(o => { if (o.isMesh && (o.userData.photoId || o === v3.ground)) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  v3.renderer.dispose(); v3.renderer.domElement.remove(); v3 = null;
}
