/* GeoTrace 3.0 – navigation à la manière de Nextcloud : rubriques repliables à gauche.
   Les entrées déclenchent les boutons d'origine, dont tout le reste du code dépend. */
(function () {
  const $ = id => document.getElementById(id);
  const KEY = 'geotrace:nav';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* stockage indisponible */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* rien */ } };

  function setOpen(sec, on) {
    sec.classList.toggle('open', on);
    const b = sec.querySelector('[data-sec]'); if (b) b.setAttribute('aria-expanded', String(on));
    saved[sec.id] = on; keep();
  }
  document.querySelectorAll('.nav-sec').forEach(sec => {
    if (sec.id in saved) setOpen(sec, !!saved[sec.id]);
    sec.querySelector('[data-sec]').addEventListener('click', () => setOpen(sec, !sec.classList.contains('open')));
  });

  /* Navigation visible : ouvrir une rubrique et la montrer */
  function showNav() {
    const app = $('app');
    if (matchMedia('(max-width: 760px)').matches) { if (!app.classList.contains('sheet-open')) $('panelToggle').click(); }
    else if (app.classList.contains('panel-off')) $('panelToggle').click();
  }
  function open(id) {
    const sec = $(id); if (!sec) return;
    showNav(); setOpen(sec, true);
    sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  window.GTNav = { open };

  $('layersBtn').addEventListener('click', e => {
    e.stopPropagation();
    const sec = $('navFond'), app = $('app');
    const shown = sec.classList.contains('open') && !app.classList.contains('panel-off');
    if (shown && !matchMedia('(max-width: 760px)').matches) setOpen(sec, false); else open('navFond');
  });
  $('navToggle').addEventListener('click', () => $('panelToggle').click());

  /* Chantier : ouvre le panneau sur la bonne rubrique */
  document.querySelectorAll('[data-chtab]').forEach(b => b.addEventListener('click', () => {
    if ($('chPanel').hidden) $('chBtn').click();
    const t = document.querySelector(`#chTabs button[data-tab="${b.dataset.chtab}"]`); if (t) t.click();
  }));
  document.querySelectorAll('[data-nav-go]').forEach(b => b.addEventListener('click', () => { const t = $(b.dataset.navGo); if (t) t.click(); }));

  /* Outils de carte rangés avec le zoom, en bas à droite (comme Cartes de Nextcloud) */
  const tools = document.querySelector('.mapwrap .tools'), corner = document.querySelector('#map .leaflet-bottom.leaflet-right');
  if (tools && corner) {
    tools.classList.add('leaflet-control');
    corner.insertBefore(tools, corner.querySelector('.leaflet-control-zoom') || corner.firstChild);
    if (window.L) { L.DomEvent.disableClickPropagation(tools); L.DomEvent.disableScrollPropagation(tools); }
  }

  /* États reflétés dans la navigation : onglet actif, panneaux ouverts, export possible, nombre de photos */
  function sync() {
    const chOpen = !$('chPanel').hidden;
    const tab = (document.querySelector('#chTabs button[aria-selected="true"]') || {}).dataset;
    document.querySelectorAll('[data-chtab]').forEach(b => b.classList.toggle('active', chOpen && !!tab && tab.tab === b.dataset.chtab));
    const mq = document.querySelector('[data-nav-go="maqBtn"]'); if (mq) mq.classList.toggle('active', !$('maqPanel').hidden);
    const off = $('exportBtn').disabled;
    document.querySelectorAll('.nav-item[data-export]').forEach(b => { b.disabled = off; });
    const n = document.querySelectorAll('#list .it').length, c = $('navCount');
    c.textContent = n; c.hidden = !n;
    const lt = $('layersBtn'); lt.setAttribute('aria-expanded', String($('navFond').classList.contains('open') && !$('app').classList.contains('panel-off')));
    const mob = matchMedia('(max-width: 760px)').matches, app = $('app');
    const shown = mob ? app.classList.contains('sheet-open') : !app.classList.contains('panel-off');
    $('navToggle').setAttribute('aria-expanded', String(shown));
    if (mob && $('panelToggle').getAttribute('aria-expanded') !== String(shown)) $('panelToggle').setAttribute('aria-expanded', String(shown));
  }
  const mo = new MutationObserver(() => requestAnimationFrame(sync));
  mo.observe($('chPanel'), { attributes: true, attributeFilter: ['hidden'] });
  mo.observe($('maqPanel'), { attributes: true, attributeFilter: ['hidden'] });
  mo.observe($('chTabs'), { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
  mo.observe($('exportBtn'), { attributes: true, attributeFilter: ['disabled'] });
  mo.observe($('list'), { childList: true });
  mo.observe($('app'), { attributes: true, attributeFilter: ['class'] });
  mo.observe($('navFond'), { attributes: true, attributeFilter: ['class'] });
  sync();
})();
