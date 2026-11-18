/* GeoTrace – carte des photos de chantier géolocalisées.
   Tout est lu dans le navigateur : les photos ne sont jamais envoyées. */
(() => {
'use strict';

const VERSION = '1.32.1';
const CFG = Object.assign({ nextcloud: '', maquette: '', maquetteLien: '', maxDepth: 3, concurrency: 4 }, window.GEOTRACE_CONFIG || {});

/* ================= Utilitaires ================= */
const $ = id => document.getElementById(id);
const IMG_RE = /\.(jpe?g|heic|heif|tiff?|png|webp)$/i;
const MODEL_RE = /\.(ifc|glb|gltf)$/i, CAL_RE = /\.geotrace\.json$/i;
const DEV = { phone: 'Téléphone', tab: 'Tablette', drone: 'Drone' };
const COLORS = { phone: '#f26b1d', tab: '#0fa37f', drone: '#7b4fd6' };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif' };
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmtDate = d => d ? d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'date inconnue';
const fmtDay = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmt = (n, digits = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const cardinal = h => CARD[Math.round(h / 22.5) % 16];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
};
/* La maquette est gardée dans le navigateur : on n'a pas à la réimporter à chaque visite. */
const idbOpen = () => new Promise((res, rej) => {
  const r = indexedDB.open('geotrace', 2);
  r.onupgradeneeded = () => { const db = r.result; for (const n of ['maquette', 'session']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function idbDo(mode, fn) { const db = await idbOpen(); return new Promise((res, rej) => { const q = fn(db.transaction('maquette', mode).objectStore('maquette')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
const idbSet = rec => idbDo('readwrite', s => s.put(rec, 'derniere')).catch(e => console.warn('maquette non mémorisée', e));
const idbDel = () => idbDo('readwrite', s => s.delete('derniere')).catch(() => {});
const idbGet = () => idbDo('readonly', s => s.get('derniere')).catch(() => null);

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const IC = {
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  pin: '<path d="M12 21s-6-5.6-6-10a6 6 0 1112 0c0 4.4-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  zone: '<path d="M5 7l8-3 6 6-3 9-10-1z"/><circle cx="5" cy="7" r="1.3"/><circle cx="13" cy="4" r="1.3"/><circle cx="19" cy="10" r="1.3"/><circle cx="16" cy="19" r="1.3"/><circle cx="6" cy="18" r="1.3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
  zip: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M12 3v4h2M12 10h2m-2 3h2m-2 3h2"/>',
  star: '<path d="m12 3.5 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8L12 3.5Z"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  ruler: '<path d="m3.5 16.5 13-13 4 4-13 13-4-4Z"/><path d="m7 10 2 2m1-5 2 2m1-5 2 2"/>',
  locate: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3"/><circle cx="12" cy="12" r="8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  prev: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-9.5h.01"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m12 12 8-4.5M12 12v9M12 12 4 7.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
};
const icon = (n, size) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"${size ? ` style="width:${size}px;height:${size}px"` : ''}>${IC[n]}</svg>`;
function paintIcons(root = document) { root.querySelectorAll('[data-ic]').forEach(el => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic)); }); }
paintIcons();

/* Lambert-93 (EPSG:2154) : coordonnées de travail pour les réseaux en France métropolitaine. */
const L93 = (() => {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2), r = Math.PI / 180;
  const m = p => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const t = p => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
  const p0 = 46.5 * r, p1 = 44 * r, p2 = 49 * r, l0 = 3 * r;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * Math.pow(t(p1), n));
  const r0 = a * F * Math.pow(t(p0), n);
  const inFrance = (lat, lon) => lat > 41 && lat < 52 && lon > -6 && lon < 10;
  return {
    inFrance,
    to(lat, lon) {
      const R = a * F * Math.pow(t(lat * r), n), th = n * (lon * r - l0);
      return { x: 700000 + R * Math.sin(th), y: 6600000 + r0 - R * Math.cos(th) };
    },
  };
})();
const fmtL93 = (lat, lon) => { if (!L93.inFrance(lat, lon)) return null; const p = L93.to(lat, lon); return `X ${Math.round(p.x).toLocaleString('fr-FR')}  Y ${Math.round(p.y).toLocaleString('fr-FR')}`; };

/* ================= État ================= */
const prefs = Object.assign({ base: 'ortho', cadastre: false, thumbs: false, cones: true, track: false, cluster: true, addr: true, panel: true }, store.get('geotrace:prefs', {}));
const savePrefs = () => store.set('geotrace:prefs', prefs);
const marks = store.get('geotrace:marks', {}); // { clé de photo: { fav, note } }
const saveMarks = debounce(() => store.set('geotrace:marks', marks), 400);

let photos = [];
let uid = 0;
let selectedId = null;
let objectUrls = [];
const markers = new Map();
const rowEls = new Map();
const filters = { dev: { phone: true, tab: true, drone: true }, fav: false, q: '', from: null, to: null };
let visibleCache = [];

const keyOf = p => p.kind === 'remote' ? 'r:' + p.path : `l:${p.name}|${p.blob ? p.blob.size : 0}|${p.date ? +p.date : ''}`;
const markOf = p => marks[p.key] || (marks[p.key] = {});
const isFav = p => !!(marks[p.key] && marks[p.key].fav);
const noteOf = p => (marks[p.key] && marks[p.key].note) || '';
function tidyMark(p) { const m = marks[p.key]; if (m && !m.fav && !m.note) delete marks[p.key]; }

/* ================= Messages ================= */
let toastTimer;
function status(text, opts = {}) {
  clearTimeout(toastTimer);
  const t = $('toast');
  t.hidden = !text;
  $('toastText').textContent = text || '';
  const bar = $('toastBar');
  bar.hidden = opts.pct == null;
  if (opts.pct != null) bar.firstElementChild.style.width = Math.round(opts.pct * 100) + '%';
  if (text && opts.ms) toastTimer = setTimeout(() => status(''), opts.ms);
}
const showWelcome = on => { document.body.classList.toggle('on-welcome', !!on); $('welcome').hidden = !on; $('welClose').hidden = !(on && photos.length); if (on) drawContours(); };

/* ================= Carte ================= */
const map = L.map('map', { zoomControl: true, zoomSnap: 0.5, worldCopyJump: false }).setView([47.2, 2.4], 6);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
map.zoomControl.setPosition('topleft');

const WMTS = (layer, fmtImg, style = 'normal') => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmtImg}`;
const BASES = {
  ortho: () => L.tileLayer(WMTS('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxZoom: 21, maxNativeZoom: 19, attribution: '© IGN' }),
  plan: () => L.tileLayer(WMTS('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 21, maxNativeZoom: 19, attribution: '© IGN' }),
};
let baseLayer;
function setBase(k) {
  if (!BASES[k]) k = 'ortho'; // anciens choix « plan clair / sombre » retirés
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[k]().addTo(map); baseLayer.bringToBack();
  prefs.base = k; savePrefs();
  document.querySelectorAll('input[name=base]').forEach(r => { r.checked = r.value === k; });
}
const cadastre = L.tileLayer(WMTS('CADASTRALPARCELS.PARCELLAIRE_EXPRESS', 'image/png', 'PCI%20vecteur'), { maxZoom: 21, maxNativeZoom: 19, opacity: .85, attribution: '© IGN cadastre' });

const trackLayer = L.polyline([], { color: '#12b5f0', weight: 3, opacity: .9, dashArray: '8 7', interactive: false });
let group = null; // featureGroup ou markerClusterGroup
function makeGroup() {
  if (group) map.removeLayer(group);
  group = prefs.cluster
    ? L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 46, disableClusteringAtZoom: 19, spiderfyOnMaxZoom: true, chunkedLoading: true,
      iconCreateFunction: c => {
        const n = c.getChildCount(), size = n < 10 ? 36 : n < 100 ? 42 : 50;
        return L.divIcon({ html: `<div>${n}</div>`, className: 'cl' + (n >= 100 ? ' xl' : n >= 10 ? ' big' : ''), iconSize: [size, size] });
      },
    })
    : L.featureGroup();
  group.addTo(map);
}

/* Direction de prise de vue : le cap EXIF (GPSImgDirection) est en degrés depuis le nord, sens horaire.
   Le cône est dessiné vers le haut (nord) puis tourné de « cap » degrés : 90° est, 180° sud, 270° ouest. */
function markerIcon(p, sel) {
  const c = COLORS[p.dev];
  const fav = isFav(p);
  const cone = prefs.cones && p.heading != null
    ? `<g transform="rotate(${p.heading.toFixed(1)})"><path d="M0 0 L-13 -32 A34 34 0 0 1 13 -32 Z" fill="${c}" fill-opacity="${sel ? .6 : .36}" stroke="${c}" stroke-width="1.2"/><line x1="0" y1="0" x2="0" y2="-34" stroke="${c}" stroke-width="2"/></g>`
    : '';
  const thumb = prefs.thumbs && p.thumb;
  const ring = sel ? '#04264b' : fav ? '#f2b01d' : '#fff';
  const body = thumb
    ? `<defs><clipPath id="cp${p.id}"><circle r="15"/></clipPath></defs><circle r="18" fill="${ring}"/><circle r="16.5" fill="${c}"/><image href="${esc(p.thumb)}" x="-15" y="-15" width="30" height="30" preserveAspectRatio="xMidYMid slice" clip-path="url(#cp${p.id})"/>`
    : `<circle r="${p.dev === 'drone' ? 8.5 : 7.5}" fill="${c}" stroke="${ring}" stroke-width="${sel || fav ? 3.5 : 2.5}"/>`;
  return L.divIcon({ className: 'mk', iconSize: [96, 96], iconAnchor: [48, 48], popupAnchor: [0, thumb ? -20 : -10],
    html: `<svg width="96" height="96" viewBox="-48 -48 96 96">${cone}${body}</svg>` });
}
function compassSvg(h) {
  if (h == null) return '';
  return `<svg class="compass" width="44" height="44" viewBox="-22 -22 44 44" role="img" aria-label="Cap ${Math.round(h)} degrés">
    <circle r="20" fill="#f1f5fa" stroke="#d6dfeb"/>
    <text y="-11" text-anchor="middle" font-size="8" font-weight="700" fill="#04264b" font-family="Public Sans, sans-serif">N</text>
    <g transform="rotate(${h.toFixed(1)})"><path d="M0 -16 L4 -2 L0 -5 L-4 -2 Z" fill="#f26b1d"/><line x1="0" y1="-4" x2="0" y2="10" stroke="#04264b" stroke-width="1.5"/></g>
    <circle r="2" fill="#04264b"/></svg>`;
}

/* ================= Lecture des métadonnées ================= */
async function readMeta(input) {
  let m = {};
  try { m = await exifr.parse(input, { gps: true, xmp: true, tiff: true, exif: true, mergeOutput: true }) || {}; } catch (e) { m = {}; }
  const make = String(m.Make || ''), model = String(m.Model || '');
  const gimbal = num(m.GimbalPitchDegree);
  const drone = /dji|parrot|autel|skydio/i.test(make) || gimbal != null;
  const tab = /ipad|tab|core-t|rugged/i.test(model);
  // Priorité : cap de l'image (téléphone, tablette), puis lacet de la nacelle, puis cap du drone.
  let heading = num(m.GPSImgDirection), headingSrc = heading != null ? (String(m.GPSImgDirectionRef || 'T').toUpperCase().startsWith('M') ? 'nord magnétique' : 'nord vrai') : null;
  if (heading == null && num(m.GimbalYawDegree) != null) { heading = num(m.GimbalYawDegree); headingSrc = 'nacelle du drone'; }
  if (heading == null && num(m.FlightYawDegree) != null) { heading = num(m.FlightYawDegree); headingSrc = 'cap du drone'; }
  const date = m.DateTimeOriginal instanceof Date ? m.DateTimeOriginal : (m.CreateDate instanceof Date ? m.CreateDate : null);
  return {
    lat: num(m.latitude), lon: num(m.longitude), alt: num(m.GPSAltitude), rel: num(m.RelativeAltitude),
    heading: heading != null ? ((heading % 360) + 360) % 360 : null, headingSrc, pitch: gimbal, f35: num(m.FocalLengthIn35mmFilm), date,
    dev: drone ? 'drone' : tab ? 'tab' : 'phone', model: [make, model].filter(Boolean).join(' '),
  };
}
async function pool(items, n, fn, label) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); done++; if (label) status(`${label} : ${done} sur ${items.length}`, { pct: done / items.length }); }
  }));
}

/* ================= Sources ================= */
function reset(label) {
  objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls = [];
  photos = []; selectedId = null;
  $('srcName').textContent = label; $('srcName').title = label;
  filters.from = filters.to = null; $('dFrom').value = ''; $('dTo').value = '';
}
function register(p) { p.id = 'p' + (++uid); p.key = keyOf(p); photos.push(p); return p; }
async function addLocal(entries) {
  const items = entries.filter(e => IMG_RE.test(e.name));
  const known = new Set(photos.map(p => p.kind === 'local' ? p.name + '|' + (p.blob && p.blob.size) : ''));
  await pool(items, CFG.concurrency, async e => {
    if (known.has(e.name + '|' + e.blob.size)) return; // même fichier déjà chargé
    const meta = await readMeta(e.blob);
    register(Object.assign({ name: e.name, folder: e.folder || '', blob: e.blob, kind: 'local' }, meta));
  }, 'Lecture des photos');
  return items.length;
}
/* Les photos ouvertes sont gardées dans ce navigateur : un rafraîchissement de la page reprend là où on en était. */
async function saveSession() {
  const list = photos.filter(p => p.kind === 'local' && !p.demo && p.blob);
  if (!list.length) return;
  try {
    const total = list.reduce((t, p) => t + p.blob.size, 0), est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (est && est.quota && (est.usage || 0) + total > est.quota * .85) throw new Error('place insuffisante');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    const label = $('srcName').textContent, db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('session', 'readwrite'), st = tx.objectStore('session');
      st.clear(); st.put({ label, n: list.length }, 'meta'); list.forEach((p, i) => st.put({ name: p.name, folder: p.folder, blob: p.blob }, 'p' + i));
      tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error || new Error('écriture annulée'));
    });
    store.set('geotrace:session', { label, n: list.length });
  } catch (e) { console.warn('session non mémorisée', e); store.set('geotrace:session', null); }
}
async function restoreSession() {
  const flag = store.get('geotrace:session', null); if (!flag) return false;
  showWelcome(false); status('Reprise de votre dernière session…');
  try {
    const db = await idbOpen();
    const recs = await new Promise((res, rej) => { const q = db.transaction('session', 'readonly').objectStore('session').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const entries = recs.filter(r => r && r.blob);
    if (!entries.length) throw new Error('session vide');
    reset(flag.label); const n = await addLocal(entries); finish(n); return true;
  } catch (e) { console.warn('session illisible', e); store.set('geotrace:session', null); status(''); showWelcome(true); return false; }
}
async function loadFileList(fileList, label, append) {
  const files = [...fileList];
  if (!files.length) return;
  if (!append) { reset(label); try { history.replaceState(null, '', location.pathname); } catch (e) { /* adresse inchangée */ } }
  showWelcome(false); $('welErr').hidden = true;
  const zips = files.filter(f => /\.zip$/i.test(f.name));
  const imgs = files.filter(f => !/\.zip$/i.test(f.name)).map(f => {
    const rel = f.webkitRelativePath || f._rel || f.name;
    return { name: f.name, folder: rel.split('/').slice(0, -1).join('/'), blob: f };
  });
  const pdfs = files.filter(f => /\.pdf$/i.test(f.name)); if (pdfs.length) { const f = pdfs.find(x => /planning|phasage|calendrier|gantt/i.test(x.name)) || pdfs[0]; setPlan(f, f.name); }
  const extra = { models: files.filter(f => MODEL_RE.test(f.name)), cals: files.filter(f => CAL_RE.test(f.name)) };
  let n = await addLocal(imgs);
  for (const z of zips) n += await loadZip(z, extra);
  finish(n);
  saveSession();
  await autoModel(extra);
}
async function loadZip(file, extra) {
  status('Ouverture du ZIP…');
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch (e) { status('Ce ZIP est illisible. Essayez de le télécharger à nouveau.', { ms: 6000 }); return 0; }
  const ok = f => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name);
  const files = Object.values(zip.files).filter(f => ok(f) && IMG_RE.test(f.name));
  if (extra) for (const f of Object.values(zip.files)) {
    if (!ok(f) || !(MODEL_RE.test(f.name) || CAL_RE.test(f.name))) continue;
    const raw = new File([await f.async('blob')], f.name.split('/').pop());
    (MODEL_RE.test(f.name) ? extra.models : extra.cals).push(raw);
  }
  const entries = []; let k = 0;
  for (const f of files) {
    const raw = await f.async('blob');
    const ext = f.name.split('.').pop().toLowerCase();
    const blob = new Blob([raw], { type: MIME[ext] || 'image/jpeg' }); // le ZIP ne donne pas le type : sans lui l'affichage peut échouer
    status(`Extraction du ZIP : ${++k} sur ${files.length}`, { pct: k / files.length });
    entries.push({ name: f.name.split('/').pop(), folder: f.name.split('/').slice(0, -1).join('/'), blob });
  }
  return addLocal(entries);
}
function readEntry(entry, path) {
  return new Promise(resolve => {
    if (entry.isFile) entry.file(f => { f._rel = path + f.name; resolve([f]); }, () => resolve([]));
    else if (entry.isDirectory) {
      const reader = entry.createReader(); let all = [];
      const next = () => reader.readEntries(async ents => {
        if (!ents.length) resolve((await Promise.all(all.map(en => readEntry(en, path + entry.name + '/')))).flat());
        else { all = all.concat(ents); next(); }
      }, () => resolve([]));
      next();
    } else resolve([]);
  });
}

/* ---------- Lien de partage Nextcloud ---------- */
let share = null;
const davRoot = () => `${share.base}/public.php/dav/files/${share.token}`;
const authH = () => share.password ? { Authorization: 'Basic ' + btoa('anonymous:' + share.password) } : {};
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
async function propfind(path) {
  const r = await fetch(davRoot() + encPath(path), { method: 'PROPFIND',
    headers: Object.assign({ Depth: '1', 'Content-Type': 'application/xml' }, authH()),
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' });
  if (!r.ok) throw Object.assign(new Error('http'), { code: r.status });
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const prefix = new URL(davRoot()).pathname;
  return [...xml.getElementsByTagNameNS('DAV:', 'response')].map(res => {
    const href = decodeURIComponent(res.getElementsByTagNameNS('DAV:', 'href')[0].textContent);
    let rel = href.slice(href.indexOf(prefix) + prefix.length).replace(/\/$/, '');
    if (!rel.startsWith('/')) rel = '/' + rel;
    return { path: rel, isDir: res.getElementsByTagNameNS('DAV:', 'collection').length > 0 };
  }).filter(e => e.path !== (path.replace(/\/$/, '') || '/'));
}
async function walk(path = '/', depth = 0, out = [], re = IMG_RE) {
  for (const e of await propfind(path)) {
    if (e.isDir) { if (depth < CFG.maxDepth) await walk(e.path + '/', depth + 1, out, re); }
    else if (re.test(e.path)) out.push(e.path);
  }
  return out;
}
function linkError(t) { const e = $('linkErr'); e.hidden = false; e.textContent = t; $('welcome').querySelector('.nc').open = true; }
async function loadShare() {
  reset('Lien de partage Nextcloud');
  showWelcome(false);
  status('Lecture du dossier partagé…');
  let paths;
  let found;
  try { found = await walk('/', 0, [], /\.(jpe?g|heic|heif|tiff?|png|webp|ifc|glb|gltf|geotrace\.json|pdf)$/i); paths = found.filter(x => IMG_RE.test(x)); }
  catch (e) {
    status(''); showWelcome(true);
    if (e.code === 401) { $('pwdInput').hidden = false; return linkError('Ce lien est protégé. Saisissez son mot de passe, puis rouvrez le lien.'); }
    if (e.code === 404) return linkError('Ce lien a expiré ou n’existe pas. Demandez un nouveau lien de partage.');
    return linkError('Le serveur Nextcloud refuse la lecture depuis cette page. Installez GeoTrace sur le serveur ou utilisez le dossier synchronisé ou le ZIP.');
  }
  await pool(paths, CFG.concurrency, async path => {
    const url = davRoot() + encPath(path);
    const meta = await readMeta(url);
    const prev = `${share.base}/index.php/apps/files_sharing/publicpreview/${share.token}?file=${encodeURIComponent(path)}&a=1`;
    register(Object.assign({ name: path.split('/').pop(), folder: path.split('/').slice(1, -1).join('/'), kind: 'remote',
      url, previewUrl: prev + '&x=600&y=450', thumbRemote: prev + '&x=96&y=96', path }, meta));
  }, 'Lecture des photos');
  finish(paths.length);
  try { const pp = found.filter(x => /\.pdf$/i.test(x)), pf = pp.find(x => /planning|phasage|calendrier|gantt/i.test(x)) || pp[0]; if (pf) { const r = await fetch(davRoot() + encPath(pf), { headers: authH() }); if (r.ok) setPlan(await r.blob(), pf.split('/').pop()); } } catch (er) { console.warn('planning illisible', er); }
  try { history.replaceState(null, '', location.pathname + (share.base === (CFG.nextcloud || location.origin).replace(/\/$/, '') ? '?s=' + encodeURIComponent(share.token) : '?lien=' + encodeURIComponent(`${share.base}/s/${share.token}`))); } catch (e) { /* adresse inchangée */ }
  store.set('geotrace:session', null); // la source est maintenant dans l'adresse
  const mp = found.filter(x => MODEL_RE.test(x)), cp = found.filter(x => CAL_RE.test(x));
  if (mp.length) { try { const r = await shareModel(mp, cp); await openModel(r.buf, r.name, r.calText, { quiet: true }); } catch (e) { console.warn('maquette du dossier partagé illisible', e); } }
}
function parseShare(url) {
  const m = String(url).match(/^(https?:\/\/[^/]+)(?:\/index\.php)?\/s\/([A-Za-z0-9]+)/);
  return m ? { base: m[1], token: m[2], password: null } : null;
}

/* ---------- Photos d'exemple ---------- */
async function loadDemo() {
  reset('Exemple : rue fictive');
  showWelcome(false);
  const way = [[47.6583, -2.7600], [47.6592, -2.7571], [47.6601, -2.7545], [47.6618, -2.7522], [47.6631, -2.7490], [47.6642, -2.7462]];
  const labels = ['Regard EU', 'Tampon AEP', 'Branchement', 'Vanne', 'Tranchée', 'Regard EP', 'Canalisation', 'Réfection'];
  const base = new Date(); base.setDate(base.getDate() - 2); base.setHours(8, 10, 0, 0);
  const total = 42, entries = [];
  for (let i = 0; i < total; i++) {
    const u = i / (total - 1) * (way.length - 1), s = Math.min(Math.floor(u), way.length - 2), f = u - s;
    const jitterA = Math.sin(i * 12.9898) * 0.00006, jitterB = Math.cos(i * 78.233) * 0.00009;
    const lat = way[s][0] + (way[s + 1][0] - way[s][0]) * f + jitterA;
    const lon = way[s][1] + (way[s + 1][1] - way[s][1]) * f + jitterB;
    const dev = i % 11 === 5 ? 'drone' : i % 5 === 3 ? 'tab' : 'phone';
    const date = new Date(base.getTime() + Math.floor(i / 14) * 86400000 + (i % 14) * 41 * 60000 + (i * 97 % 30) * 1000);
    const label = labels[i % labels.length];
    const heading = i % 9 === 8 ? null : (((Math.atan2(way[s + 1][1] - way[s][1], way[s + 1][0] - way[s][0]) * 180 / Math.PI) + (i % 2 ? 90 : -90) + 360) % 360);
    const blob = await demoImage(`${label} n° ${i + 1}`, dev);
    const p = { id: '', name: `exemple-${String(i + 1).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z]+/g, '-')}.jpg`, folder: 'Exemple/' + fmtDay(date).replace(' ', '-'), kind: 'local', blob,
      lat, lon, alt: 12 + i * .3, rel: dev === 'drone' ? 40 : null, heading, headingSrc: heading != null ? (dev === 'drone' ? 'nacelle du drone' : 'nord vrai') : null, pitch: dev === 'drone' ? -45 : null, f35: dev === 'drone' ? 24 : 26,
      date, dev, model: dev === 'drone' ? 'DJI Mavic 3' : dev === 'tab' ? 'Tablette durcie' : 'Smartphone', demo: true };
    entries.push(p);
  }
  entries.forEach(register);
  finish(entries.length);
}
function demoImage(text, dev) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d'), col = COLORS[dev];
  const grad = g.createLinearGradient(0, 0, 640, 480); grad.addColorStop(0, '#04264b'); grad.addColorStop(1, '#0585c6');
  g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
  g.fillStyle = col; g.globalAlpha = .9; g.fillRect(0, 380, 640, 100); g.globalAlpha = 1;
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2;
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(320, 190, 40 + i * 42, 20 + i * 22, 0, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#fff'; g.font = '700 38px "Public Sans", sans-serif'; g.textAlign = 'center';
  g.fillText(text, 320, 200);
  g.font = '600 22px "Public Sans", sans-serif'; g.fillText('Photo d’exemple GeoTrace', 320, 436);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', .82));
}

/* ================= Filtres et rendu ================= */
function passes(p) {
  if (!filters.dev[p.dev]) return false;
  if (filters.fav && !isFav(p)) return false;
  if (filters.q) {
    const hay = (p.name + ' ' + p.folder + ' ' + noteOf(p) + ' ' + (p.model || '')).toLowerCase();
    if (!filters.q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  if (filters.from || filters.to) {
    if (!p.date) return false;
    if (filters.from && p.date < filters.from) return false;
    if (filters.to && p.date > filters.to) return false;
  }
  return true;
}
const visible = () => visibleCache;
const placedOf = list => list.filter(p => p.lat != null && p.lon != null);

function finish() {
  status('');
  if (!photos.length) {
    showWelcome(true);
    const e = $('welErr'); e.hidden = false;
    e.textContent = 'Aucune photo trouvée. GeoTrace lit les JPEG, HEIC, TIFF, PNG et WebP.';
    return;
  }
  photos.sort((a, b) => (a.date || 0) - (b.date || 0));
  const dates = photos.map(p => p.date).filter(Boolean);
  $('dFrom').min = $('dTo').min = dates.length ? isoDay(dates[0]) : '';
  $('dFrom').max = $('dTo').max = dates.length ? isoDay(dates[dates.length - 1]) : '';
  $('addBtn').disabled = false; $('exportBtn').disabled = false;
  refresh(true);
  setTimeout(autoProjectCalib, 600); // le projet se cale tout seul dès qu'il est ouvert
  const withGps = placedOf(photos).length;
  if (!withGps) status('Aucune de ces photos ne contient de position GPS. Elles restent dans la liste.', { ms: 7000 });
}

function refresh(fit) {
  visibleCache = photos.filter(passes);
  const vis = visibleCache, placed = placedOf(vis);
  if (!group) makeGroup();
  group.clearLayers(); markers.clear();
  const ms = placed.map(p => {
    const m = L.marker([p.lat, p.lon], { icon: markerIcon(p, p.id === selectedId), title: p.name, riseOnHover: true });
    m.bindPopup(() => popupHtml(p), { maxWidth: 336, autoPanPadding: [40, 60] });
    m.on('popupopen', () => onPopupOpen(p));
    markers.set(p.id, m); return m;
  });
  if (group.addLayers) group.addLayers(ms); else ms.forEach(m => group.addLayer(m));
  trackLayer.setLatLngs(placed.filter(p => p.date).map(p => [p.lat, p.lon]));
  if (prefs.track) trackLayer.addTo(map); else map.removeLayer(trackLayer);
  if (fit && placed.length) map.fitBounds(L.latLngBounds(placed.map(p => [p.lat, p.lon])).pad(0.2), { maxZoom: 19 });
  updateStats(vis, placed);
  renderList();
  renderTimeline();
}
function updateStats(vis, placed) {
  const miss = vis.length - placed.length;
  const parts = [`${placed.length} photo${placed.length > 1 ? 's' : ''} sur la carte`];
  const noCap = placed.filter(p => p.heading == null).length;
  if (noCap) parts.push(`${noCap} sans direction`);
  if (miss) parts.push(`${miss} sans GPS`);
  if (vis.length < photos.length) parts.push(`${photos.length - vis.length} masquée${photos.length - vis.length > 1 ? 's' : ''}`);
  $('sub').textContent = parts.join(', ');
  const count = fn => photos.filter(fn).length;
  document.querySelectorAll('.chip[data-dev]').forEach(c => { c.querySelector('b').textContent = count(p => p.dev === c.dataset.dev); c.hidden = !photos.length; });
  $('favOnly').querySelector('b').textContent = count(isFav);
  $('dReset').hidden = !(filters.from || filters.to);
}

/* ---------- Liste ---------- */
const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  thumbObserver.unobserve(e.target);
  const p = photos.find(x => x.id === e.target.dataset.pid);
  if (p) ensureThumb(p).then(() => { if (p.thumb) e.target.style.backgroundImage = `url("${p.thumb}")`; e.target.firstElementChild && p.thumb && e.target.firstElementChild.remove(); });
}), { root: null, rootMargin: '120px' }) : null;

function renderList() {
  const ul = $('list'); ul.textContent = ''; rowEls.clear();
  if (thumbObserver) thumbObserver.disconnect();
  const vis = visible();
  const add = p => {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'it' + (p.id === selectedId ? ' sel' : '') + (p.lat == null ? ' nogps' : '');
    b.style.setProperty('--c', COLORS[p.dev]);
    const th = document.createElement('span'); th.className = 'th'; th.dataset.pid = p.id;
    th.insertAdjacentHTML('afterbegin', icon('image'));
    const t = document.createElement('span'); t.className = 't';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = p.name;
    const m = document.createElement('span'); m.className = 'm'; m.textContent = fmtDate(p.date) + (p.folder ? ', ' + p.folder : '');
    const c = document.createElement('span'); c.className = 'cap';
    c.textContent = p.heading != null ? `${Math.round(p.heading)}° ${cardinal(p.heading)}` : '';
    if (isFav(p)) c.insertAdjacentHTML('beforeend', icon('star'));
    t.append(n, m); b.append(th, t, c);
    b.addEventListener('click', () => focusPhoto(p));
    li.appendChild(b); ul.appendChild(li); rowEls.set(p.id, b);
    if (p.thumb) { th.style.backgroundImage = `url("${p.thumb}")`; th.firstElementChild.remove(); }
    else if (thumbObserver) thumbObserver.observe(th);
  };
  vis.filter(p => p.lat != null).forEach(add);
  const without = vis.filter(p => p.lat == null);
  if (without.length) {
    const g = document.createElement('li'); g.className = 'group'; g.textContent = `Sans position GPS (${without.length})`; ul.appendChild(g);
    without.forEach(add);
  }
  const e = $('emptyList');
  e.hidden = vis.length > 0 || !photos.length;
  if (!e.hidden) e.textContent = 'Aucune photo ne correspond aux filtres. Élargissez la période ou réactivez un appareil.';
}
function select(id) {
  if (selectedId === id) return;
  const prev = selectedId; selectedId = id;
  [prev, id].forEach(k => {
    const p = photos.find(x => x.id === k), m = markers.get(k);
    if (p && m && !(m.isPopupOpen() && k === id)) m.setIcon(markerIcon(p, k === id));
    const row = rowEls.get(k); if (row) row.classList.toggle('sel', k === id);
  });
  const row = rowEls.get(id); if (row) row.scrollIntoView({ block: 'nearest' });
}
function focusPhoto(p) {
  const m = markers.get(p.id);
  if (!m) { select(p.id); openViewer(p); return; }
  closeSheet();
  if (group.zoomToShowLayer) group.zoomToShowLayer(m, () => { map.panTo(m.getLatLng()); m.openPopup(); });
  else { map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 18), { duration: .6 }); map.once('moveend', () => m.openPopup()); }
}

/* ================= Images ================= */
const canDisplay = p => !/\.(heic|heif|tiff?)$/i.test(p.name);
function fullUrl(p) {
  if (p.kind === 'remote') return p.url;
  if (!p._url) { p._url = URL.createObjectURL(p.blob); objectUrls.push(p._url); }
  return p._url;
}
let heicLoader;
function loadHeic() {
  if (window.heic2any) return Promise.resolve();
  return heicLoader || (heicLoader = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/heic2any.min.js'; s.onload = res; s.onerror = () => { heicLoader = null; rej(new Error('heic')); };
    document.head.appendChild(s);
  }));
}
/* Renvoie l'adresse d'une image affichable (conversion des HEIC à la demande), ou null. */
async function displayUrl(p) {
  if (p.kind === 'remote') return p.previewUrl;
  if (canDisplay(p)) return fullUrl(p);
  if (p._disp !== undefined) return p._disp;
  p._disp = null;
  if (/\.hei[cf]$/i.test(p.name)) {
    try {
      await loadHeic();
      const out = await heic2any({ blob: p.blob, toType: 'image/jpeg', quality: .85 });
      const b = Array.isArray(out) ? out[0] : out;
      p._disp = URL.createObjectURL(b); objectUrls.push(p._disp); return p._disp;
    } catch (e) { /* repli sur la miniature intégrée */ }
  }
  try { const u = await exifr.thumbnailUrl(p.blob); if (u) { p._disp = u; objectUrls.push(u); } } catch (e) { /* aucune miniature */ }
  return p._disp;
}
async function ensureThumb(p) {
  if (p.thumb !== undefined) return;
  p.thumb = null;
  if (p.kind === 'remote') { p.thumb = p.thumbRemote; return; }
  try { const u = await exifr.thumbnailUrl(p.blob); if (u) { p.thumb = u; objectUrls.push(u); return; } } catch (e) { /* pas de miniature EXIF */ }
  if (canDisplay(p) && p.blob.size < 12e6) p.thumb = fullUrl(p);
}

/* ================= Fiche photo (bulle) ================= */
function rowsOf(p) {
  const rows = [['Prise le', fmtDate(p.date)], ['Appareil', p.model || DEV[p.dev]]];
  if (p.folder) rows.push(['Dossier', p.folder]);
  if (p.lat != null) {
    rows.push(['GPS', `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`]);
    const l = fmtL93(p.lat, p.lon); if (l) rows.push(['Lambert-93', l]);
  }
  if (p.alt != null) rows.push(['Altitude', fmt(p.alt) + ' m' + (p.rel != null ? ` (vol à ${Math.round(p.rel)} m)` : '')]);
  rows.push(['Direction', p.heading != null ? `${Math.round(p.heading)}° ${cardinal(p.heading)}, ${p.headingSrc}` : 'non enregistrée par l’appareil']);
  if (p.pitch != null) rows.push(['Inclinaison', Math.round(p.pitch) + '°']);
  return rows;
}
const mapsLink = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
function popupHtml(p) {
  const rows = rowsOf(p);
  if (prefs.addr) rows.splice(rows.findIndex(r => r[0] === 'GPS'), 0, ['Adresse', p.addr || '…']);
  const maq = CFG.maquette ? CFG.maquette.replace('{photo}', encodeURIComponent(p.path || p.name)) : '';
  return `<div class="pop" data-pid="${p.id}">
    <div class="ph">${p.kind === 'remote' || canDisplay(p) ? `<img class="pv" src="${esc(p.kind === 'remote' ? p.previewUrl : fullUrl(p))}" alt="" data-act="open">` : `<div class="noimg" data-slot="img">Préparation de l’aperçu…</div>`}
      <button class="starbtn" type="button" data-act="fav" aria-pressed="${isFav(p)}" aria-label="Favori">${icon('star')}</button></div>
    <div class="top"><h3>${esc(p.name)}</h3>${compassSvg(p.heading)}</div>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === 'Adresse' ? ' data-slot="addr"' : ''}>${esc(v)}</dd>`).join('')}</dl>
    <textarea class="note" data-note="${p.id}" placeholder="Ajouter une note" aria-label="Note sur la photo" maxlength="1000">${esc(noteOf(p))}</textarea>
    <div class="acts"><button type="button" data-act="open">Voir en grand</button>
      <button type="button" class="sec" data-act="copy">Copier la position</button>
      <a class="sec" href="${esc(mapsLink(p))}" target="_blank" rel="noopener">Itinéraire</a>
      ${Maq && Maq.isPlaced() ? '<button type="button" class="sec" data-act="maq">Voir dans la maquette</button>' : ''}
      ${maq ? `<a class="sec" href="${esc(maq)}" target="_blank" rel="noopener">Ouvrir dans la maquette</a>` : ''}</div></div>`;
}
async function onPopupOpen(p) {
  select(p.id);
  const root = markers.get(p.id) && markers.get(p.id).getPopup().getElement();
  if (!root) return;
  const slot = root.querySelector('[data-slot="img"]');
  if (slot) displayUrl(p).then(u => {
    if (!slot.isConnected) return;
    if (u) slot.outerHTML = `<img class="pv" src="${esc(u)}" alt="" data-act="open">`;
    else slot.textContent = 'Aperçu impossible pour ce format dans le navigateur.';
  });
  if (prefs.addr) reverseGeocode(p).then(a => { const el = root.querySelector('[data-slot="addr"]'); if (el) el.textContent = a || 'non trouvée'; });
}
const reverseCache = new Map();
async function reverseGeocode(p) {
  if (p.addr) return p.addr;
  const k = p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
  if (reverseCache.has(k)) return (p.addr = reverseCache.get(k));
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${p.lon}&lat=${p.lat}&limit=1`);
    if (!r.ok) return null;
    const j = await r.json();
    const f = j.features && j.features[0];
    const a = f && f.properties && f.properties.label;
    if (a) { reverseCache.set(k, a); p.addr = a; }
    return a || null;
  } catch (e) { return null; }
}

function setFav(p, on) {
  markOf(p).fav = on; tidyMark(p); saveMarks();
  const m = markers.get(p.id); if (m) m.setIcon(markerIcon(p, p.id === selectedId));
  const row = rowEls.get(p.id);
  if (row) { const c = row.querySelector('.cap'); c.querySelector('svg') && c.querySelector('svg').remove(); if (on) c.insertAdjacentHTML('beforeend', icon('star')); }
  $('favOnly').querySelector('b').textContent = photos.filter(isFav).length;
  if (filters.fav && !on) refresh(false);
}
function setNote(p, text) { markOf(p).note = text.trim(); tidyMark(p); saveMarks(); }
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); status(msg, { ms: 2200 }); }
  catch (e) { status('Copie impossible : ' + text, { ms: 6000 }); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const host = el.closest('[data-pid]');
  const p = host && photos.find(x => x.id === host.dataset.pid);
  if (!p) return;
  const act = el.dataset.act;
  if (act === 'open') { e.preventDefault(); e.stopPropagation(); openViewer(p); }
  else if (act === 'fav') {
    const on = el.getAttribute('aria-pressed') !== 'true';
    document.querySelectorAll(`[data-pid="${p.id}"] [data-act="fav"]`).forEach(b => b.setAttribute('aria-pressed', on));
    setFav(p, on);
  } else if (act === 'copy') copyText(`${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`, 'Position copiée');
  else if (act === 'maq') open3d(p.id);
  else if (act === 'copy-l93') { const l = fmtL93(p.lat, p.lon); if (l) copyText(l, 'Coordonnées Lambert-93 copiées'); }
});
document.addEventListener('input', e => {
  const t = e.target.closest('textarea[data-note]');
  if (!t) return;
  const p = photos.find(x => x.id === t.dataset.note);
  if (p) setNote(p, t.value);
});

/* ================= Visionneuse ================= */
let vList = [], vIdx = -1, vz = { s: 1, x: 0, y: 0, r: 0 }, vToken = 0;
function openViewer(p) {
  vList = visible().slice();
  vIdx = vList.indexOf(p);
  if (vIdx < 0) { vList = [p]; vIdx = 0; }
  map.closePopup();
  $('viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  showInViewer();
  $('vClose').focus();
}
function applyZoom() {
  const img = $('vImg');
  img.style.transform = `translate(${vz.x}px, ${vz.y}px) rotate(${vz.r}deg) scale(${vz.s})`;
  $('vOver').style.transform = img.style.transform;
  $('vStage').style.cursor = vz.s > 1 ? 'grab' : 'default';
}
function resetZoom(keepRot) { vz = { s: 1, x: 0, y: 0, r: keepRot ? vz.r : 0 }; applyZoom(); }
async function showInViewer() {
  const p = vList[vIdx]; if (!p) return;
  const my = ++vToken;
  const img = $('vImg'), msg = $('vMsg');
  $('vName').textContent = p.name;
  $('vMeta').textContent = [fmtDate(p.date), p.model || DEV[p.dev], p.heading != null ? `${Math.round(p.heading)}° ${cardinal(p.heading)}` : null, `${vIdx + 1} sur ${vList.length}`].filter(Boolean).join(', ');
  $('vPrev').disabled = vIdx <= 0; $('vNext').disabled = vIdx >= vList.length - 1;
  const dl = $('vDownload'); dl.removeAttribute('href');
  if (p.kind === 'local') { dl.href = fullUrl(p); dl.download = p.name; } else { dl.href = p.url; dl.download = p.name; }
  renderInfo(p); paintRepBtn();
  resetZoom();
  msg.hidden = false; msg.textContent = 'Chargement…'; img.hidden = true;
  const src = p.kind === 'remote' ? p.url : await displayUrl(p);
  if (my !== vToken) return;
  if (!src) { msg.textContent = 'Ce format ne peut pas être affiché dans le navigateur. Téléchargez la photo pour l’ouvrir.'; return; }
  img.onload = () => { if (my === vToken) { msg.hidden = true; img.hidden = false; paintOver(); } };
  img.onerror = () => { if (my === vToken) { img.hidden = true; msg.hidden = false; msg.textContent = 'Cette photo n’a pas pu être affichée.'; } };
  img.src = src;
}
function renderInfo(p) {
  const info = $('vInfo');
  info.innerHTML = `<dl>${rowsOf(p).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}${p.addr ? `<dt>Adresse</dt><dd>${esc(p.addr)}</dd>` : ''}</dl>
    <div data-pid="${p.id}"><button class="btn small" type="button" data-act="fav" aria-pressed="${isFav(p)}">${icon('star')} Favori</button>
    ${p.lat != null && fmtL93(p.lat, p.lon) ? ` <button class="btn small" type="button" data-act="copy-l93">${icon('copy')} Lambert-93</button>` : ''}</div>
    <textarea data-note="${p.id}" placeholder="Ajouter une note" aria-label="Note sur la photo" maxlength="1000">${esc(noteOf(p))}</textarea>`;
  if (p.lat != null && prefs.addr && !p.addr) reverseGeocode(p).then(a => { if (a && vList[vIdx] === p) renderInfoAddr(p); });
}
function renderInfoAddr(p) {
  const dl = $('vInfo').querySelector('dl'); if (dl && !dl.textContent.includes('Adresse')) dl.insertAdjacentHTML('beforeend', `<dt>Adresse</dt><dd>${esc(p.addr)}</dd>`);
}
function closeViewer() {
  $('vOver').hidden = true;
  $('viewer').hidden = true; $('vImg').removeAttribute('src'); vToken++;
  document.body.style.overflow = '';
  const p = vList[vIdx]; if (p) { const m = markers.get(p.id); if (m && group.getVisibleParent && group.getVisibleParent(m) !== m) { /* reste regroupé */ } }
}
/* Repérage sur photo : annotation simple, rangée par photo dans le navigateur */
let Rep = null;
const reps = store.get('geotrace:repere', {});
// Calage de la photo pour les RÉSEAUX : séparé de celui de la maquette (clé propre)
const rAdj = p => { try { return JSON.parse(localStorage.getItem('geotrace:rvue:' + (p.key || p.name)) || 'null') || undefined; } catch (e) { return undefined; } };
const poseOf = (p, M) => ({ key: p.key, name: p.name, lat: p.lat, lon: p.lon, heading: p.heading, pitch: p.pitch, f35: p.f35, dev: p.dev, rel: p.rel, adj: rAdj(p) });
const repCount = d => !d ? 0 : Array.isArray(d) ? d.length : (d.objs || []).length;
function saveReps() { store.set('geotrace:repere', reps); paintRepBtn(); }
// Envoie (ou retire, si items vaut null) le repérage d'une photo dans la vue 3D
function sendRepTo3D(key, items) {
  if (Chantier && Chantier.netsFromPhoto) Chantier.netsFromPhoto(key, items);
  if (!$('v3d').hidden) status('Réseaux mis à jour : rouvrez la vue 3D pour les voir.', { ms: 4000 });
}
async function openRepere() {
  const p = vList[vIdx]; if (!p) return;
  if (pcRun) { status('Le calage du projet est en cours : patientez quelques instants.', { ms: 3500 }); return; }
  const src = p.kind === 'remote' ? (p.previewUrl || p.url) : await displayUrl(p);
  if (!src) { status('Cette photo ne peut pas être repérée dans le navigateur.', { ms: 4000 }); return; }
  if (!Rep) { try { Rep = await import('./repere.js'); } catch (e) { console.error(e); status('Repérage indisponible.', { ms: 4000 }); return; } }
  // Les réglages fins de chaque photo (ceux de la vue 3D) servent aussi ici : même caméra des deux côtés
  let M = null; try { M = await maq(); } catch (e) { M = null; }
  // Les autres photos qui ont déjà un repérage (au nouveau format) : leurs dessins sont montrés dans celle-ci
  const others = photos.filter(o => o.key !== p.key && reps[o.key] && reps[o.key].v === 2 && o.lat != null).map(o => ({ key: o.key, name: o.name, photo: poseOf(o, M), data: reps[o.key] }));
  Rep.open({
    name: p.name, src, data: reps[p.key], photo: poseOf(p, M), others,
    onAdj: a => { try { localStorage.setItem('geotrace:rvue:' + (p.key || p.name), JSON.stringify(a)); } catch (e) { /* stockage indisponible */ } },
    // Photos voisines (proches et d'inclinaison semblable) : elles servent de référence au calage automatique
    neighbors: async () => {
      const R = Math.PI / 180, d = o => Math.hypot((o.lon - p.lon) * R * 6371009 * Math.cos(p.lat * R), (o.lat - p.lat) * R * 6371009);
      const nad = (p.pitch || 0) < -70, sc = o => d(o) + 2 * Math.abs((p.pitch || 0) - (o.pitch || 0));
      const near = photos.filter(o => o.key !== p.key && o.lat != null && p.lat != null && o.heading != null && d(o) < (nad ? 220 : 150)).sort((a, b) => sc(a) - sc(b)).slice(0, nad ? 6 : 4);
      const out = [];
      for (const o of near) { const s = o.kind === 'remote' ? (o.previewUrl || o.url) : await displayUrl(o); if (s) out.push({ photo: poseOf(o, M), src: s }); }
      return out;
    },
    onSave: d => { if (d.objs.length) reps[p.key] = d; else delete reps[p.key]; saveReps(); },
    onSaveOther: (key, d) => {
      reps[key] = d; saveReps();
      const o = photos.find(x => x.key === key);
      if (d.sent && o) { const items = Rep.recordToItems(d, poseOf(o, M)); if (items) sendRepTo3D(key, items); }
    },
    onSend3D: items => sendRepTo3D(p.key, items),
    onClose: () => paintOver()
  });
}
// Dessins du repérage (et ceux des autres photos reportés ici) posés sur la photo de la visionneuse
let ovlOn = store.get('geotrace:ovl', true);
const ovlF = Object.assign({ own: true, others: true }, store.get('geotrace:ovlf', {}));
async function paintOver() {
  const cv = $('vOver'), img = $('vImg'), p = vList[vIdx], b = $('vOvl');
  if (!cv || !p) return;
  const mine = reps[p.key] && reps[p.key].v === 2 && (reps[p.key].objs || []).length;
  const othPhotos = photos.some(o => o.key !== p.key && reps[o.key] && reps[o.key].v === 2 && o.lat != null);
  // le menu « Annotations » n'apparaît que s'il y a quelque chose à montrer
  $('vOvlWrap').hidden = !(mine || othPhotos);
  $('ofOwn').closest('label').hidden = !mine; $('ofOthers').closest('label').hidden = !othPhotos;
  const anyOn = (mine && ovlF.own) || (othPhotos && ovlF.others);
  b.setAttribute('aria-pressed', String(!!anyOn));
  cv.hidden = true;
  if (!anyOn || $('vOvlWrap').hidden || !img.naturalWidth) return;
  const my = vToken;
  if (!Rep) { try { Rep = await import('./repere.js'); } catch (e) { return; } }
  if (my !== vToken) return;
  let M = null; try { M = await maq(); } catch (e) { M = null; }
  const others = (ovlF.others ? photos.filter(o => o.key !== p.key && reps[o.key] && reps[o.key].v === 2 && o.lat != null).map(o => ({ photo: poseOf(o, M), data: reps[o.key] })) : []);
  const k = Math.min(1, 2400 / img.naturalWidth);
  Rep.paintOverlay(cv, { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k), data: ovlF.own ? reps[p.key] : null, photo: poseOf(p, M), others, showOthers: others.length > 0 });
  cv.style.width = img.clientWidth + 'px'; cv.style.height = img.clientHeight + 'px';
  cv.hidden = false;
}
[['ofOwn', 'own'], ['ofOthers', 'others']].forEach(([id, k]) => { $(id).checked = !!ovlF[k]; $(id).addEventListener('change', () => { ovlF[k] = $(id).checked; store.set('geotrace:ovlf', ovlF); paintOver(); }); });
window.addEventListener('resize', () => { if (!$('viewer').hidden) paintOver(); });
/* Calage de tout le projet : points communs entre toutes les photos voisines, réglage de toutes les photos ensemble */
let pcLayer = null, pcRun = null;
const PCSIG = 'geotrace:pcsig';
const pcSig = list => list.map(p => p.key).sort().join('|');
// Au chargement d'un projet : calage automatique, sauf si ces mêmes photos ont déjà été calées
function autoProjectCalib() {
  const list = photos.filter(p => p.lat != null && p.heading != null);
  if (list.length < 2 || pcRun) return;
  let done = null; try { done = localStorage.getItem(PCSIG); } catch (e) { /* stockage indisponible */ }
  if (done === pcSig(list)) return;
  projectCalib(true);
}
async function projectCalib(auto) {
  if (pcRun) return;
  const list = photos.filter(p => p.lat != null && p.heading != null);
  if (list.length < 2) { status('Il faut au moins 2 photos avec position GPS et direction.', { ms: 4000 }); return; }
  let box = document.getElementById('pcBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'pcBox'; box.setAttribute('role', 'status');
    box.innerHTML = '<b>Calage du projet</b><span id="pcTxt"></span><progress id="pcBar" max="1" value="0"></progress><button class="btn small" id="pcStop" type="button">Arrêter</button>';
    document.body.appendChild(box);
  }
  box.hidden = false;
  const run = pcRun = { stop: false };
  document.getElementById('pcStop').onclick = () => { run.stop = true; };
  const txt = document.getElementById('pcTxt'), bar = document.getElementById('pcBar');
  let M = null; try { M = await maq(); } catch (e) { M = null; }
  let PC = null;
  try { PC = await import('./projcal.js'); } catch (e) { console.error(e); }
  if (!PC) { box.hidden = true; pcRun = null; status('Calage du projet indisponible.', { ms: 4000 }); return; }
  const items = list.map(p => ({ key: p.key, pose: poseOf(p, M), load: async () => {
    const src = p.kind === 'remote' ? (p.previewUrl || p.url) : await displayUrl(p);
    if (!src) return null;
    return await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  } }));
  let applied = false;
  const apply = res => {
    applied = true;
    try { localStorage.setItem(PCSIG, pcSig(list)); } catch (e) { /* stockage indisponible */ }
    for (const k in res.adjs) { try { localStorage.setItem('geotrace:rvue:' + k, JSON.stringify(res.adjs[k])); } catch (e) { /* stockage indisponible */ } }
    if (pcLayer) { pcLayer.remove(); pcLayer = null; }
    if (window.L && map && res.points.length) {
      const rend = L.canvas({ padding: 0.3 });
      pcLayer = L.layerGroup(res.points.map(q => L.circleMarker(q, { renderer: rend, radius: 2, weight: 0, fillColor: '#ff2d8a', fillOpacity: .8, interactive: false }))).addTo(map);
    }
    status('Projet calé : ' + res.stats.photos + ' photos, ' + res.stats.pairs + ' paires, ' + res.stats.obs + ' points communs. Écart moyen ' + res.stats.before.toFixed(1) + ' → ' + res.stats.after.toFixed(1) + ' px. Les dessins sont recalculés à l’ouverture.', { ms: 7000 });
    if (!$('viewer').hidden) paintOver();
  };
  let r = null;
  try { r = await PC.calibrateProject({ photos: items, onProgress: (t, f) => { txt.textContent = t; bar.value = f || 0; }, cancelled: () => run.stop, onCalibrated: apply }); }
  catch (e) { console.error(e); r = { error: 'Le calage a échoué.' }; }
  box.hidden = true; pcRun = null;
  if (!applied) {
    if (!r || r.cancelled) { status('Calage du projet arrêté : rien n’a été modifié.', { ms: 4000 }); return; }
    if (r.error && auto) { status('Calage automatique impossible : ' + r.error, { ms: 6000 }); return; }
    if (r.error) { status('Calage du projet : ' + r.error, { ms: 6000 }); return; }
    apply(r);
  }
}
$('pcBtn').addEventListener('click', () => projectCalib(false));
function paintRepBtn() { const p = vList[vIdx], b = $('vRep'); if (!b || !p) return; const n = repCount(reps[p.key]); b.textContent = n ? `Repérage (${n})` : 'Repérer'; }
$('vRep').addEventListener('click', openRepere);
$('vClose').addEventListener('click', closeViewer);
$('vPrev').addEventListener('click', () => { if (vIdx > 0) { vIdx--; showInViewer(); } });
$('vNext').addEventListener('click', () => { if (vIdx < vList.length - 1) { vIdx++; showInViewer(); } });
$('vZoomIn').addEventListener('click', () => { vz.s = Math.min(8, vz.s * 1.4); applyZoom(); });
$('vZoomOut').addEventListener('click', () => { vz.s = Math.max(1, vz.s / 1.4); if (vz.s === 1) { vz.x = vz.y = 0; } applyZoom(); });
$('vRotate').addEventListener('click', () => { vz.r = (vz.r + 90) % 360; applyZoom(); });
$('vReset').addEventListener('click', () => resetZoom());
$('vInfoBtn').addEventListener('click', e => { const on = $('vInfo').hidden = !$('vInfo').hidden; e.currentTarget.setAttribute('aria-pressed', String(!on)); });
(() => { // zoom molette, glisser et pincement
  const st = $('vStage'), pts = new Map(); let last = null, pinch = 0;
  st.addEventListener('wheel', e => { e.preventDefault(); vz.s = Math.min(8, Math.max(1, vz.s * Math.exp(-e.deltaY * .0016))); if (vz.s === 1) vz.x = vz.y = 0; applyZoom(); }, { passive: false });
  st.addEventListener('pointerdown', e => { if (e.target.closest('.v-msg')) return; st.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); last = { x: e.clientX, y: e.clientY }; pinch = 0; st.classList.add('drag'); });
  st.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch) { vz.s = Math.min(8, Math.max(1, vz.s * d / pinch)); if (vz.s === 1) vz.x = vz.y = 0; applyZoom(); }
      pinch = d; return;
    }
    if (vz.s > 1 && last) { vz.x += e.clientX - last.x; vz.y += e.clientY - last.y; applyZoom(); }
    last = { x: e.clientX, y: e.clientY };
  });
  const up = e => { pts.delete(e.pointerId); pinch = 0; last = pts.size ? last : null; if (!pts.size) st.classList.remove('drag'); };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  st.addEventListener('dblclick', () => { vz.s = vz.s > 1 ? 1 : 2.5; if (vz.s === 1) vz.x = vz.y = 0; applyZoom(); });
  st.addEventListener('click', e => { if (e.target === st && vz.s === 1 && !pts.size) closeViewer(); });
  let sx = 0; // balayage horizontal pour changer de photo
  st.addEventListener('touchstart', e => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  st.addEventListener('touchend', e => { if (sx == null || vz.s > 1) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 70) $(dx < 0 ? 'vNext' : 'vPrev').click(); sx = null; }, { passive: true });
})();

/* ================= Chronologie ================= */
const TL = { buckets: [], start: 0, step: 0, n: 0 };
function renderTimeline() {
  const dated = photos.filter(p => p.date);
  const tl = $('timeline');
  if (dated.length < 2 || !photos.length) { tl.hidden = true; document.documentElement.style.setProperty('--tl-h', '0px'); return; }
  tl.hidden = false;
  const tMin = Math.min(...dated.map(p => +p.date)), tMax = Math.max(...dated.map(p => +p.date));
  const byHour = tMax - tMin <= 3 * 86400000;
  const unit = byHour ? 3600000 : 86400000;
  const d0 = new Date(tMin); if (byHour) d0.setMinutes(0, 0, 0); else d0.setHours(0, 0, 0, 0);
  const start = +d0, n = Math.max(1, Math.ceil((tMax - start + 1) / unit));
  const counts = new Array(n).fill(0), within = new Array(n).fill(0);
  const others = p => { const save = filters.from, st = filters.to; filters.from = filters.to = null; const r = passes(p); filters.from = save; filters.to = st; return r; };
  dated.forEach(p => { const i = Math.min(n - 1, Math.floor((+p.date - start) / unit)); if (others(p)) { counts[i]++; if (!(filters.from || filters.to) || ((!filters.from || p.date >= filters.from) && (!filters.to || p.date <= filters.to))) within[i]++; } });
  Object.assign(TL, { start, step: unit, n });
  const plot = $('tlPlot'), W = plot.clientWidth || 600, H = 54, base = H - 14, max = Math.max(1, ...counts);
  const bw = W / n, gap = bw > 6 ? 2 : 0.5;
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  counts.forEach((c, i) => { if (!c) return; const h = Math.max(3, (c / max) * (base - 2)); svg += `<rect class="bar${within[i] ? ' in' : ''}" x="${(i * bw + gap / 2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${Math.max(1, bw - gap).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${c} photo${c > 1 ? 's' : ''}</title></rect>`; });
  if (filters.from || filters.to) {
    const x0 = Math.max(0, ((filters.from ? +filters.from : start) - start) / (unit * n) * W), x1 = Math.min(W, ((filters.to ? +filters.to : start + unit * n) - start) / (unit * n) * W);
    svg += `<rect class="brush" x="${x0.toFixed(1)}" y="0" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${base}" rx="3"/>`;
  }
  const labelAt = (i, anchor) => { const d = new Date(start + i * unit); return `<text x="${anchor === 'end' ? W : 0}" y="${H - 2}" text-anchor="${anchor}">${byHour ? d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : fmtDay(d)}</text>`; };
  svg += labelAt(0, 'start') + labelAt(n, 'end') + '</svg>';
  plot.innerHTML = svg;
  $('tlTitle').textContent = byHour ? 'Photos par heure' : 'Photos par jour';
  const ranged = filters.from || filters.to;
  $('tlRange').textContent = ranged ? `${filters.from ? fmtDay(filters.from) + (byHour ? ' ' + filters.from.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '') : 'début'} à ${filters.to ? fmtDay(filters.to) + (byHour ? ' ' + filters.to.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '') : 'fin'}` : '';
  $('tlClear').hidden = !ranged;
  requestAnimationFrame(() => document.documentElement.style.setProperty('--tl-h', (tl.offsetHeight + 10) + 'px'));
}
(() => {
  const plot = $('tlPlot'); let drag = null;
  const tAt = x => { const r = plot.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (x - r.left) / r.width)); return TL.start + f * TL.n * TL.step; };
  plot.addEventListener('pointerdown', e => { plot.setPointerCapture(e.pointerId); drag = { x: e.clientX, t: tAt(e.clientX), moved: false }; });
  plot.addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
    if (!drag.moved) return;
    const a = drag.t, b = tAt(e.clientX);
    setRange(new Date(Math.min(a, b)), new Date(Math.max(a, b)), true);
  });
  plot.addEventListener('pointerup', e => {
    if (!drag) return;
    if (!drag.moved) { // clic : sélectionne la barre sous le curseur, ou annule si c'est déjà elle
      const i = Math.min(TL.n - 1, Math.floor((drag.t - TL.start) / TL.step));
      const from = new Date(TL.start + i * TL.step), to = new Date(TL.start + (i + 1) * TL.step - 1);
      if (filters.from && +filters.from === +from && filters.to && +filters.to === +to) setRange(null, null);
      else setRange(from, to);
    }
    drag = null; refresh(false);
  });
  plot.addEventListener('dblclick', () => setRange(null, null));
})();
function setRange(from, to, soft) {
  filters.from = from; filters.to = to;
  $('dFrom').value = from ? isoDay(from) : ''; $('dTo').value = to ? isoDay(to) : '';
  if (soft) { visibleCache = photos.filter(passes); const placed = placedOf(visibleCache); updateStats(visibleCache, placed); renderTimeline(); }
  else refresh(false);
}
$('tlClear').addEventListener('click', () => setRange(null, null));
$('dReset').addEventListener('click', () => setRange(null, null));
$('dFrom').addEventListener('change', e => { filters.from = e.target.value ? new Date(e.target.value + 'T00:00:00') : null; refresh(true); });
$('dTo').addEventListener('change', e => { filters.to = e.target.value ? new Date(e.target.value + 'T23:59:59') : null; refresh(true); });

