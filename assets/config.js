/* Réglages de GeoTrace. Modifiez ce fichier sans toucher au reste de l'application. */
window.GEOTRACE_CONFIG = {
  /* Serveur Nextcloud utilisé quand l'adresse de la page contient ?s=CODE_DE_PARTAGE */
  nextcloud: 'https://buildingnext.sturno.fr',
  /* Lien de partage Nextcloud de la maquette Revit (fichier .ifc/.glb ou dossier). Pré-remplit le panneau Maquette ; ?maquette=LIEN l'ouvre directement. */
  maquetteLien: '',
  /* Visionneuse de maquette externe (optionnel), par exemple 'maquette.html#photo={photo}'. Vide : bouton masqué. */
  maquette: '',
  /* Profondeur maximale des sous-dossiers lus sur un lien de partage Nextcloud */
  maxDepth: 3,
  /* Nombre de photos lues en parallèle */
  concurrency: 4,
};
