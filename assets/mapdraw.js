/* =====================================================================
   DESSINER LES RÉSEAUX DIRECTEMENT SUR LA CARTE
   ---------------------------------------------------------------------
   Les dessins sont gardés dans le « plan » (une vue de dessus exacte de la
   carte) : ils sont donc en coordonnées terrain et se reportent dans toutes
   les photos. Ici on les trace sur la carte principale, sans ouvrir d'écran.
   ===================================================================== */
import { planGeo } from './photoproj.js';

export async function initMapDraw(o) {
  const { map, bar, status, getRec, setRec, getPose, openPlan } = o;
  const Rep = o.Rep || await import('./repere.js');   // charge aussi les réglages de l'utilisateur (conduites, regards…)
  const C = await import('./repere-core.js');
  const L = window.L;
  const layer = L.layerGroup().addTo(map), draftLayer = L.layerGroup().addTo(map);
  let mode = null, draft = [], undo = [];
  const $ = s => bar.querySelector(s);

  // listes de choix (conduites, regards, accessoires) d'après les réglages du repérage
  const fillSel = (sel, list, fmt) => { sel.innerHTML = list.map(x => '<option value="' + x.id + '">' + fmt(x) + '</option>').join(''); };
  const pipeSel = $('#mdPipe'), mhSel = $('#mdMh'), accSel = $('#mdAcc');
  const refill = () => {
    fillSel(pipeSel, C.S.pipes, p => (C.netOf(p.net) || { name: '' }).name + ' · ' + p.desc);
    fillSel(mhSel, C.S.manholes, m => m.name);
    fillSel(accSel, C.S.accessories, a => a.name);
  };
  refill();

  // conversion carte <-> pixels du plan
  const pose = () => getPose();
  const toLL = (p, P) => [planGeo.px2lat(P.plan.y0 + p.y, P.plan.z), planGeo.px2lon(P.plan.x0 + p.x, P.plan.z)];
  const toPx = (ll, P) => ({ x: planGeo.lon2px(ll.lng, P.plan.z) - P.plan.x0, y: planGeo.lat2px(ll.lat, P.plan.z) - P.plan.y0 });
  const record = P => { const r = getRec(); return r && r.v === 2 ? JSON.parse(JSON.stringify(r)) : { v: 2, w: P.w, h: P.h, objs: [] }; };
  const commit = (rec, P) => { rec.w = P.w; rec.h = P.h; undo.push(JSON.stringify(getRec() || null)); if (undo.length > 40) undo.shift(); setRec(rec); redraw(); };

  function redraw() {
    layer.clearLayers();
    const P = pose(), rec = getRec();
    if (!P || !rec || !rec.objs) return;
    rec.objs.forEach(ob => {
      if (ob.type === 'line' && ob.pts && ob.pts.length > 1) {
        const pd = C.pipeOf(ob.pipeId) || { net: '', desc: '', dash: 'solid' }, col = C.colOf(pd.net);
        const pl = L.polyline(ob.pts.map(p => toLL(p, P)), { color: col, weight: 5, opacity: .95, dashArray: pd.dash === 'dashed' ? '10 7' : pd.dash === 'dotted' ? '2 6' : null });
        pl.bindTooltip(pd.desc || 'Conduite', { sticky: true });
        pl.on('click', e => { if (mode === 'sel') { L.DomEvent.stop(e); pick(ob, e.latlng, pd.desc); } });
        layer.addLayer(pl);
      } else if (ob.type === 'manhole') {
        const def = C.mhOf(ob.mhId) || {}, col = C.colOf(ob.net || def.net);
        const m = L.circleMarker(toLL({ x: ob.cx, y: ob.cy }, P), { radius: 8, color: col, weight: 3, fillColor: '#fff', fillOpacity: 1 });
        m.bindTooltip((ob.num || def.name || 'Regard') + (ob.diam ? ' Ø' + ob.diam : ''), { sticky: true });
        m.on('click', e => { if (mode === 'sel') { L.DomEvent.stop(e); pick(ob, e.latlng, def.name || 'Regard'); } });
        layer.addLayer(m);
      } else if (ob.type === 'acc') {
        const def = C.accOf(ob.accId) || {}, col = C.colOf(ob.net || def.net);
        const m = L.circleMarker(toLL({ x: ob.x, y: ob.y }, P), { radius: 6, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 });
        m.bindTooltip(def.name || 'Accessoire', { sticky: true });
        m.on('click', e => { if (mode === 'sel') { L.DomEvent.stop(e); pick(ob, e.latlng, def.name || 'Accessoire'); } });
        layer.addLayer(m);
      }
    });
  }

  function pick(ob, ll, name) {
    const div = document.createElement('div');
    div.innerHTML = '<b></b><br><button class="btn small" type="button">Supprimer</button>';
    div.querySelector('b').textContent = name;
    div.querySelector('button').onclick = () => { const P = pose(), rec = record(P); rec.objs = rec.objs.filter(x => x.id !== ob.id); commit(rec, P); map.closePopup(); };
    L.popup().setLatLng(ll).setContent(div).openOn(map);
  }

  function drawDraft(cursor) {
    draftLayer.clearLayers();
    if (mode !== 'line' || !draft.length) return;
    const pts = draft.concat(cursor ? [cursor] : []);
    draftLayer.addLayer(L.polyline(pts, { color: '#12b5f0', weight: 4, dashArray: '6 6', interactive: false }));
    draft.forEach(p => draftLayer.addLayer(L.circleMarker(p, { radius: 4, color: '#12b5f0', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false })));
  }
  function finishLine() {
    // un double-clic ajoute deux fois le même point : on enlève les doublons
    draft = draft.filter((p, i) => i === 0 || Math.hypot(p[0] - draft[i - 1][0], p[1] - draft[i - 1][1]) > 1e-7);
    if (draft.length >= 2) {
      const P = pose(), rec = record(P), ph = { w: rec.w, h: rec.h, objects: rec.objs };
      rec.objs.push(C.newLine(draft.map(ll => toPx({ lat: ll[0], lng: ll[1] }, P)), pipeSel.value));
      commit(rec, P);
    }
    draft = []; drawDraft();
  }

  function setMode(m) {
    mode = mode === m ? null : m;
    draft = []; drawDraft(); map.closePopup();
    bar.querySelectorAll('[data-md]').forEach(b => { if (['line', 'mh', 'acc', 'sel'].includes(b.dataset.md)) b.setAttribute('aria-pressed', String(b.dataset.md === mode)); });
    pipeSel.hidden = mode !== 'line'; mhSel.hidden = mode !== 'mh'; accSel.hidden = mode !== 'acc';
    $('#mdFin').hidden = mode !== 'line';
    map.getContainer().style.cursor = mode && mode !== 'sel' ? 'crosshair' : '';
    // pendant le dessin, les repères photos ne captent plus les clics (sinon ils déplacent la carte et volent le clic)
    map.getContainer().classList.toggle('md-on', !!mode);
    map.getContainer().classList.toggle('md-add', !!mode && mode !== 'sel');
    if (mode && mode !== 'sel') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    const hint = { line: 'Cliquez les points de la conduite, double-clic (ou « Terminer ») pour finir.', mh: 'Cliquez à l’emplacement du regard.', acc: 'Cliquez à l’emplacement de l’accessoire.', sel: 'Cliquez un dessin pour le supprimer.' }[mode];
    $('#mdHint').textContent = hint || 'Choisissez un outil pour dessiner sur la carte.';
  }

  map.on('click', e => {
    if (!mode || mode === 'sel' || bar.hidden) return;
    const P = pose(); if (!P) return;
    if (mode === 'line') { draft.push([e.latlng.lat, e.latlng.lng]); drawDraft(); return; }
    const rec = record(P), ph = { w: rec.w, h: rec.h, objects: rec.objs }, u = rec.w / 1000, p = toPx(e.latlng, P);
    if (mode === 'mh') { const def = C.mhOf(mhSel.value) || C.S.manholes[0]; rec.objs.push(C.newManhole(ph, p, def, u)); }
    if (mode === 'acc') { const def = C.accOf(accSel.value) || C.S.accessories[0]; rec.objs.push(C.newAcc(p, def, u)); }
    commit(rec, P);
  });
  map.on('dblclick', e => { if (mode === 'line' && !bar.hidden) { finishLine(); } });
  map.on('mousemove', e => { if (mode === 'line' && draft.length) drawDraft([e.latlng.lat, e.latlng.lng]); });
  document.addEventListener('keydown', e => {
    if (bar.hidden || !mode) return;
    if (e.key === 'Escape') { if (draft.length) { draft = []; drawDraft(); } else setMode(mode); }
    if (e.key === 'Enter' && mode === 'line') { finishLine(); }
  });

  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-md]'); if (!b) return;
    const k = b.dataset.md;
    if (['line', 'mh', 'acc', 'sel'].includes(k)) { if (!pose()) { status('Ajoutez d’abord des photos : le plan se place d’après elles.', { ms: 4000 }); return; } setMode(k); }
    else if (k === 'fin') finishLine();
    else if (k === 'undo') { if (draft.length) { draft.pop(); drawDraft(); } else if (undo.length) { const prev = JSON.parse(undo.pop()); setRec(prev); redraw(); } }
    else if (k === 'plan') openPlan();
    else if (k === 'close') { setMode(null); mode = null; bar.hidden = true; layer.removeFrom(map); draftLayer.removeFrom(map); }
  });
  setMode(null);

  return {
    show(on) { bar.hidden = !on; if (on) { layer.addTo(map); draftLayer.addTo(map); refill(); redraw(); } else { setMode(null); } },
    refresh: redraw,
    visible: () => !bar.hidden
  };
}
