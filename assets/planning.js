/* GeoTrace – lecture d'un planning PDF (diagramme de Gantt exporté de MS Project, Excel, etc.).
   Lit le tableau des tâches (n°, nom, durée, dates) et, quand les dates ne sont pas écrites, les déduit de la position des barres
   sur l'échelle des semaines. Tout se fait dans le navigateur ; si le planning est présenté autrement, la liste peut rester incomplète. */
const MOIS = { janv: 1, janvier: 1, jan: 1, january: 1, févr: 2, fevr: 2, février: 2, fevrier: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3, avr: 4, avril: 4, apr: 4, april: 4, mai: 5, may: 5, juin: 6, jun: 6, june: 6, juil: 7, juillet: 7, jul: 7, july: 7, août: 8, aout: 8, aug: 8, august: 8, sept: 9, septembre: 9, sep: 9, september: 9, oct: 10, octobre: 10, october: 10, nov: 11, novembre: 11, déc: 12, dec: 12, décembre: 12, decembre: 12, december: 12 };
const iso = d => d.toISOString().slice(0, 10);
const utc = (y, m, j) => new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, j));
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function parseDate(t) {
  let m = t.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if (m) return utc(+m[3], +m[2], +m[1]);
  m = t.match(/(\d{1,2})\s+([A-Za-zéèûôîàç]+)\.?\s+(\d{2,4})/); if (m && MOIS[m[2].toLowerCase()]) return utc(+m[3], MOIS[m[2].toLowerCase()], +m[1]);
  return null;
}

let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

/* Renvoie { tasks:[{ n, name, dur, start, end }], dated, total } ou null si aucun tableau de tâches n'est reconnu. */
export async function readPlanning(blob) {
  const P = await lib();
  const pdf = await P.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 }), sc = Math.min(1, 4500 / Math.max(base.width, base.height)) || 1, vp = page.getViewport({ scale: sc });
  const tc = await page.getTextContent();
  const it = tc.items.filter(i => i.str && i.str.trim()).map(i => { const [px, py] = vp.convertToViewportPoint(i.transform[4], i.transform[5]); return { s: i.str.trim(), x: px, y: py, w: i.width * sc, h: Math.abs(i.transform[3]) * sc || 8 }; });
  const find = re => it.find(i => re.test(i.s));
  const hN = find(/^N°$/), hD = find(/^Dur[ée]e$/i), hS = find(/^D[ée]but$/i), hE = find(/^Fin$/i), hNom = find(/^Nom/i);
  if (!hN || !hD || !hNom) return null;
  const hy = hN.y, rows = it.filter(i => Math.abs(i.x - hN.x) < 14 && /^\d{1,4}$/.test(i.s) && i.y > hy + 4).sort((a, b) => a.y - b.y);
  if (rows.length < 2) return null;
  const xS = hS ? hS.x : hD.x + 60, xE = hE ? hE.x : xS + 60;
  const rh = rows.length > 1 ? med(rows.slice(1).map((r, i) => r.y - rows[i].y).filter(d => d > 0)) : 30;
  const own = new Map(rows.map(r => [r, []]));
  it.forEach(i => { if (i.y < hy + 4 || i.x > xE + 90) return; let best = null, bd = 1e9; rows.forEach(r => { const d = Math.abs(i.y - r.y); if (d < bd) { bd = d; best = r; } }); if (best && bd <= rh * .62) own.get(best).push(i); });
  const tasks = rows.map(r => {
    const line = own.get(r).sort((a, b) => Math.round(a.y / 3) - Math.round(b.y / 3) || a.x - b.x);
    const name = line.filter(i => i.x > hNom.x - 4 && i.x < hD.x - 3).map(i => i.s).join(' ');
    const dur = line.filter(i => i.x >= hD.x - 6 && i.x < xS - 3).map(i => i.s).join(' ');
    const ds = line.filter(i => i.x >= xS - 6 && i.x < xE - 3).map(i => i.s).join(' '), de = line.filter(i => i.x >= xE - 6 && i.x < xE + 90).map(i => i.s).join(' ');
    return { n: +r.s, name, dur, start: (parseDate(ds) || null), end: (parseDate(de) || null), y: r.y, h: r.h };
  });
  let dated = tasks.filter(t => t.start && t.end).length;
  // dates déduites de la position des barres si le tableau ne les écrit pas en entier
  if (dated < tasks.length / 2) {
    const labels = it.filter(i => i.x > xE + 40 && Math.abs(i.y - hy) < 40).map(i => ({ d: parseDate(i.s), x: i.x })).filter(l => l.d).sort((a, b) => a.x - b.x);
    if (labels.length >= 3) {
      const dd = []; for (let i = 1; i < labels.length; i++) dd.push((labels[i].x - labels[i - 1].x) / ((labels[i].d - labels[i - 1].d) / 864e5));
      const dayW = med(dd.filter(v => v > 0.5)), canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport: vp }).promise;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }), W = canvas.width;
      // lundi de la première semaine : fin de la dernière colonne grise (week-end) à gauche de l'étiquette
      const lastY = tasks[tasks.length - 1].y + 14, strip = ctx.getImageData(0, Math.min(canvas.height - 1, Math.round(lastY)), W, 1).data;
      const grey = x => { const r = strip[x * 4], g = strip[x * 4 + 1], b = strip[x * 4 + 2]; return Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r > 150 && r < 225; };
      let mon = labels[0].x - 2;
      for (let x = Math.round(labels[0].x) + 2; x > Math.round(labels[0].x - dayW * 7); x--) { if (grey(x) && !grey(x + 1)) { mon = x + 1; break; } }
      const dayOf = x => Math.floor((x - mon) / dayW + 1e-6), d0 = labels[0].d;
      const x0 = Math.round(labels[0].x - 4);
      tasks.forEach(t => {
        if (t.start && t.end) return;
        const rows3 = [-2, 0, 2].map(o => ctx.getImageData(0, Math.max(0, Math.min(canvas.height - 1, Math.round(t.y - t.h * .3 + o))), W, 1).data);
        const bar = (px, x) => { const r = px[x * 4], g = px[x * 4 + 1], b = px[x * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx - mn > 35) || (mx < 90); };
        const minRun = Math.max(5, dayW * .8); let first = null, last = null, run = 0;
        for (let x = x0; x < W; x++) {
          if (rows3.every(p => bar(p, x))) run++; else { if (run >= minRun) { if (first == null) first = x - run; last = x; } run = 0; }
        }
        if (run >= minRun) { if (first == null) first = W - run; last = W; }
        if (first != null) { t.start = addDays(d0, dayOf(first + 1)); t.end = addDays(d0, Math.max(dayOf(first + 1), dayOf(last - 1))); }
      });
      dated = tasks.filter(t => t.start && t.end).length;
    }
  }
  return { page: 1, total: tasks.length, dated, tasks: tasks.map(t => ({ n: t.n, name: t.name, dur: t.dur, start: t.start ? iso(t.start) : '', end: t.end ? iso(t.end) : '' })) };
}
