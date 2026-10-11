/* Fabrique index.html : index.template.html + les trois exemples intégrés (Goldberg, Lettre à Élise, J'ai du bon tabac) en base64.  Usage : node construire.js */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/exemple-goldberg.musicxml').toString('base64'), b64e = fs.readFileSync(__dirname + '/exemple.musicxml').toString('base64'), b64t = fs.readFileSync(__dirname + '/exemple-tabac.musicxml').toString('base64');
const crypto = require('crypto'), vers = f => crypto.createHash('md5').update(fs.readFileSync(__dirname + '/' + f)).digest('hex').slice(0, 8);   // version d'un script = empreinte de son contenu : le navigateur recharge un script dès qu'il change
fs.writeFileSync(__dirname + '/index.html', fs.readFileSync(__dirname + '/index.template.html', 'utf8').replace(/(\b[A-Za-z_0-9]+\.js)\?v=[A-Za-z0-9]*/g, (m, f) => fs.existsSync(__dirname + '/' + f) ? f + '?v=' + vers(f) : m).replace('__EXEMPLE_B64__', b64).replace('__EXEMPLE_ELISE_B64__', b64e).replace('__EXEMPLE_TABAC_B64__', b64t));
console.log('index.html écrit');
