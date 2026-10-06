/* Générateur de fichiers d'exemple (MIDI + MusicXML) et utilitaires de test.
   Usage : node exemples.js  → écrit exemple.mid et exemple.musicxml */
const fs = require('fs');
const path = require('path');

function vlq(v) { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; }
// piste = liste d'événements triés { tick, bytes:[...] }
function trackBytes(events) {
  events.sort((a, b) => a.tick - b.tick);
  const out = []; let last = 0;
  events.forEach(e => { out.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; });
  out.push(0, 0xff, 0x2f, 0);
  const h = [0x4d, 0x54, 0x72, 0x6b, ...[24, 16, 8, 0].map(s => (out.length >>> s) & 255)];
  return h.concat(out);
}
function midiFile(ppq, tracks, format = 1) {
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, ppq >> 8, ppq & 255];
  return Uint8Array.from(head.concat(...tracks.map(trackBytes)));
}
const noteEv = (tick, dur, note, vel = 80, ch = 0) => [
  { tick, bytes: [0x90 | ch, note, vel] }, { tick: tick + dur, bytes: [0x80 | ch, note, 0] }];
const tempoEv = (tick, bpm) => { const u = Math.round(60e6 / bpm); return { tick, bytes: [0xff, 0x51, 3, (u >> 16) & 255, (u >> 8) & 255, u & 255] }; };
const timesigEv = (tick, num, den) => ({ tick, bytes: [0xff, 0x58, 4, num, Math.log2(den), 24, 8] });

// « Ode à la joie » simplifiée, 8 mesures à 4/4, 100 bpm
function exempleMidi() {
  const q = 480;
  const rhNotes = [ // [mesure, temps, durée en noires, note]
    ...[[0, 76], [1, 76], [2, 77], [3, 79]].map(([b, n]) => [0, b, 1, n]),
    ...[[0, 79], [1, 77], [2, 76], [3, 74]].map(([b, n]) => [1, b, 1, n]),
    ...[[0, 72], [1, 72], [2, 74], [3, 76]].map(([b, n]) => [2, b, 1, n]),
    [3, 0, 1.5, 76], [3, 1.5, 0.5, 74], [3, 2, 2, 74],
    ...[[0, 76], [1, 76], [2, 77], [3, 79]].map(([b, n]) => [4, b, 1, n]),
    ...[[0, 79], [1, 77], [2, 76], [3, 74]].map(([b, n]) => [5, b, 1, n]),
    ...[[0, 72], [1, 72], [2, 74], [3, 76]].map(([b, n]) => [6, b, 1, n]),
    [7, 0, 1.5, 74], [7, 1.5, 0.5, 72], [7, 2, 2, 72],
  ];
  const lhChords = [[48, 55], [43, 50], [48, 55], [43, 50], [48, 55], [43, 50], [48, 55], [43, 48]];
  const rh = [tempoEv(0, 100), timesigEv(0, 4, 4)];
  rhNotes.forEach(([m, b, d, n]) => rh.push(...noteEv(Math.round((m * 4 + b) * q), Math.round(d * q * 0.95), n)));
  const lh = [];
  lhChords.forEach((ch, m) => [0, 2].forEach(b => ch.forEach(n => lh.push(...noteEv((m * 4 + b) * q, 2 * q - 20, n, 70, 1)))));
  return midiFile(q, [rh, lh]);
}

// MusicXML de test : 2 portées, accord, liaison, silence, backup, changement de tempo
const XML_TEST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1"><work><work-title>Essai &amp; test</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
<direction><sound tempo="120"/></direction>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff><tie type="start"/></note>
<note><pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><chord/><duration>4</duration><staff>1</staff></note>
<note><rest/><duration>4</duration><staff>1</staff></note>
<backup><duration>8</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><staff>2</staff></note>
</measure>
<measure number="2"><direction><sound tempo="60"/></direction>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff><tie type="stop"/></note>
<note><grace/><pitch><step>D</step><octave>5</octave></pitch><staff>1</staff></note>
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>6</duration><staff>1</staff></note>
<backup><duration>8</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>8</duration><staff>2</staff></note>
</measure></part></score-partwise>`;

module.exports = { midiFile, noteEv, tempoEv, timesigEv, exempleMidi, XML_TEST };

if (require.main === module) {
  const dir = process.argv[2] || __dirname;
  fs.writeFileSync(path.join(dir, 'exemple.mid'), exempleMidi());
  fs.writeFileSync(path.join(dir, 'exemple.musicxml'), XML_TEST);
  console.log('exemples écrits dans', dir);
}
