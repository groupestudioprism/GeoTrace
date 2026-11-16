/* =====================================================================
   REPÉRAGE SUR PHOTO
   ---------------------------------------------------------------------
   Ce fichier permet de dessiner sur une photo : des conduites (lignes),
   des regards (ronds), des accessoires (petits symboles) et des textes.

   Comment lire ce fichier :
   1. Les réglages et les variables sont tout en haut.
   2. Puis les fonctions qui DESSINENT sur la photo.
   3. Puis les fonctions qui réagissent à la souris / au doigt.
   4. Puis la construction de l'écran (les boutons).
   5. Tout en bas : open() et close(), les fonctions que le reste du
      site utilise.

   Important : tous les objets dessinés sont rangés avec les coordonnées
   de la PHOTO (en pixels de la photo), pas celles de l'écran.
   Comme ça, le dessin reste au bon endroit quand on zoome.
   ===================================================================== */


/* ---------- 1. Les réglages ---------- */

// La liste des réseaux : un nom, une couleur, et parfois un style de trait.
export const NETS = [
  { id: 'aep-n', name: 'AEP neuf', col: '#3CA9E8' },
  { id: 'aep-e', name: 'AEP existant', col: '#1F3FC8' },
  { id: 'eu-n', name: 'EU neuf', col: '#F26A1B' },
  { id: 'eu-e', name: 'EU existant', col: '#9A5B0A' },
  { id: 'ep-n', name: 'EP neuf', col: '#35B568' },
  { id: 'ep-e', name: 'EP existant', col: '#1C6B3A' },
  { id: 'ab', name: 'À abandonner', col: '#C2278F', dash: 'dashed' }
];

// Les formes possibles pour un accessoire : [nom technique, nom affiché]
const SHAPES = [
  ['circle', 'Rond'],
  ['diamond', 'Losange'],
  ['triangle', 'Triangle'],
  ['square', 'Carré']
];

// Les diamètres proposés en un clic
const DIAMS = ['Ø110', 'Ø160', 'Ø200', 'Ø250', 'Ø315', 'Ø400', 'Ø500'];


/* ---------- 2. Les variables du module ---------- */
/* Une variable déclarée ici garde sa valeur tant que la page est ouverte. */

let root = null;      // la grande fenêtre du repérage (un <div>)
let canvas = null;    // la zone de dessin (un <canvas>)
let ctx = null;       // le "pinceau" du canvas
let img = null;       // la photo chargée
let photoInfo = null; // les infos données par app.js (nom, sauvegarde...)

// La vue : comment la photo est placée à l'écran
// scale = zoom, x et y = décalage
const view = { scale: 1, x: 0, y: 0 };

let objects = [];      // la liste de tout ce qui est dessiné
let selected = -1;     // numéro de l'objet sélectionné (-1 = aucun)
let tool = 'select';   // l'outil actif : select, line, manhole, acc, text
let draft = null;      // la conduite en cours de tracé
let history = [];      // les anciennes versions (pour "Annuler")
let historyPos = -1;   // où on en est dans l'historique
let drag = null;       // ce qu'on est en train de glisser
let textEditor = null; // la petite zone de saisie d'un texte

// Les choix faits dans le panneau de droite
const settings = { net: 'aep-n', label: '', shape: 'circle', letter: '', size: 1 };

// Les boutons du panneau (remplis dans buildScreen)
const ui = {};

// Pour le zoom au doigt et le déplacement de la photo
const pointers = new Map();
let pinch = null;
let panning = null;
let spaceDown = false;


/* ---------- 3. Petites fonctions utiles ---------- */

// Retrouve la couleur d'un réseau avec son id
function colorOf(netId) {
  for (let i = 0; i < NETS.length; i++) {
    if (NETS[i].id === netId) {
      return NETS[i].col;
    }
  }
  return NETS[0].col;
}

// Retrouve le style de trait (plein ou tirets) d'un réseau
function dashOf(netId) {
  for (let i = 0; i < NETS.length; i++) {
    if (NETS[i].id === netId && NETS[i].dash) {
      return NETS[i].dash;
    }
  }
  return 'solid';
}

// Crée un élément HTML avec une classe et un contenu
function makeElement(tag, className, html) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (html !== undefined) {
    element.innerHTML = html;
  }
  return element;
}

// Protège un texte avant de le mettre dans du HTML
// (sinon un nom contenant < ou > pourrait casser la page)
function protectText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// L'épaisseur de base des traits. Plus la photo est grande, plus c'est épais,
// sinon le dessin serait minuscule sur une photo de 4000 pixels.
function unit() {
  let width = 1400;
  if (img) {
    width = img.naturalWidth;
  }
  return Math.max(1, width / 1400) * settings.size;
}

// Transforme un point de l'écran en point de la photo
function screenToPhoto(screenX, screenY) {
  return {
    x: (screenX - view.x) / view.scale,
    y: (screenY - view.y) / view.scale
  };
}

// Donne la position et la taille de la zone de dessin sur l'écran
function canvasRect() {
  return canvas.getBoundingClientRect();
}


/* ---------- 4. Dessiner ---------- */

