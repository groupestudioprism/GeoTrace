/* GeoTrace – déviations simples sur la carte 2D : tracé d'un axe, largeur, type, modification, liste.
   Enregistrées dans le navigateur et ajoutées au fichier de calage (chantier.devs). */
const L = window.L;
const $ = id => document.getElementById(id);
const BASE = 'geotrace:devs';
let KEY = BASE;

export const TYPES = {
  vehicule: { label: 'Déviation véhicules', color: '#e0922b', note: 'Chaussée provisoire, flèches, cônes', width: 6 },
  pieton:   { label: 'Cheminement piétons', color: '#2f8f63', note: 'Passage protégé, barrières', width: 1.5 },
  alternat: { label: 'Alternat (feux)',     color: '#8a5fd0', note: 'Un sens à la fois, feux aux extrémités', width: 6 },
  ferme:    { label: 'Route barrée',        color: '#d6402b', note: 'Fermeture, barrières aux extrémités', width: 6 },
};
export const COLORS = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.color]));

let vis = () => true;
let map = null, status = () => {}, stopOthers = () => {}, onChange = () => {};
let devs = [], proj = null, layer = null, show = true, draw = null, edit = null, sel = null, handles = null;
const uid = () => 'd' + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readLocal = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.devs) ? j.devs : null; } catch (e) { return null; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, devs })); } catch (e) { /* stockage indisponible */ } onChange(); };
const clean = d => d && TYPES[d.type] && Array.isArray(d.pts) && d.pts.length >= 2 && d.pts.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
export const getDevs = () => devs.filter(clean);
export const exportData = () => devs.length ? getDevs() : null;
/* Les données locales sont gardées par projet (nom de la maquette) : un autre projet n'hérite pas des phases du précédent. */
export function setScope(name, hasProject) {
  const next = BASE + (name ? ':' + name : '');
  if (next !== BASE) { try { if (localStorage.getItem(next) == null && !hasProject && localStorage.getItem(BASE) != null) { localStorage.setItem(next, localStorage.getItem(BASE)); localStorage.removeItem(BASE); } } catch (e) { /* ignoré */ } }
  KEY = next;
}
export function setProject(p) {
  proj = p && Array.isArray(p.devs) ? p.devs : null;
  devs = readLocal() || (proj ? proj.filter(clean) : []);
  render(); list();
}
function length(pts) {
  const k = Math.PI / 180, R = 6378137; let s = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], c = Math.cos((a[0] + b[0]) / 2 * k); s += Math.hypot((b[0] - a[0]) * k * R, (b[1] - a[1]) * k * R * c); }
  return s;
}
const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m';
const bearing = (a, b) => Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;

