// "Build it yourself" kit: turns a lamp's parameters into printable parts (STL, mm, Z-up,
// already in print orientation), a bill of materials built around standard lamp hardware,
// and print estimates.
//
// Hardware assumptions (North American lamp parts):
//   - 1/8 IPS threaded lamp pipe (10.3 mm OD, ~6.8 mm ID) is the structural spine; cord runs inside it
//   - E26 socket with a 1/8 IPS threaded cap; shades use a "washer" fitter clamped between socket and nut
//   - plug-in cord set with inline switch (pendants: cord grip + canopy kit)
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { shadeProfile, shadeDims, thickenProfile } from './lamp3d.js';

const lerp = (a, b, t) => a + (b - a) * t;
const BED = 250;            // mm; parts bigger than this in X or Y get split in half
const PIPE_R = 5.4;         // clearance radius for 1/8 IPS pipe (10.3 mm OD)
const WALL = 2;             // shade wall thickness, mm
const SEGS = 96;
const PLA_DENSITY = 1.24;   // g/cm^3
const FILAMENT_CAD_PER_KG = 28;

// ---------- geometry helpers (all mm, Z-up) ----------
// revolve a closed (r, z) loop around Z; phi lets us make half-parts for splitting
function lathe(loop, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = loop.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.05), z));
  const g = new THREE.LatheGeometry(pts, phiLength < Math.PI * 2 ? SEGS / 2 : SEGS, phiStart, phiLength);
  g.rotateX(Math.PI / 2);                      // lathe axis Y -> Z
  return g;
}
// cap the open cut faces of a half-lathe so the half is a closed solid
function profileCap(loop, phi) {
  const shape = new THREE.Shape(loop.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.05), z)));
  const g = new THREE.ShapeGeometry(shape);     // in (r, z) = (x, y) plane
  g.rotateX(Math.PI / 2);                       // y -> z : now in the x-z plane (r along +x)
  g.rotateZ(phi - Math.PI / 2);                 // lathe puts angle phi at direction (sin phi, -cos phi) after the Y->Z turn
  return g;
}
function merge(geoms) {
  const parts = geoms.map(g => { const n = g.index ? g.toNonIndexed() : g.clone(); n.deleteAttribute('uv'); n.deleteAttribute('normal'); return n; });
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
// a solid of revolution; if wider than the print bed it is cut into four closed quarter
// wedges (each wedge is only one radius across), to be glued back together
function revolvedPart(name, loop, note, thin = false) {
  const maxR = Math.max(...loop.map(p => p[0]));
  if (2 * maxR <= BED) return [{ name, geom: merge([lathe(loop)]), note, thin }];
  const q = Math.PI / 2;
  return [0, 1, 2, 3].map(i => ({
    name: `${name}_quarter${i + 1}`, thin,
    geom: merge([lathe(loop, i * q, q), profileCap(loop, i * q), profileCap(loop, (i + 1) * q)]),
    note: `${note} ${Math.round(2 * maxR)} mm across, so it is cut into 4 wedges for a ${BED} mm bed; glue them together (CA or epoxy)` +
      (maxR > BED ? ' — each wedge is still too big for a 250 mm bed, so use a large-format printer or scale it down.' : '.'),
  }));
}
function tubeAlong(a, b, rOut, rIn) {               // hollow cylinder from point a to point b
  const len = a.distanceTo(b);
  const g = new THREE.LatheGeometry([new THREE.Vector2(rIn, 0), new THREE.Vector2(rOut, 0), new THREE.Vector2(rOut, len), new THREE.Vector2(rIn, len), new THREE.Vector2(rIn, 0)], 48);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  return g;
}
function box(w, d, h, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, d, h); g.translate(x, y, z + h / 2); return g; }

// signed volume of a closed triangle mesh, mm^3
function volume(geom) {
  const p = geom.attributes.position.array; let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return Math.abs(v);
}
function extent(geom) { geom.computeBoundingBox(); return geom.boundingBox.getSize(new THREE.Vector3()); }

