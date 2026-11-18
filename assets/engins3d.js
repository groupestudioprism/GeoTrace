/* GeoTrace – engins de chantier en 3D : modèles GLB légers (meshopt) posés à leur taille réelle, chargés à la demande.
   engins : [{ id, m, pt:[lat,lon], rot, off }] (rot : sens horaire depuis le nord, off : décalage propre au modèle) ; toEN(lat, lon) → [est, nord] en mètres ; base : dossier des modèles.
   Les modèles sont en Y vers le haut ; le monde de la vue 3D est en Z vers le haut. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/utils/meshopt_decoder.mjs';

export function buildEngins(engins, toEN, base = 'assets/models/') {
  const group = new THREE.Group(); group.name = 'engins';
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map(); // un seul chargement par modèle, clonage ensuite (géométries partagées)
  const get = id => { if (!cache.has(id)) cache.set(id, loader.loadAsync(base + id + '.glb').then(g => { g.scene.traverse(o => { if (o.isMesh) o.userData.dispose = true; }); return g.scene; })); return cache.get(id); };
  engins.forEach(e => {
    const root = new THREE.Group(), [E, N] = toEN(e.pt[0], e.pt[1]);
    root.position.set(E, N, 0); root.rotation.z = -((e.rot || 0) + (e.off || 0)) * Math.PI / 180; root.userData.itemId = e.id;
    group.add(root);
    get(e.m).then(src => {
      const inner = src.clone(true); inner.rotation.x = Math.PI / 2; // Y haut du modèle → Z haut du monde
      root.add(inner);
    }).catch(err => console.warn('engin', e.m, err));
  });
  return group;
}