/* ================= Filtres de la liste ================= */
$('q').addEventListener('input', debounce(e => { filters.q = e.target.value.trim().toLowerCase(); refresh(false); }, 180));
document.querySelectorAll('.chip[data-dev]').forEach(c => c.addEventListener('click', () => {
  const on = c.getAttribute('aria-pressed') !== 'true';
  c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on);
  filters.dev[c.dataset.dev] = on; refresh(false);
}));
$('favOnly').addEventListener('click', e => { filters.fav = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(filters.fav)); refresh(false); });

/* ================= Menus et options ================= */
function popover(btnId, menuId) {
  const b = $(btnId), m = $(menuId);
  b.addEventListener('click', e => { e.stopPropagation(); const open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute('aria-expanded', String(open)); });
  m.addEventListener('click', e => e.stopPropagation());
}
function closeMenus() { document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); document.querySelectorAll('[aria-controls$=Menu]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
popover('layersBtn', 'layersMenu'); popover('exportBtn', 'exportMenu'); popover('d3Btn', 'd3Menu'); popover('hmBtn', 'hmMenu'); popover('vOvl', 'vOvlMenu');
// Les entrées des menus 3D et aide déclenchent les boutons d'origine (cachés), dont tout le reste du code dépend
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { closeMenus(); const t = $(b.dataset.go); if (t) t.click(); }));
document.addEventListener('click', closeMenus);