// Règle le style du trait : plein, tirets ou pointillés
function setLineStyle(c, kind, width) {
  if (kind === 'dashed') {
    c.setLineDash([width * 2.6, width * 1.6]);
  } else if (kind === 'dotted') {
    c.setLineDash([width * 0.1, width * 1.9]);
  } else {
    c.setLineDash([]);
  }
}

// Écrit un texte avec un contour blanc, pour qu'il se lise sur toutes les photos
function drawTextWithOutline(c, text, x, y, fontSize, color, align) {
  c.font = '600 ' + fontSize + 'px "Public Sans","Segoe UI",system-ui,sans-serif';
  c.textAlign = align || 'left';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = fontSize * 0.3;
  c.strokeStyle = 'rgba(255,255,255,.95)';
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
}

// Prépare le contour d'une forme (rond, losange, triangle ou carré)
function shapePath(c, shape, r) {
  c.beginPath();
  if (shape === 'square') {
    c.rect(-r, -r, 2 * r, 2 * r);
  } else if (shape === 'diamond') {
    c.moveTo(0, -r * 1.25);
    c.lineTo(r * 1.25, 0);
    c.lineTo(0, r * 1.25);
    c.lineTo(-r * 1.25, 0);
    c.closePath();
  } else if (shape === 'triangle') {
    c.moveTo(0, -r * 1.2);
    c.lineTo(r * 1.15, r * 0.9);
    c.lineTo(-r * 1.15, r * 0.9);
    c.closePath();
  } else {
    c.arc(0, 0, r, 0, Math.PI * 2);
  }
}

// Dessine une conduite (une ligne avec plusieurs points)
function drawLine(c, obj, k) {
  if (obj.pts.length < 2) {
    return;
  }
  const color = colorOf(obj.net);
  const width = 4.2 * k;

  // Le trait : d'abord un trait blanc plus large dessous, puis le trait coloré
  c.save();
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(obj.pts[0].x, obj.pts[0].y);
  for (let i = 1; i < obj.pts.length; i++) {
    c.lineTo(obj.pts[i].x, obj.pts[i].y);
  }
  setLineStyle(c, dashOf(obj.net), width + 2 * k);
  c.strokeStyle = 'rgba(255,255,255,.75)';
  c.lineWidth = width + 2 * k;
  c.stroke();
  setLineStyle(c, dashOf(obj.net), width);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
  c.restore();

  // Le texte, posé au milieu de la conduite
  if (obj.label) {
    // 1. On mesure chaque morceau de la ligne et la longueur totale
    let total = 0;
    const lengths = [];
    for (let i = 1; i < obj.pts.length; i++) {
      const dx = obj.pts[i].x - obj.pts[i - 1].x;
      const dy = obj.pts[i].y - obj.pts[i - 1].y;
      const length = Math.hypot(dx, dy);
      lengths.push(length);
      total = total + length;
    }
    // 2. On cherche le morceau qui contient le milieu
    let remaining = total / 2;
    let index = 0;
    while (index < lengths.length - 1 && remaining > lengths[index]) {
      remaining = remaining - lengths[index];
      index++;
    }
    const a = obj.pts[index];
    const b = obj.pts[index + 1];
    let part = 0;
    if (lengths[index] > 0) {
      part = remaining / lengths[index];
    }
    const middleX = a.x + (b.x - a.x) * part;
    const middleY = a.y + (b.y - a.y) * part;
    // 3. L'angle du texte, retourné s'il serait à l'envers
    let angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
      angle = angle + Math.PI;
    }
    c.save();
    c.translate(middleX, middleY);
    c.rotate(angle);
    drawTextWithOutline(c, obj.label, 0, -9 * k, 12.5 * k, color, 'center');
    c.restore();
  }
}

// Dessine un regard (un rond)
function drawManhole(c, obj, k) {
  const color = colorOf(obj.net);
  const radius = 15 * k;
  c.save();
  c.translate(obj.x, obj.y);
  c.beginPath();
  c.arc(0, 0, radius, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.fill();
  c.fillStyle = color + '44';
  c.fill();
  c.lineWidth = 4.4 * k;
  c.strokeStyle = 'rgba(255,255,255,.85)';
  c.stroke();
  c.lineWidth = 2.6 * k;
  c.strokeStyle = color;
  c.stroke();
  c.restore();
  if (obj.label) {
    drawTextWithOutline(c, obj.label, obj.x + radius + 6 * k, obj.y - radius * 0.6, 12.5 * k, color);
  }
}

// Dessine un accessoire (petite forme avec une lettre dedans)
function drawAccessory(c, obj, k) {
  const color = colorOf(obj.net);
  const radius = 9 * k;
  c.save();
  c.translate(obj.x, obj.y);
  shapePath(c, obj.shape, radius);
  c.fillStyle = '#fff';
  c.fill();
  c.lineWidth = 2.6 * k;
  c.strokeStyle = color;
  c.stroke();
  if (obj.letter) {
    c.font = '700 ' + (radius * 1.15) + 'px "Public Sans",system-ui,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(obj.letter, 0, radius * 0.06);
  }
  c.restore();
  if (obj.label) {
    drawTextWithOutline(c, obj.label, obj.x + radius * 1.5 + 5 * k, obj.y - radius * 0.6, 12.5 * k, color);
  }
}

// Dessine un texte dans un cadre blanc
function drawNote(c, obj, k) {
  const color = colorOf(obj.net);
  const fontSize = 15 * k;
  const lines = obj.text.split('\n');
  c.save();
  c.font = '700 ' + fontSize + 'px "Public Sans",system-ui,sans-serif';
  // La largeur du cadre = la ligne la plus longue
  let widest = 0;
  for (let i = 0; i < lines.length; i++) {
    const w = c.measureText(lines[i]).width;
    if (w > widest) {
      widest = w;
    }
  }
  const boxWidth = widest + fontSize * 1.1;
  const boxHeight = lines.length * fontSize * 1.25 + fontSize * 0.6;
  c.fillStyle = 'rgba(255,255,255,.94)';
  c.fillRect(obj.x, obj.y, boxWidth, boxHeight);
  c.fillStyle = color;
  c.fillRect(obj.x, obj.y, fontSize * 0.2, boxHeight);
  c.fillStyle = '#131B24';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    c.fillText(lines[i], obj.x + fontSize * 0.55, obj.y + fontSize * 0.3 + fontSize * 1.25 * (i + 0.5));
  }
  c.restore();
  // On garde la taille du cadre pour pouvoir cliquer dessus plus tard
  obj._w = boxWidth;
  obj._h = boxHeight;
}

