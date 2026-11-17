/* GeoTrace – repérage des réseaux directement sur la carte IGN.
   Même moteur que l'outil « Repérage de réseaux sur photos » (repere-core.js) : mêmes symboles, étiquettes,
   raccords automatiques, branchements. Les dessins sont en coordonnées locales (plan Mercator niveau 20,
   décalé d'une origine propre au projet), donc exacts sur le terrain, et partent en 3D (enterrés). */
const L = window.L;
const $ = id => document.getElementById(id);
const BASE = 'geotrace:rsx';
const Z0 = 20, WORLD = 256 * Math.pow(2, Z0), K = 1.15; // K : taille à l'écran d'une « unité » du moteur (px)
let KEY = BASE;
let C = null, Rep = null, loading = null;
let map = null, status = () => {}, onChange = () => {}, stopOthers = () => {}, send3D = () => {}, tabFn = () => {};
let cv = null, ctx2 = null, host = null;
let ref = null;                       // origine locale (px Mercator niveau 20)
let ph = { w: 1000, h: 1000, objects: [] };
let tool = null, armed = { pipe: null, mh: null, acc: null }, sel = null;
let draft = null, hover = null, hoverSnap = null, drag = null, ted = null, raf = 0;
let hist = [], hpos = -1, show = true, busy = false;

const mx = lon => (lon + 180) / 360 * WORLD;
const my = lat => (0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)) * WORLD;
const lonOf = x => x / WORLD * 360 - 180;
const latOf = y => 180 / Math.PI * (2 * Math.atan(Math.exp((0.5 - y / WORLD) * 2 * Math.PI)) - Math.PI / 2);
const toP = ll => ({ x: mx(ll[1] != null ? ll[1] : ll.lng) - ref.x, y: my(ll[0] != null ? ll[0] : ll.lat) - ref.y });
const toLL = p => [latOf(p.y + ref.y), lonOf(p.x + ref.x)];
const scale = () => Math.pow(2, map.getZoom() - Z0);
const unit = () => K / scale();
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const objOf = id => ph.objects.find(o => o.id === id);
const clean = o => JSON.parse(JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v)));

/* ---------- stockage ---------- */
const read = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.objs) && j.ref ? j : null; } catch (e) { return null; } };
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, ref, objs: clean(ph.objects) })); } catch (e) { /* stockage indisponible */ }
}
export const exportData = () => ph.objects.length && ref ? { v: 1, ref, objs: clean(ph.objects) } : null;
export function setScope(name, hasProject) {
  const next = BASE + (name ? ':' + name : '');
  if (next !== BASE) { try { if (localStorage.getItem(next) == null && !hasProject && localStorage.getItem(BASE) != null) { localStorage.setItem(next, localStorage.getItem(BASE)); localStorage.removeItem(BASE); } } catch (e) { /* ignoré */ } }
  KEY = next;
}
export function setProject(p) {
  const d = read() || (p && p.ref && Array.isArray(p.objs) ? p : null);
  ref = d ? d.ref : null; ph.objects = d ? d.objs : []; sel = null; draft = null; hist = [JSON.stringify(ph.objects)]; hpos = 0;
  if (C && ph.objects.length) { fixU(); C.syncAll(ph); }
  recap(); props(); draw();
}

/* ---------- chargement du moteur (à la demande) ---------- */
async function ensure() {
  if (C) return true;
  if (!loading) loading = (async () => { Rep = await import('./repere.js'); C = await import('./repere-core.js'); })().catch(e => { console.error(e); loading = null; });
  await loading;
  if (!C) { status('Le moteur de repérage n’a pas pu se charger.', { ms: 4000 }); return false; }
  const cfg = (() => { try { return JSON.parse(localStorage.getItem('geotrace:rsxarm') || 'null') || {}; } catch (e) { return {}; } })();
  armed = Object.assign({ pipe: null, mh: null, acc: null }, cfg);
  C.onSymLoad(draw); fixArmed(); fillPalette(); fixU(); if (ph.objects.length) C.syncAll(ph); recap(); draw();
  return true;
}
function fixArmed() {
  if (!C.pipeOf(armed.pipe)) armed.pipe = (C.S.pipes[0] || {}).id;
  if (!C.mhOf(armed.mh)) armed.mh = (C.S.manholes[0] || {}).id;
  if (!C.accOf(armed.acc)) armed.acc = (C.S.accessories[2] || C.S.accessories[0] || {}).id;
}
const saveArmed = () => { try { localStorage.setItem('geotrace:rsxarm', JSON.stringify(armed)); } catch (e) { /* ignoré */ } };
const fixU = () => { ph.w = ph.h = 1000 * unit(); ph.free = true; };

/* ---------- historique ---------- */
function commit(moved) {
  fixU(); C.syncAll(ph, moved || []);
  const s = JSON.stringify(clean(ph.objects));
  if (s !== hist[hpos]) { hist = hist.slice(0, hpos + 1); hist.push(s); if (hist.length > 80) hist.shift(); hpos = hist.length - 1; }
  persist(); onChange(); sync3D(); recap(); props(); draw(); btns();
}
function undo(dir) {
  const n = hpos + dir; if (n < 0 || n >= hist.length) return;
  hpos = n; ph.objects = JSON.parse(hist[n]); if (sel && !objOf(sel)) sel = null;
  persist(); onChange(); sync3D(); recap(); props(); draw(); btns();
}
function add(o, extra) { ph.objects.push(o); if (extra) ph.objects.push(...extra); sel = o.id; commit([o]); }

/* ---------- 3D ---------- */
let t3 = 0;
function sync3D() {
  clearTimeout(t3);
  t3 = setTimeout(() => {
    if (!C) return;
    const cam = { toGround: (x, y) => { const ll = toLL({ x, y }); return { lat: ll[0], lon: ll[1] }; } };
    const items = ph.objects.length ? C.toNetItems({ w: 1000, h: 1000, objects: clean(ph.objects) }, cam).items : null;
    send3D(items && items.length ? items : null);
  }, 400);
}

