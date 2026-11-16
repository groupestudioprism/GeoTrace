/* Repérage sur photo : annoter une photo de chantier (conduites, regards, accessoires, textes).
   Version simple : pas d'automatisme, tout se dessine à la main. Les objets sont rangés en pixels de la photo. */

export const NETS = [
  { id: 'aep-n', name: 'AEP neuf', col: '#3CA9E8' },
  { id: 'aep-e', name: 'AEP existant', col: '#1F3FC8' },
  { id: 'eu-n', name: 'EU neuf', col: '#F26A1B' },
  { id: 'eu-e', name: 'EU existant', col: '#9A5B0A' },
  { id: 'ep-n', name: 'EP neuf', col: '#35B568' },
  { id: 'ep-e', name: 'EP existant', col: '#1C6B3A' },
  { id: 'ab', name: 'À abandonner', col: '#C2278F', dash: 'dashed' },
];
const SHAPES = [['circle', 'Rond'], ['diamond', 'Losange'], ['triangle', 'Triangle'], ['square', 'Carré']];
const DIAMS = ['Ø110', 'Ø160', 'Ø200', 'Ø250', 'Ø315', 'Ø400', 'Ø500'];
const col = id => (NETS.find(n => n.id === id) || NETS[0]).col;
const dashOf = id => (NETS.find(n => n.id === id) || {}).dash || 'solid';
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let root, cv, cx, img, S, ui;
const T = { s: 1, x: 0, y: 0 };            // vue : image → écran
let objs = [], sel = -1, tool = 'select', draft = null, hist = [], hpos = -1, drag = null, textEd = null;
let cfg = { net: 'aep-n', label: '', shape: 'circle', size: 1 };
let cb = null;

function u() { return Math.max(1, (img ? img.naturalWidth : 1400) / 1400) * cfg.size; }
const toImg = (px, py) => ({ x: (px - T.x) / T.s, y: (py - T.y) / T.s });
const rectOf = () => cv.getBoundingClientRect();

