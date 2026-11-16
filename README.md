# GeoTrace

Carte des photos de chantier géolocalisées, pour STURNO. GeoTrace lit la position GPS et la direction de prise de vue de chaque photo, puis la place sur la carte.

Tout est traité dans le navigateur : les photos ne quittent pas l'ordinateur. Seules les cartes IGN et, si l'option est active, la recherche d'adresse (coordonnées envoyées à l'IGN) utilisent Internet.

## Utilisation

Ouvrez la page, puis :

- choisissez un dossier du PC (ou un dossier Nextcloud synchronisé), des photos ou un ZIP téléchargé depuis Nextcloud ;
- ou glissez-les n'importe où dans la fenêtre ;
- ou ouvrez un lien de partage Nextcloud (voir plus bas).

Le bouton « Essayer avec des photos d'exemple » charge une rue fictive pour découvrir l'outil. L'adresse `?demo` l'ouvre directement.

## Fonctions

- Repères colorés par appareil (téléphone, tablette, drone) avec cône de direction, regroupement des photos proches et vignettes optionnelles.
- Fiche photo : aperçu, adresse, coordonnées WGS84 et Lambert-93, altitude, direction, note et favori. Les notes et favoris sont gardés dans le navigateur et ajoutés aux exports.
- Visionneuse plein écran avec zoom, rotation, balayage et téléchargement. Les HEIC sont convertis à la demande.
- Chronologie : cliquez une barre ou glissez pour filtrer la période. Filtres par appareil, favoris et texte.
- Recherche d'une adresse, d'une commune ou de coordonnées. Mesure de longueur et de surface. Parcours dans l'ordre des prises.
- Fonds : photo aérienne IGN, plan IGN, plan clair, plan sombre, plus le cadastre. Thème clair ou sombre.
- Exports de la sélection : GeoJSON, KML, CSV (avec Lambert-93) et ZIP (photos, GeoJSON, CSV).
- Installable comme application (PWA) et utilisable hors connexion pour l'interface. Les fonds de carte demandent une connexion.

Raccourcis : `F` tout voir, `M` mesurer, `T` vignettes, `L` liste, `/` filtrer, `?` aide.

## Maquette Revit

Le bouton **Maquette** place sur la carte une maquette 3D exportée de Revit, puis la cale avec des points GPS.

1. Dans Revit : Fichier, Exporter, IFC. Le GLB est aussi accepté. Un `.rvt` ne s'ouvre pas dans un navigateur.
2. Dans GeoTrace : Maquette, choisir le fichier, ou coller le lien de partage Nextcloud d'un fichier ou d'un dossier.
3. **Chargement automatique** : un `.ifc` ou `.glb` placé dans le dossier de photos (dossier du PC, glisser-déposer, ZIP ou dossier Nextcloud) se charge tout seul à l'import des photos. La dernière maquette est aussi gardée dans le navigateur : à la visite suivante, elle revient sans rien réimporter. Avec `maquetteLien` dans `assets/config.js`, elle vient directement de Nextcloud.
4. **Ajouter un point de calage** : cliquez un point reconnaissable sur la vue plan de la maquette (angle de bâtiment, regard), puis le même point sur la carte. Avec la photo aérienne IGN, les angles de bâtiments sont les meilleurs repères.
5. Deux points suffisent pour placer et orienter la maquette. Plus de points, plus loin les uns des autres, donnent un calage plus sûr. L'écart moyen est affiché : en dessous de 1 m, c'est bon.
6. **Vue 3D** : la maquette sur la photo aérienne. Chaque photo de chantier y apparaît comme une image placée dans son champ de vue, avec sa pyramide de vision (inclinée quand la photo enregistre l'inclinaison, par exemple les drones DJI). Pour entrer dans une photo : cliquer son repère (il s'éclaire au survol et affiche son nom) ou sa miniature dans le bandeau du haut, classé de la plus proche de la maquette à la plus lointaine. La caméra y vole en douceur. Un clic sur une photo garde la vue 3D, place la caméra comme à la prise de vue (position, cap, inclinaison, champ de vision tiré de la focale EXIF) et superpose la photo à la maquette dans un cadre de même forme : la photo reste en pleine couleur au fond, la maquette est dessinée par-dessus en pleine couleur (le curseur règle l'opacité de la maquette). Pour caler précisément : cliquez un point de la maquette (il s'accroche aux éléments proches), puis le même point sur la photo ; un point règle le cap et l'inclinaison, deux points ou plus règlent aussi le roulis et le zoom. En superposition, seules la maquette et la photo restent affichées (ni repères, ni photo aérienne). Réglages manuels (le cap et le GPS d'un téléphone sont approximatifs) : glisser pour orienter, Maj + glisser pour déplacer l'appareil, molette pour zoomer (Maj + molette pour la hauteur), double-clic pour revenir au réglage d'origine, ← → pour passer à la photo suivante. Le réglage est mémorisé par photo. Les téléphones n'enregistrent pas l'inclinaison : la caméra est supposée horizontale.

