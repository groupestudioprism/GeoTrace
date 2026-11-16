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

## Réglages

Le fichier [`assets/config.js`](assets/config.js) contient le serveur Nextcloud, la profondeur des sous-dossiers et le lien vers une future maquette 3D.

Pour utiliser le lien de partage Nextcloud directement, ouvrez la page avec `?s=CODE_DE_PARTAGE`. Ce mode demande que GeoTrace soit hébergé sur le serveur Nextcloud ou que celui-ci l'autorise (CORS).

## Logo

Le logo GeoTrace est dans `assets/`. Le logo STURNO est `assets/logo-sturno.svg` : remplacez ce fichier par le logo officiel (même nom, ou changez le chemin dans `index.html`).

## Développement

Site statique sans étape de compilation. Les bibliothèques (Leaflet, markercluster, exifr, JSZip, heic2any) et les polices sont dans `vendor/`.

```
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000. Après une modification, changez la version de cache dans `sw.js`.

## Licences des bibliothèques

Leaflet et Leaflet.markercluster (BSD-2 et MIT), exifr (MIT), JSZip (MIT ou GPLv3), heic2any (MIT), polices Public Sans et Michroma (SIL OFL). Fonds de carte © IGN, © OpenStreetMap, © CARTO.
