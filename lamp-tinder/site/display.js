// Print-ready display model: the blended lamp as a desk-sized model (about 16 cm tall) split into
// parts that each print WITHOUT supports, laid out on one plate, and pushed together with pegs.
//
//   - shade: printed solid, opening side down. A shade that is widest part-way up (a globe) is
//     cut at its widest point into two halves that each sit on their wide face.
//   - stem / arm / cords: printed lying flat (chamfered rods), they plug into holes in the
//     base and the shade.
//   - base: printed upright with a socket hole on top; tripod legs stand on little foot pads.
//   - pendant canopy: a disc with holes the cords push through.
// All mm, Z-up, every part's lowest point on z = 0.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { shadeProfile, shadeDims, buildLamp } from './lamp3d.js';

const lerp = (a, b, t) => a + (b - a) * t;
const PLATE = 220;        // usable plate, mm (fits 220-256 mm beds)
const GAP = 8;
const TARGET_H = 160;     // assembled model height, mm
const CLEAR = 0.25;       // peg-to-hole clearance (radius), mm
const MIN_ROD_R = 2;      // rods at least 4 mm thick
const MIN_BASE_H = 6;
const SEGS = 96;

// ---------- geometry helpers ----------
function revolve(loop, segs = SEGS, phiStart = 0) {      // closed (r, z) loop -> solid around Z
  const pts = loop.map(([r, z]) => new THREE.Vector2(Math.max(r, 0), z));
  if (pts[0].distanceTo(pts[pts.length - 1]) > 1e-9) pts.push(pts[0].clone());
  const g = new THREE.LatheGeometry(pts, segs, phiStart);
  g.rotateX(Math.PI / 2);                                 // lathe axis Y -> Z
  return g;
}
const clean = g => { const n = g.index ? g.toNonIndexed() : g; for (const a of ['uv', 'normal']) n.deleteAttribute(a); return mergeVertices(n, 1e-4); };

// a rod along a 2D centre line, lying flat on z = 0, with a regular-octagon section of apothem r
// (so it fits a round hole of radius ROD_FIT * r + clearance). ends: extra length of the left/right
// edges at the last point, to cut the end at an angle (tripod feet).
const ROD_FIT = 1.09;
function flatRod(line0, r, ends = [0, 0]) {
  const line = [line0[0]];
  for (const q of line0.slice(1, -1)) if (q.distanceTo(line[line.length - 1]) > r * 0.9) line.push(q);
  if (line.length > 1 && line0[line0.length - 1].distanceTo(line[line.length - 1]) < r * 0.9) line.pop();
  line.push(line0[line0.length - 1]);
  const bev = r * (1 - Math.tan(Math.PI / 8)), w = r - bev;
  const left = [], right = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize(), n = new THREE.Vector2(-t.y, t.x);
    let m = 1;
    if (i > 0 && i < line.length - 1) {                    // miter so the rod keeps its width at bends
      const s = new THREE.Vector2().subVectors(line[i], line[i - 1]).normalize();
      m = 1 / Math.max(0.35, Math.abs(n.dot(new THREE.Vector2(-s.y, s.x))));
    }
    const ext = i === line.length - 1 ? ends : [0, 0];
    left.push(line[i].clone().addScaledVector(n, w * m).addScaledVector(t, ext[0]));
    right.push(line[i].clone().addScaledVector(n, -w * m).addScaledVector(t, ext[1]));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape([...left, ...right.reverse()]),
    { depth: 2 * w, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, steps: 1, curveSegments: 1 });
  g.translate(0, 0, bev);
  return g;
}
function sampleCurve(pts, n = 24, smooth = true) {
  if (!smooth || pts.length < 3) return pts;
  const c = new THREE.SplineCurve(pts);
  return c.getPoints(n);
}
// vertical cylinder sitting on z = 0
function disc(x, y, r, h) { const g = new THREE.CylinderGeometry(r, r, h, 48); g.rotateX(Math.PI / 2); g.translate(x, y, h / 2); return g; }

