/* =====================================================================
   REPÉRAGE : LE MOTEUR
   ---------------------------------------------------------------------
   Ce fichier ne touche ni à l'écran ni à la souris. Il contient :
     1. les réglages et les préréglages (conduites, regards, accessoires)
     2. la géométrie (distances, décalages de tracé...)
     3. les liens entre objets (une conduite accrochée à un regard)
     4. le dessin de tous les objets sur un canvas
     5. les automatismes : branchement, tracé parallèle, raccords,
        montages d'accessoires, croisements, légende
     6. la conversion vers la 3D

   Un "repérage" est une liste d'objets rangés dans ph.objects, avec
   les coordonnées de la PHOTO (en pixels). ph = { w, h, objects }.
   L'unité u = largeur de la photo / 1000 : toutes les tailles s'y
   rapportent, pour que le dessin ait le même aspect sur toute photo.
   ===================================================================== */


import { SYMLIB } from './symlib.js';

/* ---------- 1. Réglages et préréglages ---------- */

// Table de conversion diamètre extérieur (mm) -> DN, pour les vannes, purges...
const OD2DN = [[25, 20], [32, 25], [40, 32], [50, 40], [63, 50], [75, 60], [90, 80], [110, 100], [125, 100], [140, 125], [160, 140], [180, 160], [200, 200], [225, 200], [250, 250], [280, 250], [315, 300], [355, 300], [400, 400], [450, 450], [500, 500]];

// Les montages d'accessoires : quand on pose le déclencheur sur une conduite d'eau,
// les pièces de la liste sont posées d'un coup. dn = [[jusqu'au DN, DN du piquage]]
const KITS = [
  { on: true, trig: 'Purge', pieces: ['Té', 'Vanne', 'Purge'], dn: [[100, 40], [200, 60], [99999, 80]] },
  { on: true, trig: 'Vidange', pieces: ['Té', 'Vanne', 'Vidange'], dn: [[150, 60], [99999, 80]] },
  { on: true, trig: 'Ventouse', pieces: ['Té', 'Vanne', 'Ventouse'], dn: [[150, 60], [99999, 100]] },
  { on: true, trig: 'Poteau incendie', pieces: ['Té', 'Vanne', 'Poteau incendie'], dn: [[99999, 100]] },
  { on: true, trig: "Bouche d'incendie", pieces: ['Té', 'Vanne', "Bouche d'incendie"], dn: [[99999, 100]] },
  { on: true, trig: 'Compteur', pieces: ['Té', 'Vanne', 'Compteur'], dn: [[99999, 20]] },
  { on: true, trig: 'Collier de prise en charge', pieces: ['Collier de prise en charge', 'Vanne', 'Compteur'], dn: [[99999, 25]] },
  { on: true, trig: 'Réducteur de pression', pieces: ['Vanne', 'Réducteur de pression', 'Vanne'], dn: [[99999, 0]] },
  { on: true, trig: 'Clapet anti-retour', pieces: ['Vanne', 'Clapet anti-retour'], dn: [[99999, 0]] }
];

// Les raccords posés automatiquement sur les conduites d'eau potable
const FIT_DEFS = {
  c90: { id: 'pa13', name: 'Coude 90°', shape: 'triangle', letter: 'C', tpl: 'Coude 90°' },
  c45: { id: 'pa14', name: 'Coude 45°', shape: 'triangle', letter: 'C', tpl: 'Coude 45°' },
  te: { id: 'pa7', name: 'Té', shape: 'triangle', letter: 'T', tpl: 'Té {d} / {d2}' },
  red: { id: 'pa8', name: 'Réduction', shape: 'diamond', letter: 'Ø', tpl: 'Réduction {d} / {d2}' },
  trans: { id: 'pa6', name: 'Raccordement intermatériaux', shape: 'square', letter: 'I', tpl: 'Raccordement intermatériaux\n{m1} Ø{d} / {m2} Ø{d2}' },
  rd: { id: 'pa4', name: 'Raccordement droit sur existant', shape: 'triangle', letter: 'R', tpl: 'Raccordement droit sur {m1} Ø{d} existant\nAmorce en {m2} Ø{d2}' },
  rp: { id: 'pa5', name: 'Raccordement perpendiculaire', shape: 'triangle', letter: 'R', tpl: 'Raccordement perpendiculaire sur {m1} Ø{d} existant' },
  cit: { id: 'pa10', name: 'Citerneau / compteur', shape: 'square', letter: 'C', tpl: 'Citerneau {note}' },
  br: { id: 'pa15', name: 'Prise de branchement', shape: 'circle', letter: '', tpl: 'Prise de branchement' }
};

// Symbole de chaque accessoire livré (code de la bibliothèque)
const ACC_SYM = { pa1: 'AEP_PURGEUR', pa2: 'AEP_VENTOUSE', pa3: 'AEP_VANNE', pa4: 'COM_RACCORD', pa5: 'RAC_TE', pa6: 'RAC_TRANSITION', pa7: 'RAC_TE', pa8: 'RAC_CONE', pa9: 'RAC_BOUCHON', pa10: 'AEP_COMPTEUR', pa11: 'AEP_PI', pa12: 'ANN_CROISEMENT', pa13: 'RAC_COUDE90', pa14: 'RAC_COUDE45' };
const MANCHON = { id: 'pa16m', name: 'Manchon de liaison large tolérance', shape: 'square', letter: 'M', net: 'aep_n', sym: 'RAC_MANCHON_LT', tpl: 'Manchon de liaison large tolérance {d}', m1: '', m2: '', d: '', d2: '' };

// Les préréglages livrés avec l'outil
export function snapAngle(from, p) {
  const dx = p.x - from.x, dy = p.y - from.y, l = Math.hypot(dx, dy);
  if (l < 1e-9) { return { x: p.x, y: p.y }; }
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(a) * l, y: from.y + Math.sin(a) * l };
}
function defaults() {
  const networks = [
    { id: 'aep_n', name: 'AEP neuf', color: '#3CA9E8' },
    { id: 'aep_e', name: 'AEP existant', color: '#1F3FC8' },
    { id: 'eu_n', name: 'EU neuf', color: '#F26A1B' },
    { id: 'eu_e', name: 'EU existant', color: '#9A5B0A' },
    { id: 'ep_n', name: 'EP neuf', color: '#35B568' },
    { id: 'ep_e', name: 'EP existant', color: '#1C6B3A' },
    { id: 'ab', name: 'À abandonner', color: '#C2278F' }
  ];
  let np = 0;
  const P = (net, desc, w, dash) => ({ id: 'pp' + (++np), net: net, desc: desc, w: w, dash: dash || 'solid' });
  const pipes = [
    P('aep_n', '90/110 PEHD PN16', 5), P('aep_n', '114,6/140 PEHD 16b', 6), P('aep_n', '51,4/63 PEHD PN16', 3.5), P('aep_n', '40,8/50 PEHD PN16', 3),
    P('aep_e', 'Ø110 PEHD existant', 5), P('aep_e', 'Ø140 PVC existant', 4.5), P('aep_e', 'Ø63 PVC existant', 3.5), P('aep_e', 'Ø250 Fonte existant', 6.5),
    P('ab', 'F150 à abandonner', 5, 'dashed'), P('ab', 'F80 à abandonner', 3.5, 'dashed'),
    P('eu_n', 'Ø200 PP SN16', 5), P('eu_n', 'Ø160 PVC CR8', 4), P('eu_n', 'Branchement EU Ø125 PVC', 2.5, 'dotted'),
    P('eu_e', 'Ø200 AC existant', 5), P('eu_e', 'Ø200 PVC existant', 5),
    P('ep_n', 'Ø300 béton', 6), P('ep_e', 'Ø400 béton existant', 6.5)
  ];
  // Les branchements (en pointillés)
  [['pb1', 'aep_n', 'Branchement Ø25/32 PEHD'], ['pb2', 'aep_n', 'Branchement Ø40/50 PEHD'], ['pb3', 'aep_e', 'Branchement existant'],
    ['pb5', 'eu_n', 'Branchement EU Ø160 PVC'], ['pb6', 'eu_e', 'Branchement EU existant'], ['pb7', 'ep_n', 'Branchement EP neuf'],
    ['pb8', 'ep_e', 'Branchement EP existant'], ['pb9', 'ab', 'Branchement à abandonner'], ['pb10', 'eu_n', 'Branchement EU Ø125 PP'], ['pb11', 'eu_n', 'Branchement EU Ø160 PP']
  ].forEach(function (b) {
    pipes.push({ id: b[0], net: b[1], desc: b[2], w: 2, dash: 'dotted' });
  });
  let nm = 0;
  const M = (name, net, nature, diam, prefix) => ({ id: 'pm' + (++nm), name: name, net: net, nature: nature, diam: diam, prefix: prefix });
  const manholes = [
    M('Regard PP Ø600', 'eu_n', 'Regard PP', '600', 'R'), M('Regard PP Ø800', 'eu_n', 'Regard PP', '800', 'R'), M('Regard PP Ø1000', 'eu_n', 'Regard PP', '1000', 'R'),
    M('Regard existant BA Ø1000', 'eu_e', 'Regard BA', '1000', 'EXT R'), M('Regard EP', 'ep_n', 'Regard EP béton', '1000', 'R'),
    M('Chambre à vanne AEP', 'aep_e', 'Chambre', '1000', 'CH'),
    M('Regard de branchement', 'eu_n', 'Boîte de branchement', '315', 'BB')
  ];
  let na = 0;
  const A = (name, shape, letter, net, tpl, m1, m2, d, d2) => ({ id: 'pa' + (++na), name: name, shape: shape, letter: letter, net: net, tpl: tpl, m1: m1 || '', m2: m2 || '', d: d || '', d2: d2 || '' });
  const accessories = [
    A('Purge', 'circle', 'P', 'aep_n', 'Purge {d}', '', '', 'DN40'),
    A('Ventouse simple fonction', 'circle', 'V', 'aep_n', 'Ventouse simple fonction {d}', '', '', 'DN60'),
    A('Vanne', 'diamond', 'X', 'aep_n', 'Vanne {d}', '', '', 'DN100'),
    A('Raccordement droit sur existant', 'triangle', 'R', 'aep_n', FIT_DEFS.rd.tpl, 'PEHD', 'PEHD', '110', '114,6/140'),
    A('Raccordement perpendiculaire', 'triangle', 'R', 'aep_n', FIT_DEFS.rp.tpl, 'Fonte', '', '250'),
    A('Raccordement intermatériaux', 'square', 'I', 'aep_n', FIT_DEFS.trans.tpl, 'PVC', 'PEHD', '63', '63'),
    A('Té', 'triangle', 'T', 'aep_n', 'Té {d} / {d2}', '', '', '110', '63'),
    A('Réduction', 'diamond', 'Ø', 'aep_n', 'Réduction {d} / {d2}', '', '', '110', '63'),
    A('Bouchon / tamponnage', 'square', 'B', 'ab', 'Tamponnage à effectuer'),
    A('Citerneau / compteur', 'square', 'C', 'aep_e', 'Citerneau {note}'),
    A('Poteau incendie', 'circle', 'PI', 'aep_e', 'Poteau incendie Ø{d}', '', '', '100'),
    A("Franchissement (pont-cadre)", 'square', 'F', 'aep_n', "Franchissement au-dessus de l'ouvrage existant"),
    A('Coude 90°', 'triangle', 'C', 'aep_n', 'Coude 90°'),
    A('Coude 45°', 'triangle', 'C', 'aep_n', 'Coude 45°'),
    A('Prise de branchement', 'circle', '', 'aep_n', 'Prise de branchement'),
    A('Vidange', 'circle', 'V', 'aep_n', 'Vidange {d}', '', '', 'DN60'),
    A('Compteur', 'square', 'C', 'aep_n', 'Compteur {d}', '', '', 'DN20'),
    A("Bouche d'incendie", 'circle', 'BI', 'aep_n', "Bouche d'incendie Ø{d}", '', '', '100'),
    A('Collier de prise en charge', 'circle', 'CP', 'aep_n', 'Collier de prise en charge {d}', '', '', '25'),
    A('Réducteur de pression', 'diamond', 'RP', 'aep_n', 'Réducteur de pression {d}', '', '', 'DN100'),
    A('Clapet anti-retour', 'diamond', 'CA', 'aep_n', 'Clapet anti-retour {d}', '', '', 'DN100')
  ];
  accessories.forEach(a => { if (ACC_SYM[a.id]) { a.sym = ACC_SYM[a.id]; } });
  accessories.push(Object.assign({}, MANCHON));
  return {
    networks: networks, pipes: pipes, manholes: manholes, accessories: accessories, kits: JSON.parse(JSON.stringify(KITS)),
    fs: 14, casing: true, labelPos: 'on', labelBox: true, autoEnd: true, favs: { pipe: [], mh: [], acc: [] },
    autoFit: true, autoCoude: true, autoTe: true, autoRed: true, autoRac: true, autoBr: true, autoCit: true,
    kitsOn: true, crossTr: true, warnCross: false, size: 1
  };
}


