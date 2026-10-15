/* Vue 3D (essai) : clavier en perspective, rouleau qui s'éloigne derrière le clavier, mains virtuelles en volume.
   Utilise les plans de mains existants (hands.js / hands_legacy.js) : palm(t), finger(f, t) → { x, depth, blk, pressed, lift }.
   Unités : 1 = largeur d'une touche blanche ; x = hands.ux(midi) ; y = hauteur (0 = dessus des touches blanches) ; z = vers le joueur. */
const View3D = (() => {
  let contact = !/[?&]touches=note/.test((typeof location !== 'undefined' && location.search) || '');   // enfoncement des touches par le contact du doigt (true) ou par la note (false)
  const KEY_L = 6, BLK_L = 3.6, BACK = -3, AHEAD = 3.2, SPEED = 4;       // longueur des touches ; fond du clavier ; secondes de rouleau visibles ; unités par seconde
  const CR = 0xffb347, CL = 0x5fb4ff;                                     // couleurs vives : main droite, main gauche
  const DEF = { az: 0, el: 55 * Math.PI / 180, zoom: 1.1 };
  const stats = { back: 0, n: 0 };
  let onScroll = null;   // défilement du rouleau, en secondes (> 0 = le temps avance)
  let gridL = [], gridS = [], boxG = null, lblTex = {}, sun, barSp = [], ui, marks = [], pastilles = [], orbit = { ...DEF }, renderer, scene, cam, host, keys = {}, bars = [], hands = {}, built = null, size = [0, 0], tex = {};
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
  function enforceOrder(xs, pin, sg) { PianoHands.enforceFingerOrder(xs, pin, sg, PianoHands.FINGER_GAP); }   // règle unique, définie dans hands.js
  function nameTex(label) {
    const key = 'n:' + label; if (lblTex[key]) return lblTex[key];
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.font = '700 56px -apple-system, "Helvetica Neue", "Apple Symbols", "Segoe UI Symbol", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 64, 34);
    return (lblTex[key] = new THREE.CanvasTexture(cv));
  }
  function measureTex(label) {
    if (lblTex[label]) return lblTex[label];
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = 'rgba(40,48,86,.95)'; g.beginPath(); g.moveTo(12, 6); g.lineTo(116, 6); g.quadraticCurveTo(124, 6, 124, 14); g.lineTo(124, 50); g.quadraticCurveTo(124, 58, 116, 58); g.lineTo(12, 58); g.quadraticCurveTo(4, 58, 4, 50); g.lineTo(4, 14); g.quadraticCurveTo(4, 6, 12, 6); g.fill();
    g.fillStyle = '#fff'; g.font = '700 ' + (String(label).length <= 3 ? 38 : String(label).length === 4 ? 30 : 24) + 'px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(label), 64, 34);
    return (lblTex[label] = new THREE.CanvasTexture(cv));
  }
  // erreur minimale entre le bout visé (tu horizontal, ty vertical depuis la base du doigt) et l'ensemble des poses anatomiquement possibles d'un doigt de longueur totale TOT
  // lv : niveau de hauteur de la ligne des bases (0 bas, 1 moyen, 2 haut) ; flexion préférée : bas → doigts presque à plat (5° / 10°), haut → flexion naturelle (25° / 45°)
  const FLEXP = [[5, 10], [12, 28], [25, 45]], lvOf = h => h < 0.9 ? 0 : h < 1.5 ? 1 : 2;
  // x.2 (dernier segment) : sa flexion vaut de 0,15 à 0,45 fois celle de x.1 (tolérance) ; il ne dépasse pas −100° (la verticale, 10° de tolérance)
  const RR3 = [0.45, 0.3, 0.15], A3MIN = -100;
  function chainErr(TOT, tu, ty, th, lv) {
    const La = TOT * 0.37, Lb = TOT * 0.32, Lc = TOT * 0.31, R = Math.PI / 180; let m = Infinity;
    for (let dz = 0; dz <= 0; dz += 1) for (let d1 = -10; d1 <= 70; d1 += 5) for (let f2 = 0; f2 <= 90; f2 += 10) for (const rr of RR3) {   // d1 : flexion de la 1re articulation par rapport à la paume (0 = plat dans son prolongement)
      const a1 = (th - d1) * R, a2 = a1 - f2 * R, a3 = a2 - rr * f2 * R;
      if (a2 < -90 * R || a3 < A3MIN * R) continue;   // RÈGLE : aucun segment ne pointe vers l'arrière (angle absolu ≥ −90° : jamais au-delà de la verticale) ; tolérance au repliement arrière : 0
      const u = La * Math.cos(a1) + Lb * Math.cos(a2) + Lc * Math.cos(a3), y = La * Math.sin(a1) + Lb * Math.sin(a2) + Lc * Math.sin(a3);
      const err = Math.hypot(u + dz - tu, y - ty) + 0.005 * Math.abs(d1 - FLEXP[lv][0]) + 0.003 * Math.abs(f2 - FLEXP[lv][1]) + 0.002 * Math.abs(rr - 0.45) * f2 + 0.03 * Math.abs(dz); if (err < m) m = err;
    }
    return m;
  }
  // TEST MODELE 3D : constantes de la main solide
  const LACET = [null, [-20, 20], [-20, 20], [-20, 20], [-10, 45]];   // lacet permis à la base x.0 (degrés ; + = vers le côté du 5) : 2, 3, 4 : ±20° ; 5 : 5° vers le pouce, 45° vers l'extérieur
  let blackXs = [];   // positions (x) des touches noires du clavier construit : sert à interdire que les os des doigts passent dans les touches
  const YMIN = 0.6, YMIN_W = 0.2, YCAP = 2.0, BASE_ZMAX = 3.3;   // hauteur minimale du poignet, de la paume et des bases des doigts (au-dessus des touches noires, dessus à 0,45) ; plafond de la ligne des bases quand un doigt joue
  const D2R = Math.PI / 180, SP = 1.07, PALM = 4.0, ZW = KEY_L / 2, ZB = BACK + BLK_L, YMAX = 3 * SP, RF = [4.2, 3.2, 3.6, 3.1, 2.4];
  const LOC = [[-(SP + 0.55) * 2 / 3, (PALM - 1.2) * 2 / 3, -0.1],   // 1.0 : distance P–1.0 réduite d'un tiers (≈ 2,15 touches)
     [-SP, PALM, 0], [0, PALM, 0], [SP, PALM, 0], [2 * SP, PALM, 0]];   // [latéral vers le 5, avant, haut] depuis P : 1.0, 2.0, 3.0, 4.0, 5.0
  // POUCE : 1.0 (base) : inclinaison +45° (haut) à −10° (bas), roulis 0, lacet 90° vers l'extérieur (côté opposé au 5) à 45° vers l'intérieur ; 1.1 : roulis 0, lacet 0, inclinaison 0 à 90° vers le bas ; longueurs fixes
  const TL1 = 1.6, TL2 = 1.2, TPSI = [-15, 90], TINC = [-10, 45], TFLX = [0, 25];   // psi > 0 = vers l'extérieur ; repère local (l vers le 5, f vers l'avant, n normale de la paume)
  const thumbOff = (psi, inc, flx) => { const bt = psi * D2R, al = inc * D2R, fx = flx * D2R;
    // repère du pouce tourné de 90° par rapport à celui des doigts : son « lacet » (psi, de −45° à +90°) l'abaisse vers les touches (+) ou le relève (−) ; son « inclinaison » (inc, de −10° à +45°) l'écarte
    // de l'index dans le plan de la paume (+) ou le rapproche (−) ; 1.1 fléchit de flx° dans le plan de la paume, vers l'index (son « bas » est latéral), sans lacet ni roulis
    const u1 = [-Math.sin(al) * Math.cos(bt), Math.cos(al) * Math.cos(bt), -Math.sin(bt)], m = [TL1 * u1[0], TL1 * u1[1], TL1 * u1[2]];
    const u2 = [Math.cos(fx) * u1[0] + Math.sin(fx) * Math.cos(al), Math.cos(fx) * u1[1] + Math.sin(fx) * Math.sin(al), Math.cos(fx) * u1[2]];
    return { m, t: [m[0] + TL2 * u2[0], m[1] + TL2 * u2[1], m[2] + TL2 * u2[2]] }; };
  let THF = null;   // champ de distance (voxels de 0,25 touche, ±5) à l'ensemble des positions du bout du pouce atteignables
  const THN = 41, THS = 0.25, THR = 5;
  function thumbField() {
    if (THF) return THF; const pts = [];
    for (let psi = TPSI[0]; psi <= TPSI[1]; psi += 15) for (let inc = TINC[0]; inc <= TINC[1]; inc += 5) for (let flx = TFLX[0]; flx <= TFLX[1]; flx += 10) { const o = thumbOff(psi, inc, flx); if (o.m[1] < 0 || o.t[1] - o.m[1] < 0) continue; pts.push(o.t); }   // RÈGLE : aucun segment du pouce ne pointe vers l'arrière (vers le poignet) : pas de pouce replié sous la main
    THF = new Float32Array(THN * THN * THN);
    for (let a = 0; a < THN; a++) for (let b = 0; b < THN; b++) for (let c = 0; c < THN; c++) { const x = -THR + a * THS, y = -THR + b * THS, z = -THR + c * THS; let m = 1e9; for (const q of pts) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2; if (d < m) m = d; } THF[(a * THN + b) * THN + c] = Math.sqrt(m); }
    return THF;
  }
  function thumbErr(l, f, n) { const F = thumbField(), q = v => Math.max(0, Math.min(THN - 1, Math.round((v + THR) / THS))), o = Math.max(0, Math.hypot(Math.max(0, Math.abs(l) - THR), Math.max(0, Math.abs(f) - THR), Math.max(0, Math.abs(n) - THR))); return F[(q(l) * THN + q(f)) * THN + q(n)] + o; }
  const CT = {};   // table précalculée de chainErr (doigt, flexion) → erreur minimale selon (tu, ty)
  function chainTab(i, tu, ty, th, lv) {
    const ti = Math.max(0, Math.min(12, Math.round((th + 40) / 5))), key = (i * 20 + ti) * 3 + lv; let t = CT[key];
    if (!t) { t = CT[key] = new Float32Array(45 * 45); for (let a = 0; a < 45; a++) for (let b = 0; b < 45; b++) t[a * 45 + b] = chainErr(RF[i], a * 0.1, -3.2 + b * 0.1, -40 + ti * 5, lv); }
    const a = Math.min(44, Math.max(0, Math.round(tu / 0.1))), b = Math.min(44, Math.max(0, Math.round((ty + 3.2) / 0.1)));
    return t[a * 45 + b] + Math.max(0, tu - 4.4) + Math.max(0, -3.2 - ty) + Math.max(0, ty - 1.2);
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
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2), hitV = new THREE.Vector3();
    const rollZ = e => { const r = c.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam); return ray.ray.intersectPlane(plane, hitV) ? hitV.z : null; };   // profondeur du point touché, dans le plan du rouleau
    let rollDrag = null;   // glisser sur le rouleau = le faire défiler ; en dehors (clavier, mains, fond) = tourner la caméra
    c.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); const z0 = ptrs.size === 1 && onScroll ? rollZ(e) : null; if (z0 !== null && z0 < BACK + 0.3) { rollDrag = { z: z0 }; drag = null; try { c.setPointerCapture(e.pointerId); } catch (_) {} c.style.cursor = 'ns-resize'; return; } drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (_) {} c.style.cursor = 'grabbing'; });
    c.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {   // deux doigts : pincement = zoom, glissement vertical = défilement du rouleau
        const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y), my = (a.y + b.y) / 2; if (pinch) zoomBy(pinch / dd); if (c._my !== undefined && onScroll) onScroll((my - c._my) / (c.clientHeight || 600) * AHEAD); c._my = my; pinch = dd; drag = null; return;
      }
      if (rollDrag) { const z = rollZ(e); if (z !== null) { onScroll((z - rollDrag.z) / SPEED); rollDrag.z = z; } return; }
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      orbit.az = ((orbit.az - dx * 0.006) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); /* tour complet à 360° */ orbit.el = Math.max(0.09, Math.min(1.5, orbit.el + dy * 0.005));
    });
    const end = e => { ptrs.delete(e.pointerId); pinch = 0; c._my = undefined; drag = null; rollDrag = null; c.style.cursor = 'grab'; }; c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(e.deltaY * 0.01)); else if (onScroll) onScroll(e.deltaY * (e.deltaMode === 1 ? 16 : 1) / (c.clientHeight || 600) * AHEAD); }, { passive: false });   // molette = défilement ; Ctrl/Cmd + molette (ou pincement du pavé tactile) = zoom
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
    keys = {}; bars = []; hands = {}; marks = []; pastilles = []; blackXs = [];
    while (scene.children.length > 4) scene.remove(scene.children[scene.children.length - 1]);
    let lo = 127, hi = 0; song.notes.forEach(n => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    let m0 = Math.max(21, lo - 10), m1 = Math.min(108, hi + 10);
    if (typeof PianoCore !== 'undefined' && PianoCore.keyboardRange) { const r = PianoCore.keyboardRange(lo, hi); m0 = r.first; m1 = r.last; }   // même étendue que le clavier 2D : octaves entières (Do → Si) couvrant le morceau, au moins 3
    const x0 = ux(m0) - 0.5, x1 = ux(m1) + 0.5, cx = (x0 + x1) / 2, w = x1 - x0;
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.55, metalness: 0, envMapIntensity: 0.4 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.5, KEY_L + 0.22), wood); bed.position.set(cx, -0.55, -0.09); bed.receiveShadow = true; scene.add(bed);   // cadre : les côtés (baguettes) arrivent à y = −0,3 ; les touches, plus hautes (dessus à 0), restent À L'INTÉRIEUR du cadre
    const front = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.25, 0.1), wood); front.position.set(cx, -0.425, KEY_L / 2 + 0.07); scene.add(front);   // bord côté joueur : même hauteur que les baguettes des côtés (dessus à y = −0,3), derrière lui les touches se terminent à z = 3
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.5, 0.2), wood); back.position.set(cx, 0.05, BACK - 0.1); scene.add(back);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ color: 0x141830 })); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -0.85, 0); floor.receiveShadow = true; scene.add(floor);
    for (let m = m0; m <= m1; m++) {
      const blk = isBlack(m), g = blk ? new THREE.BoxGeometry(0.58, 0.7, BLK_L) : new THREE.BoxGeometry(0.94, 0.5, KEY_L);
      const mat = new THREE.MeshStandardMaterial({ color: blk ? 0x14151e : 0xf4f4f8, roughness: blk ? 0.22 : 0.36, metalness: 0, envMapIntensity: 0.5 }), k = new THREE.Mesh(g, mat);
      k.position.set(ux(m), blk ? 0.1 : -0.25, blk ? BACK + BLK_L / 2 : 0); k.userData = { blk, y0: k.position.y, col: blk ? 0x14151e : 0xf4f4f8 };
      if (blk) blackXs.push(ux(m));
      k.castShadow = k.receiveShadow = true; scene.add(k); keys[m] = k;
    }
    // colonnes du rouleau : un second clavier posé sur le plan du rouleau (touches blanches en beige, noires en gris)
    { const zl = AHEAD * SPEED + 0.6, zc = BACK - zl / 2 + 0.3;
      for (let m = m0; m <= m1; m++) { const blk = isBlack(m); if (blk) continue; const c = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.03, zl), new THREE.MeshBasicMaterial({ color: 0xd9cdb1 })); c.position.set(ux(m), 0.0, zc); scene.add(c); }
      for (let m = m0; m <= m1; m++) { const blk = isBlack(m); if (!blk) continue; const c = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.03, zl), new THREE.MeshBasicMaterial({ color: 0x70747f })); c.position.set(ux(m), 0.025, zc); scene.add(c); } }
    // barres du rouleau (réserve)
    boxG = new THREE.BoxGeometry(1, 0.3, 1);
    barSp = []; for (let i = 0; i < 260; i++) { const q = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, depthTest: false, transparent: true })); q.scale.set(1.25, 1.25, 1); q.renderOrder = 9; q.visible = false; scene.add(q); barSp.push(q); }
    for (let i = 0; i < 260; i++) { const b = new THREE.Mesh(boxG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, envMapIntensity: 0.4 })); b.visible = false; scene.add(b); bars.push(b); }
    // repères temporels : barres de mesure (épaisses, avec numéro) et temps (fins) posés sur le plan du rouleau ; ils tournent avec la scène
    gridL = []; gridS = [];
    for (let i = 0; i < 140; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0x1f2547, transparent: true, opacity: 0.3, depthWrite: false })); l.visible = false; l.renderOrder = 1; scene.add(l); gridL.push(l); }
    for (let i = 0; i < 90; i++) { const q = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false, depthTest: false, transparent: true })); q.scale.set(2.4, 1.2, 1); q.renderOrder = 8; q.visible = false; scene.add(q); gridS.push(q); }
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
    const pressedF = [];   // doigts qui appuient : [main, x, hauteur du bout] (l'enfoncement des touches en dépend)
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
      const n = S[i]; if (!vis.includes(st.noteHand(n))) continue;
        if (n.t1 < sp) continue;
        const a = Math.max(0, n.t0 - sp), b = Math.min(AHEAD, n.t1 - sp), z0 = BACK - a * SPEED, z1 = BACK - b * SPEED, blk = built.isBlack(n.midi), bar = bars[bi++];
        { const q = barSp[bi - 1], f = st.fof && st.fing !== false ? st.fof(n) : 0;
          if (f) { const tex = digit(f, st.noteHand(n) === 'R' ? '#ffc23a' : '#7fd0ff'); if (q.material.map !== tex) { q.material.map = tex; q.material.needsUpdate = true; } q.visible = true; q.position.set(built.ux(n.midi), 0.85, z1 - 0.62); } else q.visible = false; }   // pastille détachée du rectangle : juste au-delà de sa fin (comme en 2D), pour ne pas cacher les notes courtes
        bar.visible = true; bar.position.set(built.ux(n.midi), 0.3, (z0 + z1) / 2); bar.scale.set(blk ? 0.5 : 0.84, 1, Math.max(0.12, z0 - z1 - 0.06));
        bar.material.color.setHex(st.noteHand(n) === 'R' ? CR : CL);
    }
    for (; bi < bars.length; bi++) bars[bi].visible = false;
    for (let i = 0; i < barSp.length; i++) if (i >= bi || !bars[i].visible) barSp[i].visible = false;
    // barres de mesure et temps
    { const G = st.grid || [], x0 = built.cx - built.w / 2; let li = 0, si = 0;
      G.forEach(e => {
        const z = BACK - (e.t - sp) * SPEED, l = gridL[li++]; if (!l) return;
        l.visible = true; l.position.set(built.cx, e.bar ? 0.17 : 0.15, z); l.scale.set(built.w, 1, e.bar ? 0.26 : e.fine ? 0.04 : e.sub ? 0.07 : 0.12); l.material.opacity = e.bar ? 1 : e.fine ? 0.3 : e.sub ? 0.55 : 0.95;   // temps : traits pleins plus fins que la barre de mesure
        const x1 = x0 + built.w, put = (txt, x, big) => { const q = gridS[si++]; if (!q) return; const tex = measureTex(txt); if (q.material.map !== tex) { q.material.map = tex; q.material.needsUpdate = true; } q.scale.set(big ? 2.4 : 1.7, big ? 1.2 : 0.85, 1); q.visible = true; q.position.set(x, 0.7, z); };
        if (e.bar && e.label !== undefined) { put(e.label, x0 + 1.4, true); put(e.label, x1 - 1.4, true); }   // numéro de mesure aux deux bouts
        if (e.beatLabel) { const off = 3.3; put(e.beatLabel, x0 + off, false); put(e.beatLabel, x1 - off, false); }   // X.1, X.2, X.3… aux deux bouts, sur chaque temps
      });
      for (; li < gridL.length; li++) gridL[li].visible = false; for (; si < gridS.length; si++) gridS[si].visible = false; }
    stats.n++;
    // pas de temps pour le lissage (le mouvement est filtré sur ≈ 70 ms ; un saut dans le morceau recale tout d'un coup)
    stats.frameErr = 0;
    const nowT = performance.now(), dtS = Math.max(0.004, Math.min(0.1, (nowT - (render.lastT || nowT)) / 1000)), JUMP = Math.abs(sp - (render.lastSp === undefined ? sp : render.lastSp)) > 0.4 || !render.lastT || (nowT - render.lastT) > 400, SNAP = stats.noSmooth || JUMP, fwdSp = sp >= (render.lastSp === undefined ? sp : render.lastSp), rateSp = Math.abs(sp - (render.lastSp === undefined ? sp : render.lastSp)) / dtS, tau = rateSp < 0.02 ? 0.17 : Math.max(0.17, Math.min(0.6, 0.17 / Math.min(1, Math.max(rateSp, 0.17)))), AL = 1 - Math.exp(-dtS / tau); render.lastT = nowT; render.lastSp = sp;   // lissage ≈ 70 ms à vitesse normale, jusqu'à 0,4 s à basse vitesse : le retard reste ≈ 70 ms de musique et les paliers du choix de pose ne se voient plus
    // mains
    ['L', 'R'].forEach(h => {
      const H = hands[h], pl = st.plan && st.plan[h], show = vis.includes(h) && pl && !pl.empty && st.handsMode !== 'off'; H.g.visible = !!show; if (!show) return;
      const spH = sp + (fwdSp && !SNAP ? Math.min(0.12, rateSp * tau) : 0), a = pl.at(spH), sg = h === 'L' ? -1 : 1, col = h === 'R' ? CR : CL;
      // Doigt en contact avec une touche : il ne glisse plus dessus tant qu'il la tient (H.hold[i] = point de contact retenu à l'appui) ; relâché, ou autre touche, ou saut dans le morceau : libre
      H.hold = H.hold || [null, null, null, null, null];
      a.fingers.forEach((f, i) => { if (!f.pressed || JUMP || (H.hold[i] && Math.abs(H.hold[i].x - f.x) > 0.3)) H.hold[i] = null; });
      const xs = a.fingers.map(f => f.x), pin = a.fingers.map(f => !!f.pressed || (f.depth || 0) > 0.6 || (f.wN || 0) > 0.85);
      const px0 = a.palm;   // position horizontale de la base 3.0 donnée par le plan (sans limite) ; la recherche l'ajuste de ±2 touches
      enforceOrder(xs, pin, sg);
      // Règle d'enchaînement : un doigt voisin qui vient de jouer (ou de quitter sa touche) doit se replier AVANT que l'autre ne s'étende, sinon les deux doigts se croisent.
      const kws = a.fingers.map(f => Math.max(f.pressed ? 1 : 0, f.depth || 0, f.wN || 0, 0.7 * (f.wP || 0)));
      for (let i = 1; i < 5; i++) {
        const f = a.fingers[i]; if (pin[i] || (f.wN || 0) <= (f.wP || 0)) continue;
        [i - 1, i + 1].forEach(j => { if (j < 1 || j > 4) return; const g = a.fingers[j]; if (pin[j] || (g.wP || 0) <= (g.wN || 0)) return; kws[i] = Math.min(kws[i], Math.max(0.3, 1 - 0.9 * kws[j])); });
      }
      const REACHF = [4.2, 3.2, 3.6, 3.1, 2.4];   // longueurs des doigts (fixes)
      H.fingers.forEach((F, i) => { const bt = a.fingers[i].blk || 0; F.blkS = (F.blkS === undefined || SNAP) ? bt : F.blkS + (bt - F.blkS) * AL; });
      const eng = a.fingers.map((f, i) => ({ f, i, e: Math.max(f.pressed ? 1 : 0, f.depth || 0, f.wN || 0) })).filter(o => o.e >= 0.5);
      // Passage du pouce sous la paume : permis seulement dans le sens du mouvement naturel (main droite : vers le grave ; main gauche : vers l'aigu), jamais dans l'autre sens
      const thumbOn = eng.some(o => o.i === 0), others = eng.filter(o => o.i > 0);
      const tuckOK = thumbOn && H.lastX !== undefined && sg * (xs[0] - H.lastX) < 0;
      if (!thumbOn && others.length) H.lastX = others.reduce((q, o) => q + xs[o.i], 0) / others.length;
      // ===== TEST MODELE 3D : la main est un SOLIDE (paume rigide, longueurs fixes, bases 2.0–3.0–4.0–5.0 toujours alignées) =====
      // Mouvements de P (poignet) : horizontal sans limite ; hauteur de P au-dessus du clavier : de 0 à la distance 2.0–5.0 ;
      // distance au clavier : les bases 2.0…5.0 restent entre le bord des touches blanches (z = 3) et le bord des touches noires (z = 0,6), jamais sous la surface des touches ;
      // inclinaison (pitch) 0 à 40° (doigts vers le bas) ; roulis (roll) 70° côté 5 vers le bas, 10° côté pouce vers le bas ; tangage (yaw) ±20°.
      // Les doigts n'ont aucun roulis propre : chacun fléchit dans le plan perpendiculaire à la paume qui contient sa direction.
      // Zone d'appui : un doigt n'a pas à frapper sa touche pile sur la ligne nominale ; il peut l'enfoncer n'importe où sur sa partie visible
      // (touche blanche : z de 0,7 à 2,9 ; touche noire : de −2,5 à 0,5). Candidats : de 1,1 en arrière à 0,9 en avant de la ligne nominale (pouce : 0,4 en avant), la ligne nominale étant préférée.
      // Passage sans touche noire (pour cette main : de 0,6 s avant à 2 s après l'instant courant) : la main recule pour que les doigts frappent les touches blanches, au plus loin, au niveau du bord avant des touches noires (z = 0,6) ; le pouce peut toucher le bord de sa touche
      let nbT = 0; { let any = false, blackSeen = false; for (let i = st.lowerBoundSec(sp - 0.6); i < S.length && S[i].t0 <= sp + 2.0; i++) { const n = S[i]; if (n.t1 < sp - 0.6 || st.noteHand(n) !== h) continue; any = true; if (st.isBlack(n.midi)) { blackSeen = true; break; } } nbT = any && !blackSeen ? 1 : 0; }
      H.nbS = (H.nbS === undefined || SNAP) ? nbT : H.nbS + (nbT - H.nbS) * AL * 0.5; const nb = H.nbS;
      const zNom = (i, bk) => { const w = i === 0 ? 2.3 + 0.5 * nb : 1.7 + 0.2 * nb; return w + (0.15 - w) * bk; };   // ligne d'appui nominale (touche blanche : 1,7 ; pouce : 2,3 ; en passage sans touche noire : 1,9, et pouce 2,8 = bord de sa touche)
      const zCands = i => { if (H.hold[i]) return [{ z: H.hold[i].z, p: 0 }]; const bk = H.fingers[i].blkS, zt = zNom(i, bk), lo = Math.max(zt - 1.1, 0.6 + (-2.5 - 0.6) * bk), hi = Math.min(zt + (i === 0 ? 0.4 : 0.9), 2.95 + (0.5 - 2.95) * bk);
        return [zt, lo, (lo + zt) / 2, (zt + hi) / 2, hi].filter(z => z >= lo - 1e-9 && z <= hi + 1e-9).map(z => ({ z, p: 0.05 * Math.abs(z - zt) })); };
      const tgt = i => { const bk = H.fingers[i].blkS; return [xs[i], (bk ? 0.52 : 0.08), zNom(i, bk)]; };
      const rotY = (v, b) => [v[0] * Math.cos(b) - v[2] * Math.sin(b), v[1], v[0] * Math.sin(b) + v[2] * Math.cos(b)];
      const fr = (bx, bz, py, th, rho, psi) => {
        const r = rho * D2R, t = th * D2R, b = sg * psi * D2R, cr = Math.cos(r), sr = Math.sin(r), ct = Math.cos(t), st2 = Math.sin(t);
        const L = rotY([sg * cr, -sr, 0], b), F = rotY([-st2 * sg * sr, -st2 * cr, -ct], b), N = rotY([ct * sg * sr, ct * cr, -st2], b);
        const P = [bx - PALM * F[0], py - PALM * F[1], bz - PALM * F[2]];   // py = hauteur de la ligne des bases 2.0–5.0 (P en est déduit : l'inclinaison change l'angle d'attaque sans déplacer la ligne)
        return { P, F, L, N, w: l => [P[0] + L[0] * l[0] + F[0] * l[1] + N[0] * l[2], P[1] + L[1] * l[0] + F[1] * l[1] + N[1] * l[2], P[2] + L[2] * l[0] + F[2] * l[1] + N[2] * l[2]] };
      };
      const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const evalPose = (bx, bz, py, th, rho, psi) => {
        if (eng.length && py > YCAP) return Infinity;   // un doigt joue ou s'apprête à jouer : la ligne des bases reste près du clavier
        const F = fr(bx, bz, py, th, rho, psi);
        if (F.P[1] < YMIN_W) return Infinity;   // le poignet ne descend pas dans les touches
        for (let i = 0; i < 5; i++) { const K = F.w(LOC[i]); if (K[1] < YMIN) return Infinity; if (i > 0 && (K[2] < ZB - 1e-6 || K[2] > BASE_ZMAX + 1e-6)) return Infinity; }   // ni la paume, ni les bases des doigts ni celle du pouce : jamais sous le dessus des touches noires (0,45) plus le rayon des os
        let worst = 0, tot = 0, latPen = 0; const lvl = lvOf(py), tw = -th * D2R, c = Math.cos(tw), s = Math.sin(tw);
        for (const { i, f: fe } of eng) {
          const K = F.w(LOC[i]), T = tgt(i), v = [T[0] - K[0], T[1] - K[1], T[2] - K[2]];
          let er = Infinity;
          if (i === 0) latPen = (tuckOK ? 0.5 : 4) * Math.max(0, dot(v, F.L)) + 0.25 * Math.hypot(dot(v, F.L), dot(v, F.F) - 1.0);   // pouce : sa touche ne doit pas être du côté des autres doigts par rapport à sa base ; la main se place pour que sa touche soit proche de sa base
          for (const { z, p } of zCands(i)) {
            const w = [T[0] - K[0], T[1] - K[1], z - K[2]]; let e;
            if (i === 0) e = thumbErr(dot(w, F.L), dot(w, F.F), dot(w, F.N));
            else { const fv = dot(w, F.F), lv = dot(w, F.L), nv = dot(w, F.N), a = Math.max(LACET[i][0] * D2R, Math.min(LACET[i][1] * D2R, Math.atan2(lv, Math.max(1e-3, fv)))), u = fv * Math.cos(a) + lv * Math.sin(a), off = Math.abs(-fv * Math.sin(a) + lv * Math.cos(a));
              e = (fv <= 0 ? 1 : 0) + off + chainTab(i, u * c - nv * s, u * s + nv * c, -th, lvl); }
            if (e + p < er) er = e + p;
          }
          // un doigt qui tient une touche (pouce compris) ne la quitte jamais au profit des suivants (poids plein) ; un doigt qui s'apprête à jouer pèse moins, le pouce encore moins
          const hold = !!fe.pressed, held = hold && H.hold[i], w = hold ? 1 : i === 0 ? 0.25 : 0.6; if (held) er *= 4;   // un doigt qui tient une touche garde sa position sur elle : son écart pèse 4 fois plus que celui du doigt suivant qui s'apprête
          if (hold || i !== 0) worst = Math.max(worst, hold ? er : 0.7 * er); tot += w * er * er;
        }
        return worst + 0.5 * tot / Math.max(1, eng.length) + latPen;
      };
      // hauteur préférée du poignet : bas quand un doigt tient une touche (les doigts reposent sur le clavier), moyenne quand un doigt s'apprête à jouer, haute au repos (la main flotte au-dessus du clavier)
      // hauteur des articulations 2.0–5.0 (les « jointures ») au-dessus des touches : la main en arche (≈ 2 touches de haut) quand un doigt tient une touche, un peu plus haute quand un doigt s'apprête à jouer, haute au repos (2,7)
      // hauteur préférée de la LIGNE des bases 2.0–5.0 : basse partout (la main ne remonte pas entre les notes) ; baisser la ligne étend les doigts (FLEXP)
      // en passage sans touche noire, la main se lève en reculant : les doigts se plient par la pesanteur et leurs points de chute reviennent vers le bord des touches blanches, le bout de l'index s'alignant avec celui du pouce
      // Main qui ne joue pas et qui se déplace : elle se soulève assez pour qu'aucun doigt n'effleure les touches noires (mv : 0 immobile … 1 en déplacement)
      const spd = (H.px0P === undefined || SNAP) ? 0 : Math.abs(px0 - H.px0P) / dtS; H.px0P = px0;
      H.mvS = (H.mvS === undefined || SNAP) ? 0 : H.mvS + ((eng.length ? 0 : Math.min(1, spd / 1.5)) - H.mvS) * AL; const mv = H.mvS;
      const khT0 = (eng.length ? 1.0 : 1.2) + 0.6 * nb; H.khS = (H.khS === undefined || SNAP) ? khT0 : H.khS + (khT0 - H.khS) * AL; const khT = H.khS;
      const pref = q => 0.004 * Math.abs(q.dx) + (1 - nb) * (eng.some(o => o.i >= 1 && o.i <= 3) ? 0.06 * Math.abs(q.bz - 3) : 0.01 * Math.abs(q.bz - 2.2)) + nb * 0.6 * Math.abs(q.bz - BASE_ZMAX) + 1.2 * Math.abs(q.py - khT) + 0.004 * Math.abs(q.th - 10) + 0.012 * Math.abs(q.rho) + 0.03 * Math.max(0, q.rho - 20) + (eng.some(o => o.i >= 1 && o.i <= 3) ? 0.05 * Math.abs(q.psi - 15) : 0.02 * Math.abs(q.psi - 5));
      const scoreQ = q => (stats.ev = (stats.ev || 0) + 1, stats.evF = stats.evF || 0, evalPose)(px0 + q.dx, q.bz, q.py, q.th, q.rho, q.psi) + pref(q);
      let pose = H.pose || { dx: 0, bz: 2.2, py: 1.8, th: 10, rho: 0, psi: 5 };   // lacet de P par défaut : 5° vers l'extérieur
      if (!eng.length) pose = { dx: 0, bz: 2.8 + (BASE_ZMAX - 2.8) * nb, py: 1.2 + 0.6 * nb + 0.9 * mv, th: 5, rho: 0, psi: 5 };   // au repos (entre deux notes) : la main reste près du clavier, sans remonter
      if (eng.length) {
        // recherche en deux temps : (1) départ = pose de l'image précédente (ou grille grossière si elle est mauvaise, si les doigts engagés ont changé, ou toutes les 10 images) ;
        // (2) affinage par pas décroissants, une coordonnée à la fois
        const key = eng.map(o => o.i).join(''), lim = { th: [-15, 40], rho: [-10, 70], psi: [-20, 20], py: [0, YMAX], bz: [0.2, BASE_ZMAX], dx: [-2.5, 2.5] };
        let best = H.pose ? scoreQ(H.pose) : Infinity;
        H.fc = (H.fc || 0) + 1;
        if (!H.pose || best > 0.7 || H.engKey !== key || SNAP) {
          for (const dx of [-1.5, 0, 1.5]) for (const bz of [1.2, 2.1, 2.8]) for (const py of [0.8, 1.8, 2.7]) for (const th of [0, 15, 35]) for (const rho of [-5, 15, 40]) for (const psi of [-15, 0, 15]) {
            const q = { dx, bz, py, th, rho, psi }, sc = scoreQ(q); if (sc < best - 0.04) { best = sc; pose = q; } }
        } else pose = H.pose;
        H.engKey = key;
        const st0 = { dx: 0.5, bz: 0.3, py: 0.3, th: 5, rho: 10, psi: 10 };
        for (const mul of [1, 0.5, 0.25]) for (let it = 0; it < 6; it++) {
          let moved = false;
          for (const k of Object.keys(st0)) for (const sgn of [-1, 1]) {
            const v = pose[k] + sgn * st0[k] * mul; if (k in lim && (v < lim[k][0] || v > lim[k][1])) continue;
            const q = Object.assign({}, pose); q[k] = v; const sc = scoreQ(q); if (sc < best - 1e-9) { best = sc; pose = q; moved = true; } }
          if (!moved) break;
        }
        stats.selW = Math.max(stats.selW || 0, evalPose(px0 + pose.dx, pose.bz, pose.py, pose.th, pose.rho, pose.psi));
      }
      { const o = H.poseS, sn = !o || SNAP; H.pose = pose; if (sn) H.poseS = Object.assign({}, pose); else Object.keys(pose).forEach(k => { o[k] += (pose[k] - o[k]) * AL; }); }
      const PS = H.poseS, FR = fr(px0 + PS.dx, PS.bz, PS.py, PS.th, PS.rho, PS.psi), th = -PS.th, hz = PS.bz, hy = PS.py;
      stats.pose = stats.pose || {}; ['th', 'rho', 'psi', 'py', 'bz'].forEach(k => { const m = stats.pose[k] = stats.pose[k] || [99, -99]; m[0] = Math.min(m[0], +PS[k].toFixed(2)); m[1] = Math.max(m[1], +PS[k].toFixed(2)); });
      const hfx = FR.F[0], hfz = FR.F[2]; (stats.pl = stats.pl || {})[h] = Object.assign({ palm: +a.palm.toFixed(2), xs: xs.map(v => +v.toFixed(1)), eng: eng.map(o => o.i) }, PS); stats.rhoT = (stats.rhoT || 0) + 1; if (PS.rho > 20) stats.rhoN = (stats.rhoN || 0) + 1; if (Math.abs(PS.psi) > 5) stats.psiN = (stats.psiN || 0) + 1;
      H.fingers.forEach(F => {
        const f = a.fingers[F.f - 1], fx = xs[F.f - 1], thumb = F.f === 1, off = sg * (F.f - 3);
        const K = V(...FR.w(LOC[F.f - 1])), TOT = REACHF[F.f - 1], L1 = TOT * (thumb ? 0.45 : 0.46), L2 = TOT - L1;
        const blk = F.blkS, zt = zNom(thumb ? 0 : 1, blk), yk = blk ? 0.55 : 0.1;
        const prep = f.pressed ? 0 : 4 * (f.wN || 0) * (1 - (f.wN || 0));   // doigt qui s'apprête à jouer : levée et élan un peu amplifiés
        const tipY = f.pressed ? 0.08 + 0.44 * blk : yk + 0.25 + ((f.lift || 0) * 2.3 * (1 + 0.3 * prep) + (0.55 + 0.75 * (1 - blk)) * prep) * (thumb ? 0.45 : 1) + (thumb ? 0 : 0.35 * (1 - f.depth));   // touche blanche : levée plus ample (la touche noire bouge déjà davantage)
        const T = V(fx, tipY, zt);   // attaque verticale : le bout est au-dessus du point de contact (x, z) pendant toute la descente
        if (f.pressed && !thumb) {   // même choix que dans la recherche de pose : la position d'appui dans la zone de la touche qui convient le mieux à la pose
          let bz = null; const cT0 = Math.cos(th * D2R), sT0 = Math.sin(th * D2R);
          for (const { z, p } of zCands(F.f - 1)) { const w = [fx - K.x, tipY - K.y, z - K.z], fv = dot(w, FR.F), lv = dot(w, FR.L), nv = dot(w, FR.N), a = Math.max(LACET[F.f - 1][0] * D2R, Math.min(LACET[F.f - 1][1] * D2R, Math.atan2(lv, Math.max(1e-3, fv)))), u = fv * Math.cos(a) + lv * Math.sin(a), off = Math.abs(-fv * Math.sin(a) + lv * Math.cos(a));
            const e = (fv <= 0 ? 1 : 0) + off + chainTab(F.f - 1, u * cT0 - nv * sT0, u * sT0 + nv * cT0, th, lvOf(hy)) + p; if (!bz || e < bz.e) bz = { e, z }; }
          T.z = bz.z; if (!H.hold[F.f - 1]) H.hold[F.f - 1] = { x: fx, z: bz.z };   // point de contact retenu : le doigt ne glissera plus sur cette touche
        }
        // doigt qui ne joue pas : il se soulève et se replie À MOITIÉ (flexion partielle, bout du doigt en l'air devant la phalange) ; il se déplie vers sa touche
        // à mesure qu'elle approche (wN), reste déplié un instant après la frappe (wP) puis se relâche
        if (!thumb) {
          const kw = kws[F.f - 1], curl = [0, 0.82, 0.84, 0.8, 0.76][F.f - 1];   // 3D : pas de repli maximal des doigts qui ne jouent pas (réservé au 2D, pour la visibilité) ; ils restent détendus, légèrement fléchis, au ras des touches
          const rest = V(K.x + hfx * TOT * curl, 0.45 + 0.25 * (f.lift || 0), K.z + hfz * TOT * curl);   // repos : devant la base, dans l'axe de la main
          { const kh = Math.min(1, kw / 0.55), kv = Math.min(1, kw);   // le déplacement horizontal vers la touche est terminé à mi-chemin ; la fin est une descente verticale
            T.x += (rest.x - T.x) * (1 - kh); T.z += (rest.z - T.z) * (1 - kh); T.y += (rest.y - T.y) * (1 - kv); }
        }
        // doigt à 2 articulations (cinématique inverse dans le plan vertical K→T) : segments de longueur fixe ; il se replie quand la touche est proche
        // (doigt arrondi) et se tend jusqu'à l'extension complète quand la touche est loin (touche noire, doigt tendu vers l'avant)
        // rotation latérale à la base du doigt limitée à ±40° autour de l'axe de la main (ci-dessous)   // rotation latérale uniquement à la première articulation (base du doigt), limitée à ±28°
        let M, D, K0 = null;
        if (thumb) {   // pouce : 1.0 → 1.1 → 1.2 ; pose (lacet, inclinaison de 1.0, flexion de 1.1) cherchée parmi les poses permises, la plus proche de la touche visée
          // cible du pouce = la touche elle-même (hauteur d'une touche enfoncée) : la pose passe de la pose de repos à celle de la touche en ligne droite, sans arc ni élan (c'est ce qui le faisait balancer)
          const Tt = new THREE.Vector3(fx, 0.08 + 0.44 * blk, zt);
          const tl0 = [dot([Tt.x - K.x, Tt.y - K.y, Tt.z - K.z], FR.L), dot([Tt.x - K.x, Tt.y - K.y, Tt.z - K.z], FR.F), dot([Tt.x - K.x, Tt.y - K.y, Tt.z - K.z], FR.N)];
          // au repos (pouce qui ne joue pas) : 1.0 écarté de 20° vers l'extérieur et légèrement abaissé (lacet 20°) ; 1.1–1.2 incliné de 5° vers l'extérieur (seule exception à la flexion vers l'index : flexion −5°) ; il rejoint sa touche à mesure qu'elle approche
          const REST_T = [20, 20, -5], wt = Math.min(1, kws[0]); let tl = tl0;   // la pose de repos se mélange à la pose visée en ANGLES (un seul mélange, pas de détour : plus de balancement)
          const pv = F.thS; const solveT = () => { let bt = null;
          const ec = (psi, inc, flx) => { const oo = thumbOff(psi, inc, flx), t = oo.t; return (oo.m[1] < 0 || t[1] - oo.m[1] < 0 ? 1000 : 0) + (tuckOK ? 0 : 6 * Math.max(0, oo.m[0]) + 3 * Math.max(0, t[0])) + Math.hypot(t[0] - tl[0], t[1] - tl[1], t[2] - tl[2]) + 0.004 * Math.abs(flx - 10) + 0.003 * Math.abs(inc - 10) + 0.0006 * Math.abs(psi - 20) + (pv && !SNAP ? 0.0003 * (Math.abs(psi - pv.psi) + Math.abs(inc - pv.inc) + Math.abs(flx - pv.flx)) : 0); };
          for (let psi = TPSI[0]; psi <= TPSI[1]; psi += 15) for (let inc = TINC[0]; inc <= TINC[1]; inc += 11) for (let flx = TFLX[0]; flx <= TFLX[1]; flx += 15) { const e = ec(psi, inc, flx); if (!bt || e < bt.e) bt = { e, psi, inc, flx }; }
          if (pv && !SNAP) { const e = ec(pv.psi, pv.inc, pv.flx); if (e < bt.e) bt = { e, psi: pv.psi, inc: pv.inc, flx: pv.flx }; }
          for (const stp of [7.5, 3.75, 1.9]) for (let it = 0; it < 8; it++) { let mv = false;
            for (const [dp, di, df] of [[stp, 0, 0], [-stp, 0, 0], [0, stp, 0], [0, -stp, 0], [0, 0, stp], [0, 0, -stp]]) { const psi = bt.psi + dp, inc = bt.inc + di, flx = bt.flx + df; if (psi < TPSI[0] || psi > TPSI[1] || inc < TINC[0] || inc > TINC[1] || flx < TFLX[0] || flx > TFLX[1]) continue; const e = ec(psi, inc, flx); if (e < bt.e - 1e-9) { bt = { e, psi, inc, flx }; mv = true; } }
            if (!mv) break; }
            return bt; };
          let bt;   // pouce qui appuie : la position d'appui est cherchée dans toute la zone de la touche (pose exacte du pouce pour chaque candidat, la ligne nominale étant préférée)
          if (f.pressed) { let bb = null; for (const { z, p } of zCands(0)) { const w = [fx - K.x, Tt.y - K.y, z - K.z]; tl = [dot(w, FR.L), dot(w, FR.F), dot(w, FR.N)]; const b = solveT(); if (!bb || b.e + p < bb.e + bb.p) bb = { e: b.e, psi: b.psi, inc: b.inc, flx: b.flx, p, tl, z }; } tl = bb.tl; bt = bb; if (!H.hold[0]) H.hold[0] = { x: fx, z: bb.z }; } else bt = solveT();
          if (wt < 1) { bt = { e: bt.e, psi: wt * bt.psi + (1 - wt) * REST_T[0], inc: wt * bt.inc + (1 - wt) * REST_T[1], flx: wt * bt.flx + (1 - wt) * REST_T[2] }; }   // au repos : pose de repos exacte (y compris flexion −5°, hors de la plage de jeu 0–90°)
          const ALt = 1 - Math.exp(-dtS / (tau * 0.4));   // le pouce suit sa cible plus vite que les doigts (il parcourt de grands angles)
          F.thS = (!pv || SNAP) ? { psi: bt.psi, inc: bt.inc, flx: bt.flx } : { psi: pv.psi + (bt.psi - pv.psi) * ALt, inc: pv.inc + (bt.inc - pv.inc) * ALt, flx: pv.flx + (bt.flx - pv.flx) * ALt };
          const o = thumbOff(F.thS.psi, F.thS.inc, F.thS.flx), w = q => V(K.x + FR.L[0] * q[0] + FR.F[0] * q[1] + FR.N[0] * q[2], K.y + FR.L[1] * q[0] + FR.F[1] * q[1] + FR.N[1] * q[2], K.z + FR.L[2] * q[0] + FR.F[2] * q[1] + FR.N[2] * q[2]);
          M = w(o.m); T.copy(w(o.t)); D = M.clone().lerp(T, 0.55);
          const real = Math.hypot(o.t[0] - tl[0], o.t[1] - tl[1], o.t[2] - tl[2]);
          if (f.pressed) { stats.press = (stats.press || 0) + 1; stats.frameErr = Math.max(stats.frameErr || 0, real); (stats.errF = stats.errF || {})[h + 1] = +real.toFixed(2); if (real > 0.12) { stats.missT = (stats.missT || 0) + 1; (stats.mlT = stats.mlT || []).push([+sp.toFixed(2), h, +real.toFixed(2)]); } if (real > 0.3) { stats.bigT = (stats.bigT || 0) + 1; (stats.tfl = stats.tfl || []).push([+sp.toFixed(1), h, tl0.map(v => +v.toFixed(2)), [F.thS.psi, F.thS.inc, F.thS.flx].map(v => +v.toFixed(0)), +real.toFixed(2), +hy.toFixed(2), +th.toFixed(0)]); } }
        } else {
          // Doigt à trois segments (proximal 50 %, moyen 28 %, distal 22 % de la longueur), pose cherchée parmi les poses ANATOMIQUEMENT POSSIBLES :
          //  • le premier segment pointe vers l'avant, à ±28° au plus de côté (rotation à la première articulation), plat dans le prolongement de la paume (−15° à +10°) ;
          //  • la flexion de la 2e articulation va de 0° à 75° (aucune hyperextension, aucun segment ne revient vers l'arrière), celle de la 3e vaut les deux tiers de la précédente (couplage naturel) ;
          //  • on retient, parmi ces poses, celle dont le bout est le plus près du point visé (aucune pose impossible n'est jamais affichée).
          const La = TOT * 0.37, Lb = TOT * 0.32, Lc = TOT * 0.31, ht = Math.hypot(T.x - K.x, T.z - K.z) || 1e-4;
          // direction du doigt dans le plan de la paume : lacet à la base x.0 (2, 3, 4 : ±20° ; 5 : −5° à +45°) ; inclinaison de x.0 : +5° (haut) à −70° (bas) par rapport à la paume ; roulis 0 ; le doigt fléchit dans le plan (direction, normale de la paume), sans roulis propre
          const v0 = [T.x - K.x, T.y - K.y, T.z - K.z], fv = dot(v0, FR.F), lv = dot(v0, FR.L), nv0 = dot(v0, FR.N);
          let ang = Math.max(LACET[F.f - 1][0] * D2R, Math.min(LACET[F.f - 1][1] * D2R, Math.atan2(lv, Math.max(1.2, fv))));
          ang = (F.angS === undefined || SNAP) ? ang : F.angS + (ang - F.angS) * AL; F.angS = ang;
          const dd = [0, 1, 2].map(k => Math.cos(ang) * FR.F[k] + Math.sin(ang) * FR.L[k]), NN = FR.N, cT = Math.cos(th * D2R), sT = Math.sin(th * D2R);
          const u0 = Math.max(0.2, dot(v0, dd)), tu = u0 * cT - nv0 * sT, ty = u0 * sT + nv0 * cT;   // passage au repère « paume inclinée de th » utilisé par la recherche de pose
          let best = null; const R2D = Math.PI / 180;
          for (let dz = 0; dz <= 0; dz += 1) for (let e1 = th - 70; e1 <= th + 10; e1 += 3) for (let f2 = 0; f2 <= 90; f2 += 3) for (const rr of RR3) {
            const a1 = e1 * R2D, a2 = a1 - f2 * R2D, a3 = a2 - rr * f2 * R2D;
            if (a2 < -90 * R2D || a3 < A3MIN * R2D) continue;   // même règle que dans la recherche de pose (chainErr) : aucun segment au-delà de la verticale ; les deux doivent rester identiques
            const mu = La * Math.cos(a1), my = La * Math.sin(a1), du = mu + Lb * Math.cos(a2), dy = my + Lb * Math.sin(a2), tu2 = du + Lc * Math.cos(a3), ty2 = dy + Lc * Math.sin(a3);
            const err = Math.hypot(tu2 + dz - tu, ty2 - ty) + 0.005 * Math.abs((th - e1) - FLEXP[lvOf(hy)][0]) + 0.003 * Math.abs(f2 - FLEXP[lvOf(hy)][1]) + 0.002 * Math.abs(rr - 0.45) * f2 + 0.03 * Math.abs(dz);
            if (!best || err < best.err) best = { err, e1, f2, rr, dz, mu, my, du, dy, tu2, ty2 };
          }
          // lissage temporel : les angles retenus sont filtrés (≈ 70 ms) pour que les doigts ne « tremblent » pas quand la meilleure pose change d'une image à l'autre
          { const sn = F.f2S === undefined || SNAP; F.e1S = sn ? best.e1 : F.e1S + (best.e1 - F.e1S) * AL; F.f2S = sn ? best.f2 : F.f2S + (best.f2 - F.f2S) * AL; F.dzS = sn ? best.dz : F.dzS + (best.dz - F.dzS) * AL; F.rS = (sn || F.rS === undefined) ? best.rr : F.rS + (best.rr - F.rS) * AL;
            const a1 = F.e1S * R2D, a2 = a1 - F.f2S * R2D, a3 = a2 - F.rS * F.f2S * R2D;
            best.mu = La * Math.cos(a1); best.my = La * Math.sin(a1); best.du = best.mu + Lb * Math.cos(a2); best.dy = best.my + Lb * Math.sin(a2); best.tu2 = best.du + Lc * Math.cos(a3); best.ty2 = best.dy + Lc * Math.sin(a3); }
          { const A1 = F.e1S, A2 = A1 - F.f2S, A3 = A2 - (F.rS === undefined ? 0.45 : F.rS) * F.f2S, v = stats.val = stats.val || { n: 0, mcp: 0, pip: 0, dip: 0, back: 0 };
            v.n++; if (A1 < th - 71 || A1 > th + 11) v.mcp++; if (F.f2S < -0.5 || F.f2S > 91) v.pip++; if (0.45 * F.f2S > 41 || 0.45 * F.f2S < -0.5) v.dip++; if (A2 < -91 || A3 < A3MIN - 1 || Math.cos(A2 * R2D) < -0.02 || Math.cos(A3 * R2D) < -0.2) v.back++; }
          const dzS = F.dzS;   // la base du doigt (articulation métacarpo-phalangienne) glisse de ±0,8 touche le long du métacarpien : les doigts s'adaptent à des touches proches ou éloignées
          const at = (X, Y) => { const u = X * cT + Y * sT + dzS, y = -X * sT + Y * cT; return V(K.x + u * dd[0] + y * NN[0], K.y + u * dd[1] + y * NN[1], K.z + u * dd[2] + y * NN[2]); };
          K0 = at(0, 0);
          M = at(best.mu, best.my); D = at(best.du, best.dy); T.copy(at(best.tu2, best.ty2));
          if (f.pressed) { const real = Math.hypot(best.tu2 + dzS - tu, best.ty2 - ty); (stats.errF = stats.errF || {})[h + F.f] = +real.toFixed(2); stats.press = (stats.press || 0) + 1; stats.frameErr = Math.max(stats.frameErr || 0, real); if (real > 0.12) { stats.miss = (stats.miss || 0) + 1; (stats.ml = stats.ml || []).push([+sp.toFixed(2), h, F.f, +real.toFixed(2)]); } if (real > 0.3) { stats.big = (stats.big || 0) + 1; (stats.bl = stats.bl || []).push([F.f, +real.toFixed(2), +tu.toFixed(2), +ty.toFixed(2), +best.tu2.toFixed(2), +best.ty2.toFixed(2), +th.toFixed(0), +hz.toFixed(1), +hy.toFixed(1), +blk.toFixed(1), +(T.x - K.x).toFixed(1), +(xs[F.f - 1] - K.x).toFixed(1), +dzS.toFixed(2), best.dz]); } }   // écart réel entre le bout du doigt et la touche visée (en largeurs de touche)
        }
        // RÈGLE : aucun os ne traverse une touche. Les articulations (et le bout d'un doigt qui ne joue pas) restent au-dessus du dessus des touches : 0,45 au-dessus d'une touche noire (tant qu'on est dans sa longueur), 0 au-dessus d'une touche blanche, plus le rayon de l'os
        { const flr = (p, r) => { if (p.z < ZB) for (const bx of blackXs) if (Math.abs(p.x - bx) < 0.36) return 0.45 + r; return r; };
          [M, D].forEach(p => { if (p) p.y = Math.max(p.y, flr(p, 0.12), 0.62 * mv); });
          if (f.pressed) { if (Math.abs(T.x - fx) < 0.5 && T.y < flr(T, 0) + 0.4) T.y = flr(T, 0.07); else T.y = Math.max(T.y, flr(T, 0.07)); } else T.y = Math.max(T.y, flr(T, 0.25), 0.7 * mv); }   // un doigt qui appuie a son bout à 0,07 au-dessus de la touche (appui net) ; un doigt qui ne joue pas reste à 0,25 au moins (clairement au-dessus)
        const tm = H.sk.fing[F.f - 1].tipMat; tm.color.setHex(f.pressed ? col : 0xffffff); tm.emissive.setHex(f.pressed ? 0x553300 : 0x444444);   // bout du doigt qui joue : couleur vive
        F.sp.visible = st.fing !== false; F.sp.position.set(T.x, T.y + 0.85, T.z); F.sp.material.opacity = f.pressed ? 1 : 0.55;
        const nextF = st.anticip && !f.pressed && (f.wN || 0) > 0.02;   // prochain doigt : pastille qui clignote (3 fois par seconde), bout du doigt qui s'éclaire
        if (nextF) { const bl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * performance.now() / 1000); F.sp.material.opacity = 1; F.sp.scale.setScalar(1.05 + 0.5 * bl); tm.color.setHex(col); tm.emissive.setHex(bl > 0.5 ? 0x553300 : 0x221100); }
        else F.sp.scale.setScalar(0.9);
        if (!thumb && (M.z > K.z + 0.05 || D.z > M.z + 0.05 || T.z > D.z + 0.05)) { stats.back++; stats.bk = stats.bk || [0,0,0]; if (M.z > K.z + 0.05) stats.bk[0]++; if (D.z > M.z + 0.05) stats.bk[1]++; if (T.z > D.z + 0.05) stats.bk[2]++; } { const pk = h + F.f, pv = stats.prev && stats.prev[pk]; if (pv && !SNAP) { const dj = pv.distanceTo(T); stats.maxJ = Math.max(stats.maxJ || 0, dj); if (dj > 0.45) { stats.jumps = (stats.jumps || 0) + 1; (stats.jl = stats.jl || []).push([pk, +dj.toFixed(2), +sp.toFixed(2), f.pressed ? 'P' : '-', +(f.depth || 0).toFixed(2), +(f.wN || 0).toFixed(2), +(f.wP || 0).toFixed(2), +(hz).toFixed(2)]); } stats.nJ = (stats.nJ || 0) + 1; } (stats.prev = stats.prev || {})[pk] = T.clone(); } tips[h + F.f] = T.clone(); if (f.pressed) pressedF.push([h, xs[F.f - 1], T.y]); F.pts = thumb ? [K.clone(), M.clone(), T.clone()] : [(K0 || K).clone(), M.clone(), D.clone(), T.clone()];   // le pouce n'a que deux phalanges
      });
      // squelette : poignet, paume en polygone (poignet–pouce, poignet–index, poignet–auriculaire, ligne des bases des doigts), 3 traits et 4 points par doigt
      { const sk = H.sk, W = V(...FR.P); sk.wrist.position.copy(W);
        const P = H.fingers.map(F => F.pts);
        [[W, P[0][0]], [W, P[1][0]], [W, P[4][0]], [P[1][0], P[2][0]], [P[2][0], P[3][0]], [P[3][0], P[4][0]]].forEach(([a, b], i) => limb(sk.palmB[i], a, b));
        H.fingers.forEach((F, i) => { const o = sk.fing[i], q = F.pts, n = q.length; for (let k = 0; k < 3; k++) { o.b[k].visible = k < n - 1; if (k < n - 1) limb(o.b[k], q[k], q[k + 1]); } const ji = n === 3 ? [0, 1, 3] : [0, 1, 2, 3]; o.j.forEach((j, k) => { const at = ji.indexOf(k); j.visible = at >= 0; if (at >= 0) j.position.copy(q[at]); }); });
      }
    });
    // enfoncement des touches : progressif, c'est le bout du doigt qui enfonce la touche (jamais avant le contact) ; sans doigt visible sur la touche, l'enfoncement suit la note.
    // Retour à l'ancien comportement (enfoncement instantané à la note) : View3D.setContact(false) dans la console, ou ?touches=note à la fin de l'adresse de la page.
    if (contact) for (const m in keys) {
      const h = on[m]; if (!h) continue; const k = keys[m]; let d = null;
      pressedF.forEach(([hh, x, ty]) => { if (hh === h && Math.abs(built.ux(+m) - x) < 0.55) { const pen = (k.userData.blk ? 0.45 : 0) - (ty - 0.25); d = Math.max(d === null ? 0 : d, Math.max(0, Math.min(0.14, pen))); } });
      k.position.y = k.userData.y0 - (d === null ? 0.14 : d);
    }
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
  return { init, render, renderTo, el, zoomBy, show, stats, setContact: v => { contact = !!v; }, setScrollHandler: f => { onScroll = f; } };
})();
