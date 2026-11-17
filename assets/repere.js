/* =====================================================================
   REPÉRAGE SUR PHOTO : L'ÉCRAN
   ---------------------------------------------------------------------
   Ce fichier gère ce que l'on voit et ce que l'on touche : la photo,
   la barre d'outils, le panneau de droite, la souris et le doigt.

   Tout le calcul (dessin des objets, raccords automatiques, montages,
   branchements, tracés parallèles...) est dans repere-core.js.
   Le lien entre la photo et le terrain (pour la 3D et pour voir les
   dessins des autres photos) est dans photoproj.js.

   Plan du fichier :
     1. Les variables
     2. Petites fonctions utiles
     3. Les réglages enregistrés
     4. Afficher (zoom, photo, dessin, fantômes)
     5. Historique (annuler / rétablir) et enregistrement
     6. La souris et le doigt
     7. Le panneau de droite
     8. Construire l'écran
     9. Envoi en 3D, export de l'image
    10. Les fonctions utilisées par le reste du site
   ===================================================================== */

import * as C from './repere-core.js';
import { makeCamera, solveAdj } from './photoproj.js';
import { fit as fitPts } from './autocal.js';

export const NETS = C.S.networks; // gardé pour compatibilité


/* ---------- 1. Les variables ---------- */

let root = null;       // la fenêtre
let canvas = null;     // la zone de dessin
let ctx = null;        // le pinceau
let img = null;        // la photo chargée
let info = null;       // ce que le site nous a donné (nom, sauvegarde...)
let ph = null;         // le repérage : { w, h, objects }
let sentFlag = false;  // ce repérage a déjà été envoyé en 3D

const view = { scale: 1, x: 0, y: 0 };
let tool = 'select';
let selId = null;      // objet sélectionné
let gSel = null;       // dessin d'une autre photo sélectionné : { key, oid }
let draft = null;      // conduite en cours de tracé : { pts: [], ext }
let hover = null;      // position de la souris sur la photo
let hoverSnap = null;  // objet qui attire le point
let drag = null, panning = null, pinch = null, spaceDown = false, textEditor = null;
const pointers = new Map();
let history = [], historyPos = 0;
let tab = 'draw';
let armed = { pipe: null, mh: null, acc: null };
let showGhosts = true;
let ghosts = null;     // { ph: {w,h,objects}, cams, recs } : dessins des autres photos vus d'ici
let curCam = null;     // la caméra de la photo ouverte (ou null)
let others = [];       // les autres photos : { key, name, photo, rec }
let hintText = '';
let curAdj = null;     // réglages fins de la photo (cap, inclinaison, roulis, zoom, décalages), propres aux réseaux (la maquette a son propre calage)
let calib = null;      // calage en cours : { pairs, pending, start }
let sendTimer = null;
let ref = null;        // photo de référence affichée en haut à gauche pendant le calage par points
let ghostSkipped = 0;  // dessins des autres photos qui ne se reportent pas ici (hors champ, trop loin, trop près de l'horizon)
let autoBusy = false;  // calage automatique en cours

const CFG = 'geotrace:repere:cfg';


/* ---------- 2. Petites fonctions utiles ---------- */

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const q = sel => root.querySelector(sel);
const unit = () => (ph ? ph.w / 1000 : 1);
const objOf = id => (ph ? ph.objects.find(o => o.id === id) : null);
const clone = o => JSON.parse(C.snapshot([o]))[0];

function canvasRect() { return canvas.getBoundingClientRect(); }
function screenToPhoto(x, y) { return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale }; }
function eventToPhoto(e) { const r = canvasRect(); return screenToPhoto(e.clientX - r.left, e.clientY - r.top); }
// Une distance en pixels d'écran, convertie en pixels de photo
const tolPx = n => n / view.scale;

// La photo avec ses réglages fins : c'est elle qui sert à construire la caméra
const poseFor = () => Object.assign({}, info.photo, { adj: curAdj });
const ADJ0 = () => ({ yaw: 0, pitch: 0, roll: 0, e: 0, n: 0, z: 0, zoom: 1 });

// Un réglage a changé : on refait la caméra, les dessins des autres photos, et on le retient
function applyAdj(a, keep) {
  curAdj = Object.assign(ADJ0(), a);
  curCam = makeCamera(poseFor(), { w: ph.w, h: ph.h });
  computeGhosts();
  render();
  if (keep !== false && info.onAdj) { info.onAdj(curAdj); }
  // Si le repérage est déjà en 3D, il doit suivre le nouveau réglage
  if (keep !== false && sentFlag) { clearTimeout(sendTimer); sendTimer = setTimeout(function () { if (info && curCam) { sendTo3D(true); } }, 500); }
}

function say(text) { hintText = text || ''; const h = root && q('#rpHint'); if (h) { h.textContent = hintText; } }


// Calage automatique : compare cette photo à ses voisines et corrige cap, inclinaison, position, hauteur
async function autoCal() {
  if (autoBusy || !info || !info.neighbors || !curCam) { return; }
  autoBusy = true; syncPanel();
  const mine = info;
  try {
    say('Recherche des photos voisines…');
    const list = await info.neighbors();
    if (!list.length) { say('Aucune photo voisine (photos voisines avec position GPS) : calage impossible.'); return; }
    const refs = [];
    for (const n of list) {
      const im = await new Promise(function (ok) { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = n.src; });
      if (im) { refs.push({ photo: n.photo, img: im }); }
    }
    const A = await import('./autocal.js');
    const r = await A.autoCalibrate({ photo: poseFor(), img: img, refs: refs, onProgress: say });
    if (info !== mine) { return; }
    if (r.error) {
      // Pas de mesure sûre (vue de dessus contre vues très rasantes, champ uni...) : on passe au calage par points communs
      say('Calage automatique non appliqué : ' + r.error + ' Placez quelques points communs à la main (3 suffisent).');
      autoBusy = false; syncPanel();
      return startRef();
    }
    applyAdj(r.adj, true);
    say('Photo recalée sur ' + refs.length + ' voisine' + (refs.length > 1 ? 's' : '') + ' (' + r.n + ' points, écart ' + r.med.toFixed(1) + ' px). Cap ' + r.delta.yaw.toFixed(1) + '°, inclinaison ' + r.delta.pitch.toFixed(1) + '°, décalage ' + Math.hypot(r.delta.e, r.delta.n).toFixed(1) + ' m.');
  } catch (e) { console.error(e); say('Le calage automatique a échoué.'); }
  finally { autoBusy = false; if (root && info) { syncPanel(); } }
}


/* Calage par points communs : une photo voisine s'affiche en haut à gauche. On y clique un point,
   puis le même endroit sur la photo en cours. Chaque couple affine la pose de la photo en cours. */
async function startRef() {
  if (!info || !info.neighbors || !curCam || ref) { return; }
  say('Recherche des photos voisines…');
  const list = await info.neighbors();
  if (!list.length) { say('Aucune photo voisine (photos voisines avec position GPS).'); return; }
  const items = [];
  for (const n of list) {
    const im = await new Promise(function (ok) { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = n.src; });
    if (im) { items.push({ photo: n.photo, im: im, cam: makeCamera(n.photo, { w: im.naturalWidth, h: im.naturalHeight }) }); }
  }
  const usable = items.filter(x => x.cam);
  if (!usable.length) { say('Les photos voisines ne peuvent pas servir de référence.'); return; }
  if (draft) { draft = null; }
  tool = 'calib'; canvas.dataset.tool = 'calib'; selId = null; gSel = null;
  calib = { pairs: [], pending: null, start: Object.assign({}, curAdj), ref: true };
  const box = document.createElement('div');
  box.className = 'rp-ref';
  box.innerHTML = '<div class="rp-ref-h"><b></b><small>molette : zoom, glisser : déplacer</small></div><canvas></canvas>';
  q('.rp-stage').appendChild(box);
  ref = { box: box, cv: box.querySelector('canvas'), items: usable, idx: 0, view: { x: 0, y: 0, s: 1 }, drag: null };
  ref.cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    const r = ref.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = ref.view, ns = clamp(v.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.03, 20), f = ns / v.s;
    v.x = mx - (mx - v.x) * f; v.y = my - (my - v.y) * f; v.s = ns; refDraw();
  }, { passive: false });
  ref.cv.addEventListener('pointerdown', function (e) { ref.cv.setPointerCapture(e.pointerId); ref.drag = { x: e.clientX, y: e.clientY, vx: ref.view.x, vy: ref.view.y, moved: false }; });
  ref.cv.addEventListener('pointermove', function (e) {
    const d = ref.drag; if (!d) { return; }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) { d.moved = true; }
    if (d.moved) { ref.view.x = d.vx + e.clientX - d.x; ref.view.y = d.vy + e.clientY - d.y; refDraw(); }
  });
  ref.cv.addEventListener('pointerup', function (e) {
    const d = ref.drag; ref.drag = null;
    if (!d || d.moved || !calib) { return; }
    const r = ref.cv.getBoundingClientRect(), v = ref.view, it = ref.items[ref.idx];
    const x = (e.clientX - r.left - v.x) / v.s, y = (e.clientY - r.top - v.y) / v.s;
    const g = it.cam.toGround(x, y);
    if (!g) { say('Ce point est trop près de l’horizon : choisissez un point plus bas dans la photo de référence.'); return; }
    calib.pending = { g: [g.lat, g.lon], at: { x: x, y: y } };
    say('Maintenant, cliquez le même endroit sur cette photo (grande image).');
    refDraw();
  });
  refShow();
  say('Cliquez un point reconnaissable dans la photo de référence (en haut à gauche), puis le même endroit sur cette photo.');
  syncPanel(); render();
}
function refShow() {
  const it = ref.items[ref.idx], r = ref.cv.getBoundingClientRect();
  ref.box.querySelector('b').textContent = 'Référence : ' + (it.photo.name || '') + ' (' + (ref.idx + 1) + '/' + ref.items.length + ')';
  const w = r.width || 400, h = r.height || 300;
  ref.view.s = Math.min(w / it.im.naturalWidth, h / it.im.naturalHeight);
  ref.view.x = (w - it.im.naturalWidth * ref.view.s) / 2; ref.view.y = (h - it.im.naturalHeight * ref.view.s) / 2;
  refDraw();
}
function refNext() { if (!ref) { return; } ref.idx = (ref.idx + 1) % ref.items.length; if (calib) { calib.pending = null; } refShow(); }
function refDraw() {
  if (!ref) { return; }
  const c = ref.cv, r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * k) || c.height !== Math.round(r.height * k)) { c.width = Math.round(r.width * k); c.height = Math.round(r.height * k); }
  const x = c.getContext('2d'), v = ref.view, it = ref.items[ref.idx], u = it.im.naturalWidth / 1000;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
  x.setTransform(k * v.s, 0, 0, k * v.s, k * v.x, k * v.y);
  x.drawImage(it.im, 0, 0);
  x.strokeStyle = '#ff2d8a'; x.fillStyle = '#ff2d8a'; x.lineWidth = 2 / v.s; x.font = 'bold ' + 14 / v.s + 'px sans-serif';
  const mark = (p, label) => { x.beginPath(); x.moveTo(p.x - 8 / v.s, p.y); x.lineTo(p.x + 8 / v.s, p.y); x.moveTo(p.x, p.y - 8 / v.s); x.lineTo(p.x, p.y + 8 / v.s); x.stroke(); if (label) { x.fillText(label, p.x + 9 / v.s, p.y - 9 / v.s); } };
  if (calib) {
    calib.pairs.forEach((p, i) => { if (p.ref === ref.idx) { mark(p.at, String(i + 1)); } });
    if (calib.pending) { x.beginPath(); x.arc(calib.pending.at.x, calib.pending.at.y, 11 / v.s, 0, 7); x.stroke(); }
  }
}
function refClose() { if (ref) { ref.box.remove(); ref = null; } }