/* Gamme étendue d'origine : ajoutée une seule fois, sans jamais ressusciter ce que l'utilisateur supprime */
function extraPresets() {
  const W = d => d <= 40 ? 2.5 : d <= 50 ? 3 : d <= 63 ? 3.5 : d <= 75 ? 4 : d <= 90 ? 4.5 : d <= 110 ? 5 : d <= 125 ? 5.5 : d <= 160 ? 6 : d <= 200 ? 6.5 : d <= 250 ? 7 : d <= 315 ? 7.5 : d <= 400 ? 8 : 9;
  let n = 0; const pipes = [], P = (net, desc, d, dash) => pipes.push({ id: 'px' + (++n), net: net, desc: desc, w: W(d), dash: dash || 'solid' });
  [32, 40, 50, 63, 75, 90, 110, 160, 200, 250, 315].forEach(d => P('aep_n', 'Ø' + d + ' PEHD PN16', d));
  [100, 150, 200, 250, 300].forEach(d => P('aep_n', 'DN' + d + ' Fonte ductile', d));
  [90, 110, 160, 200].forEach(d => P('aep_n', 'Ø' + d + ' PVC-U PN16', d));
  [63, 90, 125, 160, 200].forEach(d => P('aep_e', 'Ø' + d + ' PEHD existant', d));
  [90, 110, 125, 160, 200].forEach(d => P('aep_e', 'Ø' + d + ' PVC existant', d));
  [60, 80, 100, 125, 150, 200, 300].forEach(d => P('aep_e', 'DN' + d + ' Fonte existant', d));
  [100, 150, 200].forEach(d => P('aep_e', 'Ø' + d + ' AC existant', d));
  [250, 315, 400, 500].forEach(d => P('eu_n', 'Ø' + d + ' PVC CR8', d));
  [250, 315, 400, 500].forEach(d => P('eu_n', 'Ø' + d + ' PP SN16', d));
  [90, 110, 160].forEach(d => P('eu_n', 'Refoulement Ø' + d + ' PEHD', d));
  [300, 400, 500, 600].forEach(d => P('eu_n', 'Ø' + d + ' béton', d));
  [160, 250, 315, 400].forEach(d => P('eu_e', 'Ø' + d + ' PVC existant', d));
  [300, 400, 500, 600].forEach(d => P('eu_e', 'Ø' + d + ' béton existant', d));
  [200, 300].forEach(d => P('eu_e', 'Ø' + d + ' grès existant', d));
  [150, 300].forEach(d => P('eu_e', 'Ø' + d + ' AC existant', d));
  [200, 250, 315, 400, 500].forEach(d => P('ep_n', 'Ø' + d + ' PVC CR8', d));
  [400, 500, 600, 800, 1000].forEach(d => P('ep_n', 'Ø' + d + ' béton', d));
  [300, 400, 500].forEach(d => P('ep_n', 'Ø' + d + ' PP SN8', d));
  P('ep_n', 'Fossé / caniveau', 100, 'dashed');
  [300, 500, 600, 800].forEach(d => P('ep_e', 'Ø' + d + ' béton existant', d));
  [200, 315, 400].forEach(d => P('ep_e', 'Ø' + d + ' PVC existant', d));
  [100, 125, 200].forEach(d => P('ab', 'Fonte DN' + d + ' à abandonner', d, 'dashed'));
  [110, 160].forEach(d => P('ab', 'Ø' + d + ' PVC à abandonner', d, 'dashed'));
  [100, 150].forEach(d => P('ab', 'Ø' + d + ' AC à abandonner', d, 'dashed'));
  [200, 300].forEach(d => P('ab', 'Ø' + d + ' EU à abandonner', d, 'dashed'));
  let m = 0; const manholes = [], M = (name, net, nature, diam, prefix) => manholes.push({ id: 'mx' + (++m), name: name, net: net, nature: nature, diam: diam, prefix: prefix });
  M('Boîte de branchement Ø315', 'eu_n', 'Boîte de branchement PVC', '315', 'BB'); M('Regard PP Ø400', 'eu_n', 'Regard PP', '400', 'R');
  M('Regard BA Ø1000', 'eu_n', 'Regard BA', '1000', 'R'); M('Regard BA Ø1200', 'eu_n', 'Regard BA', '1200', 'R'); M('Regard BA Ø1500', 'eu_n', 'Regard BA', '1500', 'R');
  M('Regard existant BA Ø800', 'eu_e', 'Regard BA', '800', 'EXT R'); M('Regard existant BA Ø1200', 'eu_e', 'Regard BA', '1200', 'EXT R');
  M('Regard EP béton Ø800', 'ep_n', 'Regard EP béton', '800', 'R'); M('Regard EP béton Ø1200', 'ep_n', 'Regard EP béton', '1200', 'R');
  M('Avaloir', 'ep_n', 'Avaloir', '', 'AV'); M('Grille avaloir', 'ep_n', 'Grille', '', 'GR');
  M('Regard EP existant Ø1000', 'ep_e', 'Regard EP béton', '1000', 'EXT R'); M('Avaloir existant', 'ep_e', 'Avaloir', '', 'EXT AV');
  M('Chambre à ventouse AEP', 'aep_n', 'Chambre', '1000', 'CH'); M('Chambre à vanne neuve AEP', 'aep_n', 'Chambre', '1000', 'CH');
  M('Regard compteur AEP', 'aep_n', 'Regard compteur', '', 'RC'); M('Regard à abandonner', 'ab', 'Regard', '1000', 'R');
  let a = 0; const acc = [], A = (name, shape, letter, net, tpl, m1, m2, d, d2) => acc.push({ id: 'ax' + (++a), name: name, shape: shape, letter: letter, net: net, tpl: tpl, m1: m1 || '', m2: m2 || '', d: d || '', d2: d2 || '' });
  ['60', '80', '150', '200'].forEach(d => A('Vanne DN' + d, 'diamond', 'X', 'aep_n', 'Vanne {d}', '', '', 'DN' + d));
  ['60', '100'].forEach(d => A('Ventouse triple fonction DN' + d, 'circle', 'V', 'aep_n', 'Ventouse triple fonction {d}', '', '', 'DN' + d));
  A('Purge DN60', 'circle', 'P', 'aep_n', 'Purge {d}', '', '', 'DN60');
  A('Poteau incendie DN150', 'circle', 'PI', 'aep_n', 'Poteau incendie Ø{d}', '', '', '150');
  A('Croix', 'triangle', '+', 'aep_n', 'Croix {d} / {d2}', '', '', '110', '63');
  A('Té 160 / 110', 'triangle', 'T', 'aep_n', 'Té {d} / {d2}', '', '', '160', '110');
  A('Té 63 / 63', 'triangle', 'T', 'aep_n', 'Té {d} / {d2}', '', '', '63', '63');
  A('Réduction 160 / 110', 'diamond', 'Ø', 'aep_n', 'Réduction {d} / {d2}', '', '', '160', '110');
  A('Réduction 63 / 40', 'diamond', 'Ø', 'aep_n', 'Réduction {d} / {d2}', '', '', '63', '40');
  A('Fourreau (traversée de chaussée)', 'square', 'F', 'aep_n', 'Traversée sous fourreau Ø{d}', '', '', '200');
  A('Raccordement sur regard existant', 'triangle', 'R', 'eu_n', 'Raccordement sur regard existant {note}', '', '', '');
  A('Culotte de branchement', 'triangle', 'Cu', 'eu_n', 'Culotte de branchement Ø{d}', '', '', '160');
  A('Tampon à remplacer', 'square', 'TP', 'eu_e', 'Remplacement du tampon {note}', '', '', '');
  A('Bouchon EU', 'square', 'B', 'eu_n', 'Bouchon Ø{d}', '', '', '200');
  A('Raccordement sur canalisation existante EP', 'triangle', 'R', 'ep_n', 'Raccordement sur canalisation existante Ø{d}', '', '', '300');
  return { pipes: pipes, manholes: manholes, accessories: acc };
}
function addExtras(d) {
  const E = extraPresets();
  const add = (arr, items, key) => {
    items.forEach(function (it) {
      if (arr.some(x => x.id === it.id || key(x) === key(it))) { return; }
      let last = -1; arr.forEach((x, i) => { if (x.net === it.net) { last = i; } });
      if (last >= 0) { arr.splice(last + 1, 0, it); } else { arr.push(it); }
    });
  };
  const has = n => d.networks.some(x => x.id === n);
  add(d.pipes, E.pipes.filter(p => has(p.net)), x => x.net + '|' + x.desc);
  add(d.manholes, E.manholes.filter(p => has(p.net)), x => x.net + '|' + x.name);
  add(d.accessories, E.accessories.filter(p => has(p.net)), x => x.net + '|' + x.name);
  if (!d.accessories.some(a => a.id === MANCHON.id)) { d.accessories.push(Object.assign({}, MANCHON)); }
}

// Les réglages courants (modifiés par l'utilisateur, gardés dans le navigateur)
export let S = defaults();

// Recharge des réglages enregistrés : ce qui manque est complété avec les valeurs par défaut
export function loadSettings(saved) {
  const base = defaults();
  S = Object.assign(base, saved || {});
  ['networks', 'pipes', 'manholes', 'accessories', 'kits'].forEach(function (k) {
    if (!Array.isArray(S[k]) || !S[k].length) {
      S[k] = base[k];
    }
  });
  // Les préréglages qui servent aux raccords automatiques doivent toujours exister
  base.accessories.forEach(function (a) {
    if (!S.accessories.some(function (x) { return x.id === a.id; })) {
      S.accessories.push(a);
    }
  });
  S.accessories.forEach(function (a) { if (a.sym === undefined && ACC_SYM[a.id]) { a.sym = ACC_SYM[a.id]; } });
  if ((S.mv || 0) < 6) { addExtras(S); S.mv = 6; }
  base.networks.forEach(function (n) {
    if (!S.networks.some(function (x) { return x.id === n.id; })) {
      S.networks.push(n);
    }
  });
  return S;
}


/* ---------- 2. Petites fonctions utiles ---------- */

// Échelle des textes : les dessins suivent le zoom, mais l'écriture reste lisible (réglée par la carte)
let TXTK = 1;
export function setTextScale(k) { TXTK = k > 0 ? k : 1; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Sur la carte (ph.free) il n'y a pas de bord de photo : un texte n'est jamais ramené dans un cadre
const fitIn = (ph, v, size, k) => ph.free ? v : clamp(v, 0, Math.max(0, ph[k] - size));
let counter = 0;
export const uid = () => 'o' + Date.now().toString(36) + (++counter).toString(36);

export const netOf = id => S.networks.find(n => n.id === id);
export const pipeOf = id => S.pipes.find(p => p.id === id);
export const mhOf = id => S.manholes.find(m => m.id === id);
export const accOf = id => S.accessories.find(a => a.id === id);
export const colOf = net => (netOf(net) || { color: '#6b7480' }).color;
// "aep_n" -> "aep" : la famille du réseau
export const netCat = id => String(id || '').split('_')[0];
const isNew = pd => /_n$/.test(pd.net);
const isExist = pd => /_e$/.test(pd.net);

function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function luminance(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
function darken(hex, k) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const f = v => Math.round(v * (1 - k));
  return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
}

// Le diamètre écrit dans une description : "Ø110 PEHD" -> "110", "90/110" -> "110"
export function diamOf(text) {
  text = text || '';
  let m = text.match(/Ø\s*(\d+(?:[.,]\d+)?)/);
  if (m) { return m[1]; }
  m = text.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (m) { return m[2]; }
  m = text.match(/(\d+(?:[.,]\d+)?)/);
  return m ? m[1] : '';
}
const odNum = pd => parseFloat(String(diamOf(pd.desc)).replace(',', '.')) || 0;
const matOf = d => ((d || '').match(/PEHD|PVC|Fonte|Acier|PRV|PP|AC\b|Béton|Grès/i) || [''])[0].toUpperCase();
function matName(d) {
  const m = matOf(d);
  return ({ FONTE: 'Fonte', ACIER: 'Acier', BÉTON: 'Béton', GRÈS: 'Grès' })[m] || m;
}
function dnFromPipe(desc) {
  const n = parseFloat(String(diamOf(desc)).replace(',', '.'));
  if (!n) { return null; }
  if (/^\s*DN/i.test(desc) || /Fonte|AC\b|Acier/i.test(desc)) { return n; }
  let best = OD2DN[0];
  OD2DN.forEach(function (r) { if (Math.abs(r[0] - n) < Math.abs(best[0] - n)) { best = r; } });
  return best[1];
}
const odOfDn = dn => { const r = OD2DN.find(x => x[1] === dn); return r ? r[0] : dn; };
const dnOfOd = od => { const r = OD2DN.find(x => x[0] === od); return r ? r[1] : od; };
const dnOfNum = v => { const m = String(v == null ? '' : v).match(/\d+/); return m ? +m[0] : 0; };
const fmtDn = (v, ref) => (/^DN/i.test(ref || '') ? 'DN' + v : String(v));
const nrm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Texte affiché pour un accessoire : le modèle du préréglage avec les valeurs de l'objet
export function accText(o) {
  if (o.text) { return o.text; }
  const def = accOf(o.accId) || {};
  let t = def.tpl || def.name || '';
  const val = { d: o.d, d2: o.d2, m1: o.m1, m2: o.m2, note: o.note };
  t = t.replace(/\{(d2|d|m1|m2|note)\}/g, function (all, k) { return val[k] || ''; });
  return t.split('\n').map(s => s.replace(/\s+/g, ' ').replace(/Ø(\s|$)/g, '$1').trim()).filter(Boolean).join('\n');
}

// Les lignes de texte d'un regard
function manholeLines(o) {
  const def = mhOf(o.mhId) || {};
  const out = [{ t: o.num || def.prefix || 'R', b: true }];
  const nat = [o.nature, o.diam ? 'Ø' + o.diam : ''].filter(Boolean).join(' ');
  if (nat) { out.push({ t: nat }); }
  (o.extra || '').split('\n').filter(s => s.trim()).forEach(s => out.push({ t: s }));
  return out;
}
// Le prochain numéro libre d'un regard : R1, R2...
export function nextNum(ph, m) {
  const prefix = (m && m.prefix) || 'R';
  let max = 0;
  ph.objects.forEach(function (o) {
    if (o.type === 'manhole' && o.num && o.num.indexOf(prefix) === 0) {
      const n = parseInt(o.num.slice(prefix.length), 10);
      if (n > max) { max = n; }
    }
  });
  return prefix + (max + 1);
}


/* ---------- 3. Géométrie ---------- */

// Projection d'un point p sur le segment a-b : distance, position (t de 0 à 1) et point le plus proche
export function segProj(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = a.x + t * dx, y = a.y + t * dy;
  return { d: Math.hypot(p.x - x, p.y - y), t: t, x: x, y: y };
}
// Point d'intersection de deux segments (ou null)
function segX(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) { return null; }
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const v = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0.01 || t > 0.99 || v < 0.01 || v > 0.99) { return null; }
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}
function polyLens(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) { L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)); }
  return L;
}
function pointAt(pts, L, s) {
  const n = pts.length;
  let i = 1;
  if (s >= L[n - 1]) { i = n - 1; } else if (s > 0) { while (i < n - 1 && L[i] < s) { i++; } }
  const a = pts[i - 1], b = pts[i], seg = (L[i] - L[i - 1]) || 1e-6, t = (s - L[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
}
// Position le long d'une ligne (distance depuis le début) d'un point proche
function polyProjS(pts, p) {
  let best = null, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = segProj(p, pts[i], pts[i + 1]), l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (!best || r.d < best.d) { best = { d: r.d, s: acc + r.t * l }; }
    acc += l;
  }
  return { d: best ? best.d : 0, s: best ? best.s : 0, total: acc };
}
// Le point situé à la distance sv depuis le début d'une ligne
function polyAtS(pts, sv) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (sv <= acc + l || i === pts.length - 2) {
      const t = l ? clamp((sv - acc) / l, 0, 1) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    acc += l;
  }
  return { x: pts[0].x, y: pts[0].y };
}
const ptSig = pts => pts.map(q => Math.round(q.x * 10) + ',' + Math.round(q.y * 10)).join(';');

// Décale un tracé de d pixels sur le côté (pour le tracé parallèle)
export function offsetPts(pts, d) {
  const P = [];
  pts.forEach(function (q) {
    const l = P[P.length - 1];
    if (!l || Math.hypot(q.x - l.x, q.y - l.y) > 1e-6) { P.push({ x: q.x, y: q.y }); }
  });
  const n = P.length;
  if (n < 2) { return P; }
  const N = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = P[i + 1].x - P[i].x, dy = P[i + 1].y - P[i].y, l = Math.hypot(dx, dy);
    N.push({ x: dy / l, y: -dx / l });
  }
  return P.map(function (q, i) {
    if (i === 0) { return { x: q.x + N[0].x * d, y: q.y + N[0].y * d }; }
    if (i === n - 1) { return { x: q.x + N[n - 2].x * d, y: q.y + N[n - 2].y * d }; }
    const a = N[i - 1], b = N[i];
    let mx = a.x + b.x, my = a.y + b.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { return { x: q.x + b.x * d, y: q.y + b.y * d }; }
    mx /= ml; my /= ml;
    const k = d / Math.max(mx * b.x + my * b.y, 0.35);
    return { x: q.x + mx * k, y: q.y + my * k };
  });
}


/* ---------- 4. Liens entre objets ---------- */
/* Un point de conduite peut être "lié" à un regard, un accessoire ou une autre conduite :
   quand on déplace l'objet, le point suit.
   lien = { k: 'mh' | 'acc' | 'ln', id, seg?, t? } */

