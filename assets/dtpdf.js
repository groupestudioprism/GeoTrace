/* GeoTrace – import d'un plan de réseaux en PDF (réponse DT / DICT).
   1) le PDF est lu sur l'appareil (pdf.js, aucune donnée envoyée) ; 2) les traits colorés (vectoriels) sont regroupés par couleur
   et chaque couleur reçoit un type de réseau ; 3) le plan est calé avec 2 points communs plan / carte ; 4) aperçu, import.
   Un PDF scanné (image) n'a pas de traits : le plan peut être posé en fond sur la carte pour tracer par-dessus. */
const L = window.L;
let lib = null;
async function pdfjs() {
  if (lib) return lib;
  lib = await import('../vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return lib;
}
let live = null; const ping = () => document.dispatchEvent(new CustomEvent('dt-overlay', { detail: !!live }));
const clearOverlayOthers = () => {};
export const clearOverlay = () => { if (live) { const m = live.map; live.layer.remove && live.layer.remove(); live = null; ping(); } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- lecture des traits ---------- */
const mulM = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export async function readVectors(page, vp) {
  const P = await pdfjs(), O = P.OPS;
  const ol = await page.getOperatorList();
  const groups = new Map();
  let ctm = [1, 0, 0, 1, 0, 0], stack = [], col = [0, 0, 0], path = [], cur = null;
  const flush = stroke => {
    if (stroke && path.length) {
      const q = col.map(v => Math.round(v / 24) * 24), key = q.join(',');
      let g = groups.get(key); if (!g) { g = { col: q, lines: [], len: 0 }; groups.set(key, g); }
      path.forEach(pl => { if (pl.length > 1 && g.lines.length < 6000) { g.lines.push(pl); for (let i = 1; i < pl.length; i++) g.len += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]); } });
    }
    path = []; cur = null;
  };
  const pt = (x, y) => { const p = app(ctm, x, y); return vp.convertToViewportPoint(p[0], p[1]); };
  const move = (x, y) => { cur = [pt(x, y)]; path.push(cur); };
  const line = (x, y) => { if (!cur) move(x, y); else cur.push(pt(x, y)); };
  const curve = (x1, y1, x2, y2, x3, y3) => { if (!cur) move(x1, y1); const l = cur[cur.length - 1], a = pt(x1, y1), b = pt(x2, y2), c = pt(x3, y3); for (let i = 1; i <= 6; i++) { const t = i / 6, u = 1 - t; cur.push([u * u * u * l[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0], u * u * u * l[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1]]); } };
  const STROKE = new Set([O.stroke, O.closeStroke, O.fillStroke, O.closeFillStroke, O.eoFillStroke, O.closeEOFillStroke]);
  const NOPAINT = new Set([O.fill, O.eoFill]);
  const handlePath = (ops, a) => {
    let k = 0;
    ops.forEach(op => {
      if (op === O.moveTo) { move(a[k], a[k + 1]); k += 2; }
      else if (op === O.lineTo) { line(a[k], a[k + 1]); k += 2; }
      else if (op === O.curveTo) { curve(a[k], a[k + 1], a[k + 2], a[k + 3], a[k + 4], a[k + 5]); k += 6; }
      else if (op === O.curveTo2) { const l = cur ? cur[cur.length - 1] : null; curve(a[k], a[k + 1], a[k], a[k + 1], a[k + 2], a[k + 3]); k += 4; }
      else if (op === O.curveTo3) { curve(a[k], a[k + 1], a[k + 2], a[k + 3], a[k + 2], a[k + 3]); k += 4; }
      else if (op === O.closePath) { if (cur && cur.length) cur.push(cur[0]); }
      else if (op === O.rectangle) { const x = a[k], y = a[k + 1], w = a[k + 2], h = a[k + 3]; k += 4; move(x, y); line(x + w, y); line(x + w, y + h); line(x, y + h); line(x, y); }
    });
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === O.save) stack.push({ ctm: ctm.slice(), col: col.slice() });
    else if (fn === O.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; col = s.col; } }
    else if (fn === O.transform) ctm = mulM(a, ctm);
    else if (fn === O.setStrokeRGBColor) col = [a[0], a[1], a[2]].map(v => v <= 1 && a.every(x => x <= 1) ? v * 255 : v);
    else if (fn === O.constructPath) {
      if (typeof a[0] === 'number') {
        /* pdf.js récent : [opération de peinture, tracé aplati, boîte] */
        const d = a[1]; let k = 0;
        while (d && k < d.length) {
          const c = d[k++];
          if (c === 0) { move(d[k], d[k + 1]); k += 2; } else if (c === 1) { line(d[k], d[k + 1]); k += 2; }
          else if (c === 2) { curve(d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 4], d[k + 5]); k += 6; }
          else if (c === 3) { curve(d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 2], d[k + 3]); k += 4; }
          else if (c === 4) { if (cur && cur.length) cur.push(cur[0]); } else break;
        }
        if (STROKE.has(a[0])) flush(true); else flush(false);
      } else handlePath(a[0], a[1]);
    } else if (STROKE.has(fn)) flush(true);
    else if (NOPAINT.has(fn) || fn === O.endPath) flush(false);
  }
  return [...groups.values()].filter(g => g.len > 30);
}

