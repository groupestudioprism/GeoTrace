/* =====================================================================
   PLAN : la carte aérienne (IGN) servie comme une « photo » vue de dessus,
   pour y dessiner les réseaux. Les dessins du plan sont en coordonnées
   terrain exactes ; ils se reportent dans toutes les photos.
   ===================================================================== */
import { planGeo } from './photoproj.js';

export const PLAN_KEY = 'plan:main';
const WMTS = (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;

/* bounds = [[latMin, lonMin], [latMax, lonMax]] : zone à couvrir (avec marge).
   Renvoie { blob, pose, w, h, ok } ; pose = ce qu'il faut donner au repérage (photo.plan = { z, x0, y0 }). */
/* Zone du plan (sans charger d'image) : niveau de zoom et tuiles entières qui couvrent la zone. */
export function planGeometry(bounds, fixed) {
  let z = 19, tx0, tx1, ty0, ty1;
  if (fixed) {
    // plan déjà dessiné : on garde exactement la même zone, sinon les dessins glisseraient
    z = fixed.plan.z; tx0 = fixed.plan.x0 / 256; ty0 = fixed.plan.y0 / 256; tx1 = tx0 + fixed.w / 256 - 1; ty1 = ty0 + fixed.h / 256 - 1;
  } else {
    const [[la0, lo0], [la1, lo1]] = bounds, MAXPX = 5120;
    let x0, x1, y0, y1;
    for (z = 19; z >= 14; z--) {
      x0 = planGeo.lon2px(lo0, z); x1 = planGeo.lon2px(lo1, z); y0 = planGeo.lat2px(la1, z); y1 = planGeo.lat2px(la0, z);
      if (x1 - x0 <= MAXPX && y1 - y0 <= MAXPX) { break; }
    }
    if (z < 14) { z = 14; }
    // zone trop grande même au zoom 14 : on garde la partie centrale
    if (x1 - x0 > MAXPX) { const m = (x0 + x1) / 2; x0 = m - MAXPX / 2; x1 = m + MAXPX / 2; }
    if (y1 - y0 > MAXPX) { const m = (y0 + y1) / 2; y0 = m - MAXPX / 2; y1 = m + MAXPX / 2; }
    // on cale sur des tuiles entières (256 px) pour ne rien déformer
    tx0 = Math.floor(x0 / 256); tx1 = Math.floor(x1 / 256); ty0 = Math.floor(y0 / 256); ty1 = Math.floor(y1 / 256);
  }
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1, w = nx * 256, h = ny * 256;
  const midLat = planGeo.px2lat(ty0 * 256 + h / 2, z), midLon = planGeo.px2lon(tx0 * 256 + w / 2, z);
  return { z: z, tx0: tx0, ty0: ty0, nx: nx, ny: ny, w: w, h: h, pose: { key: PLAN_KEY, name: 'Plan', lat: midLat, lon: midLon, heading: 0, pitch: -90, plan: { z: z, x0: tx0 * 256, y0: ty0 * 256 }, w: w, h: h } };
}

export async function buildPlan(bounds, fixed) {
  const G = planGeometry(bounds, fixed), z = G.z, tx0 = G.tx0, ty0 = G.ty0;
  const nx = G.nx, ny = G.ny, w = G.w, h = G.h;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'); c.fillStyle = '#9aa7b5'; c.fillRect(0, 0, w, h);
  let ok = 0;
  await Promise.all(Array.from({ length: nx * ny }, (_, k) => new Promise(res => {
    const tx = tx0 + (k % nx), ty = ty0 + Math.floor(k / nx), im = new Image(); im.crossOrigin = 'anonymous';
    const to = setTimeout(res, 15000);
    im.onload = () => { clearTimeout(to); c.drawImage(im, (tx - tx0) * 256, (ty - ty0) * 256); ok++; res(); };
    im.onerror = () => { clearTimeout(to); res(); };
    im.src = WMTS(z, tx, ty);
  })));
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
  return { blob: blob, w: w, h: h, ok: ok, tiles: nx * ny, pose: G.pose };
}
