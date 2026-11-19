/* GeoTrace – démarrage : thème appliqué avant le premier affichage (pas de flash clair) et animation d'accueil jouée une seule fois par session.
   Fichier à part (aucun script dans la page) pour que la politique de sécurité du contenu puisse interdire tout script injecté. */
(function () {
  var root = document.documentElement;
  try {
    var t = JSON.parse(localStorage.getItem('geotrace:prefs') || '{}').theme;
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.dataset.theme = t;
  } catch (e) { root.dataset.theme = 'light'; }
  var seen = /[?&]nosplash\b/.test(location.search);
  try { if (sessionStorage.getItem('geotrace:splash') === '1') seen = true; sessionStorage.setItem('geotrace:splash', '1'); } catch (e) { /* stockage indisponible */ }
  if (seen) { root.classList.add('no-splash'); return; }
  function go() {
    var s = document.getElementById('splash'); if (!s || s.classList.contains('go')) return;
    s.classList.add('go');
    try { s.getAnimations({ subtree: true }).forEach(function (a) { a.playbackRate = 1.7; }); } catch (e) { /* vitesse normale */ }
  }
  if (document.readyState === 'complete') go(); else addEventListener('load', go);
  document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 1200); });
})();