// ---------- shade: solid, opening down, split at its widest point if needed ----------
// outer: (r, z) bottom -> top in mm. hole: {at: 'bottom'|'top', r, depth}. boss: {r, h} on top or null
function shadeParts(name, outer, hole, boss) {
  let prof = outer.map(p => [...p]);
  const topZ = Math.max(...prof.map(p => p[1]));
  if (boss) {
    const k = prof.findIndex(p => p[0] <= boss.r);
    if (k > 0) {
      const [r0, z0] = prof[k - 1], [r1, z1] = prof[k], t = (r0 - boss.r) / Math.max(1e-9, r0 - r1);
      prof = [...prof.slice(0, k), [boss.r, lerp(z0, z1, t)]];
    } else prof.push([boss.r, topZ]);
    prof.push([boss.r, topZ + boss.h]);
  }
  const top = prof[prof.length - 1][1];
  const holeIv = hole.at === 'bottom' ? [0, hole.depth] : [top - hole.depth, top];
  const envelope = pr => pr.map((p, i) => [Math.max(...pr.slice(i).map(q => q[0])), p[1]]);   // never wider higher up
  let w = 0; prof.forEach((p, i) => { if (p[0] > prof[w][0] + 1e-6) w = i; });
  const zw = prof[w][1];
  const pieces = [];
  if (zw <= 0.25 * top || w === prof.length - 1) {
    pieces.push({ name, prof: envelope(prof), iv: holeIv });
  } else {
    pieces.push({ name: `${name}_top`, prof: envelope(prof.slice(w).map(([r, z]) => [r, z - zw])), iv: [holeIv[0] - zw, holeIv[1] - zw] });
    pieces.push({ name: `${name}_bottom`, prof: envelope(prof.slice(0, w + 1).reverse().map(([r, z]) => [r, zw - z])), iv: [zw - holeIv[1], zw - holeIv[0]] });
  }
  return pieces.map(pc => {
    const zt = pc.prof[pc.prof.length - 1][1];
    const a = Math.max(0, pc.iv[0]), b = Math.min(zt, pc.iv[1]);
    const has = b - a > 0.01, hb = has && a < 0.01, ht = has && b > zt - 0.01, hr = hole.r;
    const loop = [[hb ? hr : 0, 0], ...pc.prof];
    if (hb && ht) loop.push([hr, zt]);                       // hole goes right through
    else if (ht) loop.push([hr, zt], [hr, a], [0, a]);
    else if (hb) loop.push([0, zt], [0, Math.min(b + hr, zt - 1)], [hr, b]);   // pointed ceiling: no bridging
    else loop.push([0, zt]);
    return { name: pc.name, geoms: [revolve(loop)] };
  });
}