function mhBoundary(o, from) {
  if (!from) { return { x: o.cx, y: o.cy }; }
  const co = Math.cos(-(o.rot || 0)), si = Math.sin(-(o.rot || 0)), dx = from.x - o.cx, dy = from.y - o.cy;
  let lx = dx * co - dy * si, ly = dx * si + dy * co;
  const l = Math.hypot(lx, ly);
  if (l < 1e-6) { return { x: o.cx, y: o.cy }; }
  lx /= l; ly /= l;
  const k = 1 / Math.sqrt((lx * lx) / (o.rx * o.rx) + (ly * ly) / (o.ry * o.ry));
  const bx = lx * k, by = ly * k, c2 = Math.cos(o.rot || 0), s2 = Math.sin(o.rot || 0);
  return { x: o.cx + bx * c2 - by * s2, y: o.cy + bx * s2 + by * c2 };
}
function linkedPos(link, ph, neighbor) {
  const t = ph.objects.find(o => o.id === link.id);
  if (!t) { return null; }
  if (link.k === 'mh' && t.type === 'manhole') { return mhBoundary(t, neighbor); }
  if (link.k === 'acc' && t.type === 'acc') {
    if (!neighbor) { return { x: t.x, y: t.y }; }
    const dd = accOf(t.accId) || {}, u = ph.w / 1000, rr = (t.size || 8) * u * (dd.sym && SYMMAP.has(dd.sym) ? 1.35 : 1.05);
    const dx = neighbor.x - t.x, dy = neighbor.y - t.y, l = Math.hypot(dx, dy);
    if (l <= rr * 1.05) { return { x: t.x, y: t.y }; }
    return { x: t.x + dx / l * rr, y: t.y + dy / l * rr };
  }
  if (link.k === 'ln' && t.type === 'line' && t.pts.length > 1) {
    const seg = clamp(link.seg || 0, 0, t.pts.length - 2), a = t.pts[seg], b = t.pts[seg + 1];
    if (!a || !b) { return null; }
    return { x: a.x + (b.x - a.x) * link.t, y: a.y + (b.y - a.y) * link.t };
  }
  return null;
}
// Met à jour les points liés ; efface les liens dont la cible n'existe plus
export function resolveLinks(ph) {
  let changed = false;
  for (let pass = 0; pass < 2; pass++) {
    ph.objects.forEach(function (o) {
      if (o.type !== 'line') { return; }
      o.pts.forEach(function (p, i) {
        if (!p.link) { return; }
        if (p.link.id === o.id) { delete p.link; changed = true; return; }
        const nb = o.pts[i - 1] || o.pts[i + 1];
        const pos = linkedPos(p.link, ph, nb);
        if (!pos) { delete p.link; changed = true; return; }
        if (Math.abs(p.x - pos.x) > 0.01 || Math.abs(p.y - pos.y) > 0.01) { p.x = pos.x; p.y = pos.y; changed = true; }
      });
    });
  }
  return changed;
}
// Cherche un objet près du point p pour s'y accrocher
export function snapTarget(ph, p, u, tol, ignore) {
  for (let i = ph.objects.length - 1; i >= 0; i--) {
    const o = ph.objects[i];
    if (o.type === 'manhole') {
      const co = Math.cos(-(o.rot || 0)), si = Math.sin(-(o.rot || 0)), dx = p.x - o.cx, dy = p.y - o.cy, lx = dx * co - dy * si, ly = dx * si + dy * co, rx = o.rx + tol, ry = o.ry + tol;
      if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) { return { k: 'mh', id: o.id, o: o }; }
    } else if (o.type === 'acc') {
      if (Math.hypot(p.x - o.x, p.y - o.y) <= (o.size || 8) * u * 1.25 + tol) { return { k: 'acc', id: o.id, o: o }; }
    }
  }
  let best = null, bd = tol;
  ph.objects.forEach(function (o) {
    if (o.type !== 'line' || o === ignore) { return; }
    for (let k = 0; k < o.pts.length - 1; k++) {
      const r = segProj(p, o.pts[k], o.pts[k + 1]);
      if (r.d < bd) { bd = r.d; best = { k: 'ln', id: o.id, o: o, seg: k, t: r.t < 0.04 ? 0 : (r.t > 0.96 ? 1 : r.t) }; }
    }
  });
  return best;
}
export const linkOf = tg => (tg.k === 'ln' ? { k: 'ln', id: tg.id, seg: tg.seg, t: tg.t } : { k: tg.k, id: tg.id });
// Le point corrigé d'un accrochage : { x, y, link }
export function snappedPoint(ph, tg, p, neighbor) {
  const link = linkOf(tg), pos = linkedPos(link, ph, neighbor) || { x: p.x, y: p.y };
  return { x: pos.x, y: pos.y, link: link };
}


/* ---------- 5. Créer des objets ---------- */

export function newLine(pts, pipeId) {
  return { id: uid(), type: 'line', pipeId: pipeId, pts: pts.map(p => (p.link ? { x: p.x, y: p.y, link: p.link } : { x: p.x, y: p.y })) };
}
export function newManhole(ph, p, def, u) {
  const r = 11 * u;
  return { id: uid(), type: 'manhole', mhId: def.id, cx: p.x, cy: p.y, rx: r, ry: r, rot: 0, num: nextNum(ph, def), nature: def.nature, diam: def.diam, extra: '' };
}
export function newAcc(p, def, u) {
  return { id: uid(), type: 'acc', accId: def.id, x: p.x, y: p.y, m1: def.m1, m2: def.m2, d: def.d, d2: def.d2, note: '', text: '', size: 8 };
}
export function newText(p, text) {
  return { id: uid(), type: 'text', x: p.x, y: p.y, text: text, fs: 0 };
}


/* ---------- 6. Dessin ---------- */

function setDash(c, style, w) {
  if (style === 'dashed') { c.lineCap = 'butt'; c.setLineDash([w * 3.4, w * 2.2]); }
  else if (style === 'dotted') { c.lineCap = 'round'; c.setLineDash([0.01, w * 2.3]); }
  else { c.lineCap = 'round'; c.setLineDash([]); }
}
const font = (fs, bold) => (bold ? '700 ' : '600 ') + fs + 'px "Public Sans","Segoe UI",system-ui,sans-serif';

// Texte avec un contour blanc, lisible sur toutes les photos
function haloText(c, text, x, y, fs, color, align) {
  c.save();
  c.font = font(fs, false); c.textAlign = align || 'left'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = fs * 0.3; c.strokeStyle = 'rgba(255,255,255,.95)';
  c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y);
  c.restore();
}
function shapePath(c, shape, r) {
  c.beginPath();
  if (shape === 'square') { c.rect(-r, -r, 2 * r, 2 * r); }
  else if (shape === 'diamond') { c.moveTo(0, -r * 1.25); c.lineTo(r * 1.25, 0); c.lineTo(0, r * 1.25); c.lineTo(-r * 1.25, 0); c.closePath(); }
  else if (shape === 'triangle') { c.moveTo(0, -r * 1.2); c.lineTo(r * 1.15, r * 0.9); c.lineTo(-r * 1.15, r * 0.9); c.closePath(); }
  else { c.arc(0, 0, r, 0, Math.PI * 2); }
}

// Couleur d'un accessoire : celle de la conduite à laquelle il est attaché, sinon celle de son préréglage
function accColor(o, ph, u) {
  if (o.col) { return o.col; }
  let L = null;
  if (o.kit) { L = ph.objects.find(l => l.type === 'line' && l.id === o.kmain) || ph.objects.find(l => l.type === 'line' && l.kit === o.kit); }
  if (!L) { L = ph.objects.find(l => l.type === 'line' && l.pts.some(q => q.link && q.link.id === o.id)); }
  if (!L && o.auto) { L = ph.objects.find(l => l.type === 'line' && l.id === String(o.auto).split(':')[0]); }
  if (!L) {
    let best = null;
    ph.objects.forEach(function (M) {
      if (M.type !== 'line') { return; }
      for (let i = 0; i < M.pts.length - 1; i++) {
        const r = segProj(o, M.pts[i], M.pts[i + 1]);
        if (r.d < 2.5 * u && (!best || r.d < best.d)) { best = { d: r.d, M: M }; }
      }
    });
    if (best) { L = best.M; }
  }
  if (L) {
    const pd = pipeOf(L.pipeId);
    return L.col || (pd ? colOf(pd.net) : '#6b7480');
  }
  const d = accOf(o.accId) || { net: '' };
  return colOf(o.net || d.net);
}

// Conduite : mode 'cas' = trait blanc dessous, 'fill' = trait coloré
function drawLine(c, o, u, mode) {
  const def = pipeOf(o.pipeId) || { w: 4, net: '', desc: '(préréglage supprimé)', dash: 'solid' };
  const col = o.col || colOf(def.net), w = def.w * u;
  let pts = o.pts;
  if (pts.length < 2) { return; }
  // Une extrémité reliée à un regard entre un peu sous l'anneau : pas de jour
  const first = o.pts[0].link && o.pts[0].link.k === 'mh', last = o.pts[pts.length - 1].link && o.pts[pts.length - 1].link.k === 'mh';
  if (first || last) {
    pts = pts.map(q => ({ x: q.x, y: q.y }));
    const ext = (a, b) => { const l = Math.hypot(a.x - b.x, a.y - b.y) || 1; return { x: a.x + (a.x - b.x) / l * 2.6 * u, y: a.y + (a.y - b.y) / l * 2.6 * u }; };
    if (first) { pts[0] = ext(pts[0], pts[1]); }
    const n = pts.length;
    if (last) { pts[n - 1] = ext(pts[n - 1], pts[n - 2]); }
  }
  const dash = o.dash || def.dash;
  const trace = () => { c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) { c.lineTo(pts[i].x, pts[i].y); } };
  if (mode === 'cas') {
    if (!S.casing) { return; }
    c.save(); c.lineJoin = 'round'; trace(); setDash(c, dash, w + 1.8 * u); c.strokeStyle = 'rgba(255,255,255,.72)'; c.lineWidth = w + 1.8 * u; c.stroke(); c.restore();
    return;
  }
  const paint = () => { c.lineJoin = 'round'; trace(); setDash(c, dash, w); c.strokeStyle = col; c.lineWidth = w; c.stroke(); };
  const cr = o._cross;
  if (cr && cr.length) {
    // Croisement avec un autre réseau : la conduite devient transparente à cet endroit
    c.save(); c.beginPath(); c.rect(-1e6, -1e6, 2e6, 2e6);
    cr.forEach(q => { c.moveTo(q.x + q.r, q.y); c.arc(q.x, q.y, q.r, 0, Math.PI * 2); });
    c.clip('evenodd'); paint(); c.restore();
    c.save(); c.beginPath(); cr.forEach(q => { c.moveTo(q.x + q.r, q.y); c.arc(q.x, q.y, q.r, 0, Math.PI * 2); }); c.clip(); c.globalAlpha = 0.36; paint(); c.restore();
  } else { c.save(); paint(); c.restore(); }
}
// Le texte d'une conduite : écrit lettre à lettre le long du tracé (comme l'outil d'origine), dans une pastille blanche
// bordée de la couleur du réseau, au meilleur endroit libre ; réduit s'il manque de la place, masqué si vraiment trop court.
let LBL_AVOID = [], LBL_PLACED = [], LBL_LINES = [], LBL_RECTS = [];
function lblTextColor(col) { return luminance(col) > 0.5 ? darken(col, 0.22) : col; }
function drawLineLabel(c, o, u, ph) {
  if (o.showLabel === false || o.pts.length < 2) { return; }
  const def = pipeOf(o.pipeId) || { w: 4, net: '', desc: '' };
  const text = o.text != null && o.text !== '' ? o.text : def.desc;
  if (!text) { return; }
  const pts = o.pts, col = o.col || colOf(def.net), lw = def.w * u;
  let fs = (o.fs || S.fs) * u * TXTK;
  // Dézoomé, la conduite est plus fine que le texte : plus de pastille, le texte se pose au-dessus du trait pour ne pas le cacher
  const slim = lw < fs * 0.55, pos = slim ? 'above' : (o.pos || S.labelPos || 'on'), box = S.labelBox !== false && !slim;
  c.save(); c.font = font(fs, true); c.textBaseline = 'middle'; c.lineJoin = 'round';
  const chars = Array.from(text); let cw, cum, tw;
  const meas = () => { c.font = font(fs, true); cw = chars.map(ch => c.measureText(ch).width); cum = [0]; cw.forEach((w, i) => cum.push(cum[i] + w)); tw = cum[cum.length - 1]; };
  meas();
  const L = polyLens(pts), total = L[L.length - 1];
  if (total <= 0) { c.restore(); return; }
  // Sur la carte, le texte garde toujours la même taille à l'écran : s'il n'y a pas la place (dézoomé), il est masqué
  if (ph && ph.free) { if (tw + fs * 0.9 > total * 0.98) { c.restore(); return; } }
  else {
    if (o.showLabel !== true && tw * 0.8 + fs * 0.7 > total * 0.95) { c.restore(); return; }
    if (tw + fs * 0.9 > total * 0.95) { fs *= Math.max(0.45, total * 0.95 / (tw + fs * 0.9)); meas(); }
  }
  const mid = pointAt(pts, L, total / 2), flip = Math.cos(mid.a) < 0;
  const off = pos === 'on' ? 0 : (pos === 'below' ? -(lw / 2 + fs * (box ? 0.86 : 0.62)) : (lw / 2 + fs * (box ? 0.86 : 0.62)));
  const at = (sm) => { const p = pointAt(pts, L, flip ? total - clamp(sm, 0, total) : clamp(sm, 0, total)), a = flip ? p.a + Math.PI : p.a; return { x: p.x + Math.sin(a) * off, y: p.y - Math.cos(a) * off, a: a }; };
  let st0 = (total - tw) / 2;
  if (tw < total * 0.96) {
    let bs = 1e18;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88]) {
      const st = clamp((flip ? 1 - f : f) * total - tw / 2, 0, total - tw); let sc = Math.abs(f - 0.5) * 12;
      for (let sm = st; sm <= st + tw + 0.1; sm += fs * 0.7) {
        const p = at(sm);
        for (const q of LBL_AVOID) { if (Math.hypot(q.x - p.x, q.y - p.y) < q.r + fs * 0.6) { sc += 45; } }
        for (const q of LBL_PLACED) { if (q.o !== o.id && Math.hypot(q.x - p.x, q.y - p.y) < fs * 0.95) { sc += 40; } }
        for (const v of pts) { if (Math.hypot(v.x - p.x, v.y - p.y) < fs * 0.8) { sc += 6; } }
        for (const q of LBL_LINES) { if (q.o !== o.id && Math.hypot(q.x - p.x, q.y - p.y) < fs * 0.95) { sc += 25; } }
        for (const b of LBL_RECTS) { if (p.x >= b.x - fs * 0.6 && p.x <= b.x + b.w + fs * 0.6 && p.y >= b.y - fs * 0.6 && p.y <= b.y + b.h + fs * 0.6) { sc += 70; } }
      }
      if (sc < bs) { bs = sc; st0 = st; }
    }
  }
  for (let sm = st0; sm <= st0 + tw + 0.1; sm += fs * 0.5) { const p = at(sm); LBL_PLACED.push({ x: p.x, y: p.y, o: o.id }); }
  if (box) {
    const capW = fs * 1.5, pad = fs * 0.45, trace = () => {
      c.beginPath(); let first = true;
      for (let sm = st0 - pad; sm <= st0 + tw + pad + 0.01; sm += Math.max(fs * 0.35, 2)) { const p = at(sm); if (first) { c.moveTo(p.x, p.y); first = false; } else { c.lineTo(p.x, p.y); } }
    };
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([]);
    trace(); c.strokeStyle = col; c.lineWidth = capW + fs * 0.2; c.stroke();
    trace(); c.strokeStyle = '#FFFFFF'; c.lineWidth = capW; c.stroke();
    c.restore();
  }
  const fill = box ? lblTextColor(col) : (luminance(col) > 0.5 ? darken(col, 0.38) : col);
  for (let i = 0; i < chars.length; i++) {
    const p = at(st0 + cum[i] + cw[i] / 2);
    c.save(); c.translate(p.x, p.y); c.rotate(p.a);
    if (!box) { c.lineWidth = fs * 0.3; c.strokeStyle = '#FFFFFF'; c.strokeText(chars[i], -cw[i] / 2, 0); }
    c.fillStyle = fill; c.fillText(chars[i], -cw[i] / 2, 0); c.restore();
  }
  c.restore();
}

