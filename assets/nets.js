/* GeoTrace – réseaux existants : tracé à la main d'après un plan DT-DICT, import GeoJSON / KML (WGS 84 ou Lambert-93),
   récupération des données ouvertes de la vue (IGN BD TOPO, OpenStreetMap). Affichés en 2D et en 3D (enterrés).
   Enregistrés avec le calage (chantier.nets). */
import { openDT, clearOverlay } from './dtpdf.js';
const L = window.L;
const $ = id => document.getElementById(id);
const BASE = 'geotrace:nets';
let KEY = BASE;

/* Couleurs usuelles des réseaux (code couleur des plans de réseaux). */
export const TYPES = {
  aep:     { label: 'Eau potable',      color: '#1f6fb5', depth: 1.1, diam: 110 },
  eu:      { label: 'Eaux usées',       color: '#8a5f36', depth: 2.2, diam: 200 },
  ep:      { label: 'Eaux pluviales',   color: '#b98b5a', depth: 1.8, diam: 300 },
  gaz:     { label: 'Gaz',              color: '#e0b400', depth: 1.0, diam: 110 },
  elec:    { label: 'Électricité',      color: '#d6402b', depth: .9,  diam: 80 },
  telecom: { label: 'Télécom, fibre',   color: '#2f8f63', depth: .7,  diam: 50 },
  chaleur: { label: 'Chaleur, froid',   color: '#d4571f', depth: 1.0, diam: 200 },
  autre:   { label: 'Autre réseau',     color: '#6b7480', depth: 1.2, diam: 100 },
};
export const COLORS = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.color]));

let vis = () => true;
let map = null, status = () => {}, stopOthers = () => {}, onChange = () => {};
let nets = [], proj = null, layer = null, show = true, draw = null, edit = null, sel = null, handles = null;
const uid = () => 'n' + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readLocal = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.nets) ? j.nets : null; } catch (e) { return null; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, nets: nets })); } catch (e) { /* stockage indisponible */ } onChange(); };
const clean = d => d && TYPES[d.type] && Array.isArray(d.pts) && (d.pts.length >= 2 || (d.kind && d.pts.length >= 1)) && d.pts.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
export const getNets = () => nets.filter(clean);
export const exportData = () => nets.length ? getNets() : null;
/* Les données locales sont gardées par projet (nom de la maquette) : un autre projet n'hérite pas des phases du précédent. */
export function setScope(name, hasProject) {
  const next = BASE + (name ? ':' + name : '');
  if (next !== BASE) { try { if (localStorage.getItem(next) == null && !hasProject && localStorage.getItem(BASE) != null) { localStorage.setItem(next, localStorage.getItem(BASE)); localStorage.removeItem(BASE); } } catch (e) { /* ignoré */ } }
  KEY = next;
}
export function setProject(p) {
  proj = Array.isArray(p) ? p : null;
  nets = readLocal() || (proj ? proj.filter(clean) : []);
  render(); list();
}
function length(pts) {
  const k = Math.PI / 180, R = 6378137; let s = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], c = Math.cos((a[0] + b[0]) / 2 * k); s += Math.hypot((b[0] - a[0]) * k * R, (b[1] - a[1]) * k * R * c); }
  return s;
}
const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m';

/* ---------- Lambert-93 → WGS 84 ---------- */
const fromL93 = (() => {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2), r = Math.PI / 180;
  const m = p => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const t = p => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
  const p0 = 46.5 * r, p1 = 44 * r, p2 = 49 * r, l0 = 3 * r;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * Math.pow(t(p1), n)), r0 = a * F * Math.pow(t(p0), n);
  return (x, y) => {
    const dx = x - 700000, dy = r0 - (y - 6600000), R = Math.sign(n) * Math.hypot(dx, dy), th = Math.atan2(dx, dy), tt = Math.pow(R / (a * F), 1 / n);
    let ph = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 8; i++) ph = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - e * Math.sin(ph)) / (1 + e * Math.sin(ph)), e / 2));
    return [ph / r, (th / n + l0) / r];
  };
})();
const toLL = (x, y) => (Math.abs(x) > 1000 || Math.abs(y) > 1000) ? fromL93(x, y) : [y, x]; // GeoJSON : [x=lon, y=lat]

