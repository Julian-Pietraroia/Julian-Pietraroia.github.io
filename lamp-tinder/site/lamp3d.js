// three.js port of gen_lamps.py's build_lamp(): builds a lamp from the same
// normalised parameter vector, so the combined lamp can be shown in the browser.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

const lerp = (a, b, t) => a + (b - a) * t;
// Blender is Z-up, three.js is Y-up: (x, y, z)_blender -> (x, z, -y)_three
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
const warmRgb = (w) => [1, lerp(0.88, 0.62, w), lerp(0.72, 0.32, w)];
const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

function shadeProfile(shape, r, h, taper, steps = 24) {
  const pts = [];
  if (shape === 'cone') { pts.push([r, 0], [r * lerp(0.25, 0.7, taper), h]); }
  else if (shape === 'drum') { pts.push([r, 0], [r * lerp(0.85, 1.0, taper), h]); }
  else if (shape === 'flare') {
    const top = r * lerp(0.12, 0.35, taper);
    for (let i = 0; i <= steps; i++) { const t = i / steps; pts.push([top + (r - top) * (1 - t) ** 2.2, h * t]); }
  } else if (shape === 'bell') {
    const top = r * lerp(0.15, 0.3, taper);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, k = 0.5 - 0.5 * Math.cos(Math.PI * t);
      pts.push([top + (r - top) * (1 - k) + 0.12 * r * (1 - t) ** 6, h * t]);
    }
  } else if (shape === 'dome') {
    for (let i = 0; i <= steps; i++) { const a = (Math.PI / 2) * i / steps; pts.push([r * Math.cos(a), h * Math.sin(a)]); }
  } else if (shape === 'globe') {
    const openR = r * lerp(0.25, 0.5, taper), a0 = Math.PI - Math.asin(openR / r);
    for (let i = 0; i <= steps; i++) { const a = lerp(a0, 0, i / steps); pts.push([r * Math.sin(a), r + r * Math.cos(a)]); }
    const zmin = Math.min(...pts.map(p => p[1]));
    pts.forEach(p => { p[1] -= zmin; });
  }
  return pts;
}

function shadeDims(p) {
  const r = lerp(0.07, 0.2, p.shade_radius) * ({ floor: 1.3, pendant: 1.35, arm: 0.75 }[p.type] ?? 1);
  if (p.shade_shape === 'globe') return [r, 2 * r];
  const ratio = { dome: 0.75, flare: 1.0, bell: 1.15 }[p.shade_shape] ?? 1;
  return [r, r * lerp(0.6, 1.4, p.shade_height) * ratio];
}

// Turn an open (r, z) profile into a closed loop `t` thick, offset towards the inside of the shade,
// so the revolved shade is a printable solid instead of a zero-thickness surface.
function thickenProfile(pts, t) {
  const inner = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dr = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dr, dz) || 1;
    return [Math.max(0, p[0] - t * dz / len), p[1] + t * dr / len];   // inward normal = (-dz, dr)
  });
  return [...pts, ...inner.reverse(), pts[0]];
}

function lathe(pts, mat) {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z)), 64);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function tube(points, radius, mat, smooth = true) {
  let curve;
  if (smooth && points.length > 2) curve = new THREE.CatmullRomCurve3(points);
  else {
    curve = new THREE.CurvePath();
    for (let i = 0; i < points.length - 1; i++) curve.add(new THREE.LineCurve3(points[i], points[i + 1]));
  }
  const g = new THREE.TubeGeometry(curve, 48 * (points.length - 1), radius, 16, false);
  const grp = new THREE.Group();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; grp.add(m);
  for (const end of [points[0], points[points.length - 1]]) {           // end caps
    const c = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 8), mat);
    c.position.copy(end); grp.add(c);
  }
  return grp;
}

function sphere(pos, radius, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.position.copy(pos); m.castShadow = true;
  return m;
}