// Calcule le rectangle qui entoure un objet (pour le sélectionner)
function boxOf(obj, k) {
  const margin = 8 * k;
  if (obj.type === 'line') {
    let minX = obj.pts[0].x;
    let maxX = obj.pts[0].x;
    let minY = obj.pts[0].y;
    let maxY = obj.pts[0].y;
    for (let i = 1; i < obj.pts.length; i++) {
      if (obj.pts[i].x < minX) { minX = obj.pts[i].x; }
      if (obj.pts[i].x > maxX) { maxX = obj.pts[i].x; }
      if (obj.pts[i].y < minY) { minY = obj.pts[i].y; }
      if (obj.pts[i].y > maxY) { maxY = obj.pts[i].y; }
    }
    return { x: minX - margin, y: minY - margin, w: maxX - minX + margin * 2, h: maxY - minY + margin * 2 };
  }
  if (obj.type === 'text') {
    let w = 80;
    let h = 30;
    if (obj._w) { w = obj._w; }
    if (obj._h) { h = obj._h; }
    return { x: obj.x - 3 * k, y: obj.y - 3 * k, w: w + 6 * k, h: h + 6 * k };
  }
  // regard ou accessoire
  let size = 9;
  if (obj.type === 'manhole') {
    size = 15;
  }
  const r = size * k * 1.4;
  return { x: obj.x - r, y: obj.y - r, w: r * 2, h: r * 2 };
}