/* ---------- dessin sur la carte ---------- */
function origin() { const ll = map.containerPointToLatLng([0, 0]); return toP(ll); }
function draw() {
  if (!cv || !map) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(paint);
}
function paint() {
  const sz = map.getSize(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(sz.x * dpr) || cv.height !== Math.round(sz.y * dpr)) { cv.width = Math.round(sz.x * dpr); cv.height = Math.round(sz.y * dpr); cv.style.width = sz.x + 'px'; cv.style.height = sz.y + 'px'; }
  const c = ctx2; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
  if (!C || !ref || !show || !ph.objects.length && !draft) return;
  const s = scale(), o = origin(), u = unit();
  c.setTransform(dpr * s, 0, 0, dpr * s, -o.x * s * dpr, -o.y * s * dpr);
  fixU();
  ph.objects.forEach(m => { if (m.type === 'manhole' && !(m.rx > 0)) m.rx = m.ry = 11 * u; });
  C.draw(c, ph, u, { ui: !!tool, selected: sel ? [sel] : [], hs: 1 });
  if (draft && draft.pts.length) {
    const pd = C.pipeOf(draft.pipe || armed.pipe) || { w: 4, net: '' };
    const pts = draft.pts.concat(hover ? [hoverSnap ? hoverSnap.pos : hover] : []);
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = C.colOf(pd.net); c.lineWidth = pd.w * u; c.globalAlpha = .85;
    if (pd.dash === 'dashed') c.setLineDash([pd.w * u * 3.4, pd.w * u * 2.2]); else if (pd.dash === 'dotted') c.setLineDash([.01, pd.w * u * 2.3]);
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    draft.pts.forEach(p => { c.beginPath(); c.arc(p.x, p.y, 4 * u, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.6 * u; c.strokeStyle = '#12b5f0'; c.stroke(); });
    c.restore();
  }
  if (tool === 'line' && hoverSnap) { c.save(); c.beginPath(); c.arc(hoverSnap.pos.x, hoverSnap.pos.y, 7 * u, 0, 7); c.strokeStyle = hoverSnap.ext ? '#16a34a' : '#ffd400'; c.lineWidth = 2.4 * u; c.stroke(); c.restore(); }
}

/* ---------- souris ---------- */
const evP = e => { const r = map.getContainer().getBoundingClientRect(), s = scale(), o = origin(); return { x: o.x + (e.clientX - r.left) / s, y: o.y + (e.clientY - r.top) / s }; };
const tolPx = n => n / scale();
const active = () => !!tool && !!C && !!ref;
function ensureRef(ll) { if (!ref) ref = { x: mx(ll.lng), y: my(ll.lat) }; }

function setTool(t) {
  if (t && !ref) ensureRef(map.getCenter());
  tool = tool === t ? null : t;
  if (tool) { busy = true; try { stopOthers(); } finally { busy = false; } }
  draft = null; hover = null; hoverSnap = null; if (ted) closeTed(false);
  const c = map.getContainer();
  c.style.cursor = tool && tool !== 'select' ? 'crosshair' : ''; c.classList.toggle('rs-on', !!tool);
  if (tool && tool !== 'select') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  btns(); hint(); draw();
}
const HINT = {
  select: 'Cliquez un dessin pour le sélectionner, glissez-le pour le déplacer, ses poignées pour le modifier.',
  line: 'Cliquez le départ : au bout d’une conduite (cercle vert) elle se prolonge, sur un coude, un regard ou une conduite elle repart de là. Double-clic ou Entrée pour finir.',
  br: 'Cliquez une façade, un regard ou un accessoire : le branchement part de la conduite la plus proche.',
  manhole: 'Cliquez l’emplacement du regard.', acc: 'Cliquez l’emplacement de l’accessoire (les raccords se posent seuls sur la conduite).', text: 'Cliquez où poser le texte.'
};
function hint() { const h = $('rsHint'); if (h) h.textContent = tool ? HINT[tool] : 'Choisissez un outil, puis dessinez sur la carte.'; }

function onClick(e) {
  if (!active() || tool === 'select' || tool === null) return;
  if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.leaflet-control, .rs-ted')) return;
  const p = toP(e.latlng), u = unit(), tol = tolPx(9);
  fixU();
  if (tool === 'line') {
    if (!draft) {
      const st = startTarget(p, u, tol);
      draft = { pts: [st.pt], ext: st.ext, pipe: st.pipe || armed.pipe };
      if (st.pipe && st.pipe !== armed.pipe) { armed.pipe = st.pipe; saveArmed(); fillPalette(); }
      status(st.ext ? 'Prolongement de la conduite : cliquez les points suivants, double-clic pour finir.' : st.msg || 'Cliquez les points suivants.', { ms: 3500 });
      draw(); return;
    }
    const last = draft.pts[draft.pts.length - 1], ptol = tolPx(14);
    const tg = C.snapTarget(ph, p, u, ptol, null);
    // clic près du dernier point : on termine la conduite (comme l'outil d'origine)
    if (!tg && draft.pts.length >= 2 && Math.hypot(last.x - p.x, last.y - p.y) <= tolPx(12)) { finishLine(); return; }
    let q = { x: p.x, y: p.y };
    if (!tg && e.originalEvent && e.originalEvent.shiftKey && last) q = C.snapAngle(last, q);
    const pt = tg ? C.snappedPoint(ph, tg, p, last) : q;
    if (!(last && Math.hypot(last.x - pt.x, last.y - pt.y) <= tolPx(3))) draft.pts.push(pt);
    // arrivée sur un regard / un accessoire : la conduite s'arrête là
    if (tg && (tg.k === 'mh' || tg.k === 'acc') && C.S.autoEnd !== false && draft.pts.length >= 2) {
      status(tg.k === 'mh' ? 'Conduite reliée au regard.' : 'Conduite reliée à l’accessoire.', { ms: 2500 });
      finishLine(); return;
    }
    draw();
  } else if (tool === 'br') {
    const r = C.autoBranch(ph, p, u, armed.pipe, tol);
    if (r.error) { status(r.error, { ms: 4500 }); return; }
    status(r.msg, { ms: 4000 }); sel = r.line.id; commit([r.line]);
  } else if (tool === 'manhole') {
    const def = C.mhOf(armed.mh); if (def) add(C.newManhole(ph, p, def, u));
  } else if (tool === 'acc') {
    const def = C.accOf(armed.acc); if (!def) return;
    const kit = C.placeAcc(ph, p, def, u, tolPx(14) + 8 * u);
    if (kit) { status(kit.msg, { ms: 4500 }); sel = kit.sel.id; commit(kit.objs); return; }
    const na = C.newAcc(p, def, u); if (/COMPTEUR/.test(def.sym || '')) na.showLabel = false; C.alignAcc(na, ph, tolPx(18)); add(na);
  } else if (tool === 'text') {
    openTed(p, e.containerPoint);
  }
}
function finishLine() {
  if (!draft) return;
  const d = draft, pts = d.pts.slice(); draft = null; hover = null; hoverSnap = null;
  if (pts.length < 2) { draw(); return; }
  if (d.ext) {
    const L = objOf(d.ext.oid); if (!L) { draw(); return; }
    const addp = pts.slice(1);
    if (d.ext.atStart) L.pts.unshift(...addp.reverse()); else L.pts.push(...addp);
    sel = L.id; commit([L]); return;
  }
  add(C.newLine(pts, d.pipe || armed.pipe));
}

/* Où commence une conduite ? Au bout d'une conduite (on la prolonge), sur un coude, un regard ou un accessoire
   (on repart de là, avec le même type de conduite), au milieu d'une conduite (départ accroché), ou librement. */
function startTarget(p, u, tol) {
  const endTol = tolPx(14);
  let best = null;
  ph.objects.forEach(L => {
    if (L.type !== 'line' || L.pts.length < 2) return;
    [[0, true], [L.pts.length - 1, false]].forEach(([i, atStart]) => {
      const q = L.pts[i], d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= endTol && (!best || d < best.d)) best = { d, L, i, atStart };
    });
  });
  const tg = C.snapTarget(ph, p, u, tol, null);
  // un objet (coude, regard, accessoire) a la priorité sur le bout d'une conduite qui le rejoint
  if (tg && (tg.k === 'mh' || tg.k === 'acc')) {
    const o = tg.o, cx = tg.k === 'mh' ? o.cx : o.x, cy = tg.k === 'mh' ? o.cy : o.y, rad = tolPx(10);
    const ends = [];
    ph.objects.forEach(L => {
      if (L.type !== 'line' || L.pts.length < 2) return;
      [[0, true], [L.pts.length - 1, false]].forEach(([i, atStart]) => {
        const q = L.pts[i];
        if ((q.link && q.link.id === o.id) || Math.hypot(q.x - cx, q.y - cy) <= rad) ends.push({ L, atStart });
      });
    });
    const pt = C.snappedPoint(ph, tg, p);
    if (ends.length === 1) { const e = ends[0], q = e.atStart ? e.L.pts[0] : e.L.pts[e.L.pts.length - 1]; return { pt: { x: q.x, y: q.y }, ext: { oid: e.L.id, atStart: e.atStart }, pipe: e.L.pipeId }; }
    if (ends.length > 1) return { pt, pipe: ends[0].L.pipeId, msg: 'Nouvelle conduite depuis ce raccord, du même type que celle qui y arrive.' };
    return { pt, msg: 'Nouvelle conduite depuis cet élément.' };
  }
  if (best) { const q = best.L.pts[best.i]; return { pt: { x: q.x, y: q.y }, ext: { oid: best.L.id, atStart: best.atStart }, pipe: best.L.pipeId }; }
  if (tg) return { pt: C.snappedPoint(ph, tg, p), msg: 'Nouvelle conduite accrochée à la conduite : cliquez les points suivants.' };
  return { pt: { x: p.x, y: p.y } };
}
// Bouton « Prolonger » d'une conduite sélectionnée
function extend(atStart) {
  const L = sel && objOf(sel); if (!L || L.type !== 'line') return;
  const q = atStart ? L.pts[0] : L.pts[L.pts.length - 1];
  if (tool !== 'line') setTool('line');
  draft = { pts: [{ x: q.x, y: q.y }], ext: { oid: L.id, atStart }, pipe: L.pipeId };
  armed.pipe = L.pipeId; saveArmed(); fillPalette(); palShow(); btns(); hint(); draw();
  status('Cliquez les points du prolongement, double-clic pour finir.', { ms: 3500 });
}
function onDbl() { if (tool === 'line') finishLine(); }
function onMove(e) {
  if (tool !== 'line') return;
  const r = map.getContainer().getBoundingClientRect(), s = scale(), o = origin();
  hover = { x: o.x + (e.originalEvent.clientX - r.left) / s, y: o.y + (e.originalEvent.clientY - r.top) / s };
  if (draft) {
    const lastP = draft.pts[draft.pts.length - 1], tg = C.snapTarget(ph, hover, unit(), tolPx(14), null);
    if (!tg && e.originalEvent.shiftKey && lastP) { const q = C.snapAngle(lastP, hover); hover = q; hoverSnap = { pos: q }; }
    else hoverSnap = tg ? { pos: C.snappedPoint(ph, tg, hover, lastP) } : null;
  }
  else { fixU(); const st = startTarget(hover, unit(), tolPx(9)); hoverSnap = (st.ext || st.msg) ? { pos: st.pt, ext: !!st.ext } : null; }
  draw();
}

