/* GeoTrace – engins à pièces mobiles (benne, cuve, roues directrices) : paramètres bornés décrits dans le catalogue (champ « art »).
   Chaque paramètre agit sur une ou plusieurs pièces du modèle (champ « parts »), autour d'un axe et d'un pivot propres au modèle. */
export const defaults = a => Object.fromEntries(a.params.map(q => [q.k, q.def]));
export const clamp = (a, p) => {
  const o = {};
  for (const q of a.params) { const v = Number.isFinite(+(p || {})[q.k]) ? +p[q.k] : q.def; o[q.k] = Math.round(Math.min(q.max, Math.max(q.min, v))); }
  return o;
};
