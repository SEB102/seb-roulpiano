/* Vue 3D (essai) : clavier en perspective, rouleau qui s'éloigne derrière le clavier, mains virtuelles en volume.
   Utilise les plans de mains existants (hands.js / hands_legacy.js) : palm(t), finger(f, t) → { x, depth, blk, pressed, lift }.
   Unités : 1 = largeur d'une touche blanche ; x = hands.ux(midi) ; y = hauteur (0 = dessus des touches blanches) ; z = vers le joueur. */
const View3D = (() => {
  const KEY_L = 6, BLK_L = 3.6, BACK = -3, AHEAD = 3.2, SPEED = 4;       // longueur des touches ; fond du clavier ; secondes de rouleau visibles ; unités par seconde
  const CR = 0xffb347, CL = 0x5fb4ff;                                     // couleurs vives : main droite, main gauche
  const DEF = { az: 0, el: 55 * Math.PI / 180, zoom: 1.1 };
  let orbit = { ...DEF }, renderer, scene, cam, host, keys = {}, bars = [], hands = {}, built = null, size = [0, 0], tex = {};
  const V = (x, y, z) => new THREE.Vector3(x, y, z), Y = V(0, 1, 0);

  function digit(n, col) {
    const k = n + col, c = tex[k]; if (c) return c;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 5; g.strokeStyle = '#10121f'; g.stroke(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#10121f'; g.font = '800 36px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 34);
    return (tex[k] = new THREE.CanvasTexture(cv));
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
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (_) {} c.style.cursor = 'grabbing'; });
    c.addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      orbit.az = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, orbit.az - dx * 0.006)); orbit.el = Math.max(0.09, Math.min(1.5, orbit.el + dy * 0.005));
    });
    const end = e => { drag = null; c.style.cursor = 'grab'; }; c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => { e.preventDefault(); orbit.zoom = Math.max(0.35, Math.min(2.2, orbit.zoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    c.addEventListener('dblclick', () => { orbit = { ...DEF }; });
    scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x0e1120, 22, 46);
    cam = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3050, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-6, 16, 12); scene.add(sun);
    return renderer.domElement;
  }

  // construit clavier, rouleau et mains pour la plage de notes du morceau
  function build(song, ux, isBlack) {
    keys = {}; bars = []; hands = {};
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
    for (let i = 0; i < 260; i++) { const b = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color: 0xffffff })); b.visible = false; scene.add(b); bars.push(b); }
    // mains
    ['L', 'R'].forEach(h => {
      const g = new THREE.Group(), skin = new THREE.MeshLambertMaterial({ color: h === 'R' ? 0xe9b996 : 0xdcbca8 }), H = { g, fingers: [] };
      H.palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin); H.palm.scale.set(2.4, 0.55, 1.7); g.add(H.palm);
      H.arm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 1, 16), skin); g.add(H.arm);
      for (let f = 1; f <= 5; f++) {
        const r = f === 1 ? 0.36 : 0.3, F = { f };
        F.p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), skin); F.d = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r, 1, 10), skin);
        F.j1 = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), skin); F.j2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 10, 8), skin);
        F.tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.88, 10, 8), new THREE.MeshLambertMaterial({ color: h === 'R' ? 0xe9b996 : 0xdcbca8 }));
        F.sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: digit(f, h === 'R' ? '#ffc23a' : '#7fd0ff'), depthTest: false, transparent: true })); F.sp.scale.set(0.9, 0.9, 1); F.sp.renderOrder = 10;
        [F.p, F.d, F.j1, F.j2, F.tip, F.sp].forEach(o => g.add(o)); H.fingers.push(F);
      }
      scene.add(g); hands[h] = H;
    });
    built = { song, cx, w, ux, isBlack };
    layout();
  }
  function layout() {
    if (!built || !host) return;
    const W = host.clientWidth || 800, Hh = host.clientHeight || 500;
    if (size[0] !== W || size[1] !== Hh) { renderer.setSize(W, Hh, false); size = [W, Hh]; cam.aspect = W / Hh; cam.updateProjectionMatrix(); }
    const hfov = 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect), dist = Math.max(14, (built.w / 2 + 1) / Math.tan(hfov / 2) * 0.92 + 4);
    const d = dist * 1.25 * orbit.zoom, ce = Math.cos(orbit.el), T = V(built.cx, 0, -2);
    cam.position.set(T.x + d * Math.sin(orbit.az) * ce, d * Math.sin(orbit.el), T.z + d * Math.cos(orbit.az) * ce); cam.lookAt(T);
  }

  function render(st) {
    const song = st.song; if (!song) return;
    if (!built || built.song !== song) build(song, st.ux, st.isBlack);
    layout();
    const sp = st.sp, vis = st.vis, S = song.notes;
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
      bar.visible = true; bar.position.set(built.ux(n.midi), 0.3, (z0 + z1) / 2); bar.scale.set(blk ? 0.5 : 0.84, 1, Math.max(0.12, z0 - z1 - 0.06));
      bar.material.color.setHex(st.noteHand(n) === 'R' ? (blk ? 0xe0801a : CR) : (blk ? 0x2f78d8 : CL));
    }
    for (; bi < bars.length; bi++) bars[bi].visible = false;
    // mains
    ['L', 'R'].forEach(h => {
      const H = hands[h], pl = st.plan && st.plan[h], show = vis.includes(h) && pl && !pl.empty; H.g.visible = !!show; if (!show) return;
      const a = pl.at(sp), sg = h === 'L' ? -1 : 1, px = a.palm, col = h === 'R' ? CR : CL;
      const palmC = V(px, 1.25, 4.1); H.palm.position.copy(palmC);
      limb(H.arm, V(px, 1.2, 5.2), V(px, 3.6, 13)); H.arm.scale.x = 1; H.arm.scale.z = 1;
      H.fingers.forEach(F => {
        const f = a.fingers[F.f - 1], thumb = F.f === 1, off = sg * (F.f - 3);
        const K = V(px + off * (thumb ? 1.0 : 0.88), thumb ? 0.85 : 1.15, thumb ? 3.5 : 2.55);
        const blk = f.blk || 0, zt = 1.7 + (-0.9 - 1.7) * blk, yk = blk ? 0.55 : 0.1;
        const prep = f.pressed ? 0 : 4 * (f.wN || 0) * (1 - (f.wN || 0));   // doigt qui s'apprête à jouer : levée et élan un peu amplifiés
        const tipY = f.pressed ? yk + 0.2 : yk + 0.25 + (f.lift || 0) * 2.3 * (1 + 0.3 * prep) + (0.55 + 0.75 * (1 - blk)) * prep + (thumb ? 0 : 0.35 * (1 - f.depth));   // touche blanche : levée plus ample (la touche noire bouge déjà davantage)
        const T = V(f.x, tipY, f.pressed ? zt : zt + (1 - f.depth) * (0.5 + 0.8 * (1 - blk)) - 0.45 * prep);
        const M = K.clone().lerp(T, 0.52); M.y += 0.4 + 0.55 * (f.lift || 0) + 0.3 * prep - 0.3 * f.depth;
        limb(F.p, K, M); limb(F.d, M, T); F.j1.position.copy(K); F.j2.position.copy(M); F.tip.position.copy(T);
        F.tip.material.color.setHex(f.pressed ? col : (h === 'R' ? 0xe9b996 : 0xdcbca8)); F.tip.material.emissive && F.tip.material.emissive.setHex(f.pressed ? 0x553300 : 0x000000);
        F.sp.position.set(T.x, T.y + 0.85, T.z); F.sp.material.opacity = f.pressed ? 1 : 0.55;
      });
    });
    renderer.render(scene, cam);
  }
  const el = () => renderer && renderer.domElement;
  return { init, render, el };
})();