// Dessine un objet, quel que soit son type
function drawObject(c, obj, k, isSelected) {
  if (obj.type === 'line') {
    drawLine(c, obj, k);
  } else if (obj.type === 'manhole') {
    drawManhole(c, obj, k);
  } else if (obj.type === 'acc') {
    drawAccessory(c, obj, k);
  } else if (obj.type === 'text') {
    drawNote(c, obj, k);
  }

  // Si l'objet est sélectionné : cadre en pointillés + poignées sur les points
  if (isSelected) {
    c.save();
    c.lineWidth = 1.6 * k;
    c.strokeStyle = '#12b5f0';
    c.fillStyle = '#fff';
    c.setLineDash([5 * k, 3 * k]);
    const box = boxOf(obj, k);
    c.strokeRect(box.x, box.y, box.w, box.h);
    c.setLineDash([]);
    if (obj.type === 'line') {
      for (let i = 0; i < obj.pts.length; i++) {
        c.beginPath();
        c.arc(obj.pts[i].x, obj.pts[i].y, 5.5 * k, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    c.restore();
  }
}

// Dessine tous les objets (et la conduite en cours de tracé)
// withUi = true : on affiche aussi les cadres de sélection (pas pour l'export)
function drawScene(c, k, withUi) {
  for (let i = 0; i < objects.length; i++) {
    drawObject(c, objects[i], k, withUi && i === selected);
  }
  if (withUi && draft && draft.pts.length > 0) {
    const points = draft.pts.slice();
    if (draft.cur) {
      points.push(draft.cur);
    }
    drawLine(c, { type: 'line', net: settings.net, label: '', pts: points }, k);
    c.save();
    c.fillStyle = '#fff';
    c.strokeStyle = colorOf(settings.net);
    c.lineWidth = 2 * k;
    for (let i = 0; i < draft.pts.length; i++) {
      c.beginPath();
      c.arc(draft.pts[i].x, draft.pts[i].y, 4.5 * k, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    c.restore();
  }
}

// Redessine tout l'écran : la photo, puis les objets par-dessus
function render() {
  if (!canvas || !img) {
    return;
  }
  const rect = canvasRect();
  const ratio = window.devicePixelRatio || 1; // pour que ce soit net sur écran Retina
  const wantedWidth = Math.round(rect.width * ratio);
  const wantedHeight = Math.round(rect.height * ratio);
  if (canvas.width !== wantedWidth || canvas.height !== wantedHeight) {
    canvas.width = wantedWidth;
    canvas.height = wantedHeight;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y);
  ctx.drawImage(img, 0, 0);
  drawScene(ctx, unit(), true);
  updateButtons();
}

// Ajuste le zoom pour voir toute la photo
function fitToScreen() {
  const rect = canvasRect();
  if (!img || !rect.width) {
    return;
  }
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;
  view.scale = Math.min(scaleX, scaleY) * 0.98;
  view.x = (rect.width - img.naturalWidth * view.scale) / 2;
  view.y = (rect.height - img.naturalHeight * view.scale) / 2;
  render();
}


/* ---------- 5. L'historique (Annuler / Rétablir) ---------- */

// Transforme la liste d'objets en texte, pour la garder en mémoire.
// Les clés qui commencent par "_" sont des calculs temporaires : on les ignore.
function takeSnapshot() {
  return JSON.stringify(objects, function (key, value) {
    if (key.charAt(0) === '_') {
      return undefined;
    }
    return value;
  });
}

// À appeler après chaque modification : sauvegarde l'état et redessine
function commit() {
  history = history.slice(0, historyPos + 1);
  history.push(takeSnapshot());
  historyPos = history.length - 1;
  saveNow();
  render();
}

// Annuler (direction = -1) ou rétablir (direction = +1)
function undo(direction) {
  const newPos = historyPos + direction;
  if (newPos < 0 || newPos >= history.length) {
    return;
  }
  historyPos = newPos;
  objects = JSON.parse(history[historyPos]);
  selected = -1;
  draft = null;
  saveNow();
  render();
  syncPanel();
}

// Envoie le repérage à app.js, qui le range dans le navigateur
function saveNow() {
  if (photoInfo && photoInfo.onSave) {
    photoInfo.onSave(JSON.parse(takeSnapshot()));
  }
}


/* ---------- 6. Trouver quel objet on touche ---------- */

// Distance entre un point p et un segment de droite a-b
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  }
  if (t < 0) { t = 0; }
  if (t > 1) { t = 1; }
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Renvoie le numéro de l'objet touché au point p (ou -1 s'il n'y en a pas)
// On regarde en partant du dernier dessiné, car il est au-dessus.
function findObjectAt(p) {
  const k = unit();
  const tolerance = 9 / view.scale + 3 * k;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type === 'line') {
      for (let j = 1; j < obj.pts.length; j++) {
        if (distanceToSegment(p, obj.pts[j - 1], obj.pts[j]) < tolerance) {
          return i;
        }
      }
    } else {
      const box = boxOf(obj, k);
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
        return i;
      }
    }
  }
  return -1;
}

// Renvoie le numéro du point d'une conduite touché (ou -1)
function findVertexAt(obj, p) {
  const tolerance = 11 / view.scale;
  for (let i = 0; i < obj.pts.length; i++) {
    if (Math.hypot(obj.pts[i].x - p.x, obj.pts[i].y - p.y) < tolerance) {
      return i;
    }
  }
  return -1;
}


/* ---------- 7. La souris et le doigt ---------- */

// Position d'un événement, dans les coordonnées de la photo
function eventToPhoto(event) {
  const rect = canvasRect();
  return screenToPhoto(event.clientX - rect.left, event.clientY - rect.top);
}

// Quand on appuie (souris ou doigt)
function onPointerDown(event) {
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, event);

  // Deux doigts : on prépare le zoom par pincement
  if (pointers.size === 2) {
    const list = Array.from(pointers.values());
    const distance = Math.hypot(list[0].clientX - list[1].clientX, list[0].clientY - list[1].clientY);
    pinch = { distance: distance, scale: view.scale };
    drag = null;
    panning = null;
    return;
  }

  // Si on écrivait un texte, on le valide d'abord
  if (textEditor) {
    closeTextEditor(true);
  }

  const p = eventToPhoto(event);

  // Bouton du milieu, clic droit ou barre espace : on déplace la photo
  if (event.button === 1 || event.button === 2 || spaceDown) {
    panning = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
    canvas.classList.add('pan');
    return;
  }

  if (tool === 'select') {
    // D'abord : est-ce qu'on touche un point de la conduite sélectionnée ?
    if (selected >= 0 && objects[selected].type === 'line') {
      const vertex = findVertexAt(objects[selected], p);
      if (vertex >= 0) {
        drag = { kind: 'vertex', index: vertex, moved: false };
        return;
      }
    }
    // Sinon : est-ce qu'on touche un objet ?
    const found = findObjectAt(p);
    if (found >= 0) {
      selected = found;
      drag = { kind: 'object', last: p, moved: false };
      syncPanel();
      render();
    } else {
      // Rien touché : on désélectionne et on déplace la photo
      selected = -1;
      panning = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
      canvas.classList.add('pan');
      syncPanel();
      render();
    }
  } else if (tool === 'line') {
    if (!draft) {
      draft = { pts: [] };
    }
    // On n'ajoute pas deux points au même endroit (utile pour le double-clic)
    const last = draft.pts[draft.pts.length - 1];
    let tooClose = false;
    if (last && Math.hypot(last.x - p.x, last.y - p.y) <= 3 / view.scale) {
      tooClose = true;
    }
    if (!tooClose) {
      draft.pts.push(p);
    }
    render();
  } else if (tool === 'manhole') {
    objects.push({ type: 'manhole', x: p.x, y: p.y, net: settings.net, label: settings.label });
    selected = objects.length - 1;
    commit();
    syncPanel();
  } else if (tool === 'acc') {
    objects.push({ type: 'acc', x: p.x, y: p.y, net: settings.net, shape: settings.shape, letter: settings.letter, label: settings.label });
    selected = objects.length - 1;
    commit();
    syncPanel();
  } else if (tool === 'text') {
    openTextEditor(p, event);
  }
}