// ---------- base: upright, socket on top; returns {parts, top (z of socket mouth), depth} ----------
function baseParts(p, s, hr, csg) {
  const big = p.type === 'floor' ? 1.55 : 1;
  const R = lerp(0.06, 0.13, p.base_radius) * big * s;
  let H = lerp(0.012, 0.05, p.base_height) * big * s;
  const shape = p.base_shape;
  if (shape === 'tripod' || shape === 'tall_tripod') {
    // hub with three angled leg sockets and a stem socket, printed upside down; legs printed flat
    let hub = lerp(0.08, 0.16, p.base_height) * big;
    if (shape === 'tall_tripod') hub = p.type === 'floor' ? lerp(0.35, 0.65, p.base_height) : lerp(0.14, 0.22, p.base_height);
    hub *= s;
    const lr = Math.max(lerp(0.004, 0.009, p.stem_thickness) * big * s, MIN_ROD_R), lh = lr * ROD_FIT + CLEAR, spread = R * 1.6;
    const th = Math.atan2(spread, hub), legLen = Math.hypot(spread, hub);
    const rh = Math.max(lr * 2.6, hr + 2.2, lh + 2.4), depth = Math.min(rh - 1, 10);
    const { Brush, Evaluator, SUBTRACTION } = csg;
    const ev = new Evaluator(); ev.attributes = ['position', 'normal']; ev.useGroups = false;
    const prep = g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };
    // hub in assembled orientation, centre at origin: a cylinder of radius rh and height 2 rh
    const cyl = (r, h, z) => { const g = new THREE.CylinderGeometry(r, r, h, 48); g.rotateX(Math.PI / 2); g.translate(0, 0, z); return g; };
    let body = new Brush(prep(cyl(rh, 2 * rh, 0)));
    body = ev.evaluate(body, new Brush(prep(cyl(hr, 2 * depth, rh))), SUBTRACTION);   // stem socket on top
    const tip = new THREE.ConeGeometry(hr, hr, 48); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, rh - depth - hr / 2);
    body = ev.evaluate(body, new Brush(prep(tip)), SUBTRACTION);                      // pointed end: prints upside down without bridging
    for (let i = 0; i < 3; i++) {
      const a = 2 * Math.PI * i / 3 + Math.PI / 6;
      const d = new THREE.Vector3(Math.sin(th) * Math.cos(a), Math.sin(th) * Math.sin(a), -Math.cos(th));
      const c = new THREE.CylinderGeometry(lh, lh, rh * 4, 32);           // along +Y, centred
      c.translate(0, rh * 2, 0);                                         // from the centre outwards
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
      body = ev.evaluate(body, new Brush(prep(c)), SUBTRACTION);
    }
    const hubG = body.geometry; hubG.rotateX(Math.PI);                    // upside down: flat top on the bed
    const parts = [{ name: 'base_hub', geoms: [hubG] }];
    // each leg runs from the hub centre to the floor; its foot is cut level with the floor
    const cut = lr * Math.tan(Math.PI / 8) * Math.tan(th);
    for (let i = 0; i < 3; i++) parts.push({ name: `leg${i + 1}`, geoms: [flatRod([new THREE.Vector2(0, 0), new THREE.Vector2(legLen, 0)], lr, [cut, -cut])] });
    return { parts, top: hub + rh, depth, legs: true };
  }
  H = Math.max(H * (shape === 'stepped' ? 1.6 : shape === 'dome' ? 1.8 : 1), MIN_BASE_H);
  const depth = Math.min(Math.max(H - 1.5, 3), 10);
  let loop, segs = SEGS, phi = 0;
  if (shape === 'disc') {
    const b = Math.min(0.004 * s, H * 0.25);
    loop = [[0, 0], [R - b, 0], [R, b], [R, H - b], [R - b, H], [hr, H], [hr, H - depth], [0, H - depth]];
  } else if (shape === 'stepped') {
    loop = [[0, 0], [R, 0], [R, H * 0.34], [R * 0.62, H * 0.34], [R * 0.62, H], [hr, H], [hr, H - depth], [0, H - depth]];
  } else if (shape === 'dome') {
    const topR = Math.max(lerp(0.015, 0.03, p.stem_thickness) * big * s, hr + 1.2);
    loop = [[0, 0], [R, 0]];
    for (let i = 1; i <= 16; i++) { const a = (Math.PI / 2) * i / 16; loop.push([topR + (R - topR) * Math.cos(a), H * Math.sin(a)]); }
    loop.push([hr, H], [hr, H - depth], [0, H - depth]);
  } else {                                                    // square: a 4-sided "lathe" is a square prism
    const c = R * 1.7 / 2 * Math.SQRT2, hs = hr * Math.SQRT2;
    loop = [[0, 0], [c, 0], [c, H], [hs, H], [hs, H - depth], [0, H - depth]]; segs = 4; phi = Math.PI / 4;
  }
  return { parts: [{ name: `base_${shape}`, geoms: [revolve(loop, segs, phi)] }], top: H, depth };
}

