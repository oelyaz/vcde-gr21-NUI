/* nui/signature.js
 *
 * Progressive enhancement: these effects are add-ons. If a CDN library 404s,
 * WebGL is missing, or this file never runs, the pages stay readable and the
 * demo still works. Each initializer checks for its own markup before loading
 * heavier libraries.
 */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Hero palette comes from the active CSS tokens; fallbacks match the site theme.
function cssToken(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function color3FromToken(B, name, fallback) {
  const value = cssToken(name, fallback);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    return B.Color3.FromHexString(value);
  }
  return B.Color3.FromHexString(fallback);
}

// Tiny UMD loader, cached and promise-based.
const _scripts = new Map();
function loadScript(src) {
  if (_scripts.has(src)) return _scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
  _scripts.set(src, p);
  return p;
}

// MediaPipe hand topology (21 landmarks), inlined to stay decoupled.
const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],            // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],            // index
  [9, 10], [10, 11], [11, 12],               // middle
  [13, 14], [14, 15], [15, 16],              // ring
  [0, 17], [17, 18], [18, 19], [19, 20],     // pinky
  [5, 9], [9, 13], [13, 17],                 // palm arch
];

// A stylised open-hand pose in 3D (normalised-ish, scaled in the scene).
function handTargets(B) {
  const P = [
    [0.00, -1.05, 0.00],                                  // 0 wrist
    [-0.34, -0.62, 0.06], [-0.60, -0.28, 0.12], [-0.80, -0.02, 0.16], [-0.96, 0.20, 0.20], // thumb 1-4
    [-0.20, -0.18, 0.00], [-0.22, 0.24, 0.02], [-0.23, 0.56, 0.03], [-0.24, 0.86, 0.04],   // index 5-8
    [0.02, -0.16, 0.00], [0.03, 0.30, 0.02], [0.035, 0.64, 0.03], [0.04, 0.98, 0.04],      // middle 9-12
    [0.24, -0.18, 0.00], [0.28, 0.22, 0.02], [0.30, 0.54, 0.03], [0.32, 0.84, 0.04],       // ring 13-16
    [0.44, -0.26, 0.00], [0.52, 0.06, 0.02], [0.56, 0.32, 0.03], [0.60, 0.58, 0.04],       // pinky 17-20
  ];
  const S = 2.2;
  return P.map(([x, y, z]) => new B.Vector3(x * S, y * S, z * S));
}

