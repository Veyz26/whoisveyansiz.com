// 3D scenes for KAVE Budget, built on three.js (vendor/three, MIT). Loaded on demand by app.js, only on
// Overview and the sign-in screens, so the rest of the app stays light.
//   mountJars(host, people)  one glass jar per person: its height is money in, the layers inside are
//                            where that money goes, and the clear glass at the top is what's left over.
//   mountBackdrop(host)      slow-floating ceramic "K" coins and pearls behind the sign-in card.
// Both return { dispose() }. They render only while on screen and the tab is visible, follow light/dark
// mode, and hold still for people who ask for reduced motion.
import * as THREE from "./vendor/three/three.module.min.js";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const color = (name, fallback) => new THREE.Color(cssVar(name) || fallback);
const isDark = () => {
  const forced = document.documentElement.dataset.theme;  // set by the app's Appearance choice
  return forced ? forced === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ shared stage
// A renderer sized to `host` that runs a frame loop only while it is visible and something moves.
function stage(host, { fov, maxDpr = 2, frame }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = "fx-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  scene.environment = studioEnvironment(renderer);

  const st = { renderer, scene, camera, width: 1, height: 1, visible: true, dirty: true, animating: true, onResize: null };
  let raf = 0;
  let last = performance.now();
  const loop = (now) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const keepGoing = frame(dt, now / 1000) || st.animating;
    renderer.render(scene, camera);
    st.dirty = false;
    if (keepGoing && st.visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  st.kick = () => {
    if (!raf && st.visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  };
  const resize = () => {
    st.width = Math.max(1, host.clientWidth);
    st.height = Math.max(1, host.clientHeight);
    renderer.setSize(st.width, st.height, false);
    camera.aspect = st.width / st.height;
    camera.updateProjectionMatrix();
    st.onResize?.();
    st.kick();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver(([e]) => {
    st.visible = e.isIntersecting;
    st.kick();
  });
  io.observe(host);
  const onVis = () => st.kick();
  document.addEventListener("visibilitychange", onVis);
  resize();

  st.dispose = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
    scene.environment?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  return st;
}

// Soft warm "photo studio" reflections, generated in code (no image files): a gradient dome with two
// soft boxes, pre-filtered for physically based materials.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.SphereGeometry(10, 32, 16);
  const top = new THREE.Color("#fff6ea");
  const bottom = new THREE.Color("#6b5646");
  const pos = dome.attributes.position;
  const cols = [];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / 10 + 1) / 2;
    const c = bottom.clone().lerp(top, Math.pow(t, 0.8));
    cols.push(c.r, c.g, c.b);
  }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const box = new THREE.PlaneGeometry(6, 3);
  for (const [x, y, z, s] of [[-5, 4, 3, 2.4], [6, 2, -2, 1.4]]) {
    const light = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(s, s * 0.96, s * 0.9), side: THREE.DoubleSide }));
    light.position.set(x, y, z);
    light.lookAt(0, 0, 0);
    env.add(light);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.06, transparent: true, opacity: isDark() ? 0.16 : 0.24,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false,
  });
}

// A soft round shadow under objects (a radial gradient on a flat plane; cheaper than real shadows).
function contactShadow(width, depth, strength) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, `rgba(40,26,16,${strength})`);
  grad.addColorStop(1, "rgba(40,26,16,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// ------------------------------------------------------------------ Overview: money jars
// Layer order, bottom to top. Colours come from CSS (--jar-*) so light and dark mode each use their own
// validated palette.
export const JAR_LAYERS = [
  { key: "Essentials", css: "--jar-essentials", fallback: "#8f4a2b" },
  { key: "Lifestyle", css: "--jar-lifestyle", fallback: "#d29a3a" },
  { key: "Savings", css: "--jar-savings", fallback: "#2f8f5b" },
  { key: "Transfers", css: "--jar-transfers", fallback: "#8b6bb0" },
];

const R = 0.92;          // jar outer radius
const WALL = 0.07;       // glass thickness (contents sit inside it)
const BASE = 0.08;       // glass floor
const GAP = 0.018;       // the thin gap between layers, so neighbours never merge
const SPACING = 2.75;    // between jar centres
const MAX_H = 2.6;       // tallest jar's inner height

function jarProfile(h) {
  const pts = [];
  pts.push(new THREE.Vector2(0.001, 0));
  for (let i = 0; i <= 6; i++) {           // rounded bottom edge
    const a = (-Math.PI / 2) + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - 0.14 + Math.cos(a) * 0.14, 0.14 + Math.sin(a) * 0.14));
  }
  pts.push(new THREE.Vector2(R, h - 0.12));
  pts.push(new THREE.Vector2(R * 0.97, h));        // shoulder
  pts.push(new THREE.Vector2(R * 0.9, h + 0.06));
  pts.push(new THREE.Vector2(R * 0.9, h + 0.2));   // neck
  pts.push(new THREE.Vector2(R * 0.94, h + 0.22)); // lip
  pts.push(new THREE.Vector2(R * 0.94, h + 0.27));
  pts.push(new THREE.Vector2(R * 0.88, h + 0.27));
  return pts;
}