/* ---------- 3. Les réglages enregistrés ---------- */

function readCfg() { try { return JSON.parse(localStorage.getItem(CFG) || 'null') || {}; } catch (e) { return {}; } }
function saveCfg() {
  try { localStorage.setItem(CFG, JSON.stringify({ s: C.S, ghosts: showGhosts, armed: armed })); } catch (e) { /* stockage indisponible */ }
}
// On charge les réglages dès que le fichier est lu : le moteur en a besoin tout de suite
const cfg0 = readCfg();
C.loadSettings(cfg0.s);
showGhosts = cfg0.ghosts !== false;
if (cfg0.armed) { armed = Object.assign(armed, cfg0.armed); }
function fixArmed() {
  if (!C.pipeOf(armed.pipe)) { armed.pipe = (C.S.pipes[0] || {}).id; }
  if (!C.mhOf(armed.mh)) { armed.mh = (C.S.manholes[0] || {}).id; }
  if (!C.accOf(armed.acc)) { armed.acc = (C.S.accessories[2] || C.S.accessories[0] || {}).id; }
}
fixArmed();


/* ---------- 4. Afficher ---------- */

// Les dessins des autres photos, reportés dans cette photo
// Empreinte de la géométrie d'un objet (pour savoir s'il a changé sur sa photo d'origine)
function sigOf(o) {
  const r = v => Math.round(v);
  if (o.type === 'line') { return o.pts.map(p => r(p.x) + ',' + r(p.y)).join(';'); }
  if (o.type === 'manhole') { return r(o.cx) + ',' + r(o.cy) + ',' + r(o.rx); }
  if (o.type === 'acc') { return r(o.x) + ',' + r(o.y); }
  return String(o.id);
}
function computeGhosts() {
  ghosts = null;
  if (!curCam || !others.length) { return; }
  const objs = [], cams = {}, recs = {};
  let skipped = 0;
  others.forEach(function (o) {
    if (!o.rec || !o.rec.objs || !o.rec.objs.length) { return; }
    const cam = makeCamera(o.photo, { w: o.rec.w, h: o.rec.h });
    if (!cam) { return; }
    cams[o.key] = cam; recs[o.key] = o;
    o.rec.objs.forEach(function (ob) {
      // Déjà repris ici ? Seulement si le dessin n'a pas changé depuis sur sa photo d'origine
      // (sinon, par exemple s'il a été prolongé, on le montre de nouveau).
      const adopted = ph.objects.find(x => x.from === o.key + ':' + ob.id);
      if (adopted && (!adopted.fromSig || adopted.fromSig === sigOf(ob))) { return; }
      const p = C.projectObject(ob, cam, curCam);
      if (p) { p.gk = o.key; objs.push(p); } else if (ob.type !== 'text' && ob.type !== 'legend') { skipped++; }
    });
  });
  ghostSkipped = skipped;
  if (objs.length) { ghosts = { ph: { w: ph.w, h: ph.h, objects: objs }, cams: cams, recs: recs }; }
}

function render() {
  if (!canvas || !img || !ph) { return; }
  const rect = canvasRect(), ratio = window.devicePixelRatio || 1;
  const cw = Math.round(rect.width * ratio), ch = Math.round(rect.height * ratio);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y);
  ctx.drawImage(img, 0, 0);
  const u = unit(), hs = clamp((8 / view.scale) / (5.4 * u), 0.5, 4);
  if (showGhosts && ghosts) {
    ctx.save(); ctx.globalAlpha = 0.5;
    C.draw(ctx, ghosts.ph, u, { ui: !!gSel, selected: gSel ? [gSel.oid] : [], hs: hs });
    ctx.restore();
  }
  C.draw(ctx, ph, u, { ui: true, selected: selId ? [selId] : [], hs: hs });
  drawDraft(u);
  drawCalib(u);
  updateButtons();
}

// La conduite en cours de tracé, avec un trait jusqu'à la souris
function drawDraft(u) {
  if (!draft || !draft.pts.length) { return; }
  const pd = draft.ext ? null : C.pipeOf(armed.pipe);
  let col = '#12b5f0', w = 4;
  if (pd) { col = C.colOf(pd.net); w = pd.w; }
  const pts = draft.pts.slice();
  if (hover) { pts.push(hoverSnap ? hoverSnap.pos : hover); }
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
  ctx.lineWidth = (w + 1.8) * u; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.stroke();
  ctx.lineWidth = w * u; ctx.strokeStyle = col; ctx.setLineDash([w * u * 2, w * u]); ctx.stroke();
  ctx.setLineDash([]);
  draft.pts.forEach(function (p) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.4 * u, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6 * u; ctx.stroke(); });
  if (hoverSnap) { ctx.beginPath(); ctx.arc(hoverSnap.pos.x, hoverSnap.pos.y, 7 * u, 0, 7); ctx.strokeStyle = '#12b5f0'; ctx.lineWidth = 2 * u; ctx.stroke(); }
  ctx.restore();
}

// Calage : le point choisi sur le dessin fantôme (rond) et les points déjà placés (croix)
function drawCalib(u) {
  if (!calib) { return; }
  ctx.save();
  ctx.lineWidth = 2 * u; ctx.strokeStyle = '#ff2d8a';
  calib.pairs.forEach(function (q, i) {
    ctx.beginPath(); ctx.moveTo(q.px.x - 7 * u, q.px.y); ctx.lineTo(q.px.x + 7 * u, q.px.y); ctx.moveTo(q.px.x, q.px.y - 7 * u); ctx.lineTo(q.px.x, q.px.y + 7 * u); ctx.stroke();
    if (calib.ref) { ctx.fillStyle = '#ff2d8a'; ctx.font = 'bold ' + 14 * u + 'px sans-serif'; ctx.fillText(String(i + 1), q.px.x + 9 * u, q.px.y - 9 * u); }
  });
  if (calib.pending && !calib.ref) { ctx.beginPath(); ctx.arc(calib.pending.at.x, calib.pending.at.y, 9 * u, 0, 7); ctx.stroke(); }
  ctx.restore();
}

function fitToScreen() {
  const r = canvasRect();
  if (!img || !r.width) { return; }
  view.scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight) * 0.98;
  view.x = (r.width - img.naturalWidth * view.scale) / 2;
  view.y = (r.height - img.naturalHeight * view.scale) / 2;
  render();
}
function zoomAt(sx, sy, ns) {
  ns = clamp(ns, 0.05, 20);
  const f = ns / view.scale;
  view.x = sx - (sx - view.x) * f; view.y = sy - (sy - view.y) * f; view.scale = ns;
  render();
}


/* ---------- 5. Historique et enregistrement ---------- */

