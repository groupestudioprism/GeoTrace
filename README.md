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
- Logo GeoTrace redessiné proprement, d’après le croquis « version retenue » (épingle, pastille bâtiments, trois calques) (`assets/logo-geotrace.png`, pastille `assets/symbol.png`, icônes). Logo STURNO officiel (`assets/logo-sturno.png`, `assets/sturno-emblem.png`).
- Animation du logo à chaque lancement ou rafraîchissement (cliquez pour passer ; désactivée si le système demande moins d'animations).
- Mode sombre appliqué à l'accueil, aux fenêtres, aux fiches et aux menus.
- Bouton « Tuto » dans l'espace de travail ; l'accueil n'affiche plus les boutons réservés au travail sur les photos.
- Retrait de la barre de recherche d'adresse et des fonds « Plan clair » et « Plan sombre ».

## Version 1.10.1
- Logo : l’épingle passe devant les calques.
- Animation de lancement plus courte (environ 1,5 s) : les calques s’empilent, l’épingle tombe dessus, une onde part de sa pointe, puis le nom apparaît.

## Version 1.11.0
- Nouveau logo plus net (épingle avec reflet, calques, nom en dégradé) appliqué partout : en-tête, accueil, icônes, écran de lancement.
- Animation de lancement complète d’environ 4,5 s qui utilise tout le logo (calques, routes, épingle, bâtiments, nom). Un clic ou une touche la passe ; `?nosplash` dans l’adresse la désactive.
- Tuto guidé en 13 étapes : chaque étape entoure le vrai bouton ou la vraie zone, avec des aperçus des boutons de la vue 3D.

## Version 1.12.0 : installations de chantier
- Bouton « Chantier » : dessinez sur la carte 2D des zones de base vie, dépôt, décharge, stockage, parking et accès (rectangle ou polygone). Liste avec nom, type, surface, modification des sommets et suppression.
- En vue 3D, chaque zone devient de vrais objets : cabines modulaires, conteneurs et palettes, bennes et tas de terre, piles de tuyaux, véhicules, portail, panneau, cônes et clôture. Les zones restent visibles en superposition.
- Les zones sont gardées dans le navigateur et ajoutées au fichier de calage (`chantier`) par « Enregistrer pour l’équipe » : collègues et clients les retrouvent.

## Version 1.13.0 : déviations

Dans **Chantier**, l'onglet **Déviations** permet de tracer une déviation simple sur la carte : choisir le type (déviation véhicules, cheminement piétons, alternat, route barrée), cliquer les points du parcours, double-clic pour finir. Chaque déviation peut être renommée, changée de type, réglée en largeur, inversée de sens, modifiée point par point ou supprimée.

En vue 3D, elle devient une chaussée provisoire avec marquages, flèches de sens, panneaux de déviation, cônes, barrières rouges et blanches (route barrée) ou feux aux extrémités (alternat). Les déviations sont enregistrées avec le fichier de calage (`chantier.devs`).

## Version 1.14.0 : phases

Dans **Chantier**, l'onglet **Phases** découpe le chantier. Chaque phase a un nom, une couleur, des dates, et son contenu : installations et déviations présentes pendant la phase, catégories IFC de la maquette construites pendant la phase (murs, dalles, etc.), et éléments choisis un à un dans la vue 3D (clic sur un élément, puis « Ajouter à la phase »).

- **Carte 2D** : « Afficher cette phase » n'affiche que les installations et déviations de la phase.
- **Vue 3D** : le sélecteur **Phase** montre l'avancement. Les éléments de la maquette apparaissent à leur phase et restent ensuite, ceux de la phase en cours sont teintés de sa couleur.
- **Planning PDF** : un PDF placé dans le dossier ouvert (local, ZIP ou lien Nextcloud) est repéré tout seul (de préférence un nom contenant « planning »). Sinon, « Choisir le PDF du planning ». Chaque phase peut indiquer sa page du planning, ouverte par « Voir au planning ».
- Les phases sont enregistrées avec le calage (`chantier.phases`). Les dates ne sont pas lues dans le PDF : elles se saisissent à la main.

## Version 1.15.0 : réseaux existants

Dans **Chantier**, l'onglet **Réseaux** fait apparaître les réseaux existants sur la carte et en 3D, sous le sol.

- **Données ouvertes** : « Récupérer les données ouvertes de la vue » charge, pour la zone affichée (zoom 15 ou plus), les canalisations et lignes électriques de la BD TOPO de l'IGN, et les conduites, câbles et lignes télécom d'OpenStreetMap.
- **Import** : un fichier GeoJSON ou KML, en WGS 84 ou en Lambert-93 (reconnu tout seul). Le type (eau, assainissement, gaz…) est deviné d'après les attributs, ou imposé par le sélecteur.
- **Tracé à la main** : d'après un plan reçu en réponse à la DT-DICT, avec type, profondeur et diamètre. Une profondeur négative indique un réseau aérien (hauteur).
- **3D** : tuyaux colorés par type (eau bleu, assainissement marron, gaz jaune, électricité rouge, télécom vert). La case « Réseaux enterrés » les montre sous un sol rendu transparent.
- Chaque réseau peut être rattaché à des phases. Les réseaux sont enregistrés avec le calage (`chantier.nets`).

Les réseaux de distribution des villes (eau, assainissement, gaz, électricité) ne sont pas en données ouvertes : ils ne sont fournis que par les exploitants, via la DT-DICT, en plans PDF ou DWG. Ces plans se retracent ici ou s'importent s'ils sont fournis en GeoJSON ou KML.

## Version 1.16.0 : phases lues dans le planning PDF

Dans l'onglet **Phases**, « Importer les phases du planning » lit le planning PDF (diagramme de Gantt exporté de MS Project ou d'un outil équivalent) : numéro, nom, durée et dates de chaque tâche. Si les dates ne sont pas écrites dans le tableau, elles sont déduites de la position des barres sur l'échelle des semaines. On coche les tâches à transformer en phases (les titres en majuscules sont cochés d'office), avec leurs dates et la page du planning.

