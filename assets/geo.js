/* GeoTrace – calcul de calage d'une maquette (module sans dépendance).
   Repère local : « maquette » (x, y en mètres, z vertical) et « terrain » (est, nord) autour d'une origine GPS. */
const R = 6371008.8, RAD = Math.PI / 180;

export function makeFrame(lat0, lon0) {
  const kx = R * RAD * Math.cos(lat0 * RAD), ky = R * RAD;
  return {
    lat0, lon0,
    toEN: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLL: (e, n) => [lat0 + n / ky, lon0 + e / kx],
  };
}

/* Calage par moindres carrés entre des points de la maquette (m) et leur position terrain (e).
   pairs : [{ m: [x, y], e: [est, nord] }]
   opts.fixScale : garde l'échelle 1:1 (conseillé : une maquette Revit est à l'échelle réelle).
   opts.angle    : orientation en degrés, utilisée seulement avec un seul point.
   Résultat : { s, theta (radians, anti-horaire), t: [tx, ty], rms, residuals[] } */
export function solveSimilarity(pairs, opts = {}) {
  const n = pairs.length;
  if (!n) return null;
  const mc = [0, 0], ec = [0, 0];
  pairs.forEach(p => { mc[0] += p.m[0] / n; mc[1] += p.m[1] / n; ec[0] += p.e[0] / n; ec[1] += p.e[1] / n; });
  let theta, s = 1;
  if (n === 1) {
    theta = (opts.angle || 0) * RAD;
  } else {
    // nombres complexes : z = Σ e~ · conj(m~) / Σ |m~|²
    let re = 0, im = 0, den = 0;
    pairs.forEach(p => {
      const mx = p.m[0] - mc[0], my = p.m[1] - mc[1], ex = p.e[0] - ec[0], ey = p.e[1] - ec[1];
      re += ex * mx + ey * my; im += ey * mx - ex * my; den += mx * mx + my * my;
    });
    if (den < 1e-9) return null; // tous les points maquette sont confondus
    theta = Math.atan2(im, re);
    if (!opts.fixScale) s = Math.hypot(re, im) / den;
  }
  const c = Math.cos(theta), sn = Math.sin(theta);
  const t = [ec[0] - s * (c * mc[0] - sn * mc[1]), ec[1] - s * (sn * mc[0] + c * mc[1])];
  const residuals = pairs.map(p => {
    const x = s * (c * p.m[0] - sn * p.m[1]) + t[0], y = s * (sn * p.m[0] + c * p.m[1]) + t[1];
    return Math.hypot(x - p.e[0], y - p.e[1]);
  });
  const rms = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n);
  return { s, theta, t, rms, residuals };
}

export const applyTo = (sol, m) => {
  const c = Math.cos(sol.theta), sn = Math.sin(sol.theta);
  return [sol.s * (c * m[0] - sn * m[1]) + sol.t[0], sol.s * (sn * m[0] + c * m[1]) + sol.t[1]];
};

/* ================= Projections françaises (Lambert conique conforme à 2 parallèles) =================
   Lambert-93 (EPSG:2154) et les zones Coniques Conformes CC42 à CC50 (EPSG:3942 à 3950), toutes en RGF93. */
const A = 6378137, F_ELL = 1 / 298.257222101, E2 = 2 * F_ELL - F_ELL * F_ELL, E = Math.sqrt(E2);
export const CRS_LIST = [{ code: 'EPSG:2154', label: 'Lambert-93' }]
  .concat(Array.from({ length: 9 }, (_, i) => ({ code: 'EPSG:' + (3942 + i), label: `CC${42 + i} (RGF93)` })));
const lccCache = {};
function lccParams(code) {
  if (lccCache[code]) return lccCache[code];
  let lat0, lat1, lat2, fe, fn;
  if (code === 'EPSG:2154') { lat0 = 46.5; lat1 = 44; lat2 = 49; fe = 700000; fn = 6600000; }
  else {
    const n = +code.slice(5) - 3942; if (!(n >= 0 && n <= 8)) return null;
    lat0 = 42 + n; lat1 = lat0 - 0.75; lat2 = lat0 + 0.75; fe = 1700000; fn = 1200000 + n * 1000000; // CC42 : 1 200 000, puis +1 000 000 par zone
  }
  const m = p => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  const t = p => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - E * Math.sin(p)) / (1 + E * Math.sin(p)), E / 2);
  const p0 = lat0 * RAD, p1 = lat1 * RAD, p2 = lat2 * RAD;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const Fc = m(p1) / (n * Math.pow(t(p1), n)), r0 = A * Fc * Math.pow(t(p0), n);
  return (lccCache[code] = { t, n, Fc, r0, fe, fn, lon0: 3 * RAD });
}
export function latLonToProj(code, lat, lon) {
  const k = lccParams(code); if (!k) return null;
  const r = A * k.Fc * Math.pow(k.t(lat * RAD), k.n), th = k.n * (lon * RAD - k.lon0);
  return [k.fe + r * Math.sin(th), k.fn + k.r0 - r * Math.cos(th)];
}
export function projToLatLon(code, x, y) {
  const k = lccParams(code); if (!k) return null;
  const dx = x - k.fe, dy = k.r0 - (y - k.fn), r = Math.sign(k.n) * Math.hypot(dx, dy);
  const gamma = Math.atan2(Math.sign(k.n) * dx, Math.sign(k.n) * dy);
  const tt = Math.pow(r / (A * k.Fc), 1 / k.n);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 12; i++) {
    const s = E * Math.sin(phi);
    const next = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - s) / (1 + s), E / 2));
    if (Math.abs(next - phi) < 1e-13) { phi = next; break; } phi = next;
  }
  return [phi / RAD, (k.lon0 + gamma / k.n) / RAD];
}
/* Rend le code EPSG d'un nom de système (« EPSG:2154 », « RGF93 / Lambert-93 », « CC48 »…), ou null. */
export function crsFromName(name) {
  const s = String(name || '').toUpperCase();
  let m = s.match(/EPSG[:\s]*(\d{4,5})/); if (m) { const c = 'EPSG:' + m[1]; return lccParams(c) ? c : null; }
  if (/LAMBERT[- ]?93/.test(s)) return 'EPSG:2154';
  m = s.match(/\bCC\s?(4[2-9]|50)\b/); if (m) return 'EPSG:' + (3942 + (+m[1] - 42));
  return null;
}
/* Plage plausible des coordonnées projetées, pour reconnaître des coordonnées Revit « partagées ». */
export function guessCrs(x, y) {
  const out = [];
  for (const c of CRS_LIST) {
    const ll = projToLatLon(c.code, x, y); if (!ll) continue;
    if (ll[0] > 41 && ll[0] < 52 && ll[1] > -6 && ll[1] < 10) {
      const back = latLonToProj(c.code, ll[0], ll[1]);
      // zone CC : plausible seulement à moins de 1° de latitude du parallèle central
      const zoneOk = c.code === 'EPSG:2154' || Math.abs(ll[0] - (42 + (+c.code.slice(5) - 3942))) < 1.0;
      if (zoneOk && Math.hypot(back[0] - x, back[1] - y) < 0.01) out.push({ code: c.code, ll });
    }
  }
  return out;
}
