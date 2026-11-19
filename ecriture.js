/* Écriture d'une partition directement dans le rouleau : modèle (notes, mesures, durées, historique).
   Aucun dessin ici : tout est testable sous Node (test_ecriture.js). Fonctionne dans le navigateur (window.PianoEdit) et sous Node (require). */
(function (root) {
  'use strict';
  const Core = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./core.js') : root.PianoCore;
  const PPQ = 480, MIN_DUR = PPQ / 16, MIN_LIBRE = 10;   // la plus petite note : la quadruple croche
  const BASE = { ronde: 4, blanche: 2, noire: 1, croche: 0.5, double: 0.25, triple: 0.125 };
  const handOf = midi => (midi >= 60 ? 'R' : 'L');   // main par défaut : coupure au Do central (modifiable note par note)
  const main = n => n.fh || n.hand;

  const mesureLen = (num, den, ppq) => Math.round(ppq * 4 * num / den);
  function nouvelleMesure(song) {
    const l = song.measures[song.measures.length - 1];
    song.measures.push({ startTick: l.startTick + l.lenTick, lenTick: mesureLen(l.num, l.den, song.ppq), label: String(song.measures.length + 1), num: l.num, den: l.den });
  }
  const finMesures = song => { const l = song.measures[song.measures.length - 1]; return l.startTick + l.lenTick; };
  function couvrir(song, tick) { let g = 0; while (finMesures(song) < tick && g++ < 5000) nouvelleMesure(song); }

  // Recalcule tout ce que l'application lit : ordre des notes, nombre de mesures, fin, temps en secondes, étendue
  function rebuild(song) {
    song.notes.forEach(n => { if (n.durO !== undefined) { n.dur = n.durO; n.t1 = n.t1o; } n.durO = n.t1o = undefined; });   // durées « d'origine » du calcul des doigts : à refaire
    song.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    couvrir(song, song.notes.reduce((m, n) => Math.max(m, n.tick + n.dur), 0));
    song.endTick = finMesures(song);
    song.timeline = Core.makeTimeline(song.tempos, song.ppq);
    song.durationSec = song.timeline.tickToSec(song.endTick);
    song.notes.forEach(n => { n.t0 = song.timeline.tickToSec(n.tick); n.t1 = song.timeline.tickToSec(n.tick + n.dur); });
    song.maxDur = song.notes.reduce((m, n) => Math.max(m, n.dur), 0);
    song.lo = song.notes.length ? Math.min.apply(null, song.notes.map(n => n.midi)) : 60;
    song.hi = song.notes.length ? Math.max.apply(null, song.notes.map(n => n.midi)) : 72;
    song.evt = null;
    return song;
  }
  const KEY_RE = /<fifths>\s*(-?\d+)\s*<\/fifths>(?:\s*<mode>\s*(\w+)\s*<\/mode>)?/;
  function touche(song) {
    if (song.sourceXml && !song.key) { const km = KEY_RE.exec(song.sourceXml); if (km) song.key = { fifths: parseInt(km[1], 10), minor: km[2] === 'minor' }; }   // la tonalité du fichier d'origine est gardée
    song.edited = true; song.sourceXml = null;   // la partition d'origine ne représente plus les notes : l'export se refait à partir d'elles
  }

  // ---------- Tonalité (armure) ----------
  const MAJ_NOMS = { '-7': 'Do♭', '-6': 'Sol♭', '-5': 'Ré♭', '-4': 'La♭', '-3': 'Mi♭', '-2': 'Si♭', '-1': 'Fa', '0': 'Do', '1': 'Sol', '2': 'Ré', '3': 'La', '4': 'Mi', '5': 'Si', '6': 'Fa♯', '7': 'Do♯' };
  const MIN_NOMS = { '-7': 'La♭', '-6': 'Mi♭', '-5': 'Si♭', '-4': 'Fa', '-3': 'Do', '-2': 'Sol', '-1': 'Ré', '0': 'La', '1': 'Mi', '2': 'Si', '3': 'Fa♯', '4': 'Do♯', '5': 'Sol♯', '6': 'Ré♯', '7': 'La♯' };
  const armureTxt = f => f === 0 ? 'sans altération' : Math.abs(f) + ' ' + (f > 0 ? '♯' : '♭');
  function tonalites() {   // les 30 tonalités, de 7 bémols à 7 dièses
    const out = [];
    for (let f = -7; f <= 7; f++) { out.push({ fifths: f, minor: false, nom: MAJ_NOMS[f] + ' majeur (' + armureTxt(f) + ')' }); out.push({ fifths: f, minor: true, nom: MIN_NOMS[f] + ' mineur (' + armureTxt(f) + ')' }); }
    return out;
  }
  function tonalite(song) {   // tonalité déclarée, sinon celle du fichier d'origine, sinon aucune
    if (song.key) return song.key;
    const km = song.sourceXml && KEY_RE.exec(song.sourceXml);
    return km ? { fifths: parseInt(km[1], 10), minor: km[2] === 'minor' } : null;
  }
  function changerTonalite(song, key) { touche(song); song.key = key ? { fifths: key.fifths, minor: !!key.minor } : null; if (!key) song.keyNone = true; return song; }
  function horsTonalite(key, midi) {   // majeur : gamme majeure ; mineur : gamme naturelle + sensible (mineur harmonique)
    if (!key) return false;
    const maj = ((key.fifths * 7) % 12 + 12) % 12, tonic = key.minor ? (maj + 9) % 12 : maj;
    const deg = key.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11], pc = ((midi - tonic) % 12 + 12) % 12;
    return !deg.includes(pc);
  }

  function creer(num, den, bpm) {
    const song = { format: 'ecrit', title: 'Partition vierge', ppq: PPQ, tempos: [{ tick: 0, uspq: Math.round(60e6 / (bpm || 120)) }], notes: [], handMode: 'écrit', sourceXml: null,
      measures: [{ startTick: 0, lenTick: mesureLen(num || 4, den || 4, PPQ), label: '1', num: num || 4, den: den || 4 }] };
    rebuild(song); song.fileBpm = song.timeline.bpmAtTick(0);
    return song;
  }
  function adopter(song) { touche(song); return rebuild(song); }

  // Une même touche ne sonne pas deux fois à la fois : la note qui commence avant raccourcit, la nouvelle s'arrête à la suivante
  function ajuster(song, n) {
    song.notes.slice().forEach(o => {
      if (o === n || o.midi !== n.midi) return;
      if (o.tick === n.tick) { song.notes.splice(song.notes.indexOf(o), 1); return; }
      if (o.tick < n.tick && o.tick + o.dur > n.tick) o.dur = n.tick - o.tick;
    });
    const next = song.notes.filter(o => o !== n && o.midi === n.midi && o.tick > n.tick).sort((a, b) => a.tick - b.tick)[0];
    if (next && n.tick + n.dur > next.tick) n.dur = Math.max(1, next.tick - n.tick);
  }
  function ajouter(song, s) {
    touche(song);
    const n = { midi: s.midi, tick: Math.max(0, Math.round(s.tick)), dur: Math.max(MIN_DUR, Math.round(s.dur)), vel: s.vel || 84, track: 0, hand: handOf(s.midi) };
    if (s.hand && s.hand !== n.hand) n.fh = s.hand;
    song.notes.push(n); ajuster(song, n); rebuild(song); return n;
  }
  function supprimer(song, n) { touche(song); const i = song.notes.indexOf(n); if (i >= 0) song.notes.splice(i, 1); rebuild(song); }
  // libre = true : aucun accrochage ni contrainte (durée quelconque, au plus 10 ticks de plancher ; une note peut en recouvrir une autre de même hauteur)
  function changerDuree(song, n, dur, libre) { touche(song); rebuild(song); n.dur = Math.max(libre ? MIN_LIBRE : MIN_DUR, Math.round(dur)); if (!libre) ajuster(song, n); rebuild(song); return n; }
  function changerDebut(song, n, tick) {   // redimensionner par le bas : le début bouge, la fin reste
    touche(song); rebuild(song); const fin = n.tick + n.dur; n.tick = Math.max(0, Math.min(Math.round(tick), fin - MIN_LIBRE)); n.dur = fin - n.tick; rebuild(song); return n;
  }
  function deplacer(song, n, midi, tick, libre) { touche(song); rebuild(song); n.midi = midi; n.tick = Math.max(0, Math.round(tick)); n.hand = handOf(midi); if (!libre) ajuster(song, n); rebuild(song); return n; }

  function mesureIndex(song, tick) {
    const a = song.measures; let lo = 0, hi = a.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m].startTick <= tick) lo = m; else hi = m - 1; }
    return lo;
  }
  function ajouterMesure(song) { touche(song); nouvelleMesure(song); return rebuild(song); }
  // la mesure i et toutes les suivantes prennent la nouvelle signature ; les notes ne bougent pas
  function changerMesure(song, i, num, den) {
    touche(song);
    for (let j = i; j < song.measures.length; j++) {
      const m = song.measures[j], p = song.measures[j - 1];
      m.num = num; m.den = den; m.lenTick = mesureLen(num, den, song.ppq); m.startTick = p ? p.startTick + p.lenTick : 0;
    }
    return rebuild(song);
  }
  function retirerMesuresVides(song) {
    const occupee = m => song.notes.some(n => n.tick < m.startTick + m.lenTick && n.tick + n.dur > m.startTick);
    while (song.measures.length > 1 && !occupee(song.measures[song.measures.length - 1])) song.measures.pop();
    return rebuild(song);
  }

  const dureeTicks = (nom, pointee, triolet, ppq) => BASE[nom] * ppq * (pointee ? 1.5 : 1) * (triolet ? 2 / 3 : 1);
  const pasTicks = (nom, triolet, ppq) => BASE[nom] * ppq * (triolet ? 2 / 3 : 1);
  function accrocher(song, tick, pas) {
    const m = song.measures[mesureIndex(song, tick)];
    return m.startTick + Math.floor((tick - m.startTick) / pas + 1e-9) * pas;
  }

  // Annuler / rétablir : instantanés de ce qui s'écrit (notes, mesures, tempos)
  function historique() {
    const undo = [], redo = [];
    const snap = s => ({ notes: s.notes.map(n => Object.assign({}, n)), measures: s.measures.map(m => Object.assign({}, m)), tempos: s.tempos.map(t => Object.assign({}, t)), key: s.key ? Object.assign({}, s.key) : null });
    const rend = (s, x) => { s.notes = x.notes.map(n => Object.assign({}, n)); s.measures = x.measures.map(m => Object.assign({}, m)); s.tempos = x.tempos.map(t => Object.assign({}, t)); s.key = x.key ? Object.assign({}, x.key) : null; touche(s); rebuild(s); };
    return {
      pousser(s) { undo.push(snap(s)); while (undo.length > Math.max(20, Math.min(200, Math.floor(400000 / Math.max(1, s.notes.length))))) undo.shift(); redo.length = 0; },   // grosse partition : moins d'instantanés gardés (mémoire)
      annuler(s) { if (!undo.length) return false; redo.push(snap(s)); rend(s, undo.pop()); return true; },
      refaire(s) { if (!redo.length) return false; undo.push(snap(s)); rend(s, redo.pop()); return true; },
      vider() { undo.length = 0; redo.length = 0; },
      get peutAnnuler() { return undo.length > 0; }, get peutRefaire() { return redo.length > 0; },
    };
  }

  const API = { changerDebut, MIN_LIBRE, tonalites, tonalite, changerTonalite, horsTonalite, creer, adopter, ajouter, supprimer, changerDuree, deplacer, ajouterMesure, changerMesure, retirerMesuresVides, mesureIndex, dureeTicks, pasTicks, accrocher, historique, rebuild, main, handOf, MIN_DUR, BASE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PianoEdit = API;
})(typeof self !== 'undefined' ? self : this);