// Babylon hero animation.
async function initHero() {
  const canvas = document.getElementById('nui-hero-canvas');
  if (!canvas) return;

  let B;
  try {
    if (!window.BABYLON) await loadScript('https://cdn.babylonjs.com/babylon.js');
    B = window.BABYLON;
    if (!B) return;
  } catch { return; }                       // CDN down -> static CSS hero stays

  let engine;
  try {
    engine = new B.Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: true,
      adaptToDeviceRatio: true,             // render at device px, crisp on retina
      failIfMajorPerformanceCaveat: false,
    });
  } catch { return; }                       // no WebGL -> static CSS hero stays
  if (!engine) return;
  // Cap the render resolution at 2× so very high-DPR screens stay performant
  // while still looking sharp (avoids the pixelated look from CSS-px rendering).
  try { engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2)); } catch { /* ignore */ }

  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0, 0, 0, 0); // transparent over the CSS gradient

  const camera = new B.ArcRotateCamera(
    'cam', Math.PI / 2, Math.PI / 2.12, 7.4, new B.Vector3(0, 0.15, 0), scene);
  // Deliberately not user-controllable; no attachControl here.

  const light = new B.HemisphericLight('h', new B.Vector3(0, 1, 0), scene);
  light.intensity = 0.9;



  const accent = color3FromToken(B, '--nui-accent', '#0071e3');
  const accent2 = color3FromToken(B, '--nui-accent-2', '#0066cc');

  const root = new B.TransformNode('root', scene);
  // Park the constellation on the right so the headline + body copy on the left
  // breathe on a near-empty background (calmer first impression). Babylon's view
  // X is mirrored here (+X projects to screen-left), so a negative offset moves
  // the hand right. Calibrated: centre around 0.77 * width, px-per-world around h/6.05.
  const layoutHero = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight || 1;
    // Below 900px the copy spans full width (CSS drops the reserved column), so
    // centre the hand behind the veil instead of pushing it onto the text.
    if (w < 900) { root.position.x = 0; return; }
    const target = 0.77 * w;
    root.position.x = (0.536 * w - target) / (h / 6.05);
  };
  layoutHero();

  // Nodes: 21 emissive spheres via instancing.
  const TARGET = handTargets(B);

  // Additional hand-gesture poses for the auto-cycle, same coordinate system as the main hand.
  const mkPose = (P) => { const S = 2.2; return P.map(([x,y,z]) => new B.Vector3(x*S, y*S, z*S)); };
  // Peace / Victory: index + middle extended, others curled, thumb spread.
  const POSE_PEACE = mkPose([
    [0.00,-1.05,0.00],
    [-0.34,-0.62,0.06],[-0.62,-0.30,0.10],[-0.88,-0.04,0.14],[-1.04,0.18,0.18],
    [-0.22,-0.18,0.00],[-0.26,0.26,0.02],[-0.28,0.58,0.03],[-0.30,0.88,0.04],
    [0.04,-0.16,0.00],[0.06,0.30,0.02],[0.08,0.64,0.03],[0.10,0.96,0.04],
    [0.24,-0.18,0.00],[0.26,0.10,0.18],[0.28,0.06,0.35],[0.27,-0.04,0.40],
    [0.44,-0.26,0.00],[0.46,-0.04,0.15],[0.46,0.02,0.27],[0.45,-0.04,0.32],
  ]);
  // Point: index extended, others curled, thumb tucked.
  const POSE_POINT = mkPose([
    [0.00,-1.05,0.00],
    [-0.34,-0.62,0.06],[-0.52,-0.26,0.16],[-0.62,0.00,0.26],[-0.56,0.12,0.30],
    [-0.20,-0.18,0.00],[-0.22,0.24,0.02],[-0.23,0.56,0.03],[-0.24,0.86,0.04],
    [0.02,-0.16,0.00],[0.04,0.12,0.20],[0.04,0.08,0.38],[0.04,-0.04,0.44],
    [0.24,-0.18,0.00],[0.26,0.10,0.18],[0.28,0.06,0.35],[0.27,-0.04,0.40],
    [0.44,-0.26,0.00],[0.46,-0.04,0.15],[0.46,0.02,0.27],[0.45,-0.04,0.32],
  ]);
  // Fist: all fingers curled toward palm.
  const POSE_FIST = mkPose([
    [0.00,-1.05,0.00],
    [-0.34,-0.62,0.06],[-0.46,-0.24,0.16],[-0.38,0.00,0.28],[-0.22,0.08,0.32],
    [-0.20,-0.18,0.00],[-0.20,0.08,0.22],[-0.18,0.04,0.40],[-0.16,-0.06,0.44],
    [0.02,-0.16,0.00],[0.03,0.10,0.22],[0.03,0.06,0.42],[0.03,-0.06,0.46],
    [0.24,-0.18,0.00],[0.26,0.08,0.20],[0.27,0.04,0.38],[0.26,-0.06,0.42],
    [0.44,-0.26,0.00],[0.44,-0.04,0.16],[0.44,0.02,0.28],[0.43,-0.04,0.32],
  ]);
  const POSES = [TARGET, POSE_PEACE, POSE_POINT, POSE_FIST];
  const nodeMat = new B.StandardMaterial('nm', scene);
  nodeMat.emissiveColor = accent;
  nodeMat.diffuseColor = color3FromToken(B, '--nui-bg-2', '#ffffff');
  nodeMat.disableLighting = true;
  const base = B.MeshBuilder.CreateSphere('node', { diameter: 0.22, segments: 24 }, scene);
  base.material = nodeMat;
  base.parent = root;
  base.isVisible = false;
  const START = TARGET.map(() => new B.Vector3(
    (Math.random() * 2 - 1) * 4.2, (Math.random() * 2 - 1) * 3.0, (Math.random() * 2 - 1) * 3.0));
  const nodes = TARGET.map((_, i) => {
    const m = base.createInstance('node' + i);
    m.parent = root;
    m.position.copyFrom(START[i]);
    return m;
  });

  // Edges use cylinder tubes because WebGL lineWidth is capped at 1px cross-platform.
  const edgeMat = new B.StandardMaterial('em', scene);
  edgeMat.emissiveColor = accent2;
  edgeMat.disableLighting = true;
  edgeMat.alpha = 0.26;
  const edgeMeshes = HAND_EDGES.map(([a, b], i) => {
    const cyl = B.MeshBuilder.CreateCylinder('edge' + i,
      { diameter: 0.05, height: 1, tessellation: 6, cap: 0 }, scene);
    cyl.material = edgeMat;
    cyl.parent = root;
    cyl.isPickable = false;
    cyl.rotationQuaternion = B.Quaternion.Identity();
    return { mesh: cyl, a, b };
  });
  function updateEdges() {
    for (const { mesh, a, b } of edgeMeshes) {
      const pa = nodes[a].position, pb = nodes[b].position;
      mesh.position.copyFrom(B.Vector3.Center(pa, pb));
      const dist = B.Vector3.Distance(pa, pb);
      mesh.scaling.y = dist;
      const dir = pb.subtract(pa).normalize();
      const cross = B.Vector3.Cross(B.Axis.Y, dir);
      const cl = cross.length();
      if (cl > 0.001) {
        mesh.rotationQuaternion = B.Quaternion.RotationAxis(
          cross.scaleInPlace(1 / cl),
          Math.acos(Math.max(-1, Math.min(1, B.Vector3.Dot(B.Axis.Y, dir)))));
      }
    }
  }
  updateEdges();

  // Drifting background particle field.
  try {
    const pcs = new B.PointsCloudSystem('pcs', 5, scene);
    pcs.addPoints(130, (pt) => {
      pt.position = new B.Vector3(
        (Math.random() * 2 - 1) * 9, (Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 7);
      pt.color = new B.Color4(0.00, 0.42, 0.86, 0.08 + Math.random() * 0.14);
    });
    const cloud = await pcs.buildMeshAsync();
    cloud.parent = root;
  } catch { /* particles optional */ }

  // Intro morph + gesture cycle.
  const DURATION = 1700;
  const t0 = performance.now();
  let morphing = !REDUCED;
  const easeOut   = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2, 3)/2;

  // Pose-cycling state, active once the intro morph finishes.
  let poseIdx   = 0;
  let poseFrom  = TARGET;
  let poseTo    = POSES[1];
  let posePhase = 'hold';   // 'hold' | 'edges-out' | 'morph' | 'edges-in'
  let phaseStart = 0;

  if (REDUCED) {
    nodes.forEach((m, i) => m.position.copyFrom(TARGET[i]));
    updateEdges();
  }

  scene.registerBeforeRender(() => {
    const now = performance.now();
    if (morphing) {
      const k = Math.min(1, (now - t0) / DURATION);
      const e = easeOut(k);
      for (let i = 0; i < nodes.length; i++) {
        B.Vector3.LerpToRef(START[i], TARGET[i], e, nodes[i].position);
      }
      updateEdges();
      if (k >= 1) { morphing = false; posePhase = 'hold'; phaseStart = now; }
    } else if (!REDUCED) {
      if (posePhase === 'hold') {
        if (now - phaseStart >= 2400) {
          poseFrom = POSES[poseIdx].map(v => v.clone());
          poseIdx  = (poseIdx + 1) % POSES.length;
          poseTo   = POSES[poseIdx];
          posePhase = 'edges-out'; phaseStart = now;
        }
      } else if (posePhase === 'edges-out') {
        const k = Math.min(1, (now - phaseStart) / 300);
        edgeMat.alpha = 0.26 * (1 - k);
        if (k >= 1) { edgeMat.alpha = 0; posePhase = 'morph'; phaseStart = now; }
      } else if (posePhase === 'morph') {
        const k = Math.min(1, (now - phaseStart) / 900);
        const e = easeInOut(k);
        for (let i = 0; i < nodes.length; i++) {
          B.Vector3.LerpToRef(poseFrom[i], poseTo[i], e, nodes[i].position);
        }
        if (k >= 1) {
          nodes.forEach((n, i) => n.position.copyFrom(poseTo[i]));
          updateEdges();
          posePhase = 'edges-in'; phaseStart = now;
        }
      } else {
        const k = Math.min(1, (now - phaseStart) / 400);
        edgeMat.alpha = 0.26 * k;
        updateEdges();
        if (k >= 1) { edgeMat.alpha = 0.26; posePhase = 'hold'; phaseStart = now; }
      }
    }
    if (!REDUCED) {
      root.rotation.y += (engine.getDeltaTime() / 1000) * 0.12;
    }
  });

  canvas.classList.add('is-live');          // CSS fades the canvas in

  const renderFn = () => scene.render();
  const play = () => { engine.stopRenderLoop(); engine.runRenderLoop(renderFn); };
  const pause = () => engine.stopRenderLoop();

  if (REDUCED) {
    scene.render();                         // one still frame, no loop
  } else {
    play();
    // Pause the loop while the hero is off-screen. Frees the CPU for the
    // live MediaPipe demo further down the page.
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => { entries[0].isIntersecting ? play() : pause(); },
        { threshold: 0.01 });
      io.observe(canvas);
    }
  }

  window.addEventListener('resize', () => { engine.resize(); layoutHero(); }, { passive: true });
}