/* ---------- reconnaissance du type ---------- */
export function guessType(txt) {
  const t = String(txt || '').toLowerCase();
  if (/pluvia|storm|\bep\b|drain/.test(t)) return 'ep';
  if (/assainis|sewage|us[ée]e|\beu\b|waste/.test(t)) return 'eu';
  if (/eau|water|aep|potable|hydrant/.test(t)) return 'aep';
  if (/gaz|\bgas\b/.test(t)) return 'gaz';
  if (/chaleur|chauffage|vapeur|\bfroid\b|heat|district/.test(t)) return 'chaleur';
  if (/[ée]lectr|power|cable|câble|\bhta\b|\bbt\b/.test(t)) return 'elec';
  if (/t[ée]l[ée]com|fibre|communication|optique|\bftth\b/.test(t)) return 'telecom';
  return 'autre';
}
const lines = g => !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'GeometryCollection' ? g.geometries.flatMap(lines) : [];
function fromGeoJSON(j, fixed) {
  const out = [], feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', geometry: j, properties: {} }];
  feats.forEach(f => {
    const pr = f.properties || {}, txt = Object.values(pr).filter(v => typeof v === 'string').join(' ');
    lines(f.geometry).forEach(c => {
      const pts = c.map(q => toLL(q[0], q[1])).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length < 2) return;
      const type = fixed || guessType(txt), d = +pr.profondeur || +pr.depth;
      out.push({ type, name: String(pr.nom || pr.name || pr.reseau || TYPES[type].label).slice(0, 40), depth: d > 0 && d < 15 ? d : TYPES[type].depth, diam: +pr.diametre || +pr.diameter || TYPES[type].diam, pts });
    });
  });
  return out;
}
function fromKML(text, fixed) {
  const x = new DOMParser().parseFromString(text, 'application/xml'), out = [];
  [...x.getElementsByTagName('Placemark')].forEach(pm => {
    const name = (pm.getElementsByTagName('name')[0] || {}).textContent || '', desc = (pm.getElementsByTagName('description')[0] || {}).textContent || '';
    [...pm.getElementsByTagName('LineString')].forEach(ls => {
      const c = ((ls.getElementsByTagName('coordinates')[0] || {}).textContent || '').trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(q => q.length >= 2 && q.every(Number.isFinite));
      const pts = c.map(q => toLL(q[0], q[1])); if (pts.length < 2) return;
      const type = fixed || guessType(name + ' ' + desc);
      out.push({ type, name: (name || TYPES[type].label).slice(0, 40), depth: TYPES[type].depth, diam: TYPES[type].diam, pts });
    });
  });
  return out;
}
function add(items, src) {
  const have = new Set(nets.map(n => n.src + ':' + n.sid)); let n = 0;
  items.slice(0, 1500).forEach(it => {
    const key = src + ':' + it.sid; if (it.sid && have.has(key)) return;
    nets.push({ id: uid(), type: it.type, name: it.name, depth: it.depth, diam: it.diam, src, sid: it.sid || null, pts: it.pts.map(p => [+p[0].toFixed(7), +p[1].toFixed(7)]) }); n++;
  });
  save(); render(); list(); return n;
}

/* Repérage fait sur une photo : remplace ce qui venait déjà de cette photo (items = null : retire tout) */
export function replaceFromPhoto(key, items) {
  nets = nets.filter(n => !(n.src === 'photo' && n.ph === key));
  (items || []).forEach(it => {
    nets.push({ id: uid(), type: TYPES[it.type] ? it.type : 'autre', name: String(it.name || '').slice(0, 60), depth: it.depth, diam: it.diam, col: it.col, kind: it.kind === 'pipe' ? undefined : it.kind, src: 'photo', ph: key, sid: it.oid, pts: it.pts, x: it.x || undefined });
  });
  save(); render(); list();
}

export const addItems = (items, src) => add(items, src);