function drawManhole(c, o, u) {
  const def = mhOf(o.mhId) || {}, col = colOf(o.net || def.net);
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot || 0);
  c.beginPath(); c.ellipse(0, 0, o.rx, o.ry, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,.55)'; c.fill(); c.fillStyle = hexA(col, 0.28); c.fill();
  c.lineWidth = 4.4 * u; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
  c.lineWidth = 2.6 * u; c.strokeStyle = col; c.stroke();
  c.restore();
}
/* ---------- Symboles de la bibliothèque ---------- */
export const SYMNET = { AEP: 'Eau potable', EU: 'Eaux usées', EP: 'Eaux pluviales', UN: 'Unitaire', ANC: 'Assainissement non collectif', ENP: 'Eau non potable', COM: 'Commun', RAC: 'Raccords', TRX: 'Travaux', TOPO: 'Topo', ANN: 'Annotations' };
export const SYMNETDEF = { AEP: 'aep_n', EU: 'eu_n', UN: 'eu_n', EP: 'ep_n', ANC: 'eu_n', ENP: 'aep_n' };
export const SYMS = SYMLIB;
export const SYMMAP = new Map(SYMLIB.map(x => [x[0], x]));
const symCache = new Map(); let symListener = null, symTimer = null;
export const onSymLoad = fn => { symListener = fn; };
function symEntry(code, color, halo) {
  const k = code + '|' + color + '|' + (halo ? 1 : 0); let e = symCache.get(k); if (e) { return e; }
  const sd = SYMMAP.get(code); if (!sd) { return null; }
  let inner = sd[3];
  if (halo) { inner = inner.replace(/currentColor/g, '#ffffff').replace(/stroke-width="([\d.]+)"/g, (m, v) => 'stroke-width="' + (+v * 2.7).toFixed(3) + '"'); }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.25 -1.25 2.5 2.5" width="240" height="240" color="' + color + '">' + inner + '</svg>';
  const img = new Image(); e = { img: img, ok: false };
  img.onload = () => { e.ok = true; clearTimeout(symTimer); symTimer = setTimeout(() => { if (symListener) { symListener(); } }, 60); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  symCache.set(k, e); return e;
}
export function symDataUrl(code, color) {
  const sd = SYMMAP.get(code); if (!sd) { return ''; }
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.25 -1.25 2.5 2.5" width="120" height="120" color="' + color + '">' + sd[3] + '</svg>');
}
// Un symbole (ou, à défaut, la forme simple avec sa lettre) centré en x, y, de rayon r
export function drawSymbol(c, def, x, y, r, u, rot, colour) {
  const col = colour || colOf(def.net);
  if (def.sym && SYMMAP.has(def.sym)) {
    const a = symEntry(def.sym, col, false), b = symEntry(def.sym, col, true);
    if (a && b && a.ok && b.ok) { const z = r * 4.4; c.save(); c.translate(x, y); if (rot) { c.rotate(rot); } c.drawImage(b.img, -z / 2, -z / 2, z, z); c.drawImage(a.img, -z / 2, -z / 2, z, z); c.restore(); return; }
  }
  c.save(); c.translate(x, y);
  shapePath(c, def.shape || 'circle', r); c.lineWidth = 3.6 * u; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
  c.fillStyle = col; c.fill(); c.lineWidth = 1.2 * u; c.strokeStyle = 'rgba(0,0,0,.35)'; c.stroke();
  const t = (def.letter || '').slice(0, 2);
  if (t) { c.fillStyle = luminance(col) > 0.62 ? '#101820' : '#FFFFFF'; c.font = font(r * (t.length > 1 ? 0.95 : 1.2), true); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, 0, r * 0.06); }
  c.restore();
}
// Petite vignette d'un accessoire (palette)
export function drawIcon(cv, def) {
  const big = !!(def.sym && SYMMAP.has(def.sym)), s = window.devicePixelRatio || 1, w = 34, h = big ? 34 : 26;
  cv.width = w * s; cv.height = h * s; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const x = cv.getContext('2d'); x.setTransform(s, 0, 0, s, 0, 0); x.clearRect(0, 0, w, h);
  drawSymbol(x, def, w / 2, h / 2, big ? 12.5 : 10, 1.1, 0);
}
// Ajoute (ou retrouve) un accessoire pour un symbole de la bibliothèque
export function accForSymbol(code) {
  const sd = SYMMAP.get(code); if (!sd) { return null; }
  const want = SYMNETDEF[sd[2]] || 'aep_n', net = S.networks.some(n => n.id === want) ? want : S.networks[0].id;
  let a = S.accessories.find(x => x.sym === code && x.net === net);
  if (!a) { a = { id: uid(), name: sd[1], shape: 'circle', letter: '', net: net, sym: code, tpl: sd[1], m1: '', m2: '', d: '', d2: '' }; S.accessories.push(a); }
  return a;
}

/* Té à trois branches, coude en chevrons (tels que dans l'outil d'origine) */
function drawTee(c, o, r, u, col) {
  const L = r * 1.55, tk = Math.max(0.4, Math.min(1, r / (8 * u)));
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  for (const pass of [0, 1]) {
    c.lineWidth = (pass ? 2.6 : 5.6) * u * tk; c.strokeStyle = pass ? col : 'rgba(255,255,255,.95)';
    c.beginPath(); for (const a of o.dirs3) { c.moveTo(o.x, o.y); c.lineTo(o.x + Math.cos(a) * L, o.y + Math.sin(a) * L); } c.stroke();
  }
  c.beginPath(); c.arc(o.x, o.y, 1.6 * u * tk, 0, Math.PI * 2); c.fillStyle = col; c.fill();
  c.restore();
}
function drawElbow(c, o, r, u, col) {
  const L = r * 1.25, W = r * 0.8, g = r * 0.22, tk = Math.max(0.4, Math.min(1, r / (8 * u)));
  c.save(); c.lineJoin = 'miter'; c.lineCap = 'round';
  for (const pass of [0, 1]) {
    c.lineWidth = (pass ? 2.6 : 5.6) * u * tk; c.strokeStyle = pass ? col : 'rgba(255,255,255,.95)';
    for (const a of o.dirs) {
      const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, tx = o.x + ux * g, ty = o.y + uy * g;
      c.beginPath(); c.moveTo(tx + ux * L + nx * W, ty + uy * L + ny * W); c.lineTo(tx, ty); c.lineTo(tx + ux * L - nx * W, ty + uy * L - ny * W); c.stroke();
    }
  }
  c.restore();
}

// Un accessoire posé près d'une conduite s'aligne dessus (symboles « en ligne »), un té s'oriente vers le branchement
export const INLINE_SYM = /^(AEP_VANNE|AEP_STAB|AEP_LIMITEUR|AEP_DEBITMETRE|AEP_ROBINET_ARRET|AEP_FILTRE|AEP_DISCONNECTEUR|COM_CLAPET|COM_VANNE_MURALE|RAC_)/;
export function alignAcc(o, ph, tol) {
  const def = accOf(o.accId);
  if (!def || !def.sym || !INLINE_SYM.test(def.sym) || o.auto || o.noAlign || !ph) { return false; }
  let best = null;
  ph.objects.forEach(function (L) {
    if (L.type !== 'line') { return; }
    for (let i = 0; i < L.pts.length - 1; i++) {
      const r = segProj({ x: o.x, y: o.y }, L.pts[i], L.pts[i + 1]);
      if (r.d <= tol && (!best || r.d < best.d)) { best = { d: r.d, x: r.x, y: r.y, L: L, a: Math.atan2(L.pts[i + 1].y - L.pts[i].y, L.pts[i + 1].x - L.pts[i].x) }; }
    }
  });
  if (best) {
    o.x = best.x; o.y = best.y; o.rot = best.a;
    if (/^(RAC_TE|RAC_TE_BRIDES|RAC_EF_TE)$/.test(def.sym)) {
      const tl = tol * 0.8; let br = null;
      ph.objects.forEach(function (K) {
        if (K.type !== 'line' || K === best.L) { return; }
        [[K.pts[0], K.pts[1]], [K.pts[K.pts.length - 1], K.pts[K.pts.length - 2]]].forEach(function (pr) {
          const e = pr[0], nb = pr[1];
          if (nb && Math.hypot(e.x - o.x, e.y - o.y) <= tl && (!br || Math.hypot(e.x - o.x, e.y - o.y) < br.d)) { br = { d: Math.hypot(e.x - o.x, e.y - o.y), a: Math.atan2(nb.y - o.y, nb.x - o.x) }; }
        });
      });
      if (br) { o.rot = br.a - Math.PI / 2; o.dirs3 = [best.a + Math.PI, best.a, br.a]; } else { delete o.dirs3; }
    }
    return true;
  }
  delete o.rot; delete o.dirs3; return false;
}

function drawAcc(c, o, ph, u) {
  const def = accOf(o.accId) || {}, col = accColor(o, ph, u), r = (o.size || 8) * u, sym = def.sym || '';
  if (o.dirs3 && /^(RAC_TE|RAC_TE_BRIDES|RAC_EF_TE)$/.test(sym)) { drawTee(c, o, r, u, col); }
  else if (o.dirs && o.dirs.length === 2 && /^RAC_COUDE/.test(sym)) { drawElbow(c, o, r, u, col); }
  else if (o.dirs && o.dirs.length === 2) { drawElbow(c, o, r, u, col); }
  else { drawSymbol(c, def, o.x, o.y, r, u, o.rot, col); }
}

// Encadré de texte (regard, accessoire) : fond blanc et bande de la couleur du réseau
function boxSize(c, lines, fs) {
  c.save();
  let mw = 0;
  lines.forEach((l, i) => { c.font = font(fs, i === 0 && l.b); mw = Math.max(mw, c.measureText(l.t).width); });
  c.restore();
  const hs = fs * 1.22, pad = fs * 0.5, stripe = fs * 0.28, vpad = fs * 0.3;
  return { w: mw + pad * 2 + stripe, h: lines.length * hs + vpad * 2, hs: hs, pad: pad, stripe: stripe, vpad: vpad };
}
function drawBox(c, lines, fs, col, x, y) {
  const m = boxSize(c, lines, fs);
  c.save();
  c.fillStyle = 'rgba(255,255,255,.93)'; c.strokeStyle = col; c.lineWidth = fs * 0.09;
  c.beginPath(); c.rect(x, y, m.w, m.h); c.fill(); c.stroke();
  c.fillStyle = col; c.fillRect(x, y, m.stripe, m.h);
  c.fillStyle = '#131B24'; c.textBaseline = 'middle'; c.textAlign = 'left';
  lines.forEach((l, i) => { c.font = font(fs, i === 0 && l.b); c.fillText(l.t, x + m.stripe + m.pad, y + m.vpad + m.hs * (i + 0.5)); });
  c.restore();
  return { x: x, y: y, w: m.w, h: m.h };
}

/* Placement automatique des textes : on essaie plusieurs positions autour de l'objet
   et on garde celle qui gêne le moins (autres textes, symboles, conduites). */
function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
function placeLabels(c, ph, u) {
  const boxes = [], syms = [], dots = [];
  ph.objects.forEach(function (o) {
    if (o.type === 'line' && o.pts.length > 1) {
      const L = polyLens(o.pts), step = Math.max(8 * u, 3);
      for (let t = 0; t <= L[L.length - 1]; t += step) { const q = pointAt(o.pts, L, t); dots.push(q); }
    } else if (o.type === 'manhole') { syms.push({ o: o, b: { x: o.cx - o.rx, y: o.cy - o.ry, w: 2 * o.rx, h: 2 * o.ry } }); }
    else if (o.type === 'acc') { const r = (o.size || 8) * u; syms.push({ o: o, b: { x: o.x - r, y: o.y - r, w: 2 * r, h: 2 * r } }); }
    else if ((o.type === 'text' || o.type === 'legend') && o._lb) { boxes.push(o._lb); }
  });
  const cost = (box, self) => {
    let sc = 0;
    boxes.forEach(b => { sc += overlapArea(box, b) / (box.w * box.h) * 600; });
    dots.forEach(q => { if (q.x >= box.x - 2 * u && q.x <= box.x + box.w + 2 * u && q.y >= box.y - 2 * u && q.y <= box.y + box.h + 2 * u) { sc += 30; } });
    syms.forEach(s => { if (s.o !== self && overlapArea(box, s.b) > 0) { sc += 300; } });
    return sc;
  };
  const spec = (o, k) => {
    let fs = (o.fs || S.fs) * u * k * TXTK;
    const lines = o.type === 'manhole' ? manholeLines(o) : accText(o).split('\n').filter(t => t.trim()).map((t, i) => ({ t: t, b: i === 0 }));
    let m = boxSize(c, lines, fs);
    const kk = ph.free ? 1 : Math.min(1, ph.w * 0.92 / m.w, ph.h * 0.92 / m.h);
    if (kk < 1) { fs *= kk; m = boxSize(c, lines, fs); }
    return { fs: fs, lines: lines, m: m };
  };
  const labelled = ph.objects.filter(o => (o.type === 'manhole' || o.type === 'acc') && o.showLabel !== false);
  // Les textes déplacés à la main occupent leur place d'abord
  labelled.forEach(function (o) {
    if (!o.lp) { return; }
    const m = spec(o, 1).m;
    boxes.push({ x: fitIn(ph, o.lp.x, m.w, 'w'), y: fitIn(ph, o.lp.y, m.h, 'h'), w: m.w, h: m.h });
  });
  const gaps = [8 * u, 8 * u + 9 * u, 8 * u + 18 * u], ang = [-45, 45, -135, 135, 0, 180, -90, 90, -20, 20, -160, 160];
  labelled.forEach(function (o) {
    if (o.lp) { o._ap = null; o._fk = 1; return; }
    const cx = o.type === 'manhole' ? o.cx : o.x, cy = o.type === 'manhole' ? o.cy : o.y, ext = o.type === 'manhole' ? Math.max(o.rx, o.ry) : (o.size || 8) * u;
    const attempt = (m) => {
      let best = null, bs = 1e18;
      gaps.forEach((g, gi) => ang.forEach((a, ai) => {
        const r = a * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
        let x = cx + co * (ext + g) - (co < -0.3 ? m.w : (Math.abs(co) <= 0.3 ? m.w / 2 : 0));
        let y = cy + si * (ext + g) - (si < -0.3 ? m.h : (Math.abs(si) <= 0.3 ? m.h / 2 : 0));
        x = fitIn(ph, x, m.w, 'w'); y = fitIn(ph, y, m.h, 'h');
        const raw = cost({ x: x, y: y, w: m.w, h: m.h }, o), sc = gi * 40 + ai * 3 + raw;
        if (sc < bs) { bs = sc; best = { x: x, y: y, raw: raw }; }
      }));
      return best;
    };
    // Si ça se chevauche, on réduit l'écriture par paliers
    let bestK = 1, bestRaw = 1e18;
    for (const k of (ph.free ? [1] : [1, 0.88, 0.76, 0.66, 0.56])) {
      const r = attempt(spec(o, k).m);
      if (r.raw < 25) { bestK = k; bestRaw = r.raw; break; }
      if (r.raw < bestRaw - 1) { bestRaw = r.raw; bestK = k; }
    }
    o._fk = bestK;
    const sp = spec(o, bestK), r = attempt(sp.m);
    boxes.push({ x: r.x, y: r.y, w: sp.m.w, h: sp.m.h });
    o._ap = { x: r.x, y: r.y };
  });
  spec.boxes = boxes;
  return spec;
}
function drawLabels(c, ph, u, spec) {
  ph.objects.forEach(function (o) {
    o._lbx = null;
    if ((o.type !== 'manhole' && o.type !== 'acc') || o.showLabel === false) { return; }
    const sp = spec(o, o._fk || 1);
    const pos = o.lp || o._ap;
    if (!pos) { return; }
    const m = sp.m, x = fitIn(ph, pos.x, m.w, 'w'), y = fitIn(ph, pos.y, m.h, 'h');
    const col = o.type === 'manhole' ? colOf(o.net || (mhOf(o.mhId) || {}).net) : accColor(o, ph, u);
    const cx = o.type === 'manhole' ? o.cx : o.x, cy = o.type === 'manhole' ? o.cy : o.y;
    const ext = o.type === 'manhole' ? Math.max(o.rx, o.ry) : (o.size || 8) * u;
    // Un trait relie le texte à l'objet quand il est éloigné
    const qx = clamp(cx, x, x + m.w), qy = clamp(cy, y, y + m.h);
    if (Math.hypot(qx - cx, qy - cy) > ext + 3 * u) {
      c.save(); c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2.6 * u; c.beginPath(); c.moveTo(cx, cy); c.lineTo(qx, qy); c.stroke();
      c.strokeStyle = col; c.lineWidth = 1.1 * u; c.stroke(); c.restore();
    }
    o._lbx = drawBox(c, sp.lines, sp.fs, col, x, y);
  });
}