### Réglage d'export prêt à l'emploi (Revit 2026)

[`revit/GeoTrace-IFC-Revit2026.json`](revit/GeoTrace-IFC-Revit2026.json) : IFC 4 Reference View, coordonnées partagées, système CC48 (EPSG:3948) renseigné, sans lignes 2D ni propriétés Revit internes (fichier plus léger). Dans Revit : Fichier, Exporter, IFC, *Modifier la configuration*, icône *Importer*, choisir le fichier, puis sélectionner « GeoTrace ». Exportez depuis une vue 3D où seuls les éléments voulus sont visibles.

Pour bien référencer le projet dans Revit, pas à pas : [`revit/GUIDE-georeferencement.md`](revit/GUIDE-georeferencement.md). Un script Dynamo est fourni (`revit/GeoTrace-georeferencement.dyn`).

### Placer la maquette depuis Revit (sans cliquer de points)

Si Revit connaît la position de l'ouvrage, GeoTrace la lit dans le fichier IFC et place la maquette tout seul (« Placée d'après les coordonnées enregistrées dans Revit »).

Dans Revit :
1. Donnez au projet les coordonnées du géomètre (Lambert-93 ou zone CC, RGF93) : dans l'onglet Gérer, Coordonnées, *Spécifier les coordonnées au point* sur le point de repérage, ou réglez Est/Nord/Élévation du point de base du projet. Les menus varient selon la version de Revit.
2. Exportez en **IFC 4** (ou IFC 2x3) avec *Base des coordonnées* = **Coordonnées partagées** (ou point de mesure).
3. Chargez le fichier dans GeoTrace. Si le fichier contient un `IfcMapConversion` avec un système `EPSG:2154` ou `EPSG:3942` à `EPSG:3950`, il est utilisé tel quel. Sinon, si les positions du fichier sont des coordonnées Lambert plausibles, GeoTrace propose le système (liste déroulante si plusieurs conviennent).

Sans coordonnées du géomètre, GeoTrace se rabat sur le **lieu du projet** : dans Revit, Gérer, Emplacement, indiquez l'adresse du chantier avant d'exporter. La maquette est alors placée toute seule, avec une précision de quelques dizaines de mètres et l'orientation du nord vrai. Si ce lieu est à plus de 25 km des photos (lieu par défaut de Revit), GeoTrace ne place pas la maquette et le dit.

Les points de calage saisis à la main ou un calage importé passent avant ce placement automatique. Le bouton *Placer d'après Revit* y revient. Un fichier sans coordonnées (origine interne de Revit) se cale avec des points, comme avant.

L'échelle reste à 1:1 par défaut (une maquette Revit est à l'échelle réelle). Décochez l'option pour laisser GeoTrace l'ajuster.

**Partager le calage avec toute l'équipe** : exportez le calage (fichier `nom.geotrace.json`) et déposez-le à côté de la maquette sur Nextcloud, avec le même nom que le fichier IFC. GeoTrace le relit à l'ouverture du lien. Sans cela, le calage est gardé dans le navigateur de l'ordinateur qui l'a fait.

Pour ouvrir la maquette de l'affaire directement, renseignez `maquetteLien` dans `assets/config.js` ou ouvrez la page avec `?maquette=LIEN_DE_PARTAGE`.

Limites : la maquette est lue entièrement dans le navigateur, donc les très gros IFC (plus de 100 Mo) sont lents. Sur la carte, la maquette est vue du dessus (plan) ; l'inclinaison se fait dans la Vue 3D.

## Réglages

Le fichier [`assets/config.js`](assets/config.js) contient le serveur Nextcloud, la profondeur des sous-dossiers et le lien vers une future maquette 3D.

Pour utiliser le lien de partage Nextcloud directement, ouvrez la page avec `?s=CODE_DE_PARTAGE`. Ce mode demande que GeoTrace soit hébergé sur le serveur Nextcloud ou que celui-ci l'autorise (CORS).

## Logo

Le logo GeoTrace est dans `assets/`. Le logo STURNO est `assets/logo-sturno.png` (logo officiel) et `assets/sturno-emblem.png` (pastille seule).

## Développement

Site statique sans étape de compilation. Les bibliothèques (Leaflet, markercluster, exifr, JSZip, heic2any, three.js, web-ifc) et les polices sont dans `vendor/`.

