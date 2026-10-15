/* Tests des mains virtuelles (hands.js).  Usage : node test_hands.js */
const assert = require('assert'), fs = require('fs');
const H = require('./hands.js'), C = require('./core.js');
let n = 0;
async function t(name, fn) { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.log('ÉCHEC ' + name + '\n' + e.stack); process.exitCode = 1; } }
const mk = (midis, step = 0.25, dur = 0.22, t0 = 0) => midis.map((m, i) => ({ midi: m, t0: t0 + i * step, t1: t0 + i * step + dur }));
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, a + ' ≠ ' + b);

(async () => {
  await t('Accords de la main gauche : un accord qui couvre une octave (ré3 – fa♯3 – ré4) se joue 5 … 1, jamais 3-2-1 ni 4-3-1 (les accords voisins ne doivent pas fausser le choix)', () => {
    const ch = (t0, ms) => ms.map(m => ({ midi: m, t0, t1: t0 + 0.9 }));
    const ns = [].concat(ch(0, [47, 52, 56]), ch(1, [45, 49, 52, 55]), ch(2, [50, 54, 62]), ch(3.7, [45, 49, 52, 55]));
    H.assignFingerings(ns, 'L');
    const at = (t0, m) => ns.find(n => n.t0 === t0 && n.midi === m).af;
    assert.strictEqual(at(2, 50), 5, 'ré3 au 5'); assert.strictEqual(at(2, 62), 1, 'ré4 au pouce'); assert.ok(at(2, 54) >= 2 && at(2, 54) <= 4);
    assert.strictEqual(at(1, 45), 5); assert.strictEqual(at(1, 55), 1);
  });
  await t('Export de la partition : le fichier MusicXML d\'origine revient identique, aux doigtés près ; relu, chaque note porte le doigt affiché', async () => {
    const strip = x => x.replace(/<!--seb-roulpiano:mains-par-serie-->/, '').replace(/(<print\b[^>]*?)\s+new-(?:system|page)="yes"/g, '$1').replace(/<fingering\b[^>]*>[^<]*<\/fingering>/g, '').replace(/<technical>\s*<\/technical>/g, '').replace(/<notations>\s*<\/notations>/g, '');
    for (const fn of ['exemple.musicxml', 'exemple-tabac.musicxml', 'exemple-goldberg.musicxml']) {
      const src = fs.readFileSync(__dirname + '/' + fn), s = await C.loadSong(fn, src);
      ['L', 'R'].forEach(h => H.assignFingerings(s.notes.filter(n => (n.hand || 'R') === h), h));
      const shown = n => n.finger || n.af || 0;
      const xml = C.injectFingerings(s, n => ({ f: shown(n), f2: n.finger2 || 0, hand: '' }));
      assert.strictEqual(strip(xml), strip(src.toString()), fn + ' : autre chose que les doigtés a changé');
      const s2 = await C.loadSong(fn, Buffer.from(xml)); assert.strictEqual(s2.notes.length, s.notes.length, fn + ' : nombre de notes');
      const key = n => n.tick + ':' + n.midi + ':' + n.staff + ':' + n.voice, m2 = new Map(s2.notes.map(n => [key(n), n]));
      s.notes.forEach(n => { const o = m2.get(key(n)); assert.ok(o, fn + ' : note perdue ' + key(n)); assert.strictEqual(o.dur, n.dur, fn + ' : durée'); if (shown(n)) assert.strictEqual(o.finger, shown(n), fn + ' : doigt relu ' + key(n)); assert.strictEqual(o.hand, n.hand, fn + ' : main relue ' + key(n)); });
    }
    assert.ok(!/new-(system|page)="yes"/.test(C.injectFingerings(await C.loadSong('b.musicxml', Buffer.from('<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure><measure number="2"><print new-system="yes"><system-layout/></print><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>')), n => ({ f: 2 }))), 'sauts de ligne forcés retirés');
    const mini = '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>' +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><fingering>3</fingering></technical></notations><lyric><text>la</text></lyric></note>' +
      '<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><lyric><text>fa</text></lyric></note></measure></part></score-partwise>';
    const ms = await C.loadSong('m.musicxml', Buffer.from(mini));
    ms.notes[0].fh = 'L'; const fx = C.injectFingerings(ms, n => ({ f: [1, 2, 4, 5][n.srcIdx], f2: n.srcIdx === 3 ? 1 : 0 }));
    const m2 = await C.loadSong('m.musicxml', Buffer.from(fx)); assert.deepStrictEqual(m2.notes.map(n => n.finger), [1, 2, 4, 5]); assert.strictEqual(m2.notes[0].hand, 'L', 'main écrite « MG1 » relue'); assert.deepStrictEqual(m2.notes.map(n => n.hand), ['L', 'R', 'R', 'R'], 'retour à la main de la portée : étiquette sur la première note de la nouvelle série');
    assert.ok(/<notations><technical><fingering>5<\/fingering><fingering substitution="yes">1<\/fingering><\/technical><\/notations><lyric>/.test(fx), 'notations placées avant les paroles');
    assert.ok(!/<fingering>3<\/fingering>/.test(fx), 'l\'ancien doigt est remplacé');
    // seule la version courante est exportée : un doigté du fichier que l'on a effacé disparaît, une suite de note liée perd son doigté d'origine
    const tied = mini.replace('<step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><fingering>3', '<step>E</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><type>quarter</type><notations><technical><fingering>3').replace('</measure>', '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/><technical><fingering>2</fingering></technical></notations></note></measure>');
    const ts = await C.loadSong('t.musicxml', Buffer.from(tied)); assert.strictEqual(ts.notes.length, 4, 'la note liée est bien fusionnée');
    const f0 = C.injectFingerings(ts, n => ({ f: n.srcIdx === 0 ? 4 : 0, f2: 0, hand: '' }));   // 3 effacé, tout le reste sans doigté
    assert.ok(!/<fingering>3<\/fingering>/.test(f0) && !/<fingering>2<\/fingering>/.test(f0), 'doigté effacé et doigté de la note liée retirés');
    assert.strictEqual((f0.match(/<fingering/g) || []).length, 1, 'un seul doigté exporté : ' + (f0.match(/<fingering[^>]*>[^<]*/g) || []).join(' '));
  });
  await t('Numérotation des mesures : une anacrouse porte le numéro 0 et le comptage commence à la première mesure complète (Goldberg : 0, 1, 2…, 17) ; sans anacrouse, 1, 2, 3…', async () => {
    const lab = async fn => (await C.loadSong(fn, fs.readFileSync(__dirname + '/' + fn))).measures.map(m => m.label);
    const g = await lab('exemple-goldberg.musicxml'); assert.strictEqual(g[0], '0'); assert.strictEqual(g[1], '1'); assert.strictEqual(g[g.length - 1], String(g.length - 1));
    const e = await lab('exemple.musicxml'); assert.strictEqual(e[0], '0'); assert.strictEqual(e[1], '1');
    const tb = await lab('exemple-tabac.musicxml'); assert.strictEqual(tb[0], '0'); assert.strictEqual(tb[1], '1');
    if (fs.existsSync(__dirname + '/partition.musicxml')) { const p = await lab('partition.musicxml'); assert.strictEqual(p[0], '1'); }
  });
  await t('Copie de doigtés sans contrainte : mêmes doigts note après note, sur une autre hauteur, une autre main, un autre rythme ou des accords', () => {
    const mk2 = (midis, t0, hand = 'R', step = 480) => midis.map((m, i) => ({ midi: m, tick: t0 + i * step, hand }));
    const a = mk2([60, 64, 67, 72], 0), b = mk2([65, 69, 72, 77], 4000), g = mk2([48, 52, 55, 60], 8000, 'L', 240), d = mk2([60, 64, 62, 72], 12000), e = mk2([60, 64, 67], 16000);
    [1, 2, 3, 5].forEach((f, i) => { a[i].finger = f; });
    const all = a.concat(b, g, d, e), opt = { hand: n => n.hand, shown: n => n.finger || 0 }, run = (start, src = a) => H.pasteFingerings(all, src, start, opt);
    let r = run(b[0]); assert.deepStrictEqual(r.pairs.map(p => [p.n, p.f]), b.map((n, i) => [n, [1, 2, 3, 5][i]]), 'autre hauteur');
    r = run(g[0]); assert.deepStrictEqual(r.pairs.map(p => [p.n, p.f]), g.map((n, i) => [n, [1, 2, 3, 5][i]]), 'autre main, autre rythme'); assert.strictEqual(r.fromHand, 'R'); assert.strictEqual(r.toHand, 'L'); assert.strictEqual(r.stop, null);
    r = run(d[0]); assert.deepStrictEqual(r.pairs.map(p => p.f), [1, 2, 3, 5], 'un mouvement différent ne bloque pas');
    r = run(e[0]); assert.deepStrictEqual(r.pairs.map(p => p.f), [1, 2, 3]); assert.ok(/assez de notes/.test(r.stop), 'fin des notes de la main');
    const ch = [{ midi: 48, tick: 0, hand: 'L', finger: 5 }, { midi: 55, tick: 0, hand: 'L', finger: 1 }, { midi: 50, tick: 960, hand: 'L' }, { midi: 57, tick: 960, hand: 'L' }, { midi: 52, tick: 1920, hand: 'L' }, { midi: 59, tick: 1920, hand: 'L' }];
    r = H.pasteFingerings(ch, ch.slice(0, 2), ch[2], opt); assert.deepStrictEqual(r.pairs.map(p => [p.n.midi, p.f]), [[50, 5], [57, 1]], 'accord sur accord');
    r = H.pasteFingerings(ch, ch.slice(0, 2), [b[0], b[1]], opt); assert.deepStrictEqual(r.pairs.map(p => p.f), [5, 1], 'destination choisie à la main : deux notes seules, mêmes doigts dans l\'ordre');
    assert.strictEqual(H.pasteFingerings(ch, a, [], opt).pairs.length, 0);
  });
  await t('Main écrite seulement au début d\'une série (export) et prolongée aux notes suivantes de la même portée (toutes voix, toutes mesures) tant que les hampes gardent le même sens ; le fichier exporté porte un repère, les fichiers d\'une autre origine gardent la règle prudente (voix et mesure)', async () => {
    const note = (m, stem, voice = 1) => '<note><pitch><step>' + m + '</step><octave>4</octave></pitch><duration>1</duration><voice>' + voice + '</voice><type>quarter</type>' + (stem ? '<stem>' + stem + '</stem>' : '') + '</note>';
    const doc = (...measures) => '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">' + measures.map((m, i) => '<measure number="' + (i + 1) + '">' + (i ? '' : '<attributes><divisions>1</divisions></attributes>') + m + '</measure>').join('') + '</part></score-partwise>';
    const sg = await C.loadSong('s.musicxml', Buffer.from(doc(['C', 'D', 'E', 'F', 'G', 'A'].map(m => note(m, '')).join(''))));
    [1, 2, 3].forEach(i => { sg.notes[i].fh = 'L'; });   // notes 1 à 3 : main gauche, alors que la lecture du fichier donne la droite
    const xml = C.injectFingerings(sg, n => ({ f: [1, 2, 3, 4, 5, 1][n.srcIdx] }));
    const labs = x => (x.match(/<fingering>([^<]*)<\/fingering>/g) || []).map(y => y.replace(/<\/?fingering>/g, ''));
    assert.deepStrictEqual(labs(xml), ['1', 'MG2', '3', '4', 'MD5', '1'], 'étiquettes : ' + labs(xml).join(' '));
    const r = await C.loadSong('s.musicxml', Buffer.from(xml));
    assert.deepStrictEqual(r.notes.map(n => n.hand), ['R', 'L', 'L', 'L', 'R', 'R'], 'mains relues : la série de MG se prolonge, MD la referme');
    assert.strictEqual(C.injectFingerings(r, n => ({ f: n.finger })), xml, 'export / import / export stable');
    // le sens des hampes change : la série s'arrête (retour à la main de la portée) ; un changement de mesure ou de voix ne l'arrête pas
    const sh = await C.loadSong('h.musicxml', Buffer.from(doc(note('C', 'up') + note('D', 'up') + note('E', 'down') + note('F', 'down'), note('G', 'down'))));
    [0, 1, 2, 3, 4].forEach(i => { sh.notes[i].fh = 'L'; });
    const xh = C.injectFingerings(sh, n => ({ f: n.srcIdx + 1 }));
    assert.deepStrictEqual(labs(xh), ['MG1', '2', 'MG3', '4', '5'], 'une étiquette par série (sens des hampes), la mesure suivante ne coupe pas : ' + labs(xh).join(' '));
    const rh = await C.loadSong('h.musicxml', Buffer.from(xh)); assert.deepStrictEqual(rh.notes.map(n => n.hand), ['L', 'L', 'L', 'L', 'L']);
    const un = await C.loadSong('u.musicxml', Buffer.from(xh.replace('<fingering>MG3</fingering>', '<fingering>3</fingering>')));
    assert.deepStrictEqual(un.notes.map(n => n.hand), ['L', 'L', 'R', 'R', 'R'], 'sans indication, le changement de hampes ramène à la main de la portée ; la mesure suivante garde la série');
    // deux voix sur la même portée : une seule étiquette pour toute la série
    const vv = await C.loadSong('v.musicxml', Buffer.from(doc(note('C', 'up', 1) + note('D', 'up', 1) + note('E', 'up', 2) + note('F', 'up', 2), note('G', 'up', 1))));
    vv.notes.forEach(n => { n.fh = 'L'; });
    const xv = C.injectFingerings(vv, n => ({ f: n.srcIdx + 1 }));
    assert.deepStrictEqual(labs(xv), ['MG1', '2', '3', '4', '5'], 'une seule étiquette, quelle que soit la voix ou la mesure : ' + labs(xv).join(' '));
    assert.deepStrictEqual((await C.loadSong('v.musicxml', Buffer.from(xv))).notes.map(n => n.hand), ['L', 'L', 'L', 'L', 'L']);
    assert.strictEqual((xv.match(/seb-roulpiano:mains-par-serie/g) || []).length, 1); assert.strictEqual((C.injectFingerings(await C.loadSong('v.musicxml', Buffer.from(xv)), n => ({ f: n.finger })).match(/seb-roulpiano:mains-par-serie/g) || []).length, 1, 'repère non dupliqué');
    // un silence interrompt la série : la main est redite à la reprise
    const rest = '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>';
    const sr = await C.loadSong('r.musicxml', Buffer.from(doc(note('C', 'up') + note('D', 'up') + rest + note('E', 'up') + note('F', 'up'))));
    sr.notes.forEach(n => { n.fh = 'L'; });
    const xr = C.injectFingerings(sr, n => ({ f: n.srcIdx > 2 ? n.srcIdx : n.srcIdx + 1 }));
    assert.deepStrictEqual(labs(xr), ['MG1', '2', 'MG3', '4'], 'MG redit après le silence : ' + labs(xr).join(' '));
    assert.deepStrictEqual((await C.loadSong('r.musicxml', Buffer.from(xr))).notes.map(n => n.hand), ['L', 'L', 'L', 'L']);
    // fichier d'une autre origine (sans repère) : règle prudente, la mesure suivante coupe la série
    const ex = await C.loadSong('x.musicxml', Buffer.from(doc(note('C', 'up').replace('<type>quarter</type>', '<type>quarter</type><notations><technical><fingering>MG1</fingering></technical></notations>') + note('D', 'up'), note('E', 'up'))));
    assert.deepStrictEqual(ex.notes.map(n => n.hand), ['L', 'L', 'R'], 'sans repère : la série s\'arrête à la mesure');
  });
  await t('Gamme de do montante à la main droite : le pouce passe sous la main (après 3 ou 4), jamais plus de 5 doigts distincts', () => {
    const ns = mk([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]); H.assignFingerings(ns, 'R');
    const f = ns.map(x => x.af); assert.ok(f.every(x => x >= 1 && x <= 5), f.join(''));
    assert.strictEqual(f[0], 1);
    for (let i = 1; i < f.length; i++) if (f[i] === 1) assert.ok(f[i - 1] === 3 || f[i - 1] === 4, 'pouce après ' + f[i - 1] + ' en position ' + i);
    assert.ok(f.filter(x => x === 1).length >= 2, 'au moins un passage du pouce : ' + f.join(''));
  });
  await t('Le pouce évite les touches noires : gammes de ré♭ majeur (doigté classique 2 3 1 2 3 4 1 2) et de si♭ majeur montantes à la main droite', () => {
    const run = ms => { const ns = mk(ms); H.assignFingerings(ns, 'R'); return ns; };
    const d = run([61, 63, 65, 66, 68, 70, 72, 73]); assert.strictEqual(d.map(x => x.af).join(''), '23123412', d.map(x => x.af).join(''));
    const b = run([58, 60, 62, 63, 65, 67, 69, 70, 72]); assert.strictEqual(b.filter(x => x.af === 1 && H.isBlack(x.midi)).length, 0, b.map(x => x.af).join(''));
  });
  await t('Enchaînement : on lâche la touche jouée juste avant d\'en frapper une autre (hors accord et hors note tenue)', () => {
    const fp = (ns, hand = 'R') => H.buildPlan(ns, hand);
    const a = [{ midi: 60, t0: 0, t1: 0.5, finger: 3 }, { midi: 62, t0: 0.5, t1: 1, finger: 2 }];   // fin et début simultanés dans le fichier
    const p = fp(a); assert.ok(p.finger(3, 0.05).pressed, 'doigt 3 posé'); assert.ok(!p.finger(3, 0.49).pressed, 'doigt 3 déjà lâché à 0,49 s'); assert.ok(p.finger(2, 0.51).pressed, 'doigt 2 posé à 0,51 s');
    const c = fp([{ midi: 60, t0: 0, t1: 1, finger: 1 }, { midi: 64, t0: 0, t1: 1, finger: 3 }]);   // accord : les deux restent posés
    assert.ok(c.finger(1, 0.9).pressed && c.finger(3, 0.9).pressed, 'accord');
    const h = fp([{ midi: 60, t0: 0, t1: 2, finger: 1 }, { midi: 64, t0: 0.5, t1: 1, finger: 3 }]);   // note tenue : le doigt 1 reste posé
    assert.ok(h.finger(1, 0.9).pressed && h.finger(1, 1.5).pressed, 'note tenue');
  });
  await t('Gestes remarquables : passage du pouce, saut de position, changement de doigt ; événements et noms d\'intervalles', () => {
    const ns = mk([60, 62, 64, 65, 67], 0.5, 0.45); [1, 2, 3, 1, 2].forEach((f, i) => { ns[i].finger = f; });
    const p = H.buildPlan(ns, 'R'); assert.strictEqual(p.events.length, 5);
    assert.ok(p.gestures.some(g => g.label === 'Pouce sous la main' && Math.abs(g.t - 1.5) < 1e-6), JSON.stringify(p.gestures));
    assert.strictEqual(p.nextEvent(0.6).t, 1.0); assert.strictEqual(p.nextEvent(2.0), null);
    const j = H.buildPlan([{ midi: 48, t0: 0, t1: 0.4, finger: 1 }, { midi: 72, t0: 0.5, t1: 0.9, finger: 5 }], 'R');
    assert.ok(j.gestures.some(g => g.label === 'Saut de position'), JSON.stringify(j.gestures));
    const c = H.buildPlan([{ midi: 60, t0: 0, t1: 1, finger: 3, finger2: 1 }], 'R'); assert.ok(c.gestures.some(g => g.label === 'Changement de doigt'));
    assert.strictEqual(H.intervalName(4), '↑ 3ce majeure'); assert.strictEqual(H.intervalName(-7), '↓ 5te'); assert.strictEqual(H.intervalName(0), 'même note'); assert.strictEqual(H.intervalName(12), '↑ octave'); assert.strictEqual(H.intervalName(-17), '↓ octave + 4te'); assert.strictEqual(H.intervalName(24), '↑ 2 octaves');
  });
  await t('Gamme descendante à la main gauche : image miroir de la main droite (pouce sur la note la plus haute)', () => {
    const ns = mk([60, 59, 57, 55, 53, 52, 50, 48]); H.assignFingerings(ns, 'L');
    const f = ns.map(x => x.af); assert.strictEqual(f[0], 1, f.join('')); for (let i = 1; i < f.length; i++) if (f[i] === 1) assert.ok(f[i - 1] === 3 || f[i - 1] === 4, f.join('')); // 1 2 3 1 2 3 … : image miroir de la main droite
  });
  await t('Les doigtés imposés (fichier ou saisis) sont respectés, les autres s\'y adaptent', () => {
    const ns = mk([60, 62, 64, 65, 67]); ns[0].finger = 2; ns[4].finger = 5; H.assignFingerings(ns, 'R');
    assert.strictEqual(ns[0].af, 2); assert.strictEqual(ns[4].af, 5); assert.ok(ns.every(x => x.af >= 1));
  });
  await t('Un accord de 3 notes reçoit 3 doigts distincts dans l\'ordre (main droite : grave = petit numéro)', () => {
    const ns = [60, 64, 67].map(m => ({ midi: m, t0: 0, t1: 1 })); H.assignFingerings(ns, 'R');
    const f = ns.map(x => x.af); assert.deepStrictEqual(f.slice().sort(), f.slice().sort()); assert.ok(f[0] < f[1] && f[1] < f[2], f.join(''));
    const l = [48, 52, 55].map(m => ({ midi: m, t0: 0, t1: 1 })); H.assignFingerings(l, 'L'); assert.ok(l[0].af > l[1].af && l[1].af > l[2].af);
  });
  await t('Un doigt qui tient une touche n\'en joue pas une autre en même temps', () => {
    const ns = [{ midi: 48, t0: 0, t1: 4 }, ...mk([60, 62, 64, 65, 67], 0.5, 0.4, 0.2)]; H.assignFingerings(ns, 'R');
    const held = ns[0].af; assert.ok(ns.slice(1).every(x => x.af !== held), 'doigts : ' + ns.map(x => x.af).join(''));
  });
  await t('Passage du pouce : le pouce se déplace avant sa note, la paume suit, sans saut', () => {
    const ns = mk([60, 62, 64, 65], 0.5, 0.45); ns.forEach((x, i) => { x.finger = [1, 2, 3, 1][i]; });
    const p = H.buildPlan(ns, 'R'), th = t => p.finger(1, t).x;
    const u = H.ux, tgt = u(65);
    assert.ok(Math.abs(th(1.5 - 0.15) - tgt) < Math.abs(th(1.5 - 0.5) - tgt), 'le pouce s\'approche');
    near(th(1.5), tgt); assert.ok(p.finger(1, 1.5).pressed);
    let prev = p.palm(0), maxJ = 0; for (let x = 0; x < 3; x += 1 / 60) { const q = p.palm(x); maxJ = Math.max(maxJ, Math.abs(q - prev)); prev = q; }
    assert.ok(maxJ < 0.35, 'saut de paume ' + maxJ);
    assert.ok(p.palm0(2.5) > p.palm0(0) + 1, 'la main s\'est déplacée après le passage');
  });
  await t('Changement de doigt sur la même touche : deux doigts se partagent la touche, avec un instant de recouvrement', () => {
    const ns = [{ midi: 64, t0: 0, t1: 2, finger: 3, finger2: 1 }]; const p = H.buildPlan(ns, 'R');
    assert.ok(p.finger(3, 0.2).pressed && !p.finger(1, 0.2).pressed);
    assert.ok(p.finger(1, 1.8).pressed && !p.finger(3, 1.8).pressed);
    const both = []; for (let x = 0; x < 2; x += 0.01) if (p.finger(3, x).pressed && p.finger(1, x).pressed) both.push(x); assert.ok(both.length > 3, 'recouvrement');
    near(p.finger(1, 1.8).x, H.ux(64));
  });
  await t('Même touche répétée avec des doigts différents (3 puis 2) : chaque doigt frappe la même touche', () => {
    const ns = [{ midi: 64, t0: 0, t1: 0.3, finger: 3 }, { midi: 64, t0: 0.5, t1: 0.8, finger: 2 }]; const p = H.buildPlan(ns, 'R');
    near(p.finger(3, 0.1).x, p.finger(2, 0.6).x); assert.ok(p.finger(2, 0.6).pressed && !p.finger(3, 0.6).pressed);
  });
  await t('Mains croisées : les deux plans sont indépendants (la main gauche peut être à droite de la main droite) et la plus active passe devant', () => {
    const R = mk([60, 62], 1, 0.9), L = mk([72, 74], 1, 0.9, 2.5); R.forEach(x => { x.finger = 3; }); L.forEach(x => { x.finger = 3; });
    const pr = H.buildPlan(R, 'R'), pl = H.buildPlan(L, 'L');
    assert.ok(pl.palm0(3) > pr.palm0(3) + 5, 'main gauche à droite de la droite');
    assert.ok(pl.near(3) < pr.near(3), 'la gauche joue, la droite se repose');
  });
  await t('Arpège de 4 notes : main droite 1-2-3-5 (grave → aigu), main gauche 5-3-2-1, dans les deux sens', () => {
    const asc = () => [{ midi: 47, t0: 0, t1: 0.2 }, { midi: 50, t0: 0.25, t1: 0.45 }, { midi: 55, t0: 0.5, t1: 0.7 }, { midi: 59, t0: 0.75, t1: 0.95 }];
    const run = (ns, h) => { H.assignFingerings(ns, h); return ns.map(x => x.af).join(''); };
    assert.strictEqual(run(asc(), 'R'), '1235'); assert.strictEqual(run(asc().reverse().map((x, i) => ({ ...x, t0: i * 0.25, t1: i * 0.25 + 0.2 })), 'R'), '5321');
    assert.strictEqual(run(asc(), 'L'), '5321'); assert.strictEqual(run(asc().reverse().map((x, i) => ({ ...x, t0: i * 0.25, t1: i * 0.25 + 0.2 })), 'L'), '1235');
    const g = asc(); g[1].finger = 4; assert.notStrictEqual(run(g, 'R'), '1235', 'un doigté imposé désactive la règle');
  });
  await t('Une main qui ne joue pas revient à sa position normale : la droite à droite de la gauche, la gauche à gauche de la droite', () => {
    const R = mk([60, 62], 0.5, 0.4), L = mk([72, 74], 4, 0.4); R.forEach(x => { x.finger = 3; }); L.forEach(x => { x.finger = 3; });
    const pr = H.buildPlan(R, 'R'), pl = H.buildPlan(L, 'L'); pr.link(pl); pl.link(pr);
    assert.ok(pr.palm(4.2) > pl.palm(4.2) + 5, 'la droite au repos doit être à droite de la gauche qui joue : ' + pr.palm(4.2) + ' / ' + pl.palm(4.2));
    assert.ok(pl.palm(1.5) < pr.palm(1.5) - 5, 'la gauche au repos doit être à gauche de la droite');
    near(pr.palm(0.55), pr.palm0(0.55));
  });
  await t('Goldberg (exemple) : toutes les notes ont un doigt, aucun doigt ne saute de plus de 3 touches par image à 60 i/s', async () => {
    const s = await C.loadSong('g.musicxml', fs.readFileSync(__dirname + '/exemple-goldberg.musicxml'));
    ['R', 'L'].forEach(h => {
      const ns = s.notes.filter(x => x.hand === h); H.assignFingerings(ns, h);
      assert.ok(ns.every(x => x.finger || x.af), 'notes sans doigt');
      assert.ok(ns.filter(x => x.finger).every(x => (x.finger || x.af) === x.finger), 'doigtés du fichier respectés');
      const p = H.buildPlan(ns, h); let prev = null, maxJ = 0;
      for (let x = -1; x < s.durationSec; x += 1 / 60) { const a = p.at(x); if (prev) a.fingers.forEach((f, i) => { maxJ = Math.max(maxJ, Math.abs(f.x - prev.fingers[i].x)); }); prev = a; }
      assert.ok(maxJ < 3, h + ' saut ' + maxJ.toFixed(2));
    });
  });

  // ---------- Non-croisement des doigts (2D et 3D) : ne doit plus jamais revenir ----------
  await t('enforceFingerOrder : un doigt qui joue ne bouge pas, ses voisins s\'écartent ; jamais de croisement (hors deux doigts qui jouent ensemble)', () => {
    const xs = [0, 10, 10.1, 10.2, 10.3], pin = [false, false, true, false, false]; H.enforceFingerOrder(xs, pin, 1, 0.62);
    near(xs[2], 10.1); for (let i = 1; i < 4; i++) assert.ok(xs[i + 1] - xs[i] >= 0.62 - 1e-9, 'écart ' + i);
    const xl = [0, -10, -9.9, -10.5, -10.6], pl = [false, false, false, true, false]; H.enforceFingerOrder(xl, pl, -1, 0.62);
    for (let i = 1; i < 4; i++) assert.ok(-(xl[i + 1] - xl[i]) >= 0.62 - 1e-9, 'main gauche, écart ' + i);
  });
  const croisements = (notesByHand, dur) => { let bad = 0;
    ['R', 'L'].forEach(h => { const ns = notesByHand.filter(x => x.hand === h); if (!ns.length) return; H.assignFingerings(ns, h); const p = H.buildPlan(ns, h), sg = h === 'R' ? 1 : -1;
      for (let x = -1; x < dur; x += 0.05) { const a = p.at(x), xs = a.fingers.map(f => f.x), pin = a.fingers.map(f => !!f.pressed || (f.depth || 0) > 0.6 || (f.wN || 0) > 0.85);
        H.enforceFingerOrder(xs, pin, sg, H.FINGER_GAP); for (let i = 1; i < 4; i++) if (sg * (xs[i + 1] - xs[i]) < 0 && !(pin[i] && pin[i + 1])) bad++; } });
    return bad; };
  const exemples = [['exemple.musicxml', 'Élise'], ['exemple-tabac.musicxml', 'J\'ai du bon tabac'], ['partition.musicxml', 'Dorian']];
  for (const [fn, nm] of exemples) {
    if (!fs.existsSync(__dirname + '/' + fn)) continue;
    await t(nm + ' : aucun croisement de doigts dans le dessin (règle de non-croisement appliquée au plan)', async () => {
      const s = await C.loadSong(fn, fs.readFileSync(__dirname + '/' + fn)); assert.strictEqual(croisements(s.notes, s.durationSec), 0, 'des doigts se croisent');
    });
  }
  await t('La règle de non-croisement est bien appelée par le dessin 2D et par la vue 3D (aucune copie locale)', () => {
    const tpl = fs.readFileSync(__dirname + '/index.template.html', 'utf8'), v3 = fs.readFileSync(__dirname + '/view3d.js', 'utf8');
    const g = tpl.slice(tpl.indexOf('function handGeometry'), tpl.indexOf('function drawHand('));
    assert.ok(g.includes('PianoHands.enforceFingerOrder'), 'handGeometry (2D) doit appeler PianoHands.enforceFingerOrder');
    assert.ok(v3.includes('PianoHands.enforceFingerOrder'), 'view3d.js doit appeler PianoHands.enforceFingerOrder');
  });
  await t('Doigtés conjoints, main immobile : do ré mi fa sol (main droite) = 1 2 3 4 5, quel que soit l\'ordre des notes ; sol → fa = 5 → 4', () => {
    const seq = [67, 65, 64, 62, 60, 62, 64, 65, 67, 67, 65, 64, 60];   // sol fa mi ré do ré mi fa sol sol fa mi do : l'empan (do–sol) tient dans la main
    const ns = mk(seq, 0.4); H.assignFingerings(ns, 'R');
    const want = { 60: 1, 62: 2, 64: 3, 65: 4, 67: 5 };
    ns.forEach(n => assert.strictEqual(n.af, want[n.midi], 'midi ' + n.midi + ' doit être au doigt ' + want[n.midi] + ', obtenu ' + n.af));
    const withImposed = mk([64, 62, 64, 65, 67], 0.4); withImposed[0].finger = 3; withImposed[4].finger = 5; H.assignFingerings(withImposed, 'R');
    assert.deepStrictEqual(withImposed.map(n => n.finger || n.af), [3, 2, 3, 4, 5], 'mi[3] ré mi fa sol[5] : la main ne bouge pas');
  });
  await t('Doigtés conjoints, main gauche : sol la si do ré = 5 4 3 2 1 ; et début de la Lettre à Élise = 5 4 5 4 5 1 3 2 1', () => {
    const lh = mk([55, 57, 59, 60, 62], 0.4); H.assignFingerings(lh, 'L');
    assert.deepStrictEqual(lh.map(n => n.af), [5, 4, 3, 2, 1]);
    const el = mk([76, 75, 76, 75, 76, 71, 74, 72, 69], 0.25); H.assignFingerings(el, 'R');
    assert.deepStrictEqual(el.slice(0, 5).map(n => n.af), [5, 4, 5, 4, 5], 'mi ré♯ mi ré♯ mi aux doigts 5 4 5 4 5');
  });
  await t('Passage du pouce : une gamme de do majeur montante (main droite) passe le pouce après le 3 (1 2 3 1 2 3 4 5), puis les doigts redeviennent conjoints', () => {
    const sc = mk([60, 62, 64, 65, 67, 69, 71, 72], 0.3); H.assignFingerings(sc, 'R');
    assert.deepStrictEqual(sc.map(n => n.af), [1, 2, 3, 1, 2, 3, 4, 5]);
  });
  await t('Goldberg (exemple), main gauche mesure 1 : 5 4 3 2 (4+1) 2 1 2 3 2 — sol la si do, puis fa♯[4] tenu + ré au pouce, do 2, si 1, la 2, sol 3, la 2', async () => {
    const s = await C.loadSong('g.musicxml', fs.readFileSync(__dirname + '/exemple-goldberg.musicxml'));
    ['L', 'R'].forEach(h => H.assignFingerings(s.notes.filter(n => (n.hand || 'R') === h), h));
    const m = s.measures.find(x => x.label === '1'), ns = s.notes.filter(n => (n.fh || n.hand || 'R') === 'L' && n.voice === 5 && n.tick >= m.startTick && n.tick < m.startTick + m.lenTick).sort((a, b) => a.tick - b.tick);
    const f = ns.map(n => n.finger || n.af);
    assert.deepStrictEqual(f.slice(1), [4, 3, 2, 1, 2, 1, 2, 3, 2], 'la si do ré do si la sol la : ' + f.join(' '));
  });
  await t('Aucune contrainte d\'empan : doigts consécutifs même pour une tierce (la do mi la si, main droite : do 1, mi 2) ; quand tout tient dans la main, un doigt par touche (mi do = 3 1)', () => {
    const free = mk([69, 60, 64, 69, 71], 0.5); H.assignFingerings(free, 'R');
    assert.strictEqual(free[1].af, 1, 'do au pouce'); assert.strictEqual(free[2].af, 2, 'mi au 2');
    const fixed = mk([64, 64, 60, 62, 64, 60], 0.4); H.assignFingerings(fixed, 'R');
    assert.deepStrictEqual(fixed.map(n => n.af), [3, 3, 1, 2, 3, 1], 'mi mi do ré mi do : la main ne bouge pas');
  });
  await t('Début de phrase après un silence : la main se déplace puis reprend sa position naturelle (main droite, phrase qui monte : premier doigt au pouce) — Élise mesure 2 : do 1, mi 2', () => {
    const N = (m, t0, t1) => ({ midi: m, t0, t1 }), ns = [N(72, 1.75, 2), N(69, 2, 2.5), N(60, 2.75, 3), N(64, 3, 3.25), N(69, 3.25, 3.5), N(71, 3.5, 4)];
    H.assignFingerings(ns, 'R');
    assert.strictEqual(ns[2].af, 1, 'do (début de phrase qui monte) au pouce'); assert.strictEqual(ns[3].af, 2, 'mi au 2');
    const lh = [N(55, 0, 0.5), N(57, 0.5, 1)]; H.assignFingerings(lh, 'L'); assert.strictEqual(lh[0].af, 5, 'main gauche, phrase qui monte : départ au 5');
  });
  console.log(`\n${n} tests passés`);
})();