// Texte libre
function drawText(c, o, u) {
  const fs = (o.fs || S.fs) * u, lines = String(o.text || '').split('\n').map((t, i) => ({ t: t, b: i === 0 }));
  const col = colOf(o.net || '');
  o._lb = drawBox(c, lines, fs, col === '#6b7480' ? '#4b5a6b' : col, o.x, o.y);
}

// Légende : un tableau des conduites, regards et accessoires utilisés
function legendRows(ph) {
  const rows = [], seenP = new Set(), seenM = new Set(), seenA = new Set();
  ph.objects.forEach(function (o) {
    if (o.type === 'line' && !seenP.has(o.pipeId)) { seenP.add(o.pipeId); const d = pipeOf(o.pipeId); if (d) { rows.push({ k: 'pipe', d: d }); } }
    if (o.type === 'manhole' && !seenM.has(o.mhId)) { seenM.add(o.mhId); const d = mhOf(o.mhId); if (d) { rows.push({ k: 'mh', d: d }); } }
    if (o.type === 'acc' && !o.auto && !seenA.has(o.accId)) { seenA.add(o.accId); const d = accOf(o.accId); if (d) { rows.push({ k: 'acc', d: d }); } }
  });
  return rows;
}
function drawLegend(c, o, ph, u) {
  const fs = (o.fs || S.fs * 0.9) * u * TXTK, rows = legendRows(ph), pad = fs * 0.6, hs = fs * 1.7, sw = fs * 3.2;
  c.save(); c.font = font(fs, false);
  let mw = c.measureText('Légende').width;
  const txt = rows.map(r => (r.k === 'pipe' ? ((netOf(r.d.net) || { name: '' }).name + ' : ' + r.d.desc) : r.d.name));
  txt.forEach(t => { mw = Math.max(mw, c.measureText(t).width + sw + fs * 0.6); });
  const w = mw + pad * 2, h = (rows.length + 1) * hs + pad;
  const x = fitIn(ph, o.x, w, 'w'), y = fitIn(ph, o.y, h, 'h');
  c.fillStyle = 'rgba(255,255,255,.93)'; c.strokeStyle = 'rgba(20,30,40,.5)'; c.lineWidth = u; c.beginPath(); c.rect(x, y, w, h); c.fill(); c.stroke();
  c.fillStyle = '#131B24'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = font(fs, true); c.fillText('Légende', x + pad, y + pad * 0.5 + hs * 0.5);
  rows.forEach(function (r, i) {
    const yy = y + pad * 0.5 + hs * (i + 1.5), xx = x + pad;
    c.font = font(fs, false); c.fillStyle = '#131B24'; c.textAlign = 'left'; c.fillText(txt[i], xx + sw + fs * 0.6, yy);
    if (r.k === 'pipe') {
      const col = colOf(r.d.net), lw = r.d.w * u; c.save(); c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + sw, yy); setDash(c, r.d.dash, lw); c.strokeStyle = col; c.lineWidth = lw; c.stroke(); c.restore();
    } else if (r.k === 'mh') {
      const col = colOf(r.d.net); c.save(); c.beginPath(); c.ellipse(xx + sw / 2, yy, sw * 0.36, fs * 0.5, 0, 0, 7); c.fillStyle = hexA(col, 0.28); c.fill(); c.strokeStyle = col; c.lineWidth = 2.4 * u; c.stroke(); c.restore();
    } else {
      c.save(); c.translate(xx + sw / 2, yy); shapePath(c, r.d.shape || 'circle', fs * 0.55); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2 * u; c.strokeStyle = colOf(r.d.net); c.stroke();
      if (r.d.letter) { c.font = font(fs * 0.55 * (r.d.letter.length > 1 ? 0.85 : 1.15), true); c.textAlign = 'center'; c.fillStyle = colOf(r.d.net); c.fillText(r.d.letter, 0, 0); }
      c.restore();
    }
  });
  c.restore();
  o._lb = { x: x, y: y, w: w, h: h };
}

// Croisements : la conduite du dessus devient transparente là où elle coupe un autre réseau
function computeCrossings(ph, u) {
  const lines = ph.objects.filter(o => o.type === 'line');
  lines.forEach(o => { o._cross = null; });
  if (S.crossTr === false) { return; }
  for (let j = 1; j < lines.length; j++) {
    const B = lines[j], pb = pipeOf(B.pipeId);
    if (!pb) { continue; }
    for (let i = 0; i < j; i++) {
      const A = lines[i], pa = pipeOf(A.pipeId);
      if (!pa || netCat(pa.net) === netCat(pb.net)) { continue; }
      for (let m = 0; m < A.pts.length - 1; m++) {
        for (let n = 0; n < B.pts.length - 1; n++) {
          const x = segX(A.pts[m], A.pts[m + 1], B.pts[n], B.pts[n + 1]);
          if (x) { (B._cross = B._cross || []).push({ x: x.x, y: x.y, r: Math.max(((pa.w || 4) + (pb.w || 4)) * u * 0.9, 7 * u) }); }
        }
      }
    }
  }
}
// Croisements eau potable / assainissement à contrôler
export function listCrossings(ph) {
  const lines = ph.objects.filter(o => o.type === 'line'), out = [];
  for (let j = 1; j < lines.length; j++) {
    const B = lines[j], pb = pipeOf(B.pipeId);
    if (!pb) { continue; }
    for (let i = 0; i < j; i++) {
      const A = lines[i], pa = pipeOf(A.pipeId);
      if (!pa) { continue; }
      const ca = netCat(pa.net), cb = netCat(pb.net);
      if (!((ca === 'aep' && (cb === 'eu' || cb === 'ep')) || (cb === 'aep' && (ca === 'eu' || ca === 'ep')))) { continue; }
      for (let m = 0; m < A.pts.length - 1; m++) {
        for (let n = 0; n < B.pts.length - 1; n++) {
          const x = segX(A.pts[m], A.pts[m + 1], B.pts[n], B.pts[n + 1]);
          if (x) { out.push({ x: x.x, y: x.y, a: pa.desc, b: pb.desc }); }
        }
      }
    }
  }
  return out;
}
function drawWarnings(c, ph, u) {
  if (S.warnCross !== true) { return; }
  const list = listCrossings(ph);
  c.save();
  list.forEach(function (q) {
    const r = 7 * u;
    c.beginPath(); c.moveTo(q.x, q.y - r * 1.15); c.lineTo(q.x + r * 1.1, q.y + r * 0.85); c.lineTo(q.x - r * 1.1, q.y + r * 0.85); c.closePath();
    c.fillStyle = '#FFB000'; c.strokeStyle = '#7a4b00'; c.lineWidth = 1.4 * u; c.fill(); c.stroke();
    c.fillStyle = '#3b2500'; c.font = 'bold ' + (r * 1.1) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', q.x, q.y + r * 0.15);
  });
  c.restore();
}

// Le rectangle qui entoure un objet (pour le cadre de sélection)
export function boundsOf(o, u) {
  if (o.type === 'line') {
    const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y), pad = 6 * u;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  }
  if (o.type === 'manhole') { return { x: o.cx - o.rx, y: o.cy - o.ry, w: 2 * o.rx, h: 2 * o.ry }; }
  if (o.type === 'acc') { const r = (o.size || 8) * u * 1.3; return { x: o.x - r, y: o.y - r, w: 2 * r, h: 2 * r }; }
  const b = o._lb || { x: o.x, y: o.y, w: 80, h: 30 };
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/* Dessine tout le repérage.
   opt.selected : liste d'identifiants sélectionnés (cadre + poignées)
   opt.ui       : true à l'écran, false pour l'export de l'image */
export function draw(c, ph, u, opt) {
  opt = opt || {};
  computeCrossings(ph, u);
  const lines = ph.objects.filter(o => o.type === 'line');
  lines.forEach(o => drawLine(c, o, u, 'cas'));
  lines.forEach(o => drawLine(c, o, u, 'fill'));
  ph.objects.filter(o => o.type === 'manhole').forEach(o => drawManhole(c, o, u));
  ph.objects.filter(o => o.type === 'acc').forEach(o => drawAcc(c, o, ph, u));
  drawWarnings(c, ph, u);
  LBL_PLACED = []; LBL_AVOID = []; LBL_LINES = [];
  ph.objects.forEach(o => {
    if (o.type === 'acc') { LBL_AVOID.push({ x: o.x, y: o.y, r: (o.size || 8) * u * 1.5 }); }
    else if (o.type === 'manhole') { LBL_AVOID.push({ x: o.cx, y: o.cy, r: Math.max(o.rx, o.ry) * 1.1 }); }
    else if (o.type === 'line' && o.pts.length > 1) { const L = polyLens(o.pts); for (let t = 0; t <= L[L.length - 1]; t += 4 * u) { const q = pointAt(o.pts, L, t); LBL_LINES.push({ x: q.x, y: q.y, o: o.id }); } }
  });
  // les encadrés (regards, accessoires) sont placés d'abord ; les textes de conduite les évitent ensuite
  const spec = placeLabels(c, ph, u);
  LBL_RECTS = spec.boxes || [];
  lines.forEach(o => drawLineLabel(c, o, u, ph));
  drawLabels(c, ph, u, spec);
  ph.objects.filter(o => o.type === 'text').forEach(o => drawText(c, o, u));
  ph.objects.filter(o => o.type === 'legend').forEach(o => drawLegend(c, o, ph, u));
  if (opt.ui && opt.selected && opt.selected.length) {
    c.save();
    c.lineWidth = 1.6 * u; c.strokeStyle = '#12b5f0'; c.setLineDash([5 * u, 3 * u]);
    ph.objects.forEach(function (o) {
      if (opt.selected.indexOf(o.id) < 0) { return; }
      const b = boundsOf(o, u);
      c.strokeRect(b.x - 2 * u, b.y - 2 * u, b.w + 4 * u, b.h + 4 * u);
    });
    c.setLineDash([]);
    ph.objects.forEach(function (o) {
      if (opt.selected.indexOf(o.id) < 0 || opt.selected.length > 1) { return; }
      handlesOf(o, u).forEach(function (h) {
        c.beginPath(); c.arc(h.x, h.y, (h.k === 'm' ? 3.6 : 5.4) * u * (opt.hs || 1), 0, Math.PI * 2);
        c.fillStyle = h.k === 'm' ? 'rgba(255,255,255,.6)' : '#fff'; c.fill(); c.strokeStyle = '#12b5f0'; c.lineWidth = 1.6 * u * (opt.hs || 1); c.stroke();
      });
    });
    c.restore();
  }
}

// Les poignées d'un objet : sommets et milieux d'une conduite, taille d'un regard ou d'un accessoire
export function handlesOf(o, u) {
  const hs = [];
  if (o.type === 'line') {
    o.pts.forEach((p, i) => hs.push({ id: 'v' + i, x: p.x, y: p.y, k: 'v', i: i }));
    for (let i = 0; i < o.pts.length - 1; i++) { hs.push({ id: 'm' + i, x: (o.pts[i].x + o.pts[i + 1].x) / 2, y: (o.pts[i].y + o.pts[i + 1].y) / 2, k: 'm', i: i }); }
  } else if (o.type === 'manhole') {
    const co = Math.cos(o.rot || 0), si = Math.sin(o.rot || 0), at = (lx, ly) => ({ x: o.cx + lx * co - ly * si, y: o.cy + lx * si + ly * co });
    [['rx+', o.rx, 0], ['rx-', -o.rx, 0], ['ry+', 0, o.ry], ['ry-', 0, -o.ry]].forEach(function (a) { const p = at(a[1], a[2]); hs.push({ id: a[0], x: p.x, y: p.y, k: 's' }); });
    const r = at(0, -o.ry - 24 * u); hs.push({ id: 'rot', x: r.x, y: r.y, k: 'r' });
  }
  else if (o.type === 'acc') { hs.push({ id: 'size', x: o.x + (o.size || 8) * u, y: o.y, k: 's' }); }
  return hs;
}

// Quel objet se trouve au point p ? Renvoie { o, label } ou null
export function hitTest(ph, p, u, tol) {
  for (let i = ph.objects.length - 1; i >= 0; i--) {
    const o = ph.objects[i];
    if ((o.type === 'manhole' || o.type === 'acc') && o._lbx && p.x >= o._lbx.x && p.x <= o._lbx.x + o._lbx.w && p.y >= o._lbx.y && p.y <= o._lbx.y + o._lbx.h) { return { o: o, label: true }; }
  }
  for (let i = ph.objects.length - 1; i >= 0; i--) {
    const o = ph.objects[i];
    if (o.type === 'manhole') {
      const co = Math.cos(-(o.rot || 0)), si = Math.sin(-(o.rot || 0)), dx = p.x - o.cx, dy = p.y - o.cy, lx = dx * co - dy * si, ly = dx * si + dy * co, rx = o.rx + tol, ry = o.ry + tol;
      if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) { return { o: o }; }
    }
    else if (o.type === 'acc') { if (Math.hypot(p.x - o.x, p.y - o.y) <= (o.size || 8) * u * 1.25 + tol) { return { o: o }; } }
    else if (o.type === 'text' || o.type === 'legend') { const b = o._lb; if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { return { o: o }; } }
  }
  for (let i = ph.objects.length - 1; i >= 0; i--) {
    const o = ph.objects[i];
    if (o.type !== 'line') { continue; }
    const w = ((pipeOf(o.pipeId) || { w: 4 }).w * u) / 2;
    for (let k = 0; k < o.pts.length - 1; k++) { if (segProj(p, o.pts[k], o.pts[k + 1]).d <= w + tol) { return { o: o }; } }
  }
  return null;
}