function pushHistory() {
  history = history.slice(0, historyPos + 1);
  history.push(C.snapshot(ph.objects));
  if (history.length > 80) { history.shift(); }
  historyPos = history.length - 1;
}
// On enregistre : le site garde le repérage de la photo
function saveNow() {
  if (!info || !info.onSave) { return; }
  const rec = { v: 2, w: ph.w, h: ph.h, objs: JSON.parse(C.snapshot(ph.objects)) };
  if (sentFlag) { rec.sent = true; }
  info.onSave(rec);
  if (sentFlag) { sendTo3D(true); } // déjà envoyé : la 3D reste à jour
}
// Après chaque modification : remettre les liens et les raccords d'aplomb, noter dans l'historique, enregistrer
function commit(moved) {
  C.syncAll(ph, moved);
  pushHistory();
  saveNow();
  syncPanel();
  render();
}
function undo(dir) {
  const n = historyPos + dir;
  if (n < 0 || n >= history.length) { return; }
  historyPos = n;
  ph.objects = JSON.parse(history[n]);
  if (selId && !objOf(selId)) { selId = null; }
  saveNow(); syncPanel(); render();
}


/* ---------- 6. La souris et le doigt ---------- */

function setTool(t) {
  if (calib) { endCalib(true); }
  if (draft) { draft = null; }
  tool = t;
  canvas.dataset.tool = t;
  if (t !== 'select') { selId = null; gSel = null; tab = 'draw'; }
  const hints = {
    select: 'Cliquez un objet pour le modifier, glissez ses poignées pour le déformer.',
    line: 'Cliquez les points de la conduite. Elle s’accroche aux regards, accessoires et conduites proches. Double-clic ou Entrée pour finir.',
    branch: 'Cliquez à l’arrivée du branchement : il part automatiquement de la conduite la plus proche.',
    manhole: 'Cliquez pour poser le regard choisi.',
    acc: 'Cliquez pour poser l’accessoire. Posé sur une conduite d’eau, un montage complet peut être créé (té, vanne, purge…).',
    text: 'Cliquez où écrire le texte.',
    legend: 'Cliquez où placer la légende (conduites, regards et accessoires utilisés).'
  };
  say(hints[t] || '');
  syncPanel(); render();
}

function selectObject(o) { selId = o ? o.id : null; gSel = null; if (o) { tab = 'obj'; } syncPanel(); render(); }

// Ajoute un objet, le sélectionne et enregistre
function addObject(o, extra) {
  ph.objects.push(o);
  if (extra) { ph.objects.push(...extra); }
  selId = o.id; gSel = null;
  commit([o]);
}

function onPointerDown(e) {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, e);
  if (pointers.size === 2) {
    const l = Array.from(pointers.values());
    pinch = { d: Math.hypot(l[0].clientX - l[1].clientX, l[0].clientY - l[1].clientY), s: view.scale };
    drag = null; panning = null;
    return;
  }
  if (textEditor) { closeTextEditor(true); }
  const p = eventToPhoto(e), u = unit(), tol = tolPx(9);
  if (e.button === 1 || e.button === 2 || spaceDown) {
    panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvas.classList.add('pan');
    return;
  }

  if (tool === 'calib') { return downCalib(p, tol); }
  if (tool === 'select') { return downSelect(e, p, u, tol); }

  if (tool === 'line') {
    const tg = C.snapTarget(ph, p, u, tol, null);
    const pt = tg ? C.snappedPoint(ph, tg, p) : { x: p.x, y: p.y };
    if (!draft) { draft = { pts: [] }; }
    const last = draft.pts[draft.pts.length - 1];
    if (!(last && Math.hypot(last.x - pt.x, last.y - pt.y) <= tolPx(3))) { draft.pts.push(pt); }
    render();
  } else if (tool === 'branch') {
    const r = C.autoBranch(ph, p, u, armed.pipe, tol);
    if (r.error) { say(r.error); return; }
    say(r.msg);
    selId = r.line.id; tab = 'obj';
    commit([r.line]);
  } else if (tool === 'manhole') {
    const def = C.mhOf(armed.mh);
    if (def) { addObject(C.newManhole(ph, p, def, u)); }
  } else if (tool === 'acc') {
    const def = C.accOf(armed.acc);
    if (!def) { return; }
    const kit = C.placeAcc(ph, p, def, u, tolPx(14) + 8 * u);
    if (kit) { say(kit.msg); selId = kit.sel.id; tab = 'obj'; commit(kit.objs); return; }
    addObject(C.newAcc(p, def, u));
  } else if (tool === 'text') {
    openTextEditor(p, e);
  } else if (tool === 'legend') {
    const old = ph.objects.find(o => o.type === 'legend');
    if (old) { old.x = p.x; old.y = p.y; selId = old.id; commit(); } else { addObject({ id: C.uid(), type: 'legend', x: p.x, y: p.y, fs: 0 }); }
  }
}

/* Caler la photo : on clique un point d'un dessin fantôme, puis l'endroit où il devrait être sur cette photo.
   Chaque nouveau couple de points affine le réglage (1 couple : cap et inclinaison, 2 ou plus : roulis et zoom aussi). */
function ghostAnchors() {
  const out = [];
  if (!ghosts) { return out; }
  ghosts.ph.objects.forEach(function (o) {
    if (o.type === 'line') { o.pts.forEach(p => { if (p.g) { out.push({ x: p.x, y: p.y, g: p.g }); } }); }
    else if (o.type === 'manhole' && o.g) { out.push({ x: o.cx, y: o.cy, g: o.g }); }
    else if (o.type === 'acc' && o.g && !o.auto) { out.push({ x: o.x, y: o.y, g: o.g }); }
  });
  return out;
}
function downCalib(p, tol) {
  if (calib.ref && !calib.pending) { say('Cliquez d’abord le point dans la photo de référence (en haut à gauche), puis ici le même endroit.'); return; }
  if (!calib.pending) {
    let best = null, bd = tolPx(40);
    ghostAnchors().forEach(function (a) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a; } });
    if (!best) { say('Cliquez d’abord un point (sommet, regard, accessoire) d’un dessin en transparence.'); return; }
    calib.pending = { g: best.g, at: { x: best.x, y: best.y } };
    say('Maintenant, cliquez l’endroit où ce point doit se trouver sur cette photo.');
    render();
    return;
  }
  calib.pairs.push({ g: calib.pending.g, px: { x: p.x, y: p.y }, ref: ref ? ref.idx : -1, at: calib.pending.at });
  calib.pending = null;
  solveNow();
  const n = calib.pairs.length;
  say(n + ' point' + (n > 1 ? 's' : '') + ' placé' + (n > 1 ? 's' : '') + (n < 3 && calib.ref ? '. Avec 3 points ou plus, la position et la hauteur sont réglées aussi.' : '.') + ' Continuez ou terminez le calage.');
  refDraw(); syncPanel();
}
// Recalcule le réglage de la photo avec les couples de points placés
function solveNow() {
  const size = { w: ph.w, h: ph.h }, base = Object.assign({}, info.photo, { adj: calib.start });
  if (!calib.pairs.length) { applyAdj(calib.start, false); return; }
  if (calib.pairs.length >= 3) {
    const r = fitPts(base, size, calib.pairs.map(q => ({ lat: q.g[0], lon: q.g[1], qx: q.px.x, qy: q.px.y })), calib.start);
    applyAdj(r.adj, false);
  } else { applyAdj(solveAdj(base, size, calib.pairs), false); }
}
function startCalib() {
  if (!ghosts) { say('Aucun dessin d’une autre photo dans cette vue : rien pour caler.'); return; }
  if (draft) { draft = null; }
  tool = 'calib'; canvas.dataset.tool = 'calib'; selId = null; gSel = null;
  calib = { pairs: [], pending: null, start: Object.assign({}, curAdj) };
  say('Cliquez un point d’un dessin en transparence, puis l’endroit où il doit se trouver sur cette photo.');
  syncPanel(); render();
}
// ok = true : on garde le réglage ; false : on revient au réglage d'avant
function endCalib(ok) {
  if (!calib) { return; }
  const c = calib;
  refClose();
  calib = null; tool = 'select'; canvas.dataset.tool = 'select';
  if (ok && c.pairs.length) { applyAdj(curAdj, true); say('Photo calée pour les réseaux (le calage de la maquette reste indépendant).'); }
  else { applyAdj(c.start, false); say(''); }
  syncPanel(); render();
}