/* ---------- données ouvertes de la vue ---------- */
const wfs = (layer, b) => `https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=BDTOPO_V3:${layer}&outputFormat=application/json&srsName=EPSG:4326&count=800&BBOX=${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()},urn:ogc:def:crs:EPSG::4326`;
async function getJSON(url, opt) { const r = await fetch(url, opt); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }
/* ---------- zone à récupérer (polygone dessiné) ---------- */
let zone = null, zdraw = null;
const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[0] > pt[0]) !== (b[0] > pt[0]) && pt[1] < (b[1] - a[1]) * (pt[0] - a[0]) / (b[0] - a[0]) + a[1]) c = !c; } return c; };
const inZone = p => inPoly([p[0], p[1]], zone.poly);
function zoneUi() {
  const on = !!zone, d = !!zdraw;
  $('ntZone').textContent = d ? (zdraw.pts.length >= 3 ? 'Terminer la zone' : 'Dessinez la zone…') : on ? 'Redessiner la zone' : 'Dessiner la zone';
  $('ntZoneOff').hidden = !on || d;
  $('ntZoneTxt').textContent = d ? 'Dessinez la zone à main levée (maintenez appuyé et contournez), ou cliquez ses coins puis double-clic. Échap annule.' : on ? 'Zone active : seuls les réseaux de cette zone seront importés.' : 'Sans zone, l’import porte sur toute la vue de la carte.';
}
/* tracé à main levée : on garde le doigt / la souris appuyé et on contourne la zone */
const zc = () => map.getContainer();
function zDown(e) { if (!zdraw || e.button > 0 || e.target.closest('.leaflet-control')) return; zdraw.down = { x: e.clientX, y: e.clientY, pts: [] }; }
function zMov(e) {
  const d = zdraw && zdraw.down; if (!d) return;
  if (!d.free && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
  if (!d.free) { d.free = true; zdraw.pts = []; zc().setPointerCapture && zc().setPointerCapture(e.pointerId); }
  const ll = map.mouseEventToLatLng(e), p = [ll.lat, ll.lng], l = zdraw.pts[zdraw.pts.length - 1];
  if (!l || map.latLngToContainerPoint(L.latLng(l)).distanceTo(map.latLngToContainerPoint(ll)) > 6) { zdraw.pts.push(p); zdraw.line.setLatLngs(zdraw.pts); }
}
function zUp() { const d = zdraw && zdraw.down; if (!d) return; zdraw.down = null; if (d.free) { zdraw.freed = true; setTimeout(() => { if (zdraw) zdraw.freed = false; }, 50); if (zdraw.pts.length >= 3) zoneEnd(); else { zdraw.pts = []; zdraw.line.setLatLngs([]); zoneUi(); } } }
function zoneStop(keep) {
  if (!zdraw) return; zc().removeEventListener('pointerdown', zDown); zc().removeEventListener('pointermove', zMov); zc().removeEventListener('pointerup', zUp); map.dragging.enable(); zc().style.touchAction = ''; map.off('click', zoneClick); map.off('mousemove', zoneMove); map.off('dblclick', zoneDbl); map.doubleClickZoom.enable(); map.getContainer().style.cursor = '';
  map.removeLayer(zdraw.line); zdraw = null; if (!keep) zoneUi();
}
function zoneClick(e) { if (zdraw.freed) return; zdraw.pts.push([e.latlng.lat, e.latlng.lng]); zdraw.line.setLatLngs(zdraw.pts); zoneUi(); }
function zoneMove(e) { if (zdraw && !zdraw.down && zdraw.pts.length) zdraw.line.setLatLngs([...zdraw.pts, [e.latlng.lat, e.latlng.lng]]); }
function zoneDbl(e) { L.DomEvent.stop(e); zoneEnd(); }
function zoneEnd() {
  if (!zdraw) return; if (zdraw.pts.length < 3) { status('Il faut au moins 3 coins.', { ms: 3000 }); return; }
  const poly = zdraw.pts.slice(); zoneStop(true); setZone(poly);
}
function setZone(poly) {
  if (zone && zone.layer) map.removeLayer(zone.layer);
  const layer = L.polygon(poly, { color: '#ffc61a', weight: 3, dashArray: '8 6', fillOpacity: .08, interactive: false }).addTo(map);
  zone = { poly, layer, bounds: layer.getBounds() }; zoneUi();
}
function startZone() {
  if (zdraw) { zoneEnd(); return; }
  cancelDraw(); stopEdit(); stopOthers();
  zdraw = { pts: [], line: L.polyline([], { color: '#ffc61a', weight: 3, dashArray: '6 5', interactive: false }).addTo(map) };
  map.doubleClickZoom.disable(); map.dragging.disable(); zc().style.touchAction = 'none'; map.getContainer().style.cursor = 'crosshair';
  zc().addEventListener('pointerdown', zDown); zc().addEventListener('pointermove', zMov); zc().addEventListener('pointerup', zUp);
  map.on('click', zoneClick); map.on('mousemove', zoneMove); map.on('dblclick', zoneDbl); zoneUi();
}
function clearZone() { zoneStop(); if (zone) { map.removeLayer(zone.layer); zone = null; } zoneUi(); }


/* Données ouvertes énergie : Enedis (Data-Fair), GRDF et ODRÉ (OpenDataSoft), chaleur (France Chaleur Urbaine, data.gouv) */
let fcuData = null;
const mkLines = (feats, o) => feats.flatMap((f, i) => lines(f && (f.geometry || f)).map((c, k) => ({ sid: o.id + ':' + ((f && (f.id || (f.properties && (f.properties.id || f.properties.objectid)))) || i) + ':' + k + ':' + c.length, type: o.type, name: o.name, depth: o.depth, diam: TYPES[o.type].diam, pts: c.map(q => [q[1], q[0]]) })));
const ENEDIS = [['reseau-souterrain-bt', 'Électricité BT souterraine', TYPES.elec.depth], ['reseau-souterrain-hta', 'Électricité HTA souterraine', TYPES.elec.depth], ['reseau-bt', 'Électricité BT aérienne', -8], ['reseau-hta', 'Électricité HTA aérienne', -9]];
async function enedisFetch(b) {
  let n = 0, ok = 0;
  for (const [id, name, depth] of ENEDIS) {
    try { const j = await getJSON(`https://opendata.enedis.fr/data-fair/api/v1/datasets/${id}/lines?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&format=geojson&size=1000`); ok++; n += addZ2(mkLines(j.features || [], { id, type: 'elec', name, depth }), 'enedis'); } catch (e) { /* jeu sans réponse */ }
  }
  if (!ok) throw new Error('aucun jeu'); return n;
}
/* OpenDataSoft : 100 enregistrements par requête, on pagine */
async function odsFetch(host, ds, b, o, src) {
  let n = 0;
  for (let off = 0; off < 1000; off += 100) {
    const j = await getJSON(`https://${host}/api/explore/v2.1/catalog/datasets/${ds}/records?where=${encodeURIComponent(`in_bbox(geo_shape,${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()})`)}&limit=100&offset=${off}`);
    const rs = j.results || []; n += addZ2(mkLines(rs.map(r => r.geo_shape && (r.geo_shape.geometry || r.geo_shape)).filter(Boolean), o), src);
    if (rs.length < 100) break;
  }
  return n;
}
const grdfFetch = b => odsFetch('opendata.grdf.fr', 'cartographie-du-reseau-grdf-en-service', b, { id: 'grdf', type: 'gaz', name: 'Gaz (GRDF)', depth: TYPES.gaz.depth }, 'grdf');
const odreFetch = b => odsFetch('odre.opendatasoft.com', 'lignes-souterraines-rte-nv', b, { id: 'rte', type: 'elec', name: 'Électricité HTB souterraine (RTE)', depth: 1.5 }, 'odre');
async function fcuFetch(b) {
  if (!fcuData) fcuData = (async () => {
    const d = await getJSON('https://www.data.gouv.fr/api/1/datasets/64f05d3568e4d575eb454ffe/');
    const r = (d.resources || []).filter(x => /geojson|json/i.test(x.format || '') || /geojson/i.test(x.url || '')).sort((a, c) => /trac/i.test(c.title || '') - /trac/i.test(a.title || ''))[0];
    if (!r) throw new Error('pas de fichier');
    const j = await getJSON(r.url);
    return (j.features || []).filter(f => f.geometry && /Line/.test(f.geometry.type));
  })();
  const fs = await fcuData, w = b.getWest(), e = b.getEast(), so = b.getSouth(), no = b.getNorth();
  const hit = fs.filter(f => lines(f.geometry).some(c => c.some(q => q[0] >= w && q[0] <= e && q[1] >= so && q[1] <= no)));
  return addZ2(hit.flatMap((f, i) => lines(f.geometry).map((c, k) => { const t = f.properties || {}; return { sid: 'fcu:' + (t.id_fcu || t.Identifiant_reseau || t.id || i) + ':' + k + ':' + c.length, type: 'chaleur', name: String(t.nom_reseau || t.Nom_reseau || t.nom || 'Réseau de chaleur').slice(0, 40), depth: TYPES.chaleur.depth, diam: TYPES.chaleur.diam, pts: c.map(q => [q[1], q[0]]) }; })), 'fcu');
}
let addZ2 = (items, src) => add(items, src);
/* WFS : selon le serveur l'ordre des axes est lon,lat ou lat,lon : en France la latitude dépasse 38 */
const ign = q => q[0] > 38 && q[0] < 52 && Math.abs(q[1]) < 12 ? [q[0], q[1]] : [q[1], q[0]];
async function fetchOpen() {
  const b = zone ? zone.bounds : map.getBounds();
  if (!zone && map.getZoom() < 15) { status('Zoomez sur le chantier ou dessinez la zone à récupérer (bouton « Dessiner la zone »).', { ms: 5000 }); return; }
  const btn = $('ntFetch'); btn.disabled = true; btn.textContent = 'Recherche en cours…';
  const rep = {}; let total = 0; const addZ = (items, src) => add(zone ? items.filter(it => it.pts.some(inZone)) : items, src); addZ2 = addZ;
  const run = async (nom, fn) => { const r = rep[nom] || (rep[nom] = { n: 0, ko: 0 }); try { const n = await fn(); total += n; r.n += n; } catch (e) { r.ko++; } };
  const doBox = async b => { await Promise.all([
    run('IGN canalisations', async () => { const j = await getJSON(wfs('canalisation', b)); return addZ(j.features.flatMap(f => lines(f.geometry).map(c => { const nat = f.properties.nature || '', under = String(f.properties.position_par_rapport_au_sol) === '-1'; const type = guessType(nat); return { sid: f.id + ':' + c.length, type, name: ('Canalisation ' + nat).slice(0, 40), depth: under ? TYPES[type].depth : 0, diam: TYPES[type].diam, pts: c.map(ign) }; })), 'ign'); }),
    run('Enedis', () => enedisFetch(b)),
    run('GRDF', () => grdfFetch(b)),
    run('RTE (ODRÉ)', () => odreFetch(b)),
    run('Chaleur (France Chaleur Urbaine)', () => fcuFetch(b)),
    run('IGN lignes électriques', async () => { const j = await getJSON(wfs('ligne_electrique', b)); return addZ(j.features.flatMap(f => lines(f.geometry).map(c => ({ sid: f.id + ':' + c.length, type: 'elec', name: 'Ligne électrique', depth: -9, diam: 40, pts: c.map(ign) }))), 'ign'); }),
    run('OpenStreetMap', async () => {
      const bb = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
      const q = `[out:json][timeout:20];(way["man_made"="pipeline"](${bb});way["power"~"^(cable|minor_line)$"](${bb});way["communication"~"line|cable"](${bb});way["telecom"~"line|cable"](${bb}););out geom 800;`;
      const j = await getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      return addZ(j.elements.filter(w => w.geometry && w.geometry.length > 1).map(w => {
        const t = w.tags || {}, txt = [t.substance, t.man_made, t.power, t.communication, t.telecom, t.name].filter(Boolean).join(' '), type = t.power ? 'elec' : (t.communication || t.telecom) ? 'telecom' : guessType(txt);
        const under = t.location === 'underground' || t.tunnel === 'yes' || t.man_made === 'pipeline' && !/above/.test(t.location || '');
        return { sid: 'w' + w.id, type, name: (t.name || TYPES[type].label).slice(0, 40), depth: t.power && !under ? -8 : TYPES[type].depth, diam: +t.diameter || TYPES[type].diam, pts: w.geometry.map(p => [p.lat, p.lon]) };
      }), 'osm');
    }),
  ]); };
  /* grande zone : découpage en carreaux d'environ 1 km, seuls ceux qui touchent la zone sont interrogés */
  const tiles = []; const STEP = 0.009, S = b.getSouth(), W = b.getWest(), N = b.getNorth(), E = b.getEast(), kx = STEP / Math.cos(((S + N) / 2) * Math.PI / 180);
  for (let la = S; la < N; la += STEP) for (let lo = W; lo < E; lo += kx) {
    const t = L.latLngBounds([la, lo], [Math.min(la + STEP, N), Math.min(lo + kx, E)]);
    if (!zone || zone.layer.getBounds().intersects(t) && (inZone([t.getCenter().lat, t.getCenter().lng]) || [t.getSouthWest(), t.getNorthEast(), t.getNorthWest(), t.getSouthEast()].some(c => inZone([c.lat, c.lng])) || zone.poly.some(v => t.contains(v)))) tiles.push(t);
  }
  if (tiles.length > 150) { btn.disabled = false; btn.textContent = 'Importer depuis les banques publiques'; status(`Zone trop grande (${tiles.length} carreaux de 1 km, 150 maximum). Découpez-la en plusieurs zones.`, { ms: 6000 }); return; }
  let done = 0; const q = tiles.slice();
  await Promise.all([0, 1].map(async () => { for (let t; (t = q.shift());) { await doBox(t); done++; btn.textContent = `Recherche… ${done}/${tiles.length}`; } }));
  btn.disabled = false; btn.textContent = 'Importer depuis les banques publiques';
  const txt = Object.entries(rep).map(([k, r]) => `${k} : ${r.n}${r.ko ? ` (${r.ko} requête(s) sans réponse)` : ''}`).join(' · ');
  status(total ? `${total} tronçon(s) ajouté(s). ${txt}` : `Aucun nouveau réseau. ${txt}`, { ms: 9000 });
  if (total) { const all = getNets(); if (all.length) map.fitBounds(L.latLngBounds(all.flatMap(d => d.pts)).pad(.1), { maxZoom: 19 }); }
}
async function importFile(f) {
  const fixed = $('ntImpType').value || null;
  try {
    const text = await f.text(), items = /\.(kml)$/i.test(f.name) || /^\s*<\?xml|^\s*<kml/i.test(text) ? fromKML(text, fixed) : fromGeoJSON(JSON.parse(text), fixed);
    if (!items.length) { status('Aucune ligne de réseau trouvée dans ce fichier (GeoJSON ou KML attendu).', { ms: 6000 }); return; }
    const n = add(items, 'fichier'); status(`${n} tronçon(s) importé(s) depuis ${f.name}.`, { ms: 5000 });
    const all = getNets(); if (all.length) map.fitBounds(L.latLngBounds(all.flatMap(d => d.pts)).pad(.2), { maxZoom: 19 });
  } catch (e) { status('Fichier illisible. Formats : GeoJSON ou KML, en WGS 84 ou Lambert-93.', { ms: 6000 }); }
}

/* ---------- affichage ---------- */
function render() {
  if (!map) return;
  if (!layer) layer = L.layerGroup();
  layer.clearLayers();
  if (!show) { map.removeLayer(layer); return; }
  layer.addTo(map);
  getNets().filter(d => d.ph !== 'rsx' && d.pts.length > 1 && vis(d.id)).forEach(d => {
    const t = TYPES[d.type], on = d.id === sel;
    const line = L.polyline(d.pts, { color: t.color, weight: on ? 5 : 3.2, opacity: .95, dashArray: d.depth < 0 ? '1 7' : '9 5', lineCap: 'round', bubblingMouseEvents: false });
    line.bindTooltip(`${esc(d.name)} · ${t.label}${d.depth > 0 ? ' · prof. ' + d.depth + ' m' : ''}`, { sticky: true });
    line.on('click', e => { if (draw) return; L.DomEvent.stop(e); if (edit === d.id) addVertex(d, e.latlng); else select(d.id, true); });
    layer.addLayer(line);
  });
}
export function select(id, openPanel) {
  sel = id; render(); list();
  if (openPanel) { $('chPanel').hidden = false; $('chBtn').setAttribute('aria-expanded', 'true'); tab('n'); const li = document.querySelector(`#ntList li[data-id="${id}"]`); if (li) li.scrollIntoView({ block: 'nearest' }); }
}
let tabFn = () => {};
function tab(k) { tabFn(k); }

/* ---------- tracé ---------- */
function startDraw(type) {
  cancelDraw(); stopEdit(); stopOthers();
  draw = { type, pts: [], line: L.polyline([], { color: TYPES[type].color, weight: 4, dashArray: '6 5', interactive: false }).addTo(map), dots: L.layerGroup().addTo(map) };
  map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair';
  $('ntDraw').hidden = false; drawText();
  document.querySelectorAll('.nt-type').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
}
function drawText() {
  const n = draw ? draw.pts.length : 0;
  $('ntDrawTxt').textContent = n === 0 ? `${TYPES[draw.type].label} : cliquez le point de départ.` : n === 1 ? 'Cliquez les points suivants du tracé.' : `${n} points, ${fmtLen(length(draw.pts.map(p => [p.lat, p.lng])))}. Double-clic ou « Terminer » pour finir.`;
  $('ntDrawOk').hidden = n < 2; $('ntDrawBack').hidden = n === 0;
}
function preview(cur) { if (draw) draw.line.setLatLngs(cur && draw.pts.length ? [...draw.pts, cur] : draw.pts); }
function onClick(e) {
  if (!draw) return;
  const px = map.latLngToContainerPoint(e.latlng), last = draw.pts.length ? map.latLngToContainerPoint(draw.pts[draw.pts.length - 1]) : null;
  if (last && last.distanceTo(px) < 6) return;
  draw.pts.push(e.latlng); L.circleMarker(e.latlng, { radius: 4, color: '#fff', weight: 2, fillColor: TYPES[draw.type].color, fillOpacity: 1, interactive: false }).addTo(draw.dots);
  preview(); drawText();
}
function finishLine() {
  if (!draw || draw.pts.length < 2) return;
  const type = draw.type, pts = draw.pts.map(q => [q.lat, q.lng]), n = nets.filter(d => d.type === type).length + 1;
  cancelDraw();
  const d = { id: uid(), type, name: n > 1 ? `${TYPES[type].label} ${n}` : TYPES[type].label, depth: TYPES[type].depth, diam: TYPES[type].diam, src: 'manuel', pts: pts.map(p => [+p[0].toFixed(7), +p[1].toFixed(7)]) };
  nets.push(d); save(); sel = d.id; render(); list();
  status(`${TYPES[type].label} ajouté : ${fmtLen(length(d.pts))}. Visible en 3D sous le sol (case « Réseaux enterrés »).`, { ms: 4000 });
}
export function cancelDraw() {
  if (!draw) return false;
  map.removeLayer(draw.line); map.removeLayer(draw.dots); draw = null;
  map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; $('ntDraw').hidden = true;
  document.querySelectorAll('.nt-type').forEach(b => b.setAttribute('aria-pressed', 'false'));
  return true;
}

/* ---------- modification ---------- */
function startEdit(id) {
  cancelDraw(); stopEdit(); stopOthers(); edit = id; select(id, false);
  const d = nets.find(q => q.id === id); if (!d) return;
  handles = L.layerGroup().addTo(map);
  d.pts.forEach((p, i) => {
    const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'ch-handle', iconSize: [16, 16] }), title: 'Glisser pour déplacer, double-clic pour retirer' }).addTo(handles);
    m.on('drag', e => { d.pts[i] = [e.latlng.lat, e.latlng.lng]; render(); });
    m.on('dragend', () => { d.pts = d.pts.map(q => [+q[0].toFixed(7), +q[1].toFixed(7)]); save(); list(); });
    m.on('dblclick', ev => { L.DomEvent.stop(ev); if (d.pts.length <= 2) return; d.pts.splice(i, 1); save(); startEdit(id); });
  });
  status('Modification : déplacez les points, cliquez sur le tracé pour en ajouter un, double-clic sur un point pour le retirer. Échap pour finir.', { ms: 6000 });
  list();
}
function addVertex(d, ll) {
  const P = d.pts.map(p => map.latLngToContainerPoint(p)), c = map.latLngToContainerPoint(ll); let best = [1e9, 0];
  for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1))), dd = Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y); if (dd < best[0]) best = [dd, i]; }
  d.pts.splice(best[1] + 1, 0, [+ll.lat.toFixed(7), +ll.lng.toFixed(7)]); save(); startEdit(d.id);
}
function stopEdit() { if (handles) { map.removeLayer(handles); handles = null; } if (edit) { edit = null; list(); } }