La lecture suppose un planning en tableau (colonnes N°, Nom, Durée, Début, Fin) suivi du diagramme. Un planning présenté autrement ne se lit pas toujours : les phases se créent alors à la main. La lecture utilise PDF.js (dossier `vendor/pdfjs`) et se fait dans le navigateur.

## Version 1.16.1 : panneau Chantier refait

Le panneau « Chantier » a une hauteur stable et reste au-dessus du bandeau des heures. Quatre onglets alignés (Zones, Déviations, Réseaux, Phases), choix de types compacts, textes d'aide raccourcis, états vides explicites. L'option « Afficher sur la carte » reste visible en bas. Sur téléphone, le panneau se pose en bas de l'écran pour laisser la carte visible pendant le tracé.

## Version 1.16.2 : un projet, ses propres données

Les zones, déviations, réseaux et phases gardées dans le navigateur sont maintenant rangées par projet (nom de la maquette). Ouvrir une autre maquette ne ramène plus les phases du projet précédent, et les retrouver en rouvrant le premier. Si l'équipe a enregistré un calage avec ses phases, elles s'affichent à l'ouverture.

## Version 1.17.0 : repérage de réseaux sur photo

Dans la visionneuse, le bouton « Repérer » ouvre la photo en mode dessin. On trace à la main des conduites (réseau neuf ou existant, diamètre), on pose des regards, des accessoires (rond, losange, triangle, carré avec une lettre) et des textes. Sept réseaux sont proposés : AEP, EU et EP en neuf et en existant, et « À abandonner » en pointillé. Aucun automatisme : pas de raccordement, de croisement ni de légende calculés.

