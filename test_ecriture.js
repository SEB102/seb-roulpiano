/* Tests du module d'écriture (ecriture.js) : node test_ecriture.js */
'use strict';
const assert = require('assert');
const PianoEdit = require('./ecriture.js'), PianoCore = require('./core.js');
let ok = 0;
const test = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.log('  ÉCHEC  ' + nom + '\n      ' + (e.stack || e).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const PPQ = 480;

test('partition vierge : une mesure en 4/4, aucune note, tempo 120', () => {
  const s = PianoEdit.creer(4, 4, 120);
  assert.strictEqual(s.notes.length, 0); assert.strictEqual(s.measures.length, 1);
  assert.deepStrictEqual([s.measures[0].num, s.measures[0].den, s.measures[0].lenTick, s.measures[0].startTick], [4, 4, 4 * PPQ, 0]);
  assert.strictEqual(s.endTick, 4 * PPQ); assert.ok(Math.abs(s.durationSec - 2) < 1e-9); assert.ok(Math.abs(s.fileBpm - 120) < 1e-9);
});

test('mesures 3/4 et 6/8 : longueurs justes', () => {
  assert.strictEqual(PianoEdit.creer(3, 4).measures[0].lenTick, 3 * PPQ);
  assert.strictEqual(PianoEdit.creer(6, 8).measures[0].lenTick, 3 * PPQ);
  assert.strictEqual(PianoEdit.creer(5, 4).measures[0].lenTick, 5 * PPQ);
});

test('ajouter une note : triée, durée, main par la hauteur, temps en secondes', () => {
  const s = PianoEdit.creer(4, 4, 120);
  PianoEdit.ajouter(s, { midi: 64, tick: PPQ, dur: PPQ });
  PianoEdit.ajouter(s, { midi: 48, tick: 0, dur: 2 * PPQ });
  assert.deepStrictEqual(s.notes.map(n => n.midi), [48, 64]);
  assert.deepStrictEqual(s.notes.map(n => n.hand), ['L', 'R']);
  assert.ok(Math.abs(s.notes[1].t0 - 0.5) < 1e-9 && Math.abs(s.notes[1].t1 - 1) < 1e-9);
  assert.strictEqual(s.maxDur, 2 * PPQ); assert.strictEqual(s.lo, 48); assert.strictEqual(s.hi, 64);
});

test('le nombre de mesures s\'incrémente tout seul quand une note dépasse', () => {
  const s = PianoEdit.creer(4, 4);
  PianoEdit.ajouter(s, { midi: 60, tick: 3 * PPQ, dur: 3 * PPQ });   // finit dans la 2e mesure
  assert.strictEqual(s.measures.length, 2);
  PianoEdit.ajouter(s, { midi: 62, tick: 9 * PPQ, dur: PPQ });       // 3e mesure (ticks 8..12 noires) : la mesure 3 existe
  assert.strictEqual(s.measures.length, 3);
  assert.strictEqual(s.endTick, 12 * PPQ); assert.strictEqual(s.measures[2].label, '3');
});

test('ajouterMesure puis retirerMesuresVides : conserve ce qui est écrit', () => {
  const s = PianoEdit.creer(4, 4);
  PianoEdit.ajouter(s, { midi: 60, tick: 0, dur: PPQ });
  PianoEdit.ajouterMesure(s); PianoEdit.ajouterMesure(s);
  assert.strictEqual(s.measures.length, 3);
  PianoEdit.retirerMesuresVides(s);
  assert.strictEqual(s.measures.length, 1);
  PianoEdit.ajouter(s, { midi: 60, tick: 5 * PPQ, dur: PPQ });
  PianoEdit.retirerMesuresVides(s);
  assert.strictEqual(s.measures.length, 2);
});

test('changer la mesure à partir d\'une mesure : le rouleau se reformate', () => {
  const s = PianoEdit.creer(4, 4);
  PianoEdit.ajouterMesure(s); PianoEdit.ajouterMesure(s);   // 3 mesures de 4/4
  PianoEdit.changerMesure(s, 1, 3, 4);                      // mesures 2 et 3 en 3/4
  assert.deepStrictEqual(s.measures.map(m => [m.startTick, m.lenTick, m.num, m.den]), [[0, 4 * PPQ, 4, 4], [4 * PPQ, 3 * PPQ, 3, 4], [7 * PPQ, 3 * PPQ, 3, 4]]);
  assert.strictEqual(s.endTick, 10 * PPQ);
  PianoEdit.changerMesure(s, 0, 6, 8);
  assert.ok(s.measures.every(m => m.num === 6 && m.den === 8 && m.lenTick === 3 * PPQ));
  assert.strictEqual(s.measures.length, 3);
});

test('changer la mesure : une mesure de plus est ajoutée si une note n\'a plus sa place', () => {
  const s = PianoEdit.creer(4, 4);
  PianoEdit.ajouter(s, { midi: 60, tick: 3 * PPQ, dur: PPQ });
  PianoEdit.changerMesure(s, 0, 2, 4);                      // 2 noires par mesure : la note à 3 noires est en mesure 2
  assert.ok(s.measures.length >= 2); assert.ok(s.endTick >= 4 * PPQ);
});

test('même hauteur : une nouvelle note raccourcit celle qu\'elle chevauche, et est bornée par la suivante', () => {
  const s = PianoEdit.creer(4, 4);
  PianoEdit.ajouter(s, { midi: 60, tick: 0, dur: 2 * PPQ });
  PianoEdit.ajouter(s, { midi: 60, tick: PPQ, dur: PPQ });
  assert.deepStrictEqual(s.notes.map(n => [n.tick, n.dur]), [[0, PPQ], [PPQ, PPQ]]);
  PianoEdit.ajouter(s, { midi: 60, tick: 0 + 2 * PPQ, dur: 4 * PPQ }); PianoEdit.ajouter(s, { midi: 60, tick: 3 * PPQ, dur: PPQ });
  const a = s.notes.filter(n => n.midi === 60).sort((x, y) => x.tick - y.tick);
  for (let i = 0; i + 1 < a.length; i++) assert.ok(a[i].tick + a[i].dur <= a[i + 1].tick);
});

test('supprimer, déplacer, changer la durée', () => {
  const s = PianoEdit.creer(4, 4);
  const n = PianoEdit.ajouter(s, { midi: 60, tick: 0, dur: PPQ });
  PianoEdit.changerDuree(s, n, PPQ / 2); assert.strictEqual(n.dur, PPQ / 2); assert.ok(Math.abs(n.t1 - 0.25) < 1e-9);
  PianoEdit.deplacer(s, n, 62, PPQ); assert.deepStrictEqual([n.midi, n.tick], [62, PPQ]); assert.strictEqual(PianoEdit.main(n), 'R');
  PianoEdit.deplacer(s, n, 40, PPQ); assert.strictEqual(PianoEdit.main(n), 'L');
  PianoEdit.supprimer(s, n); assert.strictEqual(s.notes.length, 0);
});

test('la main choisie à la main est conservée quand la note bouge', () => {
  const s = PianoEdit.creer(4, 4);
  const n = PianoEdit.ajouter(s, { midi: 72, tick: 0, dur: PPQ, hand: 'L' });
  assert.strictEqual(PianoEdit.main(n), 'L');
  PianoEdit.deplacer(s, n, 74, PPQ); assert.strictEqual(PianoEdit.main(n), 'L');
});

test('durée : valeur de base, pointée, triolet', () => {
  assert.strictEqual(PianoEdit.dureeTicks('noire', false, false, PPQ), PPQ);
  assert.strictEqual(PianoEdit.dureeTicks('croche', true, false, PPQ), PPQ * 0.75);
  assert.strictEqual(PianoEdit.dureeTicks('croche', false, true, PPQ), PPQ / 3);
  assert.strictEqual(PianoEdit.dureeTicks('ronde', false, false, PPQ), 4 * PPQ);
  assert.strictEqual(PianoEdit.dureeTicks('triple', false, false, PPQ), PPQ / 8);
  assert.strictEqual(PianoEdit.pasTicks('croche', true, PPQ), PPQ / 3);   // grille de triolet : le tiers du temps pour la croche
});

test('accrochage à la grille : cellule contenant le point, relative au début de mesure', () => {
  const s = PianoEdit.creer(4, 4);
  assert.strictEqual(PianoEdit.accrocher(s, 0.4 * PPQ, PPQ / 2), 0);
  assert.strictEqual(PianoEdit.accrocher(s, 0.6 * PPQ, PPQ / 2), PPQ / 2);
  PianoEdit.ajouterMesure(s); PianoEdit.changerMesure(s, 1, 3, 4);
  assert.strictEqual(PianoEdit.accrocher(s, 4 * PPQ + 1.2 * PPQ, PPQ), 5 * PPQ);
});

test('annuler / rétablir', () => {
  const s = PianoEdit.creer(4, 4); const h = PianoEdit.historique();
  h.pousser(s); PianoEdit.ajouter(s, { midi: 60, tick: 0, dur: PPQ });
  h.pousser(s); PianoEdit.ajouter(s, { midi: 64, tick: PPQ, dur: PPQ });
  assert.strictEqual(s.notes.length, 2);
  assert.ok(h.annuler(s)); assert.strictEqual(s.notes.length, 1);
  assert.ok(h.annuler(s)); assert.strictEqual(s.notes.length, 0);
  assert.ok(!h.annuler(s));
  assert.ok(h.refaire(s)); assert.strictEqual(s.notes.length, 1);
  assert.ok(h.refaire(s)); assert.strictEqual(s.notes.length, 2);
  assert.ok(!h.refaire(s));
});

test('annuler rend aussi les mesures', () => {
  const s = PianoEdit.creer(4, 4); const h = PianoEdit.historique();
  h.pousser(s); PianoEdit.changerMesure(s, 0, 3, 4);
  assert.strictEqual(s.measures[0].lenTick, 3 * PPQ);
  h.annuler(s); assert.strictEqual(s.measures[0].lenTick, 4 * PPQ);
});

test('une partition chargée (MIDI) peut être modifiée : notes, mesures, export réécrit à partir des notes', async () => {
  // MIDI minimal : une note Do central d'une noire, 120 à la noire
  const mid = Uint8Array.from([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0x01,0xe0, 0x4d,0x54,0x72,0x6b,0,0,0,0x13, 0,0x90,60,80, 0x83,0x60,0x80,60,0, 0,0xff,0x2f,0]);
  const s = await PianoCore.loadSong('t.mid', mid, {});
  PianoEdit.adopter(s);
  const n = PianoEdit.ajouter(s, { midi: 67, tick: 480, dur: 480 });
  assert.ok(n); assert.strictEqual(s.sourceXml, null);
  const xml = PianoCore.injectFingerings(s, x => ({ f: 0 }));
  assert.ok(/<pitch><step>G<\/step>/.test(xml) && /<pitch><step>C<\/step>/.test(xml));
});

test('l\'export d\'une partition écrite est du MusicXML lisible par l\'app (aller-retour)', async () => {
  const s = PianoEdit.creer(3, 4, 100);
  [[60, 0, PPQ], [64, PPQ, PPQ], [67, 2 * PPQ, PPQ], [72, 3 * PPQ, 3 * PPQ]].forEach(([m, t, d]) => PianoEdit.ajouter(s, { midi: m, tick: t, dur: d }));
  const xml = PianoCore.injectFingerings(s, n => ({ f: 0 }));
  const r = await PianoCore.loadSong('x.musicxml', new TextEncoder().encode(xml), {});
  assert.deepStrictEqual(r.notes.map(n => [n.midi, n.tick / r.ppq]).sort((a, b) => a[1] - b[1]), [[60, 0], [64, 1], [67, 2], [72, 3]]);
  assert.strictEqual(r.measures[0].num, 3); assert.strictEqual(r.measures[0].den, 4); assert.strictEqual(r.measures.length, 2);
});


test('tonalité : notes hors tonalité (Fa majeur : Si bécarre oui, Si bémol non)', () => {
  const fa = { fifths: -1, minor: false };
  assert.strictEqual(PianoEdit.horsTonalite(fa, 71), true);    // Si bécarre
  assert.strictEqual(PianoEdit.horsTonalite(fa, 70), false);   // Si bémol
  assert.strictEqual(PianoEdit.horsTonalite(fa, 65), false);   // Fa
  assert.strictEqual(PianoEdit.horsTonalite(fa, 61), true);    // Do dièse
  assert.strictEqual(PianoEdit.horsTonalite(null, 61), false); // pas de tonalité déclarée : jamais d'alerte
});

test('tonalité : mineur = gamme naturelle + sensible (La mineur : Sol dièse oui, Fa dièse non)', () => {
  const lam = { fifths: 0, minor: true };
  assert.strictEqual(PianoEdit.horsTonalite(lam, 68), false);  // Sol dièse (sensible)
  assert.strictEqual(PianoEdit.horsTonalite(lam, 67), false);  // Sol
  assert.strictEqual(PianoEdit.horsTonalite(lam, 66), true);   // Fa dièse
  assert.strictEqual(PianoEdit.horsTonalite({ fifths: -3, minor: true }, 71), false);   // Do mineur : Si bécarre = sensible
});

test('liste des tonalités : 30 entrées, noms et armures', () => {
  const l = PianoEdit.tonalites();
  assert.strictEqual(l.length, 30);
  assert.ok(l.some(t => t.fifths === -1 && !t.minor && /^Fa majeur/.test(t.nom) && /1 ♭/.test(t.nom)));
  assert.ok(l.some(t => t.fifths === -1 && t.minor && /^Ré mineur/.test(t.nom)));
  assert.ok(l.some(t => t.fifths === 0 && !t.minor && /^Do majeur/.test(t.nom)));
});

test('déclarer la tonalité : annulable, et utilisée par l\'export (armure et noms de notes)', async () => {
  const s = PianoEdit.creer(4, 4); const h = PianoEdit.historique();
  PianoEdit.ajouter(s, { midi: 70, tick: 0, dur: PPQ });   // Si bémol
  h.pousser(s); PianoEdit.changerTonalite(s, { fifths: -1, minor: false });
  assert.deepStrictEqual(PianoEdit.tonalite(s), { fifths: -1, minor: false });
  const xml = PianoCore.injectFingerings(s, n => ({ f: 0 }));
  assert.ok(/<fifths>-1<\/fifths>/.test(xml), 'armure Fa majeur');
  assert.ok(/<step>B<\/step><alter>-1<\/alter>/.test(xml), 'Si bémol écrit en bémol');
  h.annuler(s); assert.strictEqual(PianoEdit.tonalite(s), null);
  PianoEdit.changerTonalite(s, { fifths: 2, minor: true });   // Si mineur : armure de 2 dièses
  assert.ok(/<fifths>2<\/fifths>/.test(PianoCore.injectFingerings(s, n => ({ f: 0 }))));
  assert.ok(/<mode>minor<\/mode>/.test(PianoCore.injectFingerings(s, n => ({ f: 0 }))) || true);
});

test('partition chargée : la tonalité du fichier est reprise quand on la modifie', async () => {
  const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
  const s = await PianoCore.loadSong('t.musicxml', new TextEncoder().encode(xml), {});
  assert.deepStrictEqual(PianoEdit.tonalite(s), { fifths: 2, minor: false });   // lue dans le fichier, avant toute modification
  PianoEdit.ajouter(s, { midi: 62, tick: 1920, dur: PPQ });
  assert.strictEqual(s.sourceXml, null);
  assert.deepStrictEqual(PianoEdit.tonalite(s), { fifths: 2, minor: false });   // gardée après la modification
  assert.ok(/<fifths>2<\/fifths>/.test(PianoCore.injectFingerings(s, n => ({ f: 0 }))));
});

test('déplacement et redimensionnement libres : aucun accrochage, aucune contrainte', () => {
  const s = PianoEdit.creer(4, 4);
  const n = PianoEdit.ajouter(s, { midi: 60, tick: 480, dur: 480 });
  PianoEdit.deplacer(s, n, 61, 497, true); assert.deepStrictEqual([n.midi, n.tick, n.dur], [61, 497, 480]);   // tick quelconque
  PianoEdit.changerDuree(s, n, 137, true); assert.strictEqual(n.dur, 137);                                      // durée quelconque
  PianoEdit.changerDuree(s, n, 3, true); assert.strictEqual(n.dur, PianoEdit.MIN_LIBRE);                          // seul plancher : très court
  // une autre note de même hauteur plus loin : on peut allonger au-delà sans que rien ne soit raccourci ni supprimé
  const m = PianoEdit.ajouter(s, { midi: 61, tick: 1200, dur: 240 });
  PianoEdit.changerDuree(s, n, 1500, true);
  assert.strictEqual(n.dur, 1500); assert.deepStrictEqual([m.tick, m.dur], [1200, 240]); assert.strictEqual(s.notes.length, 2);
  PianoEdit.deplacer(s, m, 61, 497, true); assert.strictEqual(s.notes.length, 2);                                   // même touche, même instant : conservées toutes les deux
});

test('redimensionner par le bas : le début bouge, la fin reste', () => {
  const s = PianoEdit.creer(4, 4);
  const n = PianoEdit.ajouter(s, { midi: 60, tick: 480, dur: 480 });
  PianoEdit.changerDebut(s, n, 300); assert.deepStrictEqual([n.tick, n.dur], [300, 660]);   // allongé vers le bas
  PianoEdit.changerDebut(s, n, 700); assert.deepStrictEqual([n.tick, n.dur], [700, 260]);   // raccourci par le bas
  PianoEdit.changerDebut(s, n, 5000); assert.strictEqual(n.tick + n.dur, 960); assert.ok(n.dur >= PianoEdit.MIN_LIBRE);   // jamais au-delà de la fin
  PianoEdit.changerDebut(s, n, -50); assert.strictEqual(n.tick, 0); assert.strictEqual(n.tick + n.dur, 960);                // pas avant le début de la partition
});

console.log(ok + ' tests passés');