function buildBase(p, mat, root) {
  const big = p.type === 'floor' ? 1.55 : 1;
  const R = lerp(0.06, 0.13, p.base_radius) * big;
  let H = lerp(0.012, 0.05, p.base_height) * big;
  const b = Math.min(0.004, H * 0.25);
  switch (p.base_shape) {
    case 'disc':
      root.add(lathe([[0, 0], [R - b, 0], [R, b], [R, H - b], [R - b, H], [0, H]], mat)); break;
    case 'stepped': {
      const H1 = H * 0.55, r2 = R * 0.62;
      root.add(lathe([[0, 0], [R, 0], [R, H1], [r2, H1], [r2, H * 1.6], [0, H * 1.6]], mat));
      H *= 1.6; break;
    }
    case 'dome': {
      const topR = lerp(0.015, 0.03, p.stem_thickness) * big, pts = [[0, 0], [R, 0]];
      for (let i = 1; i <= 16; i++) { const a = (Math.PI / 2) * i / 16; pts.push([topR + (R - topR) * Math.cos(a), H * 1.8 * Math.sin(a)]); }
      pts.push([0, H * 1.8]);
      root.add(lathe(pts, mat)); H *= 1.8; break;
    }
    case 'square': {
      const s = R * 1.7, m = new THREE.Mesh(new THREE.BoxGeometry(s, H, s), mat);
      m.position.y = H / 2; m.castShadow = true; root.add(m); break;
    }
    case 'tripod': {
      const hub = lerp(0.08, 0.16, p.base_height) * big, legR = lerp(0.004, 0.009, p.stem_thickness) * big, spread = R * 1.6;
      for (let i = 0; i < 3; i++) {
        const a = 2 * Math.PI * i / 3 + Math.PI / 6;
        root.add(tube([V(0, 0, hub), V(spread * Math.cos(a), spread * Math.sin(a), 0)], legR, mat, false));
      }
      root.add(sphere(V(0, 0, hub), legR * 2.2, mat));
      H = hub; break;
    }
  }
  return H;
}

export function buildLamp(p, { solid = false } = {}) {
  const root = new THREE.Group();
  const [metal, rough] = { matte: [0, 0.75], satin: [0, 0.35], metal: [1, 0.22] }[p.finish];
  const body = new THREE.MeshStandardMaterial({ color: srgb(p.body_color), metalness: metal, roughness: rough });
  const glow = p.shade_glow, warm = warmRgb(p.light_warmth);
  const shadeMetal = p.finish === 'metal' && glow < 0.25;
  const shade = new THREE.MeshStandardMaterial({
    color: srgb(p.shade_color), metalness: shadeMetal ? 1 : 0, roughness: shadeMetal ? 0.25 : 0.55,
    side: THREE.DoubleSide,
    emissive: srgb(p.shade_color.map((c, i) => c * warm[i])),
    emissiveIntensity: glow > 0.2 ? lerp(0, 1.6, glow) * 0.6 : 0,
  });

  const stemR = lerp(0.004, 0.011, p.stem_thickness) * (p.type === 'floor' ? 1.3 : 1);
  const bend = (p.stem_bend - 0.5) * 2;
  const [r, h] = shadeDims(p);
  let pts = shadeProfile(p.shade_shape, r, h, p.shade_taper);
  const closeTop = p.type === 'arm' || p.type === 'pendant';
  if (closeTop && pts[pts.length - 1][0] > 1e-4) pts.push([0, h]);
  if (solid) pts = thickenProfile(pts, 0.002);
  const shadeMesh = lathe(pts, shade);
  let bulb;

  if (p.type === 'table' || p.type === 'floor') {
    const bh = buildBase(p, body, root);
    const L = p.type === 'table' ? lerp(0.2, 0.42, p.stem_len) : lerp(1.05, 1.5, p.stem_len);
    const top = V(bend * 0.08 * L, 0, bh + L), mid = V(bend * 0.16 * L, 0, bh + L * 0.5);
    root.add(tube([V(0, 0, bh), mid, top], stemR, body));
    const drop = ['dome', 'globe'].includes(p.shade_shape) ? 0.35 : 0.55;
    shadeMesh.position.copy(top).add(new THREE.Vector3(0, -h * drop, 0));
    bulb = shadeMesh.position.clone().add(new THREE.Vector3(0, h * 0.4, 0));
  } else if (p.type === 'arm') {
    const bh = buildBase(p, body, root);
    const L = lerp(0.28, 0.5, p.stem_len), reach = lerp(0.15, 0.42, p.arm_reach);
    const elbow = V(lerp(-0.1, 0.04, p.stem_bend), 0, bh + L);
    const head = V(reach, 0, bh + L + lerp(-0.12, 0.12, p.stem_bend));
    root.add(tube([V(0, 0, bh), elbow, head], stemR, body, false));
    root.add(sphere(elbow, stemR * 1.8, body), sphere(head, stemR * 1.8, body));
    shadeMesh.geometry.translate(0, -h, 0);
    const tilt = THREE.MathUtils.degToRad(lerp(10, 60, p.shade_tilt));
    shadeMesh.rotation.z = tilt;
    shadeMesh.position.copy(head);
    bulb = head.clone().add(new THREE.Vector3(Math.sin(tilt), -Math.cos(tilt), 0).multiplyScalar(h * 0.55));
  } else { // pendant
    const cord = lerp(0.25, 0.8, p.stem_len);
    root.add(tube([V(0, 0, h), V(0, 0, h + cord)], 0.003, body, false));
    const capR = lerp(0.035, 0.065, p.base_radius), capH = lerp(0.015, 0.035, p.base_height), z = h + cord;
    root.add(lathe([[0, z], [capR, z], [capR, z + capH], [0, z + capH]], body));
    root.add(tube([V(0, 0, h - 0.002), V(0, 0, h + 0.03)], 0.012, body, false));
    bulb = V(0, 0, h * (p.shade_shape === 'globe' ? 0.5 : 0.45));
  }
  root.add(shadeMesh);

  const lightCol = srgb(warm);
  root.add(sphere(bulb, Math.min(0.025, r * 0.3),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lightCol, emissiveIntensity: 3 })));
  const pl = new THREE.PointLight(lightCol, lerp(0.02, 0.12, glow), 0, 2);
  pl.position.copy(bulb);
  root.add(pl);
  root.userData.pointLight = pl;
  return root;
}

