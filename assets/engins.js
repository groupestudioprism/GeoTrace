/* GeoTrace – situations de chantier : engins, camions, véhicules et personnel posés sur la carte à leur taille réelle.
   Modèles 3D légers (assets/models/*.glb, chargés à la demande). Gardés dans le navigateur et ajoutés au fichier de calage (chantier.eng). */
const L = window.L;
const $ = id => document.getElementById(id);
const BASE = 'geotrace:engins';
const MODELS_URL = 'assets/models/';
let KEY = BASE;

let vis = () => true;
let map = null, status = () => {}, stopOthers = () => {}, onChange = () => {};
let items = [], proj = null, layer = null, show = true, place = null, sel = null, cat = null;
const uid = () => 'e' + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readLocal = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.items) ? j.items : null; } catch (e) { return null; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, items })); } catch (e) { /* stockage indisponible */ } onChange(); };
const model = id => cat && cat.models.find(m => m.id === id);
const clean = e => e && typeof e.m === 'string' && Array.isArray(e.pt) && Number.isFinite(e.pt[0]) && Number.isFinite(e.pt[1]);
const norm = e => ({ id: e.id || uid(), m: e.m, name: String(e.name || ''), pt: [+(+e.pt[0]).toFixed(7), +(+e.pt[1]).toFixed(7)], rot: ((Math.round(+e.rot || 0) % 360) + 360) % 360 });
export const getEngins = () => items.filter(clean).map(norm);
/* Pour la vue 3D : ajoute le décalage d'orientation propre à chaque modèle (l'avant visé à 0° = nord). */
export const getEngins3d = () => getEngins().map(e => ({ ...e, off: (model(e.m) || {}).off || 0 }));
export const exportData = () => items.length ? getEngins() : null;
export const MODELS_BASE = MODELS_URL;
export const loadCatalogue = () => cat ? Promise.resolve(cat) : fetch(MODELS_URL + 'catalogue.json').then(r => r.json()).then(j => { cat = j; return j; });

export function setScope(name, hasProject) {
  const next = BASE + (name ? ':' + name : '');
  if (next !== BASE) { try { if (localStorage.getItem(next) == null && !hasProject && localStorage.getItem(BASE) != null) { localStorage.setItem(next, localStorage.getItem(BASE)); localStorage.removeItem(BASE); } } catch (e) { /* ignoré */ } }
  KEY = next;
}
export function setProject(p) {
  proj = Array.isArray(p) ? p : null;
  items = readLocal() || (proj ? proj.filter(clean).map(norm) : []);
  render(); list();
}

/* ---------- géométrie : rectangle réel de l'engin, tourné de rot degrés (sens horaire depuis le nord) ---------- */
function local(e, pts) {
  const k = Math.PI / 180, R = 6378137, la = e.pt[0], dLat = 1 / (k * R), dLon = 1 / (k * R * Math.cos(la * k));
  const a = e.rot * k, s = Math.sin(a), c = Math.cos(a);
  return pts.map(([x, y]) => [la + (y * c - x * s) * dLat, e.pt[1] + (y * s + x * c) * dLon]);
}
const footprint = (e, m) => local(e, [[-m.w / 2, -m.l / 2], [m.w / 2, -m.l / 2], [m.w / 2, m.l / 2], [-m.w / 2, m.l / 2]]);

function render() {
  if (!map) return;
  if (!layer) layer = L.layerGroup();
  layer.clearLayers();
  if (!show) { map.removeLayer(layer); return; }
  layer.addTo(map);
  getEngins().filter(e => vis(e.id)).forEach(e => {
    const m = model(e.m); if (!m) return;
    const on = e.id === sel, col = on ? '#d6402b' : '#0b2342';
    const poly = L.polygon(footprint(e, m), { color: col, weight: on ? 3 : 2, fillColor: '#f2b705', fillOpacity: .55, bubblingMouseEvents: false });
    poly.on('click', ev => { if (place) return; L.DomEvent.stop(ev); select(e.id, true); });
    layer.addLayer(poly);
    // flèche d'avant (l'avant du modèle est vers le haut à 0°)
    layer.addLayer(L.polygon(local(e, [[-m.w * .28, m.l / 2 - .05], [m.w * .28, m.l / 2 - .05], [0, m.l / 2 + Math.min(1.2, m.w * .45)]]), { color: col, weight: 1, fillColor: col, fillOpacity: .9, interactive: false }));
    const mk = L.marker(e.pt, { draggable: true, keyboard: false, title: 'Glisser pour déplacer', icon: L.divIcon({ className: 'ch-label eg-label', html: `<span style="--c:#f2b705">${esc(e.name || m.name)}</span>`, iconSize: null }) });
    mk.on('dragend', ev => { const it = items.find(q => q.id === e.id); if (it) { it.pt = [ev.target.getLatLng().lat, ev.target.getLatLng().lng]; save(); render(); list(); } });
    mk.on('click', ev => { L.DomEvent.stop(ev); select(e.id, true); });
    layer.addLayer(mk);
  });
}
function select(id, openPanel) {
  sel = id; render(); list();
  if (openPanel) { $('chPanel').hidden = false; $('chBtn').setAttribute('aria-expanded', 'true'); tab('e'); const li = document.querySelector(`#egList li[data-id="${id}"]`); if (li) li.scrollIntoView({ block: 'nearest' }); }
}
export function tab(k) {
  ['Z', 'D', 'P', 'N', 'E'].forEach(t => { const el = $('chTab' + t); if (el) el.hidden = k !== t.toLowerCase(); });
  document.querySelectorAll('#chTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
  if (k !== 'e') cancelPlace();
}

/* ---------- pose d'un engin ---------- */
function startPlace(id) {
  cancelPlace(); stopOthers();
  place = id; map.getContainer().style.cursor = 'crosshair';
  const m = model(id); $('egDraw').hidden = false; $('egDrawTxt').textContent = `${m.name} : cliquez sur la carte pour le poser.`;
  document.querySelectorAll('.eg-m').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === id)));
}
export function cancelPlace() {
  if (!place) return false;
  place = null; map.getContainer().style.cursor = ''; $('egDraw').hidden = true;
  document.querySelectorAll('.eg-m').forEach(b => b.setAttribute('aria-pressed', 'false'));
  return true;
}
function onClick(ev) {
  if (!place) return;
  const m = model(place), n = items.filter(q => q.m === place).length + 1;
  const e = norm({ id: uid(), m: place, name: n > 1 ? `${m.name} ${n}` : m.name, pt: [ev.latlng.lat, ev.latlng.lng], rot: 0 });
  items.push(e); save(); sel = e.id; render(); list();
  status(`${m.name} posé (${m.l.toString().replace('.', ',')} × ${m.w.toString().replace('.', ',')} m). Réglez son orientation dans la liste ; cliquez de nouveau pour en poser un autre.`, { ms: 5000 });
}

