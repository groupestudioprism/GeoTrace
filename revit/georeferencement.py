# GeoTrace : géoréférencer le projet Revit ouvert (à coller dans un nœud « Python Script » de Dynamo, moteur CPython3).
# Entrées : IN[0] latitude, IN[1] longitude (degrés, WGS84), IN[2] Est, IN[3] Nord, IN[4] altitude (mètres, Lambert-93 ou zone CC),
#           IN[5] angle du nord du projet en degrés, IN[6] appliquer (False = seulement lire et afficher).
import clr, math
clr.AddReference('RevitAPI')
clr.AddReference('RevitServices')
from Autodesk.Revit.DB import XYZ, ProjectPosition
from RevitServices.Persistence import DocumentManager
from RevitServices.Transactions import TransactionManager

doc = DocumentManager.Instance.CurrentDBDocument
lat, lon, est, nord, alt, angle, appliquer = [IN[i] for i in range(7)]
FT = 0.3048          # Revit stocke les longueurs en pieds
out = []

site = doc.SiteLocation
loc = doc.ActiveProjectLocation
pos = loc.GetProjectPosition(XYZ.Zero)   # position de l'origine interne dans les coordonnées partagées
out.append('Lieu actuel : lat %.6f, lon %.6f' % (math.degrees(site.Latitude), math.degrees(site.Longitude)))
out.append('Origine interne : Est %.3f m, Nord %.3f m, altitude %.3f m, angle %.3f deg'
           % (pos.EastWest * FT, pos.NorthSouth * FT, pos.Elevation * FT, math.degrees(pos.Angle)))

set_lieu = bool(lat) and bool(lon)
set_coord = bool(est) and bool(nord)
if not (set_lieu or set_coord):
    out.append('Rien à changer : renseignez la latitude et la longitude, et/ou l\'Est et le Nord.')
elif not appliquer:
    out.append('Aperçu seulement. Mettez « Appliquer » sur True pour écrire dans le projet.')
else:
    try:
        TransactionManager.Instance.EnsureInTransaction(doc)
        if set_lieu:
            site.Latitude = math.radians(lat)
            site.Longitude = math.radians(lon)
            out.append('Lieu du projet mis à %.6f, %.6f' % (lat, lon))
        if set_coord:
            loc.SetProjectPosition(XYZ.Zero, ProjectPosition(est / FT, nord / FT, alt / FT, math.radians(angle)))
            out.append('Origine interne placée à Est %.3f, Nord %.3f, altitude %.3f, angle %.3f deg' % (est, nord, alt, angle))
        TransactionManager.Instance.TransactionTaskDone()
    except Exception as e:
        out.append('Échec : %s' % e)

OUT = out