// Quand on bouge (souris ou doigt)
function onPointerMove(event) {
  if (pointers.has(event.pointerId)) {
    pointers.set(event.pointerId, event);
  }

  // Zoom avec deux doigts
  if (pinch && pointers.size === 2) {
    const list = Array.from(pointers.values());
    const distance = Math.hypot(list[0].clientX - list[1].clientX, list[0].clientY - list[1].clientY);
    const rect = canvasRect();
    const centerX = (list[0].clientX + list[1].clientX) / 2 - rect.left;
    const centerY = (list[0].clientY + list[1].clientY) / 2 - rect.top;
    zoomAt(centerX, centerY, pinch.scale * distance / pinch.distance);
    return;
  }

  // Déplacement de la photo
  if (panning) {
    view.x = panning.startX + event.clientX - panning.x;
    view.y = panning.startY + event.clientY - panning.y;
    render();
    return;
  }

  const p = eventToPhoto(event);

  // Déplacement d'un objet ou d'un point
  if (drag && selected >= 0) {
    const obj = objects[selected];
    if (drag.kind === 'vertex') {
      obj.pts[drag.index] = p;
    } else {
      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      if (obj.type === 'line') {
        for (let i = 0; i < obj.pts.length; i++) {
          obj.pts[i].x = obj.pts[i].x + dx;
          obj.pts[i].y = obj.pts[i].y + dy;
        }
      } else {
        obj.x = obj.x + dx;
        obj.y = obj.y + dy;
      }
      drag.last = p;
    }
    drag.moved = true;
    render();
    return;
  }

  // Pendant le tracé d'une conduite : un trait suit la souris
  if (tool === 'line' && draft) {
    draft.cur = p;
    render();
  }
}

// Quand on relâche
function onPointerUp(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) {
    pinch = null;
  }
  if (panning) {
    panning = null;
    canvas.classList.remove('pan');
  }
  if (drag) {
    if (drag.moved) {
      commit(); // on n'enregistre que si on a vraiment déplacé quelque chose
    }
    drag = null;
  }
}

// Double-clic : termine la conduite
function onDoubleClick(event) {
  if (tool === 'line') {
    event.preventDefault();
    finishLine();
  }
}

// Termine la conduite en cours (il faut au moins 2 points)
function finishLine() {
  if (!draft) {
    return;
  }
  const points = draft.pts.slice();
  draft = null;
  if (points.length >= 2) {
    objects.push({ type: 'line', net: settings.net, label: settings.label, pts: points });
    selected = objects.length - 1;
    commit();
    syncPanel();
  } else {
    render();
  }
}

// Zoom autour d'un point de l'écran
function zoomAt(screenX, screenY, newScale) {
  if (newScale < 0.05) { newScale = 0.05; }
  if (newScale > 20) { newScale = 20; }
  const factor = newScale / view.scale;
  view.x = screenX - (screenX - view.x) * factor;
  view.y = screenY - (screenY - view.y) * factor;
  view.scale = newScale;
  render();
}

// Molette de la souris : zoom
function onWheel(event) {
  event.preventDefault();
  const rect = canvasRect();
  zoomAt(event.clientX - rect.left, event.clientY - rect.top, view.scale * Math.exp(-event.deltaY * 0.0016));
}


/* ---------- 8. Écrire un texte sur la photo ---------- */

// Ouvre une petite zone de saisie à l'endroit touché
function openTextEditor(p, event) {
  const rect = canvasRect();
  const box = makeElement('textarea', 'rp-ted');
  box.rows = 2;
  box.placeholder = 'Votre texte, Entrée pour valider';
  box.style.left = Math.min(rect.width - 190, event.clientX - rect.left) + 'px';
  box.style.top = Math.min(rect.height - 70, event.clientY - rect.top) + 'px';
  canvas.parentNode.appendChild(box);
  textEditor = { box: box, p: p };

  box.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      closeTextEditor(true);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeTextEditor(false);
    }
  });
  setTimeout(function () { box.focus(); }, 0);
}

// Ferme la zone de saisie. keep = true : on garde le texte écrit.
function closeTextEditor(keep) {
  if (!textEditor) {
    return;
  }
  const box = textEditor.box;
  const p = textEditor.p;
  textEditor = null;
  const text = box.value.trim();
  box.remove();
  if (keep && text) {
    objects.push({ type: 'text', x: p.x, y: p.y, net: settings.net, text: text });
    selected = objects.length - 1;
    commit();
    syncPanel();
  }
}


/* ---------- 9. Le panneau de droite ---------- */

