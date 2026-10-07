/* Piano Roll d'apprentissage — cœur : lecture MIDI / MusicXML / MXL et chronologie.
   Fonctionne dans le navigateur (window.PianoCore) et sous Node (require). */
(function (root) {
  'use strict';
  const PPQ_XML = 480;
  const MAX_MEASURES = 5000;

  // ---------- Chronologie (tempo) ----------
  function makeTimeline(tempos, ppq) {
    const t = tempos.slice().sort((a, b) => a.tick - b.tick);
    if (!t.length || t[0].tick > 0) t.unshift({ tick: 0, uspq: 500000 });
    const segs = [];
    let sec = 0;
    for (let i = 0; i < t.length; i++) {
      if (i > 0) {
        const p = segs[segs.length - 1];
        sec = p.sec + (t[i].tick - p.tick) * p.uspq / 1e6 / ppq;
        if (t[i].tick === p.tick) { segs.pop(); }
      }
      segs.push({ tick: t[i].tick, sec, uspq: t[i].uspq });
    }
    function find(arr, key, v) {
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m][key] <= v) lo = m; else hi = m - 1; }
      return arr[lo];
    }
    return {
      tickToSec(tk) { const s = find(segs, 'tick', tk); return s.sec + (tk - s.tick) * s.uspq / 1e6 / ppq; },
      secToTick(sc) { const s = find(segs, 'sec', sc); return s.tick + (sc - s.sec) * 1e6 * ppq / s.uspq; },
      bpmAtTick(tk) { return 60e6 / find(segs, 'tick', tk).uspq; },
    };
  }

  // ---------- Mains (couleurs) ----------
  // tracks : [{notes:[...]}] ; remplit n.hand = 'R' | 'L'
  function assignHandsByPitch(notes, groups) {
    const withNotes = groups.filter(g => g.length);
    if (withNotes.length === 2) {
      const avg = g => g.reduce((s, n) => s + n.midi, 0) / g.length;
      const [hi, lo] = avg(withNotes[0]) >= avg(withNotes[1]) ? [withNotes[0], withNotes[1]] : [withNotes[1], withNotes[0]];
      hi.forEach(n => n.hand = 'R'); lo.forEach(n => n.hand = 'L');
      return 'pistes';
    }
    notes.forEach(n => n.hand = n.midi >= 60 ? 'R' : 'L');
    return 'do-central';
  }

  // ---------- Mesures MIDI ----------
  function midiMeasures(timesigs, ppq, endTick) {
    const ts = timesigs.slice().sort((a, b) => a.tick - b.tick);
    if (!ts.length || ts[0].tick > 0) ts.unshift({ tick: 0, num: 4, den: 4 });
    const out = [];
    let tick = 0, idx = 0;
    while ((tick < endTick || out.length === 0) && out.length < MAX_MEASURES) {
      while (idx + 1 < ts.length && ts[idx + 1].tick <= tick) idx++;
      const len = Math.round(ppq * 4 * ts[idx].num / ts[idx].den);
      out.push({ startTick: tick, lenTick: len, label: String(out.length + 1), num: ts[idx].num, den: ts[idx].den });
      tick += len;
    }
    return out;
  }

  // ---------- MIDI ----------
  function parseMidi(data) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    let p = 0;
    const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p++]); return s; };
    const u16 = () => (b[p++] << 8) | b[p++];
    const u32 = () => ((b[p++] * 16777216) + (b[p++] << 16) + (b[p++] << 8) + b[p++]);
    if (str(4) !== 'MThd') throw new Error('Ce fichier n\'est pas un fichier MIDI.');
    const hlen = u32(); const format = u16(); const ntrks = u16(); const division = u16();
    p = 8 + hlen;
    if (division & 0x8000) throw new Error('MIDI en temps SMPTE non pris en charge.');
    const ppq = division;
    const tempos = [], timesigs = [], notes = [];
    const groups = [];
    let title = '';
    for (let tr = 0; tr < ntrks && p + 8 <= b.length; tr++) {
      const id = str(4); const len = u32(); const end = Math.min(p + len, b.length);
      if (id !== 'MTrk') { p = end; tr--; if (p >= b.length) break; continue; }
      let tick = 0, running = 0;
      const open = new Map();
      const group = [];
      const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return v; };
      const close = (ch, nt, at) => {
        const k = ch * 128 + nt; const st = open.get(k);
        if (st && st.length) { const o = st.shift(); const n = { midi: nt, tick: o.tick, dur: Math.max(1, at - o.tick), vel: o.vel, track: tr }; group.push(n); notes.push(n); }
      };
      while (p < end) {
        tick += vlq();
        let s = b[p];
        if (s < 0x80) { s = running; } else { p++; if (s < 0xf0) running = s; }
        if (s === 0xff) {
          const type = b[p++]; const l = vlq();
          if (type === 0x51 && l === 3) tempos.push({ tick, uspq: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
          else if (type === 0x58 && l >= 2) timesigs.push({ tick, num: b[p], den: Math.pow(2, b[p + 1]) });
          else if (type === 0x03 && !title && tr === 0) { title = String.fromCharCode.apply(null, b.slice(p, p + l)); }
          p += l;
          if (type === 0x2f) break;
        } else if (s === 0xf0 || s === 0xf7) {
          p += vlq();
        } else {
          const kind = s & 0xf0, ch = s & 0x0f;
          const d1 = b[p++];
          const d2 = (kind === 0xc0 || kind === 0xd0) ? 0 : b[p++];
          if (ch === 9) continue; // percussions
          if (kind === 0x90 && d2 > 0) {
            const k = ch * 128 + d1; if (!open.has(k)) open.set(k, []);
            open.get(k).push({ tick, vel: d2 });
          } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) close(ch, d1, tick);
        }
      }
      open.forEach((st, k) => { while (st.length) close(k >> 7, k & 127, tick); });
      groups.push(group);
    }
    notes.sort((a, c) => a.tick - c.tick || a.midi - c.midi);
    const handMode = assignHandsByPitch(notes, groups);
    const endTick = notes.reduce((m, n) => Math.max(m, n.tick + n.dur), 0);
    return finish({ format: 'midi', title, ppq, tempos, notes, handMode, measures: midiMeasures(timesigs, ppq, endTick), endTick });
  }

  function computeTimes(song) {
    song.durationSec = song.timeline.tickToSec(song.endTick);
    song.notes.forEach(n => { n.t0 = song.timeline.tickToSec(n.tick); n.t1 = song.timeline.tickToSec(n.tick + n.dur); });
  }
  // Fixe le tempo de départ (noire/min) ; les changements de tempo du fichier sont mis à l'échelle dans la même proportion.
  function retime(song, startBpm) {
    if (!(startBpm > 0)) throw new Error('Tempo invalide.');
    const base = song.tempos0 || (song.tempos0 = song.tempos.map(t => ({ tick: t.tick, uspq: t.uspq })));
    const f = startBpm / song.fileBpm;
    song.tempos = base.map(t => ({ tick: t.tick, uspq: t.uspq / f }));
    song.timeline = makeTimeline(song.tempos, song.ppq);
    computeTimes(song);
    return song;
  }

  function finish(song) {
    if (!song.tempos.some(t => t.tick === 0)) song.tempos.unshift({ tick: 0, uspq: 500000 }); // 120 par défaut
    song.timeline = makeTimeline(song.tempos, song.ppq);
    song.fileBpm = song.timeline.bpmAtTick(0); // tempo de départ du fichier (noire par minute)
    song.notes.sort((a, c) => a.tick - c.tick || a.midi - c.midi);
    song.maxDur = song.notes.reduce((m, n) => Math.max(m, n.dur), 0);
    computeTimes(song);
    song.lo = song.notes.length ? Math.min.apply(null, song.notes.map(n => n.midi)) : 60;
    song.hi = song.notes.length ? Math.max.apply(null, song.notes.map(n => n.midi)) : 72;
    return song;
  }

  // ---------- XML minimal ----------
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
    });
  }
  function parseXml(src) {
    src = src.replace(/^﻿/, '');
    const rootEl = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [rootEl];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>\[]*(?:\[[\s\S]*?\])?\s*>|<\/([^\s>]+)\s*>|<([^\s\/>!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.text += m[1];
      else if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); }
      else if (m[3] !== undefined) {
        const el = { name: m[3], attrs: {}, children: [], text: '' };
        const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
        while ((a = ar.exec(m[4] || ''))) el.attrs[a[1]] = decodeEntities(a[2] !== undefined ? a[2] : a[3]);
        top.children.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
    }
    return rootEl;
  }
  const kids = (el, name) => el.children.filter(c => c.name === name);
  const kid = (el, name) => el.children.find(c => c.name === name) || null;
  const txt = (el, name) => { const k = kid(el, name); return k ? k.text.trim() : null; };

  // Les deux mains sont parfois écrites sur la MÊME portée (ex. Hanon n°1, début en clé de fa pour les deux mains) : la portée
  // ne dit alors rien. Indice fiable : dans une mesure où une seule portée porte des notes, deux lignes (voix) de rythme strictement
  // identique = deux mains en parallèle ; la ligne la plus haute est la main droite, la plus basse la main gauche.
  // (Deux voix de rythmes différents, ex. basse + accords de la main gauche, ne sont PAS séparées.) Renvoie {'portée/voix': 'R'|'L'} ou null.
  function parallelHands(ns) {
    if (!ns.length || new Set(ns.map(n => (n.staff >= 2 ? 2 : 1))).size !== 1) return null;
    const lines = {};
    ns.forEach(n => { const k = n.staff + '/' + n.voice; (lines[k] = lines[k] || []).push(n); });
    const keys = Object.keys(lines); if (keys.length !== 2) return null;
    const onsets = k => [...new Set(lines[k].map(n => n.tick))].sort((a, b) => a - b).join(',');
    if (onsets(keys[0]) !== onsets(keys[1])) return null;
    const mean = k => lines[k].reduce((s, n) => s + n.midi, 0) / lines[k].length;
    const [hi, lo] = mean(keys[0]) >= mean(keys[1]) ? keys : [keys[1], keys[0]];
    return { [hi]: 'R', [lo]: 'L' };
  }

  // ---------- MusicXML ----------
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseMusicXml(src) {
    const doc = parseXml(src);
    let score = kid(doc, 'score-partwise');
    const tw = !score && kid(doc, 'score-timewise');
    if (tw) { // « timewise » (mesure > partie) : on le range en « partwise » (partie > mesure)
      const byId = new Map(), order = [];
      kids(tw, 'measure').forEach(m => kids(m, 'part').forEach(p => {
        const id = p.attrs.id || String(order.length);
        if (!byId.has(id)) { byId.set(id, { name: 'part', attrs: { id }, children: [], text: '' }); order.push(id); }
        byId.get(id).children.push({ name: 'measure', attrs: m.attrs, children: p.children, text: '' });
      }));
      score = { name: 'score-partwise', attrs: {}, children: tw.children.filter(c => c.name !== 'measure').concat(order.map(id => byId.get(id))), text: '' };
    }
    if (!score) throw new Error('Fichier MusicXML non reconnu (ni « partwise » ni « timewise »).');
    const title = txt(kid(score, 'work') || { children: [] }, 'work-title') || txt(score, 'movement-title') || '';
    const parts = kids(score, 'part');
    if (!parts.length) throw new Error('Aucune partie trouvée dans la partition.');

    // Passe 1 : par partie, par mesure, notes relatives au début de mesure
    const P = parts.map(part => {
      let divisions = 1, staves = 1, num = 4, den = 4;
      const measures = [];
      const open = new Map(); // ligature
      kids(part, 'measure').forEach((m, mi) => {
        let cursor = 0, maxCur = 0, lastStart = 0;
        const notes = [], tempos = [];
        const toTick = d => Math.round(d * PPQ_XML / divisions);
        m.children.forEach(e => {
          if (e.name === 'attributes') {
            const d = txt(e, 'divisions'); if (d) divisions = parseFloat(d);
            const s = txt(e, 'staves'); if (s) staves = parseInt(s, 10);
            const tm = kid(e, 'time'); if (tm) { num = parseInt(txt(tm, 'beats'), 10) || num; den = parseInt(txt(tm, 'beat-type'), 10) || den; }
          } else if (e.name === 'direction') {
            const snd = kid(e, 'sound');
            if (snd && snd.attrs.tempo) tempos.push({ tickInMeasure: toTick(cursor), uspq: Math.round(60e6 / parseFloat(snd.attrs.tempo)) });
          } else if (e.name === 'sound' && e.attrs.tempo) {
            tempos.push({ tickInMeasure: toTick(cursor), uspq: Math.round(60e6 / parseFloat(e.attrs.tempo)) });
          } else if (e.name === 'backup') { cursor -= parseFloat(txt(e, 'duration')) || 0; }
          else if (e.name === 'forward') { cursor += parseFloat(txt(e, 'duration')) || 0; maxCur = Math.max(maxCur, cursor); }
          else if (e.name === 'note') {
            if (kid(e, 'grace')) return;
            const dur = parseFloat(txt(e, 'duration')) || 0;
            const isChord = !!kid(e, 'chord');
            const start = isChord ? lastStart : cursor;
            if (!isChord) { lastStart = cursor; cursor += dur; }
            maxCur = Math.max(maxCur, cursor);
            const pitch = kid(e, 'pitch');
            if (!pitch || kid(e, 'rest')) return;
            const midi = (parseInt(txt(pitch, 'octave'), 10) + 1) * 12 + STEP[txt(pitch, 'step')] + (parseFloat(txt(pitch, 'alter') || '0') | 0);
            const staff = parseInt(txt(e, 'staff') || '1', 10);
            const tieTypes = kids(e, 'tie').map(t => t.attrs.type);
            kids(kid(e, 'notations') || { children: [] }, 'tied').forEach(t => { if (!tieTypes.includes(t.attrs.type)) tieTypes.push(t.attrs.type); });
            const key = staff * 1000 + midi;
            const tickAbs = toTick(start), durT = toTick(dur);
            if (tieTypes.includes('stop') && open.has(key)) {
              const o = open.get(key); o.n.dur += durT;
              { const tg = parseInt(txt(kid(kid(e, 'notations') || { children: [] }, 'technical') || { children: [] }, 'fingering'), 10); // note liée dont le doigt change = changement de doigt sur la touche tenue
                if (tg >= 1 && tg <= 5 && o.n.finger && tg !== o.n.finger && !o.n.finger2) { o.n.finger2 = tg; o.n.swapTick = tickAbs; } }
              if (!tieTypes.includes('start')) open.delete(key);
              return;
            }
            const n = { midi, tick: tickAbs, dur: Math.max(1, durT), vel: 80, staff, voice: parseInt(txt(e, 'voice') || '1', 10) };
            const fg = parseInt(txt(kid(kid(e, 'notations') || { children: [] }, 'technical') || { children: [] }, 'fingering'), 10);
            if (fg >= 1 && fg <= 5) n.finger = fg; // doigté inscrit dans la partition
            const tech = kid(kid(e, 'notations') || { children: [] }, 'technical');
            if (tech) { // « 3-1 » : doigté de substitution (on change de doigt sur la touche tenue)
              const sub = kids(tech, 'fingering').find(x => x.attrs.substitution === 'yes'), sf = sub ? parseInt(sub.text.trim(), 10) : 0;
              if (sf >= 1 && sf <= 5 && n.finger && sf !== n.finger) { n.finger2 = sf; n.swapFrac = 0.55; }
            }
            notes.push(n);
            if (tieTypes.includes('start')) open.set(key, { n, mi });
          }
        });
        const len = toTick(maxCur) || Math.round(PPQ_XML * 4 * num / den);
        measures.push({ notes, tempos, len, label: m.attrs.number || String(mi + 1), num, den });
      });
      return { measures, staves };
    });

    // Passe 2 : mesures globales
    const nM = Math.max.apply(null, P.map(p => p.measures.length));
    const measures = [], notes = [], tempos = [], groups = [];
    const twoParts = P.length === 2 && P.every(p => p.staves === 1);
    const grp = {};
    const hasTwoStaves = P.some(p => p.staves >= 2);
    let tick = 0;
    for (let i = 0; i < nM; i++) {
      const ms = P.map(p => p.measures[i]).filter(Boolean);
      const len = Math.max.apply(null, ms.map(m => m.len));
      measures.push({ startTick: tick, lenTick: len, label: ms[0].label, num: ms[0].num, den: ms[0].den });
      P.forEach((p, pi) => {
        const m = p.measures[i]; if (!m) return;
        const parallel = hasTwoStaves ? parallelHands(m.notes) : null;
        m.notes.forEach(n => {
          n.tick += tick; n.track = pi;
          if (hasTwoStaves) n.hand = (parallel && parallel[n.staff + '/' + n.voice]) || (n.staff >= 2 ? 'L' : 'R');
          else if (twoParts) n.hand = pi === 0 ? 'R' : 'L';
          notes.push(n);
        });
      });
      const seen = new Set();
      P.forEach(p => { const m = p.measures[i]; if (m) m.tempos.forEach(t => { const tk = tick + t.tickInMeasure; if (!seen.has(tk)) { seen.add(tk); tempos.push({ tick: tk, uspq: t.uspq }); } }); });
      tick += len;
    }
    if (notes.some(n => !n.hand)) notes.forEach(n => { if (!n.hand) n.hand = n.midi >= 60 ? 'R' : 'L'; });
    const handMode = hasTwoStaves ? 'portées' : twoParts ? 'parties' : 'do-central';
    return finish({ format: 'musicxml', title, ppq: PPQ_XML, tempos, notes, handMode, measures, endTick: tick });
  }

  // ---------- ZIP (.mxl) ----------
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(data) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = b.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Archive .mxl invalide.');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const files = {};
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
      const dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      files[name] = { method, raw: b.subarray(dstart, dstart + csize) };
      p += 46 + nl + xl + cl;
    }
    const get = async name => { const f = files[name]; if (!f) return null; return f.method === 0 ? f.raw : inflateRaw(f.raw); };
    return { files, get };
  }
  async function parseMxl(data) {
    const z = await unzip(data);
    let path = null;
    const c = await z.get('META-INF/container.xml');
    if (c) { const rf = (function find(el) { if (el.name === 'rootfile') return el; for (const k of el.children) { const r = find(k); if (r) return r; } return null; })(parseXml(new TextDecoder().decode(c))); if (rf) path = rf.attrs['full-path']; }
    if (!path) path = Object.keys(z.files).find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith('META-INF'));
    if (!path) throw new Error('Aucune partition dans l\'archive .mxl.');
    return parseMusicXml(new TextDecoder().decode(await z.get(path)));
  }

  // ---------- Détection ----------
  async function loadSong(name, data) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
    let song;
    if (magic === 'MThd') song = parseMidi(b);
    else if (/\.mscz$|\.mscx$/i.test(name)) throw new Error('Les fichiers MuseScore (.mscz) ne sont pas lus directement : dans MuseScore, faites Fichier › Exporter › MusicXML (.musicxml ou .mxl), puis ouvrez ce fichier.');
    else if (b[0] === 0x50 && b[1] === 0x4b) song = await parseMxl(b);
    else if (/\.pdf$/i.test(name) || magic === '%PDF') throw new Error('Les PDF/images de partitions ne sont pas encore pris en charge : exportez d\'abord en MIDI ou MusicXML (MuseScore, etc.).');
    else song = parseMusicXml(new TextDecoder().decode(b));
    if (!song.notes.length) throw new Error('Aucune note trouvée dans ce fichier.');
    if (!song.title) song.title = name.replace(/\.[^.]+$/, '');
    return song;
  }

  // Étendue du clavier adaptée au morceau : octaves entières (Do → Si), au moins 3, bornées au piano (La0 = 21 … Do8 = 108).
  function keyboardRange(lo, hi, minOctaves = 3) {
    let c0 = Math.floor(lo / 12), c1 = Math.floor(hi / 12); // octaves (Do = 12·c)
    c0 = Math.max(c0, 1); c1 = Math.min(c1, 9);              // l'octave « 1 » démarre à La0 (21) ; l'octave « 9 » ne contient que Do8 (108)
    while (c1 - c0 + 1 < minOctaves) { // élargir en alternant haut / bas
      if (c1 < 9 && (c1 - c0) % 2 === 0) c1++; else if (c0 > 1) c0--; else if (c1 < 9) c1++; else break;
    }
    return { first: Math.max(21, c0 * 12), last: Math.min(108, c1 * 12 + 11) };
  }

  const API = { keyboardRange, retime, parseMidi, parseMusicXml, parseMxl, parseXml, loadSong, makeTimeline, unzip };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PianoCore = API;
})(typeof self !== 'undefined' ? self : this);