/* ---------- dessin ---------- */
function setDash(c, kind, w) { c.setLineDash(kind === 'dashed' ? [w * 2.6, w * 1.6] : kind === 'dotted' ? [w * .1, w * 1.9] : []); c.lineCap = kind === 'dotted' ? 'round' : 'butt'; }
function halo(c, text, x, y, fs, color, align = 'left') {
  c.font = `600 ${fs}px "Public Sans","Segoe UI",system-ui,sans-serif`; c.textAlign = align; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = fs * .3; c.strokeStyle = 'rgba(255,255,255,.95)'; c.strokeText(text, x, y);
  c.fillStyle = color; c.fillText(text, x, y);
}
function symbol(c, shape, r) {
  c.beginPath();
  if (shape === 'square') c.rect(-r, -r, 2 * r, 2 * r);
  else if (shape === 'diamond') { c.moveTo(0, -r * 1.25); c.lineTo(r * 1.25, 0); c.lineTo(0, r * 1.25); c.lineTo(-r * 1.25, 0); c.closePath(); }
  else if (shape === 'triangle') { c.moveTo(0, -r * 1.2); c.lineTo(r * 1.15, r * .9); c.lineTo(-r * 1.15, r * .9); c.closePath(); }
  else c.arc(0, 0, r, 0, Math.PI * 2);
}
function drawObj(c, o, k, selected) {
  const col_ = col(o.net);
  if (o.t === 'l') {
    if (o.pts.length < 2) return;
    const w = 4.2 * k;
    c.save(); c.lineJoin = 'round';
    c.beginPath(); c.moveTo(o.pts[0].x, o.pts[0].y); for (let i = 1; i < o.pts.length; i++) c.lineTo(o.pts[i].x, o.pts[i].y);
    setDash(c, dashOf(o.net), w + 2 * k); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = w + 2 * k; c.stroke();
    setDash(c, dashOf(o.net), w); c.strokeStyle = col_; c.lineWidth = w; c.stroke();
    c.restore();
    if (o.label) { // texte posé au milieu de la conduite, toujours lisible
      let tot = 0; const seg = [];
      for (let i = 1; i < o.pts.length; i++) { const d = Math.hypot(o.pts[i].x - o.pts[i - 1].x, o.pts[i].y - o.pts[i - 1].y); seg.push(d); tot += d; }
      let h = tot / 2, i = 0; while (i < seg.length - 1 && h > seg[i]) { h -= seg[i]; i++; }
      const a = o.pts[i], b = o.pts[i + 1], f = seg[i] ? h / seg[i] : 0;
      const mx = a.x + (b.x - a.x) * f, my = a.y + (b.y - a.y) * f;
      let ang = Math.atan2(b.y - a.y, b.x - a.x); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      c.save(); c.translate(mx, my); c.rotate(ang); halo(c, o.label, 0, -9 * k, 12.5 * k, col_, 'center'); c.restore();
    }
  } else if (o.t === 'm') {
    const r = 15 * k; c.save(); c.translate(o.x, o.y);
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,.55)'; c.fill();
    c.fillStyle = col_ + '44'; c.fill(); c.lineWidth = 4.4 * k; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
    c.lineWidth = 2.6 * k; c.strokeStyle = col_; c.stroke();
    c.restore();
    if (o.label) halo(c, o.label, o.x + r + 6 * k, o.y - r * .6, 12.5 * k, col_);
  } else if (o.t === 'a') {
    const r = 9 * k; c.save(); c.translate(o.x, o.y);
    symbol(c, o.shape, r); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2.6 * k; c.strokeStyle = col_; c.stroke();
    if (o.letter) { c.font = `700 ${r * 1.15}px "Public Sans",system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col_; c.fillText(o.letter, 0, r * .06); }
    c.restore();
    if (o.label) halo(c, o.label, o.x + r * 1.5 + 5 * k, o.y - r * .6, 12.5 * k, col_);
  } else if (o.t === 't') {
    const fs = 15 * k, lines = o.text.split('\n');
    c.save(); c.font = `700 ${fs}px "Public Sans",system-ui,sans-serif`;
    const w = Math.max(...lines.map(l => c.measureText(l).width)) + fs * 1.1, h = lines.length * fs * 1.25 + fs * .6;
    c.fillStyle = 'rgba(255,255,255,.94)'; c.fillRect(o.x, o.y, w, h);
    c.fillStyle = col_; c.fillRect(o.x, o.y, fs * .2, h);
    c.fillStyle = '#131B24'; c.textAlign = 'left'; c.textBaseline = 'middle';
    lines.forEach((l, i) => c.fillText(l, o.x + fs * .55, o.y + fs * .3 + fs * 1.25 * (i + .5)));
    c.restore(); o._w = w; o._h = h;
  }
  if (selected) { // cadre de sélection + poignées
    c.save(); c.lineWidth = 1.6 * k; c.strokeStyle = '#12b5f0'; c.fillStyle = '#fff'; c.setLineDash([5 * k, 3 * k]);
    const b = boxOf(o, k); c.strokeRect(b.x, b.y, b.w, b.h); c.setLineDash([]);
    if (o.t === 'l') for (const p of o.pts) { c.beginPath(); c.arc(p.x, p.y, 5.5 * k, 0, Math.PI * 2); c.fill(); c.stroke(); }
    c.restore();
  }
}
function boxOf(o, k) {
  const pad = 8 * k;
  if (o.t === 'l') { const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys); return { x: x - pad, y: y - pad, w: Math.max(...xs) - x + pad * 2, h: Math.max(...ys) - y + pad * 2 }; }
  if (o.t === 't') return { x: o.x - 3 * k, y: o.y - 3 * k, w: (o._w || 80) + 6 * k, h: (o._h || 30) + 6 * k };
  const r = (o.t === 'm' ? 15 : 9) * k * 1.4; return { x: o.x - r, y: o.y - r, w: r * 2, h: r * 2 };
}
function scene(c, k, withUi) {
  objs.forEach((o, i) => drawObj(c, o, k, withUi && i === sel));
  if (withUi && draft && draft.pts.length) {
    drawObj(c, { t: 'l', net: cfg.net, label: '', pts: draft.pts.concat(draft.cur ? [draft.cur] : []) }, k, false);
    c.save(); c.fillStyle = '#fff'; c.strokeStyle = col(cfg.net); c.lineWidth = 2 * k;
    for (const p of draft.pts) { c.beginPath(); c.arc(p.x, p.y, 4.5 * k, 0, Math.PI * 2); c.fill(); c.stroke(); }
    c.restore();
  }
}
function render() {
  if (!cv || !img) return;
  const r = rectOf(), d = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
  cx.setTransform(d * T.s, 0, 0, d * T.s, d * T.x, d * T.y);
  cx.drawImage(img, 0, 0);
  scene(cx, u() / 1, true);
  refreshButtons();
}
function fit() {
  const r = rectOf(); if (!img || !r.width) return;
  T.s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight) * .98;
  T.x = (r.width - img.naturalWidth * T.s) / 2; T.y = (r.height - img.naturalHeight * T.s) / 2; render();
}

/* ---------- historique ---------- */
const snap = () => JSON.stringify(objs, (k, v) => (k[0] === '_' ? undefined : v));
function commit() { hist = hist.slice(0, hpos + 1); hist.push(snap()); hpos = hist.length - 1; save(); render(); }
function undo(dir) { const n = hpos + dir; if (n < 0 || n >= hist.length) return; hpos = n; objs = JSON.parse(hist[hpos]); sel = -1; draft = null; save(); render(); syncPanel(); }
function save() { if (cb && cb.onSave) cb.onSave(JSON.parse(snap())); }

/* ---------- sélection ---------- */
function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function hit(p) {
  const k = u(), tol = 9 / T.s + 3 * k;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o.t === 'l') { for (let j = 1; j < o.pts.length; j++) if (distSeg(p, o.pts[j - 1], o.pts[j]) < tol) return i; }
    else { const b = boxOf(o, k); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i; }
  }
  return -1;
}
function vertexAt(o, p) { const tol = 11 / T.s; return o.pts.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < tol); }

/* ---------- interactions ---------- */
const ptrs = new Map(); let pinch = null, pan = null, spaceDown = false;
function evPt(e) { const r = rectOf(); return toImg(e.clientX - r.left, e.clientY - r.top); }
function onDown(e) {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: T.s }; drag = null; pan = null; return; }
  if (textEd) closeText(true);
  const p = evPt(e);
  if (e.button === 1 || e.button === 2 || spaceDown) { pan = { x: e.clientX, y: e.clientY, tx: T.x, ty: T.y }; cv.classList.add('pan'); return; }
  if (tool === 'select') {
    if (sel >= 0 && objs[sel].t === 'l') { const vi = vertexAt(objs[sel], p); if (vi >= 0) { drag = { kind: 'v', vi, moved: false }; return; } }
    const i = hit(p);
    if (i >= 0) { sel = i; drag = { kind: 'o', last: p, moved: false }; syncPanel(); render(); }
    else { sel = -1; pan = { x: e.clientX, y: e.clientY, tx: T.x, ty: T.y }; cv.classList.add('pan'); syncPanel(); render(); }
  } else if (tool === 'line') {
    if (!draft) draft = { pts: [] };
    const last = draft.pts[draft.pts.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 3 / T.s) draft.pts.push(p);
    render();
  } else if (tool === 'manhole') { objs.push({ t: 'm', x: p.x, y: p.y, net: cfg.net, label: cfg.label }); sel = objs.length - 1; commit(); syncPanel(); }
  else if (tool === 'acc') { objs.push({ t: 'a', x: p.x, y: p.y, net: cfg.net, shape: cfg.shape, letter: cfg.letter || '', label: cfg.label }); sel = objs.length - 1; commit(); syncPanel(); }
  else if (tool === 'text') openText(p, e);
}
function onMove(e) {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, e);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), r = rectOf();
    zoomAt((a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top, pinch.s * d / pinch.d); return;
  }
  if (pan) { T.x = pan.tx + e.clientX - pan.x; T.y = pan.ty + e.clientY - pan.y; render(); return; }
  const p = evPt(e);
  if (drag && sel >= 0) {
    const o = objs[sel];
    if (drag.kind === 'v') { o.pts[drag.vi] = p; }
    else { const dx = p.x - drag.last.x, dy = p.y - drag.last.y; if (o.t === 'l') o.pts.forEach(q => { q.x += dx; q.y += dy; }); else { o.x += dx; o.y += dy; } drag.last = p; }
    drag.moved = true; render(); return;
  }
  if (tool === 'line' && draft) { draft.cur = p; render(); }
}
function onUp(e) {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
  if (pan) { pan = null; cv.classList.remove('pan'); }
  if (drag) { if (drag.moved) commit(); drag = null; }
}
function onDbl(e) { if (tool === 'line') { e.preventDefault(); finishLine(); } }
function finishLine() {
  if (!draft) return;
  const pts = draft.pts.slice(); // le double-clic ne rajoute pas de point en double (écarté dans onDown)
  draft = null;
  if (pts.length >= 2) { objs.push({ t: 'l', net: cfg.net, label: cfg.label, pts }); sel = objs.length - 1; commit(); syncPanel(); } else render();
}
function zoomAt(px, py, ns) {
  ns = Math.max(.05, Math.min(ns, 20)); const f = ns / T.s;
  T.x = px - (px - T.x) * f; T.y = py - (py - T.y) * f; T.s = ns; render();
}
function onWheel(e) { e.preventDefault(); const r = rectOf(); zoomAt(e.clientX - r.left, e.clientY - r.top, T.s * Math.exp(-e.deltaY * .0016)); }

/* ---------- saisie d'un texte ---------- */
function openText(p, e) {
  const r = rectOf(), box = el('textarea', 'rp-ted'); box.rows = 2; box.placeholder = 'Votre texte, Entrée pour valider';
  box.style.left = Math.min(r.width - 190, e.clientX - r.left) + 'px'; box.style.top = Math.min(r.height - 70, e.clientY - r.top) + 'px';
  cv.parentNode.appendChild(box); textEd = { box, p };
  box.addEventListener('keydown', k => { if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); closeText(true); } else if (k.key === 'Escape') { k.stopPropagation(); closeText(false); } });
  setTimeout(() => box.focus(), 0);
}
function closeText(ok) {
  if (!textEd) return; const { box, p } = textEd; textEd = null; const t = box.value.trim(); box.remove();
  if (ok && t) { objs.push({ t: 't', x: p.x, y: p.y, net: cfg.net, text: t }); sel = objs.length - 1; commit(); syncPanel(); }
}

/* ---------- panneau ---------- */
function syncPanel() {
  const o = sel >= 0 ? objs[sel] : null;
  if (o) { cfg.net = o.net; if (o.t !== 't') { cfg.label = o.label || ''; } if (o.t === 'a') { cfg.shape = o.shape; cfg.letter = o.letter || ''; } }
  ui.label.value = o ? (o.t === 't' ? o.text : o.label || '') : cfg.label;
  ui.letter.value = cfg.letter || '';
  ui.nets.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.net === cfg.net)));
  ui.shapes.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shape === cfg.shape)));
  ui.diams.hidden = !(tool === 'line' || (o && o.t === 'l'));
  ui.accRow.hidden = !(tool === 'acc' || (o && o.t === 'a'));
  render();
}
function refreshButtons() {
  ui.undo.disabled = hpos <= 0; ui.redo.disabled = hpos >= hist.length - 1; ui.del.disabled = sel < 0;
  ui.finish.hidden = !(draft && draft.pts.length >= 2);
  ui.tools.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  ui.hint.textContent = { select: sel >= 0 ? 'Glissez pour déplacer, tirez une poignée pour modifier le tracé.' : 'Touchez un objet pour le modifier. Glissez le fond pour déplacer la photo.', line: draft ? 'Touchez pour ajouter un point. Double-touchez ou « Terminer » pour finir.' : 'Touchez pour poser le premier point de la conduite.', manhole: 'Touchez pour poser un regard.', acc: 'Touchez pour poser un accessoire.', text: 'Touchez où placer le texte.' }[tool];
}
function setTool(t) { if (textEd) closeText(false); if (draft && t !== 'line') finishLine(); tool = t; if (t !== 'select') sel = -1; syncPanel(); cv.dataset.tool = t; }
function applyToSel(fn) { if (sel < 0) return; fn(objs[sel]); commit(); }

/* ---------- export ---------- */
function exportPng() {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0); scene(g, u(), false);
  c.toBlob(b => { if (!b) return; const a = el('a'); a.href = URL.createObjectURL(b); a.download = (S.name || 'photo').replace(/\.[^.]+$/, '') + '-reperage.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
}

/* ---------- interface ---------- */
function build() {
  root = el('div'); root.id = 'rpView'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Repérage sur la photo'); root.hidden = true;
  root.innerHTML = `
  <div class="rp-bar"><div class="v-title"><b id="rpName"></b><small>Repérage de réseaux</small></div>
    <span class="rp-tools" id="rpTools" role="toolbar" aria-label="Outils">
      <button type="button" data-tool="select" title="Sélectionner et déplacer">Sélection</button>
      <button type="button" data-tool="line" title="Dessiner une conduite">Conduite</button>
      <button type="button" data-tool="manhole" title="Poser un regard">Regard</button>
      <button type="button" data-tool="acc" title="Poser un accessoire">Accessoire</button>
      <button type="button" data-tool="text" title="Ajouter un texte">Texte</button></span>
    <span class="rp-act"><button class="vb wide" id="rpUndo" type="button" title="Annuler (Ctrl+Z)">Annuler</button><button class="vb wide" id="rpRedo" type="button" title="Rétablir (Ctrl+Y)">Rétablir</button>
    <button class="vb wide" id="rpFit" type="button">Ajuster</button><button class="vb wide" id="rpPng" type="button" title="Photo avec le repérage dessiné dessus">Exporter l’image</button>
    <button class="vb" id="rpClose" type="button" aria-label="Terminer">✕</button></span></div>
  <div class="rp-body"><div class="rp-stage"><canvas id="rpCv"></canvas><span class="rp-msg" id="rpMsg">Chargement…</span></div>
    <aside class="rp-side">
      <div class="rp-grp"><h4>Réseau</h4><div id="rpNets" class="rp-nets"></div></div>
      <div class="rp-grp"><h4>Texte affiché</h4><input id="rpLabel" type="text" maxlength="80" placeholder="Ex. Ø200 PP SN16" autocomplete="off" aria-label="Texte affiché sur l’objet">
        <div id="rpDiams" class="rp-chips"></div></div>
      <div class="rp-grp" id="rpAccRow"><h4>Accessoire</h4><div id="rpShapes" class="rp-chips"></div><input id="rpLetter" type="text" maxlength="3" placeholder="Lettre (V, C, T…)" aria-label="Lettre dans l’accessoire"></div>
      <div class="rp-grp"><h4>Taille des traits</h4><input id="rpSize" type="range" min="0.6" max="2.4" step="0.1" value="1" aria-label="Taille des traits et des textes"></div>
      <div class="rp-grp rp-end"><button class="btn small" id="rpFinish" type="button" hidden>Terminer la conduite</button><button class="btn small danger" id="rpDel" type="button">Supprimer</button><button class="btn small" id="rpClear" type="button">Tout effacer</button></div>
      <p class="hint" id="rpHint"></p>
    </aside></div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);
  ui = { tools: $('rpTools'), nets: $('rpNets'), label: $('rpLabel'), letter: $('rpLetter'), diams: $('rpDiams'), shapes: $('rpShapes'), accRow: $('rpAccRow'), undo: $('rpUndo'), redo: $('rpRedo'), del: $('rpDel'), finish: $('rpFinish'), hint: $('rpHint') };
  cv = $('rpCv'); cx = cv.getContext('2d');
  NETS.forEach(n => { const b = el('button', 'rp-net', `<i style="background:${n.col}"></i>${esc(n.name)}`); b.type = 'button'; b.dataset.net = n.id; ui.nets.appendChild(b); });
  DIAMS.forEach(d => { const b = el('button', 'chip', d); b.type = 'button'; b.dataset.d = d; ui.diams.appendChild(b); });
  SHAPES.forEach(([k, n]) => { const b = el('button', 'chip', n); b.type = 'button'; b.dataset.shape = k; ui.shapes.appendChild(b); });
  ui.tools.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTool(b.dataset.tool); });
  ui.nets.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.net = b.dataset.net; applyToSel(o => { o.net = cfg.net; }); syncPanel(); });
  ui.diams.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.label = b.dataset.d; applyToSel(o => { if (o.t === 'l') o.label = cfg.label; }); syncPanel(); });
  ui.shapes.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.shape = b.dataset.shape; applyToSel(o => { if (o.t === 'a') o.shape = cfg.shape; }); syncPanel(); });
  ui.label.addEventListener('input', () => { cfg.label = ui.label.value; const o = sel >= 0 ? objs[sel] : null; if (o) { if (o.t === 't') o.text = ui.label.value; else o.label = ui.label.value; render(); } });
  ui.label.addEventListener('change', () => { if (sel >= 0) commit(); });
  ui.letter.addEventListener('input', () => { cfg.letter = ui.letter.value.toUpperCase(); const o = sel >= 0 ? objs[sel] : null; if (o && o.t === 'a') { o.letter = cfg.letter; render(); } });
  ui.letter.addEventListener('change', () => { if (sel >= 0) commit(); });
  $('rpSize').addEventListener('input', e => { cfg.size = +e.target.value; render(); });
  ui.del.addEventListener('click', () => { if (sel >= 0) { objs.splice(sel, 1); sel = -1; commit(); syncPanel(); } });
  ui.finish.addEventListener('click', () => finishLine());
  $('rpClear').addEventListener('click', () => { if (objs.length && confirm('Effacer tout le repérage de cette photo ?')) { objs = []; sel = -1; draft = null; commit(); syncPanel(); } });
  ui.undo.addEventListener('click', () => undo(-1)); ui.redo.addEventListener('click', () => undo(1));
  $('rpFit').addEventListener('click', fit); $('rpPng').addEventListener('click', exportPng); $('rpClose').addEventListener('click', close);
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('mousedown', e => e.preventDefault()); cv.addEventListener('dblclick', onDbl); cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', () => { if (!root.hidden) fit(); });
  window.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  window.addEventListener('keydown', e => {
    if (root.hidden) return;
    const typing = /^(INPUT|TEXTAREA)$/.test((e.target.tagName || ''));
    if (e.code === 'Space' && !typing) { spaceDown = true; e.preventDefault(); }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(1); }
    else if (e.key === 'Enter' && draft) finishLine();
    else if (e.key === 'Escape') { e.stopPropagation(); if (draft) { draft = null; render(); } else if (tool !== 'select') setTool('select'); else close(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); ui.del.click(); }
  }, true);
}

export function open(opts) { // { name, src, data, onSave, onClose }
  if (!root) build();
  S = opts; cb = opts; objs = Array.isArray(opts.data) ? JSON.parse(JSON.stringify(opts.data)) : [];
  sel = -1; draft = null; hist = [snap()]; hpos = 0; tool = 'select'; cv.dataset.tool = 'select';
  root.querySelector('#rpName').textContent = opts.name || 'Photo'; root.hidden = false;
  const m = root.querySelector('#rpMsg'); m.hidden = false; m.textContent = 'Chargement…'; img = null;
  const im = new Image(); im.onload = () => { img = im; m.hidden = true; fit(); syncPanel(); }; im.onerror = () => { m.textContent = 'Cette photo ne peut pas être repérée dans le navigateur.'; };
  im.src = opts.src; syncPanel(); root.querySelector('#rpClose').focus();
}
export function close() {
  if (!root || root.hidden) return; if (textEd) closeText(true); if (draft) finishLine();
  root.hidden = true; img = null; const f = cb && cb.onClose; cb = null; if (f) f();
}
export const isOpen = () => !!root && !root.hidden;