// Met le panneau à jour selon l'objet sélectionné et l'outil
function syncPanel() {
  let obj = null;
  if (selected >= 0) {
    obj = objects[selected];
  }

  // Si un objet est sélectionné, le panneau montre ses valeurs
  if (obj) {
    settings.net = obj.net;
    if (obj.type !== 'text') {
      settings.label = obj.label || '';
    }
    if (obj.type === 'acc') {
      settings.shape = obj.shape;
      settings.letter = obj.letter || '';
    }
  }

  if (obj && obj.type === 'text') {
    ui.label.value = obj.text;
  } else if (obj) {
    ui.label.value = obj.label || '';
  } else {
    ui.label.value = settings.label;
  }
  ui.letter.value = settings.letter || '';

  // Met en évidence le réseau et la forme choisis
  const netButtons = ui.nets.querySelectorAll('button');
  for (let i = 0; i < netButtons.length; i++) {
    netButtons[i].setAttribute('aria-pressed', String(netButtons[i].dataset.net === settings.net));
  }
  const shapeButtons = ui.shapes.querySelectorAll('button');
  for (let i = 0; i < shapeButtons.length; i++) {
    shapeButtons[i].setAttribute('aria-pressed', String(shapeButtons[i].dataset.shape === settings.shape));
  }

  // Les diamètres ne servent que pour les conduites, la forme que pour les accessoires
  ui.diams.hidden = !(tool === 'line' || (obj && obj.type === 'line'));
  ui.accRow.hidden = !(tool === 'acc' || (obj && obj.type === 'acc'));
  render();
}

// Active ou désactive les boutons, et change le message d'aide
function updateButtons() {
  ui.undo.disabled = historyPos <= 0;
  ui.redo.disabled = historyPos >= history.length - 1;
  ui.del.disabled = selected < 0;
  ui.finish.hidden = !(draft && draft.pts.length >= 2);

  const toolButtons = ui.tools.querySelectorAll('button');
  for (let i = 0; i < toolButtons.length; i++) {
    toolButtons[i].setAttribute('aria-pressed', String(toolButtons[i].dataset.tool === tool));
  }

  let message = '';
  if (tool === 'select') {
    if (selected >= 0) {
      message = 'Glissez pour déplacer, tirez une poignée pour modifier le tracé.';
    } else {
      message = 'Touchez un objet pour le modifier. Glissez le fond pour déplacer la photo.';
    }
  } else if (tool === 'line') {
    if (draft) {
      message = 'Touchez pour ajouter un point. Double-touchez ou « Terminer » pour finir.';
    } else {
      message = 'Touchez pour poser le premier point de la conduite.';
    }
  } else if (tool === 'manhole') {
    message = 'Touchez pour poser un regard.';
  } else if (tool === 'acc') {
    message = 'Touchez pour poser un accessoire.';
  } else if (tool === 'text') {
    message = 'Touchez où placer le texte.';
  }
  ui.hint.textContent = message;
}

// Change d'outil
function setTool(newTool) {
  if (textEditor) {
    closeTextEditor(false);
  }
  if (draft && newTool !== 'line') {
    finishLine();
  }
  tool = newTool;
  if (newTool !== 'select') {
    selected = -1;
  }
  canvas.dataset.tool = newTool;
  syncPanel();
}

// Applique un changement à l'objet sélectionné, puis enregistre
function changeSelected(change) {
  if (selected < 0) {
    return;
  }
  change(objects[selected]);
  commit();
}

// Enregistre la photo avec le dessin dessus, au format PNG
function exportPng() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = img.naturalWidth;
  exportCanvas.height = img.naturalHeight;
  const exportCtx = exportCanvas.getContext('2d');
  exportCtx.drawImage(img, 0, 0);
  drawScene(exportCtx, unit(), false);
  exportCanvas.toBlob(function (blob) {
    if (!blob) {
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (photoInfo.name || 'photo').replace(/\.[^.]+$/, '') + '-reperage.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
  }, 'image/png');
}


/* ---------- 10. Construire l'écran ---------- */
/* Cette fonction n'est appelée qu'une seule fois, la première fois qu'on ouvre le repérage. */

