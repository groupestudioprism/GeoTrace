/* GeoTrace 3.0 – navigation à la manière de Cartes de Nextcloud.
   En haut, le menu de base (Mes favoris, Mes contacts, Mes photos, Mes traces, Mes appareils, Mes cartes),
   puis les options GeoTrace avec leurs interfaces complètes (Fond de carte, Chantier, Maquette 3D, Photos en 3D, Exporter).
   Les entrées déclenchent les boutons d'origine, dont tout le reste du code dépend. */
(function () {
  const $ = id => document.getElementById(id);
  const CFG = window.GEOTRACE_CONFIG || {};
  const mobile = () => matchMedia('(max-width: 760px)').matches;
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = n => { const s = document.createElement('span'); s.dataset.ic = n; return s; };
  const paint = root => root.querySelectorAll('[data-ic]').forEach(el => { if (!el.querySelector('svg') && window.GTIcon) el.insertAdjacentHTML('afterbegin', window.GTIcon(el.dataset.ic)); });

  /* ---------- Rubriques repliables (état mémorisé) ---------- */
  const saved = store('geotrace:nav') || {};
  function setOpen(sec, on) {
    sec.classList.toggle('open', on);
    const b = sec.querySelector(':scope > .nav-entry'); if (b) b.setAttribute('aria-expanded', String(on));
    if (sec.querySelector(':scope > [data-sec]')) { saved[sec.id] = on; store('geotrace:nav', saved); }
  }
  document.querySelectorAll('.nav-sec').forEach(sec => {
    const b = sec.querySelector(':scope > [data-sec]'); if (!b) return;
    if (sec.id in saved) setOpen(sec, !!saved[sec.id]);
    b.addEventListener('click', () => setOpen(sec, !sec.classList.contains('open')));
  });

  function showNav() {
    const app = $('app');
    if (mobile()) { if (!app.classList.contains('sheet-open')) $('panelToggle').click(); }
    else if (app.classList.contains('panel-off')) $('panelToggle').click();
  }
  function reveal(sec) { requestAnimationFrame(() => sec.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
  function open(id) { const sec = $(id); if (!sec) return; showNav(); setOpen(sec, true); reveal(sec); }
  window.GTNav = { open };

  /* ---------- En-tête et carte ---------- */
  $('layersBtn').addEventListener('click', e => {
    e.stopPropagation();
    const sec = $('navFond'), shown = sec.classList.contains('open') && !$('app').classList.contains('panel-off');
    if (shown && !mobile()) setOpen(sec, false); else open('navFond');
  });
  $('navToggle').addEventListener('click', () => $('panelToggle').click());
  document.querySelectorAll('[data-nav-go]').forEach(b => b.addEventListener('click', () => { const t = $(b.dataset.navGo); if (t) t.click(); }));

  /* ---------- Menu de base ---------- */
  $('navFavBtn').addEventListener('click', () => $('favOnly').click());
  $('navNcMaps').href = String(CFG.nextcloud || 'https://buildingnext.sturno.fr').replace(/\/+$/, '') + '/index.php/apps/maps/';

  /* Mes cartes : chaque chantier est un lien de partage Nextcloud (réglages + cartes ajoutées dans ce navigateur) */
  const mine = () => store('geotrace:cartes') || [];
  function cartes() {
    const cfg = Array.isArray(CFG.cartes) ? CFG.cartes.map(c => ({ nom: c.nom, lien: c.lien, cfg: true })) : [];
    return cfg.concat(mine().map((c, i) => ({ ...c, i })));
  }
  function renderMaps() {
    const ul = $('navMapsList'), list = cartes(), cur = store('geotrace:carte');
    const src = $('srcName').textContent.trim(), has = !document.body.classList.contains('on-welcome');
    ul.textContent = '';
    const li0 = document.createElement('li');
    li0.innerHTML = `<button type="button" class="nav-item${has && !list.some(c => c.lien === cur) ? ' active' : ''}" title="Photos ouvertes : tout voir">${esc(has ? src : 'Par défaut')}</button>`;
    li0.firstChild.addEventListener('click', () => { if (has) $('fitBtn').click(); else $('sourceBtn').click(); });
    ul.appendChild(li0);
    list.forEach(c => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="nav-item${c.lien === cur ? ' active' : ''}" title="${esc(c.lien)}">${esc(c.nom)}</button>` + (c.cfg ? '' : `<button type="button" class="nav-del" aria-label="Retirer la carte ${esc(c.nom)}" title="Retirer"></button>`);
      li.firstChild.addEventListener('click', () => openCarte(c));
      const del = li.querySelector('.nav-del');
      if (del) { del.appendChild(ic('close')); del.addEventListener('click', () => { const m = mine(); m.splice(c.i, 1); store('geotrace:cartes', m); renderMaps(); }); }
      ul.appendChild(li);
    });
    paint(ul);
    const n = list.length + 1; $('navMapsCount').textContent = n; $('navMapsCount').hidden = false;
  }
  function openCarte(c) {
    store('geotrace:carte', c.lien);
    $('linkInput').value = c.lien; $('pwdInput').value = '';
    $('linkForm').requestSubmit();
    renderMaps();
  }
  $('navMapAdd').addEventListener('click', () => { $('navMapForm').hidden = false; $('navMapAdd').hidden = true; $('navMapName').focus(); });
  $('navMapCancel').addEventListener('click', () => { $('navMapForm').hidden = true; $('navMapAdd').hidden = false; });
  $('navMapForm').addEventListener('submit', e => {
    e.preventDefault();
    const nom = $('navMapName').value.trim(), lien = $('navMapLink').value.trim();
    if (!nom || !/\/s\/[A-Za-z0-9]+/.test(lien)) { $('navMapLink').setCustomValidity('Collez un lien de partage Nextcloud (il contient « /s/ »).'); $('navMapLink').reportValidity(); return; }
    const m = mine(); m.push({ nom, lien }); store('geotrace:cartes', m);
    $('navMapForm').reset(); $('navMapForm').hidden = true; $('navMapAdd').hidden = false; renderMaps();
  });
  $('navMapLink').addEventListener('input', e => e.target.setCustomValidity(''));

  /* ---------- Options GeoTrace : interfaces Chantier et Maquette dans la navigation ---------- */
  $('navChBtn').addEventListener('click', () => $('chBtn').click());
  $('navMaqBtn').addEventListener('click', () => $('maqBtn').click());
  function panelSync(panelId, secId) {
    const sec = $(secId), on = !$(panelId).hidden, was = sec.classList.contains('open');
    setOpen(sec, on);
    if (on && !was) { showNav(); reveal(sec); }
  }

  /* Outils de carte rangés avec le zoom, en bas à droite */
  const tools = document.querySelector('.mapwrap .tools'), corner = document.querySelector('#map .leaflet-bottom.leaflet-right');
  if (tools && corner) {
    tools.classList.add('leaflet-control');
    corner.insertBefore(tools, corner.querySelector('.leaflet-control-zoom') || corner.firstChild);
    if (window.L) { L.DomEvent.disableClickPropagation(tools); L.DomEvent.disableScrollPropagation(tools); }
  }

  /* ---------- États reflétés dans la navigation ---------- */
  let lastSrc = '';
  function sync() {
    panelSync('chPanel', 'navChantier');
    panelSync('maqPanel', 'navMaq');
    const off = $('exportBtn').disabled;
    document.querySelectorAll('.nav-item[data-export]').forEach(b => { b.disabled = off; });
    const n = document.querySelectorAll('#list .it').length, c = $('navCount');
    c.textContent = n; c.hidden = !n;
    const fav = $('favOnly'), fb = $('navFavBtn'), fc = $('navFavCount'), nf = +(fav.querySelector('b') || {}).textContent || 0;
    fb.setAttribute('aria-pressed', fav.getAttribute('aria-pressed')); fb.classList.toggle('active', fav.getAttribute('aria-pressed') === 'true');
    fc.textContent = nf; fc.hidden = !nf;
    const src = $('srcName').textContent + document.body.className; if (src !== lastSrc) { lastSrc = src; renderMaps(); }
    $('layersBtn').setAttribute('aria-expanded', String($('navFond').classList.contains('open') && !$('app').classList.contains('panel-off')));
    const app = $('app'), shown = mobile() ? app.classList.contains('sheet-open') : !app.classList.contains('panel-off');
    $('navToggle').setAttribute('aria-expanded', String(shown));
    if (mobile() && $('panelToggle').getAttribute('aria-expanded') !== String(shown)) $('panelToggle').setAttribute('aria-expanded', String(shown));
  }
  let queued = false;
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } });
  mo.observe($('chPanel'), { attributes: true, attributeFilter: ['hidden'] });
  mo.observe($('maqPanel'), { attributes: true, attributeFilter: ['hidden'] });
  mo.observe($('exportBtn'), { attributes: true, attributeFilter: ['disabled'] });
  mo.observe($('list'), { childList: true });
  mo.observe($('app'), { attributes: true, attributeFilter: ['class'] });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  mo.observe($('navFond'), { attributes: true, attributeFilter: ['class'] });
  mo.observe($('chips'), { attributes: true, subtree: true, characterData: true, childList: true });
  mo.observe($('srcName'), { childList: true, characterData: true, subtree: true });
  sync();
})();