export function mountJars(host, people, { format, onTip, onPick }) {
  const reduce = reducedMotion();
  const jars = [];
  const meshes = [];        // layers, for hover hit-testing
  const group = new THREE.Group();
  const maxIn = Math.max(1, ...people.map((p) => p.money_in_cents));

  let yaw = 0;
  let dragYaw = 0;
  let dragging = null;
  const born = performance.now() / 1000;

  const st = stage(host, {
    fov: 28,
    frame: (dt, t) => {
      let moving = false;
      // Layers rise into place, one jar after another.
      for (const [j, jar] of jars.entries()) {
        const p = reduce ? 1 : easeOut((t - born - 0.15 - j * 0.18) / 1.1);
        if (p < 1) moving = true;
        for (const l of jar.layers) {
          l.mesh.scale.y = Math.max(0.0001, p);
          l.mesh.position.y = BASE + (l.y0 + l.h / 2) * p;
        }
        jar.lid.position.y = jar.lidY + (jar.short ? 0.18 * p : 0);
        jar.lid.rotation.z = jar.short ? -0.32 * p : 0;
      }
      // Gentle idle sway; dragging takes over, then eases back.
      if (!dragging) dragYaw *= Math.pow(0.04, dt);
      const sway = reduce ? 0 : Math.sin(t * 0.45) * 0.16;
      const target = sway + dragYaw;
      yaw += (target - yaw) * Math.min(1, dt * 6);
      group.rotation.y = yaw;
      if (Math.abs(target - yaw) > 0.0005 || dragging) moving = true;
      scene.updateMatrixWorld();   // labels need this frame's positions, not the last render's
      camera.updateMatrixWorld();
      placeLabels();
      return moving || !reduce;
    },
  });
  st.animating = false;
  const { scene, camera } = st;

  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x5a4535, 0.9));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
  key.position.set(-3, 6, 5);
  scene.add(key);

  const glass = glassMaterial();
  const lidMat = new THREE.MeshStandardMaterial({ color: color("--jar-lid", "#b48a64"), roughness: 0.62, metalness: 0 });
  const layerMats = Object.fromEntries(JAR_LAYERS.map((l) => [l.key, new THREE.MeshStandardMaterial({ color: color(l.css, l.fallback), roughness: 0.5, metalness: 0, envMapIntensity: 0.8 })]));

  const x0 = -((people.length - 1) * SPACING) / 2;
  people.forEach((p, i) => {
    const jar = new THREE.Group();
    jar.position.x = x0 + i * SPACING;
    const h = MAX_H * Math.max(0.45, p.money_in_cents / maxIn);
    const inner = h - BASE;
    const glassMesh = new THREE.Mesh(new THREE.LatheGeometry(jarProfile(h), 72), glass);
    glassMesh.renderOrder = 2;
    jar.add(glassMesh);

    // Contents: each layer's height is its share of this person's money in. Spending more than comes in
    // pushes the contents past the rim (capped so the scene stays on screen), and the lid pops up.
    const scale = inner / Math.max(1, p.money_in_cents);
    const layers = [];
    let y = 0;
    for (const def of JAR_LAYERS) {
      const cents = p.groups[def.key] || 0;
      if (cents <= 0) continue;
      const lh = Math.max(0.03, Math.min(cents * scale, inner * 1.25 - y));
      if (lh <= 0.02) break;
      const geo = new THREE.CylinderGeometry(R - WALL, R - WALL, Math.max(0.01, lh - GAP), 64);
      const mesh = new THREE.Mesh(geo, layerMats[def.key]);
      mesh.userData = { id: p.id, person: p.name, layer: def.key, cents, share: Math.round((cents / Math.max(1, p.money_in_cents)) * 100) };
      jar.add(mesh);
      meshes.push(mesh);
      layers.push({ mesh, y0: y, h: lh });
      y += lh;
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.2, 64), lidMat);
    const lidY = h + 0.37;
    lid.position.set(0, lidY, 0);
    jar.add(lid);
    const shadow = contactShadow(R * 3.4, R * 3.4, isDark() ? 0.55 : 0.32);
    shadow.position.y = 0.002;
    jar.add(shadow);
    group.add(jar);
    jars.push({ group: jar, layers, lid, lidY, h, fill: BASE + y, short: p.surplus_cents < 0, person: p });
  });
  scene.add(group);

  // Frame the jars: fit their combined width (narrow screens) or height (wide screens).
  const frameCamera = () => {
    const width = (people.length - 1) * SPACING + R * 2 + 1.2;
    const height = MAX_H + 1.7;   // jars, lids and room for the name labels underneath
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = height / 2 / Math.tan(vFov / 2);
    const distW = width / 2 / (Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max(distH, distW) * 1.08;
    camera.position.set(0, MAX_H * 0.55 + dist * 0.16, dist);
    camera.lookAt(0, MAX_H * 0.36, 0);
  };
  st.onResize = frameCamera;
  frameCamera();

  // HTML labels that follow the jars: the person underneath, and what's left (or short) at the top.
  const overlay = document.createElement("div");
  overlay.className = "fx-labels";
  host.append(overlay);
  for (const jar of jars) {
    const p = jar.person;
    jar.nameEl = Object.assign(document.createElement("div"), { className: "fx-label name" });
    jar.nameEl.innerHTML = `<span class="dot ${p.cls}"></span>${escapeHtml(p.name)}<small>In ${format(p.money_in_cents)}</small>`;
    jar.leftEl = Object.assign(document.createElement("div"), { className: `fx-label left ${jar.short ? "warn" : ""}` });
    jar.leftEl.textContent = `${jar.short ? "Short" : "Left"} ${format(Math.abs(p.surplus_cents))}`;
    overlay.append(jar.nameEl, jar.leftEl);
  }
  const v = new THREE.Vector3();
  function placeLabels() {
    for (const jar of jars) {
      const at = (el, y, yOffsetPx) => {
        jar.group.localToWorld(v.set(0, y, R * 0.2));
        v.project(camera);
        el.style.transform = `translate(${((v.x + 1) / 2) * st.width}px, ${((1 - v.y) / 2) * st.height + yOffsetPx}px) translate(-50%, -50%)`;
      };
      at(jar.nameEl, 0, 40);
      // At the neck: the clear glass at the top is the money left over (or, when short, above the lid).
      at(jar.leftEl, jar.short ? jar.h + 0.8 : jar.h + 0.12, 0);
    }
  }

  // Hover a layer for its amount; tap it (without dragging) to see the items behind it.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canvas = st.renderer.domElement;
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    onTip(hit ? hit.object.userData : null, e.clientX - r.left, e.clientY - r.top);
    return hit?.object.userData || null;
  };
  const down = (e) => { dragging = { x: e.clientX, start: dragYaw, moved: false }; };
  const move = (e) => {
    if (dragging && e.buttons !== 0) {
      const dx = e.clientX - dragging.x;
      if (Math.abs(dx) > 4) dragging.moved = true;
      dragYaw = Math.max(-0.7, Math.min(0.7, dragging.start + dx / 260));
      st.kick();
    }
    if (e.pointerType === "mouse") pick(e);
  };
  const up = (e) => {
    if (dragging && !dragging.moved) {
      const d = pick(e);
      if (d && onPick) onPick(d);
    }
    dragging = null;
    st.kick();
  };
  const leave = () => onTip(null);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  canvas.addEventListener("pointerleave", leave);

  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const recolor = () => {
    for (const l of JAR_LAYERS) layerMats[l.key].color.copy(color(l.css, l.fallback));
    lidMat.color.copy(color("--jar-lid", "#b48a64"));
    glass.opacity = isDark() ? 0.16 : 0.24;
    st.kick();
  };
  scheme.addEventListener("change", recolor);

  return {
    recolor,
    dispose() {
      scheme.removeEventListener("change", recolor);
      removeEventListener("pointerup", up);
      onTip(null);
      overlay.remove();
      st.dispose();
    },
  };
}

