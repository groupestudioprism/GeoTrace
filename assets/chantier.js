/* GeoTrace – installations de chantier sur la carte 2D : dessin, modification, liste, enregistrement.
   Les zones sont gardées dans le navigateur et ajoutées au fichier de calage de l'équipe (.geotrace.json). */
const L = window.L;
const $ = id => document.getElementById(id);
const KEY = 'geotrace:chantier', SHOW = 'geotrace:chantier:show';

export const TYPES = {
  base:     { label: 'Base vie',   color: '#1f6fb5', note: 'Cabines modulaires' },
  depot:    { label: 'Dépôt',      color: '#e0922b', note: 'Conteneurs et palettes' },
  decharge: { label: 'Décharge',   color: '#8a5f36', note: 'Bennes et tas de terre' },
  stock:    { label: 'Stockage',   color: '#2f8f63', note: 'Tuyaux et matériaux' },
  parking:  { label: 'Parking',    color: '#6b7480', note: 'Places et véhicules' },
  acces:    { label: 'Accès',      color: '#d6402b', note: 'Portail, panneau, cônes' },
};
export const COLORS = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.color]));

let map = null, status = () => {}, stopOthers = () => {}, onChange = () => {};
let zones = [], proj = null, layer = null, show = true, draw = null, edit = null, sel = null;

const uid = () => 'z' + Math.random().toString(36).slice(2, 8);
const readLocal = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.zones) ? j.zones : null; } catch (e) { return null; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, zones })); } catch (e) { /* stockage indisponible */ } onChange(); };
const clean = z => z && TYPES[z.type] && Array.isArray(z.pts) && z.pts.length >= 3 && z.pts.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
export const getZones = () => zones.filter(clean);
export const exportData = () => zones.length ? { v: 1, zones: getZones() } : null;
export function setProject(p) {
  proj = p && Array.isArray(p.zones) ? p : null;
  const loc = readLocal();
  zones = loc || (proj ? proj.zones.filter(clean) : []);
  render(); list();
}

/* Surface approchée en m² (projection plane locale). */
function area(pts) {
  const k = Math.PI / 180, R = 6378137, lat0 = pts[0][0] * k; let s = 0;
  const xy = pts.map(p => [(p[1] - pts[0][1]) * k * R * Math.cos(lat0), (p[0] - pts[0][0]) * k * R]);
  for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
const fmtArea = a => a >= 10000 ? (a / 10000).toFixed(2).replace('.', ',') + ' ha' : Math.round(a) + ' m²';
const centroid = pts => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- affichage sur la carte ---------- */
function render() {
  if (!map) return;
  if (!layer) layer = L.layerGroup();
  layer.clearLayers();
  if (!show) { map.removeLayer(layer); return; }
  layer.addTo(map);
  getZones().forEach(z => {
    const t = TYPES[z.type], on = z.id === sel;
    const poly = L.polygon(z.pts, { color: t.color, weight: on ? 4 : 2.5, dashArray: on ? null : '7 5', fillColor: t.color, fillOpacity: on ? .4 : .26, bubblingMouseEvents: false });
    poly.on('click', e => { if (draw) return; L.DomEvent.stop(e); if (edit === z.id) addVertex(z, e.latlng); else select(z.id, true); });
    layer.addLayer(poly);
    layer.addLayer(L.marker(centroid(z.pts), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'ch-label', html: `<span style="--c:${t.color}">${esc(z.name)}</span>`, iconSize: null }) }));
  });
}
function select(id, openPanel) {
  sel = id; render(); list();
  if (openPanel) { $('chPanel').hidden = false; $('chBtn').setAttribute('aria-expanded', 'true'); const li = document.querySelector(`#chList li[data-id="${id}"]`); if (li) li.scrollIntoView({ block: 'nearest' }); }
}