/* ---------- liste ---------- */
function list() {
  const ul = $('ntList'); if (!ul) return;
  const ds = getNets().filter(d => d.ph !== 'rsx'); $('ntEmpty').hidden = ds.length > 0; $('ntClear').hidden = !ds.length;
  ul.innerHTML = ds.map(d => `<li data-id="${esc(d.id)}" class="${d.id === sel ? 'on' : ''}"><div class="ch-row"><i class="ch-sw" style="background:${TYPES[d.type].color}"></i><input class="ch-name" value="${esc(d.name)}" aria-label="Nom du réseau" maxlength="40"><small>${fmtLen(length(d.pts))}</small></div>
    <div class="ch-acts"><select class="ch-ty" aria-label="Type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${k === d.type ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
    <label class="dv-w">Prof. <input type="number" class="dv-width nt-depth" min="-30" max="15" step=".1" value="${d.depth}" aria-label="Profondeur en mètres, négative si aérien"> m</label>
    <label class="dv-w">Ø <input type="number" class="dv-width nt-diam" min="10" max="3000" step="10" value="${d.diam}" aria-label="Diamètre en millimètres"> mm</label></div>
    <div class="ch-acts"><button type="button" class="link" data-a="go">Voir</button><button type="button" class="link" data-a="edit">${edit === d.id ? 'Terminer' : 'Modifier'}</button><button type="button" class="link danger" data-a="del">Supprimer</button></div></li>`).join('');
}