// ------------------------------------------------------------------ sign-in backdrop
function coinStamp() {
  // A grayscale "K" used as a bump map, so each coin face looks pressed rather than printed.
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#a6a6a6";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#c4c4c4";
  g.font = `600 150px ${cssVar("--serif") || "Georgia, serif"}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("K", 128, 138);
  return new THREE.CanvasTexture(c);
}

export function mountBackdrop(host) {
  const reduce = reducedMotion();
  const small = Math.min(innerWidth, innerHeight) < 600;
  const things = [];
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const st = stage(host, {
    fov: 40,
    maxDpr: small ? 1.5 : 2,
    frame: (dt, t) => {
      for (const o of things) {
        o.mesh.position.y = o.base.y + (reduce ? 0 : Math.sin(t * o.speed + o.phase) * o.bob);
        if (!reduce) {
          o.mesh.rotation.x += o.spin.x * dt;
          o.mesh.rotation.y += o.spin.y * dt;
        }
      }
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.5);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.5);
      camera.position.set(pointer.x * 0.6, pointer.y * 0.4, 9);
      camera.lookAt(0, 0, 0);
      return !reduce;
    },
  });
  const { scene, camera } = st;
  st.animating = !reduce;

  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x4a3a2e, 1.0));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.5);
  key.position.set(-4, 5, 6);
  scene.add(key);

  const stamp = coinStamp();
  const tones = isDark()
    ? ["#d6b396", "#efe4d6", "#9a7259", "#b48a64", "#3a3029"]
    : ["#ecdccb", "#fffaf3", "#c9a98c", "#9a7259", "#3a2f28"];
  const coinGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.13, 64);
  const pearlGeo = new THREE.SphereGeometry(0.5, 48, 32);
  const pearl = new THREE.MeshPhysicalMaterial({
    color: isDark() ? "#e9ddd0" : "#f6efe6", roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08,
    iridescence: 0.7, iridescenceIOR: 1.35, sheen: 0.6, sheenColor: new THREE.Color("#ffe9dc"), envMapIntensity: 1.3,
  });

  // Place things in a loose ring so the middle (where the sign-in card sits) stays calm.
  const count = small ? 10 : 18;
  const rand = mulberry32(7);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.4;
    const ring = 4.2 + rand() * 2.6;
    const pos = new THREE.Vector3(Math.cos(a) * ring * 1.35, Math.sin(a) * ring * 0.72, -1 - rand() * 5);
    let mesh;
    if (i % 5 === 4) {
      mesh = new THREE.Mesh(pearlGeo, pearl);
      mesh.scale.setScalar(0.45 + rand() * 0.45);
    } else {
      const tone = new THREE.Color(tones[i % tones.length]);
      const side = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.42, metalness: 0.05 });
      const face = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.42, metalness: 0.05, bumpMap: stamp, bumpScale: 2.2 });
      mesh = new THREE.Mesh(coinGeo, [side, face, face]);
      mesh.scale.setScalar(0.8 + rand() * 0.7);
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    }
    mesh.position.copy(pos);
    scene.add(mesh);
    things.push({
      mesh, base: pos.clone(), bob: 0.12 + rand() * 0.25, speed: 0.3 + rand() * 0.4, phase: rand() * 6,
      spin: { x: (rand() - 0.5) * 0.35, y: (rand() - 0.5) * 0.45 },
    });
  }

  const onPointer = (e) => {
    pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ty = -((e.clientY / innerHeight) * 2 - 1);
  };
  if (!reduce) addEventListener("pointermove", onPointer);
  requestAnimationFrame(() => host.classList.add("on"));

  return {
    dispose() {
      removeEventListener("pointermove", onPointer);
      stamp.dispose();
      st.dispose();
    },
  };
}

// Small seeded random, so the backdrop looks the same every visit.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
