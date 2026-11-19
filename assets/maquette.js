/* GeoTrace – maquette 3D (IFC ou GLB) : lecture, calage GPS, calque sur la carte, vue 3D.
   Chargé à la demande, pour ne pas alourdir le démarrage de l'application. */
import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/controls/OrbitControls.js';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { IfcAPI, IFCMAPCONVERSION, IFCPROJECTEDCRS, IFCSIUNIT, IFCSITE, IFCGEOMETRICREPRESENTATIONCONTEXT } from '../vendor/web-ifc/web-ifc-api.js';
import { buildZones, buildDevs, buildNets } from './zones3d.js';
import { buildEngins } from './engins3d.js';
import { setupLook } from './look3d.js';
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
  unloadModel(); projChantier = null;
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
const typeCache = new Map();
function typeOf(id) {
  const m = state.model; if (!m || !m.api || id == null) return null;
  if (!typeCache.has(m.id + ':' + id)) { let t = null; try { t = String(m.api.GetNameFromTypeCode(m.api.GetLineType(m.id, id)) || '').replace(/^IFC/i, 'Ifc'); } catch (e) { /* inconnu */ } typeCache.set(m.id + ':' + id, t); }
  return typeCache.get(m.id + ':' + id);
}
/* Catégories IFC de la maquette (murs, dalles, poutres…) avec leur nombre d'éléments. */
export function modelCategories() {
  const m = state.model; if (!m || !m.api) return [];
  const seen = new Set(), n = new Map();
  m.group.traverse(o => { const id = o.userData && o.userData.expressID; if (!o.isMesh || id == null || seen.has(id)) return; seen.add(id); const t = typeOf(id) || 'IfcAutre'; n.set(t, (n.get(t) || 0) + 1); });
  return [...n].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}