// ball joint = sphere + a collar per direction, minus a pipe bore along each direction (CSG).
// Falls back to collars only (cord still passes) if the CSG library can't load.
async function ballJoint(R, dirs) {
  const collars = dirs.map(d => tubeAlong(d.clone().multiplyScalar(R * 0.6), d.clone().multiplyScalar(R + 16), R * 0.62, PIPE_R));
  try {
    const { Brush, Evaluator, SUBTRACTION, ADDITION } = await import('three-bvh-csg');
    const ev = new Evaluator(); ev.attributes = ['position', 'normal']; ev.useGroups = false;
    const prep = g => { const n = g.clone(); n.deleteAttribute('uv'); return mergeVertices(n); };
    let res = new Brush(prep(new THREE.SphereGeometry(R, 48, 24)));
    for (const c of dirs.map(d => tubeAlong(d.clone().multiplyScalar(R * 0.6), d.clone().multiplyScalar(R + 16), R * 0.62, 0.01))) {
      res = ev.evaluate(res, new Brush(prep(c)), ADDITION);
    }
    for (const d of dirs) {
      const len = R + 20, cyl = new THREE.CylinderGeometry(PIPE_R, PIPE_R, len + 4, 32);
      cyl.translate(0, len / 2 - 2, 0);
      cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
      res = ev.evaluate(res, new Brush(prep(cyl)), SUBTRACTION);
    }
    return merge([res.geometry]);
  } catch (e) {
    console.warn('CSG unavailable, using collar-only joint', e);
    return merge(collars);
  }
}

