/* GeoTrace – situations de chantier : engins, camions, véhicules et personnel posés sur la carte à leur taille réelle.
   Modèles 3D légers (assets/models/*.glb, chargés à la demande). Gardés dans le navigateur et ajoutés au fichier de calage (chantier.eng). */
import * as K from './rigkin.js';
import * as A from './art.js';
const L = window.L;
const $ = id => document.getElementById(id);
const BASE = 'geotrace:engins';
const MODELS_URL = 'assets/models/';
let KEY = BASE;

let vis = () => true;
let map = null, status = () => {}, stopOthers = () => {}, onChange = () => {};
let items = [], proj = null, layer = null, show = true, place = null, sel = null, cat = null;
const selListeners = [];
const setSel = id => { sel = id; selListeners.forEach(f => { try { f(id); } catch (e) { /* écouteur en défaut */ } }); };
const uid = () => 'e' + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readLocal = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.items) ? j.items : null; } catch (e) { return null; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, items })); } catch (e) { /* stockage indisponible */ } onChange(); };
const model = id => cat && cat.models.find(m => m.id === id);
const rigOf = id => { const m = model(id); return m && m.rig || null; };
/* Engins à pièces mobiles (benne, cuve, roues directrices) : définis dans le catalogue, sans pelle articulée. */
const artOf = id => { const m = model(id); return m && !m.rig && m.art ? m.art : null; };
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = c => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const clean = e => e && typeof e.m === 'string' && Array.isArray(e.pt) && Number.isFinite(e.pt[0]) && Number.isFinite(e.pt[1]);
const norm = e => ({ id: e.id || uid(), m: e.m, name: String(e.name || ''), pt: [+(+e.pt[0]).toFixed(7), +(+e.pt[1]).toFixed(7)], rot: ((Math.round(+e.rot || 0) % 360) + 360) % 360,
  ...(rigOf(e.m) ? { art: e.art !== false, p: K.clampP(e.p), col: /^#[0-9a-f]{6}$/i.test(e.col || '') ? e.col : '' } : artOf(e.m) ? { p: A.clamp(artOf(e.m), e.p) } : {}) });
export const getEngins = () => items.filter(clean).map(norm);
/* Pour la vue 3D : ajoute le décalage d'orientation propre à chaque modèle (l'avant visé à 0° = nord). */
export const getEngins3d = () => getEngins().map(e => { const m = model(e.m) || {}, r = m.rig && e.art ? m.rig : null, a = artOf(e.m), d = r ? K.footprint(r) : m;
  return { ...e, off: r ? 0 : m.off || 0, rig: r, col: e.col ? hex2rgb(e.col) : null, parts: a ? m.parts : null, partsDef: a || null, dims: [d.w || 2, d.l || 4] }; });
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

/* Dimensions affichées sur la carte : la partie basse de la pelle articulée, ou le modèle figé tel quel. */
const dimsOf = (e, m) => { const r = rigOf(e.m); return r && e.art ? K.footprint(r) : m; };
const dest = (pt, brg, d) => { const k = Math.PI / 180, R = 6378137, a = brg * k; return [pt[0] + Math.cos(a) * d / (k * R), pt[1] + Math.sin(a) * d / (k * R * Math.cos(pt[0] * k))]; };

function render() {
  if (!map) return;
  if (!layer) layer = L.layerGroup();
  layer.clearLayers();
  if (!show) { map.removeLayer(layer); return; }
  layer.addTo(map);
  getEngins().filter(e => vis(e.id)).forEach(e => {
    const m = model(e.m); if (!m) return;
    const on = e.id === sel, col = on ? '#d6402b' : '#0b2342', d = dimsOf(e, m), r = rigOf(e.m);
    const poly = L.polygon(footprint(e, d), { color: col, weight: on ? 3 : 2, fillColor: '#f2b705', fillOpacity: .55, bubblingMouseEvents: false });
    poly.on('click', ev => { if (place) return; L.DomEvent.stop(ev); select_(e.id, true); });
    layer.addLayer(poly);
    // flèche d'avant (l'avant du modèle est vers le haut à 0°)
    layer.addLayer(L.polygon(local(e, [[-d.w * .28, d.l / 2 - .05], [d.w * .28, d.l / 2 - .05], [0, d.l / 2 + Math.min(1.2, d.w * .45)]]), { color: col, weight: 1, fillColor: col, fillOpacity: .9, interactive: false }));
    if (r && e.art) {
      // portée du godet : direction de la tourelle, cercle de balayage à la portée actuelle (et portée maximale pour l'engin choisi)
      const k = K.kin(r, e.p), br = e.rot + e.p.sw, tip = dest(e.pt, br, Math.max(0, k.reach));
      layer.addLayer(L.polyline([e.pt, tip], { color: '#d6402b', weight: 3, interactive: false }));
      layer.addLayer(L.circleMarker(tip, { radius: 4, color: '#fff', weight: 1.5, fillColor: '#d6402b', fillOpacity: 1, interactive: false }));
      if (Math.abs(k.reach) > .3) layer.addLayer(L.circle(e.pt, { radius: Math.abs(k.reach), color: '#d6402b', weight: 1.2, dashArray: '4 6', fill: false, interactive: false }));
      if (on) layer.addLayer(L.circle(e.pt, { radius: K.limits(r).reach, color: '#0b2342', weight: 1, dashArray: '2 7', fill: false, interactive: false }));
    }
    const mk = L.marker(e.pt, { draggable: true, keyboard: false, title: 'Glisser pour déplacer', icon: L.divIcon({ className: 'ch-label eg-label', html: `<span style="--c:#f2b705">${esc(e.name || m.name)}</span>`, iconSize: null }) });
    mk.on('dragend', ev => { const it = items.find(q => q.id === e.id); if (it) { it.pt = [ev.target.getLatLng().lat, ev.target.getLatLng().lng]; save(); render(); list(); } });
    mk.on('click', ev => { L.DomEvent.stop(ev); select_(e.id, true); });
    layer.addLayer(mk);
  });
}
function select_(id, openPanel) {
  setSel(id); render(); list();
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
  items.push(e); save(); setSel(e.id); render(); list();
  status(`${m.name} posé (${m.l.toString().replace('.', ',')} × ${m.w.toString().replace('.', ',')} m). Réglez son orientation dans la liste ; cliquez de nouveau pour en poser un autre.`, { ms: 5000 });
}

/* ---------- liste ---------- */
function palette() {
  if (!cat) return;
  $('egTypes').innerHTML = Object.entries(cat.cats).map(([k, label]) => `<h3 class="eg-h">${label}</h3><div class="ch-types">${cat.models.filter(m => m.cat === k).map(m => `<button type="button" class="ch-type eg-m" data-m="${m.id}" aria-pressed="false" title="${m.l.toString().replace('.', ',')} × ${m.w.toString().replace('.', ',')} m, h ${m.h.toString().replace('.', ',')} m"><i style="background:#f2b705"></i><b>${esc(m.name)}</b></button>`).join('')}</div>`).join('');
}
function ctl(e, r) {
  const p = e.p, k = K.kin(r, p), lim = K.limits(r), f = K.fmt;
  const rng = key => `<label class="eg-sl"><span>${K.LABELS[key]}</span><input type="range" class="eg-p" data-k="${key}" min="${K.RANGE[key][0]}" max="${K.RANGE[key][1]}" value="${p[key]}" aria-label="${K.LABELS[key]}"><output>${p[key]}°</output></label>`;
  return `<div class="eg-ctl"><label class="dv-w"><input type="checkbox" class="eg-art"${e.art ? ' checked' : ''}> Pelle articulée</label>
    ${e.art ? `<label class="dv-w">Couleur <input type="color" class="eg-col" value="${e.col || rgb2hex(r.color)}" aria-label="Couleur de la pelle"></label>
    <div class="eg-pre">${K.PRESETS.map((q, i) => `<button type="button" class="link" data-a="pre" data-i="${i}">${q.label}</button>`).join('')}</div>
    ${rng('sw')}${rng('bm')}${rng('st')}${rng('bk')}
    <div class="eg-svg">${K.sideSvg(r, p)}</div>
    <small class="eg-rd">Portée du godet ${f(k.reach)} m · hauteur de la dent ${f(k.depth)} m<br>Portée maximale ${f(lim.reach)} m · profondeur maximale ${f(-lim.depth)} m</small>` : '<small>Modèle détaillé figé, sans mouvement.</small>'}</div>`;
}
/* Commandes d'un engin à pièces mobiles : poses types et curseurs décrits par le catalogue. */
function ctlArt(e, a) {
  const rng = q => `<label class="eg-sl"><span>${esc(q.label)}</span><input type="range" class="eg-p" data-k="${q.k}" min="${q.min}" max="${q.max}" value="${e.p[q.k]}" aria-label="${esc(q.label)}"><output>${e.p[q.k]}°</output></label>`;
  return `<div class="eg-ctl"><div class="eg-pre">${a.presets.map((q, i) => `<button type="button" class="link" data-a="pre" data-i="${i}">${esc(q.label)}</button>`).join('')}</div>${a.params.map(rng).join('')}</div>`;
}
function list() {
  const ul = $('egList'); if (!ul) return;
  const es = getEngins(); $('egEmpty').hidden = es.length > 0;
  ul.innerHTML = es.map(e => { const m = model(e.m), r = rigOf(e.m); return `<li data-id="${e.id}" class="${e.id === sel ? 'on' : ''}"><div class="ch-row"><i class="ch-sw" style="background:#f2b705"></i><input class="ch-name" value="${esc(e.name)}" aria-label="Nom" maxlength="40"><small>${m ? m.l.toString().replace('.', ',') + ' m' : ''}</small></div>
    <div class="ch-acts"><label class="dv-w">Orientation <input type="range" class="eg-rot" min="0" max="359" value="${e.rot}" aria-label="Orientation en degrés depuis le nord"> <output>${e.rot}°</output></label></div>
    ${e.id === sel ? (r ? ctl(e, r) : artOf(e.m) ? ctlArt(e, artOf(e.m)) : '') : ''}
    <div class="ch-acts"><button type="button" class="link" data-a="go">Voir</button><button type="button" class="link" data-a="turn">Tourner de 90°</button><button type="button" class="link" data-a="dup">Dupliquer</button><button type="button" class="link danger" data-a="del">Supprimer</button></div></li>`; }).join('');
}

/* Met à jour le schéma et les portées sans reconstruire la liste (le curseur glissé reste actif). */
function refreshRead(li, it) {
  const r = rigOf(it.m), n = getEngins().find(q => q.id === it.id); if (!r || !n) return;
  const sv = li.querySelector('.eg-svg'), rd = li.querySelector('.eg-rd'), k = K.kin(r, n.p), lim = K.limits(r);
  if (sv) sv.innerHTML = K.sideSvg(r, n.p);
  if (rd) rd.innerHTML = `Portée du godet ${K.fmt(k.reach)} m · hauteur de la dent ${K.fmt(k.depth)} m<br>Portée maximale ${K.fmt(lim.reach)} m · profondeur maximale ${K.fmt(-lim.depth)} m`;
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
    else if (e.target.classList.contains('eg-p')) { const a = artOf(it.m), k = e.target.dataset.k; it.p = a ? A.clamp(a, { ...it.p, [k]: +e.target.value }) : K.clampP({ ...K.clampP(it.p), [k]: +e.target.value }); e.target.parentNode.querySelector('output').textContent = it.p[k] + '°'; save(); render(); refreshRead(li, it); }
    else if (e.target.classList.contains('eg-col')) { it.col = e.target.value; save(); render(); refreshRead(li, it); }
    else if (e.target.classList.contains('eg-rot')) { it.rot = +e.target.value; e.target.parentNode.querySelector('output').textContent = it.rot + '°'; save(); render(); } });
  $('egList').addEventListener('change', e => { if (!e.target.classList.contains('eg-art')) return; const li = e.target.closest('li'), it = items.find(q => q.id === li.dataset.id); if (!it) return; it.art = e.target.checked; save(); render(); list(); });
  $('egList').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return; const it = items.find(q => q.id === li.dataset.id), a = e.target.dataset.a;
    if (!a) { if (!e.target.closest('input,label')) select_(li.dataset.id, false); return; }
    if (a === 'pre') { const ar = artOf(it.m); it.p = ar ? A.clamp(ar, { ...it.p, ...ar.presets[+e.target.dataset.i].p }) : K.clampP({ ...K.clampP(it.p), ...K.PRESETS[+e.target.dataset.i].p }); save(); render(); list(); return; }
    if (a === 'go') { select_(it.id, false); map.setView(it.pt, Math.max(map.getZoom(), 20)); }
    else if (a === 'turn') { it.rot = (it.rot + 90) % 360; save(); render(); list(); }
    else if (a === 'dup') { const c = norm({ ...it, id: uid(), pt: [it.pt[0] + 0.00003, it.pt[1] + 0.00003] }); items.push(c); save(); setSel(c.id); render(); list(); }
    else if (a === 'del') {
      if (e.target.dataset.sure) { items = items.filter(q => q.id !== it.id); save(); setSel(null); render(); list(); }
      else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Supprimer'; } }, 3000); }
    }
  });
  addEventListener('keydown', e => { if (place && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelPlace(); } }, true);
  render(); list();
}
export const refresh = () => render();
export const select = select_;
export const onSelect = f => selListeners.push(f);
export const selected = () => sel;
/* Déplacement par glisser dans la vue 3D. */
export function moveTo(id, lat, lon) { const it = items.find(q => q.id === id); if (!it) return; it.pt = [lat, lon]; save(); render(); list(); }
export const setShow = v => { show = v; render(); };
export const stop = () => { cancelPlace(); };
