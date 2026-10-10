/* Vue 3D (essai) : clavier en perspective, rouleau qui s'éloigne derrière le clavier, mains virtuelles en volume.
   Utilise les plans de mains existants (hands.js / hands_legacy.js) : palm(t), finger(f, t) → { x, depth, blk, pressed, lift }.
   Unités : 1 = largeur d'une touche blanche ; x = hands.ux(midi) ; y = hauteur (0 = dessus des touches blanches) ; z = vers le joueur. */
const View3D = (() => {
  const KEY_L = 6, BLK_L = 3.6, BACK = -3, AHEAD = 3.2, SPEED = 4;       // longueur des touches ; fond du clavier ; secondes de rouleau visibles ; unités par seconde
  const CR = 0xffb347, CL = 0x5fb4ff;                                     // couleurs vives : main droite, main gauche
  const DEF = { az: 0, el: 55 * Math.PI / 180, zoom: 1.1 };
  const stats = { back: 0, n: 0 };
  let gridL = [], gridS = [], lblTex = {}, sun, barSp = [], ui, marks = [], pastilles = [], orbit = { ...DEF }, renderer, scene, cam, host, keys = {}, bars = [], hands = {}, built = null, size = [0, 0], tex = {};
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
  function measureTex(label) {
    if (lblTex[label]) return lblTex[label];
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = 'rgba(40,48,86,.95)'; g.beginPath(); g.moveTo(12, 6); g.lineTo(116, 6); g.quadraticCurveTo(124, 6, 124, 14); g.lineTo(124, 50); g.quadraticCurveTo(124, 58, 116, 58); g.lineTo(12, 58); g.quadraticCurveTo(4, 58, 4, 50); g.lineTo(4, 14); g.quadraticCurveTo(4, 6, 12, 6); g.fill();
    g.fillStyle = '#fff'; g.font = '700 38px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(label), 64, 34);
    return (lblTex[label] = new THREE.CanvasTexture(cv));
  }
  function limb(mesh, a, b) {
    const d = b.clone().sub(a), L = d.length() || 1e-4; mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.set(1, L, 1);
    mesh.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / L));
  }
  function init(container) {
    host = container;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      orbit.az = ((orbit.az - dx * 0.006) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); /* tour complet à 360° */ orbit.el = Math.max(0.09, Math.min(1.5, orbit.el + dy * 0.005));
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
    scene.add(new THREE.HemisphereLight(0xfff6ee, 0x2a3050, 0.55));
    sun = new THREE.DirectionalLight(0xfff0e0, 1.05); sun.position.set(-7, 18, 11); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    scene.add(sun); scene.add(sun.target);
    { const rim = new THREE.DirectionalLight(0xa8c0ff, 0.4); rim.position.set(9, 7, -11); scene.add(rim); }   // contre-jour froid : contours des doigts
   // reflets doux (panneaux lumineux) : brillance de la peau, des ongles et des touches
    return renderer.domElement;
  }

  // construit clavier, rouleau et mains pour la plage de notes du morceau
  function build(song, ux, isBlack) {
    keys = {}; bars = []; hands = {}; marks = []; pastilles = [];
    while (scene.children.length > 4) scene.remove(scene.children[scene.children.length - 1]);
    let lo = 127, hi = 0; song.notes.forEach(n => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    const m0 = Math.max(21, lo - 10), m1 = Math.min(108, hi + 10);
    const x0 = ux(m0) - 0.5, x1 = ux(m1) + 0.5, cx = (x0 + x1) / 2, w = x1 - x0;
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.55, metalness: 0, envMapIntensity: 0.4 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.5, KEY_L + 0.8), wood); bed.position.set(cx, -0.55, 0); bed.receiveShadow = true; scene.add(bed);
    const front = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1, 0.6), wood); front.position.set(cx, -0.3, KEY_L / 2 + 0.5); scene.add(front);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1.1, 0.5), wood); back.position.set(cx, 0.2, BACK - 0.3); scene.add(back);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ color: 0x141830 })); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -0.85, 0); floor.receiveShadow = true; scene.add(floor);
    for (let m = m0; m <= m1; m++) {
      const blk = isBlack(m), g = blk ? new THREE.BoxGeometry(0.58, 0.7, BLK_L) : new THREE.BoxGeometry(0.94, 0.5, KEY_L);
      const mat = new THREE.MeshStandardMaterial({ color: blk ? 0x14151e : 0xf4f4f8, roughness: blk ? 0.22 : 0.36, metalness: 0, envMapIntensity: 0.5 }), k = new THREE.Mesh(g, mat);
      k.position.set(ux(m), blk ? 0.1 : -0.25, blk ? BACK + BLK_L / 2 : 0); k.userData = { blk, y0: k.position.y, col: blk ? 0x14151e : 0xf4f4f8 };
      k.castShadow = k.receiveShadow = true; scene.add(k); keys[m] = k;
    }
    // barres du rouleau (réserve)
    const bg = new THREE.BoxGeometry(1, 0.3, 1);
    barSp = []; for (let i = 0; i < 260; i++) { const q = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, depthTest: false, transparent: true })); q.scale.set(0.8, 0.8, 1); q.renderOrder = 9; q.visible = false; scene.add(q); barSp.push(q); }
    for (let i = 0; i < 260; i++) { const b = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, envMapIntensity: 0.4 })); b.visible = false; scene.add(b); bars.push(b); }
    // repères temporels : barres de mesure (épaisses, avec numéro) et temps (fins) posés sur le plan du rouleau ; ils tournent avec la scène
    gridL = []; gridS = [];
    for (let i = 0; i < 60; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false })); l.visible = false; l.renderOrder = 1; scene.add(l); gridL.push(l); }
    for (let i = 0; i < 12; i++) { const q = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, depthTest: false, transparent: true })); q.scale.set(2.4, 1.2, 1); q.renderOrder = 8; q.visible = false; scene.add(q); gridS.push(q); }
    // mains
    ['L', 'R'].forEach(h => {
      const g = new THREE.Group(), H = { g, fingers: [] };
      // mains en traits épais (à la MediaPipe) : points d'articulation reliés par des traits de la couleur de la main (poignet, 4 articulations par doigt, paume en polygone)
      const cmat = new THREE.MeshStandardMaterial({ color: h === 'R' ? CR : CL, roughness: 0.45, metalness: 0, emissive: h === 'R' ? 0x663300 : 0x103a66, emissiveIntensity: 0.5 }), jmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, emissive: 0x444444, emissiveIntensity: 0.4 });
      const cyl = r => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14), cmat); m.castShadow = true; return m; }, sph = (r, mat) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat || jmat); m.castShadow = true; return m; };
      H.sk = { g, palmB: [0, 1, 2, 3, 4, 5].map(() => cyl(0.24)), wrist: sph(0.38), fing: [] };
      g.add(H.sk.wrist); H.sk.palmB.forEach(b => g.add(b));
      for (let f = 1; f <= 5; f++) {
        const F = { f }, tipMat = jmat.clone(), o = { b: [cyl(0.22), cyl(0.22), cyl(0.22)], j: [sph(0.31), sph(0.29), sph(0.27), sph(0.25, tipMat)], tipMat };
        F.sp = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, map: digit(f, h === 'R' ? '#ffc23a' : '#7fd0ff'), depthTest: false, transparent: true })); F.sp.scale.set(0.9, 0.9, 1); F.sp.renderOrder = 10;
        o.b.forEach(b => g.add(b)); o.j.forEach(j => g.add(j)); g.add(F.sp); H.sk.fing.push(o); H.fingers.push(F);
      }
      scene.add(g); hands[h] = H;
    });
    // anticipation : repères d'atterrissage (anneau + disque + numéro) et chaînes de perles des trajectoires ; pastilles des touches jouées (mode « aucune »)
    for (let i = 0; i < 10; i++) {
      const m = { ring: new THREE.Mesh(new THREE.RingGeometry(0.44, 0.58, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true })), disc: new THREE.Mesh(new THREE.CircleGeometry(0.43, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true })), sp: new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, depthTest: false, transparent: true })), beads: [] };
      m.ring.rotation.x = m.disc.rotation.x = -Math.PI / 2; m.sp.scale.set(0.9, 0.9, 1); m.sp.renderOrder = 11; scene.add(m.ring); scene.add(m.disc); scene.add(m.sp);
      for (let k = 0; k < 8; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })); b.visible = false; scene.add(b); m.beads.push(b); }
      m.ring.visible = m.disc.visible = m.sp.visible = false; marks.push(m);
    }
    for (let i = 0; i < 12; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, depthTest: false, transparent: true })); sp.scale.set(0.95, 0.95, 1); sp.renderOrder = 12; sp.visible = false; scene.add(sp); pastilles.push(sp); }
    built = { song, cx, w, ux, isBlack };
    { const sc = sun.shadow.camera, hw = w / 2 + 3; sc.left = -hw; sc.right = hw; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60; sc.updateProjectionMatrix(); sun.position.set(cx - 7, 18, 11); sun.target.position.set(cx, 0, 1); sun.target.updateMatrixWorld(); }
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
    if (!rx) { rx = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); rx.shadowMap.enabled = true; rx.shadowMap.type = THREE.PCFSoftShadowMap; rx.setPixelRatio(1); rx.setClearColor(0x0e1120); cam2 = new THREE.PerspectiveCamera(38, 1, 0.1, 120); }
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
    // barres de mesure et temps
    { const G = st.grid || [], x0 = built.cx - built.w / 2; let li = 0, si = 0;
      G.forEach(e => {
        const z = BACK - (e.t - sp) * SPEED, l = gridL[li++]; if (!l) return;
        l.visible = true; l.position.set(built.cx, e.bar ? 0.17 : 0.15, z); l.scale.set(built.w, 1, e.bar ? 0.14 : 0.06); l.material.opacity = e.bar ? 0.75 : 0.38;
        if (e.bar && e.label !== undefined) { const q = gridS[si++]; if (q) { const tex = measureTex(e.label); if (q.material.map !== tex) { q.material.map = tex; q.material.needsUpdate = true; } q.visible = true; q.position.set(x0 + 1.4, 0.7, z); } }
      });
      for (; li < gridL.length; li++) gridL[li].visible = false; for (; si < gridS.length; si++) gridS[si].visible = false; }
    stats.n++;
    // mains
    ['L', 'R'].forEach(h => {
      const H = hands[h], pl = st.plan && st.plan[h], show = vis.includes(h) && pl && !pl.empty && st.handsMode !== 'off'; H.g.visible = !!show; if (!show) return;
      const a = pl.at(sp), sg = h === 'L' ? -1 : 1, px = a.palm, col = h === 'R' ? CR : CL;
      const xs = a.fingers.map(f => f.x), pin = a.fingers.map(f => !!f.pressed || (f.depth || 0) > 0.6 || (f.wN || 0) > 0.85);
      enforceOrder(xs, pin, sg);
      // Règle d'enchaînement : un doigt voisin qui vient de jouer (ou de quitter sa touche) doit se replier AVANT que l'autre ne s'étende (ex. le 2 se replie avant que le 3 s'étende),
      // sinon les deux doigts se croisent ; le doigt qui arrive reste à demi replié tant que son voisin n'est pas replié.
      const kws = a.fingers.map(f => Math.max(f.pressed ? 1 : 0, f.depth || 0, f.wN || 0, 0.7 * (f.wP || 0)));
      for (let i = 1; i < 5; i++) {
        const f = a.fingers[i]; if (pin[i] || (f.wN || 0) <= (f.wP || 0)) continue;
        [i - 1, i + 1].forEach(j => { if (j < 1 || j > 4) return; const g = a.fingers[j]; if (pin[j] || (g.wP || 0) <= (g.wN || 0)) return; kws[i] = Math.min(kws[i], Math.max(0.3, 1 - 0.9 * kws[j])); });
      }
      // Mouvements : la première articulation (base du doigt, côté paume) est la seule à pivoter latéralement ; les deux suivantes ne font que fléchir / s'étendre
      // dans le plan vertical du doigt (cinématique inverse ci-dessous).
      const kx = a.fingers.map((f, i) => px + sg * (i - 2) * 0.84);   // bases des doigts : fixes sur la paume
      // Poignet : légère rotation dans les trois dimensions (≈ ±10° au plus) de la main entière autour du poignet W :
      //  lacet vers le côté où les doigts vont jouer, tangage (main un peu relevée au repos, abaissée à l'appui), roulis vers le côté du doigt qui appuie.
      const W0 = V(px, 1.1, 6.3), mf = kws.slice(1), mk = mf.reduce((u, v) => u + v, 0) / 4, wsum = kws.reduce((u, v) => u + v, 0) || 1;
      const dxm = a.fingers.reduce((u, f, i) => u + kws[i] * (xs[i] - kx[i]), 0) / wsum, side = a.fingers.reduce((u, f, i) => u + kws[i] * sg * (i - 2), 0) / wsum;
      const wrot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.max(-0.1, Math.min(0.1, 0.14 * (0.5 - mk))), -Math.max(-0.17, Math.min(0.17, dxm * 0.07)), -Math.max(-0.1, Math.min(0.1, 0.05 * side)), 'YXZ'));
      const rotW = p => p.sub(W0).applyMatrix4(wrot).add(W0);
      { const e = new THREE.Euler().setFromRotationMatrix(wrot, 'YXZ'); stats.rot = stats.rot || [0, 0, 0]; stats.rot[0] = Math.max(stats.rot[0], Math.abs(e.y)); stats.rot[1] = Math.max(stats.rot[1], Math.abs(e.x)); stats.rot[2] = Math.max(stats.rot[2], Math.abs(e.z)); }
      H.fingers.forEach(F => {
        const f = a.fingers[F.f - 1], fx = xs[F.f - 1], thumb = F.f === 1, off = sg * (F.f - 3);
        const K = rotW(V(thumb ? px + off * 0.95 : kx[F.f - 1], thumb ? 0.8 : 1.1, thumb ? 4.3 : 3.95)), TOT = [3.0, 3.4, 3.9, 3.5, 2.7][F.f - 1], L1 = TOT * (thumb ? 0.45 : 0.46), L2 = TOT - L1;
        const blk = f.blk || 0, zt = 1.7 + (-0.9 - 1.7) * blk, yk = blk ? 0.55 : 0.1;
        const prep = f.pressed ? 0 : 4 * (f.wN || 0) * (1 - (f.wN || 0));   // doigt qui s'apprête à jouer : levée et élan un peu amplifiés
        const tipY = f.pressed ? yk + 0.2 : yk + 0.25 + ((f.lift || 0) * 2.3 * (1 + 0.3 * prep) + (0.55 + 0.75 * (1 - blk)) * prep) * (thumb ? 0.45 : 1) + (thumb ? 0 : 0.35 * (1 - f.depth));   // touche blanche : levée plus ample (la touche noire bouge déjà davantage)
        const T = V(fx, tipY, f.pressed ? zt : zt + (1 - f.depth) * (0.5 + 0.8 * (1 - blk)) - 0.45 * prep);
        // doigt qui ne joue pas : il se soulève et se replie À MOITIÉ (flexion partielle, bout du doigt en l'air devant la phalange) ; il se déplie vers sa touche
        // à mesure qu'elle approche (wN), reste déplié un instant après la frappe (wP) puis se relâche
        if (!thumb) {
          const kw = kws[F.f - 1], curl = [0, 0.7, 0.7, 0.66, 0.6][F.f - 1];
          const rest = V(K.x, 0.8 + 0.25 * (f.lift || 0), K.z - TOT * curl);
          T.lerp(rest, 1 - Math.min(1, kw));
        }
        // doigt à 2 articulations (cinématique inverse dans le plan vertical K→T) : segments de longueur fixe ; il se replie quand la touche est proche
        // (doigt arrondi) et se tend jusqu'à l'extension complète quand la touche est loin (touche noire, doigt tendu vers l'avant)
        if (!thumb) { const lim = Math.abs(K.z - T.z) * Math.tan(28 * Math.PI / 180) + 0.25; T.x = K.x + Math.max(-lim, Math.min(lim, T.x - K.x)); }   // rotation latérale uniquement à la première articulation (base du doigt), limitée à ±28°
        if (thumb) {   // pouce à 2 phalanges, longueur quasi fixe (1,8 à 2,5 touches) : c'est sa base qui glisse vers la touche, il ne s'étire pas
          const d0 = T.clone().sub(K), l0 = d0.length(), le = Math.max(1.8, Math.min(2.5, l0)); if (l0 > 1e-4 && Math.abs(l0 - le) > 1e-4) K.copy(T).sub(d0.multiplyScalar(le / l0));
        }
        const dv = T.clone().sub(K), dist = dv.length(), dir = dv.clone().multiplyScalar(1 / (dist || 1e-4));
        if (!thumb && dist > TOT * 0.999) T.copy(K).add(dir.clone().multiplyScalar(TOT * 0.999));
        let dd, xx, hh;
        if (thumb) {   // le pouce ne se replie JAMAIS : il reste parfaitement droit, sa longueur apparente suit la distance à la touche
          dd = Math.max(dist, 0.5); xx = dd * 0.64; hh = 0;   // dernier segment (distal) du pouce raccourci : 36 % de la longueur au lieu de 50 %
        } else { dd = Math.min(dist, TOT * 0.999); xx = (dd * dd + L1 * L1 - L2 * L2) / (2 * dd); hh = Math.sqrt(Math.max(0, L1 * L1 - xx * xx)); }
        const up = Y.clone().sub(dir.clone().multiplyScalar(Y.dot(dir))); if (up.lengthSq() < 1e-4) up.set(0, 0, 1); up.normalize();
        const M = K.clone().add(dir.clone().multiplyScalar(xx)).add(up.multiplyScalar(hh));
        // le premier segment (côté paume) ne bascule jamais vers l'arrière ni à plus de 65° au-dessus de l'horizontale : un doigt qui se soulève se replie vers l'avant
        if (!thumb) {
          const fwd = K.z - M.z, c65 = Math.cos(65 * Math.PI / 180), s65 = Math.sin(65 * Math.PI / 180);
          if (fwd < L1 * c65) {
            M.set(K.x, K.y + L1 * s65, K.z - L1 * c65);
          }
        }
        const D = M.clone().lerp(T, 0.55); D.y += thumb ? 0 : 0.06 + 0.12 * Math.min(1, hh / 1.4);
        const tm = H.sk.fing[F.f - 1].tipMat; tm.color.setHex(f.pressed ? col : 0xffffff); tm.emissive.setHex(f.pressed ? 0x553300 : 0x444444);   // bout du doigt qui joue : couleur vive
        F.sp.visible = st.fing !== false; F.sp.position.set(T.x, T.y + 0.85, T.z); F.sp.material.opacity = f.pressed ? 1 : 0.55;
        const nextF = st.anticip && !f.pressed && (f.wN || 0) > 0.02;   // prochain doigt : pastille qui clignote (3 fois par seconde), bout du doigt qui s'éclaire
        if (nextF) { const bl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * performance.now() / 1000); F.sp.material.opacity = 1; F.sp.scale.setScalar(1.05 + 0.5 * bl); tm.color.setHex(col); tm.emissive.setHex(bl > 0.5 ? 0x553300 : 0x221100); }
        else F.sp.scale.setScalar(0.9);
        if (!thumb && (M.z > K.z + 0.05 || D.z > M.z + 0.05 || T.z > D.z + 0.05)) stats.back++; tips[h + F.f] = T.clone(); F.pts = thumb ? [K.clone(), M.clone(), T.clone()] : [K.clone(), M.clone(), D.clone(), T.clone()];   // le pouce n'a que deux phalanges
      });
      // squelette : poignet, paume en polygone (poignet–pouce, poignet–index, poignet–auriculaire, ligne des bases des doigts), 3 traits et 4 points par doigt
      { const sk = H.sk, W = V(px, 1.1, 6.3); sk.wrist.position.copy(W);
        const P = H.fingers.map(F => F.pts);
        [[W, P[0][0]], [W, P[1][0]], [W, P[4][0]], [P[1][0], P[2][0]], [P[2][0], P[3][0]], [P[3][0], P[4][0]]].forEach(([a, b], i) => limb(sk.palmB[i], a, b));
        H.fingers.forEach((F, i) => { const o = sk.fing[i], q = F.pts, n = q.length; for (let k = 0; k < 3; k++) { o.b[k].visible = k < n - 1; if (k < n - 1) limb(o.b[k], q[k], q[k + 1]); } const ji = n === 3 ? [0, 1, 3] : [0, 1, 2, 3]; o.j.forEach((j, k) => { const at = ji.indexOf(k); j.visible = at >= 0; if (at >= 0) j.position.copy(q[at]); }); });
      }
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
  return { init, render, renderTo, el, zoomBy, show, stats };
})();