```
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000. Après une modification, changez la version de cache dans `sw.js`.

## Licences des bibliothèques

Leaflet et Leaflet.markercluster (BSD-2 et MIT), exifr (MIT), JSZip (MIT ou GPLv3), heic2any (MIT), three.js (MIT), web-ifc (MPL-2.0), polices Public Sans et Michroma (SIL OFL). Fonds de carte © IGN, © OpenStreetMap, © CARTO.

Reprise après un rafraîchissement : les photos ouvertes depuis un dossier, des fichiers ou un ZIP sont gardées dans le navigateur (IndexedDB), avec la maquette et son calage. Un lien Nextcloud est repris par l'adresse de la page. Ouvrir une autre source remplace la précédente. Le navigateur peut refuser de garder un très gros dossier s'il manque de place : dans ce cas la page revient à l'accueil au rafraîchissement.

## Version 1.6.0 : simplification pour tous les utilisateurs

- Textes plus clairs : « Fond de carte », « Maquette 3D », « Photos en 3D », « Position sur la carte », « Ajouter un point GPS ».
- Accueil : trois étapes (ouvrir, repérer, cliquer), précision « aucun compte, aucune installation », rappel que seules les photos avec GPS apparaissent.
- Infobulles sur les boutons de la barre du haut, aide complétée.
- Barre du haut qui tient sur les écrans de 1366 px (champ de recherche lisible, nom STURNO masqué si l'écran est étroit).

## Version 1.7.0 : vue 3D et animations

- Vue 3D : la photo aérienne couvre toute la zone (environ 5 km autour), plus seulement un carré autour de la maquette. Un second fond, moins détaillé, est chargé sous le fond précis.
- Repères photo en 3D : pastille d'appareil photo à la couleur de l'appareil (téléphone, tablette, drone), taille constante à l'écran, pied vertical jusqu'au sol, agrandie au survol. Toutes les photos de la zone sont affichées.
- Entrée en douceur dans la vue 3D (la caméra descend vers la vue d'ensemble).
- Animations : accueil, menus, panneau maquette, vue 3D, visionneuse, messages, boutons. Elles sont coupées si le système demande moins de mouvement.

## Version 1.7.1 : nouveau logo

Logo redessiné d'après le croquis retenu : épingle bleu foncé avec les trois bâtiments de la maquette dans un cercle blanc, trois calques (fond IGN, photos, maquette) en losanges bleus, lettres larges « GEO » (marine) et « TRACE » (bleu clair). Source vectorielle : `assets/logo-geotrace.svg`. Les icônes (favicon, application installée, iOS) sont régénérées à partir du même dessin.

## Version 1.8.0 : navigation 3D et superposition

- Échap ou ✕ en superposition : retour à la vue 3D (un second appui ferme la 3D).
- Bandeau de photos : miniature, nom et recherche (jusqu'à 400 photos, les plus proches de la maquette d'abord).
- Commandes simplifiées : glisser = tourner, clic droit ou Maj + glisser = déplacer, molette = zoom vers le curseur, boutons + / − / vue de dessus, tactile (un doigt tourne, deux doigts zooment et déplacent).
- Passage 3D → superposition : la caméra arrive à la prise de vue, puis le fond aérien s'efface en fondu pendant que la photo apparaît ; le cadre s'adapte à la forme de la photo sans saut.
- « Appliquer à toutes » : le réglage d'une photo devient celui de toutes les autres (utile quand l'erreur vient de la maquette ou du drone et non d'une seule photo). « Tout annuler » remet tout à zéro.

## Version 1.8.1

« Appliquer à toutes » ne concerne plus que les photos du même type d'appareil (drone ou téléphone) : leurs erreurs de position et d'orientation ne sont pas les mêmes.

## Version 1.9.0 : calage des photos fourni avec le projet

Les erreurs de position et d'orientation des photos se règlent une seule fois, par la personne qui prépare le projet. En superposition :

1. Calez une photo (un point sur la maquette, puis le même point sur la photo). Pour toutes les photos du même appareil, cliquez sur « Appliquer à toutes ».
2. Cliquez sur « Enregistrer pour l'équipe » : le fichier `nom.geotrace.json` (le même que le calage de la maquette) contient maintenant aussi les réglages des photos.
3. Déposez-le à côté de la maquette sur Nextcloud. Collaborateurs et clients voient la maquette bien placée, sans rien régler.

Ordre de priorité : réglage fait sur cet ordinateur, puis réglage du projet pour la photo, puis réglage du projet pour le type d'appareil.

## Version 1.10.0 : logo, lancement, mode sombre, Tuto
- Logo GeoTrace repris à l'identique du croquis « version retenue » (`assets/logo-geotrace.png`, pastille `assets/symbol.png`, icônes). Logo STURNO officiel (`assets/logo-sturno.png`, `assets/sturno-emblem.png`).
- Animation du logo à chaque lancement ou rafraîchissement (cliquez pour passer ; désactivée si le système demande moins d'animations).
- Mode sombre appliqué à l'accueil, aux fenêtres, aux fiches et aux menus.
- Bouton « Tuto » dans l'espace de travail ; l'accueil n'affiche plus les boutons réservés au travail sur les photos.
- Retrait de la barre de recherche d'adresse et des fonds « Plan clair » et « Plan sombre ».
