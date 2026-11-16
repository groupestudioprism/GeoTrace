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
6. **Vue 3D** : la maquette sur la photo aérienne, avec les repères des photos de chantier. Le bouton « Voir dans la maquette » d'une fiche photo place la caméra là où la photo a été prise. « Superposer » affiche la photo en transparence sur la maquette pour comparer.

### Réglage d'export prêt à l'emploi (Revit 2026)

[`revit/GeoTrace-IFC-Revit2026.json`](revit/GeoTrace-IFC-Revit2026.json) : IFC 4 Reference View, coordonnées partagées, sans lignes 2D ni propriétés Revit internes (fichier plus léger). Dans Revit : Fichier, Exporter, IFC, *Modifier la configuration*, icône *Importer*, choisir le fichier, puis sélectionner « GeoTrace ». Exportez depuis une vue 3D où seuls les éléments voulus sont visibles.

### Placer la maquette depuis Revit (sans cliquer de points)

Si Revit connaît la position de l'ouvrage, GeoTrace la lit dans le fichier IFC et place la maquette tout seul (« Placée d'après les coordonnées enregistrées dans Revit »).

Dans Revit :
1. Donnez au projet les coordonnées du géomètre (Lambert-93 ou zone CC, RGF93) : dans l'onglet Gérer, Coordonnées, *Spécifier les coordonnées au point* sur le point de repérage, ou réglez Est/Nord/Élévation du point de base du projet. Les menus varient selon la version de Revit.
2. Exportez en **IFC 4** (ou IFC 2x3) avec *Base des coordonnées* = **Coordonnées partagées** (ou point de mesure).
3. Chargez le fichier dans GeoTrace. Si le fichier contient un `IfcMapConversion` avec un système `EPSG:2154` ou `EPSG:3942` à `EPSG:3950`, il est utilisé tel quel. Sinon, si les positions du fichier sont des coordonnées Lambert plausibles, GeoTrace propose le système (liste déroulante si plusieurs conviennent).

Les points de calage saisis à la main ou un calage importé passent avant ce placement automatique. Le bouton *Placer d'après Revit* y revient. Un fichier sans coordonnées (origine interne de Revit) se cale avec des points, comme avant.

L'échelle reste à 1:1 par défaut (une maquette Revit est à l'échelle réelle). Décochez l'option pour laisser GeoTrace l'ajuster.

**Partager le calage avec toute l'équipe** : exportez le calage (fichier `nom.geotrace.json`) et déposez-le à côté de la maquette sur Nextcloud, avec le même nom que le fichier IFC. GeoTrace le relit à l'ouverture du lien. Sans cela, le calage est gardé dans le navigateur de l'ordinateur qui l'a fait.

Pour ouvrir la maquette de l'affaire directement, renseignez `maquetteLien` dans `assets/config.js` ou ouvrez la page avec `?maquette=LIEN_DE_PARTAGE`.

Limites : la maquette est lue entièrement dans le navigateur, donc les très gros IFC (plus de 100 Mo) sont lents. Sur la carte, la maquette est vue du dessus (plan) ; l'inclinaison se fait dans la Vue 3D.

## Réglages

Le fichier [`assets/config.js`](assets/config.js) contient le serveur Nextcloud, la profondeur des sous-dossiers et le lien vers une future maquette 3D.

Pour utiliser le lien de partage Nextcloud directement, ouvrez la page avec `?s=CODE_DE_PARTAGE`. Ce mode demande que GeoTrace soit hébergé sur le serveur Nextcloud ou que celui-ci l'autorise (CORS).

## Logo

Le logo GeoTrace est dans `assets/`. Le logo STURNO est `assets/logo-sturno.svg` : remplacez ce fichier par le logo officiel (même nom, ou changez le chemin dans `index.html`).

## Développement

Site statique sans étape de compilation. Les bibliothèques (Leaflet, markercluster, exifr, JSZip, heic2any, three.js, web-ifc) et les polices sont dans `vendor/`.

```
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000. Après une modification, changez la version de cache dans `sw.js`.

## Licences des bibliothèques

Leaflet et Leaflet.markercluster (BSD-2 et MIT), exifr (MIT), JSZip (MIT ou GPLv3), heic2any (MIT), three.js (MIT), web-ifc (MPL-2.0), polices Public Sans et Michroma (SIL OFL). Fonds de carte © IGN, © OpenStreetMap, © CARTO.