/* type probable d'après la couleur du trait (code couleur DT usuel) */
export function typeOfColor(c) {
  const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 40) return mx > 235 ? null : 'fond';
  if (b > r + 30 && b >= g) return 'aep';
  if (r > 150 && g > 120 && b < 110) return 'gaz';
  if (r > g + 60 && r > b + 60) return 'elec';
  if (g > r + 30 && g > b) return 'telecom';
  if (r > b + 20 && g > b && r >= g) return 'eu';
  if (r > 150 && b > 120) return 'elec';
  return 'autre';
}

/* ---------- calage plan → carte (similitude à 2 points) ---------- */
export function similarity(p1, p2, w1, w2) {
  const zx = p2[0] - p1[0], zy = -(p2[1] - p1[1]), wx = w2.x - w1.x, wy = w2.y - w1.y, d = zx * zx + zy * zy;
  if (d < 1e-6 || wx * wx + wy * wy < 1e-9) return null;
  const ar = (wx * zx + wy * zy) / d, ai = (wy * zx - wx * zy) / d;
  const bx = w1.x - (ar * p1[0] + ai * p1[1]), by = w1.y - (ai * p1[0] - ar * p1[1]);
  return { ar, ai, bx, by };
}
export const toWorld = (T, x, y) => ({ x: T.ar * x + T.ai * y + T.bx, y: T.ai * x - T.ar * y + T.by });


/* Calage automatique : repère les repères de quadrillage Lambert-93 écrits sur le plan (X 6 chiffres, Y 7 chiffres) */
export function gridFromText(items, vp) {
  const E = [], N = [];
  items.forEach(it => {
    const str = (it.str || '').replace(/[\s\u00a0]/g, '').replace(',', '.'); if (!str) return;
    const m = str.match(/(?:^|[^\d.])(\d{6,7})(?:\.\d+)?(?!\d)/); if (!m) return;
    const v = +m[1], p = vp.convertToViewportPoint(it.transform[4] + (it.width || 0) / 2, it.transform[5] + (it.height || 0) / 2);
    if (v >= 100000 && v <= 1300000 && m[1].length === 6) E.push({ v, x: p[0], y: p[1] });
    else if (v >= 6000000 && v <= 7200000 && m[1].length === 7) N.push({ v, x: p[0], y: p[1] });
  });
  const uniq = a => { const m = new Map(); a.forEach(o => { const k = o.v; if (!m.has(k)) m.set(k, []); m.get(k).push(o); }); return [...m.values()].map(g => ({ v: g[0].v, x: g.reduce((s, o) => s + o.x, 0) / g.length, y: g.reduce((s, o) => s + o.y, 0) / g.length })); };
  const e = uniq(E), n = uniq(N); if (e.length < 2 || n.length < 2) return null;
  const fit = (pts, key) => { /* moindres carrés pos = a*v + b */
    const k = pts.length, sx = pts.reduce((s, o) => s + o.v, 0), sy = pts.reduce((s, o) => s + o[key], 0), sxx = pts.reduce((s, o) => s + o.v * o.v, 0), sxy = pts.reduce((s, o) => s + o.v * o[key], 0), d = k * sxx - sx * sx;
    if (Math.abs(d) < 1e-9) return null; const a = (k * sxy - sx * sy) / d, b = (sy - a * sx) / k, res = Math.sqrt(pts.reduce((s, o) => s + (a * o.v + b - o[key]) ** 2, 0) / k); return { a, b, res };
  };
  const fe = fit(e, 'x'), fn = fit(n, 'y'); if (!fe || !fn) return null;
  const sc = Math.abs(fe.a) / Math.abs(fn.a); if (!(fe.a > 0 && fn.a < 0) || sc < .93 || sc > 1.07 || fe.res > 25 || fn.res > 25) return null;
  const px = v => (v - fe.b) / fe.a; // non utilisé
  const E0 = e[0].v, E1 = e[e.length - 1].v, N0 = n[0].v, N1 = n[n.length - 1].v;
  return { A: { px: [fe.a * E0 + fe.b, fn.a * N0 + fn.b], en: [E0, N0] }, B: { px: [fe.a * E1 + fe.b, fn.a * N1 + fn.b], en: [E1, N1] }, nE: e.length, nN: n.length };
}