/** Render an interactive, slowly rotating lamp into `container`. Returns a dispose fn. */
export function showLamp(container, params, { background = 0xdcd7cf } = {}) {
  const w = container.clientWidth, h = container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const lamp = buildLamp(params);
  // normalise to ~1 unit tall like the Blender renders
  let box = new THREE.Box3().setFromObject(lamp);
  const size = box.getSize(new THREE.Vector3());
  const s = 1 / Math.max(size.y, size.x * 0.9, size.z * 0.9);
  lamp.scale.setScalar(s);
  box = new THREE.Box3().setFromObject(lamp);
  const center = box.getCenter(new THREE.Vector3());
  lamp.position.set(-center.x, -box.min.y + (params.type === 'pendant' ? 0.12 : 0), -center.z);
  scene.add(lamp);
  // bulb brightness scales with the shrink
  lamp.userData.pointLight.intensity *= s * s;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a4, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.2, 3, 2.6); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2, bottom: -1, near: 0.5, far: 10 });
  key.shadow.radius = 6;
  scene.add(key);

  const finalBox = new THREE.Box3().setFromObject(lamp);
  const target = finalBox.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(28, w / h, 0.05, 50);
  const dir = new THREE.Vector3(1, 0.5, 1.7).normalize();
  camera.position.copy(target).addScaledVector(dir, 2.75);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.enableZoom = false;  // keep the mouse wheel for page scrolling
  controls.maxPolarAngle = Math.PI * 0.55;

  let raf;
  const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();
  const onResize = () => {
    const W = container.clientWidth, H = container.clientHeight;
    renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(raf); window.removeEventListener('resize', onResize);
    controls.dispose(); renderer.dispose(); pmrem.dispose(); renderer.domElement.remove();
  };
}

/** Build the lamp as printable solids at real size and return a binary STL Blob (mm, Z-up). */
export function lampSTL(params) {
  const lamp = buildLamp(params, { solid: true });
  const wrap = new THREE.Group();
  wrap.add(lamp);
  wrap.scale.setScalar(1000);          // metres -> millimetres
  wrap.rotation.x = Math.PI / 2;       // three.js Y-up -> CAD/slicer Z-up
  wrap.updateMatrixWorld(true);
  const data = new STLExporter().parse(wrap, { binary: true });
  return new Blob([data], { type: 'model/stl' });
}
