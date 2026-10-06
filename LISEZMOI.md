# SEB-ROULPIANO (piano roll d'apprentissage)

En ligne : https://seb102.github.io/seb-roulpiano/ — ou en local : ouvrir `index.html` dans Chrome / Safari / Firefox (double-clic). Internet requis au 1er lancement
(échantillons de piano + Tone.js) ; sans connexion, un synthé de secours prend le relais.

- **Fichiers** : .mid / .midi, .musicxml / .xml, .mxl (partition exportée de MuseScore, Finale, Sibelius…).
  Glisser-déposer possible. Bouton « Exemple » = début de « Lettre à Élise » (Beethoven) intégré, saisi de mémoire : à vérifier sur la partition.
- **Commandes** : ⏮ Début · ▶ Lecture · ⏸ Pause (garde la position) · vitesse 0 à 3 (1× = tempo du fichier)
  · **Tempo ♩ =** (noires/min) : par défaut celui du fichier (60 pour l'exemple), modifiable (20–300), ↺ pour revenir au tempo du fichier
  · barre de progression cliquable. Clavier : Espace = lecture/arrêt, Début = retour, ← → = mesure précédente/suivante, ↑ ↓ = vitesse.
- **Couleurs** : orange = main droite (M.D.), bleu = main gauche (M.G.) ; par défaut clé de sol = M.D. et clé de fa = M.G., mais la couleur suit la main du doigté : une note de clé de fa déclarée M.D. devient orange. Teinte plus foncée = touche noire. Pas de doigtés.
  Mains : 2 pistes/parties/portées si le fichier en a deux (la plus aiguë = droite), sinon coupure au Do central.
- **Synchro son/image** : la latence audio (100 ms de marge de Tone.js supprimés, + délai du navigateur et de la sortie audio) est compensée en retardant l'image ; le champ « Synchro » (ms, −300 à 1000, mémorisé) permet d'affiner (Bluetooth…).
- **Clavier** : adapté à l'étendue du morceau (octaves entières, 3 minimum) : moins d'octaves = touches plus larges.
- **Doigtés** : bouton « Afficher/Masquer les doigtés ». Affichés au format « M.D. 1 » / « M.G. 4 » au-dessus des notes qui défilent et sur les touches du clavier quand elles sont jouées. Par défaut clé de sol = M.D., clé de fa = M.G. ; la main d'une note se change dans la fenêtre de saisie (boutons M.D. / M.G., ou touches D / G ; les chiffres vont de 1 à 5 pour la main droite et de 5 à 1 pour la main gauche) ; la couleur de la note suit ce choix. Ceux d'un MusicXML (saisis dans MuseScore avec la palette « Doigtés ») sont lus automatiquement.
  Pour en saisir/corriger : cliquer sur une note (la lecture se met en pause) puis 1 à 5 (souris ou clavier), 0 / Suppr pour effacer, Échap pour fermer.
  Mémorisés par morceau dans le navigateur ; ⤓ exporte dans un fichier .doigtes.json, ⤒ le recharge (remplace les doigtés actuels).
- **Mesures visibles** : 1 à 4 (2 par défaut), numéros de mesure sur les barres.
- **Export vidéo** : bouton « 🎬 Export vidéo » (720p ou 1080p). Enregistre en temps réel image + son, à la vitesse
  réglée (durée = durée du morceau ÷ vitesse), puis télécharge un .mp4 (ou .webm selon le navigateur ; Chrome recommandé).
  Garder l'onglet visible pendant l'export ; Échap ou le même bouton annule. Impossible à la vitesse 0.
- Non géré : répétitions/reprises MusicXML (jouées une seule fois), PDF/images de partitions.

Mode d'emploi illustré : `MODE-D-EMPLOI.html` (autonome, images intégrées) et `MODE-D-EMPLOI.pdf` (même contenu, imprimable).

Fichiers : `index.html` (application), `core.js` (lecture MIDI/MusicXML/MXL), `test_core.js` (tests : `node test_core.js`),
`exemples.js` (génère les exemples), `exemple.musicxml`, `index.template.html` (source de index.html).
