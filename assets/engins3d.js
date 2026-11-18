/* GeoTrace – engins de chantier en 3D : modèles GLB légers (meshopt) posés à leur taille réelle, chargés à la demande.
   engins : [{ id, m, pt:[lat,lon], rot, off, rig?, col?, p?, parts?, partsDef?, dims }] (rot : sens horaire depuis le nord, off : décalage propre au modèle) ;
   toEN(lat, lon) → [est, nord] en mètres ; base : dossier des modèles.
   Trois façons de poser un engin : pelle articulée construite à partir de cotes (rig), modèle à pièces mobiles (benne, cuve, roues directrices : un fichier fixe + un fichier par pièce, tournés autour d'un pivot),
   ou modèle figé. Les modèles sont en Y vers le haut ; le monde de la vue 3D est en Z vers le haut.
   Le groupe renvoyé garde ses engins à jour sans tout reconstruire : group.userData.update(liste) déplace, tourne et remet en pose ceux qui existent déjà. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildRig } from './rig.js';
import { MeshoptDecoder } from '../vendor/three/utils/meshopt_decoder.mjs';
const D = Math.PI / 180;

export function buildEngins(engins, toEN, base = 'assets/models/') {
  const group = new THREE.Group(); group.name = 'engins';
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map(); // un seul chargement par fichier, clonage ensuite (géométries partagées)
  const get = name => { if (!cache.has(name)) cache.set(name, loader.loadAsync(base + name + '.glb').then(g => { g.scene.traverse(o => { if (o.isMesh) o.userData.dispose = true; }); return g.scene; })); return cache.get(name); };
  const roots = new Map(); let sel = null, ring = null;
  const sigOf = e => [e.m, e.rig ? 'r' : '', e.col ? e.col.map(v => v.toFixed(3)).join(',') : '', e.parts ? e.parts.join('+') : ''].join('|');
  const free = o => o.traverse(q => { if (q.isMesh) { q.geometry.dispose(); [].concat(q.material).forEach(m => m.dispose()); } });
  const clear = root => { [...root.children].forEach(c => { if (c.userData.keep) return; root.remove(c); if (c.userData.own) free(c); }); };

  function fill(root, e) {
    clear(root); const sig = root.userData.sig = sigOf(e); root.userData.set = null;
    if (e.rig) {
      try { const r = buildRig(e.rig, e.p, e.col); r.group.userData.own = true; root.add(r.group); root.userData.set = r.set; } catch (err) { console.warn('pelle', e.m, err); }
      return;
    }
    const defs = e.partsDef ? e.partsDef.params : [], names = [e.m, ...(e.parts || []).map(p => e.m + '.' + p)];
    Promise.all(names.map(get)).then(([fixe, ...ps]) => {
      if (root.userData.sig !== sig || !root.parent) return; // l'engin a changé ou disparu pendant le chargement
      const inner = new THREE.Group(); inner.rotation.x = Math.PI / 2; root.add(inner); // Y haut du modèle → Z haut du monde
      inner.add(fixe.clone(true));
      const grp = {};
      (e.parts || []).forEach((nm, i) => { const g = new THREE.Group(), c = ps[i].clone(true); g.add(c); inner.add(g); grp[nm] = { g, c }; });
      defs.forEach(q => q.targets.forEach(t => { const o = grp[t.part]; if (o && !o.piv) { o.piv = t.pivot; o.g.position.fromArray(t.pivot); o.c.position.fromArray(t.pivot).negate(); } }));
      root.userData.set = p => defs.forEach(q => { const v = (p && p[q.k] != null ? p[q.k] : q.def) * D; q.targets.forEach(t => { const o = grp[t.part]; if (o) o.g.rotation[t.axis] = t.sign * v; }); });
      root.userData.set(root.userData.p);
    }).catch(err => console.warn('engin', e.m, err));
  }
  function place(root, e) {
    const [E, N] = toEN(e.pt[0], e.pt[1]);
    root.position.set(E, N, 0); root.rotation.z = -((e.rot || 0) + (e.off || 0)) * D; root.userData.p = e.p; root.userData.dims = e.dims || [3, 5];
  }
  /* anneau rouge au pied de l'engin sélectionné */
  function refreshSel() {
    if (ring && ring.parent) ring.parent.remove(ring);
    const root = sel && roots.get(sel); if (!root) return;
    const [w, l] = root.userData.dims, r = Math.max(w, l) / 2 + .35;
    if (!ring || ring.userData.r !== r) {
      if (ring) { ring.geometry.dispose(); ring.material.dispose(); }
      ring = new THREE.Mesh(new THREE.RingGeometry(r, r + .14, 64), new THREE.MeshBasicMaterial({ color: 0xd6402b, transparent: true, opacity: .9, depthTest: false, side: THREE.DoubleSide }));
      ring.userData = { r, keep: true, dispose: true }; ring.renderOrder = 25; ring.position.z = .08;
    }
    root.add(ring);
  }
  group.userData.update = list => {
    const seen = new Set();
    list.forEach(e => {
      seen.add(e.id); let root = roots.get(e.id);
      if (!root) { root = new THREE.Group(); root.userData.itemId = e.id; roots.set(e.id, root); group.add(root); }
      place(root, e);
      if (root.userData.sig !== sigOf(e)) fill(root, e); else if (root.userData.set) root.userData.set(e.p);
    });
    [...roots].forEach(([id, r]) => { if (!seen.has(id)) { if (ring && ring.parent === r) r.remove(ring); group.remove(r); clear(r); roots.delete(id); } });
    refreshSel();
  };
  group.userData.select = id => { sel = id || null; refreshSel(); };
  group.userData.update(engins);
  return group;
}