// Outil Sélection : poignées, étiquettes, objets, dessins des autres photos
function downSelect(e, p, u, tol) {
  const cur = selId ? objOf(selId) : null;
  // Poignées de l'objet sélectionné
  if (cur) {
    const hs = C.handlesOf(cur, u), rad = tolPx(11);
    for (const h of hs) {
      if (Math.hypot(p.x - h.x, p.y - h.y) <= rad) {
        if (h.k === 'm') { cur.pts.splice(h.i + 1, 0, { x: h.x, y: h.y }); drag = { kind: 'v', o: cur, i: h.i + 1, moved: true }; }
        else if (h.k === 'v') { drag = { kind: 'v', o: cur, i: h.i, moved: false }; }
        else { drag = { kind: 's', o: cur, moved: false }; }
        return;
      }
    }
  }
  const hit = C.hitTest(ph, p, u, tol);
  if (hit) {
    const o = hit.o;
    selId = o.id; gSel = null; tab = 'obj';
    if (hit.label && o._lbx) { drag = { kind: 'label', o: o, dx: p.x - o._lbx.x, dy: p.y - o._lbx.y, moved: false }; }
    else if (o.auto) { drag = null; } // un raccord automatique se repose tout seul
    else { drag = { kind: 'move', o: o, last: p, moved: false }; }
    syncPanel(); render();
    return;
  }
  // Dessin d'une autre photo ?
  if (showGhosts && ghosts) {
    const gh = C.hitTest(ghosts.ph, p, u, tol);
    if (gh && !gh.o.auto) {
      selId = null; gSel = { key: gh.o.gk, oid: gh.o.id }; tab = 'obj';
      drag = { kind: 'gmove', g: gh.o, last: p, moved: false };
      syncPanel(); render();
      return;
    }
  }
  selId = null; gSel = null;
  panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  canvas.classList.add('pan');
  syncPanel(); render();
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) { pointers.set(e.pointerId, e); }
  if (pinch && pointers.size === 2) {
    const l = Array.from(pointers.values()), d = Math.hypot(l[0].clientX - l[1].clientX, l[0].clientY - l[1].clientY), r = canvasRect();
    zoomAt((l[0].clientX + l[1].clientX) / 2 - r.left, (l[0].clientY + l[1].clientY) / 2 - r.top, pinch.s * d / pinch.d);
    return;
  }
  if (panning) { view.x = panning.vx + e.clientX - panning.x; view.y = panning.vy + e.clientY - panning.y; render(); return; }
  const p = eventToPhoto(e), u = unit();
  if (drag) { return moveDrag(p, u); }
  if (tool === 'line' && draft) {
    hover = p;
    const tg = C.snapTarget(ph, p, u, tolPx(9), null);
    hoverSnap = tg ? { pos: C.snappedPoint(ph, tg, p) } : null;
    render();
  }
}

function moveDrag(p, u) {
  const d = drag;
  d.moved = true;
  if (d.kind === 'v') {
    const tg = C.snapTarget(ph, p, u, tolPx(9), d.o);
    const pt = d.o.pts[d.i];
    if (tg) { const s = C.snappedPoint(ph, tg, p); pt.x = s.x; pt.y = s.y; pt.link = s.link; }
    else { pt.x = p.x; pt.y = p.y; delete pt.link; }
    C.syncAll(ph, [d.o]);
  } else if (d.kind === 's') {
    const r = d.o.type === 'manhole' ? Math.hypot(p.x - d.o.cx, p.y - d.o.cy) : Math.hypot(p.x - d.o.x, p.y - d.o.y);
    if (d.o.type === 'manhole') { d.o.rx = d.o.ry = Math.max(2 * u, r); } else { d.o.size = clamp(r / u, 2, 40); d.o.autoSize = null; }
  } else if (d.kind === 'label') {
    d.o.lp = { x: p.x - d.dx, y: p.y - d.dy };
  } else if (d.kind === 'move') {
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    d.last = p;
    const o = d.o;
    if (o.type === 'line') { o.pts.forEach(function (q) { q.x += dx; q.y += dy; delete q.link; }); }
    else if (o.type === 'manhole') { o.cx += dx; o.cy += dy; }
    else { o.x += dx; o.y += dy; if (o.lp) { o.lp.x += dx; o.lp.y += dy; } }
    C.syncAll(ph, [o]);
  } else if (d.kind === 'gmove') {
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    d.last = p;
    const o = d.g;
    if (o.type === 'line') { o.pts.forEach(function (q) { q.x += dx; q.y += dy; }); }
    else if (o.type === 'manhole') { o.cx += dx; o.cy += dy; }
    else { o.x += dx; o.y += dy; }
  }
  render();
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) { pinch = null; }
  if (panning) { panning = null; canvas.classList.remove('pan'); }
  if (drag) {
    const d = drag;
    drag = null;
    if (d.moved) {
      if (d.kind === 'gmove') { writeBackGhost(d.g); } else { commit(d.o ? [d.o] : []); }
    }
  }
}

function onDoubleClick(e) { if (tool === 'line') { e.preventDefault(); finishLine(); } }

// Termine la conduite en cours
function finishLine() {
  if (!draft) { return; }
  const d = draft, pts = d.pts.slice();
  draft = null; hover = null; hoverSnap = null;
  if (d.ext) { return finishExtension(d, pts); }
  if (pts.length < 2) { render(); return; }
  const L = C.newLine(pts, armed.pipe);
  addObject(L);
}

// Prolonger une conduite : les nouveaux points sont ajoutés au bout choisi
function finishExtension(d, pts) {
  const add = pts.slice(1); // le premier point est le bout de départ
  if (!add.length) { render(); return; }
  if (!d.ext.key) {
    const L = objOf(d.ext.oid);
    if (!L) { render(); return; }
    if (d.ext.atStart) { L.pts.unshift(...add.reverse()); } else { L.pts.push(...add); }
    setTool('select'); selId = L.id; tab = 'obj';
    commit([L]);
    return;
  }
  // Conduite faite sur une autre photo : on convertit les points dans l'autre photo
  const cam = ghosts && ghosts.cams[d.ext.key], rec = ghosts && ghosts.recs[d.ext.key];
  const L = rec && rec.rec.objs.find(o => o.id === d.ext.oid);
  if (!cam || !L) { render(); return; }
  const back = add.map(pt => C.backPoint(pt, curCam, cam));
  if (back.some(b => !b)) { say('Certains points ne tombent pas sur le sol de l’autre photo : prolongement annulé.'); render(); return; }
  const np = back.map(b => ({ x: b.x, y: b.y }));
  if (d.ext.atStart) { L.pts.unshift(...np.reverse()); } else { L.pts.push(...np); }
  saveOther(d.ext.key);
  setTool('select');
}

// On a déplacé un dessin d'une autre photo : on reporte la nouvelle position dans cette photo
function writeBackGhost(g) {
  const cam = ghosts.cams[g.gk], rec = ghosts.recs[g.gk];
  const src = rec && rec.rec.objs.find(o => o.id === g.id);
  if (!cam || !src) { return; }
  const conv = pt => C.backPoint(pt, curCam, cam);
  if (g.type === 'line') {
    const np = g.pts.map(conv);
    if (np.some(x => !x)) { say('Un point ne tombe plus sur le sol : déplacement annulé.'); computeGhosts(); render(); return; }
    src.pts.forEach((pt, i) => { pt.x = np[i].x; pt.y = np[i].y; delete pt.link; });
  } else if (g.type === 'manhole') {
    const n = conv({ x: g.cx, y: g.cy });
    if (!n) { computeGhosts(); render(); return; }
    src.cx = n.x; src.cy = n.y;
  } else {
    const n = conv({ x: g.x, y: g.y });
    if (!n) { computeGhosts(); render(); return; }
    src.x = n.x; src.y = n.y;
  }
  saveOther(g.gk);
}
// On enregistre l'autre photo et on recalcule les fantômes
function saveOther(key) {
  const o = others.find(x => x.key === key);
  if (!o) { return; }
  const p2 = { w: o.rec.w, h: o.rec.h, objects: o.rec.objs };
  C.syncAll(p2);
  if (info.onSaveOther) { info.onSaveOther(key, o.rec); }
  computeGhosts(); syncPanel(); render();
  say('Dessin modifié sur « ' + (o.name || 'l’autre photo') + ' ».');
}

function onWheel(e) { e.preventDefault(); const r = canvasRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, view.scale * Math.exp(-e.deltaY * 0.0016)); }

// Écrire un texte sur la photo
function openTextEditor(p, e) {
  const r = canvasRect(), box = document.createElement('textarea');
  box.className = 'rp-ted'; box.rows = 2; box.placeholder = 'Votre texte, Entrée pour valider';
  box.style.left = Math.min(r.width - 190, e.clientX - r.left) + 'px';
  box.style.top = Math.min(r.height - 70, e.clientY - r.top) + 'px';
  canvas.parentNode.appendChild(box);
  textEditor = { box: box, p: p };
  box.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); closeTextEditor(true); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); closeTextEditor(false); }
  });
  setTimeout(function () { box.focus(); }, 0);
}
function closeTextEditor(keep) {
  if (!textEditor) { return; }
  const t = textEditor; textEditor = null;
  const text = t.box.value.trim();
  t.box.remove();
  if (keep && text) { addObject(C.newText(t.p, text)); }
}


/* ---------- 7. Le panneau de droite ---------- */

const optHtml = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
function pipeOptions(cur) {
  return C.S.networks.map(function (n) {
    const list = C.S.pipes.filter(p => p.net === n.id);
    return list.length ? '<optgroup label="' + esc(n.name) + '">' + list.map(p => optHtml(p.id, p.desc, p.id === cur)).join('') + '</optgroup>' : '';
  }).join('');
}
const mhOptions = cur => C.S.manholes.map(m => optHtml(m.id, m.name, m.id === cur)).join('');
const accOptions = cur => C.S.accessories.map(a => optHtml(a.id, a.name, a.id === cur)).join('');
const netOptions = cur => C.S.networks.map(n => optHtml(n.id, n.name, n.id === cur)).join('');
const field = (label, input) => '<label class="rp-f"><span>' + label + '</span>' + input + '</label>';
const txt = (f, v, extra) => '<input type="text" data-f="' + f + '" value="' + esc(v) + '" autocomplete="off"' + (extra || '') + '>';
const num = (f, v, min, max, step) => '<input type="number" data-f="' + f + '" data-k="num" value="' + esc(v) + '" min="' + min + '" max="' + max + '" step="' + step + '">';
const chk = (f, v, label, scope) => '<label class="rp-c"><input type="checkbox" data-f="' + f + '" data-k="bool"' + (scope ? ' data-s="1"' : '') + (v ? ' checked' : '') + '> ' + label + '</label>';