function buildScreen() {
  root = makeElement('div');
  root.id = 'rpView';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Repérage sur la photo');
  root.hidden = true;

  // Le HTML de toute la fenêtre
  root.innerHTML =
    '<div class="rp-bar">' +
      '<div class="v-title"><b id="rpName"></b><small>Repérage de réseaux</small></div>' +
      '<span class="rp-tools" id="rpTools" role="toolbar" aria-label="Outils">' +
        '<button type="button" data-tool="select" title="Sélectionner et déplacer">Sélection</button>' +
        '<button type="button" data-tool="line" title="Dessiner une conduite">Conduite</button>' +
        '<button type="button" data-tool="manhole" title="Poser un regard">Regard</button>' +
        '<button type="button" data-tool="acc" title="Poser un accessoire">Accessoire</button>' +
        '<button type="button" data-tool="text" title="Ajouter un texte">Texte</button>' +
      '</span>' +
      '<span class="rp-act">' +
        '<button class="vb wide" id="rpUndo" type="button" title="Annuler (Ctrl+Z)">Annuler</button>' +
        '<button class="vb wide" id="rpRedo" type="button" title="Rétablir (Ctrl+Y)">Rétablir</button>' +
        '<button class="vb wide" id="rpFit" type="button">Ajuster</button>' +
        '<button class="vb wide" id="rpPng" type="button" title="Photo avec le repérage dessiné dessus">Exporter l’image</button>' +
        '<button class="vb" id="rpClose" type="button" aria-label="Terminer">✕</button>' +
      '</span>' +
    '</div>' +
    '<div class="rp-body">' +
      '<div class="rp-stage"><canvas id="rpCv"></canvas><span class="rp-msg" id="rpMsg">Chargement…</span></div>' +
      '<aside class="rp-side">' +
        '<div class="rp-grp"><h4>Réseau</h4><div id="rpNets" class="rp-nets"></div></div>' +
        '<div class="rp-grp"><h4>Texte affiché</h4>' +
          '<input id="rpLabel" type="text" maxlength="80" placeholder="Ex. Ø200 PP SN16" autocomplete="off" aria-label="Texte affiché sur l’objet">' +
          '<div id="rpDiams" class="rp-chips"></div></div>' +
        '<div class="rp-grp" id="rpAccRow"><h4>Accessoire</h4><div id="rpShapes" class="rp-chips"></div>' +
          '<input id="rpLetter" type="text" maxlength="3" placeholder="Lettre (V, C, T…)" aria-label="Lettre dans l’accessoire"></div>' +
        '<div class="rp-grp"><h4>Taille des traits</h4>' +
          '<input id="rpSize" type="range" min="0.6" max="2.4" step="0.1" value="1" aria-label="Taille des traits et des textes"></div>' +
        '<div class="rp-grp rp-end">' +
          '<button class="btn small" id="rpFinish" type="button" hidden>Terminer la conduite</button>' +
          '<button class="btn small danger" id="rpDel" type="button">Supprimer</button>' +
          '<button class="btn small" id="rpClear" type="button">Tout effacer</button></div>' +
        '<p class="hint" id="rpHint"></p>' +
      '</aside>' +
    '</div>';
  document.body.appendChild(root);

  // On retrouve les éléments qu'on vient de créer pour pouvoir les utiliser
  ui.tools = root.querySelector('#rpTools');
  ui.nets = root.querySelector('#rpNets');
  ui.label = root.querySelector('#rpLabel');
  ui.letter = root.querySelector('#rpLetter');
  ui.diams = root.querySelector('#rpDiams');
  ui.shapes = root.querySelector('#rpShapes');
  ui.accRow = root.querySelector('#rpAccRow');
  ui.undo = root.querySelector('#rpUndo');
  ui.redo = root.querySelector('#rpRedo');
  ui.del = root.querySelector('#rpDel');
  ui.finish = root.querySelector('#rpFinish');
  ui.hint = root.querySelector('#rpHint');
  canvas = root.querySelector('#rpCv');
  ctx = canvas.getContext('2d');

  // Les boutons de réseaux, de diamètres et de formes sont créés avec une boucle
  for (let i = 0; i < NETS.length; i++) {
    const button = makeElement('button', 'rp-net', '<i style="background:' + NETS[i].col + '"></i>' + protectText(NETS[i].name));
    button.type = 'button';
    button.dataset.net = NETS[i].id;
    ui.nets.appendChild(button);
  }
  for (let i = 0; i < DIAMS.length; i++) {
    const button = makeElement('button', 'chip', DIAMS[i]);
    button.type = 'button';
    button.dataset.d = DIAMS[i];
    ui.diams.appendChild(button);
  }
  for (let i = 0; i < SHAPES.length; i++) {
    const button = makeElement('button', 'chip', SHAPES[i][1]);
    button.type = 'button';
    button.dataset.shape = SHAPES[i][0];
    ui.shapes.appendChild(button);
  }

  // Clic sur un outil
  ui.tools.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (button) {
      setTool(button.dataset.tool);
    }
  });

  // Clic sur un réseau
  ui.nets.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }
    settings.net = button.dataset.net;
    changeSelected(function (obj) { obj.net = settings.net; });
    syncPanel();
  });

  // Clic sur un diamètre
  ui.diams.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }
    settings.label = button.dataset.d;
    changeSelected(function (obj) {
      if (obj.type === 'line') {
        obj.label = settings.label;
      }
    });
    syncPanel();
  });

  // Clic sur une forme
  ui.shapes.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }
    settings.shape = button.dataset.shape;
    changeSelected(function (obj) {
      if (obj.type === 'acc') {
        obj.shape = settings.shape;
      }
    });
    syncPanel();
  });

  // Quand on écrit dans la case "Texte affiché"
  ui.label.addEventListener('input', function () {
    settings.label = ui.label.value;
    if (selected >= 0) {
      const obj = objects[selected];
      if (obj.type === 'text') {
        obj.text = ui.label.value;
      } else {
        obj.label = ui.label.value;
      }
      render();
    }
  });
  ui.label.addEventListener('change', function () {
    if (selected >= 0) {
      commit();
    }
  });

  // Quand on écrit la lettre de l'accessoire
  ui.letter.addEventListener('input', function () {
    settings.letter = ui.letter.value.toUpperCase();
    if (selected >= 0 && objects[selected].type === 'acc') {
      objects[selected].letter = settings.letter;
      render();
    }
  });
  ui.letter.addEventListener('change', function () {
    if (selected >= 0) {
      commit();
    }
  });

  // Le curseur de taille
  root.querySelector('#rpSize').addEventListener('input', function (event) {
    settings.size = Number(event.target.value);
    render();
  });

  // Supprimer l'objet sélectionné
  ui.del.addEventListener('click', function () {
    if (selected >= 0) {
      objects.splice(selected, 1);
      selected = -1;
      commit();
      syncPanel();
    }
  });

  ui.finish.addEventListener('click', finishLine);

  // Tout effacer (après confirmation)
  root.querySelector('#rpClear').addEventListener('click', function () {
    if (objects.length > 0 && confirm('Effacer tout le repérage de cette photo ?')) {
      objects = [];
      selected = -1;
      draft = null;
      commit();
      syncPanel();
    }
  });

  ui.undo.addEventListener('click', function () { undo(-1); });
  ui.redo.addEventListener('click', function () { undo(1); });
  root.querySelector('#rpFit').addEventListener('click', fitToScreen);
  root.querySelector('#rpPng').addEventListener('click', exportPng);
  root.querySelector('#rpClose').addEventListener('click', close);

  // Les événements de la souris et du doigt sur la zone de dessin
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // Empêche le navigateur de retirer le focus du champ de texte quand on clique
  canvas.addEventListener('mousedown', function (event) { event.preventDefault(); });
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });

  // Si la fenêtre change de taille, on réajuste la photo
  window.addEventListener('resize', function () {
    if (!root.hidden) {
      fitToScreen();
    }
  });

  // Barre d'espace : déplacer la photo
  window.addEventListener('keyup', function (event) {
    if (event.code === 'Space') {
      spaceDown = false;
    }
  });

  // Raccourcis clavier
  window.addEventListener('keydown', function (event) {
    if (root.hidden) {
      return;
    }
    const tag = event.target.tagName || '';
    const isTyping = (tag === 'INPUT' || tag === 'TEXTAREA');

    if (event.code === 'Space' && !isTyping) {
      spaceDown = true;
      event.preventDefault();
    }
    if (isTyping) {
      return; // quand on écrit, les raccourcis ne doivent pas agir
    }

    const key = event.key.toLowerCase();
    const withCtrl = event.ctrlKey || event.metaKey;
    if (withCtrl && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        undo(1);
      } else {
        undo(-1);
      }
    } else if (withCtrl && key === 'y') {
      event.preventDefault();
      undo(1);
    } else if (event.key === 'Enter' && draft) {
      finishLine();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      if (draft) {
        draft = null;
        render();
      } else if (tool !== 'select') {
        setTool('select');
      } else {
        close();
      }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected >= 0) {
      event.preventDefault();
      ui.del.click();
    }
  }, true);
}