// ---------- parts ----------
function baseParts(p, mm) {
  const big = p.type === 'floor' ? 1.55 : 1;
  const R = lerp(0.06, 0.13, p.base_radius) * big * 1000;
  let H = Math.max(14, lerp(0.012, 0.05, p.base_height) * big * 1000);
  // big underside pocket: the base prints as a light shell and gets its weight from steel/sand ballast
  const rp = Math.max(R * 0.8, R - 14), pocket = Math.max(H * 0.5, H - 6);
  const parts = [], bom = [];
  const weightPocket = mm3 => { const g = Math.round(mm3 / 1000 * 7.85 * 0.55); if (g > 20) bom.push({ item: 'Ballast for the base pocket: steel washers/shot, or dry sand sealed in with a felt disc', qty: `up to ~${g} g of steel`, cost: 5 }); };
  switch (p.base_shape) {
    case 'square': {
      const s = R * 1.7;
      const pocketShape = new THREE.Shape(); pocketShape.moveTo(-s / 2, -s / 2); pocketShape.lineTo(s / 2, -s / 2); pocketShape.lineTo(s / 2, s / 2); pocketShape.lineTo(-s / 2, s / 2);
      const hole = r => { const h = new THREE.Path(); h.absarc(0, 0, r, 0, Math.PI * 2, true); return h; };
      const prs = Math.min(rp, s / 2 - 8);
      if (s <= BED) {
        const bottom = pocketShape.clone(); bottom.holes.push(hole(prs));
        const top = pocketShape.clone(); top.holes.push(hole(PIPE_R));
        const g1 = new THREE.ExtrudeGeometry(bottom, { depth: pocket, bevelEnabled: false, curveSegments: 48 });
        const g2 = new THREE.ExtrudeGeometry(top, { depth: H - pocket, bevelEnabled: false, curveSegments: 48 }); g2.translate(0, 0, pocket);
        parts.push({ name: 'base', geom: merge([g1, g2]), note: 'Print as-is (flat bottom). The pocket underneath takes ballast.' });
      } else {
        // too wide: four quadrants, each a square quarter minus a quarter-circle (pocket below, pipe hole above)
        const quad = (r, h, z0) => {
          const q = new THREE.Shape(); q.moveTo(r, 0); q.lineTo(s / 2, 0); q.lineTo(s / 2, s / 2); q.lineTo(0, s / 2); q.lineTo(0, r);
          q.absarc(0, 0, r, Math.PI / 2, 0, true);
          const g = new THREE.ExtrudeGeometry(q, { depth: h, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, z0); return g;
        };
        const g = merge([quad(prs, pocket, 0), quad(PIPE_R, H - pocket, pocket)]);
        parts.push({ name: 'base_quadrant_x4', geom: g, copies: 4,
          note: `Square base is ${Math.round(s)} mm wide, so it prints as 4 identical quadrants; glue them edge to edge (CA or epoxy), pipe hole in the centre.` });
      }
      weightPocket(Math.PI * rp * rp * pocket);
      break;
    }
    case 'tripod': case 'tall_tripod': {
      // printed hub + three wooden dowel legs; the lamp pipe passes straight through the hub
      let hub = lerp(0.08, 0.16, p.base_height) * big * 1000;
      if (p.base_shape === 'tall_tripod') hub = (p.type === 'floor' ? lerp(0.35, 0.65, p.base_height) : lerp(0.14, 0.22, p.base_height)) * 1000;
      const spread = R * 1.6, legLen = Math.hypot(spread, hub);
      const geoms = [tubeAlong(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 40), 15, PIPE_R)];
      const dir = new THREE.Vector3();
      for (let i = 0; i < 3; i++) {
        const a = 2 * Math.PI * i / 3 + Math.PI / 6;
        dir.set(spread * Math.cos(a), spread * Math.sin(a), -hub).normalize();
        const start = new THREE.Vector3(dir.x, dir.y, 0).normalize().multiplyScalar(10).add(new THREE.Vector3(0, 0, 20));
        geoms.push(tubeAlong(start, start.clone().addScaledVector(dir, 34), 9, 5.15));  // 10 mm dowel socket
      }
      parts.push({ name: 'tripod_hub', geom: merge(geoms), note: 'Print upright with supports under the leg sockets. Legs push in (add a drop of glue); the cord exits from the bottom of the hub.' });
      bom.push({ item: '10 mm (3/8") hardwood dowel, cut into 3 legs', qty: `3 × ${Math.round(legLen + 25)} mm`, cost: 6 });
      return { parts, bom, baseH: 40, hubZ: hub };
    }
    default: {   // disc / stepped / dome, revolved with the pipe hole and weight pocket built into the profile
      const b = Math.min(4, H * 0.25);
      let topZ = H, outer;
      if (p.base_shape === 'stepped') { const H1 = H * 0.55, r2 = R * 0.62; topZ = H * 1.6; outer = [[R, 0], [R, H1], [r2, H1], [r2, topZ]]; }
      else if (p.base_shape === 'dome') {
        const topR = Math.max(PIPE_R + 4, lerp(0.015, 0.03, p.stem_thickness) * big * 1000); topZ = H * 1.8; outer = [[R, 0]];
        for (let i = 1; i <= 16; i++) { const a = (Math.PI / 2) * i / 16; outer.push([topR + (R - topR) * Math.cos(a), topZ * Math.sin(a)]); }
      } else outer = [[R - b, 0], [R, b], [R, H - b], [R - b, H]];
      const pk = Math.min(pocket, topZ - 6), prr = Math.min(rp, R - 6);
      const loop = [[prr, 0], ...outer, [PIPE_R, topZ], [PIPE_R, pk], [prr, pk], [prr, 0]];
      parts.push(...revolvedPart('base', loop, 'Print flat side down. The pocket underneath takes steel weights; stick rubber feet on so the cord can exit under the base.'));
      weightPocket(Math.PI * (prr * prr - PIPE_R * PIPE_R) * pk);
      bom.push({ item: 'Adhesive rubber feet, 3–4 mm tall', qty: 4, cost: 4 });
      return { parts, bom, baseH: topZ };
    }
  }
  bom.push({ item: 'Adhesive rubber feet, 3–4 mm tall', qty: 4, cost: 4 });
  return { parts, bom, baseH: H };
}