export function describe(expressID) {
  const m = state.model; if (!m || !m.api) return null;
  try {
    const line = m.api.GetLine(m.id, expressID, false);
    const type = m.api.GetNameFromTypeCode(m.api.GetLineType(m.id, expressID));
    const val = v => v && v.value != null ? v.value : null;
    return { id: expressID, type: String(type || '').replace(/^IFC/i, 'Ifc'), name: val(line.Name), tag: val(line.Tag) || val(line.ObjectType) };
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

let chantierProvider = null, projChantier = null;
export const setChantierProvider = f => { chantierProvider = f; };
export const getProjChantier = () => projChantier;
export function exportCalage() {
  return JSON.stringify({ geotrace: 'calage', version: 1, maquette: state.model ? state.model.name : null,
    fixScale: state.geo.fixScale, angle: state.geo.angle,
    points: state.geo.pairs.map(p => ({ maquette: p.m.map(v => +v.toFixed(3)), lat: +p.ll[0].toFixed(8), lon: +p.ll[1].toFixed(8) })),
    resultat: state.sol && !state.sol.placeholder ? { echelle: +state.sol.s.toFixed(5), rotation_deg: +(state.sol.theta / RAD).toFixed(3), ecart_moyen_m: +state.sol.rms.toFixed(3) } : null,
    vues: collectVues(), chantier: chantierProvider ? chantierProvider() : null }, null, 2);
}
export function importCalage(text) {
  const j = JSON.parse(text);
  if (!j || j.geotrace !== 'calage' || !Array.isArray(j.points)) throw new Error('format');
  projVues = j.vues && typeof j.vues === 'object' ? j.vues : null;
  projChantier = j.chantier && typeof j.chantier === 'object' ? j.chantier : null;
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
  // Les bords d'une caméra orthographique sont relatifs à sa position : on la centre sur la vue et on borne par la demi-largeur / demi-hauteur.
  const mx = (tl[0] + br[0]) / 2, my = (tl[1] + br[1]) / 2;
  camera.left = tl[0] - mx; camera.right = br[0] - mx; camera.top = tl[1] - my; camera.bottom = br[1] - my;
  camera.position.set(mx, my, 2000); camera.lookAt(mx, my, 0);
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

const WMTS_ANY = (layer, style, fmt) => (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${fmt}`;
/* Repères au sol proposés en superposition : plan IGN (routes, bâtiments), parcelles du cadastre, photo aérienne. */
const REF = {
  ortho: { url: WMTS_ORTHO, op: .6, z: .02 },
  plan: { url: WMTS_ANY('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'normal', 'image/png'), op: .38, z: .03 },
  parc: { vec: 'parc', z: .05 },
  route: { vec: 'route', z: .045 }
};
/* Routes de la BD TOPO de l'IGN : axe et largeur de chaussée, en mètres autour de l'origine. */
async function fetchRoads(frame, bounds) {
  const a = frame.toLL(bounds[0], bounds[1]), b = frame.toLL(bounds[2], bounds[3]);
  const u = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=1500&BBOX=' + [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(v => v.toFixed(7)).join(',') + ',urn:ogc:def:crs:EPSG::4326';
  const j = await wfsJson(u), out = [];
  (j.features || []).forEach(f => {
    const g = f.geometry, pr = f.properties || {}, nat = String(pr.nature || ''); if (!g || /sentier|escalier|bac|piste cyclable/i.test(nat)) return;
    let w = +pr.largeur_de_chaussee; if (!(w > 0)) w = /chemin/i.test(nat) ? 3 : 5;
    (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).forEach(l => { if (l.length > 1) out.push({ w, pts: l.map(c => frame.toEN(c[1], c[0])) }); });
  });
  return out;
}
function roadsGroup(roads, zOff) { // les deux bords de chaque chaussée, en traits fins
  const seg = [];
  roads.forEach(r => { for (let i = 1; i < r.pts.length; i++) { const A = r.pts[i - 1], B = r.pts[i], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < .01) continue; const nx = -(B[1] - A[1]) / L * r.w / 2, ny = (B[0] - A[0]) / L * r.w / 2; [1, -1].forEach(k => seg.push(A[0] + k * nx, A[1] + k * ny, zOff, B[0] + k * nx, B[1] + k * ny, zOff)); } });
  const grp = new THREE.Group(); if (!seg.length) return grp;
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const halo = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x06121f, transparent: true, opacity: .6, depthTest: false, toneMapped: false, fog: false })); halo.position.z = -.01; halo.scale.setScalar(1.0005); halo.renderOrder = 4;
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x5fd0ff, depthTest: false, toneMapped: false, fog: false })); lines.renderOrder = 5;
  grp.add(halo, lines); return grp;
}
/* Parcelles du cadastre en traits fins (données vectorielles de l'IGN) : limites nettes à toutes les distances et angles de parcelle sur lesquels le clic s'accroche. */
async function wfsJson(u) { let r = await fetch(u).catch(() => null); for (let k = 0; k < 2 && (!r || !r.ok); k++) { await new Promise(t => setTimeout(t, 900 + 900 * k)); r = await fetch(u).catch(() => null); } if (!r || !r.ok) throw new Error('IGN ' + (r ? r.status : 'réseau')); return r.json(); } // le service de l'IGN répond parfois au deuxième ou troisième essai
async function fetchParcels(frame, bounds) {
  const a = frame.toLL(bounds[0], bounds[1]), b = frame.toLL(bounds[2], bounds[3]);
  const u = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=3000&BBOX=' + [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(v => v.toFixed(7)).join(',') + ',urn:ogc:def:crs:EPSG::4326';
  const j = await wfsJson(u), seg = [], seen = new Set(), corners = [], key = (x, y) => Math.round(x * 20) + ':' + Math.round(y * 20);
  (j.features || []).forEach(f => { const g = f.geometry; if (!g) return; (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).forEach(poly => poly.forEach(ring => {
    const en = ring.map(c => frame.toEN(c[1], c[0]));
    for (let i = 0; i < en.length; i++) {
      const k = key(en[i][0], en[i][1]); if (!seen.has(k)) { seen.add(k); corners.push([en[i][0], en[i][1]]); }
      if (i) { const k2 = key(en[i - 1][0], en[i - 1][1]), e = k < k2 ? k + '|' + k2 : k2 + '|' + k; if (!seen.has(e)) { seen.add(e); seg.push(en[i - 1][0], en[i - 1][1], en[i][0], en[i][1]); } }
    }
  })); });
  return { seg, corners };
}
function parcelsGroup(data, zOff) {
  const seg = [], pts = [], corners = data.corners; for (let i = 0; i < data.seg.length; i += 4) seg.push(data.seg[i], data.seg[i + 1], zOff, data.seg[i + 2], data.seg[i + 3], zOff); corners.forEach(c => pts.push(c[0], c[1], zOff));
  const grp = new THREE.Group(); if (!seg.length) return { grp, corners, n: 0 };
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const halo = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1200, transparent: true, opacity: .55, depthTest: false, toneMapped: false, fog: false })); halo.position.z = -.01; halo.scale.setScalar(1.0005); halo.renderOrder = 4;
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffa000, depthTest: false, toneMapped: false, fog: false })); lines.renderOrder = 5;
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const dots = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd23f, size: 7, sizeAttenuation: false, depthTest: false, toneMapped: false, fog: false })); dots.renderOrder = 6;
  grp.add(halo, lines, dots); return { grp, corners, n: seg.length / 6 };
}
async function buildGround(frame, bounds, { maxTiles = 36, zMin = 15, zOff = 0, url = WMTS_ORTHO, clear = false } = {}) {
  // bounds : [minE, minN, maxE, maxN] en mètres autour de l'origine ; choisit le niveau de zoom qui garde ≤ 36 tuiles
  const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]].map(p => frame.toLL(p[0], p[1]));
  let z = 19, x0, x1, y0, y1;
  for (; z >= zMin; z--) {
    x0 = Math.floor(lon2x(corners[0][1], z)); x1 = Math.floor(lon2x(corners[1][1], z));
    y0 = Math.floor(lat2y(corners[1][0], z)); y1 = Math.floor(lat2y(corners[0][0], z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= maxTiles) break;
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, canvas = document.createElement('canvas'); canvas.width = nx * 256; canvas.height = ny * 256;
  const ctx = canvas.getContext('2d'); if (!clear) { ctx.fillStyle = '#9aa7b5'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  let ok = 0;
  await Promise.all(Array.from({ length: nx * ny }, (_, k) => new Promise(res => {
    const tx = x0 + (k % nx), ty = y0 + Math.floor(k / nx), img = new Image(); img.crossOrigin = 'anonymous';
    const to = setTimeout(res, 12000); img.onload = () => { clearTimeout(to); ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256); ok++; res(); }; img.onerror = () => { clearTimeout(to); res(); };
    img.src = url(z, tx, ty);
  })));
  const ll = (tx, ty) => frame.toEN(y2lat(ty, z), x2lon(tx, z));
  const q = [ll(x0, y1 + 1), ll(x1 + 1, y1 + 1), ll(x1 + 1, y0), ll(x0, y0)]; // SO, SE, NE, NO
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(p => [p[0], p[1], zOff]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { mesh: new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ok ? tex : null, color: ok ? 0xffffff : 0xb7c2cf })), tiles: ok };
}

/* Pastille de repère (disque de la couleur de l'appareil, liseré blanc, pictogramme d'appareil photo). */
const PIN_TEX = {};
function pinTex(col) {
  if (PIN_TEX[col]) return PIN_TEX[col];
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), hex = '#' + col.toString(16).padStart(6, '0');
  x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 8; x.shadowOffsetY = 3; x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 62, 52, 0, 7); x.fill();
  x.shadowColor = 'transparent'; x.fillStyle = hex; x.beginPath(); x.arc(64, 62, 42, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(38, 48, 52, 34, 6); x.fill(); x.beginPath(); x.roundRect(50, 41, 20, 10, 3); x.fill();
  x.fillStyle = hex; x.beginPath(); x.arc(64, 65, 11, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 65, 6, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return PIN_TEX[col] = t;
}
const PIN = 0.052;
const DEVCOL = { phone: 0xf26b1d, tab: 0x0fa37f, drone: 0x7b4fd6 };
/* Champ de vision vertical (degrés) d'une photo : focale équivalente 24×36 (EXIF) rapportée à la diagonale de l'image. Sans focale : 26 mm téléphone, 24 mm drone. */
function vfovOf(p, aspect) {
  const f = p.f35 > 0 ? p.f35 : (p.dev === 'drone' ? 24 : 26);
  const dh = Math.atan(43.267 / (2 * f)), vh = Math.atan(Math.tan(dh) / Math.sqrt(1 + aspect * aspect));
  return 2 * vh / RAD;
}
/* Repère de la caméra : cap h (depuis le nord, sens horaire) et inclinaison pitch (négative = vers le bas), en radians. */
function basisOf(h, pitch) {
  const f = new THREE.Vector3(Math.sin(h) * Math.cos(pitch), Math.cos(h) * Math.cos(pitch), Math.sin(pitch));
  const r = new THREE.Vector3(Math.cos(h), -Math.sin(h), 0), u = new THREE.Vector3().crossVectors(r, f);
  return { r, u, f };
}
const quatOf = ({ r, u, f }) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate()));
const ADJ0 = () => ({ yaw: 0, pitch: 0, roll: 0, e: 0, n: 0, z: 0, zoom: 1 });
const adjKey = p => 'geotrace:vue:' + (p.key || p.name);
const SHARED = 'geotrace:vue:*commun:'; // + type d'appareil : une erreur de drone n'est pas celle d'un téléphone
const sharedKey = p => SHARED + (p.dev || 'phone');
/* Réglage propre à la photo s'il existe, sinon réglage commun (appliqué à toutes les photos), sinon aucun. */
/* Réglages fournis avec le projet (fichier .geotrace.json) : { photos: { clé: réglage }, commun: { drone|phone: réglage } }. */
let projVues = null;
const loadAdj = p => { // chaque photo a son propre calage, indépendant des autres : ni réglage commun, ni réglage hérité d'une photo voisine
  try {
    const own = localStorage.getItem(adjKey(p)), pv = projVues && projVues.photos && projVues.photos[p.key || p.name];
    return Object.assign(ADJ0(), own ? JSON.parse(own) : (pv || {}));
  } catch (e) { return ADJ0(); }
};
/* Tous les réglages de photos enregistrés sur cet ordinateur, pour le fichier de calage de l'équipe. */
function collectVues() {
  const out = { photos: {}, commun: {} };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k || !k.startsWith('geotrace:vue:')) continue;
      const v = JSON.parse(localStorage.getItem(k)), id = k.slice('geotrace:vue:'.length);
      if (id.startsWith('*commun:')) out.commun[id.slice(8)] = v; else out.photos[id] = v;
    }
  } catch (e) { /* stockage indisponible */ }
  return (Object.keys(out.photos).length || Object.keys(out.commun).length) ? out : null;
}
export const photoAdj = p => loadAdj(p);
const saveAdj = (p, a) => { try { localStorage.setItem(adjKey(p), JSON.stringify(a)); } catch (e) { /* stockage indisponible */ } };
export const savePhotoAdj = (p, a) => saveAdj(p, a);
/* Applique le réglage de la photo ouverte à toutes les autres (leurs réglages propres sont effacés). Renvoie le nombre de photos concernées. */
function shareAdj(lk, photos) {
  try {
    const a = lk.adj, c = Object.assign({}, a); delete c.warp; delete c.warpA; localStorage.setItem(sharedKey(lk.p), JSON.stringify(c)); let n = 0;
    photos.forEach(p => { if (p === lk.p || (p.dev || 'phone') !== (lk.p.dev || 'phone')) return; if (localStorage.getItem(adjKey(p)) != null) localStorage.removeItem(adjKey(p)); n++; });
    saveAdj(lk.p, a); return n;
  } catch (e) { return 0; }
}
/* Applique le réglage de la photo ouverte aux photos du même appareil prises dans les 2 minutes autour (même vol : même dérive de compas et de GPS). */
function shareNear(lk, photos) {
  const t0 = lk.p.t; if (t0 == null) return 0;
  let n = 0;
  photos.forEach(p => { if (p === lk.p || p.t == null || (p.dev || 'phone') !== (lk.p.dev || 'phone') || Math.abs(p.t - t0) > 120) return; const c = Object.assign({}, lk.adj); delete c.warp; delete c.warpA; saveAdj(p, c); n++; });
  saveAdj(lk.p, lk.adj); return n;
}
/* Banque de points de repère géoréférencés : contours nets du sol relevés dans chaque photo une fois calée, avec leur position (latitude, longitude).
   Une photo ne s'appuie jamais sur ses propres points : seulement sur ceux relevés ailleurs, comme sur des bornes posées sur le terrain. */
const BANK = new Map(), bankKey = p => 'geotrace:rep:' + (p.key || p.name);
function bankGet(p) { const k = bankKey(p); if (!BANK.has(k)) { let v = null; try { const t = localStorage.getItem(k); v = t ? JSON.parse(t) : null; } catch (e) { v = null; } BANK.set(k, Array.isArray(v) ? v : null); } return BANK.get(k); }
function bankSet(p, arr) { const k = bankKey(p); BANK.set(k, arr && arr.length ? arr : null); try { if (arr && arr.length) localStorage.setItem(k, JSON.stringify(arr)); else localStorage.removeItem(k); } catch (e) { /* stockage plein : la banque reste en mémoire pour la session */ } }
export function bankCount(photos) { let n = 0, f = 0; (photos || []).forEach(p => { const a = bankGet(p); if (a) { n += a.length / 2; f++; } }); return { points: n, photos: f }; }
/* Remet toutes les photos sans réglage. */
function clearAdj(photos) { projVues = null; try { photos.forEach(p => { localStorage.removeItem(sharedKey(p)); localStorage.removeItem(adjKey(p)); bankSet(p, null); }); } catch (e) { /* rien */ } }

function disposeTree(g) { g.traverse(o => { if ((o.isMesh || o.isLine || o.isSprite) && o.userData.dispose) { if (o.geometry) o.geometry.dispose(); [].concat(o.material || []).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }

/* photos : [{ id, name, key, lat, lon, heading, pitch, f35, dev, rel, tex }] ; focus : id d'une photo pour placer la caméra comme à la prise de vue. */
export async function open3D(host, { photos = [], focus = null, photoEl = null, zones = [], zoneColors = null, devs = [], devColors = null, phases = [], phaseId = null, nets = [], netColors = null, engins = [], enginsBase = 'assets/models/', onPhoto, onElement, onNote, onItem, onGround, onMoveItem, virtual = null }) {
  close3D();
  // sans maquette : un site vide (terrain, photos, zones, réseaux, engins) autour d'un point GPS, repère local à l'identité
  let m = state.model, virt = false;
  if (!m && virtual) { virt = true; const h = virtual.half || 150; m = { group: new THREE.Group(), box: new THREE.Box3(new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, h, 8)) }; state.frame = makeFrame(virtual.lat, virtual.lon); state.sol = { s: 1, theta: 0, t: [0, 0], rms: 0, residuals: [] }; }
  if (!m || !state.sol || !state.frame) return null;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement); renderer.domElement.className = 'v3-canvas';
  const scene = new THREE.Scene();
  // La maquette reste exactement où elle est (ses propres coordonnées, ni tournée ni déplacée) : c'est le terrain, les photos, les réseaux et la caméra qui sont placés autour d'elle.
  const holder = new THREE.Group(); holder.add(m.group.clone()); scene.add(holder);
  const sl = state.sol, Tm = new THREE.Matrix4().compose(new THREE.Vector3(sl.t[0], sl.t[1], 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sl.theta), new THREE.Vector3(sl.s, sl.s, sl.s));
  const Tinv = Tm.clone().invert(), qInv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sl.theta);
  const world = new THREE.Group(); world.matrixAutoUpdate = false; world.matrix.copy(Tinv); world.matrixWorldNeedsUpdate = true; scene.add(world); world.updateMatrixWorld(true);
  // ciel, soleil, ombres portées et matériaux physiques
  const look = setupLook(renderer, scene, world);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 60000); camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495; controls.maxDistance = 9000; controls.zoomToCursor = false; controls.minDistance = 0.02; controls.screenSpacePanning = true; controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }; controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  // emprise terrain de la maquette et des photos proches
  const bb = new THREE.Box3().setFromObject(holder); if (bb.isEmpty()) bb.copy(m.box); const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  const radius = Math.max(60, Math.max(sz.x, sz.y) * 0.9), cE = c.clone().applyMatrix4(Tm);   // cE : le même centre, mais en coordonnées terrain (pour les photos et le sol)
  const bounds = [cE.x - radius * 1.2, cE.y - radius * 1.2, cE.x + radius * 1.2, cE.y + radius * 1.2];
  v3 = { host, renderer, scene, camera, controls, holder, raf: 0, dead: false, photoMeshes: [], ground: null, onPhoto, onElement, center: c, radius, lock: null, virtual: virt, look, wake: performance.now() + 2500, wakeC: performance.now() + 2500, drawn: 0 };
  ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'touchmove'].forEach(t => renderer.domElement.addEventListener(t, () => { if (v3) v3.wake = performance.now() + 300; }, { passive: true }));
  const headingOf = p => p.heading != null ? p.heading : Math.atan2(cE.x - p._e, cE.y - p._n) / RAD;
  // photos : repère de l'appareil, plan de l'image à sa place dans le champ, et pyramide de vue
  const markers = new THREE.Group(); world.add(markers);
  /* Installations, déviations, réseaux et engins : construits ici, puis tenus à jour en direct pendant que la carte et le panneau Chantier modifient les données (v3Site, v3Engins). */
  const toEN = (la, lo) => state.frame.toEN(la, lo);
  v3.world = world; v3.markers = markers; v3.cfg = { zoneColors, devColors, netColors, enginsBase }; v3.Tm = Tm; v3.labelGroups = []; v3.netsOn = true; v3.hasNets = false;
  v3.phases = phases; v3.phaseId = phaseId;
  v3.reindex = () => {
    v3.chantierItems = new Map(); v3.world.children.forEach(g => { if (g.name === 'chantier' || g.name === 'deviations' || g.name === 'reseaux' || g.name === 'engins') g.children.forEach(r => { if (r.userData.itemId) v3.chantierItems.set(r.userData.itemId, [r]); }); });
    v3.labelGroups.forEach(g => g.children.forEach(sp => { const l = v3.chantierItems.get(sp.userData.itemId); if (l) l.push(sp); }));
    applyPhase(); if (v3.syncVis) v3.syncVis();
  };
  v3.setSite = ({ zones: zs = [], devs: ds = [], nets: ns = [] }) => {
    [...v3.world.children].forEach(g => { if (g.name === 'chantier' || g.name === 'deviations' || g.name === 'reseaux') { v3.world.remove(g); disposeTree(g); } });
    v3.labelGroups.forEach(g => { v3.markers.remove(g); disposeTree(g); }); v3.labelGroups = []; v3.netsGroup = null;
    const lab = g => { v3.markers.add(g); v3.labelGroups.push(g); };
    if (zs.length) { try { const z = buildZones(zs, toEN, v3.cfg.zoneColors); v3.world.add(z.group); lab(z.labels); } catch (e) { console.warn('installations', e); } }
    if (ds.length) { try { const z = buildDevs(ds, toEN, v3.cfg.devColors); v3.world.add(z.group); lab(z.labels); } catch (e) { console.warn('déviations', e); } }
    v3.hasNets = ns.length > 0;
    if (ns.length) { try { const z = buildNets(ns, toEN, v3.cfg.netColors); z.group.name = 'reseaux'; v3.world.add(z.group); v3.netsGroup = z.group; } catch (e) { console.warn('réseaux', e); } }
    v3.reindex();
  };
  v3.setEngins = list => {
    let g = v3.world.children.find(x => x.name === 'engins');
    if (!g) { g = buildEngins([], toEN, v3.cfg.enginsBase); v3.world.add(g); }
    g.userData.update(list); if (v3.selId) g.userData.select(v3.selId); v3.reindex();
  };
  v3.setSite({ zones, devs, nets }); if (engins.length) v3.setEngins(engins);
  const far = Math.max(radius * 10, 2500);
  const dist = Math.max(3, radius / 12), K = .35;
  const build = (p, aspect) => {
    if (p._bb) { markers.remove(p._bb.mesh, p._bb.lines); v3.photoMeshes = v3.photoMeshes.filter(x => x !== p._bb.mesh); p._bb.mesh.geometry.dispose(); p._bb.mesh.material.dispose(); p._bb.lines.geometry.dispose(); p._bb.lines.material.dispose(); }
    const vf = vfovOf(p, aspect) * RAD, hh = dist * Math.tan(vf / 2) * K, ww = hh * aspect;
    const bs = basisOf(headingOf(p) * RAD, (p.pitch || 0) * RAD), o = new THREE.Vector3(p._e, p._n, p._z), ctr = o.clone().addScaledVector(bs.f, dist);
    const mat = new THREE.MeshBasicMaterial({ map: p._tex || null, color: p._tex ? 0xffffff : (DEVCOL[p.dev] || 0xf26b1d), side: THREE.DoubleSide, transparent: true, opacity: p._tex ? .95 : .55 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ww * 2, hh * 2), mat); mesh.position.copy(ctr); mesh.quaternion.copy(quatOf(bs)); mesh.userData.photoId = p.id;
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ctr.clone().addScaledVector(bs.r, a * ww).addScaledVector(bs.u, b * hh));
    const g = new THREE.BufferGeometry().setFromPoints(cs.flatMap(q => [o, q]));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: DEVCOL[p.dev] || 0xf26b1d, transparent: true, opacity: .8 })); lines.userData.dispose = true;
    markers.add(mesh, lines); v3.photoMeshes.push(mesh); p._bb = { mesh, lines };
  };
  photos.filter(p => p.lat != null).forEach(p => {
    const [e, n] = state.frame.toEN(p.lat, p.lon);
    if (Math.abs(e - cE.x) > far || Math.abs(n - cE.y) > far) return;
    p._e = e; p._n = n; p._z = p.dev === 'drone' ? (p.rel != null ? p.rel : 30) : 1.6;
    const col = DEVCOL[p.dev] || 0xf26b1d;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex(col), sizeAttenuation: false, depthTest: false, transparent: true }));
    s.scale.setScalar(PIN); s.center.set(.5, 0); s.position.set(e, n, p._z + 0.4); s.renderOrder = 20; s.userData.photoId = p.id; s.userData.base = PIN; markers.add(s); v3.photoMeshes.push(s); p._sph = s;
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e, n, 0), new THREE.Vector3(e, n, p._z)]), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .75 })); stem.userData.dispose = true; markers.add(stem);
    build(p, 4 / 3);
    if (p.tex) new THREE.TextureLoader().load(p.tex, t => {
      if (!v3 || v3.dead) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; p._tex = t; build(p, p._asp || (t.image.width / t.image.height) || 4 / 3);
    }, undefined, () => { /* vignette illisible : plan coloré */ });
  });
  v3.photos = photos;
  const fitSize = () => {
    if (v3) v3.wake = performance.now() + 250;
    const W = host.clientWidth || 800, H = host.clientHeight || 500; let w = W, h = H;
    if (v3.lock) { const a = v3.lock.aspect, k = v3.k == null ? 1 : v3.k; let wt = W, ht = H; if (W / H > a) wt = H * a; else ht = W / a; w = W + (wt - W) * k; h = H + (ht - H) * k; }
    camera.aspect = w / h;
    if (v3.applyWarp) v3.applyWarp();
    renderer.setSize(w, h); const st = renderer.domElement.style; st.position = 'absolute'; st.left = (W - w) / 2 + 'px'; st.top = (H - h) / 2 + 'px';
    camera.updateProjectionMatrix();
  };
  v3.ro = new ResizeObserver(fitSize); v3.ro.observe(host); fitSize();
  /* Caméra verrouillée sur une photo : même position, même cap, même inclinaison et même champ de vision, dans un cadre de la forme de la photo. */
  const poseCam = (lk, a) => {
    const p = lk.p, cam = new THREE.PerspectiveCamera(); cam.position.set(p._e + a.e, p._n + a.n, p._z + a.z);
    const bs = basisOf((headingOf(p) + a.yaw) * RAD, Math.max(-89, Math.min(89, (p.pitch || 0) + a.pitch)) * RAD), cr = Math.cos(a.roll * RAD), sr = Math.sin(a.roll * RAD);
    const r = bs.r.clone().multiplyScalar(cr).addScaledVector(bs.u, sr), u = bs.u.clone().multiplyScalar(cr).addScaledVector(bs.r, -sr);
    cam.quaternion.copy(quatOf({ r, u, f: bs.f }));
    cam.position.applyMatrix4(Tinv); cam.quaternion.premultiply(qInv);   // la caméra est exprimée dans le repère de la maquette
    cam.fov = 2 * Math.atan(Math.tan(vfovOf(p, lk.aspect) * RAD / 2) / a.zoom) / RAD; cam.aspect = lk.aspect; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    return cam;
  };
  const applyLock = () => {
    const lk = v3.lock; if (!lk) return; const cam = poseCam(lk, lk.adj);
    camera.position.copy(cam.position); camera.quaternion.copy(cam.quaternion); camera.fov = cam.fov;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); computeWarp(lk); applyWarp(); drawMarks();
  };
  // en superposition on ne garde que la maquette : ni repères, ni plans des autres photos, ni photo aérienne
  const syncVis = () => {
    const on = v3.groundOn !== false, gs = [v3.ground, v3.ground2];
    if (!v3.lock) { look.setLocked(false); markers.visible = true; const ug = v3.hasNets && v3.netsOn; if (v3.netsGroup) v3.netsGroup.visible = v3.netsOn; gs.forEach(g => { if (g) { g.visible = on; const want = ug ? .32 : 1; if (ug) { g.material.transparent = true; g.material.depthWrite = false; } else { g.material.transparent = false; g.material.depthWrite = true; } g.material.opacity = want; g.material.needsUpdate = true; } }); return; }
    // superposition : le fond aérien et les repères s'effacent en fondu pendant que la photo apparaît dessous
    const k = v3.k == null ? 1 : v3.k, a = 1 - k; if (v3.netsGroup) v3.netsGroup.visible = false; look.setLocked(true); renderer.setClearColor(0xbcd3e6, a); markers.visible = k < .4;
    gs.forEach(g => { if (!g) return; const vis = a > .01 && on; g.visible = vis; if (vis && !g.material.transparent) { g.material.transparent = true; g.material.needsUpdate = true; } g.material.opacity = a; });
  };
  const setXf = k => { v3.k = k; syncVis(); fitSize(); if (v3.lock) applyLock(); };
  v3.syncVis = syncVis; v3.poseCam = poseCam; v3.applyLock = applyLock;
  /* Superposition : la caméra reste à la position de la photo ; c'est la photo qui est redressée pour que ses points tombent sur ceux de la maquette.
     1 point : glissement ; 2 points : rotation et échelle ; 3 points : étirement ; 4 points et plus : perspective complète (moindres carrés).
     Les matrices 3 × 3 sont rangées ligne par ligne, en coordonnées normalisées de l'image ([-1, 1], y vers le haut). */
  const mul3 = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]); return o; };
  const inv3 = m => { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null; return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det); };
  const map3 = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w, w]; };
  const gauss = (A, b) => { // système linéaire, pivot partiel ; null s'il est dégénéré
    const n = b.length; A = A.map(r => r.slice()); b = b.slice();
    for (let i = 0; i < n; i++) {
      let m = i; for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[m][i])) m = j;
      [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]]; if (Math.abs(A[i][i]) < 1e-10) return null;
      for (let j = i + 1; j < n; j++) { const f = A[j][i] / A[i][i]; for (let l = i; l < n; l++) A[j][l] -= f * A[i][l]; b[j] -= f * b[i]; }
    }
    const x = Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let t = b[i]; for (let j = i + 1; j < n; j++) t -= A[i][j] * x[j]; x[i] = t / A[i][i]; }
    return x;
  };
  const lsq = (rows, rhs) => { const n = rows[0].length, A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => rows.reduce((t, r) => t + r[i] * r[j], 0))), b = Array.from({ length: n }, (_, i) => rows.reduce((t, r, k) => t + r[i] * rhs[k], 0)); return gauss(A, b); };
  const warpOf = (S, D, a) => { // S : points de la photo, D : où ils doivent tomber (x déjà corrigé du rapport largeur/hauteur a)
    const n = S.length; if (!n) return null;
    const trans = () => { let x = 0, y = 0; S.forEach((q, k) => { x += D[k][0] - q[0]; y += D[k][1] - q[1]; }); return [1, 0, x / n, 0, 1, y / n, 0, 0, 1]; };
    const simil = () => { const rows = [], rhs = []; S.forEach((q, k) => { rows.push([q[0], -q[1], 1, 0]); rhs.push(D[k][0]); rows.push([q[1], q[0], 0, 1]); rhs.push(D[k][1]); }); const h = lsq(rows, rhs); return h && [h[0], -h[1], h[2], h[1], h[0], h[3], 0, 0, 1]; };
    const affine = () => { const R = S.map(q => [q[0], q[1], 1]), u = lsq(R, D.map(q => q[0])), v = lsq(R, D.map(q => q[1])); return u && v ? [u[0], u[1], u[2], v[0], v[1], v[2], 0, 0, 1] : null; };
    const persp = () => { const rows = [], rhs = []; S.forEach((q, k) => { const [x, y] = q, [u, v] = D[k]; rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.push(u); rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.push(v); }); const h = lsq(rows, rhs); return h && [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]; };
    // garde-fou : la photo ne doit ni se retourner, ni se replier, ni changer de taille de façon absurde (points trop proches ou mal placés) ; sinon on retombe sur une correction plus simple
    const sane = M => { if (!M || M.some(v => !Number.isFinite(v))) return false; const c = [[-a, -1], [a, -1], [a, 1], [-a, 1]].map(q => map3(M, q[0], q[1])); if (c.some(q => !(q[2] > 0.25))) return false; let ar = 0; for (let k = 0; k < 4; k++) ar += c[k][0] * c[(k + 1) % 4][1] - c[(k + 1) % 4][0] * c[k][1]; const r = ar / (8 * a), o = map3(M, 0, 0), x = map3(M, .5, 0); return r > 0.35 && r < 3 && Math.abs(Math.atan2(x[1] - o[1], x[0] - o[0])) < 0.6; };
    const tries = n >= 4 ? [persp, affine, simil, trans] : n === 3 ? [affine, simil, trans] : n === 2 ? [simil, trans] : [trans];
    for (let k = 0; k < tries.length; k++) { const M = tries[k](); if (sane(M)) return { M, level: tries.length - 1 - k, full: k === 0 }; }
    return null;
  };
  const ndcOf = (cam, P) => new THREE.Vector3(P.x, P.y, P.z).project(cam);
  const computeWarp = lk => {
    lk.H = lk.Hi = null; lk.warpFull = true; const a = lk.aspect, sd = list => { const S = [], D = []; list.forEach(q => { const n = ndcOf(camera, q.P); if (n.z > 1 || n.z < -1) return; S.push([q.t[0] * a, q.t[1]]); D.push([n.x * a, n.y]); }); return [S, D]; };
    // base : le calage automatique sur les routes, s'il existe ; les points cliqués corrigent par-dessus (4 points ou plus décident seuls)
    let B = [1, 0, 0, 0, 1, 0, 0, 0, 1]; if (lk.auto && lk.auto.length) { const [S, D] = sd(lk.auto), w = warpOf(S, D, a); if (w) B = w.M; }
    let M = B; if (lk.pairs.length) { const [S, D] = sd(lk.pairs), w = warpOf(S.map(q => map3(B, q[0], q[1]).slice(0, 2)), D, a); lk.warpFull = !w || w.full; if (w) M = mul3(w.M, B); }
    if (M === B && !(lk.auto && lk.auto.length)) return;
    const H = mul3([1 / a, 0, 0, 0, 1, 0, 0, 0, 1], mul3(M, [a, 0, 0, 0, 1, 0, 0, 0, 1])), Hi = inv3(H); if (!Hi) return;
    lk.H = H; lk.Hi = Hi;
  };
  const applyWarp = () => {
    const el = photoEl, lk = v3 && v3.lock; if (!el) return;
    if (!lk || !lk.H) { el.style.transform = ''; return; }
    const W = el.clientWidth, Hh = el.clientHeight; if (!W || !Hh) return;
    let w = W, h = Hh; if (W / Hh > lk.aspect) w = Hh * lk.aspect; else h = W / lk.aspect; const ox = (W - w) / 2, oy = (Hh - h) / 2;
    const N = [2 / w, 0, -1 - 2 * ox / w, 0, -2 / h, 1 + 2 * oy / h, 0, 0, 1], Ni = [w / 2, 0, ox + w / 2, 0, -h / 2, oy + h / 2, 0, 0, 1];
    const M = mul3(Ni, mul3(lk.H, N)).map((v, _, m) => v / m[8]);
    el.style.transformOrigin = '0 0'; el.style.transform = `matrix3d(${M[0]},${M[3]},0,${M[6]},${M[1]},${M[4]},0,${M[7]},0,0,1,0,${M[2]},${M[5]},0,1)`;
  };
  v3.applyWarp = applyWarp;
  /* Repères au sol : affichés seulement en superposition, autour de ce que la photo regarde. Ils servent de points de référence quand la maquette ne suffit pas (ou qu'il n'y en a pas). */
  v3.refOn = {}; v3.refs = {}; v3.refTok = {};
  const refBounds = lk => {
    const cam = poseCam(lk, lk.adj), o = cam.position.clone().applyMatrix4(v3.Tm), d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).transformDirection(v3.Tm), hl = Math.hypot(d.x, d.y);
    const dist = d.z < -0.05 ? Math.min(260, -o.z / d.z * hl) : 150, hx = hl > 1e-3 ? d.x / hl : 0, hy = hl > 1e-3 ? d.y / hl : 0, cx = o.x + hx * dist * .6, cy = o.y + hy * dist * .6, half = Math.max(90, Math.min(300, dist * .8 + 70));
    return [cx - half, cy - half, cx + half, cy + half];
  };
  const roadsFor = lk => { const b = refBounds(lk), key = b.map(v => Math.round(v / 25)).join(','); if (!v3.roadCache || v3.roadCache.key !== key) { const pr = fetchRoads(state.frame, b); v3.roadCache = { key, p: pr }; pr.catch(() => { if (v3 && v3.roadCache && v3.roadCache.p === pr) v3.roadCache = null; }); } return v3.roadCache.p; };
  const parcFor = lk => { const b = refBounds(lk), key = b.map(v => Math.round(v / 25)).join(','); if (!v3.parcCache || v3.parcCache.key !== key) { const pr = fetchParcels(state.frame, b); v3.parcCache = { key, p: pr }; pr.catch(() => { if (v3 && v3.parcCache && v3.parcCache.p === pr) v3.parcCache = null; }); } return v3.parcCache.p; };
  const binObj = o => o.traverse(q => { if (q.geometry) q.geometry.dispose(); if (q.material) { if (q.material.map) q.material.map.dispose(); q.material.dispose(); } });
  const dropRef = kind => { const c = v3.refs[kind]; if (!c) return; world.remove(c.mesh); binObj(c.mesh); delete v3.refs[kind]; };
  v3.dropRefs = () => Object.keys(v3.refs).forEach(dropRef);
  const syncRef = () => {
    const lk = v3.lock;
    Object.keys(REF).forEach(kind => {
      const cur = v3.refs[kind], want = !!(lk && v3.refOn[kind]);
      if (!want) { if (cur) cur.mesh.visible = false; v3.refTok[kind] = (v3.refTok[kind] || 0) + 1; return; }
      const b = refBounds(lk), key = b.map(v => Math.round(v / 25)).join(',');
      if (cur && cur.key === key) { cur.mesh.visible = true; return; }
      dropRef(kind); const tok = v3.refTok[kind] = (v3.refTok[kind] || 0) + 1, R = REF[kind];
      const live = () => v3 && !v3.dead && v3.refTok[kind] === tok, fail = () => { if (live() && onNote) onNote('Ce repère au sol n’a pas pu être chargé (connexion ou zone non couverte).'); };
      const put = (m, extra) => { world.add(m); v3.refs[kind] = Object.assign({ mesh: m, key }, extra); m.visible = !!(v3.lock && v3.refOn[kind]); v3.wakeC = performance.now() + 700; };
      if (R.vec === 'route') roadsFor(lk).then(rs => { if (!live()) return; if (!rs.length) { fail(); return; } put(roadsGroup(rs, R.z)); }).catch(fail);
      else if (R.vec) parcFor(lk).then(d => { if (!live()) return; if (!d.seg.length) { fail(); return; } const g = parcelsGroup(d, R.z); put(g.grp, { corners: d.corners.map(c => new THREE.Vector3(c[0], c[1], 0).applyMatrix4(Tinv)) }); }).catch(fail);
      else buildGround(state.frame, b, { maxTiles: 64, zMin: 15, zOff: R.z, url: R.url }).then(g => {
        const m = g.mesh; if (!live() || !g.tiles) { binObj(m); if (!g.tiles) fail(); return; }
        m.material.transparent = true; m.material.opacity = R.op; m.material.depthWrite = false; m.material.toneMapped = false; m.renderOrder = 3; m.userData.dispose = true; put(m);
      }).catch(fail);
    });
    v3.wakeC = performance.now() + 700;
  };
  /* angle de parcelle le plus proche du clic, à l'écran */
  const snapRef = (px, py) => {
    const c = v3.refs.parc; if (!c || !c.mesh.visible || !c.corners) return null;
    const r = boxOf(), q = new THREE.Vector3(); let best = null, bd = 16 * 16;
    c.corners.forEach(P => { q.copy(P).project(camera); if (q.z > 1 || q.z < -1) return; const dx = (q.x + 1) / 2 * r.width - px, dy = (1 - q.y) / 2 * r.height - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = P; } });
    return best && best.clone();
  };
  v3.syncRef = syncRef;
  /* Cartes tirées de la photo, calculées une fois : R « ressemble à de la chaussée », E « contour visible » (0 = moyenne de l'image), V « végétation » */
  const mapsOf = lk => {
    if (lk.maps) return lk.maps; if (!photoEl || !photoEl.naturalWidth) return null;
    const a = lk.aspect, PW = 256, PH = Math.max(48, Math.round(PW / a)), NP = PW * PH, pc = document.createElement('canvas'); pc.width = PW; pc.height = PH; let pd;
    try { const px = pc.getContext('2d', { willReadFrequently: true }); px.drawImage(photoEl, 0, 0, PW, PH); pd = px.getImageData(0, 0, PW, PH).data; } catch (e) { return null; }
    const R0 = new Float32Array(NP), Lm = new Float32Array(NP), R = new Float32Array(NP), G0 = new Float32Array(NP), E = new Float32Array(NP), V0 = new Float32Array(NP), V = new Float32Array(NP);
    for (let i = 0; i < NP; i++) { const r = pd[i * 4] / 255, g = pd[i * 4 + 1] / 255, b = pd[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = (mx - mn) / (mx + .001), veg = g > r * 1.04 && g > b * 1.04; V0[i] = veg ? 1 : 0; Lm[i] = .3 * r + .59 * g + .11 * b + .6 * (g - (r + b) / 2); R0[i] = veg || (b > r * 1.18) || sat > .2 || mx < .2 || mx > .9 ? 0 : 1 - sat / .2; }
    const blur = (src, dst, k) => { for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { let t = 0, c = 0; for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) { const u = x + dx, v = y + dy; if (u >= 0 && u < PW && v >= 0 && v < PH) { t += src[v * PW + u]; c++; } } dst[y * PW + x] = t / c; } };
    blur(R0, R, 1); blur(V0, V, 2);
    for (let y = 1; y < PH - 1; y++) for (let x = 1; x < PW - 1; x++) { const i = y * PW + x; G0[i] = Math.hypot(Lm[i + 1] - Lm[i - 1], Lm[i + PW] - Lm[i - PW]); }
    blur(G0, E, 2); let mE = 0; for (let i = 0; i < NP; i++) mE += E[i]; mE = mE / NP || 1e-6; for (let i = 0; i < NP; i++) E[i] = Math.min(3, E[i] / mE) - 1;
    return (lk.maps = { PW, PH, R, E, V });
  };
  /* Verse dans la banque les repères de la photo ouverte, une fois qu'elle est calée : contours nets du sol (hors végétation), replacés à leur position réelle. */
  const harvest = lk => {
    const mp = mapsOf(lk); if (!mp) return 0; const { PW, PH, E, V } = mp, cand = [];
    for (let y = 4; y < PH - 4; y++) for (let x = 4; x < PW - 4; x++) { const i = y * PW + x, e = E[i]; if (e < .9 || V[i] > .7) continue; let top = true; for (let dy = -2; dy <= 2 && top; dy++) for (let dx = -2; dx <= 2; dx++) if (E[i + dy * PW + dx] > e) { top = false; break; } if (top) cand.push([e, x, y]); }
    cand.sort((p1, p2) => p2[0] - p1[0]); const out = [];
    for (const c of cand) { if (out.length >= 520) break;
      let nx = (c[1] + .5) / PW * 2 - 1, ny = 1 - (c[2] + .5) / PH * 2; if (lk.H) { const q = map3(lk.H, nx, ny); if (!(q[2] > 0)) continue; nx = q[0]; ny = q[1]; } if (Math.abs(nx) > 1.3 || Math.abs(ny) > 1.3) continue;
      ptr.set(nx, ny); ray.setFromCamera(ptr, camera); const o = ray.ray.origin.clone().applyMatrix4(v3.Tm), d = ray.ray.direction.clone().transformDirection(v3.Tm); if (d.z > -1e-4) continue; const t = -o.z / d.z; if (t <= 0 || t > 260) continue;
      const ll = state.frame.toLL(o.x + d.x * t, o.y + d.y * t); out.push(Math.round(ll[0] * 1e7), Math.round(ll[1] * 1e7)); }
    bankSet(lk.p, out.length >= 40 ? out : null); return out.length / 2;
  };
  /* Calage automatique sur les routes, les parcelles et la banque de repères, sans rien afficher.
     Principe : on cherche où était réellement l'appareil. Pour chaque hypothèse (cap, inclinaison, roulis, position, hauteur, zoom, dans les marges d'erreur d'un GPS et d'une boussole),
     les routes et les limites de parcelles de l'IGN sont projetées sur la photo et comparées à ce qu'elle montre : la chaussée doit tomber sur du gris et ses abords sur autre chose,
     les bords de route et les limites de parcelles sur des contours visibles. Recherche large (des dizaines de milliers d'hypothèses), puis affinage des meilleures.
     Le résultat n'est gardé que s'il est net et sans rival ; il devient un redressement de la photo, que des points cliqués peuvent corriger. */
  v3.autoRoads = async ({ quiet = false } = {}) => {
    const lk = v3.lock, say = t => { if (!quiet && onNote) onNote(t); }; if (!lk || !photoEl || !photoEl.naturalWidth) return { ok: false, why: 'photo' };
    if (lk.busy) return { ok: false, why: 'busy' }; lk.busy = true;
    try {
      say('Recherche des routes et des parcelles dans la photo…');
      const [rr, pp] = await Promise.allSettled([roadsFor(lk), parcFor(lk)]); if (!v3 || v3.dead || v3.lock !== lk) return { ok: false, why: 'changed' };
      const roads = rr.status === 'fulfilled' ? rr.value : [], parc = pp.status === 'fulfilled' ? pp.value : { seg: [] };
      if (rr.status !== 'fulfilled' && pp.status !== 'fulfilled') { say('Les routes et les parcelles de l’IGN n’ont pas pu être chargées (service indisponible). Réessayez dans un instant.'); return { ok: false, why: 'net' }; }
      // 1. cartes tirées de la photo : « ressemble à de la chaussée » et « contour visible »
      const mp = mapsOf(lk); if (!mp) { say('Cette photo ne peut pas être analysée (image distante protégée).'); return { ok: false, why: 'pixels' }; }
      const { PW, PH, R, E } = mp;
      // 2. points d'épreuve au sol, dans le repère du chantier : chaussée, abords, traits (bords de route et limites de parcelles)
      const cam0 = poseCam(lk, lk.adj), o0 = cam0.position.clone().applyMatrix4(v3.Tm), near = (x, y) => Math.hypot(x - o0.x, y - o0.y) < 330, pr = [], pb = [], pl = [];
      roads.forEach(r => { if (r.w < 2.2) return; for (let i = 1; i < r.pts.length; i++) { const A = r.pts[i - 1], B = r.pts[i], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < .01) continue; const m = Math.max(1, Math.round(L / 2)), ux = -(B[1] - A[1]) / L, uy = (B[0] - A[0]) / L;
        for (let k = 0; k <= m; k++) { const x = A[0] + (B[0] - A[0]) * k / m, y = A[1] + (B[1] - A[1]) * k / m; if (!near(x, y)) continue; [-r.w / 3, 0, r.w / 3].forEach(d => pr.push(x + ux * d, y + uy * d)); [r.w / 2 + 2.5, r.w / 2 + 6].forEach(d => { pb.push(x + ux * d, y + uy * d); pb.push(x - ux * d, y - uy * d); }); pl.push(x + ux * r.w / 2, y + uy * r.w / 2, x - ux * r.w / 2, y - uy * r.w / 2); } } });
      const nEdge = pl.length;
      for (let i = 0; i < parc.seg.length; i += 4) { const x0 = parc.seg[i], y0 = parc.seg[i + 1], x1 = parc.seg[i + 2], y1 = parc.seg[i + 3], L = Math.hypot(x1 - x0, y1 - y0), m = Math.max(1, Math.round(L / 2.5)); for (let k = 0; k <= m; k++) { const x = x0 + (x1 - x0) * k / m, y = y0 + (y1 - y0) * k / m; if (near(x, y)) pl.push(x, y); } }
      // repères de la banque relevés dans les autres photos calées (jamais ceux de cette photo)
      const pk = []; photos.forEach(q => { if (q === lk.p || q._e == null || Math.hypot(q._e - lk.p._e, q._n - lk.p._n) > 500) return; const b = bankGet(q); if (!b) return; for (let i = 0; i < b.length; i += 2) { const en = state.frame.toEN(b[i] / 1e7, b[i + 1] / 1e7); if (near(en[0], en[1])) pk.push(en[0], en[1]); } });
      const thin = (arr, max) => { const n = arr.length / 2; if (n <= max) return Float32Array.from(arr); const st = Math.ceil(n / max), o = []; for (let i = 0; i < n; i += st) o.push(arr[i * 2], arr[i * 2 + 1]); return Float32Array.from(o); };
      const Pr = thin(pr, 2400), Pb = thin(pb, 2400), Pl = thin(pl, 3200), Pk = thin(pk, 3000), wK = .16 * Math.min(1, Pk.length / 400);
      // 3. note d'une hypothèse de prise de vue
      const mPV = new THREE.Matrix4(), acc = [0, 0];
      const sum = (pts, map, e, st) => { let sw = 0, sv = 0; for (let i = 0; i < pts.length; i += 2 * st) { const x = pts[i], y = pts[i + 1], w = e[3] * x + e[7] * y + e[15]; if (w < 1) continue; const nx = (e[0] * x + e[4] * y + e[12]) / w, ny = (e[1] * x + e[5] * y + e[13]) / w; if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue; const wt = w < 60 ? 1 : 3600 / (w * w), u = Math.min(PW - 1, (nx + 1) / 2 * PW | 0), v = Math.min(PH - 1, (1 - ny) / 2 * PH | 0); sw += wt; sv += wt * map[v * PW + u]; } acc[0] = sw; acc[1] = sv; };
      const D = { yaw: 6, pitch: 3, roll: 1.5, e: 5, n: 5, z: lk.p.dev === 'drone' ? 6 : .5, zoom: .04 }, KS = ['yaw', 'pitch', 'roll', 'e', 'n', 'z', 'zoom'], SG = KS.map(k => D[k]);
      const adjOf = x => { const o = Object.assign({}, lk.adj); o.yaw += x[0]; o.pitch += x[1]; o.roll += x[2]; o.e += x[3]; o.n += x[4]; o.z += x[5]; o.zoom = Math.max(.3, Math.min(4, lk.adj.zoom * Math.exp(x[6]))); return o; };
      const matOf = x => { const c = poseCam(lk, adjOf(x)); mPV.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).multiply(Tinv); return mPV.elements; };
      let ref = null;
      const raw = (x, st) => { const e = matOf(x); let C = 0, hasR = false, swr = 0; if (Pr.length) { sum(Pr, R, e, st); swr = acc[0]; const ar = acc[0] > 0 ? acc[1] / acc[0] : 0; sum(Pb, R, e, st); const ab = acc[0] > 0 ? acc[1] / acc[0] : 0; hasR = swr > 3; C = hasR ? ar - ab : 0; } sum(Pl, E, e, st); const swl = acc[0], al = swl > 3 ? acc[1] / swl : 0; let ak = 0, swk = 0; if (Pk.length) { sum(Pk, E, e, st); swk = acc[0]; ak = swk > 3 ? acc[1] / swk : 0; } return { C, al, ak, swr, swl, swk, hasR }; };
      const total = (x, st) => { const q = raw(x, st); if (ref && (q.swr < ref.swr * .5 / st || q.swl < ref.swl * .45 / st)) return -9; let pen = 0; for (let k = 0; k < 7; k++) pen += (x[k] / SG[k]) ** 2; return q.C + .14 * q.al + wK * q.ak - .012 * pen; };
      const zero = [0, 0, 0, 0, 0, 0, 0], q0 = raw(zero, 1); ref = { swr: q0.swr, swl: q0.swl };
      if (q0.swr < 12 && q0.swl < 40 && q0.swk < 40) { say('Ni route ni limite de parcelle de l’IGN dans le champ de cette photo : calez-la avec des points.'); return { ok: false, why: 'noroad' }; }
      // 4. recherche large au hasard dans les marges d'erreur, puis affinage des meilleures hypothèses
      let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gau = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73;
      const top = [{ x: zero, s: total(zero, 3) }], NT = 14, N1 = 36000; let t0 = performance.now();
      for (let i = 0; i < N1; i++) {
        const wide = i % 3 === 0 ? 2.2 : 1.2, x = SG.map(sg => gau() * sg * wide), sc = total(x, 3);
        if (top.length < NT || sc > top[top.length - 1].s) { top.push({ x, s: sc }); top.sort((p1, p2) => p2.s - p1.s); if (top.length > NT) top.pop(); }
        if ((i & 255) === 0 && performance.now() - t0 > 12) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); if (!v3 || v3.dead || v3.lock !== lk) return { ok: false, why: 'changed' }; }
      }
      const polish = async (x, st) => { let bs = total(x, st), steps = SG.map(v => v * .5); for (let it = 0; it < 7; it++) { for (let k = 0; k < 7; k++) for (const d of [-1, 1]) { const y = x.slice(); y[k] += d * steps[k]; const v = total(y, st); if (v > bs) { bs = v; x = y; } } steps = steps.map(v => v * .55); } return { x, s: bs }; };
      const fin = []; for (const c of top) { fin.push(await polish(c.x, 2)); await new Promise(r => setTimeout(r, 0)); if (!v3 || v3.dead || v3.lock !== lk) return { ok: false, why: 'changed' }; }
      fin.sort((p1, p2) => p2.s - p1.s); const best = await polish(fin[0].x, 1), qb = raw(best.x, 1), s0 = total(zero, 1);
      // 5. contrôles : résultat net, meilleur que le point de départ, et sans rival ailleurs
      const gain = best.s - s0, far = (x, y) => Math.sqrt(x.reduce((t, v, k) => t + ((v - y[k]) / SG[k]) ** 2, 0)), eB = Float64Array.from(matOf(best.x)), tp = Pr.length > 40 ? Pr : Pl, st2 = Math.max(1, Math.floor(tp.length / 2 / 150)),
        gap = x => { const e = matOf(x); let t = 0, c = 0; for (let i = 0; i < tp.length; i += 2 * st2) { const px = tp[i], py = tp[i + 1], w0 = eB[3] * px + eB[7] * py + eB[15], w1 = e[3] * px + e[7] * py + e[15]; if (w0 < 1 || w1 < 1) continue; const x0 = (eB[0] * px + eB[4] * py + eB[12]) / w0, y0 = (eB[1] * px + eB[5] * py + eB[13]) / w0; if (Math.abs(x0) > 1 || Math.abs(y0) > 1) continue; t += Math.hypot(x0 - (e[0] * px + e[4] * py + e[12]) / w1, y0 - (e[1] * px + e[5] * py + e[13]) / w1); c++; } return c ? t / c : 9; },
        rival = fin.slice(1).find(c => c.s > best.s - Math.max(.012, gain * .05) && gap(c.x) > .18); // un rival ne compte que s’il place réellement les routes ailleurs dans l’image (plus de 9 % de sa largeur) ; en dessous, la solution la plus plausible l’emporte
      const strong = (qb.hasR && qb.C >= .16) || (!qb.hasR && Math.max(qb.al, Pk.length >= 400 ? qb.ak : 0) >= .45), moved = far(best.x, zero) > .12;
      const info = { score: +best.s.toFixed(3), route: +qb.C.toFixed(3), traits: +qb.al.toFixed(3), gain: +gain.toFixed(3), x: best.x.map(v => +v.toFixed(3)), banque: Pk.length / 2, reperes: +qb.ak.toFixed(3) };
      if (!strong || (moved && gain < .025)) { say('Les routes et les limites ne sont pas assez nettes dans cette photo pour un calage automatique fiable : calez-la avec des points.'); return Object.assign({ ok: false, why: 'faible' }, info); }
      if (!moved) { info.verses = harvest(lk); say('La photo tombe déjà sur les routes et les parcelles : rien à corriger.'); return Object.assign({ ok: true, moved: false }, info); }
      if (rival) info.rival = rival.x.map(v => +v.toFixed(2));
      if (rival && quiet) return Object.assign({ ok: false, why: 'ambigu' }, info); // à l'ouverture, dans le doute, on ne touche pas à la photo ; sur demande, on applique en prévenant
      // 6. quatre points d'appui au sol, bien écartés : où ils sont dans la photo (appareil retrouvé) et où la vue 3D les montre
      const camB = poseCam(lk, adjOf(best.x)), cand = [];
      for (let j = 0; j <= 16; j++) for (let i = 0; i <= 16; i++) { const nx = -.85 + 1.7 * i / 16, ny = -.85 + 1.7 * j / 16; ptr.set(nx, ny); ray.setFromCamera(ptr, camera); const o = ray.ray.origin.clone().applyMatrix4(v3.Tm), d = ray.ray.direction.clone().transformDirection(v3.Tm); if (d.z > -1e-4) continue; const t = -o.z / d.z; if (t <= 0 || t * Math.hypot(d.x, d.y) > 600) continue; const P = new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, 0).applyMatrix4(Tinv), n = P.clone().project(camB); if (n.z > 1 || n.z < -1 || Math.abs(n.x) > 3 || Math.abs(n.y) > 3) continue; cand.push({ nx, ny, P, t: [n.x, n.y] }); }
      const ext = f => cand.reduce((b, c) => (!b || f(c) > f(b) ? c : b), null), four = [...new Set([ext(c => c.nx + c.ny), ext(c => -c.nx - c.ny), ext(c => c.nx - c.ny), ext(c => c.ny - c.nx)])];
      if (four.length < 4 || four.some(c => !c)) { say('Le sol n’est pas assez visible dans cette photo pour un calage automatique.'); return { ok: false, why: 'sol' }; }
      lk.auto = four.map(c => ({ P: c.P, t: c.t })); keepWarp(lk); applyLock(); persist(); info.verses = harvest(lk);
      say(`Photo calée automatiquement sur ${qb.hasR ? 'les routes' : 'les limites'}${qb.hasR && parc.seg.length ? ' et les parcelles' : ''} (correspondance ${rival ? 'incertaine : un autre calage convenait presque aussi bien, vérifiez bien' : qb.C >= .3 ? 'nette' : 'moyenne'}${Pk.length ? `, ${Pk.length / 2} repères de la banque utilisés` : ''}). Vérifiez, puis affinez avec des points si besoin. Double-clic pour annuler.`);
      return Object.assign({ ok: true, moved: true }, info);
    } finally { lk.busy = false; }
  };
  const anyRef = () => Object.keys(REF).some(k => v3.refOn[k]);
  const groundP = (px, py) => { // point du sol sous le clic, dans le repère de la scène
    const r = boxOf(), g = groundEN(r.left + px, r.top + py); if (!g) return null;
    const o = camera.position.clone().applyMatrix4(v3.Tm); if (Math.hypot(g[0] - o.x, g[1] - o.y) > 1500) return null;
    return new THREE.Vector3(g[0], g[1], 0).applyMatrix4(Tinv);
  };
  const packW = list => list.map(q => [q.P.x, q.P.y, q.P.z, q.t[0], q.t[1]].map(v => +v.toFixed(4)));
  const keepWarp = lk => { if (lk.pairs.length) lk.adj.warp = packW(lk.pairs); else delete lk.adj.warp; if (lk.auto && lk.auto.length) lk.adj.warpA = packW(lk.auto); else delete lk.adj.warpA; };
  const boxOf = () => renderer.domElement.getBoundingClientRect();
  const worldVerts = () => {
    if (v3.verts) return v3.verts; holder.updateMatrixWorld(true); const out = [], v = new THREE.Vector3();
    holder.traverse(o => { if (!o.isMesh || !o.geometry.attributes.position) return; const ps = o.geometry.attributes.position, st = Math.max(1, Math.floor(ps.count / 120)); for (let i = 0; i < ps.count; i += st) { v.fromBufferAttribute(ps, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); } });
    return (v3.verts = new Float32Array(out));
  };
  const snap = (px, py) => { // point de la maquette le plus proche du clic, à l'écran
    const vs = worldVerts(), r = boxOf(), q = new THREE.Vector3(); let best = null, bd = 28 * 28;
    for (let i = 0; i < vs.length; i += 3) {
      q.set(vs[i], vs[i + 1], vs[i + 2]).project(camera); if (q.z > 1 || q.z < -1) continue;
      const dx = (q.x + 1) / 2 * r.width - px, dy = (1 - q.y) / 2 * r.height - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = new THREE.Vector3(vs[i], vs[i + 1], vs[i + 2]); }
    }
    return best;
  };
  const marks = document.createElement('div'); marks.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden'; host.parentElement.appendChild(marks); v3.marks = marks;
  const dot = (x, y, col, ring) => { const d = document.createElement('span'); d.style.cssText = `position:absolute;left:${x - 9}px;top:${y - 9}px;width:18px;height:18px;border-radius:50%;box-sizing:border-box;border:2px solid ${col};${ring ? '' : 'background:' + col + '55;'}`; marks.appendChild(d); };
  const drawMarks = () => {
    marks.textContent = ''; const lk = v3.lock; if (!lk) return;
    const r = boxOf(), hr = host.getBoundingClientRect(), ox = r.left - hr.left, oy = r.top - hr.top, q = new THREE.Vector3();
    const at = (P) => { q.copy(P).project(camera); return [ox + (q.x + 1) / 2 * r.width, oy + (1 - q.y) / 2 * r.height]; };
    lk.pairs.forEach(pq => { const [x, y] = at(pq.P); dot(x, y, '#ffd23f', true); const w = lk.H ? map3(lk.H, pq.t[0], pq.t[1]) : pq.t; dot(ox + (w[0] + 1) / 2 * r.width, oy + (1 - w[1]) / 2 * r.height, '#ff5a36', false); });
    if (lk.pending) { const [x, y] = at(lk.pending); dot(x, y, '#ffd23f', true); }
  };
  v3.pick = (px, py) => { // clic sans déplacement en superposition
    const lk = v3.lock; if (!lk) return;
    if (!lk.pending) {
      // avec des repères au sol affichés, le clic vise le sol (angle de parcelle, bord de route) ; sinon un élément de la maquette, et à défaut le sol
      const corner = snapRef(px, py), P = corner || (anyRef() ? (groundP(px, py) || snap(px, py)) : (snap(px, py) || groundP(px, py)));
      if (!P) { onNote && onNote('Rien à cet endroit : visez le sol, sous l’horizon, ou un élément de la maquette.'); return; }
      lk.pending = P; drawMarks(); onNote && onNote((corner ? 'Angle de parcelle accroché' : 'Repère choisi') + ' (rond jaune). Cliquez maintenant le même point sur la photo : elle sera redressée pour qu’il tombe dessus. Échap pour annuler.');
    } else {
      const r = boxOf(); let t = [px / r.width * 2 - 1, -(py / r.height * 2 - 1)];
      if (lk.Hi) { const q = map3(lk.Hi, t[0], t[1]); if (q[2] > 0) t = [q[0], q[1]]; } // le clic vise la photo telle qu'elle est affichée, déjà redressée
      lk.pairs.push({ P: lk.pending, t }); lk.pending = null; keepWarp(lk);
      applyLock(); persist(); const n = lk.pairs.length; if (n >= 4 && lk.warpFull) { try { harvest(lk); } catch (e) { /* banque inchangée */ } }
      onNote && onNote(!lk.warpFull ? `${n} points, mais ils sont trop proches ou mal placés pour redresser davantage sans abîmer la photo : correction limitée. Choisissez des points éloignés les uns des autres.` : n === 1 ? '1 point : la photo a glissé pour le faire coïncider. Ajoutez d’autres points, éloignés les uns des autres : à partir de 4, la perspective est corrigée.' : n < 4 ? `${n} points : la photo est tournée et mise à l’échelle. Encore ${4 - n} pour corriger la perspective.` : `${n} points : photo redressée en perspective. Double-clic pour retirer les points.`);
    }
  };
  v3.cancel = () => { const lk = v3.lock; if (!lk || !lk.pending) return false; lk.pending = null; drawMarks(); onNote && onNote(''); return true; };
  /* Entrer dans une photo : la caméra vole jusqu'au point de prise de vue, puis se verrouille dessus. D'une photo à l'autre, le passage est direct. */
  v3.fromPhoto = (id, aspect) => new Promise(resolve => {
    const p = photos.find(x => x.id === id); if (!p || p._e == null) return resolve(false);
    p._asp = aspect || p._asp || 4 / 3; if (p._bb) build(p, p._asp);
    if (v3.fly) v3.fly.cancel();
    const lk = { p, aspect: p._asp, adj: loadAdj(p), pairs: [], pending: null };
    const unpack = l => (Array.isArray(l) ? l : []).filter(w => Array.isArray(w) && w.length === 5 && w.every(Number.isFinite)).map(w => ({ P: new THREE.Vector3(w[0], w[1], w[2]), t: [w[3], w[4]] }));
    lk.pairs = unpack(lk.adj.warp); lk.auto = unpack(lk.adj.warpA);
    const done = () => { const was = !!v3.lock; v3.fly = null; v3.lock = lk; controls.enabled = false; if (was || matchMedia('(prefers-reduced-motion: reduce)').matches) { v3.xf = null; setXf(1); } else { v3.xf = { t0: performance.now(), dur: 750 }; setXf(0); } syncRef(); onNote && onNote(''); resolve(true); };
    if (v3.lock) return done();
    const tgt = poseCam(lk, lk.adj); controls.enabled = false;
    v3.fly = { t0: performance.now(), dur: 750, from: { pos: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov }, tgt, done, cancel: () => { v3.fly = null; if (!v3.lock) controls.enabled = true; resolve(false); } };
  });
  v3.release = () => {
    if (!v3.lock) return; v3.lock = null; v3.xf = null; v3.k = 1; applyWarp(); syncRef();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.up.set(0, 0, 1); camera.fov = 60; controls.target.copy(camera.position).addScaledVector(dir, 12); controls.enabled = true; syncVis(); marks.textContent = ''; onNote && onNote(''); fitSize(); controls.update();
  };
  v3.near = () => photos.filter(p => p._e != null).sort((a, b) => Math.hypot(a._e - cE.x, a._n - cE.y) - Math.hypot(b._e - cE.x, b._n - cE.y)).map(p => p.id);
  v3.step = d => { // photo suivante ou précédente, de la plus proche de la maquette à la plus lointaine
    const ids = v3.near(); if (!ids.length) return null;
    const i = v3.lock ? ids.indexOf(v3.lock.p.id) : -1; return ids[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + ids.length) % ids.length];
  };
  v3.overview = () => { if (v3.fly) v3.fly.cancel(); v3.release(); const d = radius * 1.6; camera.position.set(c.x - d * .5, c.y - d * .9, Math.max(sz.z, 5) + d * .7); controls.target.set(c.x, c.y, 0); controls.update(); };
  v3.zoom = f => { // boutons + et − : zoom du calage en superposition, sinon rapprochement de la cible
    if (v3.lock) { const a = v3.lock.adj; a.zoom = Math.max(.3, Math.min(4, a.zoom * f)); applyLock(); persist(); return; }
    const d = camera.position.clone().sub(controls.target).multiplyScalar(1 / f); camera.position.copy(controls.target).add(d); controls.update();
  };
  v3.top = () => { if (v3.lock) return; const t = controls.target, d = Math.max(30, camera.position.distanceTo(t)); camera.position.set(t.x, t.y - 0.01, t.z + d); controls.update(); };
  v3.overview();
  if (!focus && !matchMedia('(prefers-reduced-motion: reduce)').matches) { const to = camera.position.clone(); camera.position.set(c.x - radius * 1.2, c.y - radius * 2.2, Math.max(sz.z, 5) + radius * 4); controls.update(); const t0 = performance.now(), tick = () => { if (!v3 || v3.dead || v3.lock || v3.fly) return; const k = Math.min(1, (performance.now() - t0) / 1100), e = 1 - Math.pow(1 - k, 3); camera.position.lerpVectors(v3.introFrom, to, e); if (k < 1) requestAnimationFrame(tick); }; v3.introFrom = camera.position.clone(); requestAnimationFrame(tick); }
  if (focus) v3.fromPhoto(focus);
  // sélection par clic ; en superposition, glisser oriente la caméra (Maj : déplace l'appareil), la molette zoome (Maj : hauteur), double-clic réinitialise
  const el = renderer.domElement, ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null, drag = null, tSave = 0;
  const persist = () => { clearTimeout(tSave); tSave = setTimeout(() => { if (v3 && v3.lock) saveAdj(v3.lock.p, v3.lock.adj); }, 250); };
  let hov = null, hovRaf = 0;
  const setHover = id => {
    if (id === hov) return;
    const old = photos.find(x => x.id === hov); if (old && old._sph) { old._sph.scale.setScalar(old._sph.userData.base); if (old._bb) old._bb.mesh.material.opacity = old._tex ? .95 : .55; }
    hov = id; const nw = photos.find(x => x.id === id);
    if (nw && nw._sph) { nw._sph.scale.setScalar(nw._sph.userData.base * 1.45); if (nw._bb) nw._bb.mesh.material.opacity = 1; }
    el.style.cursor = id ? 'pointer' : '';
    if (onNote) onNote(nw ? nw.name + ' : cliquez pour entrer dans la photo' : '');
  };
  el.addEventListener('pointermove', e => {
    if (v3.lock || v3.fly || e.buttons) { if (hov) setHover(null); return; }
    const cx = e.clientX, cy = e.clientY; if (hovRaf) return;
    hovRaf = requestAnimationFrame(() => {
      hovRaf = 0; if (!v3 || v3.dead || v3.lock) return;
      const r = el.getBoundingClientRect(); ptr.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
      const h = ray.intersectObjects(v3.photoMeshes, false)[0]; setHover(h ? h.object.userData.photoId : null);
    });
  });
  el.addEventListener('pointerleave', () => { if (hov) setHover(null); });
  /* éléments du chantier : retrouver l'identifiant d'un engin, d'une zone ou d'une déviation touché par le rayon */
  const idOf = o => { while (o && !(o.userData && o.userData.itemId)) o = o.parent; return o ? o.userData.itemId : null; };
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const pickItem = () => ray.intersectObjects(v3.world.children.filter(g => g.visible && (g.name === 'chantier' || g.name === 'deviations' || g.name === 'engins' || g.name === 'reseaux')), true).find(h => shown(h.object) && idOf(h.object));
  /* point du sol sous le pointeur : plan de la terrain (Z = 0 dans le repère des installations) → [lat, lon] */
  const groundEN = (cx, cy) => {
    const r = el.getBoundingClientRect(); ptr.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const o = ray.ray.origin.clone().applyMatrix4(v3.Tm), d = ray.ray.direction.clone().transformDirection(v3.Tm);
    if (Math.abs(d.z) < 1e-6) return null; const t = -o.z / d.z; if (t < 0) return null;
    return [o.x + d.x * t, o.y + d.y * t];
  };
  v3.groundAt = (cx, cy) => { const g = groundEN(cx, cy); return g ? state.frame.toLL(g[0], g[1]) : null; };
  // pointeur promené sur le sol pendant un dessin : aperçu du tracé sur la carte
  let gmRaf = 0;
  el.addEventListener('pointermove', e => {
    if (!onGround || v3.lock || v3.fly || e.buttons || gmRaf) return;
    const cx = e.clientX, cy = e.clientY;
    gmRaf = requestAnimationFrame(() => { gmRaf = 0; if (!v3 || v3.dead || v3.lock) return; const gp = v3.groundAt(cx, cy); const on = !!(gp && onGround(gp, 'move')); el.style.cursor = on ? 'crosshair' : (hov ? 'pointer' : ''); });
  });
  el.addEventListener('dblclick', e => { if (v3.lock || !onGround) return; const gp = v3.groundAt(e.clientX, e.clientY); if (gp) onGround(gp, 'dblclick', e); });
  /* glisser l'engin sélectionné pour le déplacer (le premier clic le sélectionne, le glisser suivant le déplace) */
  el.addEventListener('pointerdown', e => {
    if (v3.lock || e.button !== 0 || e.shiftKey || !v3.selId || !onMoveItem) return;
    if (onGround) { const gp = v3.groundAt(e.clientX, e.clientY); if (gp && onGround(gp, 'probe')) return; } // un outil de dessin a la priorité
    const g = v3.world.children.find(x => x.name === 'engins'); if (!g) return;
    const r = el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const h = ray.intersectObject(g, true).find(x => shown(x.object) && idOf(x.object)); if (!h || idOf(h.object) !== v3.selId) return;
    const root = g.children.find(c => c.userData.itemId === v3.selId), g0 = groundEN(e.clientX, e.clientY); if (!root || !g0) return;
    e.stopImmediatePropagation(); controls.enabled = false;
    const dx = root.position.x - g0[0], dy = root.position.y - g0[1], x0 = e.clientX, y0 = e.clientY; let moved = false;
    const mv = ev => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; moved = true; const q = groundEN(ev.clientX, ev.clientY); if (q) root.position.set(q[0] + dx, q[1] + dy, 0); el.style.cursor = 'grabbing'; };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      controls.enabled = !v3 || !v3.lock; el.style.cursor = '';
      if (moved && v3 && !v3.dead) { const ll = state.frame.toLL(root.position.x, root.position.y); onMoveItem(v3.selId, ll[0], ll[1]); }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }, true);
  el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (v3.lock) { drag = [e.clientX, e.clientY]; try { el.setPointerCapture(e.pointerId); } catch (er) { /* sans capture */ } } });
  el.addEventListener('pointermove', e => {
    if (!drag || !v3.lock) return; const lk = v3.lock, a = lk.adj, dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
    if (e.shiftKey) {
      const h = (headingOf(lk.p) + a.yaw) * RAD, side = -dx * .02, fwd = -dy * .02;
      a.e += side * Math.cos(h) + fwd * Math.sin(h); a.n += -side * Math.sin(h) + fwd * Math.cos(h);
    } else { const k = camera.fov / (parseFloat(el.style.height) || el.clientHeight || 1); a.yaw -= dx * k; a.pitch += dy * k; }
    applyLock(); persist();
  });
  el.addEventListener('wheel', e => {
    if (!v3.lock) return; e.preventDefault(); const a = v3.lock.adj, d = e.deltaY || e.deltaX;
    if (e.shiftKey) a.z -= Math.sign(d) * .1; else a.zoom = Math.max(.3, Math.min(4, a.zoom * Math.exp(-d * .0012)));
    applyLock(); persist();
  }, { passive: false });
  // zoom à la molette : avance vers le point visé par pas proportionnel à la distance (jamais bloqué près d'un élément).
  // Les crans reçus entre deux images sont cumulés puis appliqués une seule fois (pas de saccades ni de traversée d'objets en zoom rapide).
  const zRay = new THREE.Raycaster(), zP = new THREE.Vector2(), zV = new THREE.Vector3(); let zAcc = 0, zRaf = 0, zXY = [0, 0];
  const zoomStep = () => {
    zRaf = 0; if (!v3 || v3.dead || v3.lock) { zAcc = 0; return; }
    const n = Math.max(-4, Math.min(4, zAcc)); zAcc = 0; if (!n) return;
    const r = el.getBoundingClientRect(); zP.set((zXY[0] - r.left) / r.width * 2 - 1, -(zXY[1] - r.top) / r.height * 2 + 1); zRay.setFromCamera(zP, camera);
    const h = zRay.intersectObject(world, true).find(x => x.object.visible !== false && !x.object.isSprite && !x.object.isLine && !x.object.isPoints);
    const dir = zRay.ray.direction, td = camera.position.distanceTo(controls.target), hd = h ? h.distance : td;
    if (n < 0) {
      let step = Math.max(.15, hd * (1 - Math.pow(.86, -n)));
      if (h) step = Math.min(step, Math.max(.05, hd * .85));
      camera.position.addScaledVector(dir, step);
      if (camera.position.z < .3 && dir.z < 0) camera.position.addScaledVector(dir, (.3 - camera.position.z) / dir.z);
      controls.target.copy(h ? h.point : zV.copy(camera.position).addScaledVector(dir, Math.max(.5, hd - step)));
    } else {
      const step = Math.max(.3, hd * (Math.pow(1 / .86, n) - 1)), np = zV.copy(camera.position).addScaledVector(dir, -step);
      if (np.distanceTo(controls.target) > controls.maxDistance) return;
      camera.position.copy(np); controls.target.addScaledVector(dir, -step);
    }
    controls.update();
  };
  el.addEventListener('wheel', e => {
    if (v3.lock || v3.fly) return; e.preventDefault(); e.stopImmediatePropagation();
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1; zAcc += (e.deltaY || 0) * k / 100; zXY = [e.clientX, e.clientY];
    if (!zRaf) zRaf = requestAnimationFrame(zoomStep);
  }, { passive: false, capture: true });
  el.addEventListener('dblclick', () => { const lk = v3.lock; if (!lk) return; if (lk.pairs.length) { lk.pairs = []; delete lk.adj.warp; onNote && onNote(lk.auto.length ? 'Points retirés. Il reste le calage automatique sur les routes : double-clic pour le retirer aussi.' : 'Points retirés : la photo reprend sa forme d’origine.'); } else if (lk.auto.length) { lk.auto = []; delete lk.adj.warpA; onNote && onNote('Calage automatique retiré : la photo reprend sa forme d’origine.'); } else { lk.adj = ADJ0(); onNote && onNote(''); } lk.pending = null; applyLock(); persist(); });
  el.addEventListener('pointerup', e => {
    if (v3.lock) {
      const was = down; drag = null; down = null;
      if (was && !e.shiftKey && Math.hypot(e.clientX - was[0], e.clientY - was[1]) <= 5) { const r = boxOf(); v3.pick(e.clientX - r.left, e.clientY - r.top); }
      return;
    }
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; down = null;
    const r = el.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
    const hitP = ray.intersectObjects(v3.photoMeshes, false)[0];
    if (hitP && onPhoto) { onPhoto(hitP.object.userData.photoId); return; }
    // un outil de dessin est actif sur la carte : le clic sur le sol est un point du dessin
    if (onGround) { const gp = v3.groundAt(e.clientX, e.clientY); if (gp && onGround(gp, 'click', e)) return; }
    const hit = ray.intersectObject(holder, true)[0], hi = pickItem();
    if (hi && (!hit || hi.distance <= hit.distance + .01)) { if (onItem) onItem(idOf(hi.object)); return; }
    if (hit && onElement) { const info = describe(hit.object.userData.expressID); onElement(info, hit.point); } else if (onElement) onElement(null);
  });
  const loop = () => {
    if (!v3 || v3.dead) return; v3.raf = requestAnimationFrame(loop);
    const f = v3.fly; let busy = !!f;
    if (f) {
      const k = Math.min(1, (performance.now() - f.t0) / f.dur), e = k < .5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
      camera.position.lerpVectors(f.from.pos, f.tgt.position, e); camera.quaternion.slerpQuaternions(f.from.q, f.tgt.quaternion, e);
      camera.fov = f.from.fov + (f.tgt.fov - f.from.fov) * e; camera.updateProjectionMatrix(); if (k >= 1) f.done();
    } else if (!v3.lock) busy = controls.update();
    if (v3.xf) { busy = true; const q = Math.min(1, (performance.now() - v3.xf.t0) / v3.xf.dur); setXf(q * q * (3 - 2 * q)); if (q >= 1) v3.xf = null; }
    // rendu à la demande : on ne redessine que si la vue bouge ou si le contenu vient de changer (sinon un simple battement, pour les images qui finissent de charger)
    const now = performance.now(), beat = now - v3.drawn > 420;
    if (!(busy || beat || now < v3.wake || now < v3.wakeC)) return;
    const content = beat || now < v3.wakeC;
    if (content) look.upgrade(scene);
    if (look.frame(camera, controls.target) || content) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera); v3.drawn = now;
    if (busy && look.budget(performance.now() - now)) renderer.shadowMap.needsUpdate = true;
  };
  loop();
  // fond photo aérienne, chargé en arrière-plan
  buildGround(state.frame, bounds, { maxTiles: 100 }).then(g => { if (!v3 || v3.dead) return; v3.ground = g.mesh; v3.groundTiles = g.tiles; world.add(g.mesh); v3.syncVis(); }).catch(() => { /* fond uni */ });
  buildGround(state.frame, [cE.x - far, cE.y - far, cE.x + far, cE.y + far], { maxTiles: 64, zMin: 13, zOff: -0.3 }).then(g => { if (!v3 || v3.dead) return; g.mesh.renderOrder = -1; v3.ground2 = g.mesh; world.add(g.mesh); v3.syncVis(); }).catch(e => { console.log('fond large', e && e.message); });
  return v3;
}
/* Mise à jour en direct : zones, déviations et réseaux sont reconstruits ; les engins sont seulement déplacés, tournés et remis en pose. */
const poke = () => { if (v3) v3.wakeC = performance.now() + 700; };
export function v3Site(data) { if (v3 && !v3.dead) { v3.setSite(data); poke(); } }
export function v3Engins(list) { if (v3 && !v3.dead) { v3.setEngins(list); poke(); } }
export function v3Select(id) { if (!v3 || v3.dead) return; poke(); v3.selId = id || null; const g = v3.world.children.find(x => x.name === 'engins'); if (g) g.userData.select(v3.selId); }
export function v3AutoRoads(o) { return v3 && !v3.dead && v3.lock ? v3.autoRoads(o) : Promise.resolve({ ok: false }); }
export function v3HasWarp() { const lk = v3 && v3.lock; return !!(lk && (lk.pairs.length || (lk.auto && lk.auto.length))); }
export function v3Ref(on) { if (!v3 || v3.dead) return; v3.refOn = on || {}; v3.syncRef(); }
export function v3Nets(on) { if (!v3) return; poke(); v3.netsOn = on; v3.syncVis(); }
export function v3Ground(on) { if (!v3) return; poke(); v3.groundOn = on; v3.syncVis(); }
export function v3Cancel() { return v3 ? v3.cancel() : false; }
export function v3Overview() { if (v3) v3.overview(); }
export function v3FromPhoto(id, aspect) { return v3 ? v3.fromPhoto(id, aspect) : Promise.resolve(false); }
export function v3Near() { return v3 ? v3.near() : []; }
export function v3Zoom(f) { if (v3) v3.zoom(f); }
export function v3Top() { if (v3) v3.top(); }
export function v3ShareNear() { return v3 && v3.lock ? shareNear(v3.lock, v3.photos) : 0; }
export function v3Share() { return v3 && v3.lock ? shareAdj(v3.lock, v3.photos) : 0; }
export function v3ClearAll() { if (!v3) return; clearAdj(v3.photos); if (v3.lock) { v3.lock.adj = ADJ0(); v3.lock.pairs = []; v3.lock.auto = []; v3.lock.pending = null; v3.applyLock(); } }
export function v3Release() { if (v3) v3.release(); }
export function v3Step(d) { return v3 ? v3.step(d) : null; }
export function v3Has() { return !!v3; }
export function v3Camera() { return v3 ? { world: v3.world, controls: v3.controls, camera: v3.camera, lock: v3.lock, holder: v3.holder, poseCam: v3.poseCam, applyLock: v3.applyLock, center: v3.center, ground: v3.ground, ground2: v3.ground2, meshes: v3.photoMeshes, renderer: v3.renderer, look: v3.look } : null; }
export function close3D() {
  if (!v3) return;
  if (v3.virtual) { state.sol = null; state.frame = null; }
  v3.dead = true; cancelAnimationFrame(v3.raf); v3.ro.disconnect(); v3.controls.dispose();
  v3.scene.traverse(o => { if ((o.isMesh || o.isLine || o.isSprite) && (o.userData.photoId || o.userData.dispose || o === v3.ground || o === v3.ground2)) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  if (v3.dropRefs) v3.dropRefs(); v3.look.dispose(); v3.renderer.dispose(); v3.renderer.domElement.remove(); if (v3.marks) v3.marks.remove(); v3 = null;
}


/* ================= Phases : 4D (éléments de la maquette, installations, déviations) ================= */
const sortPhases = list => list.map((p, i) => [p, i]).sort((a, b) => (a[0].start || '9999').localeCompare(b[0].start || '9999') || a[1] - b[1]).map(x => x[0]);
export function phaseIndexOf(p, list) { return sortPhases(list).findIndex(q => q.id === p.id); }
function applyPhase() {
  const v = v3; if (!v) return;
  const P = sortPhases(v.phases || []), cur = v.phaseId ? P.findIndex(p => p.id === v.phaseId) : -1;
  // installations et déviations : présentes dans les phases où elles sont cochées (toujours là si non cochées)
  (v.chantierItems || new Map()).forEach((objs, id) => {
    const key = id[0] === 'z' ? 'zones' : id[0] === 'n' ? 'nets' : id[0] === 'e' ? 'engs' : 'devs', owners = P.map((p, i) => (p[key] || []).includes(id) ? i : -1).filter(i => i >= 0);
    const vis = cur < 0 || !owners.length || owners.includes(cur);
    objs.forEach(o => { o.visible = vis; });
  });
  // maquette : un élément apparaît à la première phase où il est choisi (par élément ou par catégorie), puis reste
  const first = (fn) => { for (let i = 0; i < P.length; i++) if (fn(P[i])) return i; return -1; };
  const cache = new Map();
  v.holder.traverse(o => {
    const id = o.userData && o.userData.expressID; if (!o.isMesh || id == null) return;
    if (!cache.has(id)) { const t = typeOf(id); let i = first(p => (p.els || []).includes(id)); if (i < 0) i = first(p => (p.cats || []).includes(t)); cache.set(id, i); }
    const idx = cache.get(id);
    if (!o.userData.ownMat) { o.material = o.material.clone(); o.userData.ownMat = true; o.userData.baseEm = o.material.emissive ? o.material.emissive.clone() : null; }
    o.visible = cur < 0 || idx < 0 || idx <= cur;
    const em = o.material.emissive;
    if (em) { if (cur >= 0 && idx === cur) { em.set(P[cur].color || '#ff8a00'); em.multiplyScalar(.55); } else em.copy(o.userData.baseEm); }
  });
}
export function setPhase(id) { if (!v3) return; poke(); v3.phaseId = id || null; applyPhase(); }
export function setPhasesData(list) { if (!v3) return; poke(); v3.phases = list; applyPhase(); }
