/* Mains virtuelles : doigtés automatiques + trajectoire des mains et des doigts (sans aucun dessin : tout est testable sous Node).
   Une main est décrite par un « plan » : on lui demande, à n'importe quel instant du morceau, la position de la paume et de chacun des 5 doigts.
   Positions horizontales en « largeurs de touche blanche » absolues (voir ux()). Doigts : 1 = pouce … 5 = auriculaire. Mains : 'R' droite, 'L' gauche. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.PianoHands = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const isBlack = m => BLACK.has(((m % 12) + 12) % 12);
  const WIDX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  // abscisse absolue d'une touche : centre pour une touche blanche, frontière entre les deux blanches voisines pour une noire
  function ux(m) { const o = Math.floor(m / 12), pc = m - o * 12; return o * 7 + (isBlack(m) ? WIDX[pc - 1] + 1 : WIDX[pc] + 0.5); }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

  // ---------- Doigtés automatiques (programmation dynamique, coût inspiré de Parncutt) ----------
  // Tout est ramené à la main droite : q = hauteur (main droite) ou son opposé (main gauche), si bien que « plus aigu » = « doigt de numéro plus grand ».
  const WSKIP = 1.5, WPOS_SAUT = 0.3;   // doigt sauté (sans contrainte d'empan, on prend les doigts consécutifs) ; décalage de position toléré quand les deux notes ne sont pas voisines
  const WPOS = 2.0, WCROIS = 0.6;   // poids du décalage de position de la main (doigts conjoints, main immobile quand l'empan tient dans la main) ; poids, plafonné, du passage du pouce
  // Parncutt : un 3 suivi d'un 4 est une paire peu naturelle (« three-to-four »)
  // Le 2 et le 3 (index et majeur) sont physiologiquement liés : un écart de notes non conjointes (3 demi-tons ou plus) entre eux est coûteux ; le 2 et le 4 sont à l'aise sur cet écart.
  function pairCost(f1, q1, f2, q2) { return pairCost0(f1, q1, f2, q2) + (f1 === 3 && f2 === 4 ? 0.5 : 0) + (((f1 === 2 && f2 === 3) || (f1 === 3 && f2 === 2)) && Math.abs(q2 - q1) >= 3 ? WDEUXTROIS : 0); }
  const WDEUXTROIS = 1.2;
  // Règles de Parncutt et al. 1997 : nombre de changements de position (un point fixe par déplacement de la main, quelle que soit sa taille) et « 3-4-5 » (trois notes de suite jouées par les doigts 3, 4 et 5 : les trois doigts les moins indépendants)
  const WCOUNT = 0.1, W345 = 0.3;   // poids volontairement faibles : plus forts, ils défont des doigtés validés (gamme de do 1 2 3 1 2 3 4 5 contient un 3-4-5 ; mi sol♯ si do = 1 2 4 5)
  // Taille de la main : les écarts confortables entre deux doigts sont multipliés par ce facteur (petite 0,85 ; moyenne 1 ; grande 1,15)
  let HS = 1; function setHandSize(v) { HS = clamp(+v || 1, 0.7, 1.3); } function getHandSize() { return HS; }
  function pairCost0(f1, q1, f2, q2) {
    const dq = q2 - q1, df = f2 - f1, a = Math.abs(dq), m = Math.abs(df);
    if (dq === 0) return f1 === f2 ? 0 : 1;                 // même touche : changer de doigt coûte un peu
    if (df === 0) return 1 + 0.4 * a;                       // même doigt sur une autre touche : saut
    if (df * dq > 0) { const lo = m, hi = (2.2 * m + 1) * HS; return a < lo ? (lo - a) * 0.5 : a > hi ? (a - hi) * 0.9 : 0; } // sens naturel : écart confortable
    const far = a > 8 ? 40 : a > 5 ? (a - 5) * 0.6 : 0;   // passage du pouce : au-delà de huit demi-tons, c'est impossible (le pouce passe sous la main par pas conjoints)
    if (f2 === 1) return ({ 2: 1.6, 3: 0.3, 4: 0.8, 5: 2.5 }[f1] || 3) + far; // le pouce passe sous la main
    if (f1 === 1) return ({ 2: 1.2, 3: 0.3, 4: 0.8, 5: 2.8 }[f2] || 3) + far; // un doigt passe par-dessus le pouce
    return 40 + a * 0.2;                                    // croisement sans le pouce : pratiquement interdit (seul le pouce passe sous / par-dessus)
  }
  const SUBS = {};
  function subsets(k) {
    if (SUBS[k]) return SUBS[k];
    const out = [];
    (function rec(start, cur) { if (cur.length === k) { out.push(cur.slice()); return; } for (let f = start; f <= 5; f++) { cur.push(f); rec(f + 1, cur); cur.pop(); } })(1, []);
    return (SUBS[k] = out);
  }

  // notes : notes d'UNE main {midi, t0, t1, finger?} ; écrit n.af (doigt automatique) pour les notes dont le doigté n'est pas imposé (n.finger)
  function assignFingerings(notes, hand) {
    const sgn = hand === 'L' ? -1 : 1, q = n => sgn * n.midi;
    const sorted = notes.slice().sort((a, b) => a.t0 - b.t0 || a.midi - b.midi);
    notes.forEach(n => { n.af = 0; n.af2 = 0; });
    const ev = [];
    sorted.forEach(n => { const l = ev[ev.length - 1]; if (l && n.t0 - l.t < 0.03) l.all.push(n); else ev.push({ t: n.t0, all: [n] }); });
    // Arpège de 4 notes (quatre notes seules qui montent ou descendent, par intervalles de 3 à 5 demi-tons, sur au plus 14 demi-tons) : le doigté naturel suit la hauteur —
    // main droite 1-2-3-5 de la note la plus grave à la plus aiguë, main gauche 5-3-2-1. Il est imposé aux notes sans doigté (un doigté du fichier reste prioritaire).
    notes.forEach(n => { delete n._arp; });
    for (let i = 0; i + 3 < ev.length; ) {
      const w = ev.slice(i, i + 4), one = w.every(e => e.all.length === 1), m = one ? w.map(e => e.all[0]) : null;
      const iv = m ? [1, 2, 3].map(k => m[k].midi - m[k - 1].midi) : null;
      const up = iv && iv.every(d => d >= 3 && d <= 5), down = iv && iv.every(d => d <= -3 && d >= -5);
      if (m && (up || down) && Math.abs(m[3].midi - m[0].midi) <= 14 && m.every(n => !n.finger) && w.every((e, k) => !k || e.t - w[k - 1].t < 0.9)) {
        const fing = hand === 'L' ? [5, 3, 2, 1] : [1, 2, 3, 5], byPitch = m.slice().sort((x, y) => x.midi - y.midi);
        byPitch.forEach((n, k) => { n._arp = fing[k]; }); i += 4;
      } else i++;
    }
    const imposed = n => n.finger || n._arp || 0;
    // Début de phrase : après un silence assez long (≥ 0,45 s) la main a le temps de se déplacer puis de se remettre dans sa position naturelle : la première note se joue au doigt « de départ »
    // (main droite : 1 si la phrase monte, 5 si elle descend ; main gauche : l'inverse), sans rapport avec le doigt de la note d'avant.
    const SILENCE = 0.45, NATSTART = 0.5, endOf = x => Math.max.apply(null, x.all.map(n => n.t1));
    ev.forEach((e, i) => {
      // début de phrase : un vrai silence, ou un silence plus court mais suivi d'un saut hors de portée de la main (la main est obligée de se déplacer)
      const gap0 = i ? e.t - endOf(ev[i - 1]) : 0, dist = i ? Math.min.apply(null, e.all.map(n => Math.min.apply(null, ev[i - 1].all.map(m => Math.abs(ux(n.midi) - ux(m.midi)))))) : 0;
      e.start = i === 0 || gap0 >= SILENCE || (gap0 >= 0.2 && dist > 4.01);
      if (!e.start) return;
      let j = i; while (j + 1 < ev.length && ev[j + 1].t - endOf(ev[j]) < 0.2 + 0 && j - i < 8) j++;
      const hi = x => Math.max.apply(null, x.all.map(q)), lo = x => Math.min.apply(null, x.all.map(q)); let up = 0, down = 0;
      for (let k = i + 1; k <= j; k++) { up = Math.max(up, hi(ev[k]) - hi(e)); down = Math.max(down, lo(e) - lo(ev[k])); }
      e.dir = up > down ? 1 : down > up ? -1 : 0;
    });
    // Utiliser tout l'empan de la main : une montée (ou descente) de trois notes ou plus, qui dépasse la position fixe (5 touches blanches) mais tient dans la main (au plus 9 demi-tons),
    // commence par le premier doigt « naturel » et finit par le dernier (main droite en montant : 1 … 5 ; en descendant : 5 … 1 ; main gauche : l'inverse).
    const SPANW = 2.0;
    for (let i = 0; i < ev.length; ) {
      if (ev[i].all.length !== 1) { i++; continue; }
      let j = i, d = 0;
      while (j + 1 < ev.length && ev[j + 1].all.length === 1 && ev[j + 1].t - endOf(ev[j]) < SILENCE) { const dd = Math.sign(q(ev[j + 1].all[0]) - q(ev[j].all[0])); if (!dd || (d && dd !== d)) break; d = dd; j++; }
      const sp = Math.abs(q(ev[j].all[0]) - q(ev[i].all[0]));
      if (j - i >= 2 && sp >= 5 && sp <= 9 && Math.abs(ux(ev[j].all[0].midi) - ux(ev[i].all[0].midi)) > 4.01) { ev[i].runFirst = d; ev[j].runLast = d; for (let k = i; k <= j; k++) { ev[k].span = true; ev[k].runK = k - i; ev[k].runM = j - i; } }
      i = j > i ? j : i + 1;
    }
    ev.forEach(e => {
      e.all.sort((a, b) => q(a) - q(b));
      e.ns = e.all.slice(0, 5);                              // au-delà de 5 notes simultanées, les autres restent sans doigt
      e.t1 = Math.max.apply(null, e.all.map(n => n.t1));
      const k = e.ns.length, st = [];
      subsets(k).forEach(S => { if (e.ns.every((n, i) => !imposed(n) || imposed(n) === S[i])) st.push(S); });
      if (!st.length) st.push(e.ns.map(n => imposed(n)));  // doigtés imposés incohérents entre eux : on les garde tels quels
      e.st = st;
      e.own = st.map(S => {
        let c = 0;
        e.ns.forEach((n, i) => {
          const f = S[i]; if (!f) return;
          if (isBlack(n.midi)) c += f === 1 ? 1.0 : f === 5 ? 0.25 : 0; // pouce sur touche noire : court et en retrait, nettement moins confortable
          if (!n.finger) c += f === 4 ? 0.2 : f === 5 ? 0.15 : 0;
          if (e.ns.length === 1 && !n.finger) { if (e.runFirst) c += SPANW * (e.runFirst > 0 ? f - 1 : 5 - f); if (e.runLast) c += SPANW * (e.runLast > 0 ? 5 - f : f - 1); }
          if (e.start && e.ns.length === 1 && !n.finger) c += NATSTART * (e.dir > 0 ? f - 1 : e.dir < 0 ? 5 - f : 0);
          if (i && S[i - 1]) c += pairCost(S[i - 1], q(e.ns[i - 1]), f, q(n));
          for (let j = 0; j < i; j++) { const fj = S[j]; if (!fj || !f) continue; const df = Math.abs(f - fj), span = Math.abs(q(n) - q(e.ns[j])), mx = [0, 5, 7, 9, 12][Math.min(4, df)] * HS + 0.5; if (span > mx) c += 8 * (span - mx); }   // écart maximal confortable entre deux doigts qui jouent ensemble (demi-tons) : une octave se joue 1-5, jamais 3-5
        });
        return c;
      });
    });
    // Notes répétées : n répétitions de suite (repN). Le même doigt est permis sur une note répétée lente ; sur une suite de notes répétées en valeurs courtes, il est interdit.
    ev.forEach((e, i) => { e.repN = i && e.all.length === 1 && ev[i - 1].all.length === 1 && e.all[0].midi === ev[i - 1].all[0].midi ? (ev[i - 1].repN || 0) + 1 : 0; });
    // Les notes voisines (trois événements de chaque côté) tiennent-elles dans l'empan de la main (cinq touches blanches) ? Si oui, la main reste immobile : un doigt par touche, quoi qu'il arrive.
    // Sinon, la main doit se déplacer et on choisit des doigts consécutifs même pour une tierce.
    ev.forEach((e, i) => { let lo = Infinity, hi = -Infinity; for (let j = Math.max(0, i - 3); j <= Math.min(ev.length - 1, i + 3); j++) ev[j].all.forEach(n => { lo = Math.min(lo, ux(n.midi)); hi = Math.max(hi, ux(n.midi)); }); e.fit = hi - lo <= 4.01; });
    if (!ev.length) return;
    let cost = ev[0].own.slice(), back = [];
    for (let i = 1; i < ev.length; i++) {
      const p = ev[i - 1], e = ev[i], gap = e.t - p.t1, scale = e.start ? 0 : gap > 0.6 ? 0.25 : 1, nc = [], bk = [];
      e.st.forEach((SB, bi) => {
        let best = Infinity, arg = 0;
        p.st.forEach((SA, ai) => {
          let c = cost[ai];
          e.ns.forEach((n, j) => {
            const fb = SB[j]; if (!fb) return;
            let near = 0, nd = Infinity; p.ns.forEach((m, x) => { const d = Math.abs(q(m) - q(n)); if (d < nd) { nd = d; near = x; } });
            if (e.repN && p.ns.length === 1 && e.ns.length === 1 && fb === SA[0] && e.ns[0].midi === p.ns[0].midi) { const I = e.t - p.t; if (I < 0.30 || (I < 0.6 && e.repN >= 2)) c += 40; }   // même doigt sur une note répétée trop vite : interdit
            const near0 = near;   // note la plus proche de l'événement précédent : sert de repère de position de la main même quand l'événement précédent est un accord
            // Position de la main : la main ne bouge pas tant que les doigts « suivent » les touches (un pas conjoint sur le clavier = un doigt conjoint). Le décalage de position
            // est l'écart entre le déplacement sur le clavier (en touches blanches) et le changement de doigt ; il vaut 0 pour 1-2-3-4-5 sur cinq touches voisines. Le passage du pouce
            // (sous la main ou par-dessus) déplace la position d'un coup : son coût est plafonné, il n'est payé qu'une fois, puis la règle des doigts conjoints reprend.
            if (e.ns.length === 1) {   // (avant le cas particulier des accords ci-dessous, qui sortirait de la boucle)
              const pa = p.ns[near0], fa0 = SA[near0]; if (pa && fa0) {
                const dP = (sgn * (ux(n.midi) - ux(pa.midi))) - (fb - fa0), croise = fa0 !== fb && (fa0 === 1 || fb === 1) && (fb - fa0) * (q(n) - q(pa)) < 0;
                const dxk = Math.abs(ux(n.midi) - ux(pa.midi));   // écart sur le clavier, en touches blanches
                c += scale * (croise ? WCROIS * Math.min(Math.abs(dP), 2) : (!e.fit && dxk >= 1.9 && dxk > Math.abs(fb - fa0) && Math.abs(q(n) - q(pa)) <= 5 ? WPOS_SAUT : WPOS) * Math.abs(dP));
                if (Math.abs(dP) >= 0.9) c += scale * WCOUNT;   // nombre de changements de position (Parncutt) : chaque déplacement de la main coûte un point fixe, en plus de sa taille
                // Aucune contrainte d'empan : les doigts se suivent dans l'ordre (main droite 1 2 3 4 5 en montant et 5 4 3 2 1 en descendant ; main gauche l'inverse) ;
                // sauter un doigt (1 puis 3 pour une tierce) ne se fait que si l'empan l'impose (les grands intervalles gardent leurs doigtés habituels : 5 puis 1 pour une quarte en descendant)
                // dans une montée qui utilise tout l'empan, un doigt doit être sauté quelque part : jamais sur un demi-ton ou un ton, plutôt sur l'intervalle le plus étroit (tierce mineure avant tierce majeure)
                if (!croise && e.span && Math.abs(fb - fa0) === 2 && (fb - fa0) * (q(n) - q(pa)) > 0) { const aa = Math.abs(q(n) - q(pa)); c += scale * (aa <= 2 ? 3.0 : 0.3 * aa + 0.5 * (e.runM - e.runK)); }   // jamais de doigt sauté sur un demi-ton ou un ton ; les doigts conjoints d'abord, le doigt sauté le plus tard possible (1 2 4 5 plutôt que 1 3 4 5)
                if (!croise && !e.fit && !e.span && Math.abs(fb - fa0) === 2 && (fb - fa0) * (q(n) - q(pa)) > 0 && Math.abs(q(n) - q(pa)) <= 4) c += scale * WSKIP;   // tierce (4 demi-tons au plus) jouée en sautant un doigt
              }
            }
            if (p.ns.length > 1 || e.ns.length > 1) { const same = SA.findIndex(f => f === fb); if (same >= 0) near = same; else { c += scale * 0.1 * nd; return; } }   // accord : on compare avec la note que CE doigt vient de jouer (la main se déplace d'un bloc) ; un doigt qui n'a pas joué ne « croise » rien : seul le déplacement de la main compte
            const fa = SA[near]; if (!fa) return;
            const blocs = p.ns.length > 1 && e.ns.length > 1 && fa === fb;   // accord → accord avec le même doigt : toute la main se déplace d'un bloc, ce n'est pas un saut de doigt isolé
            c += scale * (blocs ? 0.15 * Math.abs(q(n) - q(p.ns[near])) : pairCost(fa, q(p.ns[near]), fb, q(n)));

            if (fb === 1 && fa !== 1 && isBlack(n.midi)) c += scale * ((fa - fb) * (q(n) - q(p.ns[near])) < 0 ? 1.5 : 0.5); // le pouce qui ARRIVE sur une touche noire (surtout en passant sous la main, en montant) est difficile
            if (fa === fb && q(p.ns[near]) !== q(n) && !blocs) { const dd = Math.abs(q(n) - q(p.ns[near])); c += e.start ? 0 : gap < 0.15 ? 3 + 0.5 * dd : gap < 1.5 ? 2 + 0.3 * dd : 0; } // même doigt sur une autre touche : saut sans le temps de s'y rendre ; la pénalité reste sensible après une courte pause (jusqu'à 1,5 s) au lieu de s'effacer dès 0,15 s
          });
          if (i >= 2 && e.ns.length === 1 && p.ns.length === 1 && ev[i - 2].ns.length === 1 && SB[0] && SA[0]) {   // 3-4-5 (Parncutt) : trois notes de suite jouées par les doigts 3, 4 et 5, dans un ordre quelconque ; le doigt de l'événement d'avant est celui du meilleur chemin qui arrive à SA
            const fAA = ev[i - 2].st[back[i - 2][ai]][0]; if (fAA && fAA !== SA[0] && SA[0] !== SB[0] && fAA !== SB[0] && fAA >= 3 && SA[0] >= 3 && SB[0] >= 3) c += scale * W345;
          }
          if (c < best) { best = c; arg = ai; }
        });
        nc.push(best + e.own[bi]); bk.push(arg);
      });
      cost = nc; back.push(bk);
    }
    let s = cost.indexOf(Math.min.apply(null, cost));
    for (let i = ev.length - 1; i >= 0; i--) {
      const S = ev[i].st[s]; ev[i].ns.forEach((n, j) => { n.af = S[j] || 0; });
      if (i) s = back[i - 1][s];
    }
    // Un doigt déjà posé sur une touche tenue ne peut pas en jouer une autre, et deux doigts ne se croisent pas (hors pouce) : on le remplace par un doigt libre, dans l'ordre des notes tenues.
    const held = [];
    ev.forEach(e => {
      for (let h = held.length - 1; h >= 0; h--) if (held[h].n.t1 <= e.t + 0.02) held.splice(h, 1);
      e.ns.forEach(n => {
        const f = n.finger || n.af; if (!f) return;
        const fh = h => h.n.finger || h.n.af, croise = h => f !== 1 && fh(h) !== 1 && q(n) !== q(h.n) && Math.sign(f - fh(h)) !== Math.sign(q(n) - q(h.n)); // passe par-dessus un doigt qui tient une touche (hors pouce)
        if (!n.finger && held.some(h => fh(h) === f || croise(h))) {
          const used = new Set(held.map(h => h.n.finger || h.n.af));
          const ok = c => !used.has(c) && held.every(h => Math.sign(c - (h.n.finger || h.n.af)) === Math.sign(q(n) - q(h.n)));
          const alt = [1, 2, 3, 4, 5].filter(ok).sort((a, b) => Math.abs(a - f) - Math.abs(b - f))[0];
          if (alt) n.af = alt;
        }
      });
      e.ns.forEach(n => held.push({ n }));
    });
    // Changement de doigt AUTOMATIQUE sur une touche tenue (comme le font les pianistes pour réaliser un grand écart sans rejouer la note) :
    // si une note tenue et une note qui commence pendant sa tenue sont trop éloignées pour leurs doigts, la note tenue passe, juste avant, à un doigt libre
    // qui convient (n.af2, sur la même touche : rien n'est rejoué). Jamais si le doigté de la note est imposé (n.finger) ou déjà un changement (n.finger2).
    const MX = [0, 5, 7, 9, 12], fo = n => n.finger || n.af, ok2 = (a, fa, b, fb) => { const df = Math.abs(fa - fb); return fa !== fb && Math.sign(q(a) - q(b)) === Math.sign(fa - fb) && Math.abs(q(a) - q(b)) <= MX[Math.min(4, df)] + 0.5; };
    ev.forEach((e, i) => {
      if (!i) return;
      for (let j = 0; j < i; j++) ev[j].ns.forEach(h => {
        if (h.finger || h.finger2 || h.af2 || h.t1 <= e.t + 0.12 || !fo(h)) return;
        const bad = e.ns.some(n => fo(n) && !ok2(n, fo(n), h, fo(h)) && Math.abs(q(n) - q(h)) > MX[Math.min(4, Math.abs(fo(n) - fo(h)))] + 0.5);
        if (!bad) return;
        const used = new Set(); e.ns.forEach(n => used.add(fo(n)));
        for (let k = j + 1; k < i; k++) ev[k].ns.forEach(n => { if (n.t1 > e.t) used.add(fo(n)); });
        const free = c => !notes.some(m => m !== h && fo(m) === c && m.t0 < h.t1 + 0.1 && m.t1 > e.t - 0.55), alt = [1, 2, 3, 4, 5].filter(c => c !== fo(h) && !used.has(c) && free(c) && e.ns.every(n => !fo(n) || ok2(n, fo(n), h, c))).sort((a, b) => Math.abs(a - fo(h)) - Math.abs(b - fo(h)))[0];
        if (alt) { h.af2 = alt; h.swapT = e.t - 0.15; }
      });
    });
    // Le changement de doigt ne sert pas qu'aux grands écarts : il sert aussi, plus simplement, à rapprocher le doigt tenu de la position où la main va jouer
    // (un pouce qui tient une touche pendant que les autres doigts jouent plus haut, un 5 qui laisse sa place, etc.). On le fait quand les notes jouées PENDANT la tenue
    // sont nettement plus confortables avec un autre doigt libre (même mesure de confort que pour le choix des doigts).
    notes.forEach(h => {
      if (h.finger || h.finger2 || h.af2 || !fo(h) || h.t1 - h.t0 < 0.6) return;
      const Nh = notes.filter(n => n !== h && n.t0 > h.t0 + 0.15 && n.t0 < h.t1 - 0.15 && n.t0 < h.t0 + 3 && fo(n)).sort((a, b) => a.t0 - b.t0); if (!Nh.length) return;
      const fh = fo(h), sw = Nh[0].t0 - 0.15, base = Nh.reduce((c, n) => c + pairCost(fh, q(h), fo(n), q(n)), 0);
      const free = c => !notes.some(m => m !== h && fo(m) === c && m.t0 < h.t1 + 0.1 && m.t1 > sw - 0.55);
      let best = null;
      for (let c = 1; c <= 5; c++) {
        if (c === fh || !free(c) || !Nh.every(n => fo(n) !== c && Math.sign(q(n) - q(h)) === Math.sign(fo(n) - c))) continue;
        const gain = base - Nh.reduce((u, n) => u + pairCost(c, q(h), fo(n), q(n)), 0) - 0.25 * Math.abs(c - fh);
        if (gain > 2 && (!best || gain > best.gain)) best = { c, gain };
      }
      if (best) { h.af2 = best.c; h.swapT = sw; }
    });
  }

  // ---------- Plan d'une main ----------
  const REL_SEC = 0.25;   // un doigt relâché revient vers la paume en 0,25 s
  const LEAD_SEC = 0.30;  // un doigt part vers sa prochaine touche 0,30 s avant (ou dès qu'il est libre)
  const TOL_NOTE = 0, TOL_ACCORD = 0; // la main est asservie au doigt qui joue : elle se place EXACTEMENT en face de sa touche (pour un accord : en face de leur moyenne)
  const LIFT_GAP = 0.05, HELD_OVERLAP = 0.1, TM_BASE = 0.12, MIN_FRAC = 0.25; // durée mini du déplacement de la main ; fraction mini de la note où le doigt reste posé
  const PALM_SEC = 0.30;  // la paume se déplace pendant les 0,30 s qui précèdent la note qui l'exige
  function buildPlan(notes, hand, opt) {
    opt = opt || {};
    const sg = hand === 'L' ? -1 : 1, off = f => sg * (f - 3);
    const presses = [];
    notes.forEach(n => {
      const f = n.finger || n.af; if (!f) return;
      const a = n.t0, dur = Math.max(0.1, n.t1 - n.t0), u = ux(n.midi);
      const f2 = n.finger2 && n.finger2 !== f ? n.finger2 : (!n.finger && n.af2 && n.af2 !== f ? n.af2 : 0);
      if (f2) { // changement de doigt sur la touche tenue : les deux doigts se chevauchent un instant
        let fr = (!n.finger2 && n.af2 && n.swapT != null) ? (n.swapT - a) / dur : n.swapFrac != null ? n.swapFrac : (n.swapTick != null && n.dur ? (n.swapTick - n.tick) / n.dur : 0.55);
        fr = clamp(fr, 0.2, 0.85); const ts = a + dur * fr, ov = Math.min(0.08, dur * 0.15);
        presses.push({ f, midi: n.midi, u, a, b: ts + ov });
        presses.push({ f: f2, midi: n.midi, u, a: ts - ov, b: a + dur, sub: true });
      } else presses.push({ f, midi: n.midi, u, a, b: a + dur });
    });
    presses.sort((x, y) => x.a - y.a || x.f - y.f);
    if (opt.gesture) presses.forEach(p => { p.b = Math.min(p.b, p.a + 0.3); });   // geste : le doigt lève et se replie peu après la frappe (affichage seulement, le son garde ses durées)
    // Enchaînement de notes (hors accords et hors notes tenues) : on LÂCHE la touche qu'on jouait un instant avant d'en frapper une autre, même si dans le fichier
    // la fin de l'une et le début de l'autre sont simultanés. Une note vraiment tenue (qui dépasse le début de la suivante de plus de 0,1 s) reste posée.
    presses.forEach((p, i) => {
      let j = i + 1; while (j < presses.length && presses[j].a <= p.a + 0.03) j++;
      const q = presses[j]; if (!q || q.f === p.f) return;
      if (p.b > q.a - LIFT_GAP && p.b - q.a <= HELD_OVERLAP) p.b = Math.max(p.a + 0.04, q.a - LIFT_GAP);
    });
    const byF = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    presses.forEach(p => byF[p.f].push(p));
    for (let f = 1; f <= 5; f++) { // un même doigt ne tient pas deux touches à la fois, et il lui faut un temps de trajet (proportionnel à la distance) entre deux touches
      const L = byF[f];
      for (let i = 0; i + 1 < L.length; i++) L[i].b = Math.max(L[i].a + 0.04, Math.min(L[i].b, L[i + 1].a - Math.min(0.25, 0.03 + 0.03 * Math.abs(L[i + 1].u - L[i].u))));
    }
    const prefB = []; presses.forEach((p, i) => { prefB.push(Math.max(p.b, i ? prefB[i - 1] : -Infinity)); });

    // événements = groupes de touches frappées ensemble ; la paume vise la position où ses doigts sont à leur place naturelle
    const ev = [];
    presses.filter(p => !p.sub).forEach(p => { const l = ev[ev.length - 1]; if (l && p.a - l.t < 0.03) l.ps.push(p); else ev.push({ t: p.a, ps: [p] }); });
    const kt = [], kp = [];
    let pal = null, lastT = -Infinity, prev = null;
    ev.forEach((e, ei) => {
      const target = e.ps.reduce((s, p) => s + p.u - off(p.f), 0) / e.ps.length;
      let tol = e.ps.length > 1 ? TOL_ACCORD : TOL_NOTE; // tolérance de la paume : plus elle est petite, plus la main se place pile en face du doigt qui joue
      if (prev && prev.ps.length === 1 && e.ps.length === 1) {
        const a = prev.ps[0], b = e.ps[0];
        if ((b.f === 1 && a.f >= 2 && sg * (b.u - a.u) > 0) || (a.f === 1 && b.f >= 2 && sg * (b.u - a.u) < 0)) tol = 0; // pouce qui passe sous la main / doigt qui passe par-dessus
      }
      const T = e.t - 0.02;
      if (pal === null) { pal = target; kt.push(T - 1); kp.push(pal); lastT = T - 1; }
      else {
        const np = clamp(pal, target - tol, target + tol);
        if (np !== pal) {
          // la main ne se déplace que lorsqu'aucun doigt n'est posé : les doigts qui jouaient se lèvent AVANT le début du déplacement (sauf accords et notes tenues),
          // dont la durée croît avec la distance (jamais de téléportation de la main)
          const tm = clamp(TM_BASE + 0.05 * Math.abs(np - pal), TM_BASE, PALM_SEC); let D = Math.max(lastT, T - tm);
          const early = p => !(e.ps.includes(p) || p.a >= e.t - 0.01 || p.b <= D || p.b - e.t > HELD_OVERLAP);
          // un doigt reste posé au moins la moitié de sa note : sinon la main part plus tard (et plus vite)
          presses.forEach(p => { if (early(p)) D = Math.max(D, Math.min(p.b, p.a + Math.max(0.04, MIN_FRAC * (p.b - p.a)))); });
          presses.forEach(p => { if (early(p)) p.b = Math.max(p.a + 0.04, D); });
          if (D > lastT) { kt.push(D); kp.push(pal); }
          kt.push(Math.max(T, D + 1e-3)); kp.push(np); lastT = kt[kt.length - 1]; pal = np;
        }
      }
      // touche tenue longtemps par un seul doigt (aucun autre doigt ne tient de touche) : la main se recentre en face de ce doigt, sinon il reste
      // étiré de côté, par-dessus ses voisins, pendant toute la tenue
      const nxt = ev[ei + 1], room = nxt ? nxt.t - e.t : e.ps.reduce((m, p) => Math.max(m, p.b - p.a), 0);
      if (e.ps.length === 1 && room > 0.9 && Math.abs(pal - target) > 0.05 && !presses.some(p => p !== e.ps[0] && p.a < e.t + 0.01 && p.b > e.t + 0.1)) {
        const D2 = Math.max(lastT, T + 0.05); kt.push(D2); kp.push(pal); kt.push(D2 + 0.3); kp.push(target); lastT = D2 + 0.3; pal = target;
      }
      prev = e;
    });
    prefB.length = 0; presses.forEach((p, i) => { prefB.push(Math.max(p.b, i ? prefB[i - 1] : -Infinity)); });
    const palmAt0 = t => {
      if (!kt.length) return 0;
      if (t <= kt[0]) return kp[0]; if (t >= kt[kt.length - 1]) return kp[kp.length - 1];
      let lo = 0, hi = kt.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kt[m] <= t) lo = m; else hi = m; }
      return kp[lo] + (kp[lo + 1] - kp[lo]) * ease((t - kt[lo]) / (kt[lo + 1] - kt[lo]));
    };
    // Une main qui ne joue pas pendant un bon moment revient à sa position « normale » : la droite à droite de la gauche (au moins HOME_GAP touches blanches),
    // la gauche à gauche de la droite. Elle y part juste après sa dernière note et en repart en avance pour être en place à la note suivante.
    const HOME_U = hand === 'R' ? ux(64) : ux(52), HOME_GAP = 6, IDLE_MIN = 0.8;
    let other = null;
    const gaps = []; let busyEnd = null;
    presses.forEach(p => {
      if (busyEnd === null) { if (p.a > IDLE_MIN) gaps.push({ g0: -Infinity, g1: p.a }); }
      else if (p.a - busyEnd > IDLE_MIN) gaps.push({ g0: busyEnd, g1: p.a });
      busyEnd = busyEnd === null ? p.b : Math.max(busyEnd, p.b);
    });
    if (busyEnd !== null) gaps.push({ g0: busyEnd, g1: Infinity });
    const homeAt = t => !other ? HOME_U : hand === 'R' ? Math.max(HOME_U, other.palm0(t) + HOME_GAP) : Math.min(HOME_U, other.palm0(t) - HOME_GAP);
    const palmAt = t => {
      for (const g of gaps) if (t > g.g0 && t < g.g1) {
        const h = homeAt(t), f0 = isFinite(g.g0), f1 = isFinite(g.g1), A = f0 ? palmAt0(g.g0) : h, B = f1 ? palmAt0(g.g1) : h;
        const len = g.g1 - g.g0, d1 = Math.min(0.3, 0.4 * len), d2 = Math.min(0.8, 0.4 * len);   // durées d'aller et de retour, raccourcies pour les silences courts
        const s1 = f0 ? ease((t - g.g0 - 0.02) / d1) : 1, s2 = f1 ? ease((t - (g.g1 - d2)) / d2) : 0, p = A + (h - A) * s1;
        return p + (B - p) * s2;
      }
      return palmAt0(t);
    };
    const firstIdx = (L, t) => { let lo = 0, hi = L.length; while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].a > t) hi = m; else lo = m + 1; } return lo; };

    // doigt f à l'instant t : abscisse, enfoncement (0 = en l'air … 1 = sur la touche), touche noire visée, hauteur de levée
    function finger(f, t) {
      const L = byF[f], palm = palmAt(t), r = palm + off(f);
      const j = firstIdx(L, t), i = j - 1;
      if (i >= 0 && t <= L[i].b) return { x: L[i].u, depth: 1, blk: isBlack(L[i].midi) ? 1 : 0, pressed: true, midi: L[i].midi, lift: 0 };
      let wP = 0, wN = 0, depth = 0, blk = 0;
      if (i >= 0) { const s = (t - L[i].b) / REL_SEC; wP = s < 1 ? 1 - ease(s) : 0; depth = Math.max(depth, clamp(1 - (t - L[i].b) / 0.1, 0, 1)); if (wP > 0) blk = isBlack(L[i].midi) ? 1 : 0; }
      if (j < L.length) { wN = ease((t - (L[j].a - LEAD_SEC)) / LEAD_SEC); depth = Math.max(depth, ease((t - (L[j].a - 0.06)) / 0.06)); if (wN > 0) blk = isBlack(L[j].midi) ? 1 : 0; }
      // le doigt suit la main (asservie à lui) : il ne s'écarte d'elle que de ce que la main ne peut pas absorber au moment de la frappe / du relâchement
      const uP = i >= 0 ? L[i].u - (palmAt(L[i].b) + off(f)) : 0, uN = j < L.length ? L[j].u - (palmAt(L[j].a) + off(f)) : 0;
      const x = r + uP * wP * (1 - wN) + uN * wN;
      return { x, depth, wN, wP, blk, blkP: i >= 0 && isBlack(L[i].midi) ? 1 : 0, blkN: j < L.length && isBlack(L[j].midi) ? 1 : 0, pressed: false, midi: 0, lift: (1 - depth) * (0.35 + 0.65 * 4 * wN * (1 - wN)) };
    }
    // Un doigt posé sur sa touche est un mur : les doigts voisins (index, majeur, annulaire, auriculaire ; pas le pouce, qui passe sous la main) ne le traversent
    // pas, ils sont repoussés derrière lui, de moins en moins à mesure qu'ils s'enfoncent eux-mêmes (le résultat reste donc continu).
    const GAP = 0.5; // écart minimal entre deux bouts de doigts voisins (deux touches voisines, blanche et noire, sont à 0,5)
    function wall(fs) {
      const s = fs.map(g => sg * g.x), pr = fs.map(g => g.pressed), soft = g => 1 - Math.max(g.depth, g.wN || 0); // un doigt qui part vers sa touche s'affranchit du mur en douceur, sur toute sa course
      const ws = fs.map(g => g.pressed ? 1 : g.depth); // force du mur : 1 sous un doigt posé, qui s'efface en 0,1 s quand il est relâché (pas de saut)
      const moved = new Array(5).fill(false);
      for (let i = 2; i <= 4; i++) { const w = ws[i - 1]; if (w > 0 && !pr[i] && s[i] < s[i - 1] + GAP) { const d = (s[i - 1] + GAP - s[i]) * w * soft(fs[i]); s[i] += d; ws[i] = Math.max(ws[i], w * soft(fs[i])); moved[i] = true; } }
      for (let i = 3; i >= 1; i--) { const w = ws[i + 1]; if (w > 0 && !pr[i] && s[i] > s[i + 1] - GAP) { const d = (s[i] - (s[i + 1] - GAP)) * w * soft(fs[i]); s[i] -= d; ws[i] = Math.max(ws[i], w * soft(fs[i])); moved[i] = true; } }
      return fs.map((g, i) => (moved[i] && i >= 1) ? Object.assign({}, g, { x: sg * s[i] }) : g);
    }
    // temps qui sépare t de la touche frappée ou tenue la plus proche (0 = la main joue en ce moment)
    function near(t) {
      if (!presses.length) return Infinity;
      const i = firstIdx(presses, t) - 1;
      if (i >= 0 && prefB[i] >= t) return 0;
      return Math.min(i >= 0 ? t - prefB[i] : Infinity, i + 1 < presses.length ? presses[i + 1].a - t : Infinity);
    }
    // ---- gestes remarquables (annoncés à l'écran avant qu'ils n'arrivent) et événements (groupes de touches frappées ensemble)
    const gestures = [], seen = new Set();
    const addG = (t, label, u, f) => { const k = label + '@' + t.toFixed(3); if (!seen.has(k)) { seen.add(k); gestures.push({ t, label, u, f }); } };
    ev.forEach((e, i) => {
      const b = e.ps.length === 1 ? e.ps[0] : null, a = i && ev[i - 1].ps.length === 1 ? ev[i - 1].ps[0] : null;
      if (a && b && b.f === 1 && a.f >= 2 && sg * (b.u - a.u) > 0) addG(e.t, 'Pouce sous la main', b.u, 1);
      else if (a && b && a.f === 1 && b.f >= 2 && sg * (b.u - a.u) < 0) addG(e.t, 'Doigt par-dessus le pouce', b.u, b.f);
      else if (i && Math.abs(palmAt(e.t) - palmAt(ev[i - 1].t)) >= 3) addG(e.t, 'Saut de position', e.ps[0].u, e.ps[0].f);
      e.ps.forEach(p => { if (p.f === 1 && Math.abs(p.u - (palmAt(e.t) + off(1))) >= 2 && !(a && b && b.f === 1 && a.f >= 2)) addG(e.t, 'Écart du pouce', p.u, 1); });
    });
    presses.forEach(p => { if (p.sub) addG(p.a, 'Changement de doigt', p.u, p.f); });
    gestures.sort((x, y) => x.t - y.t);
    function nextEvent(t) { let lo = 0, hi = ev.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t > t + 1e-3) hi = m; else lo = m + 1; } return ev[lo] || null; }
    return {
      hand, sg, presses, events: ev, gestures, nextEvent, empty: !presses.length, palm: palmAt, palm0: palmAt0, link(o) { other = o; }, finger, near,
      at(t) { return { palm: palmAt(t), fingers: wall([1, 2, 3, 4, 5].map(f => finger(f, t))), near: near(t) }; },
    };
  }
  // nom d'un intervalle (en demi-tons, signé : positif = vers l'aigu)
  const INTERVALS = ['même note', '2de mineure', '2de majeure', '3ce mineure', '3ce majeure', '4te', 'triton', '5te', '6te mineure', '6te majeure', '7e mineure', '7e majeure', 'octave'];
  function intervalName(semi) { const a = Math.abs(semi); if (!a) return INTERVALS[0]; const o = Math.floor(a / 12); return (semi > 0 ? '↑ ' : '↓ ') + (a <= 12 ? INTERVALS[a] : (o === 1 ? 'octave' : o + ' octaves') + (a % 12 ? ' + ' + INTERVALS[a % 12] : '')); }
  // Règle UNIQUE de non-croisement des doigts voisins 2 à 5 (hors pouce), utilisée par le dessin 2D ET la vue 3D (ne pas la dupliquer) :
  // xs = positions des 5 doigts (doigt 1 = pouce, ignoré), pin[i] = doigt qui joue ou s'apprête à jouer (il ne bouge pas, ses voisins s'écartent), sg = +1 main droite, −1 main gauche, gap = écart minimal.
  // Seuls deux doigts qui jouent en même temps dans le mauvais ordre (doigté du fichier) peuvent encore se croiser.
  function enforceFingerOrder(xs, pin, sg, gap) {
    for (let pass = 0; pass < 4; pass++) for (let i = 1; i < 4; i++) {
      const need = gap - sg * (xs[i + 1] - xs[i]); if (need <= 0) continue;
      if (pin[i] && !pin[i + 1]) xs[i + 1] += sg * need; else if (!pin[i] && pin[i + 1]) xs[i] -= sg * need; else if (!pin[i] && !pin[i + 1]) { xs[i] -= sg * need / 2; xs[i + 1] += sg * need / 2; }
    }
    // balayages exacts (garantissent la règle, sauf entre deux doigts qui jouent) : vers l'extérieur, puis retour
    for (let i = 1; i < 4; i++) if (!pin[i + 1] && sg * (xs[i + 1] - xs[i]) < gap) xs[i + 1] = xs[i] + sg * gap;
    for (let i = 3; i >= 1; i--) if (!pin[i] && sg * (xs[i + 1] - xs[i]) < gap) xs[i] = xs[i + 1] - sg * gap;
  }

  // Copie de doigtés d'un passage à un autre, sans contrainte : les notes du passage copié (src, dans l'ordre : début puis hauteur) reçoivent leurs doigts, un à un, sur les notes de la destination.
  // start : soit UNE note (la destination commence là et suit les notes de sa main, dans l'ordre), soit une LISTE de notes choisies. La main et le rythme de la destination peuvent différer de la source.
  // opts.hand(n) -> 'R' | 'L', opts.shown(n) -> doigt affiché. Renvoie { pairs: [{ n, f }], copied, total, stop, fromHand, toHand }.
  function pasteFingerings(all, src, start, opts) {
    const ordered = l => l.slice().sort((a, b) => a.tick - b.tick || a.midi - b.midi), group = Array.isArray(start);
    if (group && !start.length) return { pairs: [], copied: 0, total: 0, stop: 'aucune note de destination', fromHand: null, toHand: null };
    const first = group ? ordered(start)[0] : start, toHand = opts.hand(first);
    let S = ordered(src), fromHand = toHand;
    if (!S.some(n => opts.hand(n) === toHand)) { const c = { R: 0, L: 0 }; S.forEach(n => { c[opts.hand(n)]++; }); fromHand = c.R >= c.L ? 'R' : 'L'; }   // la destination est l'autre main : on prend la main la mieux représentée dans la sélection
    S = S.filter(n => opts.hand(n) === fromHand);
    const T = group ? ordered(start) : ordered(all.filter(n => opts.hand(n) === toHand && (n.tick > start.tick || (n.tick === start.tick && n.midi >= start.midi))));
    const k = Math.min(S.length, T.length), pairs = [];
    for (let i = 0; i < k; i++) { const f = opts.shown(S[i]); if (f) pairs.push({ n: T[i], f }); }
    return { pairs, copied: k, total: S.length, stop: T.length < S.length ? 'plus assez de notes à la destination' : null, fromHand, toHand };
  }
  const FINGER_GAP = 0.62;   // écart minimal entre deux doigts voisins, en largeurs de touche
  return { pasteFingerings, ux, isBlack, pairCost, assignFingerings, setHandSize, getHandSize, buildPlan, intervalName, enforceFingerOrder, FINGER_GAP };
});
