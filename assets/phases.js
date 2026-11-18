/* GeoTrace – phases de chantier : dates, installations et déviations présentes, éléments de la maquette, page du planning PDF.
   Une phase choisie filtre la carte 2D et la vue 3D (apparition progressive des éléments de la maquette). */
const $ = id => document.getElementById(id);
const BASE = 'geotrace:phases';
let KEY = BASE;
const PALETTE = ['#1f6fb5', '#e0922b', '#2f8f63', '#8a5fd0', '#d6402b', '#0aa5b8', '#c2549e', '#6b7480'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => 'p' + Math.random().toString(36).slice(2, 8);

let phases = [], proj = null, cur = null, ctx = {}, planning = null, planBlob = null, openId = null, planName = '', tasks = null;
const listeners = [];

const readLocal = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.phases) ? j.phases : null; } catch (e) { return null; } };
const clean = p => p && typeof p.id === 'string' && typeof p.name === 'string';
const norm = p => ({ id: p.id, name: p.name, start: p.start || '', end: p.end || '', color: p.color || PALETTE[0], page: +p.page > 0 ? Math.round(+p.page) : 0,
  task: p.task || null, zones: Array.isArray(p.zones) ? p.zones : [], devs: Array.isArray(p.devs) ? p.devs : [], nets: Array.isArray(p.nets) ? p.nets : [], engs: Array.isArray(p.engs) ? p.engs : [], cats: Array.isArray(p.cats) ? p.cats : [], els: Array.isArray(p.els) ? p.els.filter(Number.isFinite) : [] });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, phases })); } catch (e) { /* stockage indisponible */ } ctx.onChange && ctx.onChange(); };
const sorted = () => phases.map((p, i) => [p, i]).sort((a, b) => (a[0].start || '9999').localeCompare(b[0].start || '9999') || a[1] - b[1]).map(x => x[0]);

export const getPhases = () => phases.map(norm);
export const exportData = () => phases.length ? { planning: planName || null, list: getPhases() } : null;
export const getCurrent = () => cur;
export const onCurrent = f => listeners.push(f);
/* Les données locales sont gardées par projet (nom de la maquette) : un autre projet n'hérite pas des phases du précédent. */
export function setScope(name, hasProject) {
  const next = BASE + (name ? ':' + name : '');
  if (next !== BASE) { try { if (localStorage.getItem(next) == null && !hasProject && localStorage.getItem(BASE) != null) { localStorage.setItem(next, localStorage.getItem(BASE)); localStorage.removeItem(BASE); } } catch (e) { /* ignoré */ } }
  KEY = next;
}
export function setProject(p) {
  proj = p && Array.isArray(p.list) ? p : null;
  phases = (readLocal() || (proj ? proj.list : []) || []).filter(clean).map(norm);
  if (cur && !phases.some(x => x.id === cur)) cur = null;
  apply(); render();
}

/* Qui est visible dans la phase affichée (zones, déviations de la carte 2D). */
export function visible(id) {
  if (!cur) return true;
  const key = id[0] === 'z' ? 'zones' : id[0] === 'n' ? 'nets' : id[0] === 'e' ? 'engs' : 'devs', owners = phases.filter(p => p[key].includes(id));
  return !owners.length || owners.some(p => p.id === cur);
}
function apply() {
  ctx.applyFilter && ctx.applyFilter();
  if (ctx.setPhase3d) { ctx.setPhase3d(getPhases(), cur); }
  listeners.forEach(f => f(cur));
}
export function setCurrent(id, quiet) {
  cur = id && phases.some(p => p.id === id) ? id : null;
  apply(); if (!quiet) render();
}

/* Ajoute des éléments de la maquette (choisis en 3D) à une phase. */
export function addElement(phaseId, expressID) {
  const p = phases.find(x => x.id === phaseId); if (!p || !Number.isFinite(expressID)) return false;
  phases.forEach(q => { q.els = q.els.filter(e => e !== expressID); });
  p.els.push(expressID); save(); apply(); render(); return true;
}