/* ---------- liste ---------- */
function palette() {
  if (!cat) return;
  $('egTypes').innerHTML = Object.entries(cat.cats).map(([k, label]) => `<h3 class="eg-h">${label}</h3><div class="ch-types">${cat.models.filter(m => m.cat === k).map(m => `<button type="button" class="ch-type eg-m" data-m="${m.id}" aria-pressed="false" title="${m.l.toString().replace('.', ',')} × ${m.w.toString().replace('.', ',')} m, h ${m.h.toString().replace('.', ',')} m"><i style="background:#f2b705"></i><b>${esc(m.name)}</b></button>`).join('')}</div>`).join('');
}
function list() {
  const ul = $('egList'); if (!ul) return;
  const es = getEngins(); $('egEmpty').hidden = es.length > 0;
  ul.innerHTML = es.map(e => { const m = model(e.m); return `<li data-id="${e.id}" class="${e.id === sel ? 'on' : ''}"><div class="ch-row"><i class="ch-sw" style="background:#f2b705"></i><input class="ch-name" value="${esc(e.name)}" aria-label="Nom" maxlength="40"><small>${m ? m.l.toString().replace('.', ',') + ' m' : ''}</small></div>
    <div class="ch-acts"><label class="dv-w">Orientation <input type="range" class="eg-rot" min="0" max="359" value="${e.rot}" aria-label="Orientation en degrés depuis le nord"> <output>${e.rot}°</output></label></div>
    <div class="ch-acts"><button type="button" class="link" data-a="go">Voir</button><button type="button" class="link" data-a="turn">Tourner de 90°</button><button type="button" class="link" data-a="dup">Dupliquer</button><button type="button" class="link danger" data-a="del">Supprimer</button></div></li>`; }).join('');
}

export function init(ctx) {
  map = ctx.map; status = ctx.status; stopOthers = ctx.stopOthers || stopOthers; onChange = ctx.onChange || onChange;
  show = ctx.show !== false; if (ctx.visible) vis = ctx.visible;
  items = readLocal() || (proj ? proj.filter(clean).map(norm) : []);
  loadCatalogue().then(() => { palette(); render(); list(); }).catch(e => { console.warn('catalogue engins', e); $('egTypes').innerHTML = '<p class="hint">Catalogue indisponible hors connexion.</p>'; });
  $('egTypes').addEventListener('click', e => { const b = e.target.closest('.eg-m'); if (b) startPlace(b.dataset.m); });
  $('egDrawNo').addEventListener('click', cancelPlace);
  map.on('click', onClick);
  $('egList').addEventListener('input', e => { const li = e.target.closest('li'); if (!li) return; const it = items.find(q => q.id === li.dataset.id); if (!it) return;
    if (e.target.classList.contains('ch-name')) { it.name = e.target.value.trim(); save(); render(); }
    else if (e.target.classList.contains('eg-rot')) { it.rot = +e.target.value; e.target.parentNode.querySelector('output').textContent = it.rot + '°'; save(); render(); } });
  $('egList').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return; const it = items.find(q => q.id === li.dataset.id), a = e.target.dataset.a;
    if (!a) { if (!e.target.closest('input,label')) select(li.dataset.id, false); return; }
    if (a === 'go') { select(it.id, false); map.setView(it.pt, Math.max(map.getZoom(), 20)); }
    else if (a === 'turn') { it.rot = (it.rot + 90) % 360; save(); render(); list(); }
    else if (a === 'dup') { const c = norm({ ...it, id: uid(), pt: [it.pt[0] + 0.00003, it.pt[1] + 0.00003] }); items.push(c); save(); sel = c.id; render(); list(); }
    else if (a === 'del') {
      if (e.target.dataset.sure) { items = items.filter(q => q.id !== it.id); save(); sel = null; render(); list(); }
      else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Supprimer'; } }, 3000); }
    }
  });
  addEventListener('keydown', e => { if (place && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelPlace(); } }, true);
  render(); list();
}
export const refresh = () => render();
export const setShow = v => { show = v; render(); };
export const stop = () => { cancelPlace(); };