function panelDraw() {
  const pd = C.pipeOf(armed.pipe);
  let h = '<div class="rp-grp"><h4>Conduite</h4><select data-a="pipe">' + pipeOptions(armed.pipe) + '</select>' +
    (pd ? '<p class="hint"><i class="rp-sw" style="background:' + C.colOf(pd.net) + '"></i>' + esc((C.netOf(pd.net) || {}).name) + ', trait ' + (pd.dash === 'dotted' ? 'pointillé' : pd.dash === 'dashed' ? 'tireté' : 'plein') + '</p>' : '') + '</div>';
  h += '<div class="rp-grp"><h4>Regard</h4><select data-a="mh">' + mhOptions(armed.mh) + '</select></div>';
  h += '<div class="rp-grp"><h4>Accessoire</h4><select data-a="acc">' + accOptions(armed.acc) + '</select>' +
    '<p class="hint">Purge, vidange, ventouse, poteau incendie, compteur… posés sur une conduite d’eau : le montage complet est créé.</p></div>';
  h += ghostBlock();
  h += calibBlock();
  return h;
}
function ghostBlock() {
  let n = 0, photos = {};
  if (ghosts) { ghosts.ph.objects.forEach(o => { n++; photos[o.gk] = 1; }); }
  const np = Object.keys(photos).length;
  let msg;
  if (!curCam) { msg = 'Cette photo n’a pas de position ou de direction : les autres photos ne peuvent pas y être reportées.'; }
  else if (!others.some(o => o.rec && o.rec.objs && o.rec.objs.length)) { msg = 'Aucune autre photo n’a encore de repérage.'; }
  else if (!n) { msg = 'Aucun dessin des autres photos ne tombe dans cette vue' + (ghostSkipped ? ' (' + ghostSkipped + ' hors champ ou trop près de l’horizon)' : '') + '.'; }
  else { msg = n + ' objet' + (n > 1 ? 's' : '') + ' venant de ' + np + ' autre' + (np > 1 ? 's' : '') + ' photo' + (np > 1 ? 's' : '') + '. Cliquez-en un (outil Sélection) pour le modifier, le prolonger ou le reprendre ici.' + (ghostSkipped ? ' ' + ghostSkipped + ' autre(s) hors champ ou trop près de l’horizon.' : ''); }
  return '<div class="rp-grp"><h4>Autres photos</h4>' + chk('showGhosts', showGhosts, 'Afficher leurs dessins (transparents)', 'g') + '<p class="hint">' + esc(msg) + '</p></div>';
}

function calibBlock() {
  if (!curCam) { return ''; }
  const a = curAdj || ADJ0();
  const sl = (f, label, min, max, step, unit) => '<label class="rp-f"><span>' + label + ' : <b>' + (Math.round(a[f] * 100) / 100) + unit + '</b></span><input type="range" data-adj="' + f + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + a[f] + '"></label>';
  let h = '<div class="rp-grp"><h4>Caler la photo</h4>';
  if (calib) {
    h += '<p class="hint">Calage en cours : ' + calib.pairs.length + ' point(s) placé(s).' + (calib.ref ? ' Cliquez un point reconnaissable dans la photo de référence, puis le même endroit sur cette photo (angle de bâtiment, bordure, regard, marquage au sol). 3 points suffisent, 5 à 6 bien répartis donnent le meilleur résultat.' : '') + '</p>' +
      (calib.ref ? '<div class="rp-row"><button class="btn small" data-do="ref-next" type="button">Autre photo de référence</button></div>' : '') +
      '<div class="rp-row"><button class="btn small primary" data-do="calib-ok" type="button">Terminer</button><button class="btn small" data-do="calib-undo" type="button">Retirer le dernier</button><button class="btn small" data-do="calib-cancel" type="button">Annuler</button></div>';
  } else {
    h += '<p class="hint">Si les dessins des autres photos ne tombent pas au bon endroit, la position ou le cap de cette photo est légèrement faux (GPS, boussole). Calez-la sur eux : ce réglage ne concerne que les réseaux, pas la maquette.</p>' +
      '<div class="rp-row"><button class="btn small primary" data-do="autocal" type="button"' + (autoBusy || !info.neighbors ? ' disabled' : '') + '>' + (autoBusy ? 'Calage…' : 'Recaler automatiquement') + '</button></div>' +
      '<div class="rp-row"><button class="btn small" data-do="refcal" type="button"' + (info.neighbors ? '' : ' disabled') + '>Caler par points communs</button></div>' +
      '<div class="rp-row"><button class="btn small" data-do="calib" type="button"' + (ghosts ? '' : ' disabled') + '>Caler sur un dessin</button><button class="btn small" data-do="adj-reset" type="button">Remettre à zéro</button></div>' +
      '<details class="rp-det"><summary>Réglage fin</summary>' + sl('yaw', 'Cap', -45, 45, 0.1, '°') + sl('pitch', 'Inclinaison', -30, 30, 0.1, '°') + sl('roll', 'Roulis', -15, 15, 0.1, '°') + sl('zoom', 'Zoom', 0.6, 1.6, 0.01, '×') + sl('e', 'Décalage est', -40, 40, 0.5, ' m') + sl('n', 'Décalage nord', -40, 40, 0.5, ' m') + sl('z', 'Hauteur', -40, 40, 0.5, ' m') + '</details>';
  }
  return h + '</div>';
}

function panelObj() {
  if (gSel) { return panelGhost(); }
  const o = selId && objOf(selId);
  if (!o) { return '<p class="hint">Aucun objet sélectionné. Choisissez l’outil Sélection puis cliquez un objet.</p>'; }
  let h = '';
  if (o.type === 'line') {
    h += field('Type de conduite', '<select data-f="pipeId">' + pipeOptions(o.pipeId) + '</select>');
    h += field('Texte affiché (vide = description)', txt('text', o.text || ''));
    h += chk('showLabel', o.showLabel !== false, 'Afficher le texte');
    h += '<div class="rp-row"><button class="btn small" data-do="ext-end" type="button">Prolonger la fin</button><button class="btn small" data-do="ext-start" type="button">Prolonger le début</button></div>';
    const par = C.defaultParallelPipe(o);
    h += '<div class="rp-grp"><h4>Tracé parallèle</h4>' +
      field('Côté', '<select id="rpParSide"><option value="left">Gauche</option><option value="right">Droite</option></select>') +
      field('Distance', '<input id="rpParDist" type="number" value="14" min="2" max="200" step="1">') +
      field('Conduite', '<select id="rpParPipe">' + pipeOptions(par) + '</select>') +
      '<label class="rp-c"><input id="rpParKeep" type="checkbox" checked> Suit la conduite d’origine</label>' +
      '<button class="btn small" data-do="parallel" type="button">Créer le parallèle</button><p class="hint">Les branchements partant de la conduite sont reportés sur le nouveau tracé.</p></div>';
  } else if (o.type === 'manhole') {
    h += field('Type de regard', '<select data-f="mhId" data-preset="mh">' + mhOptions(o.mhId) + '</select>');
    h += field('Repère', txt('num', o.num));
    h += field('Nature', txt('nature', o.nature));
    h += field('Diamètre (mm)', txt('diam', o.diam));
    h += field('Lignes en plus', '<textarea data-f="extra" rows="2">' + esc(o.extra || '') + '</textarea>');
    h += chk('showLabel', o.showLabel !== false, 'Afficher l’étiquette');
  } else if (o.type === 'acc') {
    h += field('Accessoire', '<select data-f="accId" data-preset="acc"' + (o.auto ? ' disabled' : '') + '>' + accOptions(o.accId) + '</select>');
    h += field('Diamètre 1', txt('d', o.d)) + field('Diamètre 2', txt('d2', o.d2));
    h += field('Matière 1', txt('m1', o.m1)) + field('Matière 2', txt('m2', o.m2));
    h += field('Note', txt('note', o.note || ''));
    h += field('Texte libre (remplace tout)', '<textarea data-f="text" rows="2">' + esc(o.text || '') + '</textarea>');
    h += field('Taille', num('size', Math.round((o.size || 8) * 10) / 10, 2, 40, 0.5));
    h += chk('showLabel', o.showLabel !== false, 'Afficher l’étiquette');
    if (o.auto) { h += '<p class="hint">Raccord posé automatiquement. Changez son type pour le rendre libre.</p>'; }
    if (o.kit) { h += '<button class="btn small" data-do="kit" type="button">Dégrouper / regrouper le montage</button>'; }
  } else if (o.type === 'text') {
    h += field('Texte', '<textarea data-f="text" rows="3">' + esc(o.text || '') + '</textarea>');
    h += field('Taille', num('fs', o.fs || C.S.fs, 6, 60, 1));
  } else if (o.type === 'legend') {
    h += '<p class="hint">La légende liste les conduites, regards et accessoires utilisés. Glissez-la pour la déplacer.</p>';
  }
  if (o.type !== 'legend' && o.lp) { h += '<button class="btn small" data-do="unlabel" type="button">Replacer l’étiquette automatiquement</button>'; }
  return h + '<div class="rp-row"><button class="btn small danger" data-do="del" type="button">Supprimer</button></div>';
}

