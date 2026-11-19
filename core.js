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
    if (withNotes.length >= 3) {   // plusieurs pistes : on les regroupe en deux mains d'après leur hauteur moyenne (si la séparation est nette), au lieu de couper toutes les notes au do central
      const mean = g => g.reduce((t, n) => t + n.midi, 0) / g.length, L = withNotes.map(g => ({ g, m: mean(g) })).sort((x, y) => y.m - x.m);
      let best = null;
      for (let k = 1; k < L.length; k++) {
        const top = L.slice(0, k), bot = L.slice(k), mt = top.reduce((t, o) => t + o.m, 0) / top.length, mb = bot.reduce((t, o) => t + o.m, 0) / bot.length;
        const sse = top.reduce((t, o) => t + (o.m - mt) ** 2, 0) + bot.reduce((t, o) => t + (o.m - mb) ** 2, 0), spread = a => Math.max.apply(null, a.map(o => o.m)) - Math.min.apply(null, a.map(o => o.m));
        if (mt - mb >= 7 && spread(top) <= 8 && spread(bot) <= 8 && (!best || sse < best.sse)) best = { k, sse };
      }
      if (best) { L.forEach((o, i) => o.g.forEach(n => { n.hand = i < best.k ? 'R' : 'L'; })); return 'pistes'; }
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
    // Fichier dont les notes ne tombent pas sur la grille des temps déclarée (tempo et résolution incohérents, fichier produit par un programme) : on mesure l'intervalle le plus fréquent entre deux attaques, on le ramène à une croche (ou une double-croche, une noire) et on met le tout à l'échelle ; le tempo est corrigé du même facteur, la durée réelle ne change pas.
    { const on = [...new Set(notes.map(n => n.tick))].sort((x, y) => x - y), gridFit = g => on.filter(t => Math.abs(t - Math.round(t / g) * g) <= 0.12 * g).length / (on.length || 1);
      if (on.length >= 16 && gridFit(ppq / 12) < 0.9 && gridFit(ppq / 4) < 0.9) {
        const bins = new Map(); for (let i = 1; i < on.length && i < 4000; i++) { const d = on[i] - on[i - 1]; if (d < ppq / 16 || d > 2 * ppq) continue; const k = Math.round(Math.log(d) / Math.log(1.02)); (bins.get(k) || bins.set(k, []).get(k)).push(d); }
        let best = null; bins.forEach(a => { if (!best || a.length > best.length) best = a; });
        if (best && best.length >= 8) {
          let u = best.reduce((x, y) => x + y, 0) / best.length;
          for (let it = 0; it < 3; it++) { let sn = 0, sd = 0; on.forEach(t => { const nn = Math.round(t / u); if (nn > 0) { sn += t * nn; sd += nn * nn; } }); if (sd) u = sn / sd; }   // l'unité est affinée par régression : une petite erreur sur elle s'accumule sur un morceau long
          const r = u / ppq;
          // l'unité mesurée est-elle une double-croche, une croche ou une noire ? On prend l'hypothèse qui donne le tempo le plus plausible (le plus proche de 90 à la noire) : la valeur « la plus proche de la grille » ne dit rien du tempo réel
          const t0 = tempos.length ? tempos.slice().sort((x, y) => x.tick - y.tick)[0].uspq : 500000, uSec = u * t0 / ppq / 1e6;
          const target = [0.25, 0.5, 1].reduce((t, c) => Math.abs(Math.log(60 * c / uSec / 90)) < Math.abs(Math.log(60 * t / uSec / 90)) ? c : t), k = target * ppq / u;
          const fitU = on.filter(t => Math.abs(t - Math.round(t / u) * u) <= 0.06 * u).length / on.length;
          if (k > 0.5 && k < 2 && Math.abs(k - 1) > 0.04 && fitU >= 0.85) {
            notes.forEach(n => { n.tick = Math.round(n.tick * k); n.dur = Math.max(1, Math.round(n.dur * k)); });
            tempos.forEach(t => { t.tick = Math.round(t.tick * k); t.uspq = Math.round(t.uspq / k); });
            timesigs.forEach(t => { t.tick = Math.round(t.tick * k); });
          }
        }
      } }
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

  // ---------- Mains : une note hors d'atteinte passe à l'autre main ----------
  // Une main ne tient pas plus d'une neuvième majeure (14 demi-tons) entre sa note la plus grave et sa plus aiguë qui sonnent ensemble. Si la partition l'exige, la note la plus proche de l'autre main (la plus grave de la droite, la plus aiguë de la gauche) lui est confiée, à condition que cette main puisse l'atteindre sans dépasser l'octave (12) avec ce qu'elle joue déjà ; une main indiquée dans le fichier (« MD », « MG ») n'est jamais changée. Le doigt écrit reste (un pouce reste un pouce).
  const SPAN_MAX = 14, SPAN_ACCUEIL = 12;
  function rebalanceHands(notes) {
    const maxDur = notes.reduce((m, n) => Math.max(m, n.dur), 0);   // notes triées par attaque : on ne regarde que celles qui ont pu commencer dans les maxDur derniers ticks
    const sounding = (h, t) => { let lo = 0, hi = notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].tick < t - maxDur) lo = m + 1; else hi = m; } const r = []; for (let i = lo; i < notes.length && notes[i].tick <= t; i++) { const n = notes[i]; if (n.hand === h && t < n.tick + n.dur) r.push(n); } return r; };
    const span = ns => ns.length ? Math.max.apply(null, ns.map(n => n.midi)) - Math.min.apply(null, ns.map(n => n.midi)) : 0;
    const attacks = Array.from(new Set(notes.map(n => n.tick))).sort((a, b) => a - b);
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const t of attacks) for (const h of ['R', 'L']) {
        const S = sounding(h, t); if (span(S) <= SPAN_MAX) continue;
        const o = h === 'R' ? 'L' : 'R', cand = S.filter(n => !n.fileHand).sort((a, b) => h === 'R' ? a.midi - b.midi : b.midi - a.midi)[0];
        if (!cand) continue;
        const ev = attacks.filter(a => a >= cand.tick && a < cand.tick + cand.dur);
        if (!ev.every(a => span(sounding(o, a).concat([cand])) <= SPAN_ACCUEIL)) continue;
        cand.hand = cand.autoHand = o; moved = true;
      }
      if (!moved) break;
    }
  }

  function finish(song) {
    if (!song.tempos.some(t => t.tick === 0)) song.tempos.unshift({ tick: 0, uspq: 500000 }); // 120 par défaut
    song.timeline = makeTimeline(song.tempos, song.ppq);
    song.fileBpm = song.timeline.bpmAtTick(0); // tempo de départ du fichier (noire par minute)
    song.notes.sort((a, c) => a.tick - c.tick || a.midi - c.midi);
    rebalanceHands(song.notes);
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
  const SERIES_MARK = 'seb-roulpiano:mains-par-serie';   // repère écrit par l'export : dans un fichier qui le porte, une main écrite (MD / MG) vaut pour les notes suivantes de la même portée, quelle que soit la voix ou la mesure, tant que les hampes gardent le sens
  function parseMusicXml(src) {
    const seriesMode = src.includes(SERIES_MARK);
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
    const repInfo = {};   // reprises et voltas, par mesure (lues sur la première partie)
    let noteOrd = 0;   // rang de chaque élément <note> dans le fichier (pour y réinscrire les doigtés à l'export)
    const P = parts.map((part, pIdx) => {
      let divisions = 1, staves = 1, num = 4, den = 4;
      const serie = new Map();   // main écrite (« MD3 », « MG2 ») : elle vaut pour la note et pour celles qui la suivent dans la MÊME portée, voix et mesure (fichier d'une autre origine) ou dans la même portée seulement (fichier écrit par l'export), tant que le sens des hampes ne change pas ; on revient alors à la main de la portée
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
          } else if (e.name === 'barline') {
            if (pIdx === 0) { const rp = kid(e, 'repeat'), en = kid(e, 'ending'), R = repInfo[mi] || (repInfo[mi] = {});
              if (rp) { if (rp.attrs.direction === 'forward') R.start = true; else if (rp.attrs.direction === 'backward') R.end = parseInt(rp.attrs.times, 10) || 2; }
              if (en) { if (en.attrs.type === 'start') R.endStart = String(en.attrs.number || '1').split(/[\s,+]+/).map(x => parseInt(x, 10)).filter(x => x > 0); else R.endStop = true; } }
          } else if (e.name === 'backup') { cursor -= parseFloat(txt(e, 'duration')) || 0; }
          else if (e.name === 'forward') { cursor += parseFloat(txt(e, 'duration')) || 0; maxCur = Math.max(maxCur, cursor); }
          else if (e.name === 'note') {
            const ord = noteOrd++;
            if (kid(e, 'grace')) return;
            const dur = parseFloat(txt(e, 'duration')) || 0;
            const isChord = !!kid(e, 'chord');
            const start = isChord ? lastStart : cursor;
            if (!isChord) { lastStart = cursor; cursor += dur; }
            maxCur = Math.max(maxCur, cursor);
            if (e.attrs.dynamics === '0') return;   // note muette (dessin seul, comme les « play = 0 » de MuseScore) : elle prend sa place dans le temps mais ne sonne pas
            const pitch = kid(e, 'pitch');
            if (seriesMode && kid(e, 'rest')) serie.delete(pIdx + '|' + (txt(e, 'staff') || '1'));   // fichier exporté par l'application : un silence interrompt la série (la main indiquée doit être redite à la reprise)
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
            const n = { midi, tick: tickAbs, dur: Math.max(1, durT), vel: 80, staff, voice: parseInt(txt(e, 'voice') || '1', 10), srcIdx: ord };
            const fgT = txt(kid(kid(e, 'notations') || { children: [] }, 'technical') || { children: [] }, 'fingering'), fgM = /^\s*(?:M\.?\s*)?([DG])\.?\s*([1-5])\s*$/i.exec(fgT || '');   // « 3 » ou « MD3 » / « MG2 » : doigt, avec la main (D = droite, G = gauche) quand elle ne se déduit pas de la portée
            const fg = fgM ? parseInt(fgM[2], 10) : parseInt(fgT, 10);
            if (fg >= 1 && fg <= 5) n.finger = fg; // doigté inscrit dans la partition
            n.stem = txt(e, 'stem') || ''; n.srcM = mi;
            { const hk = pIdx + '|' + staff + (seriesMode ? '' : '|' + n.voice), c = serie.get(hk);
              if (fgM) { n.fileHand = fgM[1].toUpperCase() === 'G' ? 'L' : 'R'; serie.set(hk, { hand: n.fileHand, stem: n.stem, mi }); }
              else if (c && c.stem === n.stem && (seriesMode || c.mi === mi)) n.fileHand = c.hand; else serie.delete(hk); }
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
          n.autoHand = n.hand;   // main déduite de la partition seule (portée, parties)
          if (n.fileHand) n.hand = n.fileHand;   // main indiquée dans le doigté (« MD3 », « MG2 ») : prioritaire sur la portée
          notes.push(n);
        });
      });
      const seen = new Set();
      P.forEach(p => { const m = p.measures[i]; if (m) m.tempos.forEach(t => { const tk = tick + t.tickInMeasure; if (!seen.has(tk)) { seen.add(tk); tempos.push({ tick: tk, uspq: t.uspq }); } }); });
      tick += len;
    }
    // Anacrouse : si la première mesure est incomplète, elle porte le numéro 0 et le comptage commence à la première mesure complète (certains fichiers numérotent l'anacrouse « 1 »)
    if (measures.length > 1 && measures[0].lenTick < PPQ_XML * 4 * measures[0].num / measures[0].den * 0.999 && measures[0].label !== '0') {
      const off = parseInt(measures[1].label, 10) - 1;
      if (isFinite(off)) { measures[0].label = '0'; for (let i = 1; i < measures.length; i++) { const v = parseInt(measures[i].label, 10); if (isFinite(v) && String(v) === measures[i].label) measures[i].label = String(v - off); } }
    }
    if (notes.some(n => !n.hand)) notes.forEach(n => { if (!n.hand) n.hand = n.midi >= 60 ? 'R' : 'L'; });
    notes.forEach(n => { if (!n.autoHand) n.autoHand = n.midi >= 60 ? 'R' : 'L'; });
    const handMode = hasTwoStaves ? 'portées' : twoParts ? 'parties' : 'do-central';
    return finish({ format: 'musicxml', title, ppq: PPQ_XML, tempos, notes, handMode, measures, endTick: tick, sourceXml: tw ? null : src, repeats: repInfo });
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

  // ---------- MuseScore (.mscz / .mscx) : converti en MusicXML, puis lu comme tel ----------
  // Un .mscz est une archive zip qui contient la partition au format interne de MuseScore (.mscx, un XML). On la réécrit en MusicXML (parties, portées, voix, durées, triolets, liaisons, doigtés, tonalité, mesure, tempo) pour que tout le reste de l'application (mains, doigtés, export) la traite comme un fichier MusicXML.
  function msczToMusicXml(src) {
    const root = parseXml(src), find = (el, n) => { if (el.name === n) return el; for (const k of el.children) { const r = find(k, n); if (r) return r; } return null; };
    const score = find(root, 'Score'); if (!score) throw new Error('Ce fichier MuseScore n\'a pas de partition lisible (version trop ancienne ?).');
    const kid = (el, n) => el.children.filter(c => c.name === n), one = (el, n) => el.children.find(c => c.name === n), txt = (el, n, d) => { const c = one(el, n); return c ? c.text.trim() : d; };
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'), div = parseInt(txt(score, 'Division', '480'), 10) || 480;
    const parts = kid(score, 'Part'), staves = kid(score, 'Staff'); if (!staves.length) throw new Error('Aucune portée dans ce fichier MuseScore.');
    const nPer = parts.length ? parts.map(p => Math.max(1, kid(p, 'Staff').length)) : [staves.length];
    const meta = n => { const m = kid(score, 'metaTag').find(t => t.attrs.name === n); return m ? m.text.trim() : ''; };
    let title = meta('workTitle') || meta('movementTitle'); if (!title) { const vb = find(score, 'VBox'); if (vb) { const t = kid(vb, 'Text').find(x => /title/i.test(txt(x, 'style', ''))); if (t) title = txt(t, 'text', '').replace(/<[^>]*>/g, ''); } }
    const BASE = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125, '256th': 0.015625 };
    const TYPE = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', '16th': '16th', '32nd': '32nd', '64th': '64th', '128th': '128th', '256th': '256th' };
    const deep = el => (el.text || '') + el.children.map(deep).join('');
    const plain = el => deep(el).replace(/&lt;[^&]*&gt;/g, '').replace(/<[^>]*>/g, '').replace(/[\uE000-\uF8FF]/g, '').trim();   // texte lisible d'un élément (sans balises ni glyphes de police musicale)
    const DYN = new Set('p pp ppp pppp ppppp pppppp f ff fff ffff fffff ffffff mp mf sf sfp sfpp fp rf rfz sfz sffz fz n pf sfzp'.split(' '));
    const ARTIC = [['articStaccatissimo', 'staccatissimo'], ['articStaccato', 'staccato'], ['articAccent', 'accent'], ['articMarcato', 'strong-accent'], ['articTenutoStaccato', 'detached-legato'], ['articTenuto', 'tenuto']];
    const ACC = { accidentalSharp: 'sharp', accidentalFlat: 'flat', accidentalNatural: 'natural', accidentalDoubleSharp: 'double-sharp', accidentalDoubleFlat: 'flat-flat', accidentalSharpSharp: 'double-sharp' };
    const CLEFS = { G: ['G', 2], G8vb: ['G', 2, -1], G8va: ['G', 2, 1], G15mb: ['G', 2, -2], F: ['F', 4], F8vb: ['F', 4, -1], F8va: ['F', 4, 1], F15mb: ['F', 4, -2], F3: ['F', 3], C1: ['C', 1], C2: ['C', 2], C3: ['C', 3], C4: ['C', 4], C5: ['C', 5], G1: ['G', 1] };
    const frac = t => { const m = /^(-?\d+)\/(\d+)$/.exec(String(t).trim()); return m ? parseInt(m[1], 10) / parseInt(m[2], 10) : 0; };
    const LET = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], BASEPC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const nMeas = Math.max.apply(null, staves.map(st => kid(st, 'Measure').length));
    // mesure et tonalité de chaque mesure (toutes portées confondues), longueur de chaque mesure
    const meas = []; let sig = [4, 4], fifths = 0; const keyFirst = staves.map(() => null);
    for (let mi = 0; mi < nMeas; mi++) {
      let tsChange = null; staves.forEach((st, si) => { const me = kid(st, 'Measure')[mi]; if (!me) return; kid(me, 'voice').forEach(v => { kid(v, 'TimeSig').forEach(ts => { tsChange = [parseInt(txt(ts, 'sigN', '4'), 10), parseInt(txt(ts, 'sigD', '4'), 10)]; }); if (si === 0) kid(v, 'KeySig').forEach(k => { const c = txt(k, 'concertKey', txt(k, 'accidental', '0')); if (mi === 0 || keyFirst[0] === null) fifths = parseInt(c, 10) || 0; keyFirst[0] = 1; }); }); });
      if (tsChange) sig = tsChange;
      const m0 = staves.map(st => kid(st, 'Measure')[mi]).find(Boolean), lenAttr = m0 && m0.attrs.len;
      meas.push({ num: sig[0], den: sig[1], len: Math.round((lenAttr ? frac(lenAttr) : sig[0] / sig[1]) * 4 * div), change: !!tsChange, nominal: Math.round(sig[0] / sig[1] * 4 * div) });
    }
    // voltas : « 1. », « 2. » au-dessus de la première portée ; elles couvrent le nombre de mesures indiqué par le fichier
    const volta = new Array(nMeas).fill(null);
    kid(staves[0], 'Measure').forEach((me, mi) => kid(me, 'voice').forEach(v => kid(v, 'Spanner').forEach(sp => { if (sp.attrs.type !== 'Volta') return; const vo = one(sp, 'Volta'); if (!vo) return;
      const nums = txt(vo, 'endings', '1').split(/[\s,]+/).map(x => parseInt(x, 10)).filter(x => x > 0), nx = one(sp, 'next'), len = nx && one(nx, 'location') ? Math.max(1, parseInt(txt(one(nx, 'location'), 'measures', '1'), 10) || 1) : 1;
      for (let k = 0; k < len && mi + k < nMeas; k++) volta[mi + k] = { nums: nums.length ? nums : [1], debut: k === 0, fin: k === len - 1 }; })));
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1"><work><work-title>' + esc(title || 'Partition') + '</work-title></work><part-list>';
    parts.length ? parts.forEach((p, i) => { xml += '<score-part id="P' + (i + 1) + '"><part-name>' + esc(txt(p, 'trackName', 'Piano')) + '</part-name></score-part>'; }) : (xml += '<score-part id="P1"><part-name>Piano</part-name></score-part>');
    xml += '</part-list>';
    let g = 0, tempoSeen = false;
    nPer.forEach((ns, pi) => {
      const slurOpen = [], hpKind = [];
      xml += '<part id="P' + (pi + 1) + '">';
      for (let mi = 0; mi < nMeas; mi++) {
        const M = meas[mi]; xml += '<measure number="' + (mi + 1) + '"' + (mi === 0 && M.len < M.nominal ? ' implicit="yes"' : '') + '>';
        if (mi === 0 || M.change) xml += '<attributes>' + (mi === 0 ? '<divisions>' + div + '</divisions><key><fifths>' + fifths + '</fifths></key>' : '') + '<time><beats>' + M.num + '</beats><beat-type>' + M.den + '</beat-type></time>' + (mi === 0 ? '<staves>' + ns + '</staves>' + Array.from({ length: ns }, (_, i) => '<clef number="' + (i + 1) + '"><sign>' + (ns === 2 && i === 1 ? 'F' : 'G') + '</sign><line>' + (ns === 2 && i === 1 ? 4 : 2) + '</line></clef>').join('') : '') + '</attributes>';
        { const me0 = kid(staves[g], 'Measure')[mi]; if (me0) { if (one(me0, 'startRepeat')) xml += '<barline location="left"><repeat direction="forward"/></barline>'; const v0 = me0 && volta[mi]; if (v0 && v0.debut) xml += '<barline location="left"><ending number="' + v0.nums.join(',') + '" type="start"/></barline>'; } }
        let first = true;
        for (let si = 0; si < ns; si++) {
          const me = kid(staves[g + si], 'Measure')[mi]; const voices = me ? kid(me, 'voice') : [];
          voices.forEach((v, vi) => {
            const voiceNo = si * 4 + vi + 1; let pos = 0, out = '', tup = [];
            const items = [], LV = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4, '128th': 5 }; let beamStemCur = null, bmBreak = true, pendFerm = null, tupInfo = null;   // regroupement des barres : celui de la partition (barre explicite, mode « no / begin / mid »), sinon par temps
            const beat = M.den === 8 && M.num % 3 === 0 && M.num > 3 ? Math.round(1.5 * div) : Math.round(4 / M.den * div);
            const ratio = () => tup.reduce((r, t) => r * t[0] / t[1], 1);
            const kids = v.children, grace = c => c.children.some(k => /^(grace|acciaccatura|appoggiatura)/.test(k.name));
            const noteXml = (n, ni, ticks, ty, tm, voiceNo, stf, ties, stemD, tok, extra) => {
              const pitch = parseInt(txt(n, 'pitch', '60'), 10), tpc = parseInt(txt(n, 'tpc', '14'), 10), step = LET[(((tpc + 1) % 7) + 7) % 7], alter = Math.floor((tpc + 1) / 7) - 2, oct = Math.round((pitch - alter - BASEPC[step]) / 12) - 1;
              const tiesA = ties ? kid(n, 'Spanner').filter(sp => sp.attrs.type === 'Tie') : [], tieStart = tiesA.some(sp => sp.children.some(k => k.name === 'next')), tieStop = tiesA.some(sp => sp.children.some(k => k.name === 'prev'));
              const fg = ties ? kid(n, 'Fingering').map(f => txt(f, 'text', '').replace(/<[^>]*>/g, '')).filter(Boolean) : [];
              const ac = ties ? kid(n, 'Accidental')[0] : null, acc = ac && txt(ac, 'visible', '1') !== '0' ? ACC[txt(ac, 'subtype', '')] : '';
              const silent = txt(n, 'play', '1') === '0', hid = txt(n, 'visible', '1') === '0';
              return '<note' + (silent ? ' dynamics="0"' : '') + (hid && !silent ? ' print-object="no"' : '') + '>' + (ni ? '<chord/>' : '') + '<pitch><step>' + step + '</step>' + (alter ? '<alter>' + alter + '</alter>' : '') + '<octave>' + oct + '</octave></pitch><duration>' + ticks + '</duration>' + (tieStop ? '<tie type="stop"/>' : '') + (tieStart ? '<tie type="start"/>' : '') + '<voice>' + voiceNo + '</voice>' + ty + (acc ? '<accidental>' + acc + '</accidental>' : '') + tm + (stemD ? '<stem>' + stemD + '</stem>' : '') + (hid && silent ? '<notehead>none</notehead>' : '') + '<staff>' + stf + '</staff>' + (ni === 0 && tok ? tok : '') +
                ((tieStop || tieStart || fg.length || extra) ? '<notations>' + (tieStop ? '<tied type="stop"/>' : '') + (tieStart ? '<tied type="start"/>' : '') + (extra || '') + (fg.length ? '<technical><fingering>' + esc(fg[0]) + '</fingering></technical>' : '') + '</notations>' : '') + '</note>';
            };
                        const played = c => kid(c, 'Note');   // une note à la fois invisible et muette est une note de mise en page ; une note invisible mais jouée (un des sons d'un arpège écrit, par exemple) sonne : on la garde, sans l'imprimer (comme l'export MusicXML de MuseScore)
            const dur = (c, r) => { const dt = txt(c, 'durationType', 'quarter'), dots = parseInt(txt(c, 'dots', '0'), 10) || 0, ex = txt(c, 'duration', ''); return dt === 'measure' ? (Math.round(frac(ex) * 4 * div) || M.len) : ex ? Math.round(frac(ex) * 4 * div) : Math.round(div * (BASE[dt] || 1) * (2 - Math.pow(0.5, dots)) * r); };
            for (let ci = 0; ci < kids.length; ci++) {
              const c = kids[ci];
              if (c.name === 'Tuplet') { tup.push([parseInt(txt(c, 'normalNotes', '2'), 10), parseInt(txt(c, 'actualNotes', '3'), 10)]); if (tup.length === 1) { const tn = txt(c, 'numberType', '0') !== '2', tb = txt(c, 'bracketType', '0') !== '2'; tupInfo = tn && tb ? null : { num: tn, br: tb, start: true }; } continue; }
              if (c.name === 'endTuplet') { tup.pop(); if (!tup.length) tupInfo = null; continue; }
              const dirX = (inner, pl) => '<direction placement="' + pl + '"><direction-type>' + inner + '</direction-type><staff>' + (si + 1) + '</staff></direction>';
              if (c.name === 'Clef') { const cl = CLEFS[txt(c, 'concertClefType', 'G')]; if (cl) out += '<attributes><clef number="' + (si + 1) + '"><sign>' + cl[0] + '</sign><line>' + cl[1] + '</line>' + (cl[2] ? '<clef-octave-change>' + cl[2] + '</clef-octave-change>' : '') + '</clef></attributes>'; continue; }
              if (c.name === 'Dynamic') { if (txt(c, 'visible', '1') === '0') continue; const sb = txt(c, 'subtype', ''), tx = plain(one(c, 'text') || c); if (DYN.has(sb)) out += dirX('<dynamics><' + sb + '/></dynamics>', 'below'); else if (tx) out += dirX('<words font-style="italic">' + esc(tx) + '</words>', 'below'); continue; }
              if (c.name === 'StaffText' || c.name === 'RehearsalMark') { if (txt(c, 'visible', '1') === '0') continue; const tx = plain(one(c, 'text') || c); if (tx) out += dirX(c.name === 'RehearsalMark' ? '<rehearsal>' + esc(tx) + '</rehearsal>' : '<words>' + esc(tx) + '</words>', 'above'); continue; }
              if (c.name === 'Spanner' && (c.attrs.type === 'HairPin' || c.attrs.type === 'Pedal')) {
                const st = c.children.some(k => k.name === 'next'), en = c.children.some(k => k.name === 'prev');
                if (c.attrs.type === 'HairPin') { const hp = one(c, 'HairPin'), sub = hp ? parseInt(txt(hp, 'subtype', '0'), 10) || 0 : 0;
                  if (st) { if (hp && txt(hp, 'visible', '1') === '0') hpKind[si] = 'none';
                    else if (sub >= 2) { const bt = hp ? plain(one(hp, 'beginText') || { text: '', children: [] }) : '', wd = bt || (sub === 3 ? 'decresc.' : 'cresc.'); hpKind[si] = !hp || txt(hp, 'lineVisible', '1') !== '0' ? 'dashes' : 'words'; out += dirX('<words>' + esc(wd) + '</words>', 'below') + (hpKind[si] === 'dashes' ? dirX('<dashes type="start" number="' + (si + 1) + '"/>', 'below') : ''); }
                    else { hpKind[si] = 'wedge'; out += dirX('<wedge type="' + (sub === 1 ? 'diminuendo' : 'crescendo') + '" number="' + (si + 1) + '"/>', 'below'); } }
                  else if (en) { if (hpKind[si] === 'wedge') out += dirX('<wedge type="stop" number="' + (si + 1) + '"/>', 'below'); else if (hpKind[si] === 'dashes') out += dirX('<dashes type="stop" number="' + (si + 1) + '"/>', 'below'); hpKind[si] = null; } }
                else { const pd = one(c, 'Pedal'), ln = pd && txt(pd, 'lineVisible', '1') === '0' ? 'no' : 'yes', sg = !pd || !/\S/.test(txt(pd, 'beginText', '')) || /Ped/.test(txt(pd, 'beginText', '')) ? 'yes' : 'no'; if (st) out += dirX('<pedal type="start" line="' + ln + '" sign="' + sg + '"/>', 'below'); else if (en) out += dirX('<pedal type="stop" line="' + ln + '" sign="' + sg + '"/>', 'below'); }
                continue; }
              if (c.name === 'Fermata') { pendFerm = txt(c, 'visible', '1') === '0' ? null : (/Below/.test(txt(c, 'subtype', '')) ? 'inverted' : 'upright'); continue; }
              if (c.name === 'Beam') { bmBreak = true; beamStemCur = txt(c, 'StemDirection', '') || null; continue; }
              if (c.name === 'Tempo') { const tv = parseFloat(txt(c, 'tempo', '0')); if (tv > 0 && si === 0 && vi === 0) { const bp = Math.round(tv * 60 * 100) / 100; out += '<direction placement="above">' + (txt(c, 'visible', '1') === '0' ? '' : (tt => tt && !/=/.test(tt) ? '<direction-type><words>' + esc(tt) + '</words></direction-type>' : '<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + (Math.round(bp * 10) / 10) + '</per-minute></metronome></direction-type>')(/&lt;sym&gt;|<sym>/.test(deep(one(c, 'text') || c)) ? '' : plain(one(c, 'text') || c))) + '<sound tempo="' + bp + '"/></direction>'; } continue; }   // tempo arrondi (1,33333 noire par seconde = 80, et non 79,9998), écrit une fois, sur la première portée
              if (c.name === 'location') { const f = frac(txt(c, 'fractions', '0')); if (f) { const t = Math.round(f * 4 * div); out += t > 0 ? '<forward><duration>' + t + '</duration></forward>' : '<backup><duration>' + (-t) + '</duration></backup>'; pos += t; } continue; }
              if (c.name !== 'Chord' && c.name !== 'Rest') continue;
              if (grace(c)) continue;   // notes d'agrément : pas de durée propre
              const dt = txt(c, 'durationType', 'quarter'), dots = parseInt(txt(c, 'dots', '0'), 10) || 0, r = ratio(), ticks = dur(c, r);
              const typ = TYPE[dt] || 'quarter', tm = tup.length ? '<time-modification><actual-notes>' + Math.round(tup.reduce((a, t) => a * t[1], 1)) + '</actual-notes><normal-notes>' + Math.round(tup.reduce((a, t) => a * t[0], 1)) + '</normal-notes></time-modification>' : '';
              const ty = dt === 'measure' ? '' : '<type>' + typ + '</type>' + '<dot/>'.repeat(dots);
              const rest = n => '<note><rest' + (dt === 'measure' ? ' measure="yes"' : '') + '/><duration>' + n + '</duration><voice>' + voiceNo + '</voice>' + ty + tm + '<staff>' + (si + 1) + '</staff></note>';
              if (c.name === 'Rest') { out += rest(ticks).replace(/<\/note>$/, (pendFerm ? '<notations><fermata type="' + pendFerm + '"/></notations></note>' : '</note>')); pendFerm = null; pos += ticks; items.push({ brk: true }); beamStemCur = null; continue; }
              const move = parseInt(txt(c, 'staffMove', '0'), 10) || 0, stf = Math.max(1, Math.min(ns, si + 1 + move)), notes = played(c);
              // les trémolos restent écrits comme dans la partition (comme le fait l'export MusicXML de MuseScore) : un trémolo n'est pas développé en notes répétées
              const lvl = LV[dt] || 0, bm = txt(c, 'BeamMode', ''), stemD = txt(c, 'noStem', '0') === '1' ? 'none' : (txt(c, 'StemDirection', '') || (lvl ? beamStemCur : null) || ''), id = items.length;
              let extra = '';
              if (notes.length) {
                if (tupInfo) { if (tupInfo.start) { extra += '<tuplet type="start" bracket="' + (tupInfo.br ? 'yes' : 'no') + '" show-number="' + (tupInfo.num ? 'actual' : 'none') + '"/>'; tupInfo.start = false; } if (kids[ci + 1] && kids[ci + 1].name === 'endTuplet') extra += '<tuplet type="stop"/>'; }
                kid(c, 'Spanner').filter(sp => sp.attrs.type === 'Slur').forEach(sp => { if (sp.children.some(k => k.name === 'prev') && slurOpen.length) extra += '<slur type="stop" number="' + slurOpen.pop() + '"/>'; if (sp.children.some(k => k.name === 'next')) { let nb = 1; while (slurOpen.includes(nb)) nb++; slurOpen.push(nb); extra += '<slur type="start" number="' + nb + '"/>'; } });
                const ar = kid(c, 'Articulation').filter(a => txt(a, 'visible', '1') !== '0').map(a => { const sb = txt(a, 'subtype', ''), m = ARTIC.find(x => sb.startsWith(x[0])); return m ? '<' + m[1] + '/>' : ''; }).filter(Boolean);
                if (ar.length) extra += '<articulations>' + ar.join('') + '</articulations>';
                if (pendFerm) extra += '<fermata type="' + pendFerm + '"/>'; pendFerm = null;
              }
              if (!notes.length) out += '<forward><duration>' + ticks + '</duration><voice>' + voiceNo + '</voice><staff>' + (si + 1) + '</staff></forward>';   // accords de mise en page (invisibles et muets) : le temps passe, rien n'est écrit
              else {
                if (lvl) { items.push({ lvl, brk: bmBreak || bm === 'no' || bm === 'begin' || (bm !== 'mid' && pos % beat === 0) }); bmBreak = bm === 'no'; } else { items.push({ brk: true }); beamStemCur = null; }
                notes.forEach((n, ni) => { out += noteXml(n, ni, ticks, ty, tm, voiceNo, stf, true, stemD, lvl ? '\u0001' + id + '\u0002' : '', ni === 0 ? extra : ''); });
              }
              pos += ticks;
            }
            { const bx = new Map(); let grp = [];
              const flush = () => { if (grp.length > 1) grp.forEach((it, i) => { let b = ''; for (let k = 1; k <= it.lvl; k++) { const pv = i > 0 && grp[i - 1].lvl >= k, nx = i < grp.length - 1 && grp[i + 1].lvl >= k; b += '<beam number="' + k + '">' + (pv && nx ? 'continue' : nx ? 'begin' : pv ? 'end' : i === 0 ? 'forward hook' : 'backward hook') + '</beam>'; } bx.set(it.id, b); }); grp = []; };
              items.forEach((it, id) => { if (!it.lvl) { flush(); return; } if (it.brk) flush(); grp.push({ lvl: it.lvl, id }); }); flush();
              out = out.replace(/\u0001(\d+)\u0002/g, (_, i) => bx.get(+i) || ''); }
            if (!first) xml += '<backup><duration>' + (M.len) + '</duration></backup>';
            first = false; xml += out; if (pos < M.len) xml += '<forward><duration>' + (M.len - pos) + '</duration></forward>'; else if (pos > M.len) xml += '<backup><duration>' + (pos - M.len) + '</duration></backup>';
          });
        }
        { const me0 = kid(staves[g], 'Measure')[mi], er = me0 && one(me0, 'endRepeat'), vv = volta[mi], fin = vv && vv.fin;
          if (er || fin) xml += '<barline location="right">' + (fin ? '<ending number="' + vv.nums.join(',') + '" type="stop"/>' : '') + (er ? '<repeat direction="backward" times="' + (parseInt(er.text.trim(), 10) || 2) + '"/>' : '') + '</barline>'; }
        xml += '</measure>';
      }
      xml += '</part>'; g += ns;
    });
    return xml + '</score-partwise>';
  }
  async function parseMscz(data, name) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    let src;
    if (b[0] === 0x50 && b[1] === 0x4b) {
      const z = await unzip(b); let path = null;
      const c = await z.get('META-INF/container.xml');
      if (c) { const m = /full-path="([^"]+\.mscx)"/.exec(new TextDecoder().decode(c)); if (m) path = m[1]; }
      if (!path) path = Object.keys(z.files).find(n => /\.mscx$/i.test(n));
      if (!path) throw new Error('Aucune partition (.mscx) dans cette archive MuseScore.');
      src = new TextDecoder().decode(await z.get(path));
    } else src = new TextDecoder().decode(b);
    return parseMusicXml(msczToMusicXml(src));
  }

  // ---------- Détection ----------
  async function loadSong(name, data, opts) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
    let song;
    if (magic === 'MThd') song = parseMidi(b);
    else if (/\.mscz$|\.mscx$/i.test(name)) song = await parseMscz(b, name);
    else if (b[0] === 0x50 && b[1] === 0x4b) song = await parseMxl(b);
    else if (/\.pdf$/i.test(name) || magic === '%PDF') throw new Error('Les PDF/images de partitions ne sont pas encore pris en charge : exportez d\'abord en MIDI ou MusicXML (MuseScore, etc.).');
    else song = parseMusicXml(new TextDecoder().decode(b));
    if (opts && opts.reprises) song = depliderReprises(song);
    if (!song.notes.length) throw new Error('Aucune note trouvée dans ce fichier.');
    if (!song.title) song.title = name.replace(/\.[^.]+$/, '');
    return song;
  }

  // ---------- Reprises et voltas ----------
  // Renvoie une partition où les reprises (barres de reprise) et les voltas (1re / 2e fois) sont jouées dans l'ordre de l'exécution ; les renvois (D.C., D.S., coda) ne sont pas traités. Les notes des passages répétés sont des copies (même doigté lu dans le fichier) ; l'export des doigtés reprend la première occurrence.
  function depliderReprises(song) {
    const rep = song.repeats, M = song.measures;
    if (!rep || !M.length || !Object.keys(rep).some(k => rep[k].start || rep[k].end)) return song;
    const n = M.length, volta = new Array(n).fill(null); let cur = null;
    for (let i = 0; i < n; i++) { const r = rep[i] || {}; if (r.endStart) cur = r.endStart; if (cur) volta[i] = cur; if (r.endStop) cur = null; }
    const ordre = []; let i = 0, depart = 0, passage = 1, garde = 0;
    while (i < n && garde++ < n * 8) {
      const r = rep[i] || {};
      if (r.start && depart !== i) { depart = i; passage = 1; }
      if (volta[i] && !volta[i].includes(passage)) { i++; continue; }
      ordre.push(i);
      if (r.end && passage < r.end) { passage++; i = depart; continue; }
      if (r.end) { passage = 1; depart = i + 1; }
      else if (volta[i] && String(volta[i + 1]) !== String(volta[i])) { passage = 1; depart = i + 1; }
      i++;
    }
    if (ordre.every((m, k) => m === k)) return song;
    const parMesure = M.map(() => []); song.notes.forEach(nt => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (M[mid].startTick <= nt.tick) lo = mid; else hi = mid - 1; } parMesure[lo].push(nt); });
    const out = Object.assign({}, song, { notes: [], measures: [], tempos: [], depliee: true }); let curseur = 0; const vu = new Set();
    ordre.forEach(idx => {
      const m = M[idx]; out.measures.push(Object.assign({}, m, { startTick: curseur, ecrite: idx }));
      parMesure[idx].forEach(nt => { const c = Object.assign({}, nt); c.tick = nt.tick - m.startTick + curseur; if (vu.has(idx)) c.copie = true; out.notes.push(c); });
      song.tempos.forEach(tp => { if (tp.tick >= m.startTick && tp.tick < m.startTick + m.lenTick) out.tempos.push({ tick: tp.tick - m.startTick + curseur, uspq: tp.uspq }); });
      vu.add(idx); curseur += m.lenTick;
    });
    if (!out.tempos.some(t => t.tick === 0)) out.tempos.unshift({ tick: 0, uspq: song.tempos.length ? song.tempos[0].uspq : 500000 });
    out.tempos.sort((x, y) => x.tick - y.tick); out.endTick = curseur; out.tempos0 = null;
    out.timeline = makeTimeline(out.tempos, out.ppq); out.fileBpm = out.timeline.bpmAtTick(0); out.notes.sort((x, y) => x.tick - y.tick || x.midi - y.midi); out.maxDur = out.notes.reduce((mx, nt) => Math.max(mx, nt.dur), 0); computeTimes(out);
    return out;
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


  // ---------- Export d'un MIDI : MusicXML construit à partir des notes (approximatif : pas de tonalité, croches/doubles-croches seulement, triolets ramenés à la double-croche) ----------
  function xmlFromMidi(song, fing, keyHint) {
    const U = 12, esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // tonalité : profils de Krumhansl-Kessler (majeur et mineur) comparés, par corrélation, aux durées cumulées de chaque note (algorithme de Krumhansl-Schmuckler)
    const hist = new Array(12).fill(0); song.notes.forEach(n => { hist[n.midi % 12] += Math.max(1, n.dur); });
    if (song.notes.length) { const tot = hist.reduce((x, y) => x + y, 0), fst = song.notes[0], lst = song.notes.reduce((m, n) => n.tick + n.dur > m.tick + m.dur ? n : m, fst); hist[fst.midi % 12] += tot * 0.06; hist[lst.midi % 12] += tot * 0.06; }   // le début et surtout la fin d'un morceau tonal tombent presque toujours sur la tonique
    const KMAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KMIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const corr = (x, y) => { const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < 12; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : -2; };
    let kTon = 0, kMin = false, kBest = -9; for (let t = 0; t < 12; t++) [false, true].forEach(mn => { const P = mn ? KMIN : KMAJ, r = corr(hist, P.map((_, i) => P[(i - t + 12) % 12])); if (r > kBest) { kBest = r; kTon = t; kMin = mn; } });
    const TON = { '-6': 6, '-5': 1, '-4': 8, '-3': 3, '-2': 10, '-1': 5, '0': 0, '1': 7, '2': 2, '3': 9, '4': 4, '5': 11, '6': 6 }, MAJ = [0, 2, 4, 5, 7, 9, 11];
    if (keyHint) { kMin = keyHint.minor; const mj = TON[keyHint.fifths]; if (mj !== undefined) kTon = kMin ? (mj + 9) % 12 : mj; }   // tonalité écrite dans le fichier d'origine : on la garde
    const relMaj = kMin ? (kTon + 3) % 12 : kTon;   // un mode mineur s'écrit avec l'armure de sa tonalité relative majeure
    let fifths = 0; { let bd = 99; for (let f = -6; f <= 6; f++) if (TON[f] === relMaj && Math.abs(f) < bd) { bd = Math.abs(f); fifths = f; } }
    const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], LPC = [0, 2, 4, 5, 7, 9, 11], TLET = { '-6': 4, '-5': 1, '-4': 5, '-3': 2, '-2': 6, '-1': 3, '0': 0, '1': 4, '2': 1, '3': 5, '4': 2, '5': 6, '6': 3 };
    const SH = new Array(12).fill(null); { const li = TLET[fifths], t = TON[fifths]; MAJ.forEach((d, i) => { const l = (li + i) % 7, pc = (t + d) % 12; let a = pc - LPC[l]; if (a > 6) a -= 12; if (a < -6) a += 12; SH[pc] = [LET[l], a]; });
      if (kMin) [[(kTon + 11) % 12, (kTon + 10) % 12], [(kTon + 9) % 12, (kTon + 8) % 12]].forEach(([pc, nat]) => { if (!SH[pc] && SH[nat]) SH[pc] = [SH[nat][0], SH[nat][1] + 1]; });   // sensible et sixte relevées du mineur
      for (let pc = 0; pc < 12; pc++) if (!SH[pc]) { const l = LPC.map((v, i) => [v, i]).filter(([v]) => (fifths >= 0 ? v === pc - 1 : v === pc + 1)); const i = l.length ? l[0][1] : 0; SH[pc] = [LET[i], fifths >= 0 ? 1 : -1]; } }
    // Unité de temps : le douzième de noire (une double-croche = 3, une croche = 6, une croche de triolet = 4). Un temps est « de triolet » quand au moins deux attaques tombent au tiers ou aux deux tiers du temps, sans que les doubles-croches y dominent.
    const ppq = song.ppq, trip = new Set();
    const tripGrid = new Map();   // temps de triolet -> pas (4 : croches de triolet ; 2 : doubles-croches de triolet, ou sextolets)
    { const cT = new Map(), cB = new Map(), cS = new Map(); song.notes.forEach(n => { const bt = Math.floor(n.tick / ppq + 1e-9), ph = (n.tick - bt * ppq) / ppq * U, d4 = Math.min(Math.abs(ph - 4), Math.abs(ph - 8)), d2 = Math.min(Math.abs(ph - 2), Math.abs(ph - 10)), dB = Math.min(Math.abs(ph - 3), Math.abs(ph - 9)), dT = Math.min(d4, d2); if (dT < 0.6 && dT < dB) { cT.set(bt, (cT.get(bt) || 0) + 1); if (d2 < d4) cS.set(bt, (cS.get(bt) || 0) + 1); } else if (dB < 0.6 && dB < dT) cB.set(bt, (cB.get(bt) || 0) + 1); });
      const gu = ppq / U, onG = song.notes.filter(n => Math.abs(n.tick - Math.round(n.tick / gu) * gu) <= 0.15 * gu).length / (song.notes.length || 1);
      if (onG >= 0.85) cT.forEach((c, bt) => { if (c >= 2 && c > (cB.get(bt) || 0)) { trip.add(bt); tripGrid.set(bt, cS.get(bt) ? 2 : 4); } }); }   // pas de triolets dans un fichier dont les attaques ne tombent pas sur la grille (jeu libre) : ce serait du bruit
    const qpos = (t, isEnd, shortNote) => { const bt = Math.floor(t / ppq + 1e-9), ph = (t - bt * ppq) / ppq * U, gr = trip.has(bt) ? tripGrid.get(bt) : (isEnd && !shortNote ? 6 : 3); return bt * U + Math.round(ph / gr) * gr; };
    const isTrip = p => trip.has(Math.floor(p / U));
    const NORM = [[48, 'whole', 0], [36, 'half', 1], [24, 'half', 0], [18, 'quarter', 1], [12, 'quarter', 0], [9, 'eighth', 1], [6, 'eighth', 0], [3, '16th', 0]];   // en douzièmes de noire
    // un morceau de note peut couvrir en entier un temps de triolet, mais pas en couper une partie
    const okSpan = (p, size) => { for (let bt = Math.floor(p / U); bt <= Math.floor((p + size - 1) / U); bt++) if (trip.has(bt) && !(p <= bt * U && p + size >= (bt + 1) * U)) return false; return true; };
    const TT = { 8: ['quarter', 0], 6: ['eighth', 1], 4: ['eighth', 0], 2: ['16th', 0] };   // valeurs d'un temps de triolet, en douzièmes de noire
    const tripPiece = (off, len) => (off === 0 || off === 4) && len >= 8 && off + 8 <= U ? 8 : (off === 0 || off === 6) && len >= 6 && off + 6 <= U ? 6 : off % 4 === 0 && len >= 4 ? 4 : 2;
    const pieces = (pos, len) => { const out = []; while (len > 0) {
      if (isTrip(pos) && !(pos % U === 0 && len >= U)) { const sz = tripPiece(pos % U, len); out.push({ n: sz, type: TT[sz][0], dot: TT[sz][1], tm: true, r: tripGrid.get(Math.floor(pos / U)) === 2 ? [6, 4] : [3, 2], sb: pos % U === 0, eb: (pos % U) + sz === U }); pos += sz; len -= sz; continue; }
      const p = NORM.find(r => r[0] <= len && okSpan(pos, r[0])) || NORM[7]; out.push({ n: p[0], type: p[1], dot: p[2], tm: false }); pos += p[0]; len -= p[0]; } return out; };
    // silences : jamais pointés, et alignés sur leur propre valeur (pas de silence de blanche sur le 2e temps)
    const RPN = [48, 24, 12, 6, 3], RT = { 48: 'whole', 24: 'half', 12: 'quarter', 6: 'eighth', 3: '16th' };
    const restPieces = (rel, abs, len) => { const out = []; while (len > 0) {
      if (isTrip(abs) && !(rel % U === 0 && len >= U)) { let sz = tripPiece(abs % U, len); if (sz === 6) sz = 4; out.push({ n: sz, type: TT[sz][0], dot: 0, tm: true, r: tripGrid.get(Math.floor(abs / U)) === 2 ? [6, 4] : [3, 2], sb: abs % U === 0, eb: (abs % U) + sz === U }); rel += sz; abs += sz; len -= sz; continue; }
      const sz = RPN.find(r => r <= len && rel % r === 0 && okSpan(abs, r)) || 3; out.push({ n: sz, type: RT[sz], dot: 0, tm: false }); rel += sz; abs += sz; len -= sz; } return out; };
    const measures = song.measures.map(m => ({ s: Math.round(m.startTick / ppq * U), l: Math.max(1, Math.round(m.lenTick / ppq * U)), num: m.num, den: m.den }));
    const staffNotes = { R: [], L: [] };
    song.notes.forEach(n => { const s = qpos(n.tick, false, false), shortN = n.dur / ppq * U < 6; let e = qpos(n.tick + n.dur, true, shortN); if (e <= s) e = s + (isTrip(s) ? 4 : 3); staffNotes[(n.fh || n.hand) === 'L' ? 'L' : 'R'].push({ n, s, e }); });
    ['R', 'L'].forEach(h => {   // même hauteur au même instant (parties doublées dans le fichier d'origine) : une seule note, la plus longue
      const best = new Map(); staffNotes[h].forEach(o => { const k = o.s + '|' + o.n.midi, b = best.get(k); if (!b || o.e > b.e) best.set(k, o); }); staffNotes[h] = [...best.values()];
    });
    ['R', 'L'].forEach(h => {   // une même note ne peut pas sonner deux fois à la fois : si elle est rejouée avant la fin de la précédente, celle-ci s'arrête à la nouvelle attaque
      const byP = new Map(); staffNotes[h].forEach(o => { const k = o.n.midi; if (!byP.has(k)) byP.set(k, []); byP.get(k).push(o); });
      byP.forEach(arr => { arr.sort((x, y) => x.s - y.s); for (let i = 0; i + 1 < arr.length; i++) if (arr[i].e > arr[i + 1].s) arr[i].e = Math.max(arr[i].s + 3, arr[i + 1].s); });
    });
    ['R', 'L'].forEach(h => {
      const L = staffNotes[h], ons = [...new Set(L.map(o => o.s))].sort((a, b) => a - b), nxt = new Map(); ons.forEach((v, i) => nxt.set(v, ons[i + 1]));
      L.forEach(o => { const s2 = nxt.get(o.s); if (s2 !== undefined && o.e > s2 && o.e - s2 <= 3) o.e = s2; });   // chevauchement d'un seul cran avec la note suivante : jeu legato
      const bs = new Map(); L.forEach(o => { if (!bs.has(o.s)) bs.set(o.s, []); bs.get(o.s).push(o); });
      bs.forEach(arr => { arr.sort((a, b) => a.e - b.e); let c = [arr[0]]; const fl = () => { const mx = c[c.length - 1].e; c.forEach(o => { o.e = mx; }); }; for (let i = 1; i < arr.length; i++) { if (arr[i].e - c[c.length - 1].e <= 9) c.push(arr[i]); else { fl(); c = [arr[i]]; } } fl(); });   // notes d'un même accord : même fin à un ou deux crans près
    });
    ['R', 'L'].forEach(h => {   // dernier passage (après les ajustements de fins) : une même hauteur ne sonne jamais deux fois à la fois dans une main
      const byP = new Map(); staffNotes[h].forEach(o => { const k = o.n.midi; if (!byP.has(k)) byP.set(k, []); byP.get(k).push(o); });
      byP.forEach(arr => { arr.sort((x, y) => x.s - y.s); for (let i = 0; i + 1 < arr.length; i++) if (arr[i].e > arr[i + 1].s) arr[i].e = Math.max(arr[i].s + 3, arr[i + 1].s); });
    });
    const noteXml = (ev, p, tie, first, chord, voice, staff, hide) => {
      let x = '<note' + (ev === null && hide ? ' print-object="no"' : '') + '>' + (chord ? '<chord/>' : '');
      x += ev === null ? '<rest/>' : '<pitch><step>' + SH[ev.n.midi % 12][0] + '</step>' + (SH[ev.n.midi % 12][1] ? '<alter>' + SH[ev.n.midi % 12][1] + '</alter>' : '') + '<octave>' + (Math.floor(ev.n.midi / 12) - 1) + '</octave></pitch>';
      x += '<duration>' + p.n + '</duration>';
      if (ev !== null) { if (tie.stop) x += '<tie type="stop"/>'; if (tie.start) x += '<tie type="start"/>'; }
      x += '<voice>' + voice + '</voice><type>' + p.type + '</type>' + (p.dot ? '<dot/>' : '') + (p.tm ? '<time-modification><actual-notes>' + p.r[0] + '</actual-notes><normal-notes>' + p.r[1] + '</normal-notes></time-modification>' : '') + '<staff>' + staff + '</staff>';
      const tup = p.tm && !chord ? (p.sb ? '<tuplet type="start" bracket="yes"/>' : '') + (p.eb ? '<tuplet type="stop"/>' : '') : '';
      let nt = tup;
      if (ev !== null) { const f = first ? ((fing(ev.n) || {}).f || 0) : 0; nt += (tie.stop ? '<tied type="stop"/>' : '') + (tie.start ? '<tied type="start"/>' : '') + (f ? '<technical><fingering>' + f + '</fingering></technical>' : ''); }
      if (nt) x += '<notations>' + nt + '</notations>';
      return x + '</note>';
    };
    // écriture « accords » : une seule voix par main ; à chaque attaque, les notes qui démarrent ensemble forment un accord qui dure jusqu'à la prochaine attaque de la main (au plus la longueur de la plus longue de ses notes). Une note tenue sous d'autres attaques est coupée à la prochaine attaque.
    const voicesOf = list => {
      const ons = [...new Set(list.map(o => o.s))].sort((x, y) => x - y), evs = [];
      ons.forEach((st, i) => { const at = list.filter(o => o.s === st), mx = Math.max.apply(null, at.map(o => o.e)), nx = ons[i + 1]; evs.push({ s: st, e: nx === undefined ? mx : Math.min(nx, mx), notes: at }); });
      for (let i = 0; i + 1 < evs.length; i++) { const gap = evs[i + 1].s - evs[i].e; if (gap >= 1 && gap <= 9) evs[i].e = evs[i + 1].s; }   // petit silence entre deux attaques : on prolonge la note (jeu détaché)
      return evs.length ? [{ evs, end: evs[evs.length - 1].e }] : [];
    };
    const bpm0 = song.timeline ? song.timeline.bpmAtTick(0) : song.fileBpm;   // le tempo réglé dans l'application (celui du fichier tant qu'on n'y touche pas)
    const ttl = String(song.title || 'Morceau').replace(/\.(mid|midi)$/i, '');
    const vR = voicesOf(staffNotes.R), vL = voicesOf(staffNotes.L);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1"><work><work-title>' + esc(ttl) + '</work-title></work><movement-title>' + esc(ttl) + '</movement-title><identification/><credit page="1"><credit-type>title</credit-type><credit-words font-size="22" justify="center" valign="top" default-x="600" default-y="1500">' + esc(ttl) + '</credit-words></credit><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
    let lastTs = '';
    measures.forEach((m, mi) => {
      xml += '<measure number="' + (mi + 1) + '"' + (mi === 0 && song.measures[0].lenTick < song.ppq * 4 * m.num / m.den * 0.999 ? ' implicit="yes"' : '') + '>';
      const ts = m.num + '/' + m.den;
      if (mi === 0) xml += '<attributes><divisions>' + U + '</divisions><key><fifths>' + fifths + '</fifths><mode>' + (kMin ? 'minor' : 'major') + '</mode></key><time><beats>' + m.num + '</beats><beat-type>' + m.den + '</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + Math.round(bpm0) + '</per-minute></metronome></direction-type><sound tempo="' + bpm0 + '"/></direction>';
      else if (ts !== lastTs) xml += '<attributes><time><beats>' + m.num + '</beats><beat-type>' + m.den + '</beat-type></time></attributes>';
      lastTs = ts;
      let first = true;
      [[1, vR], [2, vL]].forEach(([staff, voices]) => {
        const snd = new Map();   // hauteurs déjà écrites dans cette portée pour cette mesure : jamais la même note deux fois à la fois, même dans deux voix
        const act = voices.map((v, vi) => ({ v, vi })).filter(o => o.v.evs.some(ev => ev.e > m.s && ev.s < m.s + m.l));   // seulement les voix qui jouent dans cette mesure ; sinon un seul silence de mesure
        const V = act.length ? act : [{ v: { evs: [] }, vi: 0 }];
        V.forEach(({ v, vi }) => {
          if (!first) xml += '<backup><duration>' + m.l + '</duration></backup>';
          first = false; const voiceNo = (staff - 1) * 4 + vi + 1; let cur = m.s; const end = m.s + m.l;
          v.evs.filter(ev => ev.e > m.s && ev.s < end).forEach(ev => {
            const s = Math.max(ev.s, cur, m.s), e = Math.min(ev.e, end);
            if (e <= s) return;
            restPieces(cur - m.s, cur, s - cur).forEach(p => { xml += noteXml(null, p, {}, false, false, voiceNo, staff, vi > 0); });
            const ps = pieces(s, e - s), keep = ev.notes.filter(o => !((snd.get(o.n.midi) || 0) > s));
            keep.forEach(o => snd.set(o.n.midi, e));
            if (!keep.length) { restPieces(s - m.s, s, e - s).forEach(p => { xml += noteXml(null, p, {}, false, false, voiceNo, staff, true); }); cur = e; return; }
            ps.forEach((p, pi) => keep.forEach((o, oi) => { xml += noteXml(o, p, { stop: pi > 0 || ev.s < m.s, start: pi < ps.length - 1 || ev.e > end }, pi === 0 && ev.s >= m.s, oi > 0, voiceNo, staff); }));
            cur = e;
          });
          if (cur < end) { const rest = restPieces(cur - m.s, cur, end - cur); if (cur === m.s && rest.length === 1 && rest[0].n === m.l) xml += '<note><rest measure="yes"/><duration>' + m.l + '</duration><voice>' + voiceNo + '</voice><staff>' + staff + '</staff></note>'; else rest.forEach(p => { xml += noteXml(null, p, {}, false, false, voiceNo, staff, vi > 0); }); }
        });
      });
      xml += '</measure>';
    });
    return xml + '</part></score-partwise>\n';
  }

    // ---------- Export : le fichier MusicXML d'origine, tel quel, avec les doigtés d'aujourd'hui ----------
  // fing(n) -> { f, f2, hand } : doigt affiché, doigt de substitution éventuel, main à écrire (« MD » / « MG ») ou rien. Renvoie null si la partition d'origine n'est pas un MusicXML « partwise ».
  function injectFingerings(song, fing) {
    if (!song) return null;
    const src = song.sourceXml;
    // l'application ne traite que le piano : un fichier d'origine qui n'est pas déjà une partie de piano à deux portées (MIDI, plusieurs parties, une seule portée…) est réécrit sur deux portées à partir des notes
    const onePiano = src && (src.match(/<part(?=[\s>])/g) || []).length === 1 && /<staves>\s*2\s*<\/staves>/.test(src);
    if (!onePiano) { const km = src && /<fifths>\s*(-?\d+)\s*<\/fifths>(?:\s*<mode>\s*(\w+)\s*<\/mode>)?/.exec(src); return xmlFromMidi(song, fing, km ? { fifths: parseInt(km[1], 10), minor: km[2] === 'minor' } : song.key ? { fifths: song.key.fifths, minor: !!song.key.minor } : null); }   // tonalité déclarée en écriture : elle fixe l'armure

    const byIdx = new Map(); song.notes.forEach(n => { if (n.srcIdx !== undefined && !n.copie && !byIdx.has(n.srcIdx)) byIdx.set(n.srcIdx, n); });
    // Main : écrite (« MD » / « MG ») seulement sur la PREMIÈRE note d'une série, quand elle diffère de ce que la lecture du fichier supposerait : la main de la portée, ou celle déjà écrite plus haut dans la même portée (quelle que soit la voix ou la mesure) tant que les hampes gardent le même sens et qu'aucun silence ne l'interrompt ; le fichier exporté porte un repère qui l'indique à la relecture
    const handLab = new Map(), ser = new Map(), parts = []; { const rp = /<part(?=[\s>])/g; let pm; while ((pm = rp.exec(src))) parts.push(pm.index); }
    { const rn = /<note(?=[\s>])[\s\S]*?<\/note>/g; let nm, ord = 0;   // tous les éléments <note>, dans l'ordre du fichier : un silence interrompt la série
      while ((nm = rn.exec(src))) {
        const n = byIdx.get(ord++);
        if (!n) { if (/<rest\b/.test(nm[0])) { let pi = -1; parts.forEach((p, i) => { if (p <= nm.index) pi = i; }); ser.delete(pi + '|' + ((/<staff>(\d+)/.exec(nm[0]) || [0, '1'])[1])); } continue; }
        const g = fing(n) || {}, key = (n.track || 0) + '|' + n.staff, eff = n.fh || n.hand, def = n.autoHand || eff, c = ser.get(key), same = c && c.stem === n.stem, assumed = same ? c.hand : def;
        if (eff && eff !== assumed) { if (g.f) { handLab.set(n, eff); ser.set(key, { hand: eff, stem: n.stem }); } }
        else if (!same && c) ser.delete(key);
      } }
    const FING = /<fingering\b[^>]*>[^<]*<\/fingering>|<fingering\b[^>]*\/>/g;
    const clean = seg => seg.replace(FING, '').replace(/<technical>\s*<\/technical>/g, '');
    const re = /<note(?=[\s>])[\s\S]*?<\/note>/g; let k = 0, out = '', last = 0, m;
    while ((m = re.exec(src))) {
      const n = byIdx.get(k++); let seg = m[0];
      if (!n) {   // note de liaison (suite d'une note tenue) : l'application en a fait un changement de doigt de la première note ; on retire son doigté d'origine, il serait en double
        if (/<tie(d)?\b[^>]*type="stop"/.test(seg) && /<fingering\b/.test(seg)) { out += src.slice(last, m.index) + clean(seg); last = m.index + m[0].length; }
        continue;
      }
      const g = fing(n) || {}, hl = handLab.get(n), label = g.f ? (hl ? (hl === 'L' ? 'MG' : 'MD') : '') + g.f : '';
      const want = label ? [label].concat(g.f2 ? ['~' + g.f2] : []) : [];
      const have = [...seg.matchAll(/<fingering\b([^>]*)>([^<]*)<\/fingering>/g)].map(x => (/substitution="yes"/.test(x[1]) ? '~' : '') + x[2].trim());
      if (have.join('|') === want.join('|')) continue;   // déjà exactement ce qu'il faut : on n'y touche pas
      seg = clean(seg);   // seule la version courante est écrite : ni le doigté d'origine, ni la proposition automatique qui a été modifiée
      if (label) {
        const tech = '<fingering>' + label + '</fingering>' + (g.f2 ? '<fingering substitution="yes">' + g.f2 + '</fingering>' : '');
        if (seg.includes('</technical>')) seg = seg.replace('</technical>', tech + '</technical>');
        else if (seg.includes('</notations>')) seg = seg.replace('</notations>', '<technical>' + tech + '</technical></notations>');
        else { const ins = '<notations><technical>' + tech + '</technical></notations>'; const li = seg.indexOf('<lyric'); seg = li >= 0 ? seg.slice(0, li) + ins + seg.slice(li) : seg.replace(/<\/note>$/, ins + '</note>'); }
      }
      out += src.slice(last, m.index) + seg; last = m.index + m[0].length;
    }
    // Sauts de ligne / de page forcés du fichier d'origine : retirés, MuseScore répartit lui-même les mesures (sinon une ligne trop pleine laisse une mesure seule sur la suivante)
    let res = out + src.slice(last);
    if (!res.includes(SERIES_MARK)) res = res.replace(/(<score-partwise\b[^>]*>)/, '$1<!--' + SERIES_MARK + '-->');   // repère : relu, ce fichier suit la règle « une indication de main vaut pour la série »
    return res.replace(/(<print\b[^>]*?)\s+new-(?:system|page)="yes"/g, '$1').replace(/(<print\b[^>]*?)\s+new-(?:system|page)="yes"/g, '$1');
  }

  const API = { depliderReprises, injectFingerings, keyboardRange, retime, parseMidi, parseMusicXml, parseMxl, parseMscz, msczToMusicXml, parseXml, loadSong, makeTimeline, unzip };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PianoCore = API;
})(typeof self !== 'undefined' ? self : this);
