/* Les réseaux dessinés sur le plan, montrés sur la carte principale (lecture seule). */
import { planGeo } from './photoproj.js';

export async function initNetLayer({ map, getRec, getPose, onPick }) {
  await import('./repere.js');                        // charge aussi les réglages (conduites, regards…)
  const C = await import('./repere-core.js'), L = window.L;
  let layer = L.layerGroup(), on = true;
  const toLL = (p, P) => [planGeo.px2lat(P.plan.y0 + p.y, P.plan.z), planGeo.px2lon(P.plan.x0 + p.x, P.plan.z)];
  function refresh() {
    layer.clearLayers();
    const P = getPose(), rec = getRec();
    if (!on || !P || !P.plan || !rec || !rec.objs) { layer.remove(); return; }
    layer.addTo(map);
    const click = e => { L.DomEvent.stop(e); onPick && onPick(); };
    rec.objs.forEach(ob => {
      if (ob.type === 'line' && ob.pts && ob.pts.length > 1) {
        const pd = C.pipeOf(ob.pipeId) || { net: '', desc: '', dash: 'solid' };
        layer.addLayer(L.polyline(ob.pts.map(p => toLL(p, P)), { color: C.colOf(pd.net), weight: 5, opacity: .95, dashArray: pd.dash === 'dashed' ? '10 7' : pd.dash === 'dotted' ? '2 6' : null }).bindTooltip(pd.desc || 'Conduite', { sticky: true }).on('click', click));
      } else if (ob.type === 'manhole') {
        const def = C.mhOf(ob.mhId) || {};
        layer.addLayer(L.circleMarker(toLL({ x: ob.cx, y: ob.cy }, P), { radius: 8, color: C.colOf(ob.net || def.net), weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip((ob.num || def.name || 'Regard') + (ob.diam ? ' Ø' + ob.diam : ''), { sticky: true }).on('click', click));
      } else if (ob.type === 'acc') {
        const def = C.accOf(ob.accId) || {};
        layer.addLayer(L.circleMarker(toLL({ x: ob.x, y: ob.y }, P), { radius: 6, color: '#fff', weight: 2, fillColor: C.colOf(ob.net || def.net), fillOpacity: 1 }).bindTooltip(def.name || 'Accessoire', { sticky: true }).on('click', click));
      }
    });
  }
  return { refresh: refresh, setVisible(v) { on = v; refresh(); } };
}