/* ---------- interface ---------- */
export async function openDT(file, ctx) {
  const { map, status, TYPES, addItems } = ctx;
  const P = await pdfjs();
  let doc;
  try { doc = await P.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
  catch (e) { status('PDF illisible ou protégé par un mot de passe.', { ms: 6000 }); return; }
  const CRS = L.CRS.EPSG3857;
  const el = document.createElement('div'); el.className = 'dt-modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Import d’un plan DT');
  el.innerHTML = `<div class="dt-box"><header><b>Importer un plan DT (PDF)</b><span class="dt-pg"></span><button type="button" class="link" data-a="close">Fermer</button></header>
    <div class="dt-body"><div class="dt-view"><div class="dt-tools"><button type="button" class="btn small" data-a="zo" aria-label="Réduire">−</button><button type="button" class="btn small" data-a="zi" aria-label="Agrandir">+</button><span class="hint">Cliquez 2 points repérables du plan (carrefour, angle de bâtiment).</span></div><div class="dt-scroll"><div class="dt-stage"><canvas></canvas></div></div></div>
    <aside><h4>1. Réseaux trouvés</h4><div class="dt-cols"><p class="hint">Lecture…</p></div><h4>2. Calage</h4><p class="hint dt-geo">Point A : à placer sur le plan.</p><div class="ch-actions"><button type="button" class="btn small" data-a="geo" disabled>Placer sur la carte</button><button type="button" class="btn small" data-a="reset">Recommencer</button></div>
    <label class="dv-w dt-bg" hidden><input type="checkbox" data-a="bg"> Poser le plan en fond sur la carte</label><label class="dv-w dt-op" hidden>Opacité <input type="range" min="15" max="100" value="65" data-a="op"></label>
    <h4>3. Import</h4><p class="hint dt-msg">Calez le plan pour importer.</p><button type="button" class="btn" data-a="go" disabled>Importer les réseaux cochés</button></aside></div></div>`;
  document.body.appendChild(el);
  const $q = s => el.querySelector(s), cv = $q('canvas'), stage = $q('.dt-stage');
  const st = { page: 1, vp: null, cols: [], pts: [], zoom: 1, T: null, prev: null, overlay: null, phase: 'plan' };
  let bar = null, once = null;
  const close = () => { cleanup(!!st.overlay); el.remove(); };
  const cleanup = keepOverlay => {
    if (st.prev) { map.removeLayer(st.prev); st.prev = null; }
    if (!keepOverlay && st.overlay) { map.removeLayer(st.overlay); st.overlay = null; if (live && live.layer === st.overlay) live = null; ping(); }
    if (bar) { bar.remove(); bar = null; } if (once) { map.off('click', once); once = null; }
    map.getContainer().style.cursor = '';
  };
  const dots = () => { stage.querySelectorAll('.dt-dot').forEach(d => d.remove()); st.pts.forEach((p, i) => { const d = document.createElement('i'); d.className = 'dt-dot'; d.textContent = 'AB'[i]; d.style.left = p[0] + 'px'; d.style.top = p[1] + 'px'; stage.appendChild(d); }); };
  const setZoom = z => { st.zoom = Math.max(.25, Math.min(4, z)); cv.style.width = (cv.width * st.zoom / (window.devicePixelRatio > 1 ? 1 : 1)) + 'px'; stage.style.width = cv.style.width; stage.style.setProperty('--z', st.zoom); dots(); };
  const geoText = () => {
    const n = st.pts.length;
    $q('.dt-geo').textContent = n === 0 ? 'Point A : cliquez-le sur le plan.' : n === 1 ? 'Point B : cliquez un second point éloigné du premier.' : st.T ? (st.auto ? 'Plan calé automatiquement d’après les coordonnées Lambert-93 lues sur le plan. Vérifiez l’aperçu sur la carte ; sinon cliquez « Recommencer ».' : 'Plan calé. Vérifiez l’aperçu sur la carte.') : 'Points A et B placés. Cliquez « Placer sur la carte » pour les situer sur la carte.';
    $q('[data-a=geo]').disabled = n < 2;
  };
  async function render(pn) {
    const page = await doc.getPage(pn), base = page.getViewport({ scale: 1 }), s = Math.min(3, 2200 / Math.max(base.width, base.height));
    st.vp = page.getViewport({ scale: s }); cv.width = Math.round(st.vp.width); cv.height = Math.round(st.vp.height);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: c, viewport: st.vp }).promise;
    st.pts = []; st.T = null; st.auto = false; cleanup(false);
    let cols = []; try { cols = await readVectors(page, st.vp); } catch (e) { cols = []; }
    try {
      const tc = await page.getTextContent(), g = ctx.toLL ? gridFromText(tc.items, st.vp) : null;
      if (g) {
        const ll1 = ctx.toLL(g.A.en[0], g.A.en[1]), ll2 = ctx.toLL(g.B.en[0], g.B.en[1]);
        const T = similarity(g.A.px, g.B.px, CRS.project(L.latLng(ll1[0], ll1[1])), CRS.project(L.latLng(ll2[0], ll2[1])));
        if (T) { st.pts = [g.A.px, g.B.px]; st.T = T; st.auto = true; }
      }
    } catch (e) { /* pas de coordonnées lisibles */ }
    st.cols = cols.map(g => { const ty = typeOfColor(g.col); return { g, type: ty && ty !== 'fond' ? ty : 'autre', on: !!ty && ty !== 'fond' }; }).sort((a, b) => b.g.len - a.g.len).slice(0, 16);
    $q('.dt-cols').innerHTML = st.cols.length ? st.cols.map((c, i) => `<div class="dt-col"><label><input type="checkbox" data-i="${i}" ${c.on ? 'checked' : ''}><i class="ch-sw" style="background:rgb(${c.g.col})"></i>${c.g.lines.length} tracé(s)</label><select class="ch-ty" data-i="${i}" aria-label="Type du réseau">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${k === c.type ? ' selected' : ''}>${v.label}</option>`).join('')}</select></div>`).join('')
      : '<p class="hint">Aucun trait vectoriel : ce PDF est une image (scan). Calez-le, posez-le en fond sur la carte puis tracez les réseaux par-dessus (onglet Réseaux).</p>';
    $q('.dt-bg').hidden = false; $q('.dt-op').hidden = false;
    $q('.dt-pg').textContent = doc.numPages > 1 ? `Page ${pn} / ${doc.numPages}` : '';
    // première page utile : si pas de vecteurs et plusieurs pages, on laisse l'utilisateur changer de page
    setZoom(Math.min(1, 640 / cv.width)); geoText(); if (st.T) { preview(); overlay($q('[data-a=bg]').checked); try { map.fitBounds(L.latLngBounds([llOf(0, 0), llOf(cv.width, cv.height)]).pad(.1), { maxZoom: 20 }); } catch (e) { /* vue inchangée */ } } updateGo();
  }
  const updateGo = () => {
    const n = st.cols.filter(c => c.on).reduce((a, c) => a + c.g.lines.length, 0);
    $q('[data-a=go]').disabled = !(st.T && n);
    $q('.dt-msg').textContent = !st.T ? 'Calez le plan pour importer.' : n ? `${n} tracé(s) seront importés.` : 'Aucun tracé coché : posez le plan en fond et tracez-le à la main.';
  };
  const llOf = (x, y) => { const w = toWorld(st.T, x, y); return CRS.unproject(L.point(w.x, w.y)); };
  const preview = () => {
    if (st.prev) { map.removeLayer(st.prev); st.prev = null; }
    if (!st.T) return;
    const g = L.layerGroup();
    st.cols.filter(c => c.on).forEach(c => c.g.lines.forEach(pl => { const ll = []; for (let i = 0; i < pl.length; i += Math.max(1, Math.floor(pl.length / 400))) { const q = llOf(pl[i][0], pl[i][1]); ll.push([q.lat, q.lng]); } L.polyline(ll, { color: TYPES[c.type].color, weight: 3, opacity: .9, interactive: false }).addTo(g); }));
    st.prev = g.addTo(map);
  };
  const overlay = on => {
    if (st.overlay) { map.removeLayer(st.overlay); st.overlay = null; live = null; ping(); }
    if (!on || !st.T) return;
    const T = st.T, m = Math.hypot(T.ar, T.ai), W = cv.width, H = cv.height;
    const cs = [[0, 0], [W, 0], [W, H], [0, H]].map(p => toWorld(T, p[0], p[1])), minX = Math.min(...cs.map(c => c.x)), maxX = Math.max(...cs.map(c => c.x)), minY = Math.min(...cs.map(c => c.y)), maxY = Math.max(...cs.map(c => c.y));
    let k = 1 / m; const ow = (maxX - minX) * k, oh = (maxY - minY) * k, lim = 3200 / Math.max(ow, oh); if (lim < 1) k *= lim;
    const o = document.createElement('canvas'); o.width = Math.max(2, Math.round((maxX - minX) * k)); o.height = Math.max(2, Math.round((maxY - minY) * k));
    const c = o.getContext('2d'), s = k;
    c.setTransform(T.ar * s, -T.ai * s, T.ai * s, T.ar * s, (T.bx - minX) * s, (maxY - T.by) * s);
    c.drawImage(cv, 0, 0);
    o.toBlob(b => {
      if (!b || !$q('[data-a=bg]').checked || !st.T) return;
      const sw = CRS.unproject(L.point(minX, minY)), ne = CRS.unproject(L.point(maxX, maxY));
      st.overlay = L.imageOverlay(URL.createObjectURL(b), [[sw.lat, sw.lng], [ne.lat, ne.lng]], { opacity: +$q('[data-a=op]').value / 100, interactive: false, zIndex: 5 }).addTo(map); clearOverlayOthers(); live = { layer: st.overlay, map }; ping();
    });
  };
  /* clic sur le plan */
  stage.addEventListener('click', e => {
    if (st.pts.length >= 2 || st.phase !== 'plan') return;
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
    st.pts.push([x, y]); dots(); geoText();
  });
  /* situer A puis B sur la carte */
  const pickOnMap = () => {
    st.phase = 'map'; el.hidden = true; const w = []; let k = 0;
    bar = document.createElement('div'); bar.className = 'dt-bar'; bar.setAttribute('role', 'status');
    const txt = () => { bar.innerHTML = `<b>Point ${'AB'[k]}</b> : cliquez sur la carte l’endroit exact du point ${'AB'[k]} du plan. <button type="button" class="link" id="dtBarNo">Annuler</button>`; bar.querySelector('#dtBarNo').onclick = () => { cleanup(true); st.phase = 'plan'; el.hidden = false; }; };
    document.body.appendChild(bar); txt(); map.getContainer().style.cursor = 'crosshair';
    once = e => {
      w.push(CRS.project(e.latlng)); k++;
      L.circleMarker(e.latlng, { radius: 6, color: '#fff', weight: 2, fillColor: '#ffc61a', fillOpacity: 1, interactive: false }).addTo(map).bindTooltip('AB'[k - 1], { permanent: true, direction: 'top', className: 'dt-tip' });
      if (k < 2) { txt(); return; }
      map.off('click', once); once = null; bar.remove(); bar = null; map.getContainer().style.cursor = '';
      map.eachLayer(l => { if (l instanceof L.CircleMarker && l.getTooltip && l.getTooltip() && l.getTooltip().options.className === 'dt-tip') map.removeLayer(l); });
      const T = similarity(st.pts[0], st.pts[1], w[0], w[1]);
      st.phase = 'plan'; el.hidden = false;
      if (!T) { status('Les deux points sont trop proches : choisissez-en deux plus éloignés.', { ms: 5000 }); st.pts = []; dots(); geoText(); return; }
      st.T = T; geoText(); preview(); overlay($q('[data-a=bg]').checked); updateGo();
      const q = [llOf(0, 0), llOf(cv.width, cv.height)]; map.fitBounds(L.latLngBounds(q).pad(.1), { maxZoom: 20 });
    };
    map.on('click', once);
  };
  el.addEventListener('click', e => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'close') close();
    else if (a === 'zi') setZoom(st.zoom * 1.4); else if (a === 'zo') setZoom(st.zoom / 1.4);
    else if (a === 'geo') pickOnMap();
    else if (a === 'reset') { st.pts = []; st.T = null; cleanup(false); dots(); geoText(); updateGo(); }
    else if (a === 'go') {
      const items = [];
      st.cols.filter(c => c.on).forEach((c, ci) => c.g.lines.forEach((pl, li) => {
        const ll = []; const step = Math.max(1, Math.floor(pl.length / 300));
        for (let i = 0; i < pl.length; i += step) { const q = llOf(pl[i][0], pl[i][1]); ll.push([q.lat, q.lng]); }
        const last = llOf(pl[pl.length - 1][0], pl[pl.length - 1][1]); ll.push([last.lat, last.lng]);
        items.push({ sid: `${file.name}:${st.page}:${c.g.col.join('.')}:${li}`, type: c.type, name: `${TYPES[c.type].label} (DT)`, depth: TYPES[c.type].depth, diam: TYPES[c.type].diam, pts: ll });
      }));
      const n = addItems(items, 'dt'); cleanup(!!st.overlay); el.remove();
      status(`${n} tronçon(s) importé(s) depuis ${file.name}. Profondeurs et diamètres sont des valeurs par défaut : corrigez-les d’après la légende du plan.`, { ms: 9000 });
    }
  });
  el.addEventListener('change', e => {
    const t = e.target, i = t.dataset.i, a = t.dataset.a;
    if (i != null) { if (t.type === 'checkbox') st.cols[+i].on = t.checked; else st.cols[+i].type = t.value; preview(); updateGo(); }
    else if (a === 'bg') overlay(t.checked);
  });
  el.addEventListener('input', e => { if (e.target.dataset.a === 'op' && st.overlay) st.overlay.setOpacity(+e.target.value / 100); });
  document.addEventListener('keydown', function esc_(e) { if (!el.isConnected) { document.removeEventListener('keydown', esc_); return; } if (e.key === 'Escape' && !el.hidden) close(); });
  if (doc.numPages > 1) {
    const sel = document.createElement('select'); sel.className = 'ch-ty'; sel.setAttribute('aria-label', 'Page du PDF');
    sel.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<option value="${i + 1}">Page ${i + 1}</option>`).join('');
    sel.addEventListener('change', () => { st.page = +sel.value; render(st.page); });
    $q('header .dt-pg').after(sel);
  }
  status('Lecture du PDF…', { ms: 1500 });
  await render(1);
  $q('.dt-box').focus && $q('.dt-box').setAttribute('tabindex', '-1');
}