// Scroll-driven bits, with GSAP + ScrollTrigger and optional Lenis.
// Only pull in GSAP when this page actually has a scroll-driven moment.
function hasScrollTargets() {
  return !!document.getElementById('nui-flow')
      || !!document.getElementById('tbl-vergleich')
      || !!document.querySelector('.trex-stage');
}

async function initScrollMoments() {
  if (!hasScrollTargets()) return;          // nothing to animate, skip the lib

  let gsap, ScrollTrigger;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js');
    gsap = window.gsap;
    ScrollTrigger = window.ScrollTrigger;
    if (!gsap || !ScrollTrigger) return;    // no GSAP, static page with all content shown
    gsap.registerPlugin(ScrollTrigger);
  } catch { return; }

  // Lenis smooth scroll is a nicety; failure must not break scrolling.
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js');
    if (window.Lenis) {
      const lenis = new window.Lenis({ duration: 1.05, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      window.__nuiLenis = lenis;            // exposed in case other modules want it
    }
  } catch { /* native scroll is fine */ }

  initFlow(gsap, ScrollTrigger);
  initComparison(gsap, ScrollTrigger);
  initDino(gsap, ScrollTrigger);

  // Re-measure once fonts/late layout settle so triggers line up.
  ScrollTrigger.refresh();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
  }
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

