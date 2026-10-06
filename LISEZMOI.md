# SEB-ROULPIANO (piano roll d'apprentissage)

En ligne : https://seb102.github.io/seb-roulpiano/ — ou en local : ouvrir `index.html` dans Chrome / Safari / Firefox (double-clic). Internet requis au 1er lancement
(échantillons de piano + Tone.js) ; sans connexion, un synthé de secours prend le relais.

- **Fichiers** : .mid / .midi, .musicxml / .xml, .mxl (partition exportée de MuseScore, Finale, Sibelius…).
  Glisser-déposer possible. Bouton « Exemple » = début de « Lettre à Élise » (Beethoven) intégré, saisi de mémoire : à vérifier sur la partition.
- **Commandes** : ⏮ Début · ▶ Lecture · ⏸ Pause (garde la position) · vitesse 0 à 3 (1× = tempo du fichier)
  · **Tempo ♩ =** (noires/min) : par défaut celui du fichier (60 pour l'exemple), modifiable (20–300), ↺ pour revenir au tempo du fichier
  · barre de progression cliquable. Clavier : Espace = lecture/arrêt, Début = retour, ← → = mesure précédente/suivante, ↑ ↓ = vitesse.
- **Couleurs** : orange = main droite (M.D.), bleu = main gauche (M.G.) ; la couleur suit la main du doigté (M.D. ou M.G.), indépendamment des clés : une note déclarée M.D. est orange, une note déclarée M.G. est bleue. Teinte plus foncée = touche noire.
  Mains : 2 pistes/parties/portées si le fichier en a deux (la plus aiguë = droite), sinon coupure au Do central.
  Quand les deux mains sont écrites sur la même portée (ex. Hanon n°1 : début en clé de fa pour les deux mains), deux voix de rythme identique sur cette portée sont attribuées à deux mains : la voix haute = M.D., la basse = M.G. Sinon la main reste corrigeable note par note dans la bulle de saisie.
- **Synchro son/image** : la latence audio (100 ms de marge de Tone.js supprimés, + délai du navigateur et de la sortie audio) est compensée en retardant l'image ; le champ « Synchro » (ms, −300 à 1000, mémorisé) permet d'affiner (Bluetooth…).
- **Clavier** : adapté à l'étendue du morceau (octaves entières, 3 minimum) : moins d'octaves = touches plus larges.
- **Doigtés** : sélecteur à 3 positions — « Masquer les doigtés », « Doigtés simples » (mode de départ à chaque ouverture de l'application, le choix n'est pas mémorisé ; étiquettes « M.D. 1 » / « M.G. 4 » au-dessus des notes qui défilent ; sur le clavier, le chiffre et M.D./M.G. sur la touche jouée) ou « Doigtés illustrés ».
  Doigtés illustrés : un petit schéma de main en « râteau » (une barre par doigt, pouces courts, mains opposées) au-dessus de chaque note, avec le doigt à utiliser en orange et son numéro dans une pastille ; les schémas des notes rapprochées s'empilent dans l'ordre chronologique (la prochaine à jouer au premier plan, les suivantes estompées derrière). Sur le clavier, une bulle centrée sur la touche apparaît quand la note est jouée, flotte tant qu'elle sonne (0,3 s au minimum) et éclate à sa fin.
  Ceux d'un MusicXML (saisis dans MuseScore avec la palette « Doigtés ») sont lus automatiquement. Pour en saisir/corriger : cliquer sur une note (la lecture se met en pause) ; la bulle de saisie propose M.D. / M.G. (ou touches D / G) et le doigt : boutons 1-5 (main droite 1→5, gauche 5→1) en mode simple, schéma cliquable en mode illustré ; touches 1-5 au clavier, 0 / Suppr pour effacer, Échap pour fermer. Par défaut la portée du haut = M.D. et celle du bas = M.G. ; la couleur de la note suit la main choisie.
  Corriger la main d'un GROUPE de notes : glisser un rectangle sur le rouleau (la lecture se met en pause) ; les notes touchées sont entourées et une barre « N notes — M.D. / M.G. / ✕ » applique la main choisie à tout le groupe (Échap ou clic ailleurs : annuler). Un simple clic sur une note ouvre toujours la bulle de saisie.
  Les doigtés saisis ne sont pas enregistrés dans le navigateur : ils disparaissent à la fermeture ou au rechargement de la page (les doigtés écrits dans le fichier MusicXML lui-même s'affichent de nouveau à chaque ouverture de ce fichier). Seul l'export ⤓ (fichier .doigtes.json) les conserve ; ⤒ le recharge (remplace les doigtés actuels).
- **Rails verticaux** : une ligne par touche (blanche ou noire) à la verticale exacte de sa touche, le long de laquelle glisse la note ; bande sombre sous les touches noires, Do plus marqués.
- **Clavier miniature en haut du rouleau** : mêmes touches, même largeur et mêmes colonnes que le clavier du bas (peu haut, ~26 px), pour suivre une note de haut en bas ; les touches des notes qui sonnent s'y allument aussi.
- **Plein écran** : bouton « ⛶ Plein écran » (à droite de la barre de progression) : toute l'application, réglages compris, passe en plein écran ; Échap ou le même bouton pour quitter. Absent sur les navigateurs sans cette fonction (iPhone).
- **Mesures visibles** : 1 à 4 (2 par défaut), numéros de mesure sur les barres.
- **Export vidéo** : bouton « 🎬 Export vidéo » (720p ou 1080p). Enregistre en temps réel image + son, à la vitesse
  réglée (durée = durée du morceau ÷ vitesse), puis télécharge un .mp4 (ou .webm selon le navigateur ; Chrome recommandé).
  Garder l'onglet visible pendant l'export ; Échap ou le même bouton annule. Impossible à la vitesse 0.
- Non géré : répétitions/reprises MusicXML (jouées une seule fois), PDF/images de partitions.

Mode d'emploi illustré : `MODE-D-EMPLOI.html` (autonome, images intégrées) et `MODE-D-EMPLOI.pdf` (même contenu, imprimable).

Fichiers : `index.html` (application), `core.js` (lecture MIDI/MusicXML/MXL), `test_core.js` (tests : `node test_core.js`),
`exemples.js` (génère les exemples), `exemple.musicxml`, `index.template.html` (source de index.html).
