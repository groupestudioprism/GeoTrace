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