La molette ou le pincement zoome, le fond se déplace au doigt ou à la souris (ou clic droit, ou barre d'espace). Annuler et rétablir sont disponibles (Ctrl+Z et Ctrl+Y). « Exporter l'image » enregistre la photo avec le dessin. Le repérage est gardé dans le navigateur pour chaque photo, et le bouton affiche le nombre d'objets dessinés.


## Version 1.18.0 : repérage complet, envoi en 3D et dessins des autres photos

Le repérage sur photo reprend toutes les options de l'outil « Repérage de réseaux sur photos », partie Photos, en manuel comme en automatique.

**Dessin manuel**
- Outils : Sélection, Conduite, Branchement, Regard, Accessoire, Texte, Légende. Panneau à trois onglets : Dessiner, Objet, Options.
- Préréglages : 7 réseaux (AEP, EU, EP neuf et existant, à abandonner), conduites avec matière et diamètre, branchements en pointillé, regards (repère R1, R2…), 21 accessoires. On peut en ajouter ses propres.
- Les points d'une conduite s'accrochent aux regards, aux accessoires et aux autres conduites ; l'objet lié entraîne la conduite quand on le déplace. Poignées sur les sommets et les milieux, taille des regards et accessoires, étiquettes déplaçables, texte libre, annuler / rétablir, export de l'image avec la légende.

**Automatismes** (chacun se coupe dans Options)
- Branchement automatique : depuis la conduite la plus proche, avec regard de branchement en assainissement.
- Tracé parallèle d'une conduite (côté, distance, type), avec report des branchements ; il suit l'origine tant qu'on ne le modifie pas.
- Raccords sur l'eau potable : coudes 45° et 90°, tés, réductions, raccordements intermatériaux, raccordements sur existant, prises de branchement, citerneaux en bout de branchement.
- Montages d'accessoires : poser une purge, une vidange, une ventouse, un poteau incendie, un compteur… sur une conduite crée le té, la vanne et l'accessoire, avec le diamètre adapté. Les règles se modifient dans Options.
- Diamètre des vannes et purges repris de la conduite, croisements avec transparence et signalement eau potable / assainissement, placement des étiquettes sans chevauchement, légende automatique.

**Envoi en 3D**
« Envoyer en 3D » place le repérage de la photo dans la vue 3D : conduites en tuyaux colorés sous le sol, regards en puits, accessoires en repères. Les objets sont placés sur le sol à partir de la position et de la direction de la photo (réglages de la vue 3D compris). Une fois envoyé, le repérage reste à jour à chaque modification ; « Retirer de la 3D » l'enlève. La précision dépend de la photo : sol supposé plat, objets loin de l'appareil moins fiables.

**Dessins des autres photos**
Quand on ouvre une photo, les repérages des autres photos proches apparaissent en transparence, reportés dans la vue. Avec l'outil Sélection on peut les déplacer, les prolonger, les reprendre dans la photo ouverte ou les supprimer : la modification est enregistrée sur la photo d'origine (et la 3D si elle y était envoyée).

Les photos sans position ou sans direction se repèrent toujours, mais ne peuvent ni être envoyées en 3D ni montrer les autres photos. Les repérages de la version 1.17.0 sont convertis à l'ouverture. Nouveaux fichiers : `assets/repere-core.js` (moteur) et `assets/photoproj.js` (lien photo / terrain).

## Version 1.27.0 : le repérage passe dans Chantier › Réseaux

Le bouton « Repérer » n'est plus dans la visionneuse : on choisit la photo dans Chantier › Réseaux › Repérage sur photos (liste filtrable). Les annotations restent affichables sur les photos.

## Version 1.28.0 : repérage des réseaux directement sur la carte IGN

Chantier › Réseaux › **Repérage sur le plan** : on dessine sur la carte, avec le moteur de l'outil « Repérage de réseaux sur photos » (mêmes symboles, étiquettes, raccords automatiques, branchements) : Sélectionner (V), Conduite (L), Branchement (B), Regard (R), Accessoire (A), Texte (T), annuler/rétablir, palette par réseau (AEP / EU / EP, neuf / existant / à abandonner), propriétés de l'objet sélectionné, récapitulatif des métrés, export GeoJSON et CSV. Les dessins partent en 3D (enterrés) et sont enregistrés avec le projet. Le bouton « Repérer » de la visionneuse reste retiré.

## Version 1.26.0 : réglage repris par les photos voisines

Nouveau bouton **Aux photos voisines** en vue superposée : le réglage de la photo ouverte (cap, décalage, hauteur, zoom) est repris par les photos du même appareil prises dans les 2 minutes autour. Elles ont la même dérive de compas et de GPS : une photo bien calée corrige ses voisines mal reliées par le calage automatique.

## Version 1.25.1 : maquette alignée sur le calage du projet

En vue superposée, une photo sans réglage propre utilise maintenant le calage automatique du projet (hauteur, cap et décalage corrigés d'après les autres photos) au lieu de la position brute du drone. Les photos voisines placent ainsi la maquette au même endroit. Un réglage manuel ou le fichier de calage de l'équipe restent prioritaires.

## Version 1.25.0 : la maquette ne bouge plus dans la vue 3D

Avant, la maquette était tournée (angle du nord) et déplacée pour se poser sur la carte. Maintenant elle reste exactement dans ses coordonnées d'origine. Ce sont le terrain, les photos, les réseaux et la caméra qui sont placés autour d'elle. En vue superposée, la photo est derrière et la maquette, intacte, est devant : la caméra reprend la position, le cap, l'inclinaison et le champ de la photo.
La carte 2D (maquette posée sur la carte) garde son placement.

## Version 1.24.0 : retrait du scan 3D et de l'onglet Réseaux

À refaire plus tard. Retirés : le scan 3D (nuage de points), le bouton Réseaux et le plan en vue de dessus, les réseaux dessinés sur la carte, et les fichiers `plan.js` et `netlayer.js`.
Conservés : le calage automatique du projet (y compris les vues de dessus), l'en-tête simplifié (menus 3D et ?), et le menu **Annotations** de la visionneuse qui montre ou masque les dessins de la photo et ceux des autres photos.

## Version 1.23.0 : en-tête simplifié, Réseaux = plan avec tous les outils, filtre d'annotations

- **Réseaux** (en haut) ouvre directement le plan aérien (sur un chantier long de plusieurs km, il couvre la zone visible de la carte au moment du clic : zoomez sur le secteur à dessiner avant de cliquer) en vue de dessus avec les mêmes outils que le repérage d'une photo. La barre de dessin sur la carte de la 1.22.0 est supprimée.
- Les réseaux dessinés s'affichent en lecture seule sur la carte (`assets/netlayer.js`, remplace `mapdraw.js`).
- En-tête réduit : Fond de carte, Réseaux, Chantier, **3D** (menu : photos en 3D, scan 3D, maquette, nuage de points), Exporter, thème, **?** (menu : tuto, aide).
- Dans la visionneuse, le menu **Annotations** filtre ce qui se voit sur la photo : réseaux du plan, dessins de cette photo, dessins des autres photos. Plus besoin d'ouvrir l'onglet Repérage pour les voir. Le choix est mémorisé.

## Version 1.21.0 : dessiner sur le plan, les dessins se placent dans toutes les photos

Nouveau bouton **Plan** (en haut). Il ouvre la carte aérienne IGN en vue de dessus, avec les mêmes outils que le repérage d'une photo (conduite, branchement, regard, accessoire, texte, légende, accroches). Comme le plan est une vraie carte, les dessins sont placés exactement sur le terrain : ils se reportent ensuite **dans toutes les photos** (en transparence dans « Repérer », et sur la photo dans la visionneuse avec le bouton « Dessins »), et inversement les repérages des photos apparaissent sur le plan.
- Le plan couvre toutes les photos avec une marge de 90 m (résolution jusqu'à 20 cm par pixel). Dès qu'on a dessiné dessus, sa zone est figée pour que les dessins ne glissent pas.
- Pas de calage à faire sur le plan. La précision dans une photo dépend du calage de cette photo (calage automatique du projet).
- « Envoyer en 3D » fonctionne aussi depuis le plan.
- Nouveau fichier : `assets/plan.js`. La caméra du plan est une vue de dessus exacte, sans perspective (dans `photoproj.js`).

## Version 1.20.1 : site plus léger et calage disponible plus tôt

- **Chargement** : les trois logos de la page d'accueil pesaient 500 Ko sur 920 Ko téléchargés. Ils sont redimensionnés à la taille réellement affichée (×3 pour les écrans denses) et compressés : environ 45 Ko, sans différence visible. La page d'accueil se charge ainsi deux fois plus légère.
- **Calage du projet** : le réglage des photos est maintenant appliqué dès qu'il est calculé. Le scan 3D, plus long, se termine ensuite en arrière-plan (bouton « Arrêter » pour le couper sans perdre le calage). Avant, tout attendait la fin du scan.

## Version 1.20.0 : scan 3D du chantier et calage des vues de dessus

**Scan 3D.** Le nuage de points n'est plus plat. Après le calage du projet, GeoTrace cherche les points communs entre les photos voisines en supposant que le sol est à plusieurs hauteurs (0, 4, 9, 16 et 28 m : sol, toits, arbres, talus). Les deux rayons de chaque point se croisent dans l'espace : on obtient sa position et sa hauteur, avec la couleur prise sur les photos. Les croisements peu nets sont écartés. Le résultat est gardé dans le navigateur avec le projet.
- Bouton **Scan 3D** (en haut, à côté de « Recaler le projet ») : ouvre la vue 3D avec le nuage de points en couleur, **sans avoir besoin d'une maquette**. Avec une maquette, le scan s'affiche avec elle.
- Dans la vue 3D, la case **Scan 3D** l'affiche ou le masque.
- Limite : le scan est clairsemé (quelques centaines à quelques milliers de points par zone), plus dense là où les photos se recoupent bien.

**Vues de dessus (drone à la verticale).** Elles avaient peu de points communs avec les vues obliques (la hauteur de vol mal connue décale le sol de 10 à 25 m) et le calage partait sur une mauvaise solution (cap de 12°). Maintenant, pour ces paires, on essaie plusieurs rotations et plusieurs décalages avant de chercher les points communs : 111 points communs au lieu de 18 entre les photos 222 et 223, et les dessins d'une photo oblique tombent beaucoup plus près de leur vraie place sur la vue de dessus. Une vue de dessus compare aussi plus de voisines (14 au lieu de 10, jusqu'à 260 m).

## Version 1.19.5 : correction de l'affichage de la photo dans la visionneuse

Sur grand écran, la photo de la visionneuse dépassait de son cadre (image rognée en haut et en bas) depuis l'ajout des dessins sur la photo. Elle est de nouveau entière et centrée.

## Version 1.19.4 : les dessins modifiés ou lointains réapparaissent sur les autres photos

- Quand un dessin a été « repris » dans une photo puis **modifié ou prolongé sur sa photo d'origine**, il réapparaît en transparence sur la photo qui l'avait repris (avant, il restait caché).
- Un tracé dont un seul point est hors champ, derrière la photo ou trop près de l'horizon n'est plus supprimé en entier : on reporte les points qui se projettent.
- Le panneau « Autres photos » indique combien de dessins ne peuvent pas être reportés (hors champ ou trop près de l'horizon).

## Version 1.19.3 : calage du projet nettement plus précis

- **Mesure plus fine** : les points communs sont maintenant mesurés au sous-pixel et une 4e passe est faite sur des images plus grandes (720 px).
- **Réglage plus complet** : en plus du cap, de l'inclinaison, de la position et de la hauteur, chaque photo reçoit aussi un réglage de **roulis** et de **zoom (focale)**.
- Mesuré sur les 222 photos de test (16 paires comparées à des points repérés dans l'image) : écart médian **de 45 px avant calage à 6 px** (11 px dans la version précédente) ; la plupart des paires sont sous 10 px, les vues de dessus prises à plus de 90 m de haut restent vers 15 px (relief du terrain non modélisé).
- Le calage complet prend environ 3 minutes pour 220 photos (barre de progression).

## Version 1.19.2 : meilleur calage en vue de dessus

- Le cap d'un drone qui regarde à la verticale est peu fiable : le calage essaie plusieurs rotations et garde celle qui donne les points communs les plus nets (calage du projet et calage automatique d'une photo).
- Les photos de comparaison sont choisies proches **et d'inclinaison semblable** (une vue de dessus a plus de voisines et un rayon plus large), car une vue de dessus se compare mal à une vue très rasante.
- Le calage ignore les mesures fausses (arbres, bâtiments) en ne gardant que celles qui s'accordent, ce qui évite des refus à tort.
- Si le calage automatique ne trouve pas assez de points fiables, le calage par points communs s'ouvre tout seul.

## Version 1.19.1 : calage automatique à l'ouverture du projet

Plus besoin de cliquer : dès que les photos sont chargées, le calage du projet se lance tout seul (fenêtre de progression, bouton « Arrêter »). Si les mêmes photos ont déjà été calées, il n'est pas refait ; si on en ajoute ou qu'on ouvre un autre projet, il se relance. Le bouton « Recaler le projet » force un nouveau calage. L'ouverture du repérage attend la fin du calage.

## Version 1.19.0 : calage de tout le projet (nuage de points commun)

Bouton **« Calage projet »** (barre du haut). Le site compare toutes les photos voisines entre elles (6 plus proches, moins de 150 m), retrouve les détails visibles sur deux photos (les « points communs », qui forment un nuage) puis règle **toutes les photos en même temps** (cap, inclinaison, position, hauteur) pour que ces points tombent au même endroit du sol vus de chaque photo. Le GPS et la boussole servent de rappel : une photo mal reliée reste proche de ses valeurs d'origine. Trois passes de plus en plus fines.

- Mesuré sur les 222 photos de test : environ 1 à 1,5 min ; écart médian entre photos voisines de 14–150 px avant calage à 3–17 px après (une paire est restée vers 20–40 px).
- Le réglage est enregistré pour chaque photo (calage des réseaux, indépendant de celui de la maquette) et les dessins se recalculent à l'ouverture. Le nuage de points s'affiche sur la carte (points roses).
- Bouton « Arrêter » : rien n'est modifié si on interrompt.
- Limites : sol supposé plat, photos sans voisine à moins de 150 m non réglées, points proches de l'horizon ignorés.

## Version 1.18.4 : calages séparés pour la maquette et les réseaux

Le calage d'une photo est maintenant **double et indépendant** : celui de la **maquette** (vue 3D, comme avant) et celui des **réseaux** (repérage sur photo, calage automatique et par points). Caler les réseaux ne bouge plus la maquette, et inversement. Les réseaux envoyés en 3D restent posés au bon endroit du terrain grâce au calage des réseaux. Les photos déjà calées pour la maquette gardent leur réglage ; le calage des réseaux repart de zéro.

## Version 1.18.3 : dessins visibles sur la photo, calage par points communs

- **Dessins sur la photo** : dans la visionneuse, le repérage de la photo (et celui des photos voisines, en transparence) s'affiche directement sur l'image, sans ouvrir « Repérer ». Bouton **« Dessins »** pour les afficher ou les masquer ; ils suivent le zoom et la rotation.
- **Caler par points communs** (Repérer > Dessiner > Caler la photo) : une photo voisine s'affiche en haut à gauche ; cliquez un point reconnaissable (angle de bâtiment, bordure, regard), puis le même endroit sur la photo en cours. Avec 1 à 2 points le cap, l'inclinaison, le roulis et le zoom sont réglés ; à partir de 3 points la position et la hauteur le sont aussi. « Autre photo de référence » change de voisine. Le réglage sert aussi dans la vue 3D.

## Version 1.18.2 : calage automatique des photos

Mesuré sur 224 photos drone réelles : l'erreur de placement vient surtout du GPS, de la hauteur et du cap de chaque photo (environ 2 % de la distance, soit 20 à 150 px sur une photo de 2400 px).

- Onglet Dessiner, **« Caler la photo » > « Recaler automatiquement »** : la photo est comparée aux 3 photos voisines les plus proches (moins de 120 m). Le programme les redresse comme si elles étaient prises du même point, mesure le décalage sur plusieurs centaines d'endroits, puis corrige cap, inclinaison, position et hauteur.
- Sur les photos de test, l'écart médian passe d'environ 20 à 150 px à 2 à 15 px. Le réglage est enregistré comme les autres : la vue 3D en profite aussi.
- Si les photos ont trop peu de détails en commun (champ uni, ciel), ou si la correction trouvée est invraisemblable, rien n'est modifié et un message l'explique.
- Limites : sol supposé plat, points proches de l'horizon non projetés.

## Version 1.18.1 : recalage des photos pour les superpositions

Les dessins des autres photos et l'envoi en 3D reposent sur la position GPS, le cap et l'inclinaison de chaque photo. Ces valeurs sont approximatives (surtout sur drone : GPS à quelques mètres, boussole à quelques degrés, sol supposé plat), ce qui décale les superpositions.

- Le repérage utilise maintenant les **mêmes réglages fins par photo que la vue 3D** (cap, inclinaison, roulis, zoom, décalages, y compris ceux du fichier de calage de l'équipe). Un réglage fait d'un côté vaut de l'autre.
- Onglet Dessiner, **« Caler la photo »** : « Caler sur un dessin » (cliquer un point d'un dessin en transparence, puis l'endroit où il doit tomber sur la photo ; un point règle cap et inclinaison, deux ou plus règlent aussi roulis et zoom) et curseurs de réglage fin. Les dessins des autres photos et la 3D suivent immédiatement.
- Les points trop proches de l'horizon (moins de 1,5° sous l'horizontale) ne sont plus projetés : leur position au sol n'est pas fiable.