/* MediaPipe pipeline flow on the Methode page.
 * A sticky SVG "scene" that morphs through the pipeline as the stage texts
 * scroll past it: camera frame, palm detection, affine ROI, 21 landmarks,
 * 3D lift, gesture/intent, temporal smoothing, mapping, action. Each stage
 * is a discrete, scroll-pinned scene change (robust + legible) rather than one
 * fragile scrubbed timeline.
 *
 * Progressive enhancement: the SVG's persistent layers (frame, hand, landmarks,
 * gesture chip) are visible by default in CSS, so with no JS the sticky panel is
 * a clean labelled diagram and the nine stage texts read normally. */
function initFlow(gsap, ScrollTrigger) {
  const flow = document.getElementById('nui-flow');
  const svg = document.getElementById('nui-flow-svg');
  if (!flow || !svg) return;
  const steps = Array.from(flow.querySelectorAll('.nui-flow-step'));
  if (!steps.length) return;

  const NS = 'http://www.w3.org/2000/svg';
  const g = (id) => svg.getElementById(id);

  // Build the 21-landmark constellation into #g-landmarks (the design motif).
  // Coordinates: a relaxed open right hand, mapped into the camera-frame region.
  const HAND2D = [
    [0.50, 0.92], [0.38, 0.82], [0.30, 0.72], [0.26, 0.63], [0.24, 0.55],   // wrist, thumb
    [0.44, 0.55], [0.43, 0.42], [0.42, 0.33], [0.42, 0.25],                 // index
    [0.52, 0.54], [0.53, 0.40], [0.53, 0.30], [0.53, 0.22],                 // middle
    [0.60, 0.56], [0.62, 0.43], [0.63, 0.34], [0.63, 0.27],                 // ring
    [0.67, 0.60], [0.70, 0.50], [0.71, 0.43], [0.72, 0.37],                 // pinky
  ];
  // Frame region in viewBox units (must match the <rect id="r-frame"> markup).
  const FX = 56, FY = 40, FW = 250, FH = 250;
  const pt = ([nx, ny]) => [FX + nx * FW, FY + ny * FH];

  const lmGroup = g('g-landmarks');
  if (lmGroup && !lmGroup.dataset.built) {
    for (const [a, b] of HAND_EDGES) {
      const [x1, y1] = pt(HAND2D[a]);
      const [x2, y2] = pt(HAND2D[b]);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
      ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
      ln.setAttribute('class', 'flow-edge');
      lmGroup.appendChild(ln);
    }
    HAND2D.forEach(([nx, ny], i) => {
      const [x, y] = pt([nx, ny]);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', i === 4 || i === 8 ? 5 : 3.6);
      c.setAttribute('class', 'flow-node' + (i === 4 || i === 8 ? ' is-key' : ''));
      lmGroup.appendChild(c);
    });
    lmGroup.dataset.built = '1';
  }

  // Stage to SVG groups that are lit. #g-frame is a faint constant backdrop.
  const ON = [
    ['g-hand', 'g-rec'],                          // 1 Aufnahme
    ['g-hand', 'g-detbox'],                        // 2 Detektion
    ['g-hand', 'g-roi'],                           // 3 ROI-Ausrichtung
    ['g-hand', 'g-landmarks'],                      // 4 Landmark-Regression
    ['g-hand', 'g-landmarks', 'g-depth'],           // 5 3D-Lifting
    ['g-hand', 'g-landmarks', 'g-gesture'],         // 6 Klassifikation/Intent
    ['g-hand', 'g-landmarks', 'g-smooth'],          // 7 Glättung
    ['g-hand', 'g-landmarks', 'g-map'],              // 8 Mapping
    ['g-hand', 'g-landmarks', 'g-action'],           // 9 Echtzeit/Aktion
  ];
  const ALL = ['g-hand', 'g-rec', 'g-detbox', 'g-roi', 'g-landmarks',
    'g-depth', 'g-gesture', 'g-smooth', 'g-map', 'g-action'];
  const LABELS = ['Aufnahme', 'Detektion', 'ROI-Ausrichtung', 'Landmark-Regression',
    '3D-Lifting', 'Klassifikation', 'Glättung', 'Mapping', 'Aktion'];

  const numEl = flow.querySelector('.nui-flow-stage-num');
  const labelEl = flow.querySelector('.nui-flow-stage-label');

  let current = -1;
  function setStage(i) {
    if (i === current) return;
    current = i;
    const lit = new Set(ON[i] || []);
    for (const id of ALL) {
      const el = g(id);
      if (!el) continue;
      gsap.to(el, {
        autoAlpha: lit.has(id) ? 1 : 0, duration: 0.45, ease: 'power2.out',
        overwrite: 'auto',
      });
      if (id === 'g-hand') el.classList.toggle('is-faded', i >= 7);
    }
    if (numEl) numEl.textContent = String(i + 1).padStart(2, '0');
    if (labelEl) labelEl.textContent = LABELS[i] || '';
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
  }

  // Start at stage 0; every group not in stage-0's set starts hidden.
  for (const id of ALL) {
    const el = g(id);
    if (el && !ON[0].includes(id)) gsap.set(el, { autoAlpha: 0 });
  }
  flow.classList.add('is-live');            // CSS dims inactive steps only now
  setStage(0);

  steps.forEach((step, i) => {
    ScrollTrigger.create({
      trigger: step,
      start: 'top 58%',
      end: 'bottom 58%',
      onEnter: () => setStage(i),
      onEnterBack: () => setStage(i),
    });
  });
}