/* Sélection et déplacement : on capte l'appui avant la carte, seulement s'il touche un dessin */
function onDown(e) {
  if (!active() || tool !== 'select' || e.button > 0) return;
  if (e.target.closest && e.target.closest('.leaflet-control, .rs-ted, .leaflet-popup')) return;
  const p = evP(e), u = unit(), tol = tolPx(9); fixU();
  const cur = sel ? objOf(sel) : null;
  if (cur) {
    for (const h of C.handlesOf(cur, u)) {
      if (Math.hypot(p.x - h.x, p.y - h.y) <= tolPx(11)) {
        if (h.k === 'm') { cur.pts.splice(h.i + 1, 0, { x: h.x, y: h.y }); drag = { kind: 'v', o: cur, i: h.i + 1, moved: true }; }
        else if (h.k === 'v') drag = { kind: 'v', o: cur, i: h.i, moved: false };
        else drag = { kind: h.k === 'r' ? 'rot' : 's', hid: h.id, o: cur, moved: false };
        grab(e); return;
      }
    }
  }
  const hit = C.hitTest(ph, p, u, tol);
  if (hit) {
    const o = hit.o; sel = o.id;
    if (hit.label && o._lbx) drag = { kind: 'label', o, dx: p.x - o._lbx.x, dy: p.y - o._lbx.y, moved: false };
    else if (o.auto) drag = null;
    else drag = { kind: 'move', o, last: p, moved: false };
    props(); draw(); grab(e); return;
  }
  if (sel) { sel = null; props(); draw(); }
}
function grab(e) { e.stopPropagation(); e.preventDefault(); map.dragging.disable(); window.addEventListener('pointermove', onDragMove); window.addEventListener('pointerup', onUp, { once: true }); }
function onDragMove(e) {
  if (!drag) return;
  const p = evP(e), u = unit(), d = drag; d.moved = true; fixU();
  if (d.kind === 'v') {
    const tg = C.snapTarget(ph, p, u, tolPx(14), d.o), pt = d.o.pts[d.i], nb = d.o.pts[d.i - 1] || d.o.pts[d.i + 1];
    if (tg) { const s = C.snappedPoint(ph, tg, p, nb); pt.x = s.x; pt.y = s.y; pt.link = s.link; }
    else { const q = e.shiftKey && nb ? C.snapAngle(nb, p) : p; pt.x = q.x; pt.y = q.y; delete pt.link; }
    C.syncAll(ph, [d.o]);
  } else if (d.kind === 'rot' && d.o.type === 'manhole') {
    let a = Math.atan2(p.y - d.o.cy, p.x - d.o.cx) + Math.PI / 2;
    if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    d.o.rot = a;
    C.syncAll(ph, [d.o]);
  } else if (d.kind === 's') {
    if (d.o.type === 'manhole') {
      const co = Math.cos(-(d.o.rot || 0)), si = Math.sin(-(d.o.rot || 0)), dx = p.x - d.o.cx, dy = p.y - d.o.cy, lx = dx * co - dy * si, ly = dx * si + dy * co, mn = 2 * u;
      if (/^rx/.test(d.hid)) d.o.rx = Math.max(mn, Math.abs(lx)); else d.o.ry = Math.max(mn, Math.abs(ly));
      C.syncAll(ph, [d.o]);
    } else { const r = Math.hypot(p.x - d.o.x, p.y - d.o.y); d.o.size = Math.max(2, Math.min(40, r / u)); d.o.autoSize = null; }
  } else if (d.kind === 'label') d.o.lp = { x: p.x - d.dx, y: p.y - d.dy };
  else if (d.kind === 'move') {
    const dx = p.x - d.last.x, dy = p.y - d.last.y; d.last = p; const o = d.o;
    if (o.type === 'line') o.pts.forEach(q => { q.x += dx; q.y += dy; delete q.link; });
    else if (o.type === 'manhole') { o.cx += dx; o.cy += dy; } else { o.x += dx; o.y += dy; if (o.lp) { o.lp.x += dx; o.lp.y += dy; } if (o.type === 'acc') C.alignAcc(o, ph, tolPx(18)); }
    C.syncAll(ph, [o]);
  }
  draw();
}
function onUp() {
  window.removeEventListener('pointermove', onDragMove); map.dragging.enable();
  const d = drag; drag = null; if (d && d.moved) commit(d.o ? [d.o] : []);
}

