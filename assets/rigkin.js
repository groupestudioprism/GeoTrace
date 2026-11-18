/* GeoTrace – pelles articulées : cinématique (sans 3D) partagée par la carte, le schéma de profil et la vue 3D.
   Repère du profil : x vers l'avant depuis l'axe de rotation de la tourelle, z vers le haut depuis le sol.
   Angles en degrés : sw tourelle (sens horaire, 0 = dans l'axe des chenilles), bm flèche (0 = horizontale, + vers le haut),
   st balancier relatif à la flèche (négatif = replié vers la machine), bk godet relatif au balancier (négatif = refermé). */
const D = Math.PI / 180;
export const DEFAULT_P = { sw: 0, bm: 30, st: -65, bk: -55 };
export const RANGE = { sw: [-180, 180], bm: [-30, 70], st: [-160, -25], bk: [-135, 30] };
export const LABELS = { sw: 'Rotation de la tourelle', bm: 'Flèche', st: 'Balancier', bk: 'Godet' };
export const PRESETS = [
  { label: 'Transport', p: { bm: 15, st: -150, bk: -80 } },
  { label: 'Creusement', p: { bm: 20, st: -80, bk: -60 } },
  { label: 'Fouille profonde', p: { bm: 5, st: -105, bk: -60 } },
  { label: 'Chargement camion', p: { bm: 50, st: -55, bk: -35 } },
];
export const clampP = p => {
  const o = {};
  for (const k of Object.keys(DEFAULT_P)) { const v = Number.isFinite(+(p || {})[k]) ? +p[k] : DEFAULT_P[k]; o[k] = Math.round(Math.min(RANGE[k][1], Math.max(RANGE[k][0], v))); }
  return o;
};
/* Points du profil : pied de flèche P, coude E, poignet W, dent du godet T (x, z). */
export function kin(s, p) {
  p = clampP(p);
  const P = [s.bx, s.bz], a = p.bm * D, b = (p.bm + p.st) * D, c = (p.bm + p.st + p.bk) * D;
  const E = [P[0] + s.Lb * Math.cos(a), P[1] + s.Lb * Math.sin(a)];
  const W = [E[0] + s.Ls * Math.cos(b), E[1] + s.Ls * Math.sin(b)];
  const T = [W[0] + s.Lk * Math.cos(c), W[1] + s.Lk * Math.sin(c)];
  return { P, E, W, T, reach: T[0], depth: T[1] };
}
/* Portée maximale et profondeur maximale (balayage des amplitudes). */
const memo = new Map();
export function limits(s) {
  const k = JSON.stringify([s.bx, s.bz, s.Lb, s.Ls, s.Lk]); if (memo.has(k)) return memo.get(k);
  let reach = 0, depth = 1e9, top = -1e9;
  for (let bm = RANGE.bm[0]; bm <= RANGE.bm[1]; bm += 5) for (let st = RANGE.st[0]; st <= RANGE.st[1]; st += 5) for (let bk = RANGE.bk[0]; bk <= RANGE.bk[1]; bk += 15) {
    const r = kin(s, { bm, st, bk }); reach = Math.max(reach, r.T[0]); depth = Math.min(depth, r.T[1]); top = Math.max(top, r.E[1], r.W[1], r.T[1]);
  }
  const o = { reach, depth, top }; memo.set(k, o); return o;
}
export const fmt = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
/* Emprise au sol de la partie basse (carte 2D). */
export const footprint = s => ({ w: s.W, l: s.type === 'wheels' ? s.Lu + 2 * (s.wr || .6) : s.Lu + (s.blade ? .5 : 0) });

/* Schéma de profil (SVG) : sol, train de roulement, tourelle, flèche, balancier, godet à l'échelle. */
export function sideSvg(s, p) {
  const k = kin(s, p), rear = s.rear, fr = s.frontH, Hh = s.Hh, pts = [k.P, k.E, k.W, k.T];
  const minX = Math.min(-rear, -s.Lu / 2) - .4, maxX = Math.max(...pts.map(q => q[0]), s.Lu / 2) + .5, minZ = Math.min(0, ...pts.map(q => q[1])) - .3, maxZ = Math.max(Hh, ...pts.map(q => q[1])) + .3;
  const W = maxX - minX, H = maxZ - minZ, X = x => ((x - minX)).toFixed(2), Z = z => (maxZ - z).toFixed(2);
  const poly = (a, w, col) => `<polyline points="${a.map(q => X(q[0]) + ',' + Z(q[1])).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const col = s.color ? `rgb(${s.color.map(v => Math.round(v * 255)).join(',')})` : '#e0922b';
  const bw = Math.max(.28, s.Lb * .07);
  return `<svg class="eg-side" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" role="img" aria-label="Profil de la pelle">
    <line x1="0" x2="${W.toFixed(2)}" y1="${Z(0)}" y2="${Z(0)}" stroke="#7c8f6a" stroke-width=".08"/>
    ${s.type === 'wheels' ? `<circle cx="${X(-s.Lu / 2)}" cy="${Z(s.wr)}" r="${s.wr}" fill="#222"/><circle cx="${X(s.Lu / 2)}" cy="${Z(s.wr)}" r="${s.wr}" fill="#222"/>` : `<rect x="${X(-s.Lu / 2)}" y="${Z(s.th)}" width="${s.Lu}" height="${s.th}" rx="${(s.th / 2).toFixed(2)}" fill="#222"/>`}
    <rect x="${X(-rear)}" y="${Z(Hh * .55)}" width="${rear + fr}" height="${(Hh * .55 - s.deck).toFixed(2)}" fill="${col}" opacity=".9"/>
    <rect x="${X(fr - 1.5 * s.Lb / 5.7)}" y="${Z(Hh)}" width="${(1.5 * s.Lb / 5.7).toFixed(2)}" height="${(Hh - Hh * .55).toFixed(2)}" fill="#8fb6cc" opacity=".8"/>
    ${poly([k.P, k.E], bw, col)}${poly([k.E, k.W], bw * .75, col)}${poly([k.W, k.T], bw * 1.1, '#3a3a3e')}
    <circle cx="${X(k.T[0])}" cy="${Z(k.T[1])}" r=".14" fill="#d6402b"/></svg>`;
}