/* ---------- affichage ---------- */
function render() {
  if (!map) return;
  if (!layer) layer = L.layerGroup();
  layer.clearLayers();
  if (!show) { map.removeLayer(layer); return; }
  layer.addTo(map);
  getDevs().filter(d => vis(d.id)).forEach(d => {
    const t = TYPES[d.type], on = d.id === sel;
    layer.addLayer(L.polyline(d.pts, { color: '#fff', weight: (on ? 9 : 7), opacity: .9, interactive: false }));
    const line = L.polyline(d.pts, { color: t.color, weight: on ? 6 : 4.5, dashArray: d.type === 'ferme' ? '2 9' : d.type === 'pieton' ? '1 8' : null, lineCap: d.type === 'pieton' || d.type === 'ferme' ? 'round' : 'butt', bubblingMouseEvents: false });
    line.on('click', e => { if (draw) return; L.DomEvent.stop(e); if (edit === d.id) addVertex(d, e.latlng); else select(d.id, true); });
    layer.addLayer(line);
    if (d.type !== 'ferme') d.pts.slice(1).forEach((b, i) => { const a = d.pts[i], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang = 90 - bearing(a, b);
      layer.addLayer(L.marker(m, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'dv-arrow', html: `<svg viewBox="0 0 20 20" width="20" height="20" style="transform:rotate(${(-ang).toFixed(1)}deg)"><path d="M3 4l14 6-14 6 4-6z" fill="#fff" stroke="${t.color}" stroke-width="2" stroke-linejoin="round"/></svg>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })); });
    else { const e = d.pts; [e[0], e[e.length - 1]].forEach(p => layer.addLayer(L.circleMarker(p, { radius: 7, color: '#fff', weight: 2, fillColor: t.color, fillOpacity: 1, interactive: false }))); }
    const mid = d.pts[Math.floor((d.pts.length - 1) / 2)], nxt = d.pts[Math.floor((d.pts.length - 1) / 2) + 1] || mid;
    layer.addLayer(L.marker([(mid[0] + nxt[0]) / 2, (mid[1] + nxt[1]) / 2], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'ch-label', html: `<span style="--c:${t.color}">${esc(d.name)}</span>`, iconSize: null }) }));
  });
}
export function select(id, openPanel) {
  sel = id; render(); list();
  if (openPanel) { $('chPanel').hidden = false; $('chBtn').setAttribute('aria-expanded', 'true'); tab('d'); const li = document.querySelector(`#dvList li[data-id="${id}"]`); if (li) li.scrollIntoView({ block: 'nearest' }); }
}
export function tab(k) {
  $('chTabZ').hidden = k !== 'z'; $('chTabD').hidden = k !== 'd'; $('chTabP').hidden = k !== 'p'; $('chTabN').hidden = k !== 'n'; if ($('chTabE')) $('chTabE').hidden = k !== 'e';
  document.querySelectorAll('#chTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
  if (k !== 'd') { cancelDraw(); stopEdit(); }
}

/* ---------- tracé ---------- */
function startDraw(type) {
  cancelDraw(); stopEdit(); stopOthers();
  draw = { type, pts: [], line: L.polyline([], { color: TYPES[type].color, weight: 4, dashArray: '6 5', interactive: false }).addTo(map), dots: L.layerGroup().addTo(map) };
  map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair';
  $('dvDraw').hidden = false; drawText();
  document.querySelectorAll('.dv-type').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
}
function drawText() {
  const n = draw ? draw.pts.length : 0;
  $('dvDrawTxt').textContent = n === 0 ? `${TYPES[draw.type].label} : cliquez le point de départ.` : n === 1 ? 'Cliquez les points suivants du parcours.' : `${n} points, ${fmtLen(length(draw.pts.map(p => [p.lat, p.lng])))}. Double-clic ou « Terminer » pour finir.`;
  $('dvDrawOk').hidden = n < 2; $('dvDrawBack').hidden = n === 0;
}
function preview(cur) { if (draw) draw.line.setLatLngs(cur && draw.pts.length ? [...draw.pts, cur] : draw.pts); }
function onClick(e) {
  if (!draw) return;
  const px = map.latLngToContainerPoint(e.latlng), last = draw.pts.length ? map.latLngToContainerPoint(draw.pts[draw.pts.length - 1]) : null;
  if (last && last.distanceTo(px) < 6) return;
  draw.pts.push(e.latlng); L.circleMarker(e.latlng, { radius: 4, color: '#fff', weight: 2, fillColor: TYPES[draw.type].color, fillOpacity: 1, interactive: false }).addTo(draw.dots);
  preview(); drawText();
}
function finishLine() { if (draw && draw.pts.length >= 2) finish(draw.pts.map(q => [q.lat, q.lng])); }
function finish(pts) {
  const type = draw.type, n = devs.filter(d => d.type === type).length + 1;
  cancelDraw();
  const d = { id: uid(), type, name: n > 1 ? `${TYPES[type].label} ${n}` : TYPES[type].label, width: TYPES[type].width, pts: pts.map(p => [+p[0].toFixed(7), +p[1].toFixed(7)]) };
  devs.push(d); save(); sel = d.id; render(); list();
  status(`${TYPES[type].label} ajoutée : ${fmtLen(length(d.pts))}. Visible en 3D dans « Photos en 3D ».`, { ms: 4000 });
}
export function cancelDraw() {
  if (!draw) return false;
  map.removeLayer(draw.line); map.removeLayer(draw.dots); draw = null;
  map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; $('dvDraw').hidden = true;
  document.querySelectorAll('.dv-type').forEach(b => b.setAttribute('aria-pressed', 'false'));
  return true;
}

/* ---------- modification ---------- */
function startEdit(id) {
  cancelDraw(); stopEdit(); stopOthers(); edit = id; select(id, false);
  const d = devs.find(q => q.id === id); if (!d) return;
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
  const ul = $('dvList'); if (!ul) return;
  const ds = getDevs(); $('dvEmpty').hidden = ds.length > 0;
  ul.innerHTML = ds.map(d => `<li data-id="${esc(d.id)}" class="${d.id === sel ? 'on' : ''}"><div class="ch-row"><i class="ch-sw" style="background:${TYPES[d.type].color}"></i><input class="ch-name" value="${esc(d.name)}" aria-label="Nom de la déviation" maxlength="40"><small>${fmtLen(length(d.pts))}</small></div>
    <div class="ch-acts"><select class="ch-ty" aria-label="Type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${k === d.type ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
    <label class="dv-w">Largeur <input type="number" class="dv-width" min="1" max="20" step=".5" value="${d.width}" aria-label="Largeur en mètres"> m</label></div>
    <div class="ch-acts"><button type="button" class="link" data-a="go">Voir</button><button type="button" class="link" data-a="rev">Inverser le sens</button><button type="button" class="link" data-a="edit">${edit === d.id ? 'Terminer' : 'Modifier'}</button><button type="button" class="link danger" data-a="del">Supprimer</button></div></li>`).join('');
}

export function init(ctx) {
  map = ctx.map; status = ctx.status; stopOthers = ctx.stopOthers || stopOthers; onChange = ctx.onChange || onChange;
  show = ctx.show !== false; if (ctx.visible) vis = ctx.visible;
  devs = readLocal() || (proj ? proj.filter(clean) : []);
  $('dvTypes').innerHTML = Object.entries(TYPES).map(([k, v]) => `<button type="button" class="ch-type dv-type" data-type="${k}" aria-pressed="false" title="${v.note}"><i style="background:${v.color}"></i><b>${v.label}</b></button>`).join('');
  $('dvTypes').addEventListener('click', e => { const b = e.target.closest('.dv-type'); if (b) startDraw(b.dataset.type); });
  $('dvDrawOk').addEventListener('click', finishLine); $('dvDrawNo').addEventListener('click', cancelDraw);
  $('dvDrawBack').addEventListener('click', () => { if (draw && draw.pts.length) { draw.pts.pop(); draw.dots.clearLayers(); draw.pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: TYPES[draw.type].color, fillOpacity: 1, interactive: false }).addTo(draw.dots)); preview(); drawText(); } });
  map.on('click', onClick); map.on('dblclick', e => { if (draw) { L.DomEvent.stop(e); finishLine(); } });
  map.on('mousemove', e => { if (draw && draw.pts.length) preview(e.latlng); });
  $('dvList').addEventListener('input', e => { const li = e.target.closest('li'); if (!li) return; const d = devs.find(q => q.id === li.dataset.id); if (!d) return;
    if (e.target.classList.contains('ch-name')) { d.name = e.target.value.trim() || TYPES[d.type].label; save(); render(); }
    else if (e.target.classList.contains('dv-width')) { const w = parseFloat(e.target.value); if (w >= 1 && w <= 20) { d.width = w; save(); } } });
  $('dvList').addEventListener('change', e => { const li = e.target.closest('li'); if (!li || !e.target.classList.contains('ch-ty')) return; const d = devs.find(q => q.id === li.dataset.id); if (d) { d.type = e.target.value; d.width = TYPES[d.type].width; save(); render(); list(); } });
  $('dvList').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return; const d = devs.find(q => q.id === li.dataset.id), a = e.target.dataset.a;
    if (!a) { if (!e.target.closest('input,select,label')) select(li.dataset.id, false); return; }
    if (a === 'go') { select(d.id, false); map.fitBounds(L.latLngBounds(d.pts).pad(.6), { maxZoom: 19 }); }
    else if (a === 'rev') { d.pts.reverse(); save(); if (edit === d.id) startEdit(d.id); else { render(); list(); } }
    else if (a === 'edit') { if (edit === d.id) stopEdit(); else startEdit(d.id); }
    else if (a === 'del') {
      if (e.target.dataset.sure) { devs = devs.filter(q => q.id !== d.id); if (edit === d.id) stopEdit(); save(); sel = null; render(); list(); }
      else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Supprimer'; } }, 3000); }
    }
  });
  addEventListener('keydown', e => {
    if (draw && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelDraw(); }
    else if (draw && e.key === 'Enter') { e.preventDefault(); finishLine(); }
    else if (draw && e.key === 'Backspace') { e.preventDefault(); $('dvDrawBack').click(); }
    else if (edit && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopEdit(); }
  }, true);
  render(); list();
}
export const refresh = () => render();
export const setShow = v => { show = v; render(); };
export const stop = () => { cancelDraw(); stopEdit(); };