/* Texte libre */
function openTed(p, cp) {
  closeTed(false);
  const box = document.createElement('textarea'); box.className = 'rs-ted'; box.rows = 2; box.placeholder = 'Votre texte, Entrée pour valider';
  box.style.left = Math.min(map.getSize().x - 190, cp.x) + 'px'; box.style.top = Math.min(map.getSize().y - 70, cp.y) + 'px';
  map.getContainer().appendChild(box); ted = { box, p };
  box.addEventListener('mousedown', e => e.stopPropagation()); box.addEventListener('dblclick', e => e.stopPropagation());
  box.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); closeTed(true); } else if (ev.key === 'Escape') closeTed(false); });
  setTimeout(() => box.focus(), 0);
}
function closeTed(keep) {
  if (!ted) return; const t = ted; ted = null; const text = t.box.value.trim(); t.box.remove();
  if (keep && text) { fixU(); add(C.newText(t.p, text)); }
}

/* ---------- clavier ---------- */
function onKey(e) {
  if (!ref && !C) return;
  const panel = $('chPanel'); if (!panel || panel.hidden || $('chTabN').hidden) return;
  const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  if (typing) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); return; }
  if (ctrl && k === 'y') { e.preventDefault(); undo(1); return; }
  if (ctrl) return;
  if (k === 'escape') { if (draft) { draft = null; draw(); } else if (tool && tool !== 'select') setTool('select'); else if (sel) { sel = null; props(); draw(); } return; }
  if (k === 'enter' && tool === 'line') { finishLine(); return; }
  if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); del(); return; }
  const m = { v: 'select', l: 'line', b: 'br', r: 'manhole', a: 'acc', t: 'text' }[k];
  if (m) { e.preventDefault(); pick(m); }
}
function del() {
  if (!sel) return; const id = sel; sel = null;
  ph.objects = ph.objects.filter(o => o.id !== id); commit([]);
}

