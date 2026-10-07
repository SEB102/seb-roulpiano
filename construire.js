/* Fabrique index.html : index.template.html + les deux exemples intégrés (Goldberg, Lettre à Élise) en base64.  Usage : node construire.js */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/exemple-goldberg.musicxml').toString('base64'), b64e = fs.readFileSync(__dirname + '/exemple.musicxml').toString('base64');
fs.writeFileSync(__dirname + '/index.html', fs.readFileSync(__dirname + '/index.template.html', 'utf8').replace('__EXEMPLE_B64__', b64).replace('__EXEMPLE_ELISE_B64__', b64e));
console.log('index.html écrit');