function shadePart(p, name, closeTop, fitterZ) {
  const [r, h] = shadeDims(p);
  let pts = shadeProfile(p.shade_shape, r * 1000, h * 1000, p.shade_taper);
  const top = pts[pts.length - 1];
  if (closeTop) {                         // closed top with a hole for the socket's threaded cap
    if (top[0] > PIPE_R + 1) pts.push([PIPE_R, top[1]]); else top[0] = PIPE_R;
  }
  const loop = thickenProfile(pts, WALL).map(([x, z]) => [Math.max(x, closeTop ? PIPE_R : 0.05), Math.max(z, 0)]);  // flat rim on the bed
  const parts = revolvedPart(name, loop, closeTop
    ? 'Print rim-down. The hole in the top takes the socket\'s threaded cap (clamp with the socket ring/nut).'
    : 'Print rim-down. Glue the fitter ring in at the marked height.', true);
  if (!closeTop) {
    // washer fitter: flat ring + 3 spokes, sized to the inside wall at the fitter height
    const z = Math.min(fitterZ, h * 1000 - 1);
    let wallR = pts[0][0];
    for (let i = 1; i < pts.length; i++) if (pts[i][1] >= z) { const [a, b] = [pts[i - 1], pts[i]]; wallR = a[0] + (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || 1); break; }
    const inner = wallR - WALL - 0.5, ringR = Math.min(16, inner);
    const ring = tubeAlong(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 3), ringR, PIPE_R);
    const spokeLen = inner - ringR + 2;
    if (spokeLen > 1 && 2 * inner <= BED) {          // one-piece spider
      const spokes = [0, 1, 2].map(i => { const g = box(spokeLen, 6, 3, (inner + ringR) / 2 - 1, 0, 0); g.rotateZ(2 * Math.PI * i / 3); return g; });
      parts.push({ name: `${name}_fitter`, geom: merge([ring, ...spokes]), thin: false,
        note: `Flat print. Glue inside the shade ${Math.round(z)} mm above the rim; it clamps between the socket and its nut.` });
    } else {
      parts.push({ name: `${name}_fitter_ring`, geom: merge([ring]), thin: false,
        note: `Flat print; clamps between the socket and its nut ${Math.round(z)} mm above the shade rim.` });
      if (spokeLen > 1) parts.push({ name: `${name}_fitter_spoke_x3`, geom: merge([box(spokeLen, 6, 3)]), copies: 3, thin: false,
        note: `Print 3×; glue between the fitter ring and the shade wall, 120° apart.` });
    }
  }
  return parts;
}

function sleeveParts(lenMM, od, name) {
  // decorative printed sleeve over the lamp pipe, only when the design's stem is thicker than the pipe
  if (od < 14) return [];
  const n = Math.ceil(lenMM / 200), seg = lenMM / n;
  return [{ name: `${name}_sleeve_x${n}`, geom: merge([tubeAlong(new THREE.Vector3(), new THREE.Vector3(0, 0, seg), od / 2, PIPE_R + 0.3)]), copies: n,
    note: `Print ${n}× standing up; slide over the pipe to give the stem its ${Math.round(od)} mm look.` }];
}

function pipeBom(lenMM, what) {
  const out = [];
  const n = Math.ceil(lenMM / 900);
  out.push({ item: `1/8 IPS threaded lamp pipe (${what})`, qty: n > 1 ? `${n} × ${Math.ceil(lenMM / n / 25) * 25} mm` : `${Math.ceil(lenMM / 25) * 25} mm`, cost: 4 * Math.ceil(lenMM / 300) });
  if (n > 1) out.push({ item: '1/8 IPS straight coupling', qty: n - 1, cost: 2 * (n - 1) });
  return out;
}