/* ---------- 7. Automatismes ---------- */

// --- 7a. Branchement automatique : depuis la conduite la plus proche vers le point cliqué ---
function branchPipeFor(cat, fallback, armedId) {
  const arm = pipeOf(armedId);
  if (arm && arm.dash === 'dotted' && netCat(arm.net) === cat) { return arm.id; }
  const list = S.pipes.filter(q => q.dash === 'dotted' && netCat(q.net) === cat);
  const c2 = list.find(q => /_n$/.test(q.net) && !/existant|abandon/i.test(q.desc || '')) || list[0];
  return c2 ? c2.id : fallback;
}
// Fin d'un branchement : un regard de branchement en assainissement, sinon rien
function branchEnd(ph, cat, c, u, news) {
  if (cat === 'eu' || cat === 'ep') {
    const m = S.manholes.find(q => netCat(q.net) === cat && /branchement|boîte|boite|bte/i.test(q.name || ''));
    if (m) {
      const r = 8 * u, mo = { id: uid(), type: 'manhole', mhId: m.id, cx: c.x, cy: c.y, rx: r, ry: r, rot: 0, num: nextNum(ph, m), nature: m.nature, diam: m.diam, extra: '' };
      news.push(mo);
      return { x: c.x, y: c.y, link: { k: 'mh', id: mo.id } };
    }
  }
  return { x: c.x, y: c.y };
}
export function autoBranch(ph, p, u, armedPipeId, tol) {
  let tg = snapTarget(ph, p, u, tol, null);
  if (tg && tg.k === 'ln') { tg = null; }
  const c = tg ? (tg.k === 'mh' ? { x: tg.o.cx, y: tg.o.cy } : { x: tg.o.x, y: tg.o.y }) : p;
  let best = null;
  ph.objects.forEach(function (L) {
    if (L.type !== 'line') { return; }
    const pd = pipeOf(L.pipeId);
    if (!pd || pd.dash === 'dotted' || /branchement/i.test(pd.desc || '')) { return; }
    for (let i = 0; i < L.pts.length - 1; i++) {
      const r = segProj(c, L.pts[i], L.pts[i + 1]);
      if (!best || r.d < best.d) { best = Object.assign({ L: L, seg: i, pd: pd }, r); }
    }
  });
  if (!best) { return { error: "Tracez d'abord une conduite principale : le branchement part de la plus proche." }; }
  const cat = netCat(best.pd.net), pid = branchPipeFor(cat, best.pd.id, armedPipeId);
  const start = { x: best.x, y: best.y, link: { k: 'ln', id: best.L.id, seg: best.seg, t: best.t < 0.04 ? 0 : (best.t > 0.96 ? 1 : best.t) } };
  const news = [];
  const end = tg ? { x: c.x, y: c.y, link: { k: tg.k, id: tg.id } } : branchEnd(ph, cat, c, u, news);
  const L = newLine([start, end], pid);
  ph.objects.push(...news, L);
  return { line: L, msg: 'Branchement créé.' };
}

// --- 7b. Tracé parallèle ---
function parallelBranches(ph, src, o, u) {
  const cat = netCat((pipeOf(o.pipeId) || {}).net), pid = branchPipeFor(cat, o.pipeId, null), out = [];
  ph.objects.forEach(function (B) {
    if (B.type !== 'line' || B === src || B === o) { return; }
    const pd = pipeOf(B.pipeId);
    if (!pd || pd.dash !== 'dotted') { return; }
    const n = B.pts.length;
    for (const pair of [[0, n - 1], [n - 1, 0]]) {
      const a = B.pts[pair[0]];
      let attached = !!(a.link && a.link.k === 'ln' && a.link.id === src.id), seg = -1;
      for (let i = 0; i < src.pts.length - 1; i++) {
        if (segProj(a, src.pts[i], src.pts[i + 1]).d < 6 * u) { attached = true; seg = i; break; }
      }
      if (!attached) { continue; }
      if (seg < 0) { seg = a.link && a.link.seg != null ? a.link.seg : 0; }
      const sa = src.pts[seg], sb = src.pts[seg + 1];
      if (!sb) { continue; }
      const dl = Math.hypot(sb.x - sa.x, sb.y - sa.y) || 1, F = B.pts[pair[1]];
      const F2 = { x: F.x + (sb.x - sa.x) / dl * 30 * u, y: F.y + (sb.y - sa.y) / dl * 30 * u };
      let best = null;
      for (let i = 0; i < o.pts.length - 1; i++) {
        const r = segProj(F2, o.pts[i], o.pts[i + 1]);
        if (!best || r.d < best.d) { best = Object.assign({ seg: i }, r); }
      }
      if (!best) { continue; }
      const news = [], end = branchEnd(ph, cat, F2, u, news);
      const L = newLine([{ x: best.x, y: best.y, link: { k: 'ln', id: o.id, seg: best.seg, t: best.t < 0.04 ? 0 : (best.t > 0.96 ? 1 : best.t) } }, end], pid);
      out.push(...news, L);
      break;
    }
  });
  return out;
}
// Choisit la conduite par défaut du tracé parallèle : eau potable <-> assainissement
export function defaultParallelPipe(src) {
  const pd = pipeOf(src.pipeId), cat = netCat(pd && pd.net), want = cat === 'aep' ? 'eu_n' : 'aep_n';
  const c = S.pipes.find(p => p.net === want && p.dash !== 'dotted') || S.pipes.find(p => netCat(p.net) === (cat === 'aep' ? 'eu' : 'aep') && p.dash !== 'dotted');
  return c ? c.id : src.pipeId;
}
// side : 'left' ou 'right' ; dist en unités u ; keep : le tracé suit l'origine tant qu'on ne le modifie pas
export function genParallel(ph, src, pid, side, dist, keep, u) {
  const d = dist * u * (side === 'left' ? 1 : -1), pts = offsetPts(src.pts, d);
  if (pts.length < 2) { return { error: 'Tracé trop court.' }; }
  const o = newLine(pts, pid);
  if (keep) { o.par = { src: src.id, d: d, mine: ptSig(pts), ssig: ptSig(src.pts) }; }
  const br = parallelBranches(ph, src, o, u);
  ph.objects.push(o, ...br);
  return { line: o, branches: br.filter(x => x.type === 'line').length };
}
// Un tracé parallèle suit son origine tant qu'on ne l'a pas modifié lui-même
function syncParallels(ph) {
  let ch = false;
  ph.objects.forEach(function (o) {
    if (o.type !== 'line' || !o.par) { return; }
    const src = ph.objects.find(x => x.id === o.par.src && x.type === 'line');
    if (!src || ptSig(o.pts) !== o.par.mine) { delete o.par; ch = true; return; }
    const ss = ptSig(src.pts);
    if (ss !== o.par.ssig) { o.pts = offsetPts(src.pts, o.par.d); o.par.mine = ptSig(o.pts); o.par.ssig = ss; ch = true; }
  });
  return ch;
}

// --- 7c. Diamètre des vannes, ventouses, purges : celui de la conduite sur laquelle elles sont posées ---
const accDiaOn = def => def && /vanne|ventouse|purge|vidange|clapet|réducteur de pression/i.test(def.name || '') && /\{d\}/.test(def.tpl || '') && !/\{d2\}/.test(def.tpl || '');
function syncAccDia(ph, u) {
  let ch = false;
  const lines = ph.objects.filter(o => o.type === 'line' && o.pts.length >= 2).map(o => ({ o: o, pd: pipeOf(o.pipeId) })).filter(x => x.pd && /^aep/.test(x.pd.net));
  if (!lines.length) { return false; }
  ph.objects.forEach(function (o) {
    if (o.type !== 'acc' || o.auto || o.dManual) { return; }
    const def = accOf(o.accId);
    if (!accDiaOn(def)) { return; }
    const tol = Math.max((o.size || 8) * 1.6, 10) * u;
    let best = null;
    lines.forEach(function (L) {
      for (let i = 0; i < L.o.pts.length - 1; i++) {
        const r = segProj(o, L.o.pts[i], L.o.pts[i + 1]);
        if (r.d < tol && (!best || r.d < best.d)) { best = { d: r.d, pd: L.pd }; }
      }
    });
    if (!best) { return; }
    const dn = dnFromPipe(best.pd.desc);
    if (!dn) { return; }
    const v = /^DN/i.test(def.d || '') ? 'DN' + dn : String(dn);
    if (o.d !== v) { o.d = v; ch = true; }
  });
  return ch;
}

// --- 7d. Raccords automatiques sur l'eau potable : coudes, tés, réductions, raccords sur existant ---
function syncFittings(ph, u) {
  const dia = syncAccDia(ph, u);
  if (!S.autoFit) {
    const n = ph.objects.length;
    ph.objects = ph.objects.filter(o => !o.auto);
    return ph.objects.length !== n || dia;
  }
  const tol = 9 * u;
  resolveLinks(ph);
  const mains = ph.objects.filter(o => o.type === 'line' && o.pts.length >= 2).map(o => ({ o: o, pd: pipeOf(o.pipeId) })).filter(x => x.pd && /^aep/.test(x.pd.net) && x.pd.dash !== 'dotted' && !x.o.kit);
  const want = new Map();
  const kindOn = k => (k === 'rd' || k === 'rp') ? S.autoRac !== false : k === 'br' ? S.autoBr !== false : k === 'cit' ? S.autoCit !== false : (k === 'c45' || k === 'c90') ? S.autoCoude : k === 'te' ? S.autoTe : S.autoRed;
  const add = (key, kind, pos, net, owner, extra) => {
    if (!kindOn(kind) || (owner.noFit && owner.noFit.indexOf(key) >= 0)) { return; }
    want.set(key, Object.assign({ kind: kind, pos: pos, net: net }, extra || {}));
  };
  const ends = o => [['h', o.pts[0], o.pts[1]], ['t', o.pts[o.pts.length - 1], o.pts[o.pts.length - 2]]];
  const unitV = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  const angleBetween = (vA, vB) => Math.acos(clamp(vA.x * vB.x + vA.y * vB.y, -1, 1)) * 180 / Math.PI;
  // Un changement de direction au milieu d'un tracé (conduite ou branchement)
  const bends = (A, small) => {
    if (!S.autoCoude) { return; }
    for (let i = 1; i < A.o.pts.length - 1; i++) {
      const p = A.o.pts[i], q = A.o.pts[i - 1], n = A.o.pts[i + 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) < 0.8 * u || Math.hypot(n.x - p.x, n.y - p.y) < 0.8 * u) { continue; }
      const vA = unitV(p, q), vB = unitV(p, n), defl = 180 - angleBetween(vA, vB);
      if (defl < 1) { continue; }
      add(A.o.id + ':v' + i, defl <= 67 ? 'c45' : 'c90', p, A.pd.net, A.o, { small: !!small, dirs: [Math.atan2(vA.y, vA.x), Math.atan2(vB.y, vB.x)], space: Math.min(Math.hypot(p.x - q.x, p.y - q.y), Math.hypot(n.x - p.x, n.y - p.y)) });
    }
  };
  mains.forEach(function (A) {
    bends(A, false);
    ends(A.o).forEach(function (eA) {
      const pA = eA[1], nA = eA[2];
      mains.forEach(function (B) {
        if (B === A) { return; }
        let hit = false;
        ends(B.o).forEach(function (eB) {
          const pB = eB[1], nB = eB[2];
          if (Math.hypot(pA.x - pB.x, pA.y - pB.y) >= tol) { return; }
          hit = true;
          if (A.o.id > B.o.id) { return; }
          const vA = unitV(pA, nA), vB = unitV(pB, nB), defl = 180 - angleBetween(vA, vB);
          const sp = Math.min(Math.hypot(pA.x - nA.x, pA.y - nA.y), Math.hypot(pB.x - nB.x, pB.y - nB.y));
          const rn = isNew(A.pd) && isExist(B.pd) ? [A, B] : (isNew(B.pd) && isExist(A.pd) ? [B, A] : null);
          const key = A.o.id + ':' + eA[0] + '~' + B.o.id + ':' + eB[0];
          if (rn) {
            add(key, 'rd', pA, rn[0].pd.net, A.o, { label: true, space: sp, rot: Math.atan2(vA.y, vA.x), m1: matName(rn[1].pd.desc), d: diamOf(rn[1].pd.desc), m2: matName(rn[0].pd.desc), d2: diamOf(rn[0].pd.desc) });
            return;
          }
          let kind = null;
          if (defl < 1) {
            if (Math.abs((A.pd.w || 0) - (B.pd.w || 0)) > 0.01) { kind = 'red'; }
            else if (matOf(A.pd.desc) && matOf(B.pd.desc) && matOf(A.pd.desc) !== matOf(B.pd.desc)) { kind = 'trans'; }
          } else { kind = defl <= 67 ? 'c45' : 'c90'; }
          if (kind) { add(key, kind, pA, A.pd.net, A.o, (kind === 'c45' || kind === 'c90') ? { dirs: [Math.atan2(vA.y, vA.x), Math.atan2(vB.y, vB.x)], space: sp } : { space: sp }); }
        });
        if (hit) { return; }
        // Le bout de A touche le milieu de B : c'est un té
        for (let i = 0; i < B.o.pts.length - 1; i++) {
          const r = segProj(pA, B.o.pts[i], B.o.pts[i + 1]);
          if (r.d < tol && Math.hypot(r.x - B.o.pts[0].x, r.y - B.o.pts[0].y) > tol && Math.hypot(r.x - B.o.pts[B.o.pts.length - 1].x, r.y - B.o.pts[B.o.pts.length - 1].y) > tol) {
            const vT = unitV(pA, nA), rotT = Math.atan2(vT.y, vT.x) - Math.PI / 2, aM = Math.atan2(B.o.pts[i + 1].y - B.o.pts[i].y, B.o.pts[i + 1].x - B.o.pts[i].x);
            const d3 = [aM + Math.PI, aM, Math.atan2(vT.y, vT.x)];
            const spt = Math.min(Math.hypot(pA.x - nA.x, pA.y - nA.y), Math.hypot(r.x - B.o.pts[i].x, r.y - B.o.pts[i].y), Math.hypot(r.x - B.o.pts[i + 1].x, r.y - B.o.pts[i + 1].y));
            const key = A.o.id + ':' + eA[0] + '@' + B.o.id;
            if (isNew(A.pd) && isExist(B.pd)) { add(key, 'rp', { x: r.x, y: r.y }, A.pd.net, A.o, { label: true, space: spt, rot: rotT, dirs3: d3, m1: matName(B.pd.desc), d: diamOf(B.pd.desc), m2: matName(A.pd.desc), d2: diamOf(A.pd.desc) }); }
            else { add(key, 'te', { x: r.x, y: r.y }, A.pd.net, A.o, { space: spt, rot: rotT, dirs3: d3 }); }
            break;
          }
        }
      });
    });
  });
  // Les branchements (pointillés) : une prise à la base du trait, un citerneau au bout libre
  const brs = ph.objects.filter(o => o.type === 'line' && o.pts.length >= 2).map(o => ({ o: o, pd: pipeOf(o.pipeId) })).filter(x => x.pd && /^aep/.test(x.pd.net) && x.pd.dash === 'dotted' && !x.o.kit);
  brs.forEach(bends.bind(null));
  const mainNear = pt => {
    let best = null;
    mains.forEach(function (B) { for (let i = 0; i < B.o.pts.length - 1; i++) { const r = segProj(pt, B.o.pts[i], B.o.pts[i + 1]); if (r.d < tol && (!best || r.d < best.d)) { best = { d: r.d, x: r.x, y: r.y }; } } });
    return best;
  };
  const occupied = (pt, self) => ph.objects.some(function (o) {
    if (o.type === 'manhole') { return Math.hypot(pt.x - o.cx, pt.y - o.cy) <= Math.max(o.rx, o.ry) + tol; }
    if (o.type === 'acc' && !o.auto) { return Math.hypot(pt.x - o.x, pt.y - o.y) <= (o.size || 8) * u * 1.3 + tol; }
    if (o.type === 'line' && o !== self && o.pts.length >= 2) { return [o.pts[0], o.pts[o.pts.length - 1]].some(q => Math.hypot(pt.x - q.x, pt.y - q.y) < tol); }
    return false;
  });
  brs.forEach(function (A) {
    const es = ends(A.o), near = es.map(e => mainNear(e[1]));
    es.forEach(function (e, k) {
      const sp = Math.hypot(e[1].x - e[2].x, e[1].y - e[2].y);
      if (near[k]) { add(A.o.id + ':' + e[0] + '#br', 'br', { x: near[k].x, y: near[k].y }, A.pd.net, A.o, { space: sp }); }
      else if (near.some(Boolean) && !occupied(e[1], A.o)) { add(A.o.id + ':' + e[0] + '#ct', 'cit', { x: e[1].x, y: e[1].y }, A.pd.net, A.o, { space: sp, u: u }); }
    });
  });
  // Mise à jour des objets automatiques : suppression, déplacement, création
  const sizeOf = w => {
    if (w.kind === 'br') { return 2.5; }
    if (w.kind === 'cit') { return w.space != null ? Math.max(3, Math.min(8, 0.3 * w.space / (w.u || 1))) : 8; }
    const mx = w.small ? 6.5 : 10, f = (w.kind === 'c45' || w.kind === 'c90') ? 0.3 : 0.2;
    return w.space != null ? Math.max(2.5, Math.min(mx, f * w.space / u)) : mx;
  };
  let changed = dia;
  const have = new Map(ph.objects.filter(o => o.auto).map(o => [o.auto, o]));
  have.forEach(function (o, k) {
    if (o.accId !== o.autoId) {
      // L'utilisateur a changé le type de l'accessoire : il devient libre
      const L = ph.objects.find(l => l.id === k.split(':')[0]);
      if (L) { (L.noFit = L.noFit || []).push(k); }
      delete o.auto; delete o.autoId; have.delete(k); changed = true; return;
    }
    if (!want.has(k)) { ph.objects.splice(ph.objects.indexOf(o), 1); changed = true; }
  });
  want.forEach(function (w, k) {
    const def = FIT_DEFS[w.kind], id = def.id, o = have.get(k), ns = sizeOf(w);
    if (o) {
      if (o.autoSize == null || o.size === o.autoSize) { if (Math.abs((o.size || 0) - ns) > 0.05) { o.size = ns; o.autoSize = ns; changed = true; } }
      const dj = JSON.stringify(w.dirs || null), dj3 = JSON.stringify(w.dirs3 || null);
      if (Math.abs(o.x - w.pos.x) > 0.01 || Math.abs(o.y - w.pos.y) > 0.01 || o.accId !== id || o.net !== w.net || JSON.stringify(o.dirs || null) !== dj || JSON.stringify(o.dirs3 || null) !== dj3 || Math.abs((o.rot || 0) - (w.rot || 0)) > 1e-3) {
        o.x = w.pos.x; o.y = w.pos.y; o.accId = id; o.autoId = id; o.net = w.net;
        if (w.dirs) { o.dirs = w.dirs; } else { delete o.dirs; }
        if (w.dirs3) { o.dirs3 = w.dirs3; } else { delete o.dirs3; }
        if (w.rot != null) { o.rot = w.rot; } else { delete o.rot; }
        changed = true;
      }
    } else {
      const d = accOf(id) || {};
      ph.objects.push({ id: uid(), type: 'acc', accId: id, x: w.pos.x, y: w.pos.y, net: w.net, m1: w.m1 != null ? w.m1 : (d.m1 || ''), m2: w.m2 != null ? w.m2 : (d.m2 || ''), d: w.d != null ? w.d : (d.d || ''), d2: w.d2 != null ? w.d2 : (d.d2 || ''), note: '', text: '', size: ns, autoSize: ns, showLabel: !!w.label, auto: k, autoId: id, lp: null, dirs: w.dirs || undefined, dirs3: w.dirs3 || undefined, rot: w.rot != null ? w.rot : undefined });
      changed = true;
    }
  });
  return changed;
}