/* ---------- planning PDF ---------- */
export function setPlanning(blob, name) {
  if (planning) { try { URL.revokeObjectURL(planning); } catch (e) { /* ignoré */ } }
  planning = blob ? URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })) : null;
  planBlob = blob || null; tasks = null; planName = name || ''; render();
}
export function openPlanning(page) {
  if (!planning) return false;
  $('plFrame').src = planning + (page > 0 ? '#page=' + page : '');
  $('plTitle').textContent = planName || 'Planning';
  $('plOpen').href = planning; $('plView').hidden = false; return true;
}
const closePlanning = () => { $('plView').hidden = true; $('plFrame').src = 'about:blank'; };

/* ---------- interface ---------- */
const fmtDate = d => { if (!d) return ''; const [y, m, j] = d.split('-'); return j + '/' + m + '/' + y; };
function render() {
  const ul = $('phList'); if (!ul) return;
  $('phEmpty').hidden = phases.length > 0;
  $('phPlan').innerHTML = planning
    ? `<b>Planning</b> ${esc(planName)} <button type="button" class="link" id="phSee">Voir</button> <button type="button" class="link" id="phImp">Importer les phases du planning</button>`
    : '<b>Planning</b> Aucun PDF trouvé dans le dossier.';
  const sel = $('phCur'); sel.innerHTML = '<option value="">Toutes les phases</option>' + sorted().map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}${p.start ? ' · ' + fmtDate(p.start) : ''}</option>`).join('');
  const zones = ctx.getZones ? ctx.getZones() : [], devs = ctx.getDevs ? ctx.getDevs() : [], nets = ctx.getNets ? ctx.getNets() : [], engs = ctx.getEngins ? ctx.getEngins() : [];
  ul.innerHTML = sorted().map(p => {
    const open = p.id === openId, cats = open && ctx.categories ? ctx.categories() : [];
    return `<li data-id="${p.id}" class="${p.id === cur ? 'on' : ''}"><div class="ch-row"><input type="color" class="ph-col" value="${p.color}" aria-label="Couleur de la phase"><input class="ch-name" value="${esc(p.name)}" aria-label="Nom de la phase" maxlength="40"></div>
      <div class="ch-acts"><label class="dv-w">Du <input type="date" class="ph-d" data-k="start" value="${p.start}"></label><label class="dv-w">au <input type="date" class="ph-d" data-k="end" value="${p.end}"></label></div>
      <div class="ch-acts"><label class="dv-w">Page du planning <input type="number" class="dv-width ph-page" min="0" max="999" value="${p.page || ''}" placeholder="–"></label>${planning ? '<button type="button" class="link" data-a="plan">Voir au planning</button>' : ''}</div>
      <div class="ch-acts"><button type="button" class="link" data-a="cur">${p.id === cur ? 'Afficher toutes' : 'Afficher cette phase'}</button><button type="button" class="link" data-a="open">${open ? 'Replier' : 'Contenu de la phase'}</button><button type="button" class="link danger" data-a="del">Supprimer</button></div>
      ${open ? `<div class="ph-det">
        <b>Installations présentes</b>${zones.length ? zones.map(z => `<label><input type="checkbox" data-k="zones" value="${z.id}"${p.zones.includes(z.id) ? ' checked' : ''}> ${esc(z.name)}</label>`).join('') : '<small>Aucune installation dessinée.</small>'}
        <b>Déviations présentes</b>${devs.length ? devs.map(d => `<label><input type="checkbox" data-k="devs" value="${d.id}"${p.devs.includes(d.id) ? ' checked' : ''}> ${esc(d.name)}</label>`).join('') : '<small>Aucune déviation tracée.</small>'}
        <b>Engins et véhicules présents</b>${engs.length ? engs.map(d => `<label><input type="checkbox" data-k="engs" value="${d.id}"${p.engs.includes(d.id) ? ' checked' : ''}> ${esc(d.name)}</label>`).join('') : '<small>Aucun engin posé (onglet Situations).</small>'}
        <b>Réseaux existants</b>${nets.length ? nets.slice(0, 60).map(d => `<label><input type="checkbox" data-k="nets" value="${d.id}"${p.nets.includes(d.id) ? ' checked' : ''}> ${esc(d.name)}</label>`).join('') + (nets.length > 60 ? `<small>${nets.length - 60} autres réseaux restent visibles dans toutes les phases.</small>` : '') : '<small>Aucun réseau ajouté.</small>'}
        <b>Maquette : construit pendant cette phase</b>${cats.length ? cats.map(c => `<label><input type="checkbox" data-k="cats" value="${esc(c.type)}"${p.cats.includes(c.type) ? ' checked' : ''}> ${esc(c.type.replace(/^Ifc/, ''))} <small>${c.count}</small></label>`).join('') : '<small>Chargez une maquette IFC pour choisir ses éléments.</small>'}
        <small>${p.els.length ? p.els.length + ' élément(s) choisi(s) dans la vue 3D. ' : 'Dans la vue 3D, cliquez un élément pour l’ajouter à une phase. '}${p.els.length ? '<button type="button" class="link" data-a="clr">Vider</button>' : ''}</small></div>` : ''}</li>`;
  }).join('');
}

export function init(c) {
  ctx = c;
  phases = (readLocal() || (proj ? proj.list : []) || []).filter(clean).map(norm);
  $('phAdd').addEventListener('click', () => {
    const n = phases.length + 1, last = sorted().pop(), p = norm({ id: uid(), name: 'Phase ' + n, color: PALETTE[(n - 1) % PALETTE.length], start: '', end: '' });
    if (last && last.end) { const d = new Date(last.end + 'T00:00'); d.setDate(d.getDate() + 1); p.start = d.toISOString().slice(0, 10); }
    phases.push(p); openId = p.id; save(); render();
  });
  $('phCur').addEventListener('change', e => setCurrent(e.target.value || null));
  $('phPlan').addEventListener('click', e => { if (e.target.id === 'phSee') openPlanning(0); else if (e.target.id === 'phImp') openImport(); });
  $('piClose').addEventListener('click', () => { $('piView').hidden = true; });
  $('piView').addEventListener('click', e => { if (e.target.id === 'piView') $('piView').hidden = true; });
  $('piFind').addEventListener('input', drawTasks);
  $('piList').addEventListener('change', e => { const li = e.target.closest('li'); if (li && tasks) { const t = tasks.find(x => x.n === +li.dataset.n); if (t) t.on = e.target.checked; count(); } });
  $('piAll').addEventListener('click', () => { const q = norm2($('piFind').value); tasks.forEach(t => { if (!q || norm2(t.name).includes(q)) t.on = true; }); drawTasks(); });
  $('piNone').addEventListener('click', () => { tasks.forEach(t => { t.on = false; }); drawTasks(); });
  $('piGo').addEventListener('click', doImport);
  $('phPick').addEventListener('change', e => { const f = e.target.files[0]; if (f) { setPlanning(f, f.name); } e.target.value = ''; });
  $('plClose').addEventListener('click', closePlanning);
  $('plView').addEventListener('click', e => { if (e.target.id === 'plView') closePlanning(); });
  const find = e => { const li = e.target.closest('li'); return li ? phases.find(q => q.id === li.dataset.id) : null; };
  $('phList').addEventListener('input', e => { const p = find(e); if (!p) return;
    if (e.target.classList.contains('ch-name')) { p.name = e.target.value.trim() || 'Phase'; save(); $('phCur').querySelectorAll('option').forEach(o => { if (o.value === p.id) o.textContent = p.name; }); }
    else if (e.target.classList.contains('ph-col')) { p.color = e.target.value; save(); if (cur === p.id) apply(); }
    else if (e.target.classList.contains('ph-page')) { p.page = Math.max(0, Math.round(+e.target.value) || 0); save(); } });
  $('phList').addEventListener('change', e => { const p = find(e); if (!p) return;
    if (e.target.classList.contains('ph-d')) { p[e.target.dataset.k] = e.target.value; save(); apply(); render(); }
    else if (e.target.dataset.k) { const k = e.target.dataset.k, v = e.target.value; p[k] = e.target.checked ? [...new Set([...p[k], v])] : p[k].filter(x => x !== v); save(); apply(); } });
  $('phList').addEventListener('click', e => { const p = find(e), a = e.target.dataset.a; if (!p || !a) return;
    if (a === 'cur') setCurrent(p.id === cur ? null : p.id);
    else if (a === 'open') { openId = openId === p.id ? null : p.id; render(); }
    else if (a === 'plan') openPlanning(p.page);
    else if (a === 'clr') { p.els = []; save(); apply(); render(); }
    else if (a === 'del') {
      if (e.target.dataset.sure) { phases = phases.filter(q => q.id !== p.id); if (cur === p.id) cur = null; save(); apply(); render(); }
      else { e.target.dataset.sure = '1'; e.target.textContent = 'Confirmer ?'; setTimeout(() => { if (e.target.isConnected) { delete e.target.dataset.sure; e.target.textContent = 'Supprimer'; } }, 3000); }
    } });
  render();
}
export const refresh = render;

/* ---------- import des phases depuis le planning PDF ---------- */
const norm2 = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fr = d => d ? d.split('-').reverse().join('/') : '';
async function openImport() {
  if (!planBlob) return;
  $('piView').hidden = false; $('piMsg').textContent = 'Lecture du planning…'; $('piList').innerHTML = ''; $('piGo').disabled = true;
  try {
    if (!tasks) {
      const m = await import('./planning.js'), r = await m.readPlanning(planBlob);
      if (!r || !r.tasks.length) { $('piMsg').textContent = 'Ce planning n’a pas pu être lu automatiquement (tableau de tâches non reconnu). Créez les phases à la main : « Ajouter une phase », puis indiquez sa page.'; return; }
      tasks = r.tasks.filter(t => t.name).map(t => ({ ...t, on: /[A-ZÉÈ]{3}/.test(t.name) && t.name === t.name.toUpperCase() }));
      tasks.dated = r.dated; tasks.total = r.total;
    }
    drawTasks();
  } catch (e) { console.warn('planning', e); $('piMsg').textContent = 'Lecture du planning impossible sur cet appareil. Créez les phases à la main.'; }
}
function drawTasks() {
  const q = norm2($('piFind').value), have = new Set(phases.map(p => p.task).filter(Boolean));
  $('piMsg').textContent = `${tasks.length} tâches lues, ${tasks.dated} avec dates. Cochez celles qui deviennent des phases (les titres en majuscules sont déjà cochés).`;
  $('piList').innerHTML = tasks.filter(t => !q || norm2(t.name).includes(q)).map(t => `<li data-n="${t.n}"><label><input type="checkbox"${t.on ? ' checked' : ''}${have.has(t.n) ? ' disabled' : ''}> <b>${t.n}</b> ${esc(t.name)} <small>${t.start ? fr(t.start) + (t.end && t.end !== t.start ? ' → ' + fr(t.end) : '') : 'dates non lues'}${have.has(t.n) ? ' · déjà importée' : ''}</small></label></li>`).join('');
  count();
}
function count() { const n = tasks.filter(t => t.on).length; $('piGo').disabled = !n; $('piGo').textContent = n ? `Créer ${n} phase${n > 1 ? 's' : ''}` : 'Créer les phases'; }
function doImport() {
  const have = new Set(phases.map(p => p.task).filter(Boolean)); let k = 0;
  tasks.filter(t => t.on && !have.has(t.n)).forEach(t => { phases.push(norm({ id: uid(), name: t.name.slice(0, 40), start: t.start, end: t.end, page: 1, task: t.n, color: PALETTE[phases.length % PALETTE.length] })); k++; });
  save(); apply(); render(); $('piView').hidden = true;
  ctx.status && ctx.status(`${k} phase(s) créée(s) depuis le planning. Complétez leur contenu dans « Contenu de la phase ».`, { ms: 6000 });
}