// ---------- kit ----------
export async function buildKit(p) {
  const parts = [], bom = [], steps = [], notes = [];
  const stemOD = 2 * lerp(0.004, 0.011, p.stem_thickness) * (p.type === 'floor' ? 1.3 : 1) * 1000;
  const [r, h] = shadeDims(p);
  const hardware = [
    { item: 'E26 keyless socket with 1/8 IPS threaded cap', qty: 1, cost: 6 },
    { item: 'LED bulb, E26, warm white (≤ 9 W / 60 W equivalent; keep printed shades cool)', qty: 1, cost: 6 },
  ];

  if (p.type === 'pendant') {
    const n = +(p.shade_count || 1), cordLen = lerp(0.25, 0.8, p.stem_len) * 1000;
    for (let i = 0; i < n; i++) parts.push(...shadePart(p, n > 1 ? `shade_${i + 1}` : 'shade', true, 0));
    const spread = r * 1000 * 1.45, capR = Math.max(n > 1 ? spread + 30 : lerp(0.035, 0.065, p.base_radius) * 1000, 45), capH = 28;
    const holes = n > 1 ? [0, 1, 2].map(i => [Math.cos(Math.PI / 2 + 2 * Math.PI * i / 3) * spread, Math.sin(Math.PI / 2 + 2 * Math.PI * i / 3) * spread]) : [[0, 0]];
    // canopy: shallow cup, printed open side down; cord-grip holes in the face
    const cup = new THREE.Shape(); cup.absarc(0, 0, capR, 0, Math.PI * 2, false);
    for (const [x, y] of holes) { const hp = new THREE.Path(); hp.absarc(x, y, 6.5, 0, Math.PI * 2, true); cup.holes.push(hp); }
    if (capR * 2 <= BED) {
      const face = new THREE.ExtrudeGeometry(cup, { depth: 3, bevelEnabled: false, curveSegments: 64 });
      const wall = tubeAlong(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, capH), capR, capR - 2.5);
      parts.push({ name: 'canopy', geom: merge([face, wall]), note: 'Print face down. Fixes to the ceiling box with a standard canopy crossbar.' });
    } else {
      // wide cluster canopy: a shallow revolved cup cut into wedges; cord holes are drilled after gluing
      const loop = [[0.05, 0], [capR, 0], [capR, capH], [capR - 2.5, capH], [capR - 2.5, 3], [0.05, 3], [0.05, 0]];
      parts.push(...revolvedPart('canopy', loop, `Print face down. After gluing, drill ${n} × 13 mm cord holes ${Math.round(spread)} mm from the centre, 120° apart.`));
    }
    hardware.push({ item: 'E26 socket (additional, one per shade)', qty: n - 1, cost: 6 * (n - 1) });
    hardware[0].qty = 1;
    hardware.push({ item: 'Pendant cord (18/2 SPT-1), per shade', qty: `${n} × ${Math.round(cordLen + 400)} mm`, cost: 3 * n });
    hardware.push({ item: 'Cord grip / strain relief, 1/8 IPS', qty: n, cost: 4 * n });
    hardware.push({ item: 'Canopy crossbar kit with screws', qty: 1, cost: 8 });
    notes.push('Hard-wired pendants must be connected to the ceiling box by a licensed electrician (or use a plug-in swag kit instead).');
    steps.push('Thread each cord through a cord grip in the canopy and down to its shade.',
      'Pass the socket\'s threaded cap through the hole in each shade top and lock it with the socket ring.',
      'Wire the sockets (ribbed conductor to the silver/neutral screw), set the drops, tighten the cord grips.',
      'Mount the canopy crossbar to the ceiling box and have the supply connected by an electrician.');
  } else if (p.type === 'arm') {
    const base = baseParts(p, true); parts.push(...base.parts); bom.push(...base.bom);
    const bh = base.baseH / 1000, L = lerp(0.28, 0.5, p.stem_len), reach = lerp(0.15, 0.42, p.arm_reach);
    const elbow = new THREE.Vector3(lerp(-0.1, 0.04, p.stem_bend), 0, bh + L).multiplyScalar(1000);
    const head = new THREE.Vector3(reach, 0, bh + L + lerp(-0.12, 0.12, p.stem_bend)).multiplyScalar(1000);
    const foot = new THREE.Vector3(0, 0, base.baseH);
    const tilt = THREE.MathUtils.degToRad(lerp(10, 60, p.shade_tilt));
    // knuckles: ball joints with a pipe socket bored along each arm direction, meeting in the middle
    const ballR = Math.max(13, stemOD * 0.9 + 6);
    const knuckle = (dirs) => ballJoint(ballR, dirs);
    const dDown = foot.clone().sub(elbow).normalize(), dUp = head.clone().sub(elbow).normalize();
    parts.push({ name: 'elbow_joint', geom: await knuckle([dDown, dUp]), note: `Fixed-angle elbow (${Math.round(THREE.MathUtils.radToDeg(dDown.angleTo(dUp)))}°). Print with tree supports; the two pipes push in and are glued. Cord passes through the joint. If your slicer reports mesh errors, let it auto-repair.` });
    const dBack = elbow.clone().sub(head).normalize(), dShade = new THREE.Vector3(Math.sin(tilt), 0, -Math.cos(tilt));
    parts.push({ name: 'head_joint', geom: await knuckle([dBack, dShade]), note: 'Holds the shade at the designed tilt. A short 1/8 IPS nipple goes into the shade-side socket.' });
    parts.push(...shadePart(p, 'shade', true, 0));
    bom.push(...pipeBom(foot.distanceTo(elbow) + 20, 'lower arm'), ...pipeBom(elbow.distanceTo(head) + 20, 'upper arm'));
    bom.push({ item: '1/8 IPS nipple, 25 mm, + 2 hex nuts', qty: 1, cost: 3 });
    hardware.push({ item: 'Plug-in cord set with inline switch, 2.4 m', qty: 1, cost: 12 });
    steps.push('Fish the cord up through the base, lower pipe, elbow joint, upper pipe and head joint.',
      'Glue the pipes into the joints at the printed angles; lock the lower pipe into the base with a nut and washer from underneath.',
      'Thread the nipple into the head joint, pass it through the shade top, and screw the socket cap on to clamp the shade.',
      'Wire the socket, fit the bulb, add the base weights and rubber feet.');
  } else {   // table / floor
    const base = baseParts(p, true); parts.push(...base.parts); bom.push(...base.bom);
    const L = (p.type === 'table' ? lerp(0.2, 0.42, p.stem_len) : lerp(1.05, 1.5, p.stem_len)) * 1000;
    const drop = ['dome', 'globe'].includes(p.shade_shape) ? 0.35 : 0.55;
    const tripodLeg = base.hubZ ? base.hubZ : 0;
    const pipeLen = L - tripodLeg + base.baseH + 30;
    bom.push(...pipeBom(pipeLen, 'stem'), { item: '1/8 IPS hex nut + washer', qty: 2, cost: 2 });
    parts.push(...sleeveParts(L - tripodLeg, stemOD, 'stem'));
    parts.push(...shadePart(p, 'shade', false, h * 1000 * drop));   // fitter sits where the stem top meets the shade
    hardware.push({ item: 'Plug-in cord set with inline switch, 2.4 m', qty: 1, cost: 12 });
    if (Math.abs(p.stem_bend - 0.5) > 0.1) notes.push('The design\'s stem curve is straightened: lamp pipe is straight. Bend a softer tube (e.g. 3/8" brass) if you want the curve.');
    steps.push(base.hubZ ? 'Push the three dowel legs into the tripod hub and glue them.' : 'Drop the steel weights into the base pocket and seal with a disc of card or felt.',
      'Feed the pipe through the base (or hub) and lock it with a washer and nut on each side.',
      'Slide any printed stem sleeves over the pipe, then the shade fitter ring onto the top of the pipe.',
      'Thread the cord up the pipe, screw the socket cap onto the pipe so it clamps the fitter, and wire the socket.',
      'Fit the bulb and stick on the rubber feet.');
  }
  bom.push(...hardware);
  notes.push('Use an LED bulb only: printed PLA softens around 55 °C. PETG or ASA are safer for shades close to the bulb.',
    'Use certified (UL/CSA) electrical parts and check the wiring before plugging in.');

  // put every part on the print bed: centred in X/Y, lowest point at z = 0
  for (const part of parts) {
    part.geom.computeBoundingBox();
    const bb = part.geom.boundingBox, c = bb.getCenter(new THREE.Vector3());
    part.geom.translate(part.name.includes('quarter') ? 0 : -c.x, part.name.includes('quarter') ? 0 : -c.y, -bb.min.z);
  }

  // estimates
  let grams = 0, minutes = 0;
  for (const part of parts) {
    const v = volume(part.geom) / 1000 * (part.copies || 1);              // cm^3
    const g = v * PLA_DENSITY * (part.thin ? 1 : 0.3);                     // thin shells print ~solid; chunky parts ~15% infill + walls
    part.grams = Math.round(g); part.size = extent(part.geom);
    grams += g; minutes += g / 25 * 60 + 10 * (part.copies || 1);           // ~25 g/h on a current 0.4 mm-nozzle printer + setup
  }
  const filamentCost = grams / 1000 * FILAMENT_CAD_PER_KG;
  const hardwareCost = bom.reduce((s, b) => s + (b.cost || 0), 0);
  return { parts, bom, steps, notes, stats: { grams: Math.round(grams), hours: Math.round(minutes / 60 * 10) / 10, filamentCost, hardwareCost, total: filamentCost + hardwareCost } };
}