// --- 7e. Montages d'accessoires (té + vanne + purge...) ---
export const kitsToText = K => K.map(k => (k.on === false ? '# ' : '') + k.trig + ' : ' + k.pieces.join(' > ') + ' | DN : ' + (k.dn.every(r => !r[1]) ? 'identique à la conduite' : k.dn.map(r => (r[0] >= 99999 ? 'au-delà' : 'jusqu’à ' + r[0]) + ' = ' + r[1]).join(' ; '))).join('\n');
export function kitsFromText(t) {
  const out = [];
  t.split('\n').forEach(function (l) {
    l = l.trim();
    if (!l) { return; }
    let on = true;
    if (l[0] === '#') { on = false; l = l.replace(/^#\s*/, ''); }
    const parts = l.split('|'), m = parts[0].split(':');
    if (m.length < 2) { return; }
    const trig = m[0].trim(), pieces = m.slice(1).join(':').split(/>|,/).map(x => x.trim()).filter(Boolean), dn = [];
    if (/identique|m[eê]me|conduite/i.test(parts[1] || '')) { dn.push([99999, 0]); }
    else {
      (parts[1] || '').replace(/^\s*DN\s*:/i, '').split(';').forEach(function (x) {
        const nums = x.match(/\d+/g);
        if (!nums) { return; }
        if (/au.?del/i.test(x)) { dn.push([99999, +nums[0]]); } else if (nums.length >= 2) { dn.push([+nums[0], +nums[1]]); }
      });
    }
    dn.sort((p, q) => p[0] - q[0]);
    if (!dn.length) { dn.push([99999, 60]); }
    if (trig && pieces.length) { out.push({ on: on, trig: trig, pieces: pieces, dn: dn }); }
  });
  return out;
}
const kitRuleOf = trig => (S.kits || []).find(r => nrm(r.trig) === nrm(trig));
function kitDef(name, armedDef) {
  const n = nrm(name);
  if (armedDef && nrm(armedDef.name).startsWith(n)) { return armedDef; }
  return S.accessories.find(a => nrm(a.name).startsWith(n) && /^aep/.test(a.net)) || S.accessories.find(a => nrm(a.name).startsWith(n)) || null;
}
function kitBranchPipe(pd, brOd) {
  const mat = q => String(q.desc).replace(/^[^A-Za-z]*\d+[\s,.]*\d*\s*/, '').trim();
  const sc = q => Math.abs(odNum(q) - brOd) + (mat(q) === mat(pd) ? 0 : 0.5);
  return S.pipes.filter(q => q.net === pd.net && q.dash !== 'dotted').sort((x, y) => sc(x) - sc(y))[0] || pd;
}
// Pose un accessoire. Si c'est le déclencheur d'un montage et qu'il est posé près d'une conduite d'eau,
// toutes les pièces du montage sont posées d'un coup. Renvoie { objs, sel, msg } ou null.
export function placeAcc(ph, p, def, u, tol) {
  const kit = S.kitsOn !== false && def && (S.kits || []).find(k => k.on !== false && nrm(def.name).startsWith(nrm(k.trig)));
  if (!kit) { return null; }
  let best = null;
  ph.objects.forEach(function (L) {
    if (L.type !== 'line') { return; }
    const pd = pipeOf(L.pipeId);
    if (!pd || !/^aep/.test(pd.net) || pd.dash === 'dotted') { return; }
    for (let i = 0; i < L.pts.length - 1; i++) {
      const r = segProj(p, L.pts[i], L.pts[i + 1]);
      if (r.d <= tol && (!best || r.d < best.d)) { best = Object.assign({}, r, { L: L, pd: pd, a: Math.atan2(L.pts[i + 1].y - L.pts[i].y, L.pts[i + 1].x - L.pts[i].x) }); }
    }
  });
  if (!best) { return null; }
  const mainDn = dnFromPipe(best.pd.desc) || 100, mainOd = parseFloat(String(diamOf(best.pd.desc)).replace(',', '.')) || mainDn;
  const row = kit.dn.find(r => mainDn <= r[0]) || kit.dn[kit.dn.length - 1], brDn = row[1], brOd = odOfDn(brDn);
  const defs = kit.pieces.map(n => kitDef(n, def));
  if (defs.some(d => !d)) { return null; }
  const names = defs.map(d => d.name.replace(/\s*(DN\s*)?\d+.*$/, '')).join(' → ');
  const base = d => ({ id: uid(), type: 'acc', accId: d.id, m1: d.m1, m2: d.m2, note: '', text: '', size: 8, kit: null, kg: true });
  if (kit.dn.every(r => !r[1])) {
    // Montage en ligne sur la conduite (vanne > clapet > vanne...)
    const n = defs.length, step = 44 * u, s0 = polyProjS(best.L.pts, { x: best.x, y: best.y }).s, kid = uid(), objs = [];
    defs.forEach(function (d, i) {
      const sv = s0 + (i - (n - 1) / 2) * step, q = polyAtS(best.L.pts, sv), o = base(d);
      Object.assign(o, { x: q.x, y: q.y, d: fmtDn(mainDn, d.d), d2: d.d2, kit: kid, dManual: true, kmain: best.L.id, ks: sv, kinl: true, ktrig: kit.trig, kmd: mainDn, kbd: mainDn });
      objs.push(o);
    });
    ph.objects.push(...objs);
    return { objs: objs, sel: objs.find((o, i) => defs[i] === def) || objs[objs.length - 1], msg: 'Montage posé : ' + names + '.' };
  }
  const n = defs.length, step = 44 * u;
  let dx = p.x - best.x, dy = p.y - best.y, dist = Math.hypot(dx, dy);
  if (dist < 8 * u) { dx = -Math.sin(best.a); dy = Math.cos(best.a); dist = 0; } else { dx /= dist; dy /= dist; }
  const total = Math.max(dist, (n - 1) * step), inside = q => ph.free || (q.x >= 0 && q.x <= ph.w && q.y >= 0 && q.y <= ph.h);
  if (!inside({ x: best.x + dx * total, y: best.y + dy * total })) { dx = -dx; dy = -dy; }
  const E = { x: best.x + dx * total, y: best.y + dy * total }, kid = uid(), objs = [];
  const branch = { id: uid(), type: 'line', pipeId: kitBranchPipe(best.pd, brOd).id, pts: [{ x: best.x, y: best.y }, { x: E.x, y: E.y }], kit: kid, kg: true, kbr: true };
  objs.push(branch);
  const pieces = [];
  defs.forEach(function (d, i) {
    const t = n > 1 ? i / (n - 1) : 1, two = /\{d2\}/.test(d.tpl || ''), o = base(d);
    Object.assign(o, { x: best.x + dx * total * t, y: best.y + dy * total * t, d: two ? String(mainOd) : fmtDn(brDn, d.d), d2: two ? String(brOd) : d.d2, kit: kid, dManual: true });
    if (i === 0) { o.kmain = best.L.id; o.ks = polyProjS(best.L.pts, { x: best.x, y: best.y }).s; o.ktrig = kit.trig; o.kmd = mainDn; o.kbd = brDn; }
    else if (i === n - 1) { o.kend = true; } else { o.kt = t; }
    pieces.push(o); objs.push(o);
  });
  ph.objects.push(...objs);
  return { objs: objs, sel: pieces[pieces.length - 1], msg: 'Montage posé : ' + names + '.' };
}
// Les pièces d'un montage restent collées : té sur la conduite, vanne sur le piquage, bout qui entraîne le tracé
function syncKits(ph, moved) {
  const kits = new Map();
  ph.objects.forEach(function (o) {
    if (!o.kit) { return; }
    let k = kits.get(o.kit);
    if (!k) { k = { T: null, B: null, E: null, P: [], I: [], free: false }; kits.set(o.kit, k); }
    if (o.kg === false) { k.free = true; }
    if (o.type === 'line') { k.B = o; } else if (o.kinl) { k.I.push(o); } else if (o.kmain !== undefined) { k.T = o; } else if (o.kend) { k.E = o; } else if (o.kt !== undefined) { k.P.push(o); }
  });
  let ch = false;
  const mv = new Set(moved || []);
  const setD = (o, v) => { const def = accOf(o.accId), nd = fmtDn(v, def && def.d); if (o.d !== nd) { o.d = nd; ch = true; } };
  kits.forEach(function (k) {
    if (k.free) { return; }
    const T = k.T, B = k.B, E = k.E, P = k.P, I = k.I;
    if (I.length) {
      // Montage en ligne
      const M = ph.objects.find(x => x.id === I[0].kmain && x.type === 'line');
      if (!M || M.pts.length < 2) { return; }
      I.sort((p, q) => p.ks - q.ks);
      const pm = I.find(o => mv.has(o));
      if (pm) { const ds = polyProjS(M.pts, { x: pm.x, y: pm.y }).s - pm.ks; I.forEach(o => { o.ks += ds; }); }
      const pd = pipeOf(M.pipeId);
      if (pd) {
        const mainDn = dnFromPipe(pd.desc) || I[0].kmd;
        let dn = I[0].kbd;
        if (mainDn !== I[0].kmd) { dn = mainDn; I.forEach(o => { o.kmd = mainDn; }); }
        else { const e = I.find(o => { const v = dnOfNum(o.d); return v && v !== I[0].kbd; }); if (e) { dn = dnOfNum(e.d); } }
        if (dn !== I[0].kbd || I.some(o => dnOfNum(o.d) !== dn)) { I.forEach(o => { setD(o, dn); o.kbd = dn; }); ch = true; }
      }
      const tot = polyProjS(M.pts, { x: 0, y: 0 }).total;
      I.forEach(function (o) {
        o.ks = clamp(o.ks, 0, tot);
        const q = polyAtS(M.pts, o.ks);
        if (Math.abs(o.x - q.x) > 0.01 || Math.abs(o.y - q.y) > 0.01) { o.x = q.x; o.y = q.y; ch = true; }
      });
      return;
    }
    if (!B || B.pts.length < 2) { return; }
    const M = T && ph.objects.find(x => x.id === T.kmain && x.type === 'line');
    // Si le diamètre de la conduite change, tout le montage s'adapte
    const rule = T && M ? kitRuleOf(T.ktrig) : null, pdM = M ? pipeOf(M.pipeId) : null;
    if (rule && pdM && T.kmd !== undefined && !rule.dn.every(r => !r[1])) {
      const mainDn = dnFromPipe(pdM.desc) || T.kmd, mainOd = odNum(pdM) || mainDn, defT = accOf(T.accId), two = /\{d2\}/.test((defT && defT.tpl) || '');
      let brDn = T.kbd;
      if (mainDn !== T.kmd) { const row = rule.dn.find(r => mainDn <= r[0]) || rule.dn[rule.dn.length - 1]; brDn = row[1]; T.kmd = mainDn; }
      else {
        let e = null;
        [...P, E].forEach(function (o) { if (e !== null || !o) { return; } const v = dnOfNum(o.d); if (v && v !== T.kbd) { e = v; } });
        if (e === null && two) { const od = dnOfNum(T.d2); if (od && od !== odOfDn(T.kbd)) { e = dnOfOd(od); } }
        if (e === null && !two) { const v = dnOfNum(T.d); if (v && v !== T.kbd) { e = v; } }
        if (e !== null) { brDn = e; }
      }
      const brOd = odOfDn(brDn);
      if (brDn !== T.kbd) { T.kbd = brDn; [...P, E].forEach(o => { if (o) { setD(o, brDn); } }); if (!two) { setD(T, brDn); } ch = true; }
      if (two) { if (T.d !== String(mainOd)) { T.d = String(mainOd); ch = true; } if (T.d2 !== String(brOd)) { T.d2 = String(brOd); ch = true; } }
      const bp = kitBranchPipe(pdM, brOd);
      if (bp && B.pipeId !== bp.id) { B.pipeId = bp.id; ch = true; }
    }
    const b0 = B.pts[0], oldT = { x: b0.x, y: b0.y };
    let newT = { x: T ? T.x : b0.x, y: T ? T.y : b0.y };
    if (T && M) {
      if (mv.has(T) || T.ks === undefined) { T.ks = polyProjS(M.pts, { x: T.x, y: T.y }).s; }
      newT = polyAtS(M.pts, Math.min(T.ks, polyProjS(M.pts, { x: 0, y: 0 }).total));
    }
    const dx = newT.x - oldT.x, dy = newT.y - oldT.y;
    if (T && (Math.abs(T.x - newT.x) > 0.01 || Math.abs(T.y - newT.y) > 0.01)) { T.x = newT.x; T.y = newT.y; ch = true; }
    // Le bout du montage suit le té quand la conduite glisse, sauf si c'est lui qu'on déplace
    if (E && !mv.has(E) && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) { E.x += dx; E.y += dy; ch = true; }
    const last = B.pts[B.pts.length - 1];
    B.pts[0] = { x: newT.x, y: newT.y };
    if (E) { B.pts[B.pts.length - 1] = { x: E.x, y: E.y }; }
    else if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) { B.pts[B.pts.length - 1] = { x: last.x + dx, y: last.y + dy }; }
    // Les pièces intermédiaires glissent sur le piquage
    P.forEach(function (o) {
      if (mv.has(o) || o.kt === undefined) { const r = polyProjS(B.pts, { x: o.x, y: o.y }); o.kt = clamp(r.total ? r.s / r.total : 0.5, 0.08, 0.92); }
      const tot = polyProjS(B.pts, { x: 0, y: 0 }).total, q = polyAtS(B.pts, o.kt * tot);
      if (Math.abs(o.x - q.x) > 0.01 || Math.abs(o.y - q.y) > 0.01) { o.x = q.x; o.y = q.y; ch = true; }
    });
  });
  return ch;
}
// Dégroupe ou regroupe les pièces d'un montage
export function toggleKitGroup(ph, kid, value) {
  const mem = ph.objects.filter(x => x.kit === kid);
  if (!mem.length) { return null; }
  const v = value === undefined ? mem.some(x => x.kg === false) : value;
  mem.forEach(x => { x.kg = v; });
  return v;
}

// --- 7f. Tout remettre d'aplomb après une modification ---
export function syncAll(ph, moved) {
  const u = ph.w / 1000;
  let ch = false;
  ph.objects.forEach(o => { if (o.type === 'manhole' && !o.rx) { o.rx = o.ry = 8 * u; } });
  ch = syncParallels(ph) || ch;
  ch = resolveLinks(ph) || ch;
  ch = syncKits(ph, moved) || ch;
  ch = resolveLinks(ph) || ch;
  ch = syncFittings(ph, u) || ch;
  return ch;
}


/* ---------- 8. Sauvegarde et anciennes versions ---------- */

// Texte de l'état (pour l'historique et l'enregistrement) : on ignore les calculs temporaires "_..."
export const snapshot = objs => JSON.stringify(objs, (k, v) => (k.charAt(0) === '_' ? undefined : v));

/* Les repérages de la version 1.17 avaient des types abrégés (l, m, a, t) et une échelle différente.
   On les convertit en objets du nouveau format. */
export function migrate(objs, w) {
  if (!Array.isArray(objs)) { return []; }
  const u = w / 1000, k = w / 1400; // l'ancienne unité était la largeur / 1400
  const guessPipe = net => {
    const old = { 'aep-n': 'aep_n', 'aep-e': 'aep_e', 'eu-n': 'eu_n', 'eu-e': 'eu_e', 'ep-n': 'ep_n', 'ep-e': 'ep_e', ab: 'ab' }[net] || 'aep_n';
    const p = S.pipes.find(x => x.net === old && x.dash !== 'dotted') || S.pipes[0];
    return p.id;
  };
  const guessMh = net => {
    const old = { 'eu-n': 'eu_n', 'eu-e': 'eu_e', 'ep-n': 'ep_n', 'aep-n': 'aep_e', 'aep-e': 'aep_e' }[net] || 'eu_n';
    return (S.manholes.find(x => x.net === old) || S.manholes[0]).id;
  };
  return objs.map(function (o) {
    if (o.id && o.type && !o.t) { return o; } // déjà au nouveau format... sauf les objets très anciens ci-dessous
    const type = o.type || { l: 'line', m: 'manhole', a: 'acc', t: 'text' }[o.t];
    if (type === 'line') { return { id: uid(), type: 'line', pipeId: guessPipe(o.net), text: o.label || '', pts: (o.pts || []).map(q => ({ x: q.x, y: q.y })) }; }
    if (type === 'manhole') {
      const m = mhOf(guessMh(o.net)), r = 8 * u;
      return { id: uid(), type: 'manhole', mhId: m.id, cx: o.x, cy: o.y, rx: r, ry: r, rot: 0, num: o.label || nextNum({ objects: [] }, m), nature: m.nature, diam: m.diam, extra: '' };
    }
    if (type === 'acc') {
      const a = S.accessories.find(x => x.shape === o.shape && x.letter === o.letter) || S.accessories[0];
      return { id: uid(), type: 'acc', accId: a.id, x: o.x, y: o.y, m1: a.m1, m2: a.m2, d: a.d, d2: a.d2, note: '', text: o.label || '', size: 8 };
    }
    if (type === 'text') { return { id: uid(), type: 'text', x: o.x, y: o.y, text: o.text || '', fs: 15 * k / u }; }
    return null;
  }).filter(Boolean);
}


/* ---------- 9. Envoi en 3D ---------- */

// Profondeur de pose par défaut (m) et type de réseau pour la 3D
const DEPTH = { aep: 1.2, eu: 2.0, ep: 1.8, ab: 1.2 };
const TYPE3D = { aep: 'aep', eu: 'eu', ep: 'ep', ab: 'autre' };

/* Transforme le repérage d'une photo en éléments pour la 3D.
   cam = caméra de la photo (photoproj.js). Les objets dont un point ne tombe pas sur le sol sont ignorés. */
export function toNetItems(ph, cam) {
  const items = [];
  const gp = p => cam.toGround(p.x, p.y);
  const ll = q => [+q.lat.toFixed(7), +q.lon.toFixed(7)];
  const u = ph.w / 1000, tol = 14 * u, STEP = 12 * u;
  let skipped = 0;
  const byId = {}; ph.objects.forEach(o => { byId[o.id] = o; });
  const lines = ph.objects.filter(o => o.type === 'line' && o.pts.length > 1 && pipeOf(o.pipeId));
  const matKey = d => { const m = matOf(d); return m || (/^\s*F\s*\d/i.test(d || '') ? 'FONTE' : ''); };
  const lineDepth = L => { const pd = pipeOf(L.pipeId); return pd.dash === 'dotted' ? 0.8 : (DEPTH[netCat(pd.net)] || 1.2); };
  // Une extrémité accrochée à un regard ou à un accessoire va jusqu'à son centre : la 3D raccorde à la vraie taille
  const centre = p => {
    const t = p.link && byId[p.link.id];
    if (t && p.link.k === 'mh' && t.type === 'manhole') { return { x: t.cx, y: t.cy }; }
    if (t && p.link.k === 'acc' && t.type === 'acc') { return { x: t.x, y: t.y }; }
    return p;
  };
  // Autour d'un point : les conduites qui passent (deux directions) ou qui s'y terminent (une direction)
  const around = (x, y, only) => {
    const out = [];
    lines.forEach(function (L) {
      if (only && L.id !== only) { return; }
      const n = L.pts.length, pd = pipeOf(L.pipeId);
      let hit = false;
      [[0, 1], [n - 1, n - 2]].forEach(function (e) {
        const a = centre(L.pts[e[0]]), b = L.pts[e[1]];
        if (Math.hypot(a.x - x, a.y - y) <= tol) { out.push({ L: L, pd: pd, end: true, as: [Math.atan2(b.y - a.y, b.x - a.x)] }); hit = true; }
      });
      if (hit) { return; }
      let best = null;
      for (let i = 0; i < n - 1; i++) { const r = segProj({ x: x, y: y }, L.pts[i], L.pts[i + 1]); if (r.d <= tol && (!best || r.d < best.d)) { best = { d: r.d, a: Math.atan2(L.pts[i + 1].y - L.pts[i].y, L.pts[i + 1].x - L.pts[i].x) }; } }
      if (best) { out.push({ L: L, pd: pd, end: false, as: [best.a, best.a + Math.PI], d: best.d }); }
    });
    return out;
  };
  ph.objects.forEach(function (o) {
    if (o.type === 'line') {
      const pd = pipeOf(o.pipeId);
      if (!pd) { return; }
      const src = o.pts.map(centre), pts = src.map(gp).filter(Boolean);
      if (pts.length < 2 || pts.length < o.pts.length) { skipped++; if (pts.length < 2) { return; } }
      const cat = netCat(pd.net), br = pd.dash === 'dotted', depth = br ? 0.8 : (DEPTH[cat] || 1.2);
      // Un branchement part de la conduite principale (à sa profondeur) et remonte vers l'abonné
      const endDepth = p => { const t = p.link && p.link.k === 'ln' && byId[p.link.id]; return br && t && t.type === 'line' && pipeOf(t.pipeId) && pipeOf(t.pipeId).dash !== 'dotted' ? lineDepth(t) : null; };
      const ends = [endDepth(o.pts[0]), endDepth(o.pts[o.pts.length - 1])];
      items.push({ oid: o.id, kind: 'pipe', type: TYPE3D[cat] || 'autre', name: (o.text || pd.desc), col: colOf(pd.net), depth: depth, diam: odNum(pd) || 100, pts: pts.map(ll),
        x: { mat: matKey(pd.desc), br: br, dash: pd.dash, net: pd.net, ends: ends[0] != null || ends[1] != null ? ends : undefined } });
    } else if (o.type === 'manhole') {
      const q = gp({ x: o.cx, y: o.cy }), def = mhOf(o.mhId) || {};
      if (!q) { skipped++; return; }
      const cat = netCat(o.net || def.net);
      items.push({ oid: o.id, kind: 'regard', type: TYPE3D[cat] || 'autre', name: o.num || def.name || 'Regard', col: colOf(o.net || def.net), depth: (DEPTH[cat] || 1.2) + 0.3, diam: +(o.diam || def.diam) || 800, pts: [ll(q)],
        x: { nat: o.nature || def.nature || def.name || '', net: o.net || def.net } });
    } else if (o.type === 'acc') {
      const q = gp(o), def = accOf(o.accId) || {};
      if (!q) { skipped++; return; }
      const cat = netCat(o.net || def.net);
      const near = around(o.x, o.y, null);
      const host = (o.auto && near.find(n => n.L.id === String(o.auto).split(':')[0])) || near.filter(n => !n.end).sort((a, b) => a.d - b.d)[0] || near[0];
      let as = o.dirs3 || o.dirs || null;
      if (!as) { as = []; near.forEach(n => n.as.forEach(a => { if (!as.some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.12)) { as.push(a); } })); }
      if (!as.length && o.rot != null) { as = [o.rot, o.rot + Math.PI]; }
      // la conduite « porteuse » d'abord : ses deux directions en tête de liste
      if (host && !host.end && !o.dirs3 && !o.dirs) { const h = host.as; as = h.concat(as.filter(a => !h.some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.12))); }
      const dirs = as.map(a => gp({ x: o.x + Math.cos(a) * STEP, y: o.y + Math.sin(a) * STEP })).filter(Boolean).map(ll);
      const ods = []; near.forEach(n => { const d = odNum(n.pd); if (d && ods.indexOf(d) < 0) { ods.push(d); } });
      const dn = parseFloat(String(o.d || def.d || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
      items.push({ oid: o.id, kind: 'acc', type: TYPE3D[cat] || 'autre', name: accText(o).split('\n')[0] || def.name, col: accColor(o, ph, u), depth: host ? lineDepth(host.L) : (DEPTH[cat] || 1.2), diam: 300, pts: [ll(q)],
        x: { sym: def.sym || '', an: def.name || '', dn: dn, dirs: dirs, od: host ? odNum(host.pd) : 0, ods: ods, mat: host ? matKey(host.pd.desc) : '', net: o.net || def.net, auto: o.auto ? 1 : 0,
          brTo: near.filter(n => n.end && n.pd.dash === 'dotted').map(n => gp({ x: o.x + Math.cos(n.as[0]) * STEP, y: o.y + Math.sin(n.as[0]) * STEP })).filter(Boolean).map(ll)[0] } });
    }
  });
  return { items: items, skipped: skipped };
}

/* Un objet vu d'une autre photo : ses points sont convertis en positions sur le sol (avec la caméra de sa photo),
   puis reportés dans la photo courante (avec sa caméra). Renvoie une copie dessinable, ou null. */
export function projectObject(o, fromCam, toCam) {
  const conv = p => {
    const g = fromCam.toGround(p.x, p.y);
    return g ? toCam.toPixel(g.lat, g.lon, 0) : null;
  };
  const c = JSON.parse(snapshot([o]))[0];
  if (o.type === 'line') {
    // Un point trop près de l'horizon ou derrière la photo ne bloque plus tout le tracé : on garde les points
    // qui se projettent (le tracé est simplement raccourci).
    const keep = [];
    o.pts.forEach(function (p) {
      const g = fromCam.toGround(p.x, p.y), q = g ? toCam.toPixel(g.lat, g.lon, 0) : null;
      if (q) { keep.push({ x: q.x, y: q.y, g: [g.lat, g.lon] }); }
    });
    if (keep.length < 2) { return null; }
    c.pts = keep;
  } else if (o.type === 'manhole') {
    const q = conv({ x: o.cx, y: o.cy }), r = conv({ x: o.cx + o.rx, y: o.cy }), g0 = fromCam.toGround(o.cx, o.cy);
    if (!q) { return null; }
    c.cx = q.x; c.cy = q.y; c.g = [g0.lat, g0.lon];
    const rr = r ? Math.hypot(r.x - q.x, r.y - q.y) : o.rx;
    c.rx = c.ry = clamp(rr, 2, 400);
  } else if (o.type === 'acc') {
    const q = conv(o), g0 = fromCam.toGround(o.x, o.y);
    if (!q) { return null; }
    c.x = q.x; c.y = q.y; c.g = [g0.lat, g0.lon];
  } else { return null; }
  return c;
}
// Chemin inverse : un point de la photo courante -> point de l'autre photo (pour modifier un dessin fait ailleurs)
export function backPoint(p, curCam, otherCam) {
  const g = curCam.toGround(p.x, p.y);
  return g ? otherCam.toPixel(g.lat, g.lon, 0) : null;
}