function panelGhost() {
  const o = ghosts && ghosts.ph.objects.find(x => x.id === gSel.oid && x.gk === gSel.key);
  const from = others.find(x => x.key === gSel.key);
  if (!o) { return '<p class="hint">Ce dessin n’est plus visible.</p>'; }
  let h = '<p class="hint">Dessin fait sur « ' + esc((from && from.name) || 'une autre photo') + ' ». Glissez-le pour le déplacer : il est modifié sur sa propre photo.</p>';
  h += '<div class="rp-row"><button class="btn small" data-do="adopt" type="button">Reprendre dans cette photo</button></div>';
  if (o.type === 'line') { h += '<div class="rp-row"><button class="btn small" data-do="ext-end" type="button">Prolonger la fin</button><button class="btn small" data-do="ext-start" type="button">Prolonger le début</button></div>'; }
  return h + '<div class="rp-row"><button class="btn small danger" data-do="gdel" type="button">Supprimer de l’autre photo</button></div>';
}

function panelOpts() {
  const S = C.S;
  let h = '<div class="rp-grp"><h4>Automatismes</h4>' +
    chk('autoFit', S.autoFit, 'Raccords automatiques (eau potable)', 1) +
    chk('autoCoude', S.autoCoude, 'Coudes 45° / 90°', 1) + chk('autoTe', S.autoTe, 'Tés', 1) + chk('autoRed', S.autoRed, 'Réductions et raccordements intermatériaux', 1) +
    chk('autoRac', S.autoRac !== false, 'Raccordements sur existant', 1) + chk('autoBr', S.autoBr !== false, 'Prises de branchement', 1) + chk('autoCit', S.autoCit !== false, 'Citerneaux en bout de branchement', 1) +
    chk('kitsOn', S.kitsOn !== false, 'Montages d’accessoires (té + vanne + purge…)', 1) + '</div>';
  h += '<div class="rp-grp"><h4>Aspect</h4>' + chk('casing', S.casing, 'Liseré blanc sous les conduites', 1) + chk('crossTr', S.crossTr !== false, 'Transparence aux croisements', 1) + chk('warnCross', S.warnCross, 'Signaler les croisements eau potable / assainissement', 1) +
    field('Taille du texte', '<input type="number" data-f="fs" data-k="num" data-s="1" value="' + S.fs + '" min="6" max="40" step="1">') +
    field('Position du texte des conduites', '<select data-f="labelPos" data-s="1">' + optHtml('on', 'Sur la conduite', S.labelPos !== 'above') + optHtml('above', 'Au-dessus', S.labelPos === 'above') + '</select>') + '</div>';
  const n = C.listCrossings(ph).length;
  h += '<p class="hint">' + (n ? n + ' croisement' + (n > 1 ? 's' : '') + ' eau potable / assainissement à contrôler.' : 'Aucun croisement eau potable / assainissement.') + '</p>';
  h += '<div class="rp-grp"><h4>Montages d’accessoires</h4><textarea id="rpKits" rows="6" spellcheck="false">' + esc(C.kitsToText(S.kits)) + '</textarea>' +
    '<p class="hint">Format : déclencheur : pièce &gt; pièce | DN : jusqu’à 100 = 40 ; au-delà = 80. Ligne commençant par # = désactivée.</p><button class="btn small" data-do="kits" type="button">Appliquer les montages</button></div>';
  h += '<details class="rp-det"><summary>Ajouter un type de conduite</summary>' +
    field('Réseau', '<select id="npNet">' + netOptions('aep_n') + '</select>') + field('Description', '<input id="npDesc" type="text" placeholder="Ø160 PVC">') +
    field('Épaisseur', '<input id="npW" type="number" value="4" min="1" max="12" step="0.5">') + field('Trait', '<select id="npDash">' + optHtml('solid', 'Plein', 1) + optHtml('dashed', 'Tireté') + optHtml('dotted', 'Pointillé') + '</select>') +
    '<button class="btn small" data-do="addpipe" type="button">Ajouter</button></details>';
  h += '<details class="rp-det"><summary>Ajouter un type de regard</summary>' +
    field('Nom', '<input id="nmName" type="text" placeholder="Regard PP Ø800">') + field('Réseau', '<select id="nmNet">' + netOptions('eu_n') + '</select>') +
    field('Nature', '<input id="nmNat" type="text" placeholder="Regard PP">') + field('Diamètre (mm)', '<input id="nmDiam" type="text" placeholder="800">') + field('Préfixe', '<input id="nmPre" type="text" value="R">') +
    '<button class="btn small" data-do="addmh" type="button">Ajouter</button></details>';
  h += '<details class="rp-det"><summary>Ajouter un accessoire</summary>' +
    field('Nom', '<input id="naName" type="text" placeholder="Vanne papillon">') + field('Réseau', '<select id="naNet">' + netOptions('aep_n') + '</select>') +
    field('Forme', '<select id="naShape">' + optHtml('circle', 'Rond') + optHtml('diamond', 'Losange') + optHtml('triangle', 'Triangle') + optHtml('square', 'Carré') + '</select>') +
    field('Lettre', '<input id="naLet" type="text" maxlength="3">') + field('Texte affiché', '<input id="naTpl" type="text" placeholder="Vanne {d}">') +
    '<button class="btn small" data-do="addacc" type="button">Ajouter</button></details>';
  h += '<div class="rp-row"><button class="btn small" data-do="reset" type="button">Remettre les réglages d’origine</button></div>';
  return h;
}

function syncPanel() {
  if (!root || !ph) { return; }
  root.querySelectorAll('.rp-tab').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab ? 'true' : 'false'));
  const body = q('#rpPanel');
  // Si l'utilisateur est en train d'écrire dans le panneau, on ne le recrée pas
  if (document.activeElement && body.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') { updateButtons(); return; }
  body.innerHTML = tab === 'draw' ? panelDraw() : tab === 'obj' ? panelObj() : panelOpts();
  updateButtons();
}

function updateButtons() {
  if (!root) { return; }
  q('#rpUndo').disabled = historyPos <= 0;
  q('#rpRedo').disabled = historyPos >= history.length - 1;
  q('#rpFinish').hidden = !(draft && draft.pts.length >= 2);
  root.querySelectorAll('#rpTools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false'));
  const s = q('#rp3d'), r = q('#rp3dOff');
  s.disabled = !curCam;
  s.title = curCam ? 'Place les objets de cette photo dans la vue 3D' : 'Cette photo n’a pas de position ou de direction';
  s.textContent = sentFlag ? 'Mettre à jour la 3D' : 'Envoyer en 3D';
  r.hidden = !sentFlag;
}

// Modification d'un champ du panneau
function onField(e, final) {
  const t = e.target;
  if (t.dataset.a) { // choix du préréglage à poser
    armed[t.dataset.a] = t.value; saveCfg(); say(''); return;
  }
  if (t.dataset.f === 'showGhosts') { showGhosts = t.checked; saveCfg(); render(); syncPanel(); return; }
  const f = t.dataset.f;
  if (!f) { return; }
  let v = t.dataset.k === 'bool' ? t.checked : (t.dataset.k === 'num' ? Number(t.value) : t.value);
  if (t.dataset.s) { // réglage général
    C.S[f] = v; saveCfg();
    if (final) { commit(); }
    return;
  }
  const o = objOf(selId);
  if (!o) { return; }
  o[f] = v;
  if (final && t.dataset.preset === 'acc') {
    const d = C.accOf(v) || {};
    Object.assign(o, { m1: d.m1 || '', m2: d.m2 || '', d: d.d || '', d2: d.d2 || '', text: '' });
    delete o.dManual;
  }
  if (final && t.dataset.preset === 'mh') {
    const d = C.mhOf(v) || {};
    Object.assign(o, { nature: d.nature, diam: d.diam });
  }
  if (final || t.type === 'checkbox' || t.tagName === 'SELECT') { commit([o]); if (t.dataset.preset) { syncPanel(); } } else { render(); }
}

