const assert = require('assert');
const zlib = require('zlib');
const C = require('./core.js');
const E = require('./exemples.js');

let n = 0;
async function t(name, fn) { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.log('ÉCHEC ' + name + '\n' + e.stack); process.exitCode = 1; } }
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

(async () => {
  await t('MIDI exemple : notes, mains, mesures, durée', () => {
    const s = C.parseMidi(E.exempleMidi());
    assert.strictEqual(s.measures.length, 8);
    const R = s.notes.filter(x => x.hand === 'R'), L = s.notes.filter(x => x.hand === 'L');
    assert.strictEqual(R.length, 30); assert.strictEqual(L.length, 32);
    assert.ok(R.every(x => x.midi >= 72) && L.every(x => x.midi <= 55));
    assert.strictEqual(s.handMode, 'pistes');
    near(s.timeline.tickToSec(480 * 4), 2.4); // 100 bpm : 4 noires = 2,4 s
    near(s.durationSec, 8 * 2.4, 0.05);
    assert.strictEqual(s.measures[1].startTick, 1920);
  });

  await t('MIDI : tempo changeant, aller-retour tick↔sec', () => {
    const f = E.midiFile(480, [[E.tempoEv(0, 120), E.tempoEv(960, 60), ...E.noteEv(0, 480, 60), ...E.noteEv(1440, 480, 64)]], 0);
    const s = C.parseMidi(f);
    near(s.timeline.tickToSec(960), 1.0); near(s.timeline.tickToSec(1440), 1.0 + 1.0);
    near(s.timeline.secToTick(2.0), 1440); near(s.timeline.secToTick(0.5), 480);
    assert.strictEqual(s.handMode, 'do-central'); // 1 seule piste → coupure au do central
    assert.deepStrictEqual(s.notes.map(x => x.hand), ['R', 'R']);
  });

  await t('MIDI : running status, note-on vélocité 0, percussions ignorées, mesure 3/4', () => {
    const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
    const ev = [0, 0xff, 0x58, 4, 3, 2, 24, 8,
      0, 0x90, 60, 90, 0x81, 0x40, 60, 0, // running status : off via vél. 0 à 480
      0, 0x99, 36, 100, 10, 0x99, 36, 0,   // percussion
      0, 0x90, 62, 80]; // jamais fermée → fermée en fin de piste
    ev.push(0x83, 0x60, 0xff, 0x2f, 0); // delta 480
    const tk = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, ev.length, ...ev];
    const s = C.parseMidi(Uint8Array.from([...bytes, ...tk]));
    assert.strictEqual(s.notes.length, 2);
    assert.strictEqual(s.notes[0].dur, 192); assert.strictEqual(s.notes[1].tick, 202); assert.strictEqual(s.notes[1].dur, 480);
    assert.strictEqual(s.measures[0].lenTick, 1440); assert.strictEqual(s.measures[0].num, 3);
  });

  await t('MIDI invalide / PDF refusés avec un message clair', async () => {
    assert.throws(() => C.parseMidi(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /pas un fichier MIDI/);
    await assert.rejects(C.loadSong('x.pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46])), /PDF/);
    await assert.rejects(C.loadSong('x.mid', E.midiFile(480, [[]], 0)), /Aucune note/);
  });

  await t('MusicXML : accord, liaison, silence, backup, mains par portée, tempo', () => {
    const s = C.parseMusicXml(E.XML_TEST);
    assert.strictEqual(s.title, 'Essai & test');
    assert.strictEqual(s.measures.length, 2);
    assert.strictEqual(s.measures[1].startTick, 1920);
    const byMidi = m => s.notes.filter(x => x.midi === m);
    // do5 lié sur 2 mesures : 4 + 2 divisions (div=2 → 480 ticks/noire = 240/div)
    const c5 = byMidi(72); assert.strictEqual(c5.length, 1); assert.strictEqual(c5[0].dur, 4 * 240 + 2 * 240);
    assert.strictEqual(byMidi(75).length, 1); assert.strictEqual(byMidi(75)[0].tick, 0); // mib5 en accord
    assert.strictEqual(byMidi(74).length, 0); // note d'agrément ignorée
    assert.strictEqual(byMidi(66)[0].tick, 1920 + 2 * 240); // fa#4 après do5 (durée 2)
    assert.strictEqual(byMidi(48)[0].hand, 'L'); assert.strictEqual(byMidi(72)[0].hand, 'R');
    assert.strictEqual(byMidi(43)[0].tick, 1920);
    assert.strictEqual(s.handMode, 'portées');
    near(s.timeline.tickToSec(1920), 2.0); // 120 bpm sur la mesure 1
    near(s.timeline.tickToSec(1920 + 480), 2.0 + 1.0); // puis 60 bpm
  });

  await t('MXL (zip) : conteneur lu et décompressé', async () => {
    const files = { 'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>', 'score.xml': E.XML_TEST };
    const locals = [], cds = []; let off = 0;
    Object.entries(files).forEach(([name, content]) => {
      const raw = Buffer.from(content), comp = zlib.deflateRawSync(raw), nm = Buffer.from(name);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
      const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(off, 42);
      locals.push(lh, nm, comp); cds.push(cd, nm); off += 30 + nm.length + comp.length;
    });
    const cdBuf = Buffer.concat(cds), eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(2, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
    const zip = Buffer.concat([...locals, cdBuf, eocd]);
    const s = await C.loadSong('essai.mxl', new Uint8Array(zip));
    assert.strictEqual(s.format, 'musicxml'); assert.strictEqual(s.notes.length, 5);
  });

  await t('Exemple « Lettre à Élise » : levée, 3/8, mains, tempo', () => {
    const s = C.parseMusicXml(E.exempleElise());
    assert.strictEqual(s.title, 'Lettre à Élise (début)');
    assert.strictEqual(s.measures.length, 9);
    assert.strictEqual(s.measures[0].label, '0'); assert.strictEqual(s.measures[0].lenTick, 240); // levée de 2 doubles-croches
    assert.strictEqual(s.measures[1].lenTick, 720); assert.strictEqual(s.measures[1].num, 3); assert.strictEqual(s.measures[1].den, 8);
    assert.deepStrictEqual(s.notes.slice(0, 3).map(x => x.midi), [76, 75, 76]);
    assert.strictEqual(s.notes.filter(x => x.hand === 'R').length, 2 + 6 + 4 + 4 + 3 + 6 + 4 + 4 + 1);
    assert.strictEqual(s.notes.filter(x => x.hand === 'L').length, 3 + 3 + 3 + 3 + 3 + 1);
    assert.ok(s.notes.every(x => x.midi >= 36 && x.midi <= 88));
    assert.strictEqual(s.handMode, 'portées');
    near(s.timeline.tickToSec(720), 60 / 60 * 1.5); // une mesure 3/8 = 1,5 noire
    near(s.durationSec, 60 / 60 * (0.5 + 8 * 1.5), 0.01);
    assert.ok(s.notes.filter(x => x.hand === 'L').every(x => x.midi < 60) && s.notes.filter(x => x.tick === 240 + 0).some(x => x.midi === 76));
  });

  await t('Tempo de départ : valeur du fichier, modification proportionnelle', () => {
    assert.strictEqual(Math.round(C.parseMusicXml(E.exempleElise()).fileBpm), 60);
    const noTempo = C.parseMidi(E.midiFile(480, [[...E.noteEv(0, 480, 60)]], 0));
    near(noTempo.fileBpm, 120); // défaut MIDI
    const f = E.midiFile(480, [[E.tempoEv(0, 120), E.tempoEv(960, 60), ...E.noteEv(0, 480, 60), ...E.noteEv(1440, 480, 64)]], 0);
    const s = C.parseMidi(f);
    near(s.fileBpm, 120); near(s.notes[1].t0, 2.0); near(s.durationSec, 3.0);
    C.retime(s, 60); // moitié moins vite, changement de tempo conservé en proportion
    near(s.timeline.bpmAtTick(0), 60); near(s.timeline.bpmAtTick(1000), 30);
    near(s.notes[1].t0, 4.0); near(s.durationSec, 6.0); near(s.notes[0].t1, 1.0);
    C.retime(s, 240); near(s.timeline.bpmAtTick(0), 240); near(s.notes[1].t0, 1.0); // repart toujours de l'original
    C.retime(s, 120); near(s.notes[1].t0, 2.0); near(s.durationSec, 3.0);
    assert.throws(() => C.retime(s, 0), /invalide/);
  });

  console.log(`\n${n} tests passés`);
})();