/* ---------- dessin ---------- */
let rectMode = true;
function startDraw(type) {
  cancelDraw(); stopEdit(); stopOthers();
  draw = { type, pts: [], line: L.polyline([], { color: TYPES[type].color, weight: 3, dashArray: '6 5', interactive: false }).addTo(map), dots: L.layerGroup().addTo(map), rubber: null };
  map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair';
  $('chDraw').hidden = false; drawText();
  document.querySelectorAll('.ch-type').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
}
function drawText() {
  const n = draw ? draw.pts.length : 0;
  $('chDrawTxt').textContent = rectMode
    ? (n === 0 ? `${TYPES[draw.type].label} : cliquez le premier coin.` : 'Cliquez le coin opposé.')
    : (n < 3 ? `${TYPES[draw.type].label} : cliquez pour poser les points (${n}).` : `${n} points. Double-clic ou « Terminer » pour fermer la zone.`);
  $('chDrawOk').hidden = rectMode; $('chDrawBack').hidden = rectMode || n === 0;
}
function rectPts(a, b) { return [[a.lat, a.lng], [a.lat, b.lng], [b.lat, b.lng], [b.lat, a.lng]]; }
function drawPreview(cur) {
  if (!draw) return;
  const p = draw.pts;
  if (rectMode) { draw.line.setLatLngs(p.length === 1 && cur ? [...rectPts(p[0], cur), rectPts(p[0], cur)[0]] : []); return; }
  draw.line.setLatLngs(cur && p.length ? [...p, cur] : p);
}
function onClick(e) {
  if (!draw) return;
  const px = map.latLngToContainerPoint(e.latlng), last = draw.pts.length ? map.latLngToContainerPoint(draw.pts[draw.pts.length - 1]) : null;
  if (last && last.distanceTo(px) < 6) return; // second clic d'un double-clic
  if (rectMode) {
    if (!draw.pts.length) { draw.pts.push(e.latlng); drawText(); return; }
    const a = draw.pts[0], b = e.latlng;
    if (Math.abs(a.lat - b.lat) < 1e-7 || Math.abs(a.lng - b.lng) < 1e-7) return;
    finish(rectPts(a, b)); return;
  }
  if (draw.pts.length >= 3 && map.latLngToContainerPoint(draw.pts[0]).distanceTo(px) < 12) { finish(draw.pts.map(q => [q.lat, q.lng])); return; }
  draw.pts.push(e.latlng); L.circleMarker(e.latlng, { radius: 4, color: '#fff', weight: 2, fillColor: TYPES[draw.type].color, fillOpacity: 1, interactive: false }).addTo(draw.dots);
  drawPreview(); drawText();
}
function finishPoly() { if (draw && !rectMode && draw.pts.length >= 3) finish(draw.pts.map(q => [q.lat, q.lng])); }
function finish(pts) {
  const type = draw.type, n = zones.filter(z => z.type === type).length + 1;
  cancelDraw();
  const z = { id: uid(), type, name: n > 1 ? `${TYPES[type].label} ${n}` : TYPES[type].label, pts: pts.map(p => [+p[0].toFixed(7), +p[1].toFixed(7)]) };
  zones.push(z); save(); sel = z.id; render(); list();
  status(`${TYPES[type].label} ajouté : ${fmtArea(area(z.pts))}. Visible en 3D dans « Photos en 3D ».`, { ms: 4000 });
}
export function cancelDraw() {
  if (!draw) return false;
  map.removeLayer(draw.line); map.removeLayer(draw.dots); draw = null;
  map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; $('chDraw').hidden = true;
  document.querySelectorAll('.ch-type').forEach(b => b.setAttribute('aria-pressed', 'false'));
  return true;
}

/* ---------- modification des sommets ---------- */
let handles = null;
function startEdit(id) {
  cancelDraw(); stopEdit(); stopOthers(); edit = id; select(id, false);
  const z = zones.find(q => q.id === id); if (!z) return;
  handles = L.layerGroup().addTo(map);
  z.pts.forEach((p, i) => {
    const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'ch-handle', iconSize: [16, 16] }), title: 'Glisser pour déplacer, double-clic pour retirer' }).addTo(handles);
    m.on('drag', e => { z.pts[i] = [e.latlng.lat, e.latlng.lng]; render(); });
    m.on('dragend', () => { z.pts = z.pts.map(q => [+q[0].toFixed(7), +q[1].toFixed(7)]); save(); list(); });
    m.on('dblclick', ev => { L.DomEvent.stop(ev); if (z.pts.length <= 3) return; z.pts.splice(i, 1); save(); startEdit(id); });
  });
  status('Modification : déplacez les points, cliquez sur un côté pour en ajouter un, double-clic sur un point pour le retirer. Échap pour finir.', { ms: 6000 });
  list();
}
function addVertex(z, ll) {
  const P = z.pts.map(p => map.latLngToContainerPoint(p)), c = map.latLngToContainerPoint(ll); let best = [1e9, 0];
  P.forEach((a, i) => { const b = P[(i + 1) % P.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y); if (d < best[0]) best = [d, i]; });
  z.pts.splice(best[1] + 1, 0, [+ll.lat.toFixed(7), +ll.lng.toFixed(7)]); save(); startEdit(z.id);
}
function stopEdit() { if (handles) { map.removeLayer(handles); handles = null; } if (edit) { edit = null; list(); } }