// Comparison-table reveal.
function initComparison(gsap, ScrollTrigger) {
  const host = document.getElementById('tbl-vergleich');
  const table = host ? (host.matches('table') ? host : host.querySelector('table')) : null;
  if (!table) return;
  const rows = table.querySelectorAll('tbody tr');
  if (!rows.length) return;
  gsap.from(rows, {
    opacity: 0, y: 18, duration: 0.5, stagger: 0.08, ease: 'power2.out',
    immediateRender: false,
    scrollTrigger: { trigger: table, start: 'top 80%', once: true },
  });
}

// Dino-stage reveal.
function initDino(gsap, ScrollTrigger) {
  const stage = document.querySelector('.trex-stage');
  if (!stage) return;
  ScrollTrigger.create({
    trigger: stage, start: 'top 75%', once: true,
    onEnter: () => stage.classList.add('is-on'),
  });
  gsap.from(stage, {
    opacity: 0, y: 30, duration: 0.7, ease: 'power2.out', immediateRender: false,
    scrollTrigger: { trigger: stage, start: 'top 82%', once: true },
  });
  const sheen = stage.querySelector('.trex-stage-sheen');
  if (sheen) {
    gsap.to(sheen, {
      yPercent: 12, ease: 'none',
      scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }
}

// Bootstrap.
/* Quarto ships RequireJS on the page, so its `define.amd` makes UMD bundles
 * register as AMD modules instead of attaching to window, `window.gsap` /
 * `window.BABYLON` would otherwise stay undefined. Neutralise `define.amd`
 * while our UMD libraries load, then restore it. Nothing else loads AMD
 * modules at runtime on this static page, so the window is contained. */
const _amd = (typeof window.define === 'function' && window.define.amd) || null;
if (_amd) window.define.amd = undefined;
function restoreAMD() {
  if (_amd && typeof window.define === 'function') window.define.amd = _amd;
}

(async () => {
  try {
    await Promise.allSettled([
      initHero(),                                   // static CSS hero if it fails
      REDUCED ? Promise.resolve() : initScrollMoments(), // static page if it fails
    ]);
  } finally {
    restoreAMD();
  }

  // Native scroll-reveals, no GSAP needed. JS primes the start state so
  // without JS the content stays fully visible (progressive enhancement).
  if (!REDUCED && 'IntersectionObserver' in window) {
    const revealEls = document.querySelectorAll('.nui-reveal');
    if (revealEls.length) {
      revealEls.forEach(el => el.classList.add('nui-reveal-primed'));
      const ro = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('is-revealed'); ro.unobserve(e.target); }
        });
      }, { threshold: 0.12 });
      revealEls.forEach(el => ro.observe(el));
    }
  }
})();
