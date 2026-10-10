/* [Moteur d'origine des mains, conservé pour l'affichage « sans trajectoire » : la paume suit les doigts avec une tolérance, les doigts s'étirent pour atteindre leur touche] Mains virtuelles : doigtés automatiques + trajectoire des mains et des doigts (sans aucun dessin : tout est testable sous Node).
   Une main est décrite par un « plan » : on lui demande, à n'importe quel instant du morceau, la position de la paume et de chacun des 5 doigts.
   Positions horizontales en « largeurs de touche blanche » absolues (voir ux()). Doigts : 1 = pouce … 5 = auriculaire. Mains : 'R' droite, 'L' gauche. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.PianoHandsLegacy = factory();
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
  function pairCost(f1, q1, f2, q2) {
    const dq = q2 - q1, df = f2 - f1, a = Math.abs(dq), m = Math.abs(df);
    if (dq === 0) return f1 === f2 ? 0 : 1;                 // même touche : changer de doigt coûte un peu
    if (df === 0) return 1 + 0.4 * a;                       // même doigt sur une autre touche : saut
    if (df * dq > 0) { const lo = m, hi = 2.2 * m + 1; return a < lo ? (lo - a) * 0.5 : a > hi ? (a - hi) * 0.9 : 0; } // sens naturel : écart confortable
    const far = a > 5 ? (a - 5) * 0.6 : 0;
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
    notes.forEach(n => { n.af = 0; });
    const ev = [];
    sorted.forEach(n => { const l = ev[ev.length - 1]; if (l && n.t0 - l.t < 0.03) l.all.push(n); else ev.push({ t: n.t0, all: [n] }); });
    ev.forEach(e => {
      e.all.sort((a, b) => q(a) - q(b));
      e.ns = e.all.slice(0, 5);                              // au-delà de 5 notes simultanées, les autres restent sans doigt
      e.t1 = Math.max.apply(null, e.all.map(n => n.t1));
      const k = e.ns.length, st = [];
      subsets(k).forEach(S => { if (e.ns.every((n, i) => !n.finger || n.finger === S[i])) st.push(S); });
      if (!st.length) st.push(e.ns.map(n => n.finger || 0));  // doigtés imposés incohérents entre eux : on les garde tels quels
      e.st = st;
      e.own = st.map(S => {
        let c = 0;
        e.ns.forEach((n, i) => {
          const f = S[i]; if (!f) return;
          if (isBlack(n.midi)) c += f === 1 ? 1.0 : f === 5 ? 0.25 : 0; // pouce sur touche noire : court et en retrait, nettement moins confortable
          if (!n.finger) c += f === 4 ? 0.2 : f === 5 ? 0.15 : 0;
          if (i && S[i - 1]) c += pairCost(S[i - 1], q(e.ns[i - 1]), f, q(n));
        });
        return c;
      });
    });
    if (!ev.length) return;
    let cost = ev[0].own.slice(), back = [];
    for (let i = 1; i < ev.length; i++) {
      const p = ev[i - 1], e = ev[i], gap = e.t - p.t1, scale = gap > 0.6 ? 0.25 : 1, nc = [], bk = [];
      e.st.forEach((SB, bi) => {
        let best = Infinity, arg = 0;
        p.st.forEach((SA, ai) => {
          let c = cost[ai];
          e.ns.forEach((n, j) => {
            const fb = SB[j]; if (!fb) return;
            let near = 0, nd = Infinity; p.ns.forEach((m, x) => { const d = Math.abs(q(m) - q(n)); if (d < nd) { nd = d; near = x; } });
            const fa = SA[near]; if (!fa) return;
            c += scale * pairCost(fa, q(p.ns[near]), fb, q(n));
            if (fb === 1 && fa !== 1 && isBlack(n.midi)) c += scale * ((fa - fb) * (q(n) - q(p.ns[near])) < 0 ? 1.5 : 0.5); // le pouce qui ARRIVE sur une touche noire (surtout en passant sous la main, en montant) est difficile
            if (fa === fb && q(p.ns[near]) !== q(n) && gap < 0.15) c += 3 + 0.5 * Math.abs(q(n) - q(p.ns[near])); // même doigt, saut, sans le temps de s'y rendre
          });
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
  }

  // ---------- Plan d'une main ----------
  const REL_SEC = 0.25;   // un doigt relâché revient vers la paume en 0,25 s
  const LEAD_SEC = 0.30;  // un doigt part vers sa prochaine touche 0,30 s avant (ou dès qu'il est libre)
  const TOL_NOTE = 1.0, TOL_ACCORD = 0.6;
  const PALM_SEC = 0.30;  // la paume se déplace pendant les 0,30 s qui précèdent la note qui l'exige
  function buildPlan(notes, hand) {
    const sg = hand === 'L' ? -1 : 1, off = f => sg * (f - 3);
    const presses = [];
    notes.forEach(n => {
      const f = n.finger || n.af; if (!f) return;
      const a = n.t0, dur = Math.max(0.1, n.t1 - n.t0), u = ux(n.midi);
      const f2 = n.finger2 && n.finger2 !== f ? n.finger2 : 0;
      if (f2) { // changement de doigt sur la touche tenue : les deux doigts se chevauchent un instant
        let fr = n.swapFrac != null ? n.swapFrac : (n.swapTick != null && n.dur ? (n.swapTick - n.tick) / n.dur : 0.55);
        fr = clamp(fr, 0.2, 0.85); const ts = a + dur * fr, ov = Math.min(0.08, dur * 0.15);
        presses.push({ f, midi: n.midi, u, a, b: ts + ov });
        presses.push({ f: f2, midi: n.midi, u, a: ts - ov, b: a + dur, sub: true });
      } else presses.push({ f, midi: n.midi, u, a, b: a + dur });
    });
    presses.sort((x, y) => x.a - y.a || x.f - y.f);
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
          const D = Math.max(lastT, T - PALM_SEC);
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
      const uP = i >= 0 ? L[i].u : r, uN = j < L.length ? L[j].u : r;
      const x = r + (uP - r) * wP * (1 - wN) + (uN - r) * wN;
      return { x, depth, blk, pressed: false, midi: 0, lift: (1 - depth) * (0.35 + 0.65 * 4 * wN * (1 - wN)) };
    }
    // temps qui sépare t de la touche frappée ou tenue la plus proche (0 = la main joue en ce moment)
    function near(t) {
      if (!presses.length) return Infinity;
      const i = firstIdx(presses, t) - 1;
      if (i >= 0 && prefB[i] >= t) return 0;
      return Math.min(i >= 0 ? t - prefB[i] : Infinity, i + 1 < presses.length ? presses[i + 1].a - t : Infinity);
    }
    return {
      hand, sg, presses, empty: !presses.length, palm: palmAt, palm0: palmAt0, link(o) { other = o; }, finger, near,
      at(t) { return { palm: palmAt(t), fingers: [1, 2, 3, 4, 5].map(f => finger(f, t)), near: near(t) }; },
    };
  }
  return { ux, isBlack, pairCost, assignFingerings, buildPlan };
});