// ---------- the whole model at scale s (mm per metre) ----------
function buildParts(p, s, csg) {
  const [r0, h0] = shadeDims(p);
  const r = r0 * s, h = h0 * s;
  const outer = shadeProfile(p.shade_shape, r0, h0, p.shade_taper).map(([a, b]) => [a * s, b * s]);
  const t = p.type, notes = [];
  const sr = Math.max(lerp(0.004, 0.011, p.stem_thickness) * (t === 'floor' ? 1.3 : 1) * s, MIN_ROD_R), hr = sr * ROD_FIT + CLEAR;
  const parts = [];
  if (t === 'table' || t === 'floor') {
    const base = baseParts(p, s, hr, csg); parts.push(...base.parts);
    const L = (t === 'table' ? lerp(0.2, 0.42, p.stem_len) : lerp(1.05, 1.5, p.stem_len)) * s, bend = (p.stem_bend - 0.5) * 2;
    const drop = ['dome', 'globe'].includes(p.shade_shape) ? 0.35 : 0.55, ds = Math.max(drop * h, 6);
    const zb = base.top, top = new THREE.Vector2(bend * 0.08 * L, zb + L), mid = new THREE.Vector2(bend * 0.16 * L, zb + L * 0.5);
    const line = [new THREE.Vector2(0, zb - base.depth), new THREE.Vector2(0, zb), ...sampleCurve([new THREE.Vector2(0, zb), mid, new THREE.Vector2(top.x, top.y - ds)]).slice(1), top];
    parts.push({ name: 'stem', geoms: [flatRod(line, sr)] });
    parts.push(...shadeParts('shade', outer, { at: 'bottom', r: hr, depth: ds }, null));
    notes.push(base.legs ? 'Push the three legs into the angled holes in the hub (turn each leg so its slanted foot sits flat), push the stem into the top of the hub, then press the shade onto the top of the stem.'
      : 'Push the stem into the base, then press the shade down onto the top of the stem.');
  } else if (t === 'arm') {
    const base = baseParts(p, s, hr, csg); parts.push(...base.parts);
    const zb = base.top, L = lerp(0.28, 0.5, p.stem_len) * s, reach = lerp(0.15, 0.42, p.arm_reach) * s;
    const elbow = new THREE.Vector2(lerp(-0.1, 0.04, p.stem_bend) * s, zb + L), head = new THREE.Vector2(reach, zb + L + lerp(-0.12, 0.12, p.stem_bend) * s);
    const tilt = THREE.MathUtils.degToRad(lerp(10, 60, p.shade_tilt)), axis = new THREE.Vector2(Math.sin(tilt), -Math.cos(tilt));
    const rk = Math.max(lerp(0.004, 0.011, p.stem_thickness) * 1.8 * s, sr + 1.2), peg = 8;
    const tip = head.clone().addScaledVector(axis, rk + peg);
    const geoms = [flatRod([new THREE.Vector2(0, zb - base.depth), new THREE.Vector2(0, zb), elbow, head, tip], sr)];
    for (const k of [elbow, head]) { const c = disc(k.x, k.y, rk, 2 * sr); geoms.push(c); }
    parts.push({ name: 'arm', geoms });
    parts.push(...shadeParts('shade', outer, { at: 'top', r: hr, depth: peg }, { r: hr + 1.8, h: 2 }));
    notes.push((base.legs ? 'Push the three legs into the angled holes in the hub (slanted feet flat on the table), then push' : 'Push') + ' the arm into the base, then push the peg at the end of the arm into the top of the shade.');
  } else {                                                    // pendant (1 or 3 shades)
    const n = +(p.shade_count || 1), cordR = lerp(0.25, 0.8, p.stem_len) * s, spread = r0 * 1.45 * s;
    const capR = (n > 1 ? r0 * 1.45 + 0.03 : lerp(0.035, 0.065, p.base_radius)) * s, capT = Math.max(lerp(0.015, 0.035, p.base_height) * s, 4);
    const bossH = Math.max(0.03 * s, 4), peg = Math.min(10, bossH + h * 0.4);
    const holes = [], shapes = [];
    for (let i = 0; i < n; i++) {
      const a = THREE.MathUtils.degToRad(90 + 120 * i), ox = n > 1 ? Math.cos(a) * spread : 0, oy = n > 1 ? Math.sin(a) * spread : 0;
      const drop = n > 1 ? cordR * [0, 0.22, 0.4][i] : 0;
      const length = (cordR - drop) - bossH + peg + capT;          // shade boss top to canopy top, plus the peg
      parts.push({ name: `cord${n > 1 ? i + 1 : ''}`, geoms: [flatRod([new THREE.Vector2(0, 0), new THREE.Vector2(length, 0)], sr)] });
      parts.push(...shadeParts(`shade${n > 1 ? i + 1 : ''}`, outer, { at: 'top', r: hr, depth: peg }, { r: Math.max(0.012 * s, hr + 1.8), h: bossH }));
      holes.push(new THREE.Path().absarc(ox, oy, hr, 0, Math.PI * 2, true));
    }
    const shape = new THREE.Shape().absarc(0, 0, capR, 0, Math.PI * 2, false); shape.holes = holes;
    parts.push({ name: 'canopy', geoms: [new THREE.ExtrudeGeometry(shape, { depth: capT, bevelEnabled: false, curveSegments: 48 })] });
    notes.push(n > 1 ? 'Push each cord through a hole in the canopy and into the top of a shade. The cords are different lengths, so the shades hang at three heights.'
      : 'Push the cord through the canopy and into the top of the shade.');
  }
  return { parts, notes };
}

