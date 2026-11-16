# Référencer un projet Revit pour GeoTrace

But : que la maquette arrive **déjà bien placée** dans GeoTrace, sans point de calage. À faire **une fois par projet**, dans le modèle Revit de l'affaire. Les libellés de menus varient un peu selon la version de Revit.

## 1. Ce qu'il faut demander au géomètre
- Les coordonnées d'**un point connu** du chantier (angle de bâtiment, regard, borne), en **Lambert-93** (EPSG:2154) ou en zone **CC** (par exemple CC48, EPSG:3948, pour le Morbihan). Le système doit être écrit : « RGF93 / Lambert-93 ».
- Idéalement son **plan DWG déjà en Lambert-93**. C'est la méthode la plus précise (méthode A ci-dessous).
- Une **altitude NGF** si elle est utile. GeoTrace ne s'en sert pas pour le placement, seulement pour la 3D.

Ne prenez pas des latitudes/longitudes (GPS) comme coordonnées du projet : Revit attend des coordonnées planes en mètres.

## 2. Les mots de Revit
- **Origine interne** : le (0 ; 0) du fichier, invisible, fixe.
- **Point de base du projet** : l'origine du repère de votre chantier. On le laisse là où il est.
- **Point de mesure** : le point où l'on dit « ici, ce sont les coordonnées du géomètre ».
- **Coordonnées partagées** : les coordonnées réelles (Lambert). Ce sont elles que GeoTrace veut.
- **Nord vrai** : l'angle entre le haut de votre plan et le nord. En Lambert, prenez le **nord du quadrillage** (le haut du plan Lambert), pas le nord géographique : l'écart est d'environ 4° à Vannes.

## 3. Méthode A (recommandée) : depuis le DWG du géomètre
1. Onglet **Insérer > Lier CAO**. Choisissez le DWG en Lambert-93, positionnement **Origine à origine**, unités en mètres.
2. Onglet **Gérer > Coordonnées > Acquérir les coordonnées**, puis cliquez sur le DWG lié.
3. Revit règle alors les coordonnées partagées **et** l'angle du nord. Vérifiez à l'étape 6.

## 4. Méthode B : à partir d'un seul point connu
1. **Gérer > Unités du projet** : longueur en **mètres**, 3 décimales.
2. **Gérer > Coordonnées > Spécifier les coordonnées au point**, cliquez sur le point du modèle qui correspond au point du géomètre, puis saisissez : **E/O** = Est (le X de Lambert, par exemple 267 995,000), **N/S** = Nord (le Y, par exemple 6 743 990,000), **Élévation** = altitude.
3. Réglez l'angle : **Gérer > Position > Faire pivoter le nord vrai** pour que le haut du plan Lambert soit respecté, ou saisissez l'angle dans les propriétés du point de base du projet. Un seul point ne donne pas l'orientation : sans un second point ou le DWG, l'angle reste une estimation.

## 5. Sans coordonnées : le lieu du projet (précision de quelques dizaines de mètres)
**Gérer > Emplacement** : saisissez l'adresse du chantier et validez. GeoTrace place la maquette à cet endroit, nord vers le haut ou selon l'angle du nord vrai. Si l'adresse reste celle par défaut de Revit, GeoTrace le détecte et refuse de placer la maquette au mauvais endroit (message à l'écran).

## 6. Vérifier dans Revit
- Affichez le **point de mesure** et le **point de base du projet** (Visibilité/Graphismes, catégorie Site).
- **Gérer > Coordonnées > Rapporter les coordonnées partagées**, cliquez sur un point connu : vous devez retrouver les valeurs du géomètre.
- Un chiffre type : à Vannes, Lambert-93 donne un Est autour de 260 000 à 270 000 et un Nord autour de 6 740 000. Si vous voyez 0 ; 0, ou des valeurs en pieds, quelque chose est faux.

## 7. Exporter
1. Importez la configuration `GeoTrace-IFC-Revit2026.json` (Fichier > Exporter > IFC > Modifier la configuration > Importer).
2. Vérifiez : **IFC 4 Reference View**, base de coordonnées **Coordonnées partagées**. Le fichier fourni renseigne déjà le système **CC48** (EPSG 3948). Pour un autre système, changez `GeoRefEPSGCode` et `GeoRefCRSName` dans le JSON (2154 pour Lambert-93), ou saisissez le code dans la fenêtre de configuration.
3. Exportez depuis une vue 3D où seuls les éléments utiles sont visibles.
4. Dans GeoTrace, la maquette doit se placer toute seule. Le panneau Maquette dit d'où vient la position : « coordonnées enregistrées dans Revit (Lambert-93) » ou « lieu du projet ».

## 8. Erreurs fréquentes
- **Maquette à l'origine (0 ; 0)** : Revit n'a reçu aucune coordonnée. Reprenez les méthodes A, B ou 5.
- **Maquette très loin des photos** : lieu par défaut de Revit, ou Est et Nord inversés.
- **Maquette décalée de quelques mètres** : le point cliqué dans Revit n'est pas celui du géomètre, ou les unités ont perdu des décimales.
- **Maquette tournée de 4° environ** : le nord vrai a été réglé sur le nord géographique au lieu du nord du quadrillage Lambert.
- **Maquette en miroir ou à l'échelle bizarre** : unités du projet en pieds ou millimètres, ou projet lié dans un autre système.
- **Plusieurs maquettes (structure, réseaux)** : donnez le même point de mesure et les mêmes coordonnées à tous les fichiers, sinon chacun tombe ailleurs.
- **Modifier le point de mesure** après un premier export : tous les exports suivants bougent. Prévenez l'équipe.

## 9. Option : script Dynamo
`GeoTrace-georeferencement.dyn` (ou le code seul, `georeferencement.py`, à coller dans un nœud Python CPython3) lit le lieu et la position du projet, puis les écrit si vous passez « Appliquer » sur True. Il place l'**origine interne** aux coordonnées saisies. Faites d'abord une lecture seule, enregistrez une copie du projet, puis vérifiez avec l'étape 6. Le sens de l'angle doit être contrôlé visuellement.
