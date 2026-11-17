/* Repérage de réseaux sur photos : l'outil complet (photos + signalisation), intégré à GeoTrace.
   Il s'ouvre en plein écran par-dessus la carte, reçoit les photos affichées et suit le thème. */
let wrap = null, frame = null, ready = false, ctx = null;
const sent = new Set();

function build() {
  wrap = document.createElement('div'); wrap.id = 'rpView'; wrap.hidden = true;
  wrap.innerHTML = '<div class="rp-bar"><button type="button" class="btn small" id="rpBack">← Retour à GeoTrace</button><b>Repérage des réseaux sur photos</b><span class="rp-sp"></span><button type="button" class="btn small" id="rpSend" title="Envoyer à l’outil les photos actuellement affichées dans GeoTrace">Envoyer les photos de la carte</button></div>';
  frame = document.createElement('iframe'); frame.title = 'Repérage de réseaux sur photos'; frame.className = 'rp-frame';
  wrap.append(frame); document.body.append(wrap);
  wrap.querySelector('#rpBack').addEventListener('click', close);
  wrap.querySelector('#rpSend').addEventListener('click', () => sendPhotos(true));
  addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.type === 'gt-ready' && e.source === frame.contentWindow) { ready = true; sendTheme(); sendPhotos(false); } });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.hidden && document.activeElement === document.body) close(); });
}
function sendTheme() { if (ready) frame.contentWindow.postMessage({ type: 'gt-theme', theme: document.documentElement.dataset.theme || 'light' }, location.origin); }
async function sendPhotos(manual) {
  if (!ready || !ctx) return;
  const list = (ctx.photos() || []).filter(p => !p.demo), files = [];
  for (const p of list) {
    const k = p.kind === 'remote' ? 'r:' + p.path : 'l:' + p.name + '|' + (p.blob ? p.blob.size : 0);
    if (sent.has(k) && !manual) continue;
    let blob = p.blob;
    if (!blob && p.kind === 'remote' && p.url) { try { const r = await fetch(p.url); if (r.ok) blob = await r.blob(); } catch (e) { /* photo ignorée */ } }
    if (!blob) continue;
    sent.add(k); files.push(new File([blob], p.name, { type: blob.type || 'image/jpeg' }));
  }
  if (files.length) frame.contentWindow.postMessage({ type: 'gt-photos', files }, location.origin);
}
export function open(c) {
  ctx = c; if (!wrap) build();
  wrap.hidden = false; document.body.classList.add('rp-open');
  if (!frame.src) frame.src = 'repere-app.html'; else { sendTheme(); sendPhotos(false); }
}
export function close() { if (wrap) wrap.hidden = true; document.body.classList.remove('rp-open'); }