function readme(kit, title) {
  const s = kit.stats;
  return `# ${title}\n\nBuild-it-yourself kit generated by Lamp Tinder.\n\n` +
    `**Estimate:** ~${s.grams} g filament, ~${s.hours} h printing, ~CA$${Math.round(s.filamentCost)} filament + ~CA$${Math.round(s.hardwareCost)} hardware = **~CA$${Math.round(s.total)}**\n\n` +
    `## Printed parts (STL, millimetres, already in print orientation)\n\n| File | Size (mm) | Filament | Notes |\n|---|---|---|---|\n` +
    kit.parts.map(p => `| ${p.name}.stl | ${Math.round(p.size.x)} × ${Math.round(p.size.y)} × ${Math.round(p.size.z)} | ~${p.grams} g${p.copies ? ` (×${p.copies})` : ''} | ${p.note} |`).join('\n') +
    `\n\n## Hardware\n\n| Item | Qty | ~CA$ |\n|---|---|---|\n` + kit.bom.map(b => `| ${b.item} | ${b.qty} | ${b.cost ?? ''} |`).join('\n') +
    `\n\n## Assembly\n\n` + kit.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\n## Notes\n\n` + kit.notes.map(n => `- ${n}`).join('\n') + '\n';
}

async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = res; s.onerror = () => rej(new Error('could not load JSZip'));
    document.head.appendChild(s);
  });
  return window.JSZip;
}

/** Zip with one STL per printed part + README (BOM, steps, estimates). */
export async function kitZip(p, title) {
  const kit = await buildKit(p);
  const JSZip = await loadJSZip();
  const zip = new JSZip(), exp = new STLExporter();
  for (const part of kit.parts) {
    const mesh = new THREE.Mesh(part.geom);
    zip.file(`${part.name}.stl`, exp.parse(mesh, { binary: true }).buffer);
  }
  zip.file('README.md', readme(kit, title));
  return { blob: await zip.generateAsync({ type: 'blob' }), kit };
}