// shelf-pack parts onto the plate; returns false if they do not fit
function pack(parts) {
  for (const pt of parts) {
    pt.geoms = pt.geoms.map(clean);
    const box = new THREE.Box3();
    for (const g of pt.geoms) { g.computeBoundingBox(); box.union(g.boundingBox); }
    for (const g of pt.geoms) g.translate(-box.min.x, -box.min.y, -box.min.z);
    pt.size = box.getSize(new THREE.Vector3());
  }
  parts.sort((a, b) => b.size.y - a.size.y);
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const pt of parts) {
    if (x > 0 && x + pt.size.x > PLATE) { x = 0; y += rowH + GAP; rowH = 0; }
    pt.at = [x, y]; x += pt.size.x + GAP; rowH = Math.max(rowH, pt.size.y); width = Math.max(width, x - GAP);
  }
  const depth = y + rowH;
  if (width > PLATE || depth > PLATE) return false;
  for (const pt of parts) for (const g of pt.geoms) g.translate(pt.at[0] - width / 2, pt.at[1] - depth / 2, 0);
  return true;
}

export async function displayModel(params) {
  const csg = ['tripod', 'tall_tripod'].includes(params.base_shape) && params.type !== 'pendant' ? await import('three-bvh-csg') : null;
  const size = new THREE.Box3().setFromObject(buildLamp(params)).getSize(new THREE.Vector3());
  let s = TARGET_H / size.y;
  for (let tries = 0; tries < 12; tries++, s *= 0.9) {
    const { parts, notes } = buildParts(params, s, csg);
    if (pack(parts)) {
      const heightMm = Math.round(size.y * s);
      return { parts, notes, scale: s, heightMm };
    }
  }
  throw new Error('model does not fit on a 220 mm plate');
}

export async function displaySTL(params) {
  const m = await displayModel(params);
  const grp = new THREE.Group();
  for (const pt of m.parts) for (const g of pt.geoms) grp.add(new THREE.Mesh(g));
  grp.updateMatrixWorld(true);
  return { blob: new Blob([new STLExporter().parse(grp, { binary: true })], { type: 'model/stl' }), ...m };
}