export function init(ctx) {
  map = ctx.map; status = ctx.status; stopOthers = ctx.stopOthers || stopOthers; onChange = ctx.onChange || onChange; tabFn = ctx.tab || tabFn;
  show = ctx.show !== false; if (ctx.visible) vis = ctx.visible;
  nets = readLocal() || (proj ? proj.filter(clean) : []);
  $('ntTypes').innerHTML = Object.entries(TYPES).map(([k, v]) => `<button type="button" class="ch-type nt-type" data-type="${k}" aria-pressed="false" title="${v.label}"><i style="background:${v.color}"></i><b>${v.label}</b></button>`).join('');
  $('ntImpType').innerHTML = '<option value="">Type selon le fichier</option>' + Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('ntTypes').addEventListener('click', e => { const b = e.target.closest('.nt-type'); if (b) startDraw(b.dataset.type); });
  $('ntFetch').addEventListener('click', fetchOpen);
  $('ntZone').addEventListener('click', startZone); $('ntZoneOff').addEventListener('click', clearZone); zoneUi();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && zdraw) zoneStop(); });
  $('ntPdf').addEventListener('change', e => { const f = e.target.files[0]; if (f) openDT(f, { map, status, TYPES, addItems, toLL }).catch(() => status('Import du PDF impossible.', { ms: 6000 })); e.target.value = ''; });
  $('ntPdfOff').addEventListener('click', clearOverlay); document.addEventListener('dt-overlay', e => { $('ntPdfOff').hidden = !e.detail; });
  $('ntFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
  $('ntClear').addEventListener('click', e => { if (e.target.dataset.sure) { nets = []; stopEdit(); save(); sel = null; render(); list(); delete e.target.dataset.sure; e.target.textContent = 'Tout supprimer'; } else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Tout supprimer'; } }, 3000); } });
  $('ntDrawOk').addEventListener('click', finishLine); $('ntDrawNo').addEventListener('click', cancelDraw);
  $('ntDrawBack').addEventListener('click', () => { if (draw && draw.pts.length) { draw.pts.pop(); draw.dots.clearLayers(); draw.pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: TYPES[draw.type].color, fillOpacity: 1, interactive: false }).addTo(draw.dots)); preview(); drawText(); } });
  map.on('click', onClick); map.on('dblclick', e => { if (draw) { L.DomEvent.stop(e); finishLine(); } });
  map.on('mousemove', e => { if (draw && draw.pts.length) preview(e.latlng); });
  $('ntList').addEventListener('input', e => { const li = e.target.closest('li'); if (!li) return; const d = nets.find(q => q.id === li.dataset.id); if (!d) return;
    if (e.target.classList.contains('ch-name')) { d.name = e.target.value.trim() || TYPES[d.type].label; save(); }
    else if (e.target.classList.contains('nt-depth')) { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= -30 && v <= 15) { d.depth = v; save(); render(); } }
    else if (e.target.classList.contains('nt-diam')) { const v = parseFloat(e.target.value); if (v >= 10 && v <= 3000) { d.diam = v; save(); } } });
  $('ntList').addEventListener('change', e => { const li = e.target.closest('li'); if (!li || !e.target.classList.contains('ch-ty')) return; const d = nets.find(q => q.id === li.dataset.id); if (d) { d.type = e.target.value; d.depth = TYPES[d.type].depth; d.diam = TYPES[d.type].diam; save(); render(); list(); } });
  $('ntList').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return; const d = nets.find(q => q.id === li.dataset.id), a = e.target.dataset.a;
    if (!a) { if (!e.target.closest('input,select,label')) select(li.dataset.id, false); return; }
    if (a === 'go') { select(d.id, false); map.fitBounds(L.latLngBounds(d.pts).pad(.6), { maxZoom: 19 }); }
    else if (a === 'edit') { if (edit === d.id) stopEdit(); else startEdit(d.id); }
    else if (a === 'del') {
      if (e.target.dataset.sure) { nets = nets.filter(q => q.id !== d.id); if (edit === d.id) stopEdit(); save(); sel = null; render(); list(); }
      else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Supprimer'; } }, 3000); }
    }
  });
  addEventListener('keydown', e => {
    if (draw && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelDraw(); }
    else if (draw && e.key === 'Enter') { e.preventDefault(); finishLine(); }
    else if (draw && e.key === 'Backspace') { e.preventDefault(); $('ntDrawBack').click(); }
    else if (edit && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopEdit(); }
  }, true);
  render(); list();
}
export const refresh = () => render();
export const setShow = v => { show = v; render(); };
export const stop = () => { cancelDraw(); stopEdit(); };