/* ---------- panneau ---------- */
const ICONS = {
  select: '<path d="M6 3l12 8-5.5 1.5L10 18z"/>',
  line: '<path d="M3 18L9 8l5 5 7-9"/><circle cx="3" cy="18" r="1.6"/><circle cx="21" cy="4" r="1.6"/>',
  br: '<path d="M3 9h18M12 9v9"/><circle cx="12" cy="19" r="2"/>',
  manhole: '<ellipse cx="12" cy="12" rx="8" ry="5.5"/><ellipse cx="12" cy="12" rx="3" ry="2"/>',
  acc: '<circle cx="12" cy="12" r="7"/><path d="M12 8.5v7M8.5 12h7"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>'
};
const TOOLS = [['select', 'Sélectionner', 'V'], ['line', 'Conduite', 'L'], ['br', 'Branchement', 'B']];
async function pick(t) {
  if (!(await ensure())) return;
  setTool(t); if (tool) palTab = { line: 'pipes', br: 'pipes', manhole: 'mh', acc: 'acc', text: 'misc' }[tool] || palTab; palShow();
}
function btns() {
  document.querySelectorAll('#rsTools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  if ($('rsUndo')) { $('rsUndo').disabled = hpos <= 0; $('rsRedo').disabled = hpos >= hist.length - 1; $('rsDel').disabled = !sel; }
}
const netName = id => (C.netOf(id) || { name: '' }).name;
function opts(list, cur, label) {
  const groups = {}; list.forEach(x => { (groups[x.net] = groups[x.net] || []).push(x); });
  return Object.keys(groups).map(n => `<optgroup label="${esc(netName(n))}">${groups[n].map(x => `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${esc(label(x))}</option>`).join('')}</optgroup>`).join('');
}
function fillPalette() {
  if (!C) return;
  $('rsPipe').innerHTML = opts(C.S.pipes, armed.pipe, p => p.desc);
  $('rsMh').innerHTML = opts(C.S.manholes, armed.mh, m => m.name);
  renderPal(); accGrid();
}
function palShow() {
  const on = { line: 'rsPipe', br: 'rsPipe', manhole: 'rsMh' }[tool];
  if (C && on) { const pd = C.pipeOf(armed.pipe); if (tool === 'br' && pd && pd.dash !== 'dotted') { const b = C.S.pipes.find(q => q.dash === 'dotted' && C.netCat(q.net) === C.netCat(pd.net)); if (b) { armed.pipe = b.id; fillPalette(); saveArmed(); } } }
  renderPal();
}

/* ---------- Palette à onglets (comme l'outil d'origine) ---------- */
let palTab = 'pipes', addingPipe = false;
const PTABS = [['fav', '★ Favoris'], ['pipes', 'Conduites'], ['mh', 'Regards'], ['acc', 'Accessoires'], ['misc', 'Textes'], ['set', 'Réglages']];
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const favs = () => (C.S.favs = C.S.favs || { pipe: [], mh: [], acc: [] });
const isFav = (k, id) => (favs()[k] || []).includes(id);
function toggleFav(k, id) { const a = (favs()[k] = favs()[k] || []), i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else a.push(id); persistSettings(); renderPal(); accGrid(); }
function star(k, id) {
  const s = el('span', 'rs-star' + (isFav(k, id) ? ' on' : ''), isFav(k, id) ? '★' : '☆'); s.setAttribute('role', 'button'); s.tabIndex = 0;
  s.title = isFav(k, id) ? 'Retirer des favoris' : 'Ajouter aux favoris (accès rapide)'; s.setAttribute('aria-label', 'Favori');
  const go = e => { e.stopPropagation(); e.preventDefault(); toggleFav(k, id); };
  s.addEventListener('click', go); s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(e); }); return s;
}
function pipeSwatch(def) {
  const col = C.colOf(def.net), th = Math.max(2, Math.min(13, def.w * 1.1)), sw = el('span', 'rs-swl');
  const st = def.dash === 'dotted' ? `background:radial-gradient(circle,${col} 45%,transparent 50%) 0 0/${th * 2.2}px ${th}px repeat-x` : def.dash === 'dashed' ? `background:repeating-linear-gradient(90deg,${col} 0 9px,transparent 9px 14px)` : `background:${col}`;
  sw.style.cssText = `display:block;width:30px;height:${th}px;border-radius:${def.dash === 'solid' ? th / 2 : 0}px;${st}`; return sw;
}
/* en mode Sélection, un préréglage change celui de l'objet sélectionné du même type */
function applyPreset(type, key, id) {
  const o = tool === 'select' && sel ? objOf(sel) : null;
  if (!o || o.type !== type) return false;
  o[key] = id;
  if (type === 'manhole') { const d = C.mhOf(id); if (d) { o.nature = d.nature; o.diam = d.diam; } }
  if (type === 'acc') { const d = C.accOf(id); if (d) { o.m1 = d.m1; o.m2 = d.m2; o.d = d.d; o.d2 = d.d2; } }
  commit([o]); props(); status('Objet modifié.', { ms: 2000 }); return true;
}
function usePreset(k, id) {
  const m = { pipe: ['pipeId', 'line', 'line'], mh: ['mhId', 'manhole', 'manhole'], acc: ['accId', 'acc', 'acc'] }[k];
  armed[k] = id; saveArmed();
  if (!applyPreset(m[0] === 'pipeId' ? 'line' : m[1], m[0], id)) { const want = m[2]; if (tool !== want && !(want === 'line' && tool === 'br')) setTool(want); }
  renderPal(); accGrid();
}
function chip(k, id, sw, label, side) {
  const on = armed[k] === id && ({ pipe: tool === 'line' || tool === 'br', mh: tool === 'manhole', acc: tool === 'acc' })[k];
  const b = el('button', 'rs-chip2' + (on ? ' on' : '')); b.type = 'button';
  const s = el('span', 'sw'); s.append(sw); b.append(s, el('span', 'tx', label)); if (side) b.append(el('span', 'w', side)); b.append(star(k, id));
  b.addEventListener('click', () => usePreset(k, id)); return b;
}
const chipPipe = p => chip('pipe', p.id, pipeSwatch(p), p.desc, String(p.w));
function chipMh(m) { const col = C.colOf(m.net), s = el('span'); s.style.cssText = `display:block;width:26px;height:16px;border-radius:50%;border:3px solid ${col};background:${col}47`; return chip('mh', m.id, s, m.name, netName(m.net)); }
function chipAcc(a) { const cv2 = document.createElement('canvas'); C.drawIcon(cv2, Object.assign({}, a)); return chip('acc', a.id, cv2, a.name, ''); }
function favBlock(box, k, title, arr, mk) {
  const L = (favs()[k] || []).map(id => arr.find(x => x.id === id)).filter(Boolean); if (!L.length) return false;
  box.append(el('div', 'rs-netname', '★ ' + title)); L.forEach(x => box.append(mk(x))); return true;
}
async function setPalTab(t) {
  palTab = t;
  // l'onglet choisit l'outil : plus besoin de le désigner deux fois
  const want = { pipes: 'line', mh: 'manhole', acc: 'acc', misc: 'text' }[t];
  if (want && await ensure()) { if (tool !== want && !(want === 'line' && tool === 'br')) setTool(want); }
  renderPal(); accGrid();
}
function renderPal() {
  const pal = $('rsPal'); if (!pal) return;
  if (!C) { pal.hidden = true; return; }
  pal.hidden = false;
  const tb = $('rsPTabs'); tb.textContent = '';
  PTABS.forEach(([k, v]) => { const b = el('button', 'rs-ptab' + (k === palTab ? ' on' : ''), v); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === palTab)); b.addEventListener('click', () => setPalTab(k)); tb.append(b); });
  const box = $('rsPBody'); box.textContent = '';
  $('rsAccBox').hidden = palTab !== 'acc';
  const hint = t => box.append(el('p', 'hint', t));
  if (palTab === 'fav') {
    hint('Vos choix rapides. Cliquez l’étoile ☆ à droite d’un élément (onglets Conduites, Regards, Accessoires) pour l’ajouter ici.');
    const a = favBlock(box, 'pipe', 'Conduites', C.S.pipes, chipPipe), b = favBlock(box, 'mh', 'Regards', C.S.manholes, chipMh), c = favBlock(box, 'acc', 'Accessoires', C.S.accessories, chipAcc);
    if (!(a || b || c)) box.append(el('div', 'rs-empty', 'Aucun favori pour le moment.'));
    else { const v = el('button', 'btn small', 'Vider les favoris'); v.type = 'button'; v.addEventListener('click', () => { C.S.favs = { pipe: [], mh: [], acc: [] }; persistSettings(); renderPal(); accGrid(); }); box.append(v); }
  } else if (palTab === 'pipes') {
    hint('Choisissez une conduite, puis cliquez sur la carte pour poser les points. Double-clic ou Entrée pour terminer. Maj : angle de 45°.');
    favBlock(box, 'pipe', 'Favoris', C.S.pipes, chipPipe);
    C.S.networks.forEach(n => {
      const list = C.S.pipes.filter(p => p.net === n.id); if (!list.length) return;
      const h = el('div', 'rs-netname'), d = el('span', 'dot'); d.style.background = n.color; h.append(d, document.createTextNode(n.name)); box.append(h);
      list.forEach(p => box.append(chipPipe(p)));
    });
    if (!addingPipe) { const ad = el('button', 'btn small rs-wide', '+ Ajouter un diamètre'); ad.type = 'button'; ad.addEventListener('click', () => { addingPipe = true; renderPal(); }); box.append(ad); }
    else {
      const cur = C.pipeOf(armed.pipe), nf = { net: cur ? cur.net : C.S.networks[0].id, desc: '', w: 4, dash: 'solid' }, card = el('div', 'rs-form');
      const fld = (lab, inp) => { const l = el('label', 'ch-field', lab); l.append(inp); return l; };
      const ns = el('select', 'ch-ty'); C.S.networks.forEach(n => { const o = el('option', null, n.name); o.value = n.id; ns.append(o); }); ns.value = nf.net; ns.onchange = () => { nf.net = ns.value; };
      const tx = el('input', 'ch-ty'); tx.placeholder = 'Par exemple : Ø90 PEHD PN16'; tx.oninput = () => { nf.desc = tx.value; };
      const nm = el('input', 'ch-ty'); nm.type = 'number'; nm.min = .5; nm.max = 30; nm.step = .5; nm.value = 4; nm.oninput = () => { nf.w = parseFloat(nm.value) || 4; };
      const ds = el('select', 'ch-ty'); [['solid', 'Plein'], ['dashed', 'Tirets'], ['dotted', 'Pointillé']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; ds.append(o); }); ds.onchange = () => { nf.dash = ds.value; };
      const ok = el('button', 'btn small', 'Ajouter et tracer'), no = el('button', 'btn small', 'Annuler'); ok.type = no.type = 'button';
      ok.addEventListener('click', () => {
        if (!nf.desc.trim()) { status('Saisissez le texte du diamètre.', { ms: 2500 }); return; }
        const p = { id: 'p' + Math.random().toString(36).slice(2, 9), net: nf.net, desc: nf.desc.trim(), w: nf.w, dash: /branchement/i.test(nf.desc) ? 'dotted' : nf.dash };
        C.S.pipes.push(p); persistSettings(); armed.pipe = p.id; saveArmed(); addingPipe = false; if (tool !== 'line') setTool('line'); renderPal();
      });
      no.addEventListener('click', () => { addingPipe = false; renderPal(); });
      const row = el('div', 'rs-row'); row.append(ok, no); card.append(fld('Réseau', ns), fld('Texte', tx), fld('Épaisseur', nm), fld('Trait', ds), row); box.append(card); setTimeout(() => tx.focus(), 0);
    }
  } else if (palTab === 'mh') {
    hint('Cliquez sur la carte pour poser un regard. Ensuite, déformez-le et tournez-le avec les poignées.');
    favBlock(box, 'mh', 'Favoris', C.S.manholes, chipMh);
    C.S.manholes.forEach(m => box.append(chipMh(m)));
  } else if (palTab === 'acc') {
    hint('Cliquez sur la carte pour placer l’accessoire. Les champs (matériaux, diamètres) se remplissent dans le panneau Sélection.');
  } else if (palTab === 'misc') {
    hint('Placez un texte libre (nom de rue, remarque) à un endroit où aucune conduite ne passe, puis déplacez-le.');
    const t = el('button', 'btn small rs-wide', 'Texte libre (cliquer sur la carte)'); t.type = 'button'; t.addEventListener('click', () => { if (tool !== 'text') setTool('text'); renderPal(); }); box.append(t);
  } else renderSet(box);
}
function renderSet(box) {
  box.append(el('p', 'hint', 'Réglages communs avec l’outil de repérage des photos.'));
  const cb = (k, lab, dflt) => {
    const l = el('label', 'rs-chk'), i = document.createElement('input'); i.type = 'checkbox'; i.checked = C.S[k] == null ? dflt : !!C.S[k];
    i.onchange = () => { C.S[k] = i.checked; persistSettings(); if (/^auto|kitsOn/.test(k)) { C.syncAll(ph); commit([]); } };
    l.append(i, document.createTextNode(' ' + lab)); box.append(l);
  };
  cb('autoEnd', 'Terminer la conduite dès qu’on la relie à un regard ou un accessoire', true);
  cb('autoCoude', 'Coudes automatiques', true); cb('autoTe', 'Tés automatiques', true); cb('autoRed', 'Réductions automatiques', true);
  cb('autoRac', 'Raccords automatiques', true); cb('autoBr', 'Piquages de branchement', true); cb('autoCit', 'Citerneaux', true);
  cb('autoFit', 'Pose automatique des raccords', true); cb('kitsOn', 'Montages automatiques', true);
  box.append(el('h4', 'rs-h', 'Épaisseur des conduites'));
  C.S.pipes.forEach(p => {
    const row = el('div', 'rs-wrow'); row.append(pipeSwatch(p), el('span', 'tx', p.desc));
    const n = el('input', 'ch-ty'); n.type = 'number'; n.min = .5; n.max = 30; n.step = .5; n.value = p.w; n.setAttribute('aria-label', 'Épaisseur ' + p.desc);
    n.onchange = () => { p.w = Math.max(.5, Math.min(30, parseFloat(n.value) || p.w)); persistSettings(); renderPal(); draw(); }; row.append(n); box.append(row);
  });
}
function accGrid() {
  if (!C || !$('rsAccGrid')) return;
  const q = ($('rsAccQ').value || '').trim().toLowerCase(), g = $('rsAccGrid'); g.textContent = '';
  if (palTab === 'acc') {
    favBlock(g, 'acc', 'Favoris', C.S.accessories, chipAcc);
    C.S.accessories.forEach(a => { if (q && !(a.name.toLowerCase().includes(q) || (a.sym || '').toLowerCase().includes(q))) return; g.append(chipAcc(a)); });
    if (!g.children.length) g.textContent = 'Aucun accessoire trouvé.';
  }
  libGrid();
}
function libGrid() {
  const nb = $('rsLibNets'), g = $('rsLibGrid'); if (!nb || !g || !$('rsLib').open) return;
  const q = ($('rsAccQ').value || '').trim().toLowerCase();
  nb.textContent = '';
  [['', 'Tous'], ...Object.entries(C.SYMNET)].forEach(([k, v]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rs-chip' + (k === libNet ? ' on' : ''); b.textContent = v; b.addEventListener('click', () => { libNet = k; libGrid(); }); nb.append(b); });
  g.textContent = '';
  C.SYMS.forEach(sd => {
    if (libNet && sd[2] !== libNet) return;
    if (q && !(sd[1].toLowerCase().includes(q) || sd[0].toLowerCase().includes(q))) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'rs-card'; b.title = sd[0];
    const im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.src = C.symDataUrl(sd[0], '#1b2328'); const s = document.createElement('span'); s.textContent = sd[1];
    b.append(im, s); b.addEventListener('click', () => { const a = C.accForSymbol(sd[0]); if (!a) return; armed.acc = a.id; saveArmed(); try { Rep.saveSettings && Rep.saveSettings(); } catch (e) { /* ignoré */ } persistSettings(); accGrid(); status(sd[1] + ' choisi : cliquez sur la carte.', { ms: 2500 }); });
    g.append(b);
  });
}
// Les réglages (liste d'accessoires) sont ceux de l'outil de repérage : même clé de stockage
function persistSettings() { try { const k = 'geotrace:repere:cfg'; const cur = JSON.parse(localStorage.getItem(k) || 'null') || {}; cur.s = C.S; localStorage.setItem(k, JSON.stringify(cur)); } catch (e) { /* ignoré */ } }
function props() {
  const box = $('rsProps'); if (!box) return;
  const o = sel && C ? objOf(sel) : null;
  btns();
  if (!o) { box.hidden = true; box.innerHTML = ''; return; }
  const f = (k, lab, v) => `<label>${lab}<input data-k="${k}" value="${esc(v)}"></label>`;
  let h = '';
  if (o.type === 'line') h = `<label>Conduite<select data-k="pipeId">${opts(C.S.pipes, o.pipeId, p => p.desc)}</select></label>` + f('text', 'Texte (remplace le libellé)', o.text || '');
  else if (o.type === 'manhole') h = `<label>Type<select data-k="mhId">${opts(C.S.manholes, o.mhId, m => m.name)}</select></label>` + f('num', 'Numéro', o.num) + f('nature', 'Nature', o.nature) + f('diam', 'Diamètre (mm)', o.diam) + f('extra', 'Ligne en plus', o.extra);
  else if (o.type === 'acc') h = `<label>Type<select data-k="accId">${opts(C.S.accessories, o.accId, a => a.name)}</select></label>` + f('d', 'Diamètre', o.d) + f('d2', 'Diamètre 2', o.d2) + f('m1', 'Matériau', o.m1) + f('m2', 'Matériau 2', o.m2) + f('note', 'Note', o.note) + f('text', 'Texte libre', o.text);
  else if (o.type === 'text') h = f('text', 'Texte', o.text);
  if (o.type === 'line') h += '<div class="rs-row"><button type="button" class="btn small" data-x="end">Prolonger la fin</button><button type="button" class="btn small" data-x="start">Prolonger le début</button></div>';
  if (o.type === 'manhole') h += '<div class="rs-row"><button type="button" class="btn small" data-x="rot90">Pivoter de 90°</button></div>';
  box.innerHTML = '<h4>Sélection</h4>' + h; box.hidden = false;
}
function onProp(e) {
  const t = e.target, k = t.dataset && t.dataset.k, o = sel && objOf(sel); if (!k || !o) return;
  o[k] = t.value; if (k === 'accId') { const d = C.accOf(t.value); if (d) { o.m1 = d.m1; o.m2 = d.m2; o.d = d.d; o.d2 = d.d2; } }
  if (k === 'mhId') { const d = C.mhOf(t.value); if (d) { o.nature = d.nature; o.diam = d.diam; } }
  commit([o]);
}

/* ---------- récapitulatif et exports ---------- */
function metres(pts) {
  const r = Math.cos(latOf(ref.y) * Math.PI / 180) * 156543.03392 / Math.pow(2, Z0); let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) * r;
  return s;
}
function recap() {
  const box = $('rsRecap'); if (!box) return;
  if (!C || !ph.objects.length) { box.innerHTML = ''; $('rsExport').hidden = true; $('rsClear').hidden = true; return; }
  const ln = {}, mh = {}, ac = {};
  ph.objects.forEach(o => {
    if (o.type === 'line') { const pd = C.pipeOf(o.pipeId); if (!pd) return; const k = netName(pd.net) + ' · ' + pd.desc; ln[k] = (ln[k] || 0) + metres(o.pts); }
    else if (o.type === 'manhole') { const d = C.mhOf(o.mhId) || {}, k = (o.nature || d.name || 'Regard') + (o.diam ? ' Ø' + o.diam : ''); mh[k] = (mh[k] || 0) + 1; }
    else if (o.type === 'acc' && !o.auto) { const k = (C.accText(o).split('\n')[0] || 'Accessoire'); ac[k] = (ac[k] || 0) + 1; }
  });
  const rows = (m, f) => Object.entries(m).sort().map(([k, v]) => `<tr><td>${esc(k)}</td><td>${f(v)}</td></tr>`).join('');
  box.innerHTML = '<h4>Récapitulatif</h4><table>' + rows(ln, v => Math.round(v) + ' m') + rows(mh, v => v) + rows(ac, v => v) + '</table>';
  $('rsExport').hidden = false; $('rsClear').hidden = false;
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportGeo() {
  const feats = [];
  ph.objects.forEach(o => {
    const lab = ll => [+ll[1].toFixed(7), +ll[0].toFixed(7)];
    if (o.type === 'line') { const pd = C.pipeOf(o.pipeId) || {}; feats.push({ type: 'Feature', properties: { objet: 'conduite', reseau: netName(pd.net), description: o.text || pd.desc, longueur_m: +metres(o.pts).toFixed(1) }, geometry: { type: 'LineString', coordinates: o.pts.map(p => lab(toLL(p))) } }); }
    else if (o.type === 'manhole') { const d = C.mhOf(o.mhId) || {}; feats.push({ type: 'Feature', properties: { objet: 'regard', reseau: netName(o.net || d.net), numero: o.num, nature: o.nature, diametre: o.diam }, geometry: { type: 'Point', coordinates: lab(toLL({ x: o.cx, y: o.cy })) } }); }
    else if (o.type === 'acc' && !o.auto) { feats.push({ type: 'Feature', properties: { objet: 'accessoire', libelle: C.accText(o) }, geometry: { type: 'Point', coordinates: lab(toLL(o)) } }); }
    else if (o.type === 'text') { feats.push({ type: 'Feature', properties: { objet: 'texte', texte: o.text }, geometry: { type: 'Point', coordinates: lab(toLL(o)) } }); }
  });
  download('reperage-reseaux.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }), 'application/geo+json');
}
function exportCsv() {
  const rows = [['Objet', 'Description', 'Quantité']];
  document.querySelectorAll('#rsRecap tr').forEach(tr => rows.push([...tr.children].map(td => td.textContent)));
  const l = rows.slice(1).map(r => ['', r[0], r[1]]);
  download('recapitulatif-reseaux.csv', '﻿' + [rows[0], ...l].map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(';')).join('\n'), 'text/csv');
}

/* ---------- initialisation ---------- */
export function init(ctx) {
  map = ctx.map; status = ctx.status || status; onChange = ctx.onChange || onChange; stopOthers = ctx.stopOthers || stopOthers; send3D = ctx.send3D || send3D; tabFn = ctx.tab || tabFn;
  show = ctx.show !== false;
  host = map.getContainer();
  cv = document.createElement('canvas'); cv.className = 'rs-canvas'; cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv); ctx2 = cv.getContext('2d');
  map.on('move zoom zoomend resize viewreset', draw);
  map.on('click', onClick); map.on('dblclick', onDbl); map.on('mousemove', onMove);
  host.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  $('rsTools').innerHTML = TOOLS.map(([k, n, key]) => `<button type="button" class="rs-tool" data-tool="${k}" aria-pressed="false" title="${n} (${key})"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${n}</span></button>`).join('');
  $('rsTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) pick(b.dataset.tool); });
  $('rsUndo').addEventListener('click', () => undo(-1)); $('rsRedo').addEventListener('click', () => undo(1)); $('rsDel').addEventListener('click', del);
  $('rsFin').addEventListener('click', finishLine);
  [['rsPipe', 'pipe'], ['rsMh', 'mh']].forEach(([id, k]) => $(id).addEventListener('change', () => { armed[k] = $(id).value; saveArmed(); }));
  $('rsProps').addEventListener('change', onProp);
  $('rsProps').addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'rot90') { const o = sel && objOf(sel); if (o && o.type === 'manhole') { o.rot = (o.rot || 0) + Math.PI / 2; C.syncAll(ph, [o]); commit([o]); } return; } extend(b.dataset.x === 'start'); });
  $('rsAccQ').addEventListener('input', accGrid); $('rsLib').addEventListener('toggle', libGrid);
  $('rsGeo').addEventListener('click', exportGeo); $('rsCsv').addEventListener('click', exportCsv);
  $('rsClear').addEventListener('click', e => {
    if (e.target.dataset.sure) { ph.objects = []; sel = null; delete e.target.dataset.sure; e.target.textContent = 'Tout supprimer'; commit([]); }
    else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer la suppression'; setTimeout(() => { delete e.target.dataset.sure; e.target.textContent = 'Tout supprimer'; }, 4000); }
  });
  $('rsOpen').addEventListener('click', () => pick('select'));
  hint(); btns();
  const r = read(); if (r) { ref = r.ref; ph.objects = r.objs; hist = [JSON.stringify(ph.objects)]; hpos = 0; }
}
export const stop = () => { if (busy) return; if (tool) setTool(tool); draft = null; if (ted) closeTed(false); };
export const refresh = () => draw();
export function setShow(v) { show = v; cv.hidden = !v; draw(); }
export const hasObjects = () => ph.objects.length > 0;
export const load = ensure;