function onAction(act) {
  const o = selId ? objOf(selId) : null;
  if (act === 'del' && o) { ph.objects.splice(ph.objects.indexOf(o), 1); selId = null; commit(); return; }
  if (act === 'unlabel' && o) { delete o.lp; commit([o]); return; }
  if (act === 'kit' && o && o.kit) { const v = C.toggleKitGroup(ph, o.kit); say(v ? 'Montage regroupé.' : 'Pièces du montage dégroupées : elles se déplacent librement.'); commit(); return; }
  if (act === 'parallel' && o) {
    const r = C.genParallel(ph, o, q('#rpParPipe').value, q('#rpParSide').value, Number(q('#rpParDist').value) || 14, q('#rpParKeep').checked, unit());
    if (r.error) { say(r.error); return; }
    say('Tracé parallèle créé' + (r.branches ? ' avec ' + r.branches + ' branchement' + (r.branches > 1 ? 's' : '') : '') + '.');
    selId = r.line.id; commit(); return;
  }
  if (act === 'autocal') { return autoCal(); }
  if (act === 'refcal') { return startRef(); }
  if (act === 'ref-next') { return refNext(); }
  if (act === 'calib') { return startCalib(); }
  if (act === 'calib-ok') { return endCalib(true); }
  if (act === 'calib-cancel') { return endCalib(false); }
  if (act === 'calib-undo' && calib) {
    calib.pairs.pop(); calib.pending = null;
    solveNow(); refDraw();
    syncPanel(); return;
  }
  if (act === 'adj-reset') { applyAdj(ADJ0(), true); say('Réglages de la photo remis à zéro.'); syncPanel(); return; }
  if (act === 'ext-end' || act === 'ext-start') { return startExtension(act === 'ext-start'); }
  if (act === 'adopt' && gSel) { return adoptGhost(); }
  if (act === 'gdel' && gSel) { return deleteGhostSource(); }
  if (act === 'kits') { C.S.kits = C.kitsFromText(q('#rpKits').value); saveCfg(); say(C.S.kits.length + ' montage(s) enregistré(s).'); return; }
  if (act === 'addpipe') {
    const d = q('#npDesc').value.trim();
    if (!d) { say('Écrivez une description.'); return; }
    const p = { id: 'pp' + Date.now().toString(36), net: q('#npNet').value, desc: d, w: Number(q('#npW').value) || 4, dash: q('#npDash').value };
    C.S.pipes.push(p); armed.pipe = p.id; saveCfg(); say('Conduite ajoutée et choisie.'); tab = 'draw'; syncPanel(); return;
  }
  if (act === 'addmh') {
    const n = q('#nmName').value.trim();
    if (!n) { say('Écrivez un nom.'); return; }
    const m = { id: 'pm' + Date.now().toString(36), name: n, net: q('#nmNet').value, nature: q('#nmNat').value.trim() || n, diam: q('#nmDiam').value.trim(), prefix: q('#nmPre').value.trim() || 'R' };
    C.S.manholes.push(m); armed.mh = m.id; saveCfg(); say('Regard ajouté et choisi.'); tab = 'draw'; syncPanel(); return;
  }
  if (act === 'addacc') {
    const n = q('#naName').value.trim();
    if (!n) { say('Écrivez un nom.'); return; }
    const a = { id: 'pa' + Date.now().toString(36), name: n, shape: q('#naShape').value, letter: q('#naLet').value.trim().toUpperCase(), net: q('#naNet').value, tpl: q('#naTpl').value.trim() || n, m1: '', m2: '', d: '', d2: '' };
    C.S.accessories.push(a); armed.acc = a.id; saveCfg(); say('Accessoire ajouté et choisi.'); tab = 'draw'; syncPanel(); return;
  }
  if (act === 'reset') {
    if (!confirm('Remettre tous les réglages et préréglages d’origine ? Les repérages déjà faits ne changent pas.')) { return; }
    C.loadSettings(null); C.S.pipes = C.defaults().pipes; saveCfg(); fixArmed(); syncPanel(); render(); say('Réglages remis à zéro.');
  }
}

// Prolonger une conduite (la sienne ou celle d'une autre photo)
function startExtension(atStart) {
  let L, key = null;
  if (gSel) {
    L = ghosts && ghosts.ph.objects.find(x => x.id === gSel.oid && x.gk === gSel.key);
    key = gSel.key;
  } else { L = objOf(selId); }
  if (!L || L.type !== 'line') { return; }
  const end = atStart ? L.pts[0] : L.pts[L.pts.length - 1];
  tool = 'line'; canvas.dataset.tool = 'line';
  draft = { pts: [{ x: end.x, y: end.y }], ext: { key: key, oid: L.id, atStart: atStart } };
  selId = null; gSel = null; tab = 'draw';
  say('Cliquez les points à ajouter au ' + (atStart ? 'début' : 'bout') + ' de la conduite. Double-clic ou Entrée pour finir.');
  syncPanel(); render();
}
function adoptGhost() {
  const g = ghosts && ghosts.ph.objects.find(x => x.id === gSel.oid && x.gk === gSel.key);
  if (!g) { return; }
  const c = clone(g);
  c.id = C.uid(); c.from = gSel.key + ':' + g.id; delete c.gk;
  const srcRec = others.find(x => x.key === gSel.key), srcObj = srcRec && srcRec.rec.objs.find(x => x.id === g.id);
  if (srcObj) { c.fromSig = sigOf(srcObj); }
  if (c.pts) { c.pts = c.pts.map(p => ({ x: p.x, y: p.y })); }
  ph.objects.push(c);
  selId = c.id; gSel = null; tab = 'obj';
  computeGhosts();
  say('Dessin repris dans cette photo : vous pouvez maintenant le modifier ici.');
  commit([c]);
}
function deleteGhostSource() {
  const o = others.find(x => x.key === gSel.key);
  if (!o || !confirm('Supprimer ce dessin sur « ' + (o.name || 'l’autre photo') + ' » ?')) { return; }
  o.rec.objs = o.rec.objs.filter(x => x.id !== gSel.oid);
  gSel = null;
  saveOther(o.key);
}


/* ---------- 8. Construire l'écran ---------- */
/* Appelée une seule fois, la première fois qu'on ouvre le repérage. */

function buildScreen() {
  root = document.createElement('div');
  root.id = 'rpView';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Repérage sur la photo');
  root.hidden = true;
  root.innerHTML =
    '<div class="rp-bar">' +
      '<div class="v-title"><b id="rpName"></b><small>Repérage de réseaux</small></div>' +
      '<span class="rp-tools" id="rpTools" role="toolbar" aria-label="Outils">' +
        '<button type="button" data-tool="select" title="Sélectionner, déplacer, modifier">Sélection</button>' +
        '<button type="button" data-tool="line" title="Dessiner une conduite">Conduite</button>' +
        '<button type="button" data-tool="branch" title="Branchement automatique depuis la conduite la plus proche">Branchement</button>' +
        '<button type="button" data-tool="manhole" title="Poser un regard">Regard</button>' +
        '<button type="button" data-tool="acc" title="Poser un accessoire">Accessoire</button>' +
        '<button type="button" data-tool="text" title="Ajouter un texte">Texte</button>' +
        '<button type="button" data-tool="legend" title="Placer la légende">Légende</button>' +
      '</span>' +
      '<span class="rp-act">' +
        '<button class="vb wide" id="rpUndo" type="button" title="Annuler (Ctrl+Z)">Annuler</button>' +
        '<button class="vb wide" id="rpRedo" type="button" title="Rétablir (Ctrl+Y)">Rétablir</button>' +
        '<button class="vb wide" id="rpFit" type="button">Ajuster</button>' +
        '<button class="vb wide" id="rpPng" type="button" title="Photo avec le repérage dessiné dessus">Exporter l’image</button>' +
        '<button class="vb" id="rpClose" type="button" aria-label="Terminer">✕</button>' +
      '</span>' +
    '</div>' +
    '<div class="rp-body">' +
      '<div class="rp-stage"><canvas id="rpCv"></canvas><span class="rp-msg" id="rpMsg">Chargement…</span></div>' +
      '<aside class="rp-side">' +
        '<div class="rp-tabs" role="tablist"><button class="rp-tab" type="button" data-tab="draw">Dessiner</button><button class="rp-tab" type="button" data-tab="obj">Objet</button><button class="rp-tab" type="button" data-tab="opts">Options</button></div>' +
        '<div id="rpPanel" class="rp-panel"></div>' +
        '<div class="rp-end">' +
          '<button class="btn small" id="rpFinish" type="button" hidden>Terminer la conduite</button>' +
          '<button class="btn small primary" id="rp3d" type="button">Envoyer en 3D</button>' +
          '<button class="btn small" id="rp3dOff" type="button" hidden>Retirer de la 3D</button>' +
          '<button class="btn small" id="rpClear" type="button">Tout effacer</button>' +
        '</div>' +
        '<p class="hint" id="rpHint" aria-live="polite"></p>' +
      '</aside>' +
    '</div>';
  document.body.appendChild(root);
  canvas = q('#rpCv');
  ctx = canvas.getContext('2d');

  q('#rpTools').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) { setTool(b.dataset.tool); } });
  root.querySelector('.rp-tabs').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) { tab = b.dataset.tab; syncPanel(); } });
  const panel = q('#rpPanel');
  panel.addEventListener('input', function (e) { if (e.target.dataset.f && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') { onField(e, false); } });
  panel.addEventListener('change', function (e) { if (e.target.dataset.adj) { return; } onField(e, true); });
  // Curseurs de réglage fin : la caméra est refaite à chaque mouvement
  panel.addEventListener('input', function (e) {
    const f = e.target.dataset.adj;
    if (!f) { return; }
    const a = Object.assign({}, curAdj); a[f] = Number(e.target.value);
    applyAdj(a, true);
    const b = e.target.parentNode.querySelector('b');
    if (b) { b.textContent = (Math.round(a[f] * 100) / 100) + (f === 'zoom' ? '×' : (f === 'e' || f === 'n' || f === 'z') ? ' m' : '°'); }
  });
  panel.addEventListener('click', function (e) { const b = e.target.closest('[data-do]'); if (b) { onAction(b.dataset.do); } });

  q('#rpFinish').addEventListener('click', finishLine);
  q('#rpClear').addEventListener('click', function () {
    if (ph.objects.length && confirm('Effacer tout le repérage de cette photo ?')) { ph.objects = []; selId = null; draft = null; commit(); }
  });
  q('#rpUndo').addEventListener('click', () => undo(-1));
  q('#rpRedo').addEventListener('click', () => undo(1));
  q('#rpFit').addEventListener('click', fitToScreen);
  q('#rpPng').addEventListener('click', exportPng);
  q('#rpClose').addEventListener('click', close);
  q('#rp3d').addEventListener('click', () => sendTo3D(false));
  q('#rp3dOff').addEventListener('click', removeFrom3D);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('mousedown', e => e.preventDefault()); // garde le focus dans la zone de texte
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', function () { if (!root.hidden) { fitToScreen(); } });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space') { spaceDown = false; } });
  window.addEventListener('keydown', function (e) {
    if (root.hidden) { return; }
    const tag = e.target.tagName || '', typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.code === 'Space' && !typing) { spaceDown = true; e.preventDefault(); }
    if (typing) { return; }
    const key = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
    else if (ctrl && key === 'y') { e.preventDefault(); undo(1); }
    else if (e.key === 'Enter' && calib) { endCalib(true); }
    else if (e.key === 'Enter' && draft) { finishLine(); }
    else if (e.key === 'Escape') {
      e.stopPropagation();
      if (calib) { endCalib(false); } else if (draft) { draft = null; render(); } else if (tool !== 'select') { setTool('select'); } else if (selId || gSel) { selId = null; gSel = null; syncPanel(); render(); } else { close(); }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); onAction('del'); }
  }, true);
}


