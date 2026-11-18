/* GeoTrace – réseaux existants : tracé à la main d'après un plan DT-DICT, import GeoJSON / KML (WGS 84 ou Lambert-93),
   récupération des données ouvertes de la vue (IGN BD TOPO, OpenStreetMap). Affichés en 2D et en 3D (enterrés).
   Enregistrés avec le calage (chantier.nets). */
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

/* ---------- données ouvertes de la vue ---------- */
const wfs = (layer, b) => `https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=BDTOPO_V3:${layer}&outputFormat=application/json&srsName=EPSG:4326&count=800&bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()},EPSG:4326`;
async function getJSON(url, opt) { const r = await fetch(url, opt); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }
async function fetchOpen() {
  const b = map.getBounds();
  if (map.getZoom() < 15) { status('Zoomez davantage sur le chantier (échelle 100 m ou moins) pour récupérer les réseaux.', { ms: 5000 }); return; }
  const btn = $('ntFetch'); btn.disabled = true; btn.textContent = 'Recherche en cours…';
  const rep = []; let total = 0;
  const run = async (nom, fn) => { try { const n = await fn(); total += n; rep.push(`${nom} : ${n}`); } catch (e) { rep.push(`${nom} : indisponible`); } };
  await Promise.all([
    run('IGN canalisations', async () => { const j = await getJSON(wfs('canalisation', b)); return add(j.features.flatMap(f => lines(f.geometry).map(c => { const nat = f.properties.nature || '', under = String(f.properties.position_par_rapport_au_sol) === '-1'; const type = guessType(nat); return { sid: f.id + ':' + c.length, type, name: ('Canalisation ' + nat).slice(0, 40), depth: under ? TYPES[type].depth : 0, diam: TYPES[type].diam, pts: c.map(q => [q[1], q[0]]) }; })), 'ign'); }),
    run('IGN lignes électriques', async () => { const j = await getJSON(wfs('ligne_electrique', b)); return add(j.features.flatMap(f => lines(f.geometry).map(c => ({ sid: f.id + ':' + c.length, type: 'elec', name: 'Ligne électrique', depth: -9, diam: 40, pts: c.map(q => [q[1], q[0]]) }))), 'ign'); }),
    run('OpenStreetMap', async () => {
      const bb = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
      const q = `[out:json][timeout:20];(way["man_made"="pipeline"](${bb});way["power"~"^(cable|minor_line)$"](${bb});way["communication"~"line|cable"](${bb});way["telecom"~"line|cable"](${bb}););out geom 800;`;
      const j = await getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      return add(j.elements.filter(w => w.geometry && w.geometry.length > 1).map(w => {
        const t = w.tags || {}, txt = [t.substance, t.man_made, t.power, t.communication, t.telecom, t.name].filter(Boolean).join(' '), type = t.power ? 'elec' : (t.communication || t.telecom) ? 'telecom' : guessType(txt);
        const under = t.location === 'underground' || t.tunnel === 'yes' || t.man_made === 'pipeline' && !/above/.test(t.location || '');
        return { sid: 'w' + w.id, type, name: (t.name || TYPES[type].label).slice(0, 40), depth: t.power && !under ? -8 : TYPES[type].depth, diam: +t.diameter || TYPES[type].diam, pts: w.geometry.map(p => [p.lat, p.lon]) };
      }), 'osm');
    }),
  ]);
  btn.disabled = false; btn.textContent = 'Récupérer les données ouvertes de la vue';
  status(total ? `${total} tronçon(s) ajouté(s). ${rep.join(' · ')}` : `Aucun nouveau réseau dans cette vue. ${rep.join(' · ')}`, { ms: 7000 });
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
  ul.innerHTML = ds.map(d => `<li data-id="${d.id}" class="${d.id === sel ? 'on' : ''}"><div class="ch-row"><i class="ch-sw" style="background:${TYPES[d.type].color}"></i><input class="ch-name" value="${esc(d.name)}" aria-label="Nom du réseau" maxlength="40"><small>${fmtLen(length(d.pts))}</small></div>
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
