/* Tests des mains virtuelles (hands.js).  Usage : node test_hands.js */
const assert = require('assert'), fs = require('fs');
const H = require('./hands.js'), C = require('./core.js');
let n = 0;
async function t(name, fn) { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.log('ÉCHEC ' + name + '\n' + e.stack); process.exitCode = 1; } }
const mk = (midis, step = 0.25, dur = 0.22, t0 = 0) => midis.map((m, i) => ({ midi: m, t0: t0 + i * step, t1: t0 + i * step + dur }));
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, a + ' ≠ ' + b);

(async () => {
  await t('Gamme de do montante à la main droite : le pouce passe sous la main (après 3 ou 4), jamais plus de 5 doigts distincts', () => {
    const ns = mk([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]); H.assignFingerings(ns, 'R');
    const f = ns.map(x => x.af); assert.ok(f.every(x => x >= 1 && x <= 5), f.join(''));
    assert.strictEqual(f[0], 1);
    for (let i = 1; i < f.length; i++) if (f[i] === 1) assert.ok(f[i - 1] === 3 || f[i - 1] === 4, 'pouce après ' + f[i - 1] + ' en position ' + i);
    assert.ok(f.filter(x => x === 1).length >= 2, 'au moins un passage du pouce : ' + f.join(''));
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
    assert.ok(p.palm(2.5) > p.palm(0) + 1, 'la main s\'est déplacée après le passage');
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
    assert.ok(pl.palm(3) > pr.palm(3) + 5, 'main gauche à droite de la droite');
    assert.ok(pl.near(3) < pr.near(3), 'la gauche joue, la droite se repose');
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
  console.log(`\n${n} tests passés`);
})();