/* ---------- 9. Envoi en 3D et export ---------- */

// Envoie le repérage de cette photo dans la vue 3D (silent = sans message)
function sendTo3D(silent) {
  if (!curCam) { say('Cette photo n’a pas de position ou de direction (GPS / boussole) : impossible de la placer en 3D.'); return; }
  const r = C.toNetItems(ph, curCam);
  if (!info.onSend3D) { return; }
  info.onSend3D(r.items);
  if (!sentFlag) { sentFlag = true; saveNow(); }
  if (!silent) {
    say(r.items.length ? r.items.length + ' élément' + (r.items.length > 1 ? 's' : '') + ' envoyé' + (r.items.length > 1 ? 's' : '') + ' en 3D' + (r.skipped ? ' (' + r.skipped + ' ignoré' + (r.skipped > 1 ? 's' : '') + ' : hors du sol visible)' : '') + '.' : 'Rien à envoyer : placez des objets sur le sol de la photo.');
    syncPanel();
  }
  updateButtons();
}
function removeFrom3D() {
  if (info.onSend3D) { info.onSend3D(null); }
  sentFlag = false; saveNow(); say('Repérage retiré de la 3D.'); updateButtons();
}

// Les éléments 3D d'un repérage enregistré (utilisé par le site pour mettre la 3D à jour)
export function recordToItems(rec, photo) {
  if (!rec || !rec.objs) { return null; }
  const p = { w: rec.w, h: rec.h, objects: JSON.parse(JSON.stringify(rec.objs)) };
  const cam = makeCamera(photo, { w: rec.w, h: rec.h });
  return cam ? C.toNetItems(p, cam).items : null;
}

function exportPng() {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  C.draw(c, ph, unit(), { ui: false });
  cv.toBlob(function (blob) {
    if (!blob) { return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (info.name || 'photo').replace(/\.[^.]+$/, '') + '-reperage.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }, 'image/png');
}


/* ---------- 10. Les fonctions utilisées par le reste du site ---------- */

// Remet à l'échelle un repérage enregistré sur une photo de taille différente
function rescale(objs, r) {
  const f = v => (typeof v === 'number' ? v * r : v);
  objs.forEach(function (o) {
    ['x', 'y', 'cx', 'cy', 'rx', 'ry'].forEach(k => { if (k in o) { o[k] = f(o[k]); } });
    if (o.pts) { o.pts.forEach(p => { p.x *= r; p.y *= r; }); }
    if (o.lp) { o.lp.x *= r; o.lp.y *= r; }
  });
  return objs;
}
// Lit un repérage enregistré (ancienne ou nouvelle version) pour une photo de largeur w
function readRecord(data, w, h) {
  if (!data) { return { objs: [], sent: false }; }
  if (Array.isArray(data)) { return { objs: C.migrate(data, w), sent: false }; }
  let objs = JSON.parse(JSON.stringify(data.objs || []));
  if (data.w && Math.abs(data.w - w) > 1) { rescale(objs, w / data.w); }
  return { objs: objs, sent: !!data.sent };
}

/* Ouvre le repérage pour une photo.
   options = {
     name, src,           nom et adresse de la photo
     data,                repérage déjà enregistré
     photo,               position et direction de la photo (pour la 3D et les autres photos)
     others,              [{ key, name, photo, data }] : les autres photos qui ont un repérage
     onSave(record),      appelée à chaque modification
     onSaveOther(key, record),  appelée quand on modifie le dessin d'une autre photo
     onSend3D(items|null),      envoi (ou retrait) du repérage dans la vue 3D
     onClose()
   } */
export function open(options) {
  if (!root) { buildScreen(); }
  info = options;
  ph = null; img = null; calib = null; clearTimeout(sendTimer); selId = null; gSel = null; draft = null; hover = null; hoverSnap = null; ghosts = null;
  tool = 'select'; tab = 'draw'; canvas.dataset.tool = 'select';
  fixArmed();
  q('#rpName').textContent = options.name || 'Photo';
  root.hidden = false;
  const msg = q('#rpMsg');
  msg.hidden = false; msg.textContent = 'Chargement…';
  say('');
  const pic = new Image();
  pic.onload = function () {
    img = pic;
    msg.hidden = true;
    const rec = readRecord(options.data, pic.naturalWidth, pic.naturalHeight);
    ph = { w: pic.naturalWidth, h: pic.naturalHeight, objects: rec.objs };
    sentFlag = rec.sent;
    curAdj = Object.assign(ADJ0(), (options.photo && options.photo.adj) || {});
    calib = null;
    curCam = makeCamera(poseFor(), { w: ph.w, h: ph.h });
    // Les autres photos : on garde seulement celles qui ont un repérage au nouveau format
    others = (options.others || []).map(o => ({ key: o.key, name: o.name, photo: o.photo, rec: o.data && o.data.v === 2 ? JSON.parse(JSON.stringify(o.data)) : null })).filter(o => o.rec);
    computeGhosts();
    C.syncAll(ph);
    history = [C.snapshot(ph.objects)]; historyPos = 0;
    fitToScreen();
    syncPanel();
    if (!curCam) { say('Cette photo n’a pas de position ou de direction : le repérage reste possible, mais pas l’envoi en 3D.'); }
    else if (ghosts) { say('Les dessins des autres photos apparaissent en transparence : cliquez-en un pour le modifier ou le prolonger.'); }
  };
  pic.onerror = function () { msg.textContent = 'Cette photo ne peut pas être repérée dans le navigateur.'; };
  pic.src = options.src;
  syncPanel();
  q('#rpClose').focus();
}

/* Dessine le repérage d'une photo (et, si on veut, celui des autres photos reporté ici) sur un canvas posé sur la photo
   affichée dans la visionneuse : on voit les dessins sans rouvrir le repérage.
   o = { w, h, data, photo, others:[{photo,data}], showOthers } */
export function paintOverlay(cv, o) {
  cv.width = o.w; cv.height = o.h;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, o.w, o.h);
  const u = o.w / 1000;
  const cam = o.photo ? makeCamera(o.photo, { w: o.w, h: o.h }) : null;
  if (o.showOthers && cam) {
    const objs = [], solid = [];
    (o.others || []).forEach(function (x) {
      if (!x.data || x.data.v !== 2 || !x.data.objs) { return; }
      const ca = makeCamera(x.photo, { w: x.data.w, h: x.data.h });
      if (!ca) { return; }
      x.data.objs.forEach(function (ob) { const p = C.projectObject(JSON.parse(JSON.stringify(ob)), ca, cam); if (p) { (x.solid ? solid : objs).push(p); } });
    });
    if (objs.length) { c.save(); c.globalAlpha = 0.55; C.draw(c, { w: o.w, h: o.h, objects: objs }, u, { ui: false }); c.restore(); }
    if (solid.length) { c.save(); c.globalAlpha = 0.92; C.draw(c, { w: o.w, h: o.h, objects: solid }, u, { ui: false }); c.restore(); }
  }
  if (o.data && o.data.v === 2 && o.data.objs && o.data.objs.length) {
    const sx = o.w / o.data.w;
    const objs = JSON.parse(JSON.stringify(o.data.objs));
    if (Math.abs(sx - 1) > 0.001) { c.save(); c.scale(sx, sx); C.draw(c, { w: o.data.w, h: o.data.h, objects: objs }, o.data.w / 1000, { ui: false }); c.restore(); }
    else { C.draw(c, { w: o.w, h: o.h, objects: objs }, u, { ui: false }); }
  }
}

export function close() {
  if (!root || root.hidden) { return; }
  if (textEditor) { closeTextEditor(true); }
  if (calib) { endCalib(true); }
  refClose();
  if (draft) { draft = null; }
  clearTimeout(sendTimer);
  root.hidden = true;
  img = null;
  const f = info && info.onClose;
  info = null;
  if (f) { f(); }
}

export function isOpen() { return !!root && !root.hidden; }
