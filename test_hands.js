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
  console.log(`\n${n} tests passés`);
})();