document.querySelectorAll('input[name=base]').forEach(r => r.addEventListener('change', () => setBase(r.value)));
function bindOpt(id, key, fn) { const el = $(id); el.checked = !!prefs[key]; el.addEventListener('change', () => { prefs[key] = el.checked; savePrefs(); fn && fn(el.checked); }); }
bindOpt('optCadastre', 'cadastre', on => on ? cadastre.addTo(map) : map.removeLayer(cadastre));
bindOpt('optThumbs', 'thumbs', async on => { if (on) await prepareThumbs(); refreshIcons(); });
bindOpt('optCones', 'cones', () => refreshIcons());
bindOpt('optTrack', 'track', on => on ? trackLayer.addTo(map) : map.removeLayer(trackLayer));
bindOpt('optCluster', 'cluster', () => { makeGroup(); refresh(false); });
bindOpt('optAddr', 'addr');
async function prepareThumbs() {
  const vis = placedOf(visible()); let k = 0;
  for (const p of vis) { await ensureThumb(p); if (++k % 5 === 0) status(`Préparation des vignettes : ${k} sur ${vis.length}`, { pct: k / vis.length }); }
  status('');
}
function refreshIcons() { markers.forEach((m, id) => { const p = photos.find(x => x.id === id); if (p) m.setIcon(markerIcon(p, id === selectedId)); }); }

