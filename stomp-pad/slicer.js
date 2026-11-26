/* Stomp Pad Studio slicer.
 * Turns the pad's meshes into G-code for a single-nozzle printer, one filament colour per layer,
 * with a pause wherever the colour changes. Stomp pads are stacks of flat-topped prisms, so a
 * raster slicer is enough: each layer is rasterised at 0.1 mm, walls come from a signed distance
 * field, infill is scanlines clipped to it.
 * Depends on PadCore (edt, contours, simplifyClosed).
 */
(function (root) {
  'use strict';
  const C = root.PadCore || (typeof require !== 'undefined' ? require('./core.js') : null);

  // ------------------------------------------------------------------ printers
  const BAMBU_START = (m) => `; ${m}: plain G-code printed from the SD card
M140 S{bed}
M104 S140
G28
M190 S{bed}
G29
M109 S{nozzle}
G90
M83
G1 Z0.3 F600
G1 X20 Y5 F6000
G1 X120 Y5 E12 F900
G1 X120 Y5.6 F900
G1 X40 Y5.6 E9 F900
G92 E0`;
  const PRUSA_START = `M140 S{bed}
M104 S170
G90
M83
G28
M190 S{bed}
G29
M109 S{nozzle}
G1 Z0.3 F720
G1 X10 Y-4 F6000
G1 X100 Y-4 E10 F900
G1 X10 Y-3.6 E8 F900
G92 E0`;
  const MARLIN_START = `M140 S{bed}
M104 S150
G90
M83
G28
M190 S{bed}
M109 S{nozzle}
G1 Z2 F600
G1 X5 Y20 F6000
G1 Z0.3 F600
G1 X5 Y180 E15 F900
G1 X5.5 Y180 F900
G1 X5.5 Y20 E15 F900
G92 E0`;
  const KLIPPER_START = `M140 S{bed}
M104 S150
G90
M83
G28
M190 S{bed}
M109 S{nozzle}
G1 Z2 F600
G1 X5 Y20 F6000
G1 Z0.3 F600
G1 X5 Y180 E15 F900
G1 X5.5 Y180 F900
G1 X5.5 Y20 E15 F900
G92 E0`;
  const END = (bedY) => `M104 S0
M140 S0
M107
G91
G1 Z10 F600
G90
G1 X5 Y${bedY} F6000
M84`;
  const PRINTERS = {
    'bambu-a1mini': { name: 'Bambu Lab A1 mini', group: 'Bambu Lab', bed: [180, 180], drive: 'direct', pause: 'M400 U1', park: [10, 170], start: BAMBU_START('Bambu Lab A1 mini'), experimental: true, multi: 'AMS lite' },
    'bambu-a1': { name: 'Bambu Lab A1', group: 'Bambu Lab', bed: [256, 256], drive: 'direct', pause: 'M400 U1', park: [10, 240], start: BAMBU_START('Bambu Lab A1'), experimental: true, multi: 'AMS lite' },
    'bambu-p1s': { name: 'Bambu Lab P1S / P1P', group: 'Bambu Lab', bed: [256, 256], drive: 'direct', pause: 'M400 U1', park: [10, 240], start: BAMBU_START('Bambu Lab P1S'), experimental: true, multi: 'AMS' },
    'bambu-x1c': { name: 'Bambu Lab X1 Carbon', group: 'Bambu Lab', bed: [256, 256], drive: 'direct', pause: 'M400 U1', park: [10, 240], start: BAMBU_START('Bambu Lab X1 Carbon'), experimental: true, multi: 'AMS' },
    'bambu-p2s': { name: 'Bambu Lab P2S', group: 'Bambu Lab', bed: [256, 256], drive: 'direct', pause: 'M400 U1', park: [10, 240], start: BAMBU_START('Bambu Lab P2S'), experimental: true, multi: 'AMS' },
    'prusa-mk4': { name: 'Prusa MK4 / MK4S', group: 'Prusa', bed: [250, 210], drive: 'direct', pause: 'M600', start: PRUSA_START },
    'prusa-coreone': { name: 'Prusa Core One', group: 'Prusa', bed: [250, 220], drive: 'direct', pause: 'M600', start: PRUSA_START },
    'prusa-mini': { name: 'Prusa MINI / MINI+', group: 'Prusa', bed: [180, 180], drive: 'bowden', pause: 'M600', start: PRUSA_START },
    'ender3v2': { name: 'Creality Ender-3 V2', group: 'Creality', bed: [220, 220], drive: 'bowden', pause: 'M600', start: MARLIN_START },
    'ender3s1': { name: 'Creality Ender-3 S1', group: 'Creality', bed: [220, 220], drive: 'direct', pause: 'M600', start: MARLIN_START },
    'ender3v3se': { name: 'Creality Ender-3 V3 SE', group: 'Creality', bed: [220, 220], drive: 'direct', pause: 'M600', start: MARLIN_START },
    'k1': { name: 'Creality K1 / K1C', group: 'Creality', bed: [220, 220], drive: 'direct', pause: 'PAUSE', park: [10, 200], start: KLIPPER_START },
    'neptune4': { name: 'Elegoo Neptune 4 / 4 Pro', group: 'Elegoo', bed: [225, 225], drive: 'direct', pause: 'PAUSE', park: [10, 210], start: KLIPPER_START },
    'generic-marlin': { name: 'Other Marlin printer', group: 'Other', bed: [220, 220], drive: 'direct', pause: 'M600', start: MARLIN_START, editable: true },
    'generic-klipper': { name: 'Other Klipper printer', group: 'Other', bed: [235, 235], drive: 'direct', pause: 'PAUSE', park: [10, 220], start: KLIPPER_START, editable: true },
  };
  const FILAMENTS = {
    tpu: { name: 'TPU 95A', nozzle: 228, bed: 45, speed: 25, first: 15, fan: 60, retract: { direct: 0.8, bowden: 1.5 }, rspeed: 25 },
    tpuams: { name: 'TPU for AMS (68D)', nozzle: 230, bed: 35, speed: 40, first: 20, fan: 60, retract: { direct: 0.8, bowden: 2 }, rspeed: 30, bambuOnly: true },
    pla: { name: 'PLA', nozzle: 210, bed: 60, speed: 60, first: 25, fan: 100, retract: { direct: 0.8, bowden: 5 }, rspeed: 40 },
    petg: { name: 'PETG', nozzle: 240, bed: 75, speed: 50, first: 20, fan: 40, retract: { direct: 0.8, bowden: 4 }, rspeed: 35 },
  };

  // ------------------------------------------------------------------ geometry
  function zRange(pos) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 2; i < pos.length; i += 3) { if (pos[i] < lo) lo = pos[i]; if (pos[i] > hi) hi = pos[i]; }
    return [lo, hi];
  }
  function xyBounds(meshes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) {
      const x = m.pos[i], y = m.pos[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  }
  // fill mask (OR) with the cross-section of one closed mesh at height z (even-odd per mesh)
  function rasterSection(pos, z, G, mask) {
    const segs = [];
    for (let i = 0; i < pos.length; i += 9) {
      const p = [[pos[i], pos[i + 1], pos[i + 2]], [pos[i + 3], pos[i + 4], pos[i + 5]], [pos[i + 6], pos[i + 7], pos[i + 8]]];
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const a = p[k], b = p[(k + 1) % 3];
        if ((a[2] < z) !== (b[2] < z)) { const t = (z - a[2]) / (b[2] - a[2]); pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
      }
      if (pts.length === 2) segs.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    }
    if (!segs.length) return;
    // scanline fill, rows at pixel centres
    const rows = new Array(G.h);
    for (let s = 0; s < segs.length; s += 4) {
      let ax = (segs[s] - G.x0) / G.r, ay = (segs[s + 1] - G.y0) / G.r, bx = (segs[s + 2] - G.x0) / G.r, by = (segs[s + 3] - G.y0) / G.r;
      if (ay === by) continue;
      if (ay > by) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
      const j0 = Math.max(0, Math.ceil(ay - 0.5)), j1 = Math.min(G.h - 1, Math.ceil(by - 0.5) - 1);
      for (let j = j0; j <= j1; j++) {
        const yc = j + 0.5, x = ax + (yc - ay) / (by - ay) * (bx - ax);
        (rows[j] || (rows[j] = [])).push(x);
      }
    }
    for (let j = 0; j < G.h; j++) {
      const xs = rows[j]; if (!xs) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(G.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let i = i0; i <= i1; i++) mask[j * G.w + i] = 1;
      }
    }
  }
  function sdfMM(mask, G) {
    const din = C.edt(mask, G.w, G.h, 0), dout = C.edt(mask, G.w, G.h, 1);
    const f = new Float32Array(G.w * G.h);
    for (let i = 0; i < f.length; i++) f[i] = (mask[i] ? Math.sqrt(din[i]) - 0.5 : -(Math.sqrt(dout[i]) - 0.5)) * G.r;
    return f;
  }
  const sample = (f, G, x, y) => {
    const i = Math.floor((x - G.x0) / G.r), j = Math.floor((y - G.y0) / G.r);
    if (i < 0 || j < 0 || i >= G.w || j >= G.h) return -1e9;
    return f[j * G.w + i];
  };
  const maskAt = (m, G, x, y) => {
    const i = Math.floor((x - G.x0) / G.r), j = Math.floor((y - G.y0) / G.r);
    return i >= 0 && j >= 0 && i < G.w && j < G.h && m[j * G.w + i] === 1;
  };
  // closed loops at distance d (mm) inside the region, in mm
  function insetLoops(f, G, d) {
    const loops = C.contours(f, G.w, G.h, d);
    const out = [];
    for (const L of loops) {
      const mm = L.map(([x, y]) => [G.x0 + (x + 0.5) * G.r, G.y0 + (y + 0.5) * G.r]);
      const s = C.simplifyClosed(mm, 0.02);
      let len = 0; for (let k = 0; k < s.length; k++) { const a = s[k], b = s[(k + 1) % s.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      if (s.length >= 3 && len > 1.2) out.push(s);
    }
    return out;
  }
  // scanlines at angle a, spacing sp, kept where ok(x, y); returns segments [[x0,y0],[x1,y1]]
  function hatch(G, a, sp, ok, phase = 0) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const cx = G.x0 + G.w * G.r / 2, cy = G.y0 + G.h * G.r / 2, R = Math.hypot(G.w, G.h) * G.r / 2 + 1;
    const segs = [], st = G.r * 0.8;
    for (let s = -R + ((phase % sp) + sp) % sp; s <= R; s += sp) {
      let run = null;
      for (let t = -R; t <= R + st; t += st) {
        const x = cx + ca * t - sa * s, y = cy + sa * t + ca * s;
        const inside = t <= R && ok(x, y);
        if (inside && !run) run = [[x, y], [x, y]];
        else if (inside) run[1] = [x, y];
        else if (run) { if (Math.hypot(run[1][0] - run[0][0], run[1][1] - run[0][1]) > 0.5) segs.push(run); run = null; }
      }
    }
    return segs;
  }

  // colour bands: the pad colour up to the top of the pad, then one band per distinct top above it.
  // Each band takes the colour of the part whose top it is; parts that share a top share one colour.
  function plan(meshes, raisedColor) {
    meshes = meshes.map(m => m.z ? m : ({ ...m, z: zRange(m.pos) }));
    const baseM = meshes.find(m => m.kind === 'base') || meshes[0];
    const baseTop = baseM.z[1];
    const tops = [...new Set(meshes.map(m => +m.z[1].toFixed(3)))].sort((a, b) => a - b).filter(t => t > baseTop + 1e-3);
    const bands = [{ z0: 0, z1: baseTop, color: -1 }];
    let prev = baseTop;
    for (const t of tops) {
      const ending = meshes.filter(m => Math.abs(m.z[1] - t) < 1e-3).map(m => m.color);
      // more than one colour ends at this height: they print in the colour the user picked
      const col = ending.length === 1 ? ending[0] : (ending.includes(raisedColor) ? raisedColor : ending[0]);
      bands.push({ z0: prev, z1: t, color: col, merged: ending.length > 1 ? ending : null });
      prev = t;
    }
    // merge neighbouring bands of the same colour
    for (let k = bands.length - 1; k > 0; k--) if (bands[k].color === bands[k - 1].color) { bands[k - 1].z1 = bands[k].z1; bands.splice(k, 1); }
    return bands;

  }

  // ------------------------------------------------------------------ slicing
  /* meshes: [{pos (mm, z up), color}], plan: colour per z band
   * opts: {printer, filament, layerH, walls, infill, nozzleT, bedT, speed, startGcode, endGcode, pauseGcode, bed}
   * names: colour id -> display name
   * Returns {gcode, layers (for preview), bands, swaps, time, filament} */
  async function slice(meshes, opts, names, onProgress) {
    const P = PRINTERS[opts.printer], F = FILAMENTS[opts.filament];
    const lh = opts.layerH || 0.2, lw = 0.45, lw0 = 0.5, walls = opts.walls || 3;
    const nozzle = opts.nozzleT || F.nozzle, bedT = opts.bedT || F.bed, speed = opts.speed || F.speed;
    const bed = opts.bed || P.bed;
    const retract = P.drive === 'bowden' ? F.retract.bowden : F.retract.direct;
    meshes = meshes.map(m => ({ ...m, z: zRange(m.pos) }));
    const top = Math.max(...meshes.map(m => m.z[1]));
    const bands = plan(meshes, opts.raisedColor);
    // ---- grid, centred on the bed (rotated 90° if that's what fits)
    const [bx0, by0, bx1, by1] = xyBounds(meshes);
    const pw = bx1 - bx0, ph = by1 - by0;
    const fitsN = pw <= bed[0] - 20 && ph <= bed[1] - 20, fitsR = ph <= bed[0] - 20 && pw <= bed[1] - 20;
    const rot = !fitsN && fitsR;
    if (!fitsN && !fitsR) throw new Error(`The pad (${Math.round(bx1 - bx0)} × ${Math.round(by1 - by0)} mm) doesn't fit on the ${P.name} bed.`);
    const r = 0.1, m = 2;
    const G = { r, x0: bx0 - m, y0: by0 - m, w: Math.ceil((bx1 - bx0 + 2 * m) / r), h: Math.ceil((by1 - by0 + 2 * m) / r) };
    const pcx = (bx0 + bx1) / 2, pcy = (by0 + by1) / 2;
    const toBed = (x, y) => {
      let dx = x - pcx, dy = -(y - pcy);              // design y runs down the screen; flip so the print isn't mirrored
      if (rot) [dx, dy] = [-dy, dx];
      return [bed[0] / 2 + dx, bed[1] / 2 + dy];
    };

    // ---- rasterise every layer
    const nL = Math.max(1, Math.round(top / lh));
    const masks = [];
    for (let L = 0; L < nL; L++) {
      const z = Math.min(top - 1e-4, (L + 0.5) * lh);
      const mk = new Uint8Array(G.w * G.h);
      for (const ms of meshes) if (z > ms.z[0] && z < ms.z[1]) rasterSection(ms.pos, z, G, mk);
      masks.push(mk);
      if (onProgress && L % 4 === 0) { onProgress(0.4 * L / nL); await new Promise(res => setTimeout(res)); }
    }
    // ---- toolpaths per layer (walls and fields are cached for identical layers)
    const SOLID = 4, layers = [];
    let cacheKey = null, cache = null;
    const hashMask = mk => { let h = 2166136261; for (let i = 0; i < mk.length; i += 7) h = Math.imul(h ^ mk[i] ^ (i & 255), 16777619); return h; };
    for (let L = 0; L < nL; L++) {
      const mk = masks[L], z = (L + 1) * lh, w = L === 0 ? lw0 : lw;
      const key = hashMask(mk);
      if (key !== cacheKey) {
        const f = sdfMM(mk, G);
        const wallLoops = [];
        for (let k = 0; k < walls; k++) wallLoops.push(insetLoops(f, G, (k + 0.5) * lw));
        cache = { f, wallLoops }; cacheKey = key;
      }
      const { f, wallLoops } = cache;
      // solid where this layer is the first/last few above or below empty space
      const solidAt = (x, y) => {
        for (let d = 1; d <= SOLID; d++) {
          if (L - d < 0 || !maskAt(masks[L - d], G, x, y)) return true;
          if (L + d >= nL || !maskAt(masks[L + d], G, x, y)) return true;
        }
        return false;
      };
      const inner = walls * lw + 0.3 * lw;
      const ang = (L % 2 ? 135 : 45) * Math.PI / 180;
      const solid = hatch(G, ang, w, (x, y) => sample(f, G, x, y) > inner && solidAt(x, y));
      const sparseSp = lw / Math.max(0.05, opts.infill || 0.25) * 2;      // grid: two directions
      const sparse = [];
      if ((opts.infill || 0.25) > 0) for (const a of [45, 135]) sparse.push(...hatch(G, a * Math.PI / 180, sparseSp, (x, y) => sample(f, G, x, y) > inner && !solidAt(x, y), 0));
      const band = bands.find(b => z <= b.z1 + 1e-6) || bands[bands.length - 1];
      layers.push({ z, w, walls: wallLoops, solid, sparse, color: band.color });
      if (onProgress && L % 2 === 0) { onProgress(0.4 + 0.5 * L / nL); await new Promise(res => setTimeout(res)); }
    }

    // ---- G-code
    const E = (len, wd, h) => len * wd * h / 2.4053 ;          // 1.75 mm filament
    const out = [], fmt = v => (Math.round(v * 1000) / 1000).toString();
    let X = null, Y = null, Zc = 0, t = 0, totalE = 0, retracted = false;
    const perColour = {};
    const fill = (s) => s.replace(/\{bed\}/g, bedT).replace(/\{nozzle\}/g, nozzle);
    out.push('; Generated by Stomp Pad Studio', `; Printer: ${P.name}`, `; Filament: ${F.name}, ${nozzle} °C nozzle, ${bedT} °C bed`, `; Layer height ${lh} mm, ${walls} walls, ${Math.round((opts.infill || 0.25) * 100)}% infill`, ';');
    out.push(fill(opts.startGcode || P.start));
    out.push('M107', 'G92 E0');
    const travel = (x, y) => {
      const d = X == null ? 99 : Math.hypot(x - X, y - Y);
      if (d < 0.01) return;
      if (d > 2 && !retracted && retract > 0) { out.push(`G1 E-${retract} F${F.rspeed * 60}`); retracted = true; }
      out.push(`G0 X${fmt(x)} Y${fmt(y)} F9000`); t += d / 150; X = x; Y = y;
    };
    const extrudeTo = (x, y, wd, sp) => {
      if (retracted) { out.push(`G1 E${retract} F${F.rspeed * 60}`); retracted = false; }
      const d = Math.hypot(x - X, y - Y); if (d < 0.01) return;
      const e = E(d, wd, lh); totalE += e;
      out.push(`G1 X${fmt(x)} Y${fmt(y)} E${e.toFixed(5)} F${Math.round(sp * 60)}`);
      t += d / sp; X = x; Y = y; return e;
    };
    const swaps = [];
    let curColour = null;
    for (let L = 0; L < layers.length; L++) {
      const ly = layers[L], sp = L === 0 ? F.first : speed;
      if (curColour !== null && ly.color !== curColour) {
        // colour change: lift, park, pause for a manual swap
        swaps.push({ layer: L + 1, z: +(ly.z - lh).toFixed(2), color: ly.color });
        out.push(`; ---- colour change: load ${names(ly.color)} ----`);
        if (!retracted) { out.push(`G1 E-${retract} F${F.rspeed * 60}`); retracted = true; }
        out.push(`G1 Z${fmt(Zc + 5)} F600`);
        if (P.park) out.push(`G0 X${P.park[0]} Y${P.park[1]} F9000`);
        out.push(`M117 Load ${names(ly.color)}`);
        out.push(...(opts.pauseGcode || P.pause).split('\n'));
        X = null; Y = null;
      }
      curColour = ly.color;
      Zc = ly.z;
      out.push(`;LAYER:${L}`, `;Z:${fmt(Zc)}`, `G1 Z${fmt(Zc)} F600`);
      if (L === 1) out.push(`M106 S${Math.round(F.fan / 100 * 255)}`);
      let e0 = totalE;
      if (L === 0) {
        // skirt: two loops 4 mm outside the first layer
        const f0 = sdfMM(masks[0], G);
        for (const k of [0, 1]) for (const loop of insetLoops(f0, G, -(4 + k * lw0))) {
          const q = loop.map(p => toBed(p[0], p[1]));
          travel(q[0][0], q[0][1]);
          for (let i = 1; i <= q.length; i++) extrudeTo(q[i % q.length][0], q[i % q.length][1], lw0, sp);
        }
      }
      // walls, inner to outer; the outer wall a little slower
      for (let k = ly.walls.length - 1; k >= 0; k--) {
        const vs = k === 0 ? sp * 0.8 : sp;
        for (const loop of ly.walls[k]) {
          const q = loop.map(p => toBed(p[0], p[1]));
          // start each loop at the point nearest to where the nozzle is
          let s0 = 0, bd = Infinity;
          if (X != null) q.forEach((p, i) => { const d = (p[0] - X) ** 2 + (p[1] - Y) ** 2; if (d < bd) { bd = d; s0 = i; } });
          travel(q[s0][0], q[s0][1]);
          for (let i = 1; i <= q.length; i++) { const p = q[(s0 + i) % q.length]; extrudeTo(p[0], p[1], ly.w, vs); }
        }
      }
      // infill: nearest-next ordering, flipping lines as needed
      for (const [set, vsp] of [[ly.solid, sp * 0.9], [ly.sparse, sp]]) {
        const left = set.map(s => [toBed(s[0][0], s[0][1]), toBed(s[1][0], s[1][1])]);
        while (left.length) {
          let bi = 0, bf = false, bd = Infinity;
          for (let i = 0; i < left.length; i++) {
            const a = left[i][0], b = left[i][1];
            const da = X == null ? 0 : (a[0] - X) ** 2 + (a[1] - Y) ** 2, db = X == null ? 0 : (b[0] - X) ** 2 + (b[1] - Y) ** 2;
            if (da < bd) { bd = da; bi = i; bf = false; }
            if (db < bd) { bd = db; bi = i; bf = true; }
          }
          let [a, b] = left.splice(bi, 1)[0]; if (bf) [a, b] = [b, a];
          // short hops between neighbouring lines are printed as connections instead of travels
          if (X != null && Math.hypot(a[0] - X, a[1] - Y) < ly.w * 1.6 && maskAt(masks[L], G, ...fromBed(a))) extrudeTo(a[0], a[1], ly.w, vsp);
          else travel(a[0], a[1]);
          extrudeTo(b[0], b[1], ly.w, vsp);
        }
      }
      perColour[ly.color] = (perColour[ly.color] || 0) + (totalE - e0);
      if (onProgress && L % 3 === 0) { onProgress(0.9 + 0.1 * L / layers.length); await new Promise(res => setTimeout(res)); }
    }
    function fromBed(p) {
      let dx = p[0] - bed[0] / 2, dy = p[1] - bed[1] / 2;
      if (rot) [dx, dy] = [dy, -dx];
      return [pcx + dx, pcy - dy];
    }
    out.push(`G1 E-${retract} F${F.rspeed * 60}`, opts.endGcode || END(Math.min(bed[1] - 10, 200)));
    const minutes = Math.round(t / 60 * 1.15 + swaps.length * 2 + 6);
    out.splice(5, 0, `; Estimated time ${minutes} min, filament ${(totalE / 1000).toFixed(2)} m`, ...swaps.map(s => `; Colour change at layer ${s.layer} (${s.z} mm): load ${names(s.color)}`), ';');
    const grams = Object.fromEntries(Object.entries(perColour).map(([c, e]) => [c, e * 2.4053 * 1.2 / 1000]));   // TPU ~1.2 g/cm³
    return { gcode: out.join('\n') + '\n', layers, bands, swaps, minutes, metres: totalE / 1000, grams, rot, nL, firstColour: layers[0] && layers[0].color };
  }

  const api = { PRINTERS, FILAMENTS, slice, plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PadSlicer = api;
})(typeof window !== 'undefined' ? window : globalThis);