/* ---------- 11. Les fonctions utilisées par le reste du site ---------- */

// Les repérages enregistrés avec la toute première version (1.17.0) utilisaient
// des types abrégés : l = ligne, m = regard, a = accessoire, t = texte.
// Cette fonction les convertit pour qu'on puisse toujours les ouvrir.
function convertOldObjects(list) {
  const names = { l: 'line', m: 'manhole', a: 'acc', t: 'text' };
  for (let i = 0; i < list.length; i++) {
    if (list[i].t && !list[i].type) {
      list[i].type = names[list[i].t];
      delete list[i].t;
    }
  }
  return list;
}

// Ouvre le repérage pour une photo.
// options = { name, src, data, onSave, onClose }
//   name   : le nom de la photo
//   src    : l'adresse de l'image à afficher
//   data   : le repérage déjà enregistré (ou rien)
//   onSave : fonction appelée à chaque modification
//   onClose: fonction appelée à la fermeture
export function open(options) {
  if (!root) {
    buildScreen();
  }
  photoInfo = options;

  // On repart de zéro, avec le repérage enregistré s'il existe
  objects = [];
  if (Array.isArray(options.data)) {
    objects = convertOldObjects(JSON.parse(JSON.stringify(options.data)));
  }
  selected = -1;
  draft = null;
  history = [takeSnapshot()];
  historyPos = 0;
  tool = 'select';
  canvas.dataset.tool = 'select';

  root.querySelector('#rpName').textContent = options.name || 'Photo';
  root.hidden = false;

  const message = root.querySelector('#rpMsg');
  message.hidden = false;
  message.textContent = 'Chargement…';
  img = null;

  // On charge la photo, puis on l'affiche quand elle est prête
  const picture = new Image();
  picture.onload = function () {
    img = picture;
    message.hidden = true;
    fitToScreen();
    syncPanel();
  };
  picture.onerror = function () {
    message.textContent = 'Cette photo ne peut pas être repérée dans le navigateur.';
  };
  picture.src = options.src;

  syncPanel();
  root.querySelector('#rpClose').focus();
}

// Ferme le repérage
export function close() {
  if (!root || root.hidden) {
    return;
  }
  if (textEditor) {
    closeTextEditor(true);
  }
  if (draft) {
    finishLine();
  }
  root.hidden = true;
  img = null;
  const whenClosed = photoInfo && photoInfo.onClose;
  photoInfo = null;
  if (whenClosed) {
    whenClosed();
  }
}

// Dit si le repérage est ouvert (utilisé par la visionneuse pour la touche Échap)
export function isOpen() {
  return !!root && !root.hidden;
}