function setTheme(t) {
  document.documentElement.dataset.theme = t; prefs.theme = t; savePrefs();
  try { const f = document.querySelector('#rpView iframe'); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'gt-theme', theme: t }, location.origin); } catch (e) { /* ignoré */ }
  const b = $('themeBtn'); b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = t === 'dark' ? '#0d1b2e' : '#04264b';
}
$('rpBtn').addEventListener('click', () => import('./repereview.js').then(m => m.open({ photos: () => visible() })).catch(e => status('Repérage indisponible : ' + e.message)));
$('themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

/* ================= Panneau ================= */
function applyPanel() { $('app').classList.toggle('panel-off', !prefs.panel); setTimeout(() => map.invalidateSize(), 60); }
const isMobile = () => matchMedia('(max-width: 760px)').matches;
function closeSheet() { $('app').classList.remove('sheet-open'); $('panelToggle').setAttribute('aria-expanded', 'false'); }
function togglePanel() {
  if (isMobile()) { const on = $('app').classList.toggle('sheet-open'); $('panelToggle').setAttribute('aria-expanded', String(on)); }
  else { prefs.panel = !prefs.panel; savePrefs(); applyPanel(); }
}
$('panelToggle').addEventListener('click', togglePanel);

/* ================= Outils de carte ================= */
$('fitBtn').addEventListener('click', fitAll);
function fitAll() { const placed = placedOf(visible()); if (placed.length) map.fitBounds(L.latLngBounds(placed.map(p => [p.lat, p.lon])).pad(0.2), { maxZoom: 19 }); else status('Aucune photo localisée à afficher.', { ms: 2500 }); }
let accuracy;
$('locateBtn').addEventListener('click', () => { status('Recherche de votre position…'); map.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true }); });
map.on('locationfound', e => { status(''); if (accuracy) map.removeLayer(accuracy); accuracy = L.circle(e.latlng, { radius: e.accuracy, color: '#0585c6', weight: 1, fillOpacity: .12, interactive: false }).addTo(map); });
map.on('locationerror', () => status('Position indisponible. Autorisez la localisation dans le navigateur.', { ms: 5000 }));

