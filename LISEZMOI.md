# SEB-ROULPIANO (piano roll d'apprentissage)

En ligne : https://seb102.github.io/seb-roulpiano/ — ou en local : ouvrir `index.html` dans Chrome / Safari / Firefox (double-clic). Internet requis au 1er lancement
(échantillons de piano + Tone.js) ; sans connexion, un synthé de secours prend le relais.

- **Fichiers** : .mid / .midi, .musicxml / .xml, .mxl (partition exportée de MuseScore, Finale, Sibelius…).
  Glisser-déposer possible. Bouton « Exemple » = début de « Lettre à Élise » (Beethoven) intégré, saisi de mémoire : à vérifier sur la partition.
- **Commandes** : ⏮ Début · ▶ Lecture · ⏸ Pause (garde la position) · vitesse 0 à 3 (1× = tempo du fichier)
  · barre de progression cliquable. Clavier : Espace = lecture/arrêt, Début = retour, ← → = mesure précédente/suivante, ↑ ↓ = vitesse.
- **Couleurs** : orange = clé de sol (main droite), bleu = clé de fa (main gauche) ; teinte plus foncée = touche noire. Pas de doigtés.
  Mains : 2 pistes/parties/portées si le fichier en a deux (la plus aiguë = droite), sinon coupure au Do central.
- **Mesures visibles** : 1 à 4 (2 par défaut), numéros de mesure sur les barres.
- **Export vidéo** : bouton « 🎬 Export vidéo » (720p ou 1080p). Enregistre en temps réel image + son, à la vitesse
  réglée (durée = durée du morceau ÷ vitesse), puis télécharge un .mp4 (ou .webm selon le navigateur ; Chrome recommandé).
  Garder l'onglet visible pendant l'export ; Échap ou le même bouton annule. Impossible à la vitesse 0.
- Non géré : répétitions/reprises MusicXML (jouées une seule fois), PDF/images de partitions.

Fichiers : `index.html` (application), `core.js` (lecture MIDI/MusicXML/MXL), `test_core.js` (tests : `node test_core.js`),
`exemples.js` (génère les exemples), `exemple.musicxml`, `index.template.html` (source de index.html).