/* ---------- liste ---------- */
function list() {
  const ul = $('chList'); if (!ul) return;
  const zs = getZones(); $('chEmpty').hidden = zs.length > 0;
  ul.innerHTML = zs.map(z => `<li data-id="${z.id}" class="${z.id === sel ? 'on' : ''}"><div class="ch-row"><i class="ch-sw" style="background:${TYPES[z.type].color}"></i><input class="ch-name" value="${esc(z.name)}" aria-label="Nom de la zone" maxlength="40"><small>${fmtArea(area(z.pts))}</small></div>
    <div class="ch-acts"><select class="ch-ty" aria-label="Type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${k === z.type ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
    <button type="button" class="link" data-a="go">Voir</button><button type="button" class="link" data-a="edit">${edit === z.id ? 'Terminer' : 'Modifier'}</button><button type="button" class="link danger" data-a="del">Supprimer</button></div></li>`).join('');
}

export function init(ctx) {
  map = ctx.map; status = ctx.status; stopOthers = ctx.stopOthers || stopOthers; onChange = ctx.onChange || onChange;
  try { show = localStorage.getItem(SHOW) !== '0'; } catch (e) { /* par défaut */ }
  $('chShow').checked = show;
  zones = readLocal() || (proj ? proj.zones.filter(clean) : []);
  $('chTypes').innerHTML = Object.entries(TYPES).map(([k, v]) => `<button type="button" class="ch-type" data-type="${k}" aria-pressed="false"><i style="background:${v.color}"></i><b>${v.label}</b><small>${v.note}</small></button>`).join('');
  $('chTypes').addEventListener('click', e => { const b = e.target.closest('.ch-type'); if (!b) return; if (!show) { show = true; $('chShow').checked = true; render(); } startDraw(b.dataset.type); });
  const setMode = r => { rectMode = r; $('chRect').setAttribute('aria-pressed', String(r)); $('chPoly').setAttribute('aria-pressed', String(!r)); if (draw) { const t = draw.type; startDraw(t); } };
  $('chRect').addEventListener('click', () => setMode(true)); $('chPoly').addEventListener('click', () => setMode(false));
  $('chDrawOk').addEventListener('click', finishPoly); $('chDrawNo').addEventListener('click', cancelDraw);
  $('chDrawBack').addEventListener('click', () => { if (draw && draw.pts.length) { draw.pts.pop(); draw.dots.clearLayers(); draw.pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: TYPES[draw.type].color, fillOpacity: 1, interactive: false }).addTo(draw.dots)); drawPreview(); drawText(); } });
  map.on('click', onClick); map.on('dblclick', e => { if (draw) { L.DomEvent.stop(e); finishPoly(); } });
  map.on('mousemove', e => { if (draw && draw.pts.length) drawPreview(e.latlng); });
  $('chShow').addEventListener('change', () => { show = $('chShow').checked; try { localStorage.setItem(SHOW, show ? '1' : '0'); } catch (e) { /* ignoré */ } render(); });
  $('chBtn').addEventListener('click', () => { const on = $('chPanel').hidden; $('chPanel').hidden = !on; $('chBtn').setAttribute('aria-expanded', String(on)); if (!on) { cancelDraw(); stopEdit(); } });
  $('chClose').addEventListener('click', () => { $('chPanel').hidden = true; $('chBtn').setAttribute('aria-expanded', 'false'); cancelDraw(); stopEdit(); });
  $('chList').addEventListener('input', e => { const li = e.target.closest('li'); if (!li || !e.target.classList.contains('ch-name')) return; const z = zones.find(q => q.id === li.dataset.id); if (z) { z.name = e.target.value.trim() || TYPES[z.type].label; save(); render(); } });
  $('chList').addEventListener('change', e => { const li = e.target.closest('li'); if (!li || !e.target.classList.contains('ch-ty')) return; const z = zones.find(q => q.id === li.dataset.id); if (z) { z.type = e.target.value; save(); render(); list(); } });
  $('chList').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return; const z = zones.find(q => q.id === li.dataset.id), a = e.target.dataset.a;
    if (!a) { if (!e.target.closest('input,select')) select(li.dataset.id, false); return; }
    if (a === 'go') { select(z.id, false); map.fitBounds(L.latLngBounds(z.pts).pad(.6), { maxZoom: 19 }); }
    else if (a === 'edit') { if (edit === z.id) stopEdit(); else startEdit(z.id); }
    else if (a === 'del') {
      if (e.target.dataset.sure) { zones = zones.filter(q => q.id !== z.id); if (edit === z.id) stopEdit(); save(); sel = null; render(); list(); }
      else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Supprimer'; } }, 3000); }
    }
  });
  addEventListener('keydown', e => {
    if (draw && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelDraw(); }
    else if (draw && e.key === 'Enter') { e.preventDefault(); finishPoly(); }
    else if (draw && e.key === 'Backspace' && !rectMode) { e.preventDefault(); $('chDrawBack').click(); }
    else if (edit && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopEdit(); }
  }, true);
  render(); list();
}