/* Mesure : longueur du tracé et, à partir de trois points, surface du polygone (en Lambert-93 quand c'est possible). */
const meas = { on: false, pts: [], line: L.polyline([], { color: '#f26b1d', weight: 3, interactive: false }), poly: L.polygon([], { color: '#f26b1d', weight: 0, fillOpacity: .14, interactive: false }), dots: L.layerGroup() };
function polyArea(ll) {
  const xy = ll.map(p => L93.inFrance(p.lat, p.lng) ? L93.to(p.lat, p.lng) : null);
  if (xy.every(Boolean)) { let s = 0; for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
  const R = 6378137, k = Math.PI / 180, lat0 = ll[0].lat * k; // repli : projection plane locale
  const pts = ll.map(p => [(p.lng - ll[0].lng) * k * R * Math.cos(lat0), (p.lat - ll[0].lat) * k * R]);
  let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2;
}
const fmtLen = m => m >= 1000 ? fmt(m / 1000, 2) + ' km' : fmt(m, 1) + ' m';
const fmtArea = a => a >= 10000 ? fmt(a / 10000, 2) + ' ha' : fmt(a, 0) + ' m²';
function measureUpdate() {
  meas.line.setLatLngs(meas.pts); meas.poly.setLatLngs(meas.pts.length > 2 ? meas.pts : []);
  meas.dots.clearLayers(); meas.pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: '#f26b1d', fillOpacity: 1, interactive: false }).addTo(meas.dots));
  let len = 0; for (let i = 1; i < meas.pts.length; i++) len += map.distance(meas.pts[i - 1], meas.pts[i]);
  const r = $('mRead');
  if (!meas.pts.length) r.textContent = 'Cliquez sur la carte pour poser le premier point.';
  else r.textContent = `Longueur ${fmtLen(len)}` + (meas.pts.length > 2 ? `, surface ${fmtArea(polyArea(meas.pts))}` : '');
}
function measureOn(on) {
  if (on && Chantier) Chantier.cancelDraw();
  meas.on = on; $('measureBtn').setAttribute('aria-pressed', String(on)); $('measure').hidden = !on;
  map.getContainer().style.cursor = on ? 'crosshair' : '';
  if (on) { meas.line.addTo(map); meas.poly.addTo(map); meas.dots.addTo(map); measureUpdate(); map.closePopup(); }
  else { [meas.line, meas.poly, meas.dots].forEach(l => map.removeLayer(l)); meas.pts = []; }
}
$('measureBtn').addEventListener('click', () => measureOn(!meas.on));
$('mUndo').addEventListener('click', () => { meas.pts.pop(); measureUpdate(); });
$('mClear').addEventListener('click', () => { meas.pts = []; measureUpdate(); });
$('mDone').addEventListener('click', () => measureOn(false));
map.on('click', e => { if (!meas.on) return; meas.pts.push(e.latlng); measureUpdate(); });
map.on('mousemove', e => {
  const c = $('coords'), ll = e.latlng, l = L93.inFrance(ll.lat, ll.lng) ? '   ' + fmtL93(ll.lat, ll.lng) : '';
  c.textContent = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}${l}`;
});
map.on('mouseout', () => { $('coords').textContent = ''; });
map.on('contextmenu', e => copyText(`${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`, 'Position copiée'));

/* ================= Exports ================= */
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => isoDay(new Date());
const featureOf = p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat].concat(p.alt != null ? [p.alt] : []) },
  properties: { nom: p.name, dossier: p.folder, date: p.date ? p.date.toISOString() : null, appareil: p.model || DEV[p.dev], type_appareil: DEV[p.dev], cap_deg: p.heading != null ? Math.round(p.heading * 10) / 10 : null, favori: isFav(p), note: noteOf(p) || null } });
function toGeoJSON(list) { return JSON.stringify({ type: 'FeatureCollection', name: 'geotrace', features: placedOf(list).map(featureOf) }, null, 2); }
function toCSV(list) {
  const q = v => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['nom', 'dossier', 'date', 'appareil', 'latitude', 'longitude', 'x_lambert93', 'y_lambert93', 'altitude_m', 'cap_deg', 'orientation', 'favori', 'note'];
  const rows = list.map(p => {
    const l = p.lat != null && L93.inFrance(p.lat, p.lon) ? L93.to(p.lat, p.lon) : null;
    return [p.name, p.folder, p.date ? p.date.toISOString() : '', p.model || DEV[p.dev], p.lat != null ? p.lat.toFixed(7) : '', p.lon != null ? p.lon.toFixed(7) : '',
      l ? l.x.toFixed(2) : '', l ? l.y.toFixed(2) : '', p.alt != null ? p.alt.toFixed(1) : '', p.heading != null ? p.heading.toFixed(1) : '', p.heading != null ? cardinal(p.heading) : '', isFav(p) ? 'oui' : '', noteOf(p)].map(q).join(';');
  });
  return '﻿' + [head.join(';'), ...rows].join('\r\n');
}
function toKML(list) {
  const x = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const pm = placedOf(list).map(p => `  <Placemark><name>${x(p.name)}</name><description><![CDATA[${(p.date ? fmtDate(p.date) + '<br>' : '')}${x(p.model || DEV[p.dev])}${p.heading != null ? '<br>Direction ' + Math.round(p.heading) + '° ' + cardinal(p.heading) : ''}${noteOf(p) ? '<br>' + x(noteOf(p)) : ''}]]></description>${p.date ? `<TimeStamp><when>${p.date.toISOString()}</when></TimeStamp>` : ''}<Point><coordinates>${p.lon},${p.lat}${p.alt != null ? ',' + p.alt : ''}</coordinates></Point></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoTrace</name>\n${pm}\n</Document></kml>`;
}
document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
  closeMenus();
  const list = visible();
  if (!list.length) return status('Rien à exporter : aucune photo ne correspond aux filtres.', { ms: 4000 });
  const kind = b.dataset.export;
  if (kind !== 'csv' && !placedOf(list).length) return status('Aucune photo localisée à exporter.', { ms: 4000 });
  if (kind === 'geojson') download(`geotrace-${stamp()}.geojson`, new Blob([toGeoJSON(list)], { type: 'application/geo+json' }));
  else if (kind === 'kml') download(`geotrace-${stamp()}.kml`, new Blob([toKML(list)], { type: 'application/vnd.google-earth.kml+xml' }));
  else if (kind === 'csv') download(`geotrace-${stamp()}.csv`, new Blob([toCSV(list)], { type: 'text/csv;charset=utf-8' }));
  else if (kind === 'zip') {
    const local = list.filter(p => p.kind === 'local' && !p.demo);
    if (!local.length) return status('Le ZIP contient les photos du PC. Chargez des photos locales pour l’utiliser.', { ms: 5000 });
    const zip = new JSZip(), seen = new Set();
    zip.file('geotrace.geojson', toGeoJSON(list)); zip.file('geotrace.csv', toCSV(list));
    local.forEach(p => { let n = p.name, i = 1; while (seen.has(n)) n = p.name.replace(/(\.[^.]+)$/, `-${++i}$1`); seen.add(n); zip.file('photos/' + n, p.blob); });
    status('Création du ZIP…', { pct: 0 });
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => status('Création du ZIP…', { pct: m.percent / 100 }));
    status(''); download(`geotrace-${stamp()}.zip`, blob);
  }
  if (kind !== 'zip') status(`Export de ${kind === 'csv' ? list.length : placedOf(list).length} photos prêt.`, { ms: 2500 });
}));

/* ================= Entrées : fichiers, dépôt, accueil ================= */
$('pickFolder').addEventListener('click', () => $('folderInput').click());
$('pickFiles').addEventListener('click', () => $('filesInput').click());
$('pickZip').addEventListener('click', () => $('zipInput').click());
$('addBtn').addEventListener('click', () => $('filesInput').click());
$('sourceBtn').addEventListener('click', () => { $('welErr').hidden = true; showWelcome(true); });
$('welClose').addEventListener('click', () => showWelcome(false));
document.querySelector('.brand').addEventListener('click', e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); $('welErr').hidden = true; showWelcome(true); });
$('demoBtn').addEventListener('click', loadDemo);
$('folderInput').addEventListener('change', e => { const fl = e.target.files, f = fl[0]; loadFileList(fl, f && f.webkitRelativePath ? 'Dossier : ' + f.webkitRelativePath.split('/')[0] : 'Dossier du PC'); e.target.value = ''; });
$('zipInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFileList([f], 'ZIP : ' + f.name); e.target.value = ''; });
$('filesInput').addEventListener('change', e => { const append = photos.length > 0 && $('welcome').hidden; loadFileList(e.target.files, append ? $('srcName').textContent : 'Photos choisies', append); e.target.value = ''; });
$('linkForm').addEventListener('submit', e => {
  e.preventDefault(); $('linkErr').hidden = true;
  const s = parseShare($('linkInput').value.trim());
  if (!s) return linkError('Ce n’est pas un lien de partage. Il doit contenir « /s/ » suivi d’un code (créé avec « Partager via un lien »).');
  s.password = $('pwdInput').value || null;
  share = s; loadShare();
});

let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('dropHint').hidden = false; $('dropzone').classList.add('over'); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').hidden = true; $('dropzone').classList.remove('over'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('dropHint').hidden = true; $('dropzone').classList.remove('over');
  const entries = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  let files, label = 'Fichiers déposés';
  if (entries.length) {
    const dir = entries.find(en => en.isDirectory); if (dir) label = 'Dossier : ' + dir.name;
    files = (await Promise.all(entries.map(en => readEntry(en, '')))).flat();
  } else files = [...e.dataTransfer.files];
  const append = photos.length > 0 && $('welcome').hidden;
  loadFileList(files, append ? $('srcName').textContent : label, append);
});

/* ---------- Fond de l'accueil : courbes de niveau ---------- */
let contoursDone = false;
function drawContours() {
  const svg = $('contours');
  if (contoursDone) return; contoursDone = true;
  const W = 1600, H = 1000; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let out = '';
  const cx = W * .78, cy = H * .38, N = 16;
  for (let k = 1; k <= N; k++) {
    const pts = [];
    for (let a = 0; a <= 360; a += 6) {
      const t = a * Math.PI / 180;
      const wob = 1 + .16 * Math.sin(3 * t + k * .35) + .09 * Math.sin(5 * t - k * .2) + .05 * Math.cos(7 * t + k);
      const r = k * 62 * wob;
      pts.push([cx + Math.cos(t) * r * 1.35, cy + Math.sin(t) * r * .95]);
    }
    out += `<path style="--i:${k}" d="M${pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L')} Z"/>`;
  }
  svg.innerHTML = out;
  svg.querySelectorAll('path').forEach(p => { try { p.style.setProperty('--len', Math.ceil(p.getTotalLength())); } catch (e) { p.style.setProperty('--len', 4000); } });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(() => svg.classList.add('draw'));
}


/* ================= Maquette 3D (Revit) ================= */
let Maq = null, calMode = null, pending = null, modelTouched = false, siteFar = null, modelFp = 0;           // calMode : null, 'model' (clic sur la maquette) ou 'map' (clic sur la carte)
const calLayer = L.layerGroup().addTo(map);
const maqError = t => { const e = $('maqErr'); e.hidden = !t; e.textContent = t || ''; };
async function maq() {
  if (Maq) return Maq;
  status('Chargement du module 3D…');
  try { Maq = await import('./maquette.js'); Maq.attachMap(map); Maq.setChantierProvider(() => Chantier ? Chantier.exportData() : null); }
  catch (e) { status(''); maqError('Le module 3D n’a pas pu démarrer. Il faut un navigateur récent avec WebGL.'); console.error(e); throw e; }
  status(''); return Maq;
}
const saveCalage = () => { const m = Maq && Maq.state.model; if (m) store.set('geotrace:calage:' + m.name, Maq.state.geo.auto ? null : Object.assign(JSON.parse(Maq.exportCalage()), { fp: modelFp })); }; // un placement automatique se relit dans la maquette, on ne le fige pas
function setMaqPanel(on) { $('maqPanel').hidden = !on; $('maqBtn').setAttribute('aria-expanded', String(on)); }
$('maqBtn').addEventListener('click', () => setMaqPanel($('maqPanel').hidden));
$('vue3dBtn').addEventListener('click', () => open3d(null));
$('maqClose').addEventListener('click', () => setMaqPanel(false));
$('maqPick').addEventListener('click', () => $('maqFile').click());
$('maqFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) openModel(await f.arrayBuffer(), f.name); });
if (CFG.maquetteLien) $('maqLink').value = CFG.maquetteLien;

async function openModel(buffer, name, calText, opts = {}) {
  modelTouched = true; maqError('');
  const M = await maq();
  status('Lecture de la maquette…');
  let info;
  try { info = await M.loadModel(buffer, name); }
  catch (e) { status(''); maqError('Cette maquette n’a pas pu être lue. Vérifiez que c’est un export IFC ou GLB.'); console.error(e); return; }
  status('');
  const c = map.getCenter();
  M.state.geo = { pairs: [], angle: 0, fixScale: true };
  M.setFrameAt(c.lat, c.lng);
  modelFp = buffer.byteLength; // empreinte du fichier : un calage gardé dans le navigateur ne vaut que pour ce fichier-là
  let saved = store.get('geotrace:calage:' + name, null);
  if (saved && saved.fp !== modelFp && (saved.fp || M.state.georef)) saved = null; // fichier ré-exporté depuis Revit : on relit sa position plutôt qu'un ancien calage
  for (const text of [calText, saved && JSON.stringify(saved)]) { if (!text) continue; try { M.importCalage(text); break; } catch (e) { /* calage illisible : suivant */ } }
  if (Chantier) Chantier.setProject(M.getProjChantier(), name);
  const fromCal = M.state.geo.pairs.length > 0;
  siteFar = null;
  if (!fromCal && M.state.georef) { // rien d'enregistré : on lit la position dans les coordonnées de Revit
    const gr = M.state.georef, ps = photos.filter(p => p.lat != null);
    if (gr.source === 'IfcSite' && ps.length) { // lieu par défaut de Revit, loin du chantier : on ne place pas la maquette au mauvais endroit
      const cl = ps.reduce((s, p) => s + p.lat, 0) / ps.length, co = ps.reduce((s, p) => s + p.lon, 0) / ps.length;
      const d = map.distance([cl, co], gr.site); if (d > 25000) siteFar = { km: Math.round(d / 1000), ll: gr.site };
    }
    if (!siteFar) M.applyGeoref();
  }
  closeCal();
  M.refreshOverlay(); maqUi(info);
  if (!opts.noSave) idbSet({ name, buffer });
  const auto = M.state.geo.auto;
  if (M.isPlaced()) {
    if (!opts.quiet) { const b = M.mapBounds(); if (b) map.fitBounds(L.latLngBounds(b).pad(.4), { maxZoom: 19 }); }
    status(auto ? 'Maquette placée d’après les coordonnées de Revit.' : 'Maquette placée d’après le calage enregistré.', { ms: 4000 });
  } else status('Maquette lue. Ajoutez au moins 2 points de calage pour la placer.', { ms: 6000 });
  if (!opts.quiet) setMaqPanel(true);
}
function maqUi(info) {
  const M = Maq, m = M && M.state.model;
  $('maqEmpty').hidden = !!m; $('maqLoaded').hidden = !m;
  calLayer.clearLayers();
  if (!m) return;
  if (info) { $('maqName').textContent = m.name; $('maqInfo').textContent = `${m.kind}, ${fmt(info.meshes, 0)} éléments, ${fmt(info.size[0], 0)} × ${fmt(info.size[1], 0)} m, hauteur ${fmt(info.size[2], 0)} m`; }
  const g = M.state.geo, sol = M.state.sol, n = g.pairs.length;
  $('maqAngle').value = g.angle; $('maqScale').checked = g.fixScale;
  $('maqAngleRow').hidden = n > 1;
  const ul = $('maqPts'); ul.textContent = '';
  g.pairs.forEach((p, i) => {
    const li = document.createElement('li'), a = document.createElement('span'), t = document.createElement('span'), b = document.createElement('button');
    a.className = 'n'; a.textContent = i + 1;
    const r = sol && sol.residuals && sol.residuals[i] != null && n > 1 ? `, écart ${fmt(sol.residuals[i], 2)} m` : '';
    t.innerHTML = `Maquette ${esc(fmt(p.m[0], 1))} ; ${esc(fmt(p.m[1], 1))}<small>${p.ll[0].toFixed(6)}, ${p.ll[1].toFixed(6)}${esc(r)}</small>`;
    b.type = 'button'; b.setAttribute('aria-label', `Supprimer le point ${i + 1}`); b.innerHTML = icon('close', 16);
    b.addEventListener('click', () => { g.auto = false; g.pairs.splice(i, 1); if (!g.pairs.length) { const c = map.getCenter(); M.setFrameAt(c.lat, c.lng); } afterCal(); });
    li.append(a, t, b); ul.appendChild(li);
    L.marker(p.ll, { icon: L.divIcon({ className: '', html: `<div class="cal-dot" style="width:22px;height:22px">${i + 1}</div>`, iconSize: [22, 22] }), interactive: false, keyboard: false }).addTo(calLayer);
  });
  const gr = M.state.georef, geo = $('maqGeo');
  geo.hidden = !gr;
  if (gr) {
    const lab = gr.crs ? M.crsLabel(gr.crs) : (gr.crsName || 'inconnu');
    const usable = !!(gr.crs && M.georefPairs());
    $('maqGeoTxt').textContent = !gr.crs ? `Ce fichier est géoréférencé dans un système que GeoTrace ne connaît pas (${lab}). Placez la maquette avec des points de calage.`
      : gr.source === 'IfcSite' ? (g.auto ? 'Placée d’après le lieu du projet défini dans Revit. Position approximative (quelques dizaines de mètres) : pour la précision, donnez à Revit les coordonnées du géomètre.'
        : siteFar ? `Revit place ce projet à ${siteFar.ll[0].toFixed(3)}, ${siteFar.ll[1].toFixed(3)}, à ${siteFar.km} km de vos photos : c’est sans doute le lieu par défaut. Dans Revit, Gérer, Emplacement : indiquez l’adresse du chantier puis ré-exportez.` : 'Placez la maquette avec des points de calage.')
      : !usable && !g.auto ? `Le fichier indique un système (${M.crsLabel(gr.crs)}) mais pas de vraie position : la maquette est à l’origine (0 ; 0). Dans Revit, donnez au projet les coordonnées du géomètre puis ré-exportez, ou placez la maquette avec des points de calage.`
      : g.auto ? `Placée d’après les coordonnées enregistrées dans Revit (${M.crsLabel(g.auto)}${gr.corrected ? `, le fichier annonçait ${gr.corrected} mais les valeurs sont celles de ce système` : ''}). Position du centre : ${(() => { const b = M.state.model.box, c = M.modelToLatLon([(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2]); return c ? c[0].toFixed(5) + ', ' + c[1].toFixed(5) : ''; })()}.`
      : `Ce fichier contient des coordonnées géographiques (${lab}). Vous pouvez y placer la maquette automatiquement.`;
    $('maqUseGeo').hidden = !usable || !!g.auto || !!siteFar;
    const sel = $('maqCrs'), multi = gr.candidates.length > 1;
    $('maqCrsRow').hidden = !multi;
    if (multi) { sel.textContent = ''; gr.candidates.forEach(c => sel.add(new Option(M.crsLabel(c), c))); sel.value = g.auto || gr.crs; }
  }
  const st = $('maqState'); st.className = 'mq-state';
  if (!n) st.textContent = 'Aucun point de calage. Il en faut au moins 2 : un point de la maquette et le même point sur la carte.';
  else if (n === 1) st.textContent = 'Un seul point : la maquette est placée à cet endroit avec l’orientation saisie ci-dessous. Un deuxième point la cale précisément.';
  else if (sol) {
    st.classList.add('ok');
    const q = sol.rms < 1 ? 'bon calage' : sol.rms < 3 ? 'à vérifier' : 'écart important, vérifiez les points';
    st.textContent = `Maquette calée. Écart moyen ${fmt(sol.rms, 2)} m, ${q}.` + (g.fixScale ? '' : ` Échelle ${fmt(sol.s, 4)}.`);
  } else st.textContent = 'Les points sont trop proches l’un de l’autre. Choisissez des points éloignés.';
  const placed = M.isPlaced();
  $('maq3d').disabled = !placed; $('maqZoom').disabled = !placed;
  $('maqBtn').classList.toggle('on', !!m);
}
function afterCal() { if (Chantier) Chantier.setProject(Maq.getProjChantier(), Maq.state.model ? Maq.state.model.name : ''); Maq.refreshOverlay(); saveCalage(); maqUi(); planUpdate(); }
const zoomModel = () => { const b = Maq && Maq.mapBounds(); if (b) map.fitBounds(L.latLngBounds(b).pad(.4), { maxZoom: 19 }); };
$('maqUseGeo').addEventListener('click', () => { if (Maq && Maq.applyGeoref($('maqCrs').value || null)) { afterCal(); zoomModel(); } });
$('maqCrs').addEventListener('change', e => { if (Maq && Maq.applyGeoref(e.target.value)) { afterCal(); zoomModel(); } });
$('maqShow').addEventListener('change', e => Maq && Maq.setVisible(e.target.checked));
$('maqOpacity').addEventListener('input', e => Maq && Maq.setOpacity(e.target.value / 100));
$('maqAngle').addEventListener('change', e => { if (!Maq) return; Maq.state.geo.angle = +e.target.value || 0; afterCal(); });
$('maqScale').addEventListener('change', e => { if (!Maq) return; Maq.state.geo.fixScale = e.target.checked; afterCal(); });
$('maqZoom').addEventListener('click', () => { const b = Maq && Maq.mapBounds(); if (b) map.fitBounds(L.latLngBounds(b).pad(.4), { maxZoom: 20 }); });
$('maqRemove').addEventListener('click', () => { idbDel(); if (!Maq) return; closeCal(); Maq.unloadModel(); Maq.refreshOverlay(); maqUi(); maqError(''); });
$('maqExport').addEventListener('click', () => {
  const m = Maq && Maq.state.model; if (!m) return;
  download(m.name.replace(/\.[^.]+$/, '') + '.geotrace.json', new Blob([Maq.exportCalage()], { type: 'application/json' }));
  status('Calage exporté. Déposez-le à côté de la maquette sur Nextcloud : GeoTrace le relira tout seul.', { ms: 6000 });
});
$('maqImport').addEventListener('click', () => $('maqCalFile').click());
$('maqCalFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !Maq) return;
  try { Maq.importCalage(await f.text()); afterCal(); const b = Maq.mapBounds(); if (b) map.fitBounds(L.latLngBounds(b).pad(.4), { maxZoom: 19 }); maqError(''); }
  catch (er) { maqError('Ce fichier n’est pas un calage GeoTrace.'); }
});

/* Calage : clic sur la maquette, puis clic sur la carte au même endroit. */
async function startCal() {
  const M = await maq(); if (!M.state.model) return;
  if (meas.on) measureOn(false);
  calMode = 'model'; pending = null;
  $('maqPlan').hidden = false;
  M.openPlan($('maqPlanView'), { onPick: w => { if (calMode !== 'model') return; pending = w; calMode = 'map'; planUpdate(); } });
  planUpdate();
}
function planUpdate() {
  const M = Maq; if (!M || !calMode) return;
  M.planSet(M.state.geo.pairs.map(p => ({ m: p.m })), pending);
  map.getContainer().style.cursor = calMode === 'map' ? 'crosshair' : '';
  const n = M.state.geo.pairs.length;
  $('maqPlanMsg').textContent = calMode === 'model'
    ? (n ? `Point ${n} placé. Cliquez le point suivant sur la maquette, ou terminez.` : 'Cliquez un point reconnaissable de la maquette (angle de bâtiment, regard).')
    : `Cliquez maintenant le même point sur la carte (point ${n + 1}).`;
}
function closeCal() { calMode = null; pending = null; $('maqPlan').hidden = true; map.getContainer().style.cursor = ''; if (Maq) Maq.closePlan(); }
$('maqAdd').addEventListener('click', startCal);
$('maqPlanDone').addEventListener('click', closeCal);
map.on('click', e => {
  if (calMode !== 'map' || !pending) return;
  const gg = Maq.state.geo; if (gg.auto) { gg.pairs = []; gg.auto = false; } // le point saisi à la main remplace le placement automatique
  gg.pairs.push({ m: pending, ll: [e.latlng.lat, e.latlng.lng] });
  pending = null; calMode = 'model';
  afterCal();
});

/* Vue 3D */
let Chantier = null, pendingPlan = null;
const setPlan = (blob, name) => { pendingPlan = { blob, name }; if (Chantier) Chantier.setPlanning(blob, name); };
import('./chantier.js').then(m => { Chantier = m; m.init({ map, status, stopOthers: () => measureOn(false), categories: () => Maq ? Maq.modelCategories() : [], setPhase3d: (list, cur) => { if (Maq) { Maq.setPhasesData(list); Maq.setPhase(cur); } fillPhase3d(); } }); m.onPhase(() => fillPhase3d()); if (pendingPlan) m.setPlanning(pendingPlan.blob, pendingPlan.name); if (Maq) m.setProject(Maq.getProjChantier(), Maq.state.model ? Maq.state.model.name : ''); }).catch(e => console.warn('chantier', e));
async function open3d(focusId) {
  const M = await maq();
  if (!M.isPlaced()) { setMaqPanel(true); maqError(M.state.model ? 'Placez d’abord la maquette avec au moins 2 points de calage.' : 'Importez d’abord une maquette (fichier IFC exporté de Revit).'); return; }
  if (!$('viewer').hidden) closeViewer();
  map.closePopup();
  const ph = placedOf(visible());
  await Promise.all(ph.slice(0, 80).map(p => ensureThumb(p).catch(() => {})));
  const list = ph.map(p => ({ id: p.id, name: p.name, key: p.key, lat: p.lat, lon: p.lon, heading: p.heading, pitch: p.pitch, f35: p.f35, dev: p.dev, rel: p.rel, t: p.date ? +p.date / 1000 : null, tex: p.kind === 'local' ? p.thumb : null }));
  $('v3d').hidden = false; document.body.style.overflow = 'hidden';
  $('v3Pip').hidden = true; $('v3Elem').hidden = true; setBlend(false);
  status('Préparation de la vue 3D…');
  try { await M.open3D($('v3Host'), { photos: list, focus: null, zones: Chantier ? Chantier.getZones() : [], zoneColors: Chantier ? Chantier.COLORS : null, devs: Chantier ? Chantier.getDevs() : [], devColors: Chantier ? Chantier.DEV_COLORS : null, phases: Chantier ? Chantier.getPhases() : [], phaseId: Chantier ? Chantier.getPhase() : null, nets: Chantier ? Chantier.getNets() : [], netColors: Chantier ? Chantier.NET_COLORS : null, engins: Chantier ? Chantier.getEngins3d() : [], enginsBase: Chantier ? Chantier.MODELS_BASE : undefined, onPhoto: alignPhoto, onElement: showElem, onNote: showNote }); }
  catch (e) { console.error(e); close3d(); status('La vue 3D n’a pas pu démarrer sur cet appareil.', { ms: 5000 }); return; }
  status('');
  fillPhase3d(); { const n = Chantier ? Chantier.getNets().length : 0; $('v3NetsL').hidden = !n; $('v3Nets').checked = true; }
  $('v3Title').textContent = 'Maquette en 3D';
  buildStrip();
  $('v3Ground').checked = true;
  if (focusId) alignPhoto(focusId);
  $('v3Close').focus();
}
function close3d() { if (Maq) Maq.close3D(); $('v3d').hidden = true; document.body.style.overflow = ''; }
function showNote(t) { const el = $('v3Elem'); el.hidden = !t; el.textContent = t || ''; }
function showElem(info) {
  const el = $('v3Elem'); el.hidden = !info;
  const ph = Chantier ? Chantier.getPhases() : [];
  if (info) el.innerHTML = `<b>${esc(info.name || 'Élément sans nom')}</b>${esc(info.type || '')}${info.tag ? ', ' + esc(info.tag) : ''}`
    + (ph.length && info.id != null ? `<span class="el-ph"><select id="elPhase" aria-label="Phase">${ph.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button type="button" id="elAdd" data-id="${info.id}">Ajouter à la phase</button></span>` : '');
}
$('v3Elem').addEventListener('click', e => { const b = e.target.closest('#elAdd'); if (!b || !Chantier) return; if (Chantier.addToPhase($('elPhase').value, +b.dataset.id)) { Chantier.refreshPhases(); b.textContent = 'Ajouté'; b.disabled = true; } });
function fillPhase3d() {
  const L = $('v3PhaseL'), sel = $('v3Phase'); if (!L || !Chantier) return;
  const list = Chantier.getPhases().map((p, i) => [p, i]).sort((a, b) => (a[0].start || '9999').localeCompare(b[0].start || '9999') || a[1] - b[1]).map(x => x[0]);
  L.hidden = !list.length;
  sel.innerHTML = '<option value="">Toutes</option>' + list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = Chantier.getPhase() || '';
}
$('v3Phase').addEventListener('change', e => { if (Chantier) Chantier.setPhase(e.target.value || null, true); });
/* Bandeau de photos : miniature + nom, avec recherche. Un clic sur une photo y fait entrer la caméra. Les plus proches de la maquette d'abord. */
const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let stripItems = [];
function buildStrip() {
  const list = $('v3List'); list.textContent = ''; $('v3Find').value = '';
  const ids = (Maq ? Maq.v3Near() : []).slice(0, 400);
  stripItems = [];
  ids.forEach(id => {
    const p = photos.find(x => x.id === id); if (!p) return;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id; b.title = p.name; b.className = 'dev-' + p.dev;
    const th = document.createElement('span'); th.className = 'th'; if (p.thumb) th.style.backgroundImage = `url("${p.thumb}")`;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
    b.append(th, nm); b.addEventListener('click', () => alignPhoto(id)); list.appendChild(b);
    stripItems.push({ p, b, th, n: norm(p.name) });
  });
  $('v3Strip').hidden = !stripItems.length; filterStrip();
}
function filterStrip() {
  const q = norm($('v3Find').value.trim()); let shown = 0;
  stripItems.forEach(it => {
    const ok = q ? it.n.includes(q) : true; it.b.hidden = !ok; if (!ok) return; shown++;
    if (!it.p.thumb && !it.th.dataset.t) { it.th.dataset.t = '1'; ensureThumb(it.p).then(() => { if (it.p.thumb) it.th.style.backgroundImage = `url("${it.p.thumb}")`; }).catch(() => {}); }
  });
  $('v3Count').textContent = q ? `${shown} sur ${stripItems.length}` : `${stripItems.length} photos`;
  $('v3List').scrollLeft = 0;
}
$('v3Find').addEventListener('input', filterStrip);
function markStrip(id) {
  const st = $('v3List'); st.querySelectorAll('.on').forEach(b => b.classList.remove('on'));
  const b = st.querySelector(`[data-id="${id}"]`); if (b) { b.classList.add('on'); if (!b.hidden) b.scrollIntoView({ inline: 'center', block: 'nearest' }); }
}
const HINT_FREE = $('v3Hint').textContent;
const HINT_LOCK = 'Superposition : Glisser : orienter · Maj + glisser : déplacer · Molette : zoom · Double-clic : annuler le calage · ← → : photo suivante · Échap ou ✕ : retour à la vue 3D.';
function setBlend(on) {
  $('v3Blend').setAttribute('aria-pressed', String(on)); $('v3Pip').classList.toggle('blend', on); $('v3Alpha').hidden = !on;
  $('v3Hint').textContent = on ? HINT_LOCK : HINT_FREE; $('v3d').classList.toggle('locked', on); $('v3Calib').hidden = !on; $('v3Share').hidden = $('v3Near').hidden = $('v3Clear').hidden = $('v3Save').hidden = !on;
  const x = $('v3Close'); x.title = x.ariaLabel = on ? 'Revenir à la vue 3D' : 'Fermer';
}
/* Sortir de la superposition sans quitter la 3D. */
function back3d() { if (Maq) Maq.v3Release(); setBlend(false); $('v3List').querySelectorAll('.on').forEach(b => b.classList.remove('on')); }
/* Affiche la photo et renvoie son rapport largeur / hauteur tel qu'elle apparaît (orientation EXIF comprise). */
async function showPip(id) {
  const p = photos.find(x => x.id === id); if (!p) return null;
  const fig = $('v3Pip'); fig.hidden = false; fig.dataset.pid = id;
  $('v3PipName').textContent = p.name;
  const u = await displayUrl(p);
  if (fig.dataset.pid !== id) return null;
  const img = $('v3PipImg'); img.src = u || '';
  try { await img.decode(); } catch (e) { /* image illisible */ }
  return img.naturalWidth ? img.naturalWidth / img.naturalHeight : null;
}
/* Clic sur une photo : on reste en 3D, la caméra se place comme à la prise de vue et la photo se superpose à la maquette. */
async function alignPhoto(id) {
  const asp = await showPip(id); if (!Maq || $('v3d').hidden || $('v3Pip').dataset.pid !== id) return;
  markStrip(id);
  if (await Maq.v3FromPhoto(id, asp) && $('v3Pip').dataset.pid === id) setBlend(true);
}
$('v3Close').addEventListener('click', () => { if ($('v3d').classList.contains('locked')) back3d(); else close3d(); });
$('v3Near').addEventListener('click', () => { const n = Maq ? Maq.v3ShareNear() : 0; showNote(n ? `Réglage appliqué aux ${n} photos prises dans les 2 minutes autour.` : 'Aucune autre photo prise dans les 2 minutes autour.'); setTimeout(() => showNote(''), 3500); });
$('v3Share').addEventListener('click', () => { const n = Maq ? Maq.v3Share() : 0; showNote(n ? `Réglage appliqué aux ${n} autres photos du même type d’appareil.` : 'Rien à appliquer.'); setTimeout(() => showNote(''), 3500); });
$('v3Clear').addEventListener('click', () => { if (Maq) Maq.v3ClearAll(); showNote('Réglages de toutes les photos annulés.'); setTimeout(() => showNote(''), 3500); });
$('v3Save').addEventListener('click', () => { $('maqExport').click(); showNote('Fichier de calage enregistré. Déposez-le à côté de la maquette sur Nextcloud : tout le monde verra la maquette bien placée.'); setTimeout(() => showNote(''), 7000); });
$('v3In').addEventListener('click', () => Maq && Maq.v3Zoom(1.4));
$('v3Out').addEventListener('click', () => Maq && Maq.v3Zoom(1 / 1.4));
$('v3Top').addEventListener('click', () => Maq && Maq.v3Top());
$('maq3d').addEventListener('click', () => open3d(null));
$('v3Over').addEventListener('click', () => { if (Maq) Maq.v3Overview(); setBlend(false); $('v3List').querySelectorAll('.on').forEach(b => b.classList.remove('on')); });
$('v3Nets').addEventListener('change', e => Maq && Maq.v3Nets(e.target.checked));
$('v3Ground').addEventListener('change', e => Maq && Maq.v3Ground(e.target.checked));
$('v3Here').addEventListener('click', () => alignPhoto($('v3Pip').dataset.pid));
$('v3Blend').addEventListener('click', e => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  if (on) alignPhoto($('v3Pip').dataset.pid); else back3d();
});
$('v3Alpha').addEventListener('input', e => $('v3d').style.setProperty('--m', e.target.value / 100));
document.addEventListener('keydown', e => {
  if ($('v3d').hidden || !Maq || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || e.target.id === 'v3Find') return;
  const id = Maq.v3Step(e.key === 'ArrowRight' ? 1 : -1); if (id) { e.preventDefault(); alignPhoto(id); }
});

/* Maquette sur Nextcloud : lien d'un fichier .ifc/.glb ou d'un dossier. Un fichier « nom.geotrace.json » à côté donne le calage. */
/* Trouve la maquette dans le dossier ou le lien partagé en cours (`share`) et la télécharge, avec son calage s'il y en a un. */
async function shareModel(models, cals) {
  const get = async url => { const r = await fetch(url, { headers: authH() }); if (!r.ok) throw Object.assign(new Error('http'), { code: r.status }); return r; };
  let buf, name;
  if (models.length) { name = models[0].split('/').pop(); status(`Téléchargement de ${name}…`); buf = await (await get(davRoot() + encPath(models[0]))).arrayBuffer(); }
  else { // lien direct vers un fichier
    const r = await get(davRoot()); buf = await r.arrayBuffer();
    const cd = (r.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    name = cd ? decodeURIComponent(cd[1]) : (new TextDecoder().decode(buf.slice(0, 4)) === 'glTF' ? 'maquette.glb' : 'maquette.ifc');
  }
  let calText = null;
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
  const calPath = cals.find(c => c.split('/').pop().toLowerCase() === stem + '.geotrace.json') || cals[0];
  if (calPath) { try { calText = await (await get(davRoot() + encPath(calPath))).text(); } catch (er) { /* calage absent : on continue */ } }
  status('');
  return { buf, name, calText };
}
/* Maquette sur Nextcloud : lien d'un fichier .ifc/.glb ou d'un dossier. Un fichier « nom.geotrace.json » à côté donne le calage. */
async function loadMaquetteShare(text, pwd, opts = {}) {
  maqError('');
  const s = parseShare(String(text).trim());
  if (!s) { maqError('Ce n’est pas un lien de partage. Il doit contenir « /s/ » suivi d’un code.'); return false; }
  s.password = pwd || null;
  const prev = share; share = s;
  try {
    status('Recherche de la maquette…');
    let models = [], cals = [];
    try {
      const all = await walk('/', 0, [], /\.(ifc|glb|gltf|geotrace\.json)$/i);
      models = all.filter(x => MODEL_RE.test(x)); cals = all.filter(x => CAL_RE.test(x));
    } catch (er) { if (er.code === 401 || er.code === 404) throw er; }
    const r = await shareModel(models, cals);
    await openModel(r.buf, r.name, r.calText, opts);
    return true;
  } catch (er) {
    status('');
    if (er.code === 401) { $('maqPwd').hidden = false; maqError('Ce lien est protégé. Saisissez son mot de passe puis validez.'); }
    else if (er.code === 404) maqError('Ce lien a expiré ou n’existe pas. Demandez un nouveau lien de partage.');
    else maqError('Le serveur Nextcloud refuse la lecture depuis cette page. Installez GeoTrace sur le serveur ou téléchargez la maquette pour l’ouvrir depuis le PC.');
    return false;
  } finally { share = prev; }
}
$('maqForm').addEventListener('submit', e => { e.preventDefault(); loadMaquetteShare($('maqLink').value, $('maqPwd').value); });

/* Maquette trouvée à côté des photos (dossier, glisser-déposer ou ZIP) : elle se charge toute seule. */
async function autoModel({ models, cals }) {
  if (!models.length) return;
  const f = models.find(x => /\.ifc$/i.test(x.name)) || models[0];
  const stem = f.name.replace(/\.[^.]+$/, '').toLowerCase();
  const cal = cals.find(c => c.name.toLowerCase() === stem + '.geotrace.json') || cals[0];
  try { await openModel(await f.arrayBuffer(), f.name, cal ? await cal.text() : null, { quiet: true }); }
  catch (er) { console.warn('maquette du dossier illisible', er); }
}
/* À l'ouverture : lien Nextcloud de la configuration, sinon la dernière maquette gardée dans ce navigateur. */
async function restoreModel() {
  if (qp.get('maquette') || modelTouched) return;
  if (CFG.maquetteLien && await loadMaquetteShare(CFG.maquetteLien, null, { quiet: true })) return;
  maqError('');
  const rec = await idbGet();
  if (rec && rec.buffer && !modelTouched) await openModel(rec.buffer, rec.name, null, { quiet: true, noSave: true });
}

{ const sp = $('splash'); if (sp) { const end = () => { sp.remove(); removeEventListener('keydown', end); }; if (/[?&]nosplash\b/.test(location.search)) end(); else { sp.addEventListener('animationend', e => { if (e.animationName === 'sp-out') end(); }); sp.addEventListener('click', end); addEventListener('keydown', end); setTimeout(end, 9000); } } }
window.GeoTrace = { version: VERSION, maquette: () => Maq, map }; // accès pour les tests et la console


/* ================= Tuto guidé ================= */
(() => {
  const demoPip = (btns, note) => `<div class="row pip-acts">${btns}</div>${note ? `<small>${note}</small>` : ''}`;
  const S = [
    { sel: '#sourceBtn', t: 'Ouvrir des photos', x: 'Ce bouton charge vos photos : un dossier, des photos choisies ou un ZIP. Vous pouvez aussi les glisser sur la page. Seules celles qui contiennent une position GPS apparaissent sur la carte.' },
    { sel: '#map', t: 'La carte', x: 'Chaque photo est un repère sur la carte. Cliquez un repère pour la voir en grand. Le cône indique la direction de prise de vue quand l’appareil l’a enregistrée. Les photos proches sont regroupées : zoomez pour les séparer.' },
    { sel: '#panel', t: 'La liste des photos', x: 'Toutes les photos sont ici, avec leur date et leur direction. Cliquez une ligne pour centrer la carte dessus. La touche L affiche ou masque cette liste.' },
    { sel: '#panel .p-head', t: 'Chercher et filtrer', x: 'Tapez un nom, un dossier ou une note dans la zone de recherche (touche /). Les pastilles Téléphone, Tablette et Drone masquent un type d’appareil ; Favoris garde les photos marquées d’une étoile ; Du / au limite la période.' },
    { sel: '#timeline', t: 'La chronologie', x: 'Les barres comptent les photos par heure. Faites glisser sur la frise pour ne garder qu’une période. « Tout afficher » rétablit la liste complète.', note: 'Elle apparaît dès que les photos sont datées.' },
    { sel: '.tools', t: 'Les outils de la carte', x: 'De haut en bas : « Tout voir » (F) cadre toutes les photos, « Mesurer » (M) trace une longueur puis une surface dès trois points, « Ma position » centre la carte sur vous.' },
    { sel: ['#layersBtn', '#layersMenu'], t: 'Fond de carte et calques', x: 'Choisissez entre la photo aérienne et le plan de l’IGN. En dessous : parcelles cadastrales, vignettes sur les repères, direction de prise de vue, parcours dans l’ordre des prises.', pre: () => { closeMenus(); $('layersMenu').hidden = false; $('layersBtn').setAttribute('aria-expanded', 'true'); }, post: () => closeMenus() },
    { sel: ['#chBtn', '#chPanel'], t: 'Installations de chantier', x: 'Dessinez sur la carte les zones d’installation : base vie, dépôt, décharge, stockage, parking, accès. Choisissez un type, puis tracez un rectangle (deux clics) ou un polygone. Vous pouvez les renommer, les modifier ou les supprimer dans la liste. En vue 3D, chaque zone devient un ensemble d’objets réels : cabines, conteneurs, bennes, tuyaux, véhicules, clôture.', pre: () => { if ($('chPanel').hidden) { $('chBtn').click(); tourOpened.ch = true; } }, post: () => { if (tourOpened.ch) { $('chClose').click(); tourOpened.ch = false; } } },
    { sel: ['#chBtn', '#chPanel'], t: 'Déviations', x: 'Dans « Chantier », l’onglet Déviations : choisissez le type (véhicules, piétons, alternat, route barrée), cliquez les points du parcours, double-clic pour finir. Réglez la largeur, inversez le sens ou déplacez les points. En 3D : chaussée provisoire, flèches, panneaux, cônes, barrières ou feux.', pre: () => { if ($('chPanel').hidden) { $('chBtn').click(); tourOpened.ch = true; } document.querySelector('#chTabs button[data-tab=d]').click(); }, post: () => { document.querySelector('#chTabs button[data-tab=z]').click(); if (tourOpened.ch) { $('chClose').click(); tourOpened.ch = false; } } },
    { sel: ['#chBtn', '#chPanel'], t: 'Phases', x: 'L’onglet Phases découpe le chantier : dates, installations et déviations présentes, éléments de la maquette construits pendant la phase, et page du planning PDF (trouvé dans le dossier ou choisi à la main). « Afficher cette phase » filtre la carte ; en vue 3D, le sélecteur Phase montre l’avancement, et un clic sur un élément permet de l’ajouter à une phase.', pre: () => { if ($('chPanel').hidden) { $('chBtn').click(); tourOpened.ch = true; } document.querySelector('#chTabs button[data-tab=p]').click(); }, post: () => { document.querySelector('#chTabs button[data-tab=z]').click(); if (tourOpened.ch) { $('chClose').click(); tourOpened.ch = false; } } },
    { sel: ['#chBtn', '#chPanel'], t: 'Réseaux existants', x: 'L’onglet Réseaux : « Récupérer les données ouvertes de la vue » charge les canalisations et lignes électriques de l’IGN et d’OpenStreetMap ; « Importer un fichier » lit un GeoJSON ou KML (WGS 84 ou Lambert-93) ; ou tracez-les d’après un plan DT-DICT, avec profondeur et diamètre. En 3D, la case « Réseaux enterrés » les montre sous le sol.', pre: () => { if ($('chPanel').hidden) { $('chBtn').click(); tourOpened.ch = true; } document.querySelector('#chTabs button[data-tab=n]').click(); }, post: () => { document.querySelector('#chTabs button[data-tab=z]').click(); if (tourOpened.ch) { $('chClose').click(); tourOpened.ch = false; } } },
    { sel: '#map', t: 'Repérer les réseaux sur une photo', x: 'Ouvrez une photo en grand puis « Repérer » : dessinez conduites, branchements, regards, accessoires et textes, avec raccords et montages automatiques. « Envoyer en 3D » place le repérage dans la vue 3D, et les dessins des autres photos apparaissent en transparence pour les modifier ou les prolonger.' },
    { sel: ['#d3Btn', '#maqPanel'], t: 'Maquette 3D', x: 'Chargez ici la maquette Revit (fichier IFC ou GLB, ou lien Nextcloud). Elle se place d’après Revit, ou avec des points GPS que vous ajoutez. « Exporter le calage » enregistre le placement pour le réutiliser.', pre: () => { if ($('maqPanel').hidden) { setMaqPanel(true); tourOpened.maq = true; } }, post: () => { if (tourOpened.maq) { setMaqPanel(false); tourOpened.maq = false; } } },
    { sel: '#d3Btn', t: 'Photos en 3D', x: 'Une fois la maquette chargée, ce bouton l’ouvre en 3D avec tous les repères photo. Cliquez un repère, ou une vignette de la barre en bas, pour voler jusqu’à l’endroit de la prise de vue.',
      demo: '<div class="row"><span class="fake">Rechercher…</span><span class="th sel"></span><span class="th"></span><span class="th"></span></div><div class="row"><span class="tb">+</span><span class="tb">−</span><span class="tb">⌖</span><small>Zoom avant, zoom arrière, vue de dessus</small></div><small>Souris : glisser pour tourner, clic droit ou Maj + glisser pour déplacer, molette pour zoomer.</small>' },
    { sel: '#d3Btn', t: 'Se placer et superposer', x: 'Dans la vue 3D, « Se placer ici » met la caméra à la position de la photo. « Superposer » fond ensuite la photo et la maquette pour les comparer : réglez l’opacité avec le curseur. Échap ou ✕ revient à la 3D.',
      demo: demoPip('<button type="button">Se placer ici</button><button type="button" class="on">Superposer</button>', 'Boutons en bas à droite de la vue 3D, sous la photo.') },
    { sel: '#d3Btn', t: 'Régler une fois pour toute l’équipe', x: 'Si l’alignement n’est pas parfait, décalez la maquette avec les flèches du clavier ou la souris. « Appliquer à toutes » reprend ce réglage pour les photos du même type d’appareil ; « Enregistrer pour l’équipe » l’écrit dans le fichier de calage à déposer à côté de la maquette. Collègues et clients n’ont plus rien à régler.',
      demo: demoPip('<button type="button">Appliquer à toutes</button><button type="button">Enregistrer pour l’équipe</button><button type="button">Tout annuler</button>', 'Ils apparaissent dès que vous modifiez le réglage.') },
    { sel: '#exportBtn', t: 'Exporter', x: 'Exportez les photos affichées en GeoJSON (QGIS, ArcGIS), KML (Google Earth), CSV avec coordonnées Lambert-93, ou ZIP avec les photos. Le bouton s’active quand des photos sont ouvertes.' },
    { sel: ['#themeBtn', '#hmBtn'], t: 'Thème et aide', x: 'La lune ou le soleil bascule entre mode clair et mode sombre. Le point d’interrogation liste les raccourcis clavier. Ce tuto se rouvre depuis le menu « ? ».' },
  ];
  const tourOpened = {}; let i = 0, open = false;
  const el = id => document.getElementById(id);
  const rectOf = sel => {
    const rs = (Array.isArray(sel) ? sel : [sel]).map(s => document.querySelector(s)).filter(Boolean).map(n => n.getBoundingClientRect()).filter(r => r.width > 2 && r.height > 2);
    if (!rs.length) return null;
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), r2 = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
    return { left: l, top: t, right: r2, bottom: b, width: r2 - l, height: b - t };
  };
  function place() {
    const s = S[i], hole = el('tourHole'), card = el('tourCard'), vw = innerWidth, vh = innerHeight, pad = 6;
    const r = rectOf(s.sel);
    if (!r) { hole.classList.add('none'); }
    else { hole.classList.remove('none'); Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' }); }
    const cw = card.offsetWidth, ch = card.offsetHeight, g = 16;
    let x = (vw - cw) / 2, y = (vh - ch) / 2;
    if (r) {
      const tries = [
        [Math.min(Math.max(12, r.left), vw - cw - 12), r.bottom + pad + g],
        [Math.min(Math.max(12, r.left), vw - cw - 12), r.top - pad - g - ch],
        [r.right + pad + g, Math.min(Math.max(12, r.top), vh - ch - 12)],
        [r.left - pad - g - cw, Math.min(Math.max(12, r.top), vh - ch - 12)],
      ];
      const fit = tries.find(([a, b]) => a >= 12 && b >= 12 && a + cw <= vw - 12 && b + ch <= vh - 12);
      if (fit) [x, y] = fit; else { x = Math.min(Math.max(12, r.left + 16), vw - cw - 12); y = vh - ch - 24; }
    }
    card.style.left = Math.max(12, x) + 'px'; card.style.top = Math.max(12, y) + 'px';
  }
  function show(n) {
    const prev = S[i]; if (open && prev && prev.post) prev.post();
    i = Math.max(0, Math.min(S.length - 1, n)); const s = S[i];
    if (s.pre) s.pre();
    el('tourCount').textContent = `${i + 1} sur ${S.length}`;
    el('tourTitle').textContent = s.t; el('tourText').textContent = s.x + (s.note ? ' ' + s.note : '');
    const d = el('tourDemo'); d.hidden = !s.demo; d.innerHTML = s.demo || '';
    el('tourPrev').hidden = i === 0; el('tourNext').textContent = i === S.length - 1 ? 'Terminer' : 'Suivant';
    const target = document.querySelector(Array.isArray(s.sel) ? s.sel[0] : s.sel);
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(() => { place(); el('tourNext').focus({ preventScroll: true }); });
  }
  function close() { if (!open) return; const s = S[i]; if (s && s.post) s.post(); open = false; el('tour').hidden = true; }
  function start() { closeMenus(); open = true; el('tour').hidden = false; i = 0; show(0); }
  el('tutoBtn').addEventListener('click', e => { e.stopPropagation(); start(); });
  el('tourNext').addEventListener('click', () => { if (i === S.length - 1) close(); else show(i + 1); });
  el('tourPrev').addEventListener('click', () => show(i - 1));
  el('tourClose').addEventListener('click', close);
  el('tour').addEventListener('click', e => e.stopPropagation());
  addEventListener('resize', () => { if (open) place(); });
  addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); if (i < S.length - 1) show(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); show(i - 1); }
  }, true);
  window.GeoTraceTour = { start, close, steps: S.length };
})();

/* ================= Aide et raccourcis ================= */
$('helpBtn').addEventListener('click', () => { $('ver').textContent = `GeoTrace version ${VERSION}`; $('help').showModal(); });
addEventListener('keydown', e => {
  if (!$('v3d').hidden) {
    if (e.key !== 'Escape') return;
    const f = $('v3Find'); if (e.target === f) { if (f.value) { f.value = ''; filterStrip(); } else f.blur(); return; }
    if (Maq && Maq.v3Cancel()) return;
    if ($('v3d').classList.contains('locked')) back3d(); else close3d();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (!$('viewer').hidden) {
    if (Rep && Rep.isOpen()) return;
    if (e.key === 'Escape') closeViewer();
    else if (!typing && e.key === 'ArrowLeft') $('vPrev').click();
    else if (!typing && e.key === 'ArrowRight') $('vNext').click();
    return;
  }
  if (e.key === 'Escape') { if (calMode === 'map') { calMode = 'model'; pending = null; planUpdate(); } else if (meas.on) measureOn(false); closeMenus(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || !$('welcome').hidden) return;
  const k = e.key.toLowerCase();
  if (k === 'f') fitAll();
  else if (k === 'm') measureOn(!meas.on);
  else if (k === 't') { const el = $('optThumbs'); el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
  else if (k === 'l') togglePanel();
  else if (k === '/') { e.preventDefault(); if (!prefs.panel && !isMobile()) { prefs.panel = true; applyPanel(); } $('q').focus(); }
  else if (k === '?') $('helpBtn').click();
});

/* ================= Démarrage ================= */
setTheme(document.documentElement.dataset.theme || 'light');
setBase(prefs.base);
if (prefs.cadastre) cadastre.addTo(map);
applyPanel();
makeGroup();
drawContours();
addEventListener('resize', debounce(() => { map.invalidateSize(); renderTimeline(); }, 150));

const qp = new URLSearchParams(location.search);
if (qp.get('s')) { share = { base: (CFG.nextcloud || location.origin).replace(/\/$/, ''), token: qp.get('s'), password: null }; loadShare(); }
else if (qp.get('lien')) { const s = parseShare(qp.get('lien')); if (s) { share = s; loadShare(); } }
if (qp.get('demo') !== null && qp.has('demo')) loadDemo();
(async () => { if (!qp.get('s') && !qp.get('lien') && !qp.has('demo')) await restoreSession(); restoreModel(); })();
if (qp.get('maquette')) { $('maqLink').value = qp.get('maquette'); setMaqPanel(true); $('maqForm').requestSubmit(); }

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne non disponible */ }));
}
})();
