/* Vue 3D (essai) : clavier en perspective, rouleau qui s'éloigne derrière le clavier, mains virtuelles en volume.
   Utilise les plans de mains existants (hands.js / hands_legacy.js) : palm(t), finger(f, t) → { x, depth, blk, pressed, lift }.
   Unités : 1 = largeur d'une touche blanche ; x = hands.ux(midi) ; y = hauteur (0 = dessus des touches blanches) ; z = vers le joueur. */
const View3D = (() => {
  const KEY_L = 6, BLK_L = 3.6, BACK = -3, AHEAD = 3.2, SPEED = 4;       // longueur des touches ; fond du clavier ; secondes de rouleau visibles ; unités par seconde
  const CR = 0xffb347, CL = 0x5fb4ff;                                     // couleurs vives : main droite, main gauche
  const DEF = { az: 0, el: 55 * Math.PI / 180, zoom: 1.1 };
  let barSp = [], ui, marks = [], pastilles = [], orbit = { ...DEF }, renderer, scene, cam, host, keys = {}, bars = [], hands = {}, built = null, size = [0, 0], tex = {};
  const V = (x, y, z) => new THREE.Vector3(x, y, z), Y = V(0, 1, 0);

  function digit(n, col) {
    const k = n + col, c = tex[k]; if (c) return c;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 5; g.strokeStyle = '#10121f'; g.stroke(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#10121f'; g.font = '800 36px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 34);
    return (tex[k] = new THREE.CanvasTexture(cv));
  }
  // Règle : les doigts 2 à 5 ne se croisent jamais (ni se chevauchent) latéralement. Si deux doigts voisins se rejoignent ou s'inversent, le doigt qui ne joue pas est écarté ;
  // si les deux sont sans appui, ils s'écartent de moitié chacun. Un doigt qui joue ou qui va frapper (« épinglé ») ne bouge pas.
  function enforceOrder(xs, pin, sg) {
    const GAP = 0.62;
    for (let pass = 0; pass < 4; pass++) for (let i = 1; i < 4; i++) {
      const need = GAP - sg * (xs[i + 1] - xs[i]); if (need <= 0) continue;
      if (pin[i] && !pin[i + 1]) xs[i + 1] += sg * need; else if (!pin[i] && pin[i + 1]) xs[i] -= sg * need; else if (!pin[i] && !pin[i + 1]) { xs[i] -= sg * need / 2; xs[i + 1] += sg * need / 2; }
    }
  }
  function limb(mesh, a, b) {
    const d = b.clone().sub(a), L = d.length() || 1e-4; mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.set(1, L, 1);
    mesh.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / L));
  }
  function init(container) {
    host = container;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0e1120); renderer.domElement.id = 'cv3d'; renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
    container.appendChild(renderer.domElement);
    // rotation à la souris (glisser), zoom (molette), retour à la vue de départ (double-clic)
    const c = renderer.domElement; let drag = null; c.style.touchAction = 'none'; c.style.cursor = 'grab';
    const ptrs = new Map(); let pinch = 0;
    c.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (_) {} c.style.cursor = 'grabbing'; });
    c.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {   // pincement : zoom à deux doigts (écran tactile)
        const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) zoomBy(pinch / dd); pinch = dd; drag = null; return;
      }
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      orbit.az = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, orbit.az - dx * 0.006)); orbit.el = Math.max(0.09, Math.min(1.5, orbit.el + dy * 0.005));
    });
    const end = e => { ptrs.delete(e.pointerId); pinch = 0; drag = null; c.style.cursor = 'grab'; }; c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.001)); }, { passive: false });
    c.addEventListener('dblclick', () => { orbit = { ...DEF }; });
    // boutons de zoom dans un coin de la vue 3D : + / − / retour à la vue de départ
    ui = document.createElement('div'); ui.id = 'zoom3d'; ui.style.cssText = 'position:absolute;right:12px;top:12px;display:none;flex-direction:column;gap:6px;z-index:5';
    [['+', 'Zoom avant (+ ou molette)', () => zoomBy(1 / 1.2)], ['−', 'Zoom arrière (− ou molette)', () => zoomBy(1.2)], ['⟲', 'Revenir à la vue de départ (double-clic)', () => { orbit = { ...DEF }; }]].forEach(([t, title, fn]) => {
      const b = document.createElement('button'); b.textContent = t; b.title = title; b.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid #2a3050;background:rgba(37,43,74,.92);color:#e8ebf7;font:600 20px/1 -apple-system,sans-serif;cursor:pointer';
      b.addEventListener('click', e => { e.stopPropagation(); fn(); }); b.addEventListener('pointerdown', e => e.stopPropagation()); ui.appendChild(b);
    });
    container.appendChild(ui);
    scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x0e1120, 22, 46);
    cam = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3050, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-6, 16, 12); scene.add(sun);
    return renderer.domElement;
  }

  // construit clavier, rouleau et mains pour la plage de notes du morceau
  function build(song, ux, isBlack) {
    keys = {}; bars = []; hands = {}; marks = []; pastilles = [];
    while (scene.children.length > 2) scene.remove(scene.children[scene.children.length - 1]);
    let lo = 127, hi = 0; song.notes.forEach(n => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    const m0 = Math.max(21, lo - 10), m1 = Math.min(108, hi + 10);
    const x0 = ux(m0) - 0.5, x1 = ux(m1) + 0.5, cx = (x0 + x1) / 2, w = x1 - x0;
    const wood = new THREE.MeshLambertMaterial({ color: 0x3a2a24 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.5, KEY_L + 0.8), wood); bed.position.set(cx, -0.55, 0); scene.add(bed);
    const front = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1, 0.6), wood); front.position.set(cx, -0.3, KEY_L / 2 + 0.5); scene.add(front);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1.1, 0.5), wood); back.position.set(cx, 0.2, BACK - 0.3); scene.add(back);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ color: 0x141830 })); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -0.85, 0); scene.add(floor);
    for (let m = m0; m <= m1; m++) {
      const blk = isBlack(m), g = blk ? new THREE.BoxGeometry(0.58, 0.7, BLK_L) : new THREE.BoxGeometry(0.94, 0.5, KEY_L);
      const mat = new THREE.MeshLambertMaterial({ color: blk ? 0x14151e : 0xf4f4f8 }), k = new THREE.Mesh(g, mat);
      k.position.set(ux(m), blk ? 0.1 : -0.25, blk ? BACK + BLK_L / 2 : 0); k.userData = { blk, y0: k.position.y, col: blk ? 0x14151e : 0xf4f4f8 };
      scene.add(k); keys[m] = k;
    }
    // barres du rouleau (réserve)
    const bg = new THREE.BoxGeometry(1, 0.3, 1);
    barSp = []; for (let i = 0; i < 260; i++) { const q = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true })); q.scale.set(0.8, 0.8, 1); q.renderOrder = 9; q.visible = false; scene.add(q); barSp.push(q); }
    for (let i = 0; i < 260; i++) { const b = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color: 0xffffff })); b.visible = false; scene.add(b); bars.push(b); }
    // mains
    ['L', 'R'].forEach(h => {
      const g = new THREE.Group(), skin = new THREE.MeshLambertMaterial({ color: h === 'R' ? 0xe9b996 : 0xdcbca8 }), H = { g, fingers: [] };
      H.palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin); H.palm.scale.set(2.15, 0.36, 1.85); g.add(H.palm);
      H.thenar = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin); H.thenar.scale.set(0.62, 0.38, 0.95); g.add(H.thenar);   // base du pouce
      H.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 1, 16), skin); g.add(H.arm);
      for (let f = 1; f <= 5; f++) {
        const r = f === 1 ? 0.36 : 0.3, F = { f };
        F.p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), skin); F.m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r, 1, 10), skin); F.d = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.94, 1, 10), skin);
        F.j3 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 10, 8), skin);
        F.j1 = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), skin); F.j2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 10, 8), skin);
        F.tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.88, 10, 8), new THREE.MeshLambertMaterial({ color: h === 'R' ? 0xe9b996 : 0xdcbca8 }));
        F.sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: digit(f, h === 'R' ? '#ffc23a' : '#7fd0ff'), depthTest: false, transparent: true })); F.sp.scale.set(0.9, 0.9, 1); F.sp.renderOrder = 10;
        [F.p, F.m, F.d, F.j1, F.j2, F.j3, F.tip, F.sp].forEach(o => g.add(o)); H.fingers.push(F);
      }
      scene.add(g); hands[h] = H;
    });
    // anticipation : repères d'atterrissage (anneau + disque + numéro) et chaînes de perles des trajectoires ; pastilles des touches jouées (mode « aucune »)
    for (let i = 0; i < 10; i++) {
      const m = { ring: new THREE.Mesh(new THREE.RingGeometry(0.44, 0.58, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true })), disc: new THREE.Mesh(new THREE.CircleGeometry(0.43, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true })), sp: new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true })), beads: [] };
      m.ring.rotation.x = m.disc.rotation.x = -Math.PI / 2; m.sp.scale.set(0.9, 0.9, 1); m.sp.renderOrder = 11; scene.add(m.ring); scene.add(m.disc); scene.add(m.sp);
      for (let k = 0; k < 8; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })); b.visible = false; scene.add(b); m.beads.push(b); }
      m.ring.visible = m.disc.visible = m.sp.visible = false; marks.push(m);
    }
    for (let i = 0; i < 12; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true })); sp.scale.set(0.95, 0.95, 1); sp.renderOrder = 12; sp.visible = false; scene.add(sp); pastilles.push(sp); }
    built = { song, cx, w, ux, isBlack };
    layout();
  }
  function layout() {
    if (!built || !host) return;
    const W = host.clientWidth || 800, Hh = host.clientHeight || 500;
    if (size[0] !== W || size[1] !== Hh) { renderer.setSize(W, Hh, false); size = [W, Hh]; cam.aspect = W / Hh; cam.updateProjectionMatrix(); }
    place(cam);
  }
  // place une caméra selon l'orbite courante (angle, hauteur, zoom) et son rapport largeur/hauteur
  function place(c) {
    const hfov = 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect), dist = Math.max(14, (built.w / 2 + 1) / Math.tan(hfov / 2) * 0.92 + 4);
    const d = dist * 1.25 * orbit.zoom, ce = Math.cos(orbit.el), T = V(built.cx, 0, -2);
    c.position.set(T.x + d * Math.sin(orbit.az) * ce, d * Math.sin(orbit.el), T.z + d * Math.cos(orbit.az) * ce); c.lookAt(T);
    if (scene.fog) { scene.fog.near = d * 1.05; scene.fog.far = d * 2.2; }   // brume proportionnelle à la distance : même rendu quel que soit le format (écran ou vidéo)
  }
  // export vidéo : dessine la scène 3D (avec l'angle et le zoom choisis) au format de la vidéo (W × H, échelle k) dans un contexte 2D
  let rx, cam2;
  function renderTo(c2d, W, H, k) {
    if (!built) return;
    if (!rx) { rx = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); rx.setPixelRatio(1); rx.setClearColor(0x0e1120); cam2 = new THREE.PerspectiveCamera(38, 1, 0.1, 120); }
    const pw = Math.round(W * k), ph = Math.round(H * k);
    if (rx.domElement.width !== pw || rx.domElement.height !== ph) rx.setSize(pw, ph, false);
    cam2.aspect = W / H; cam2.updateProjectionMatrix(); place(cam2);
    rx.render(scene, cam2);
    c2d.setTransform(1, 0, 0, 1, 0, 0); c2d.drawImage(rx.domElement, 0, 0, pw, ph);
  }

  function render(st) {
    const song = st.song; if (!song) return;
    if (!built || built.song !== song) build(song, st.ux, st.isBlack);
    layout();
    const sp = st.sp, vis = st.vis, S = song.notes;
    const tips = {};   // positions courantes des bouts de doigts (départ des chaînes de perles)
    // touches : couleur de la main qui joue, enfoncées
    const on = {};
    for (let i = st.lowerBoundSec(sp - 10); i < S.length && S[i].t0 <= sp + AHEAD; i++) {
      const n = S[i]; if (!vis.includes(st.noteHand(n))) continue;
      if (n.t0 <= sp && sp < n.t1) on[n.midi] = st.noteHand(n);
    }
    for (const m in keys) {
      const k = keys[m], h = on[m]; k.material.color.setHex(h ? (h === 'R' ? CR : CL) : k.userData.col); k.position.y = k.userData.y0 - (h ? 0.14 : 0);
    }
    // rouleau
    let bi = 0;
    for (let i = st.lowerBoundSec(sp - 10); i < S.length && S[i].t0 <= sp + AHEAD && bi < bars.length; i++) {
      const n = S[i]; if (n.t1 < sp || !vis.includes(st.noteHand(n))) continue;
      const a = Math.max(0, n.t0 - sp), b = Math.min(AHEAD, n.t1 - sp), z0 = BACK - a * SPEED, z1 = BACK - b * SPEED, blk = built.isBlack(n.midi), bar = bars[bi++];
      { const q = barSp[bi - 1], f = st.fof && st.fing !== false ? st.fof(n) : 0;
        if (f) { const tex = digit(f, st.noteHand(n) === 'R' ? '#ffc23a' : '#7fd0ff'); if (q.material.map !== tex) { q.material.map = tex; q.material.needsUpdate = true; } q.visible = true; q.position.set(built.ux(n.midi), 0.85, z0 - 0.3); } else q.visible = false; }   // doigté (pastille) sur la note du rouleau
      bar.visible = true; bar.position.set(built.ux(n.midi), 0.3, (z0 + z1) / 2); bar.scale.set(blk ? 0.5 : 0.84, 1, Math.max(0.12, z0 - z1 - 0.06));
      bar.material.color.setHex(st.noteHand(n) === 'R' ? (blk ? 0xe0801a : CR) : (blk ? 0x2f78d8 : CL));
    }
    for (; bi < bars.length; bi++) bars[bi].visible = false;
    for (let i = 0; i < barSp.length; i++) if (i >= bi || !bars[i].visible) barSp[i].visible = false;
    // mains
    ['L', 'R'].forEach(h => {
      const H = hands[h], pl = st.plan && st.plan[h], show = vis.includes(h) && pl && !pl.empty && st.handsMode !== 'off'; H.g.visible = !!show; if (!show) return;
      const a = pl.at(sp), sg = h === 'L' ? -1 : 1, px = a.palm, col = h === 'R' ? CR : CL;
      H.palm.position.set(px, 1.05, 3.45); H.thenar.position.set(px - sg * 2.0, 0.85, 3.65);   // paume allongée vers les doigts : les articulations de base reposent sur elle
      limb(H.arm, V(px, 1.0, 4.9), V(px, 3.4, 13));
      const xs = a.fingers.map(f => f.x), pin = a.fingers.map(f => !!f.pressed || (f.depth || 0) > 0.6 || (f.wN || 0) > 0.85);
      enforceOrder(xs, pin, sg);
      // Règle d'enchaînement : un doigt voisin qui vient de jouer (ou de quitter sa touche) doit se replier AVANT que l'autre ne s'étende (ex. le 2 se replie avant que le 3 s'étende),
      // sinon les deux doigts se croisent ; le doigt qui arrive reste à demi replié tant que son voisin n'est pas replié.
      const kws = a.fingers.map(f => Math.max(f.pressed ? 1 : 0, f.depth || 0, f.wN || 0, 0.7 * (f.wP || 0)));
      for (let i = 1; i < 5; i++) {
        const f = a.fingers[i]; if (pin[i] || (f.wN || 0) <= (f.wP || 0)) continue;
        [i - 1, i + 1].forEach(j => { if (j < 1 || j > 4) return; const g = a.fingers[j]; if (pin[j] || (g.wP || 0) <= (g.wN || 0)) return; kws[i] = Math.min(kws[i], Math.max(0.3, 1 - 0.9 * kws[j])); });
      }
      // Mouvement simplifié : chaque doigt (2 à 5) ne fait que fléchir / s'étendre dans son plan vertical, sans rotation latérale. Pour atteindre sa touche, c'est
      // l'articulation de base (le doigt tout entier) qui glisse de côté, d'autant plus que le doigt s'engage (kws) ; le bout reste à la verticale de la base.
      const kx = a.fingers.map((f, i) => { const k0 = px + sg * (i - 2) * 0.84; return i === 0 ? k0 : k0 + (xs[i] - k0) * Math.min(1, kws[i]); });
      enforceOrder(kx, pin, sg);
      // paume extensible : elle s'élargit (et se décale) pour que la base de chaque doigt reste toujours sur elle
      { const bx = kx.slice(1).concat([px - sg * 1.9]), lo = Math.min(...bx), hi = Math.max(...bx);
        H.palm.position.x = (lo + hi) / 2; H.palm.scale.x = Math.max(2.15, (hi - lo) / 2 + 0.8); H.thenar.position.x = px - sg * 1.9 - sg * 0.1; }
      H.fingers.forEach(F => {
        const f = a.fingers[F.f - 1], fx = xs[F.f - 1], thumb = F.f === 1, off = sg * (F.f - 3);
        const K = V(thumb ? px + off * 0.95 : kx[F.f - 1], thumb ? 0.8 : 1.1, thumb ? 3.4 : 2.45), TOT = [3.0, 3.4, 3.9, 3.5, 2.7][F.f - 1], L1 = TOT * (thumb ? 0.45 : 0.46), L2 = TOT - L1;
        const blk = f.blk || 0, zt = 1.7 + (-0.9 - 1.7) * blk, yk = blk ? 0.55 : 0.1;
        const prep = f.pressed ? 0 : 4 * (f.wN || 0) * (1 - (f.wN || 0));   // doigt qui s'apprête à jouer : levée et élan un peu amplifiés
        const tipY = f.pressed ? yk + 0.2 : yk + 0.25 + ((f.lift || 0) * 2.3 * (1 + 0.3 * prep) + (0.55 + 0.75 * (1 - blk)) * prep) * (thumb ? 0.45 : 1) + (thumb ? 0 : 0.35 * (1 - f.depth));   // touche blanche : levée plus ample (la touche noire bouge déjà davantage)
        const T = V(thumb ? fx : K.x, tipY, f.pressed ? zt : zt + (1 - f.depth) * (0.5 + 0.8 * (1 - blk)) - 0.45 * prep);
        // doigt qui ne joue pas : il se soulève et se replie À MOITIÉ (flexion partielle, bout du doigt en l'air devant la phalange) ; il se déplie vers sa touche
        // à mesure qu'elle approche (wN), reste déplié un instant après la frappe (wP) puis se relâche
        if (!thumb) {
          const kw = kws[F.f - 1], curl = [0, 0.7, 0.7, 0.66, 0.6][F.f - 1];
          const rest = V(K.x, 0.8 + 0.25 * (f.lift || 0), K.z - TOT * curl);
          T.lerp(rest, 1 - Math.min(1, kw));
        }
        // doigt à 2 articulations (cinématique inverse dans le plan vertical K→T) : segments de longueur fixe ; il se replie quand la touche est proche
        // (doigt arrondi) et se tend jusqu'à l'extension complète quand la touche est loin (touche noire, doigt tendu vers l'avant)
        const dv = T.clone().sub(K), dist = dv.length(), dir = dv.clone().multiplyScalar(1 / (dist || 1e-4));
        if (!thumb && dist > TOT * 0.999) T.copy(K).add(dir.clone().multiplyScalar(TOT * 0.999));
        let dd, xx, hh;
        if (thumb) {   // le pouce ne se replie JAMAIS : il reste parfaitement droit, sa longueur apparente suit la distance à la touche
          dd = Math.max(dist, 0.5); xx = dd * 0.5; hh = 0;
        } else { dd = Math.min(dist, TOT * 0.999); xx = (dd * dd + L1 * L1 - L2 * L2) / (2 * dd); hh = Math.sqrt(Math.max(0, L1 * L1 - xx * xx)); }
        const up = Y.clone().sub(dir.clone().multiplyScalar(Y.dot(dir))); if (up.lengthSq() < 1e-4) up.set(0, 0, 1); up.normalize();
        const M = K.clone().add(dir.clone().multiplyScalar(xx)).add(up.multiplyScalar(hh));
        const D = M.clone().lerp(T, 0.55); D.y += thumb ? 0 : 0.06 + 0.12 * Math.min(1, hh / 1.4);
        limb(F.p, K, M); limb(F.m, M, D); limb(F.d, D, T); F.j1.position.copy(K); F.j2.position.copy(M); F.j3.position.copy(D); F.tip.position.copy(T);
        F.tip.material.color.setHex(f.pressed ? col : (h === 'R' ? 0xe9b996 : 0xdcbca8)); F.tip.material.emissive && F.tip.material.emissive.setHex(f.pressed ? 0x553300 : 0x000000);
        F.sp.visible = st.fing !== false; F.sp.position.set(T.x, T.y + 0.85, T.z); F.sp.material.opacity = f.pressed ? 1 : 0.55;
        const nextF = st.anticip && !f.pressed && (f.wN || 0) > 0.02;   // prochain doigt : pastille qui clignote (3 fois par seconde), bout du doigt qui s'éclaire
        if (nextF) { const bl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * performance.now() / 1000); F.sp.material.opacity = 1; F.sp.scale.setScalar(1.05 + 0.5 * bl); F.tip.material.color.setHex(col); F.tip.material.emissive && F.tip.material.emissive.setHex(bl > 0.5 ? 0x553300 : 0x221100); }
        else F.sp.scale.setScalar(0.9);
        tips[h + F.f] = T.clone();
      });
    });
    // repères d'atterrissage du prochain pas (anticipation, sauf « sans trajectoire ») et chemins des doigts (« avec trajectoires »)
    marks.forEach(m => { m.ring.visible = m.disc.visible = m.sp.visible = false; m.beads.forEach(b => { b.visible = false; }); });
    if (st.anticip && st.next && st.handsMode !== 'plain') {
      let mi = 0; const bl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * performance.now() / 1000);
      Object.keys(st.next.hands).forEach(h => st.next.hands[h].ps.forEach(p => {
        const m = marks[mi++]; if (!m) return;
        const blk = built.isBlack(p.midi), col = h === 'R' ? CR : CL, L = V(p.u, blk ? 0.7 : 0.18, blk ? BACK + BLK_L * 0.5 : 1.7), k = Math.max(0, Math.min(1, (st.next.hands[h].t - sp) / 0.9));
        m.ring.visible = m.disc.visible = m.sp.visible = true; m.ring.position.copy(L); m.disc.position.copy(L); m.sp.position.set(L.x, L.y + 0.7, L.z);
        m.ring.scale.setScalar(1 + 1.3 * k); m.ring.material.color.setHex(col); m.disc.material.color.setHex(col); m.disc.material.opacity = 0.55 + 0.45 * bl; m.ring.material.opacity = 0.9;
        m.sp.material.map = digit(p.f, h === 'R' ? '#ffc23a' : '#7fd0ff'); m.sp.material.needsUpdate = true;
        const T0 = tips[h + p.f];
        if (st.handsMode === 'traj' && T0 && T0.distanceTo(L) > 0.9) m.beads.forEach((b, i) => {
          const u = (i + 1) / (m.beads.length + 1) * 0.86, P = T0.clone().lerp(L, u); P.y += 0.9 * Math.sin(Math.PI * u) * (1 - 0.5 * k * 0);
          b.visible = true; b.position.copy(P); b.material.color.setHex(col); b.material.opacity = 0.5 + 0.5 * bl;
        });
      }));
    }
    // mode « aucune » (sans mains) : le doigt de chaque note jouée apparaît dans une pastille au-dessus de sa touche
    pastilles.forEach(sp => { sp.visible = false; });
    if (st.handsMode === 'off' && st.fof) {
      let pi = 0;
      for (let i = st.lowerBoundSec(sp - 10); i < S.length && S[i].t0 <= sp && pi < pastilles.length; i++) {
        const n = S[i]; if (!(n.t0 <= sp && sp < n.t1) || !vis.includes(st.noteHand(n))) continue; const f = st.fof(n); if (!f) continue;
        const blk = built.isBlack(n.midi), sp2 = pastilles[pi++]; sp2.visible = true; sp2.position.set(built.ux(n.midi), blk ? 1.2 : 0.8, blk ? BACK + BLK_L * 0.5 : 1.9);
        sp2.material.map = digit(f, st.noteHand(n) === 'R' ? '#ffc23a' : '#7fd0ff'); sp2.material.needsUpdate = true;
      }
    }
    renderer.render(scene, cam);
  }
  const zoomBy = f => { orbit.zoom = Math.max(0.25, Math.min(3, orbit.zoom * f)); };
  const show = on => { if (renderer) renderer.domElement.style.display = on ? 'block' : 'none'; if (ui) ui.style.display = on ? 'flex' : 'none'; };
  const el = () => renderer && renderer.domElement;
  return { init, render, renderTo, el, zoomBy, show };
})();
