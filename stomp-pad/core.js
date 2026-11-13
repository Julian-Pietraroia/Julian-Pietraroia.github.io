/* Stomp Pad Studio — geometry core.
 * Image -> color clusters -> masks -> signed distance fields -> contours ->
 * triangulated, extruded solids -> binary STL. No dependencies.
 * Works in the browser (window.PadCore) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- color
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // k-means on the opaque pixels of an RGBA buffer. Returns centers sorted by
  // pixel count (largest first), with counts and how often each touches the border.
  function quantize(data, w, h, k) {
    const rand = rng(1234);
    const idx = [];
    for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] >= 128) idx.push(i);
    if (!idx.length) return { centers: [], counts: [], border: [], transparent: true };
    const n = Math.min(idx.length, 12000);
    const S = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) {
      const p = idx[Math.floor(rand() * idx.length)] * 4;
      S[j * 3] = data[p]; S[j * 3 + 1] = data[p + 1]; S[j * 3 + 2] = data[p + 2];
    }
    k = Math.max(1, Math.min(k, n));
    const d2 = (j, c) => { const dr = S[j * 3] - c[0], dg = S[j * 3 + 1] - c[1], db = S[j * 3 + 2] - c[2]; return dr * dr + dg * dg + db * db; };
    const at = j => [S[j * 3], S[j * 3 + 1], S[j * 3 + 2]];
    function seed(mode) {
      const C = [at(Math.floor(rand() * n))];
      const D = new Float32Array(n).fill(Infinity);
      while (C.length < k) {
        const c = C[C.length - 1];
        let sum = 0, far = 0;
        for (let j = 0; j < n; j++) { const d = d2(j, c); if (d < D[j]) D[j] = d; sum += D[j]; if (D[j] > D[far]) far = j; }
        if (sum === 0) break;
        if (mode === 'far') { C.push(at(far)); continue; }
        let r = rand() * sum, pick = 0;
        for (let j = 0; j < n; j++) { r -= D[j]; if (r <= 0) { pick = j; break; } }
        C.push(at(pick));
      }
      return C;
    }
    function lloyd(C) {
      let sse = 0;
      for (let it = 0; it < 16; it++) {
        const acc = C.map(() => [0, 0, 0, 0]);
        sse = 0;
        for (let j = 0; j < n; j++) {
          let best = 0, bd = Infinity;
          for (let c = 0; c < C.length; c++) { const d = d2(j, C[c]); if (d < bd) { bd = d; best = c; } }
          sse += bd;
          const a = acc[best]; a[0] += S[j * 3]; a[1] += S[j * 3 + 1]; a[2] += S[j * 3 + 2]; a[3]++;
        }
        for (let c = 0; c < C.length; c++) if (acc[c][3]) C[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
      }
      return { C, sse };
    }
    let bestRun = null;
    for (const mode of ['far', 'pp', 'pp', 'pp', 'pp']) {
      const r = lloyd(seed(mode));
      if (!bestRun || r.sse < bestRun.sse) bestRun = r;
    }
    const C = bestRun.C;
    // full-image stats
    const labels = assignLabels(data, w, h, C);
    const counts = new Array(C.length).fill(0), border = new Array(C.length).fill(0);
    let transparent = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      const onB = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (l < 0) { if (onB) transparent = true; continue; }
      counts[l]++;
      if (onB) border[l]++;
    }
    const order = C.map((_, i) => i).filter(i => counts[i] > 0).sort((a, b) => counts[b] - counts[a]);
    return {
      centers: order.map(i => C[i].map(Math.round)),
      counts: order.map(i => counts[i]),
      border: order.map(i => border[i]),
      transparent
    };
  }

  function assignLabels(data, w, h, centers) {
    const out = new Int16Array(w * h);
    const k = centers.length;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      if (data[p + 3] < 128 || !k) { out[i] = -1; continue; }
      const r = data[p], g = data[p + 1], b = data[p + 2];
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const cc = centers[c];
        const dr = r - cc[0], dg = g - cc[1], db = b - cc[2];
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bd) { bd = d; best = c; }
      }
      out[i] = best;
    }
    return out;
  }

  // ------------------------------------------------- distance transforms
  const BIG = 1e20;
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -BIG; z[1] = BIG;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = BIG;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }
  // squared distance from every pixel to the nearest pixel where mask === target
  function edt(mask, w, h, target) {
    const out = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = mask[i] === target ? 0 : BIG;
    const m = Math.max(w, h);
    const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = out[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) out[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = out[y * w + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = d[x];
    }
    return out;
  }
  function dilate(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const d = edt(mask, w, h, 1), out = new Uint8Array(w * h), r2 = r * r;
    for (let i = 0; i < w * h; i++) out[i] = d[i] <= r2 ? 1 : 0;
    return out;
  }
  function erode(mask, w, h, r) {
    if (r <= 0) return mask.slice();
    const d = edt(mask, w, h, 0), out = new Uint8Array(w * h), r2 = r * r;
    for (let i = 0; i < w * h; i++) out[i] = mask[i] && d[i] > r2 ? 1 : 0;
    return out;
  }
  const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);
  const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

  function fillHoles(mask, w, h) {
    const seen = new Uint8Array(w * h), stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      if (seen[i] || mask[i]) continue;
      seen[i] = 1;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y < h - 1) stack.push(i + w);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = mask[i] || !seen[i] ? 1 : 0;
    return out;
  }

  // drop 4-connected pieces smaller than minArea pixels; returns piece count kept
  function removeSmall(mask, w, h, minArea) {
    const lab = new Int32Array(w * h).fill(-1);
    let kept = 0;
    const q = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s] !== -1) continue;
      let head = 0, tail = 0;
      q[tail++] = s; lab[s] = s;
      while (head < tail) {
        const i = q[head++], x = i % w;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
        for (const j of nb) if (j >= 0 && mask[j] && lab[j] === -1) { lab[j] = s; q[tail++] = j; }
      }
      if (tail < minArea) for (let t = 0; t < tail; t++) mask[q[t]] = 0;
      else kept++;
    }
    return kept;
  }

  // signed distance (px), positive inside, zero on the pixel boundary, lightly blurred
  function sdf(mask, w, h, blur) {
    const din = edt(mask, w, h, 0), dout = edt(mask, w, h, 1);
    let f = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) f[i] = mask[i] ? Math.sqrt(din[i]) - 0.5 : -(Math.sqrt(dout[i]) - 0.5);
    for (let p = 0; p < blur; p++) f = boxBlur(f, w, h);
    return f;
  }
  function boxBlur(f, w, h) {
    const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      t[i] = (f[i - (x > 0 ? 1 : 0)] + f[i] + f[i + (x < w - 1 ? 1 : 0)]) / 3;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      o[i] = (t[i - (y > 0 ? w : 0)] + t[i] + t[i + (y < h - 1 ? w : 0)]) / 3;
    }
    return o;
  }

  // ------------------------------------------------------ marching squares
  // Returns closed loops (arrays of [x,y] in pixel coords) where field > level is inside.
  function contours(field, w, h, level) {
    // shapes touching the grid edge must still close: force the border to "outside"
    field = Float32Array.from(field);
    for (let x = 0; x < w; x++) { field[x] = Math.min(field[x], level - 1); field[(h - 1) * w + x] = Math.min(field[(h - 1) * w + x], level - 1); }
    for (let y = 0; y < h; y++) { field[y * w] = Math.min(field[y * w], level - 1); field[y * w + w - 1] = Math.min(field[y * w + w - 1], level - 1); }
    const N = w * h * 2;
    const nb1 = new Int32Array(N).fill(-1), nb2 = new Int32Array(N).fill(-1);
    const px = new Float64Array(N), py = new Float64Array(N);
    const used = new Uint8Array(N);
    const H = (i, j) => (j * w + i) * 2, V = (i, j) => (j * w + i) * 2 + 1;
    function pt(id) {
      if (used[id]) return;
      used[id] = 1;
      const c = id >> 1, i = c % w, j = (c / w) | 0;
      const f0 = field[c];
      if (id & 1) { const f1 = field[c + w]; const t = (level - f0) / (f1 - f0); px[id] = i; py[id] = j + t; }
      else { const f1 = field[c + 1]; const t = (level - f0) / (f1 - f0); px[id] = i + t; py[id] = j; }
    }
    function link(a, b) {
      pt(a); pt(b);
      if (nb1[a] < 0) nb1[a] = b; else nb2[a] = b;
      if (nb1[b] < 0) nb1[b] = a; else nb2[b] = a;
    }
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const fa = field[j * w + i], fb = field[j * w + i + 1], fc = field[(j + 1) * w + i + 1], fd = field[(j + 1) * w + i];
      const cs = (fa > level ? 8 : 0) | (fb > level ? 4 : 0) | (fc > level ? 2 : 0) | (fd > level ? 1 : 0);
      if (cs === 0 || cs === 15) continue;
      const T = H(i, j), B = H(i, j + 1), L = V(i, j), R = V(i + 1, j);
      switch (cs) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(T, L); break;
        case 5: case 10: {
          const center = (fa + fb + fc + fd) / 4 > level;
          // 5: b,d inside. 10: a,c inside.
          if ((cs === 5) === center) { link(T, L); link(B, R); }
          else { link(T, R); link(L, B); }
          break;
        }
      }
    }
    const loops = [], seen = new Uint8Array(N);
    for (let s = 0; s < N; s++) {
      if (!used[s] || seen[s] || nb1[s] < 0) continue;
      const loop = [];
      let prev = -1, cur = s, guard = 0;
      while (guard++ < N) {
        seen[cur] = 1;
        loop.push([px[cur], py[cur]]);
        const nx = nb1[cur] !== prev ? nb1[cur] : nb2[cur];
        if (nx < 0) break;
        prev = cur; cur = nx;
        if (cur === s) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  // Douglas-Peucker on a closed loop
  function simplifyClosed(loop, tol) {
    const n = loop.length;
    if (n < 8) return loop;
    // split at the two points farthest apart (approx)
    let a = 0, b = 0, best = -1;
    for (let i = 0; i < n; i++) {
      const dx = loop[i][0] - loop[0][0], dy = loop[i][1] - loop[0][1], d = dx * dx + dy * dy;
      if (d > best) { best = d; b = i; }
    }
    const keep = new Uint8Array(n);
    keep[a] = keep[b] = 1;
    const tol2 = tol * tol;
    const stack = [[a, b], [b, a + n]];
    while (stack.length) {
      const [s, e] = stack.pop();
      if (e - s < 2) continue;
      const A = loop[s % n], Bp = loop[e % n];
      const dx = Bp[0] - A[0], dy = Bp[1] - A[1], L2 = dx * dx + dy * dy || 1e-12;
      let md = -1, mi = -1;
      for (let i = s + 1; i < e; i++) {
        const P = loop[i % n];
        const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2));
        const ex = A[0] + t * dx - P[0], ey = A[1] + t * dy - P[1];
        const d = ex * ex + ey * ey;
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol2) { keep[mi % n] = 1; stack.push([s, mi], [mi, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(loop[i]);
    return out.length >= 3 ? out : loop;
  }

  function signedArea(loop) {
    let a = 0;
    for (let i = 0, n = loop.length; i < n; i++) {
      const p = loop[i], q = loop[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  function pointInLoop(pt, loop) {
    let inside = false;
    const x = pt[0], y = pt[1];
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const xi = loop[i][0], yi = loop[i][1], xj = loop[j][0], yj = loop[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function bbox(loop) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of loop) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return [x0, y0, x1, y1];
  }

  // remove duplicate, collinear and spike vertices so caps and walls always agree
  function cleanRing(ring) {
    let pts = ring.slice(), changed = true;
    while (changed && pts.length >= 3) {
      changed = false;
      const out = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = out.length ? out[out.length - 1] : pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
        const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1];
        const la = Math.hypot(abx, aby), lb = Math.hypot(bcx, bcy);
        if (la < 1e-6 || lb < 1e-6 || Math.abs(abx * bcy - aby * bcx) < 1e-4 * la * lb) { changed = true; continue; }
        out.push(b);
      }
      pts = out;
    }
    return pts;
  }

  // Group loops (y-up coords) into shapes: outer CCW with CW holes.
  function buildShapes(loops, minArea) {
    const L = loops.map(cleanRing).filter(l => l.length >= 3).map(l => ({ pts: l, area: Math.abs(signedArea(l)), bb: bbox(l), depth: 0, parent: -1 }))
      .filter(o => o.area >= minArea);
    for (let i = 0; i < L.length; i++) {
      let pa = -1, paArea = Infinity;
      const p = L[i].pts[0];
      for (let j = 0; j < L.length; j++) {
        if (i === j || L[j].area <= L[i].area) continue;
        const b = L[j].bb;
        if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
        if (pointInLoop(p, L[j].pts)) { L[i].depth++; if (L[j].area < paArea) { paArea = L[j].area; pa = j; } }
      }
      L[i].parent = pa;
    }
    const shapes = [], map = new Map();
    L.forEach((o, i) => {
      if (o.depth % 2 === 0) {
        const pts = signedArea(o.pts) > 0 ? o.pts : o.pts.slice().reverse();
        map.set(i, shapes.length);
        shapes.push({ outer: pts, holes: [] });
      }
    });
    L.forEach(o => {
      if (o.depth % 2 === 1 && map.has(o.parent)) {
        const pts = signedArea(o.pts) < 0 ? o.pts : o.pts.slice().reverse();
        shapes[map.get(o.parent)].holes.push(pts);
      }
    });
    return shapes;
  }

  // -------------------------------------------------------- triangulation
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  function segCross(p1, p2, p3, p4) {
    const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function clearOf(M, P, ring) {
    const dx = P[0] - M[0], dy = P[1] - M[1], L2 = dx * dx + dy * dy || 1e-12;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      if (!same(a, M) && !same(a, P)) {   // a vertex lying on the bridge would let it slip outside
        const t = ((a[0] - M[0]) * dx + (a[1] - M[1]) * dy) / L2;
        if (t > 1e-9 && t < 1 - 1e-9 && Math.abs((a[0] - M[0]) * dy - (a[1] - M[1]) * dx) / Math.sqrt(L2) < 1e-7) return false;
      }
      if (same(a, M) || same(b, M) || same(a, P) || same(b, P)) continue;
      if (segCross(M, P, a, b)) return false;
    }
    return true;
  }
  function mergeHoles(outer, holes) {
    let pts = outer.slice();
    const hs = holes.map(h => ({ h, mx: Math.max(...h.map(p => p[0])) })).sort((a, b) => b.mx - a.mx).map(o => o.h);
    for (let k = 0; k < hs.length; k++) {
      const hole = hs[k];
      let mi = 0;
      for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[mi][0]) mi = i;
      const M = hole[mi];
      const cand = pts.map((p, i) => [i, (p[0] - M[0]) ** 2 + (p[1] - M[1]) ** 2]).sort((a, b) => a[1] - b[1]);
      let pick = -1;
      // the bridge must leave P into the polygon's interior wedge at that exact vertex (matters when
      // P already has duplicates from earlier bridges: only one copy faces the right way)
      const inSector = i => {
        const n = pts.length, A = pts[(i + n - 1) % n], P = pts[i], C = pts[(i + 1) % n];
        return orient(A, P, C) >= 0 ? orient(A, P, M) >= 0 && orient(P, C, M) >= 0
                                     : orient(A, P, M) >= 0 || orient(P, C, M) >= 0;
      };
      for (let c = 0; c < cand.length && c < 400; c++) {
        const P = pts[cand[c][0]];
        if (!inSector(cand[c][0])) continue;
        if (!clearOf(M, P, pts)) continue;
        let ok = true;
        for (let j = k; j < hs.length && ok; j++) ok = clearOf(M, P, hs[j]);
        // the bridge's midpoint must be in solid material: inside the outline, outside every hole
        if (ok) {
          const mid = [(M[0] + P[0]) / 2, (M[1] + P[1]) / 2];
          ok = pointInLoop(mid, outer) && !holes.some(hh => pointInLoop(mid, hh));
        }
        if (ok) { pick = cand[c][0]; break; }
      }
      if (pick < 0) pick = cand[0][0];
      const rot = hole.slice(mi).concat(hole.slice(0, mi));
      pts = pts.slice(0, pick + 1).concat(rot, [M, pts[pick]], pts.slice(pick + 1));
    }
    return pts;
  }
  function inTri(p, a, b, c) {
    const e = 1e-12;
    return orient(a, b, p) > e && orient(b, c, p) > e && orient(c, a, p) > e;
  }
  // ear clipping; pts CCW. Returns flat [x,y, x,y, x,y, ...] triangles.
  function triangulate(outer, holes) {
    const pts = holes.length ? mergeHoles(outer, holes) : outer;
    const n = pts.length, out = [];
    if (n < 3) return out;
    const prev = new Int32Array(n), next = new Int32Array(n);
    for (let i = 0; i < n; i++) { prev[i] = (i + n - 1) % n; next[i] = (i + 1) % n; }
    // reflex candidates speed up the ear test
    let remaining = n, i = 0, stall = 0;
    const scale = Math.max(1e-9, ...bbox(outer).map(Math.abs));
    const eps = 1e-10 * scale * scale;
    const remove = j => { next[prev[j]] = next[j]; prev[next[j]] = prev[j]; remaining--; };
    while (remaining > 3) {
      const p = prev[i], nx = next[i];
      const A = pts[p], B = pts[i], C = pts[nx];
      const o = orient(A, B, C);
      // collinear: clip anyway (zero-area) so the cap stays edge-matched with the walls
      if (Math.abs(o) <= eps) { out.push(A[0], A[1], B[0], B[1], C[0], C[1]); remove(i); i = p; stall = 0; continue; }
      let ear = false;
      if (o > 0) {
        ear = true;
        const x0 = Math.min(A[0], B[0], C[0]), x1 = Math.max(A[0], B[0], C[0]);
        const y0 = Math.min(A[1], B[1], C[1]), y1 = Math.max(A[1], B[1], C[1]);
        for (let j = next[nx]; j !== p; j = next[j]) {
          const P = pts[j];
          if (P[0] < x0 || P[0] > x1 || P[1] < y0 || P[1] > y1) continue;
          if (same(P, A) || same(P, B) || same(P, C)) continue;
          if (inTri(P, A, B, C)) { ear = false; break; }
        }
      }
      if (!ear && o <= 0 && stall > remaining * 2) { i = nx; stall++; if (stall < remaining * 4) continue; }
      if (ear || stall > remaining * 2) {
        out.push(A[0], A[1], B[0], B[1], C[0], C[1]);
        remove(i); i = nx; stall = 0;
      } else { i = nx; stall++; }
    }
    const a = pts[prev[i]], b = pts[i], c = pts[next[i]];
    out.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    return out;
  }

  // ------------------------------------------------------------ extrusion
  function extrude(shapes, z0, z1, bottom) {
    const P = [];
    const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => P.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (const s of shapes) {
      const t = s.tri || triangulate(s.outer, s.holes);
      if (s.bad) continue;
      for (let k = 0; k < t.length; k += 6) {
        tri(t[k], t[k + 1], z1, t[k + 2], t[k + 3], z1, t[k + 4], t[k + 5], z1);
        if (bottom !== false) tri(t[k], t[k + 1], z0, t[k + 4], t[k + 5], z0, t[k + 2], t[k + 3], z0);
      }
      for (const ring of [s.outer, ...s.holes]) {
        for (let k = 0, n = ring.length; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n];
          tri(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1);
          tri(a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
        }
      }
    }
    return new Float32Array(P);
  }
  function normals(pos) {
    const N = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { N[i + k * 3] = nx; N[i + k * 3 + 1] = ny; N[i + k * 3 + 2] = nz; }
    }
    return N;
  }
  function volume(pos) {
    let v = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5], cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return v;
  }
  function concat(arrs) {
    const n = arrs.reduce((s, a) => s + a.length, 0), out = new Float32Array(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function toSTL(pos, name) {
    const nt = pos.length / 9, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
    const head = ('Stomp Pad Studio ' + (name || '')).slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
    dv.setUint32(80, nt, true);
    const N = normals(pos);
    let o = 84;
    for (let t = 0; t < nt; t++) {
      const i = t * 9;
      dv.setFloat32(o, N[i], true); dv.setFloat32(o + 4, N[i + 1], true); dv.setFloat32(o + 8, N[i + 2], true);
      o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, pos[i + k], true); o += 4; }
      o += 2;
    }
    return buf;
  }

  // ----------------------------------------------------------- 3MF (colour)
  // One object whose triangles carry their colour (3MF materials extension colorgroup).
  // Bambu Studio 2.5+, Orca, PrusaSlicer and Windows 3D Viewer read these colours on import.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {   // files: [{name, data: Uint8Array}] -> stored (uncompressed) zip
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + sz;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'model/3mf' });
  }
  // parts: [{pos: Float32Array, color: [r,g,b], name}]
  function to3MF(parts, title) {
    const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase() + 'FF';
    const vmap = new Map(), verts = [], tris = [];
    const vid = (x, y, z) => {
      const k = x.toFixed(4) + ',' + y.toFixed(4) + ',' + z.toFixed(4);
      let i = vmap.get(k);
      if (i === undefined) { i = verts.length; vmap.set(k, i); verts.push(k); }
      return i;
    };
    parts.forEach((p, ci) => {
      const P = p.pos;
      for (let i = 0; i < P.length; i += 9) {
        const a = vid(P[i], P[i + 1], P[i + 2]), b = vid(P[i + 3], P[i + 4], P[i + 5]), c = vid(P[i + 6], P[i + 7], P[i + 8]);
        if (a === b || b === c || a === c) continue;
        tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}" pid="2" p1="${ci}"/>`);
      }
    });
    const vx = verts.map(k => { const [x, y, z] = k.split(','); return `<vertex x="${x}" y="${y}" z="${z}"/>`; });
    const esc = s => String(s).replace(/[<&"]/g, ch => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[ch]));
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
<metadata name="Title">${esc(title || 'Stomp pad')}</metadata>
<metadata name="Application">Stomp Pad Studio</metadata>
<resources>
<m:colorgroup id="2">${parts.map(p => `<m:color color="${hex(p.color)}"/>`).join('')}</m:colorgroup>
<basematerials id="3">${parts.map(p => `<base name="${esc(p.name)}" displaycolor="${hex(p.color)}"/>`).join('')}</basematerials>
<object id="1" type="model" name="${esc(title || 'Stomp pad')}" pid="2" pindex="0">
<mesh><vertices>${vx.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>
</object>
</resources>
<build><item objectid="1"/></build>
</model>`;
    const enc = new TextEncoder();
    return zipStore([
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { name: '3D/3dmodel.model', data: enc.encode(model) }
    ]);
  }

  // ---------------------------------------------------------------- pad
  /* Build the pad from a label grid.
   * grid: {labels:Int16Array, w, h, mm: mm per pixel}
   * roles: array per color: 'raised' | 'flat' | 'cut'
   * p: {pad, smooth, fillHoles, base, raise, round, detail, edgeBlur}
   */
  function buildPad(grid, roles, p) {
    const { labels, w, h, mm } = grid;
    const px = v => v / mm;
    const fg = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const l = labels[i]; fg[i] = l >= 0 && roles[l] !== 'cut' ? 1 : 0; }
    removeSmall(fg, w, h, Math.max(2, px(0.6) ** 2));
    let base = dilate(fg, w, h, px(p.pad));
    if (p.smooth > 0) base = close(base, w, h, px(p.smooth));
    if (p.fillHoles) base = fillHoles(base, w, h);
    // pockets: open the pad up so the board shows through (holes go all the way through)
    const pk = p.pockets || {};
    const hasWin = roles.some(r => r === 'hole');
    if ((pk.type && pk.type !== 'none') || hasWin) {
      const rib = pk.rib || 4, P = pk.size || 14;
      const inner = erode(base, w, h, px(rib));
      let holes = new Uint8Array(w * h);
      const mod = (a, b) => ((a % b) + b) % b;
      if (pk.type === 'frame') holes = inner.slice();
      else if (pk.type === 'lattice') { const walls = patternMask(w, h, mm, { type: 'hex', pitch: P, line: rib / 0.55 }); for (let i = 0; i < w * h; i++) holes[i] = inner[i] && !walls[i] ? 1 : 0; }
      else if (pk.type === 'slots') {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; const X = (x - w / 2) * mm, Y = (y - h / 2) * mm; holes[i] = inner[i] && mod(X + Y, P) < P - rib ? 1 : 0; }
      } else if (pk.type === 'circles' || pk.type === 'studs') {
        const rowH = P * Math.sqrt(3) / 2, r = (P - rib) / 2;
        const dots = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const X = (x - w / 2) * mm, Y = (y - h / 2) * mm, rr = Math.round(Y / rowH);
          let d = Infinity;
          for (let k = rr - 1; k <= rr + 1; k++) { const off = (k & 1) ? P / 2 : 0, c = Math.round((X - off) / P); for (let j = c - 1; j <= c + 1; j++) d = Math.min(d, Math.hypot(X - (j * P + off), Y - k * rowH)); }
          dots[y * w + x] = d < r ? 1 : 0;
        }
        if (pk.type === 'circles') for (let i = 0; i < w * h; i++) holes[i] = inner[i] && dots[i] ? 1 : 0;
        else { const keep = erode(base, w, h, 0.5); for (let i = 0; i < w * h; i++) base[i] = keep[i] && dots[i] ? 1 : 0; }
      }
      // colours set to 'hole' become windows showing the art underneath
      if (hasWin) {
        let win = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) { const l = labels[i]; if (l >= 0 && roles[l] === 'hole' && inner[i]) win[i] = 1; }
        win = open(win, w, h, px(Math.max(1, rib / 3)));
        for (let i = 0; i < w * h; i++) if (win[i]) holes[i] = 1;
      }
      for (let i = 0; i < w * h; i++) if (holes[i]) base[i] = 0;
    }
    const pieces = removeSmall(base, w, h, px(pk.type === 'studs' ? 1.5 : 4) ** 2);

    const toMM = loop => loop.map(q => [(q[0] - w / 2) * mm, -(q[1] - h / 2) * mm]);
    const tol = Math.max(0.35, 0.06 / mm);
    // triangulate every shape and check the triangles cover exactly its area; if not, retry with
    // less simplification, and finally drop tiny slivers (they are noise, a fraction of a mm wide)
    const triArea = t => { let a = 0; for (let k = 0; k < t.length; k += 6) a += ((t[k + 2] - t[k]) * (t[k + 5] - t[k + 1]) - (t[k + 3] - t[k + 1]) * (t[k + 4] - t[k])) / 2; return a; };
    const check = sh => { let ok = true; for (const s of sh) { s.tri = triangulate(s.outer, s.holes); const A = signedArea(s.outer) + s.holes.reduce((a, hh) => a + signedArea(hh), 0); s.bad = Math.abs(A - triArea(s.tri)) > 1e-3 * Math.abs(A) + 1e-3; s.area = A; if (s.bad) ok = false; } return ok; };
    const shapesAt = (field, level, minAreaMM2) => {
      const raw = contours(field, w, h, level);
      let sh = buildShapes(raw.map(l => toMM(simplifyClosed(l, tol))), minAreaMM2);
      if (!check(sh)) {
        const sh2 = buildShapes(raw.map(l => toMM(simplifyClosed(l, 0.12))), minAreaMM2);
        if (check(sh2) || sh2.filter(s => s.bad).length < sh.filter(s => s.bad).length) sh = sh2;
      }
      for (const s of sh) if (s.bad && Math.abs(s.area) > 25) s.bad = false;   // keep big shapes even if imperfect
      return sh.filter(s => !s.bad);
    };

    const blur = p.edgeBlur == null ? 2 : p.edgeBlur;
    const baseField = sdf(base, w, h, blur);
    const layers = [];
    const T = p.base, R = p.raise;
    const ch = p.round ? Math.min(1.2, T * 0.45) : 0;
    const steps = p.round ? 4 : 0;
    const baseParts = [];
    const baseShapes = shapesAt(baseField, 0, 1);
    baseParts.push(extrude(baseShapes, 0, T - ch));
    for (let s = 1; s <= steps; s++) {
      const inset = ch * s / steps;
      const sh = shapesAt(baseField, px(inset), 1);
      baseParts.push(extrude(sh, T - ch + ch * (s - 1) / steps - 0.01, T - ch + inset));
    }
    layers.push({ kind: 'base', color: -1, pos: concat(baseParts) });

    // raised pieces must sit fully on the flat top
    const top = ch > 0 ? erode(base, w, h, px(ch + 0.2)) : base;
    const raisedMasks = [];
    roles.forEach((role, c) => {
      if (role !== 'raised') return;
      let m = new Uint8Array(w * h);
      let any = 0;
      for (let i = 0; i < w * h; i++) if (labels[i] === c && top[i]) { m[i] = 1; any++; }
      if (!any) return;
      if (p.detail > 0) m = open(m, w, h, px(p.detail / 2));
      removeSmall(m, w, h, Math.max(2, px(p.detail || 0.5) ** 2));
      let cnt = 0;
      for (let i = 0; i < w * h; i++) cnt += m[i];
      if (!cnt) return;
      raisedMasks.push({ c, m });
      const sh = shapesAt(sdf(m, w, h, Math.min(blur, 1)), 0, 0.3);
      if (!sh.length) return;
      const hc = p.heights && p.heights[c] != null ? p.heights[c] : R;   // per-colour height when stacked
      layers.push({ kind: 'raised', color: c, h: hc, pos: extrude(sh, T - 0.05, T + hc) });
    });

    // optional grip pattern across the top (kept off a flat rim)
    if (p.pattern && p.pattern.type === 'spikes') {
      // pointed studs on a hex grid, each a closed frustum so it slices cleanly
      const P = p.pattern.pitch || 7, rb = P * 0.33, rt = Math.min(0.4, rb * 0.15), seg = 12;
      const rim = erode(top, w, h, px((p.pattern.rim == null ? 1.5 : p.pattern.rim) + rb));
      const pos = [], m = new Uint8Array(w * h), rowH = P * Math.sqrt(3) / 2;
      const z0 = T - 0.05, z1 = T + R;
      const W2 = w * mm / 2, H2 = h * mm / 2;
      for (let rr = Math.floor(-H2 / rowH); rr <= H2 / rowH; rr++) {
        const off = (rr & 1) ? P / 2 : 0;
        for (let cc = Math.floor((-W2 - off) / P); cc <= (W2 - off) / P; cc++) {
          const X = cc * P + off, Y = rr * rowH;              // grid mm, y down
          const gx = Math.round(X / mm + w / 2), gy = Math.round(Y / mm + h / 2);
          if (gx < 0 || gy < 0 || gx >= w || gy >= h || !rim[gy * w + gx]) continue;
          const cx = X, cy = -Y;                              // model coords (y up)
          for (let k = 0; k < seg; k++) {
            const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
            const b0 = [cx + rb * Math.cos(a0), cy + rb * Math.sin(a0)], b1 = [cx + rb * Math.cos(a1), cy + rb * Math.sin(a1)];
            const t0 = [cx + rt * Math.cos(a0), cy + rt * Math.sin(a0)], t1 = [cx + rt * Math.cos(a1), cy + rt * Math.sin(a1)];
            pos.push(b0[0], b0[1], z0, b1[0], b1[1], z0, t1[0], t1[1], z1, b0[0], b0[1], z0, t1[0], t1[1], z1, t0[0], t0[1], z1); // side
            pos.push(cx, cy, z1, t0[0], t0[1], z1, t1[0], t1[1], z1);   // top cap
            pos.push(cx, cy, z0, b1[0], b1[1], z0, b0[0], b0[1], z0);   // base
          }
          const r2 = (rb / mm) ** 2;
          for (let dy = -Math.ceil(rb / mm); dy <= rb / mm; dy++) for (let dx = -Math.ceil(rb / mm); dx <= rb / mm; dx++)
            if (dx * dx + dy * dy <= r2 && gx + dx >= 0 && gx + dx < w && gy + dy >= 0 && gy + dy < h) m[(gy + dy) * w + gx + dx] = 1;
        }
      }
      if (pos.length) { raisedMasks.push({ c: -2, m }); layers.push({ kind: 'raised', color: -2, pos: new Float32Array(pos) }); }
    } else if (p.pattern && p.pattern.type) {
      const pat = patternMask(w, h, mm, p.pattern);
      const rim = erode(top, w, h, px(p.pattern.rim == null ? 1.5 : p.pattern.rim));
      let m = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) m[i] = pat[i] && rim[i] ? 1 : 0;
      removeSmall(m, w, h, Math.max(2, px(1.2) ** 2));
      const sh = shapesAt(sdf(m, w, h, 1), 0, 0.3);
      if (sh.length) { raisedMasks.push({ c: -2, m }); layers.push({ kind: 'raised', color: -2, pos: extrude(sh, T - 0.05, T + R) }); }
    }

    let tris = 0, vol = 0;
    for (const L of layers) { tris += L.pos.length / 9; vol += volume(L.pos); }
    // overlap correction for the raised parts sitting 0.05mm into the base
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const bp = layers[0].pos;
    for (let i = 0; i < bp.length; i += 3) {
      if (bp[i] < x0) x0 = bp[i]; if (bp[i] > x1) x1 = bp[i];
      if (bp[i + 1] < y0) y0 = bp[i + 1]; if (bp[i + 1] > y1) y1 = bp[i + 1];
    }
    return {
      layers, base, raisedMasks, pieces: baseShapes.length || pieces,
      stats: { width: x1 - x0, length: y1 - y0, height: T + (layers.length > 1 ? Math.max(...layers.slice(1).map(L => L.h != null ? L.h : R)) : 0), tris, volume: vol }
    };
  }

  // ------------------------------------------------------- board detection
  function toLab(data, n) {
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    for (let i = 0; i < n; i++) {
      const r = lin[data[i * 4]], g = lin[data[i * 4 + 1]], b = lin[data[i * 4 + 2]];
      const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
      L[i] = 116 * y - 16; A[i] = 500 * (x - y); B[i] = 200 * (y - z);
    }
    return [L, A, B];
  }
  function median3(ch, w, h) {
    const o = new Float32Array(w * h), v = new Float32Array(9);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx));
        v[k++] = ch[yy * w + xx];
      }
      v.sort(); o[y * w + x] = v[4];
    }
    return o;
  }
  function labelComponents(mask, w, h) {
    const lab = new Int32Array(w * h), sizes = [0], q = new Int32Array(w * h);
    let n = 0;
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue;
      n++; let head = 0, tail = 0; q[tail++] = s; lab[s] = n;
      while (head < tail) {
        const i = q[head++], x = i % w;
        if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = n; q[tail++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = n; q[tail++] = i + 1; }
        if (i >= w && mask[i - w] && !lab[i - w]) { lab[i - w] = n; q[tail++] = i - w; }
        if (i < w * (h - 1) && mask[i + w] && !lab[i + w]) { lab[i + w] = n; q[tail++] = i + w; }
      }
      sizes.push(tail);
    }
    return { lab, sizes, n };
  }
  function pca(mask, w, h) {
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < w * h; i++) if (mask[i]) { n++; sx += i % w; sy += (i / w) | 0; }
    const mx = sx / n, my = sy / n;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let i = 0; i < w * h; i++) if (mask[i]) { const dx = i % w - mx, dy = ((i / w) | 0) - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const u = [Math.cos(ang), Math.sin(ang)];
    return { mu: [mx, my], u, p: [-u[1], u[0]], n };
  }
  function solve3(M, v) { // Gaussian elimination, 3x3
    const a = M.map((r, i) => r.concat([v[i]]));
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      [a[c], a[piv]] = [a[piv], a[c]];
      if (Math.abs(a[c][c]) < 1e-12) return null;
      for (let r = 0; r < 3; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k]; }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  /* Find a snowboard in a photo. data: RGBA of a downscaled photo (long side ~400).
   * seed: optional [x,y] the user tapped. Returns null or
   * {nose, tail, edgeA, edgeB, waistPx, lengthPx, outline:[[x,y]...], score} in the same pixel space. */
  function detectBoard(data, w, h, seed) {
    const N = w * h;
    let [L, A, B] = toLab(data, N);
    L = median3(median3(L, w, h), w, h); A = median3(median3(A, w, h), w, h); B = median3(median3(B, w, h), w, h);
    const wc = 3;
    function analyze(sx, sy, thr) {
      const vals = [[], [], []];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = Math.min(w - 1, Math.max(0, sx + dx)), y = Math.min(h - 1, Math.max(0, sy + dy)), i = y * w + x;
        vals[0].push(L[i]); vals[1].push(A[i]); vals[2].push(B[i]);
      }
      const c = vals.map(v => v.sort((a, b) => a - b)[12]);
      let m = new Uint8Array(N);
      const t2 = thr * thr;
      for (let i = 0; i < N; i++) {
        const dl = L[i] - c[0], da = A[i] - c[1], db = B[i] - c[2];
        m[i] = dl * dl + wc * (da * da + db * db) < t2 ? 1 : 0;
      }
      m = open(m, w, h, 1);
      const { lab, sizes, n } = labelComponents(m, w, h);
      const sl = lab[sy * w + sx];
      if (!sl || sizes[sl] < 0.01 * N) return null;
      const m0 = new Uint8Array(N);
      for (let i = 0; i < N; i++) m0[i] = lab[i] === sl ? 1 : 0;
      let ax = pca(m0, w, h);
      // half-width of the seed piece, then gather pieces lying in that corridor
      const bs = [];
      for (let i = 0; i < N; i++) if (m0[i]) bs.push(Math.abs((i % w - ax.mu[0]) * ax.p[0] + (((i / w) | 0) - ax.mu[1]) * ax.p[1]));
      bs.sort((a, b) => a - b);
      const half = bs[Math.floor(bs.length * 0.95)] * 1.15;
      const inC = new Float64Array(n + 1), tot = new Float64Array(n + 1);
      for (let i = 0; i < N; i++) {
        const k = lab[i]; if (!k) continue;
        tot[k]++;
        const b = Math.abs((i % w - ax.mu[0]) * ax.p[0] + (((i / w) | 0) - ax.mu[1]) * ax.p[1]);
        if (b < half) inC[k]++;
      }
      const U = new Uint8Array(N);
      for (let i = 0; i < N; i++) { const k = lab[i]; if (k && (k === sl || (sizes[k] >= 0.002 * N && inC[k] / tot[k] > 0.9))) U[i] = 1; }
      ax = pca(U, w, h);
      const { mu, u, p } = ax;
      const as = [], bsA = [], idx = [];
      for (let i = 0; i < N; i++) if (U[i]) {
        const dx = i % w - mu[0], dy = ((i / w) | 0) - mu[1];
        as.push(dx * u[0] + dy * u[1]); bsA.push(dx * p[0] + dy * p[1]);
      }
      const sorted = as.slice().sort((a, b) => a - b);
      const a0 = sorted[Math.floor(sorted.length * 0.002)], a1 = sorted[Math.floor(sorted.length * 0.998)];
      const Lp = a1 - a0;
      if (Lp < 20) return null;
      const S = 50, lo = new Float64Array(S).fill(Infinity), hi = new Float64Array(S).fill(-Infinity), cnt = new Float64Array(S);
      for (let j = 0; j < as.length; j++) {
        const k = Math.floor((as[j] - a0) / Lp * S);
        if (k < 0 || k >= S) continue;
        cnt[k]++; if (bsA[j] < lo[k]) lo[k] = bsA[j]; if (bsA[j] > hi[k]) hi[k] = bsA[j];
      }
      const tt = [], ww = [], cc = [], all = [];
      for (let k = 0; k < S; k++) {
        if (cnt[k] < 4) continue;
        const wd = hi[k] - lo[k] + 1, cov = cnt[k] / ((Lp / S) * wd);
        const t = (k + 0.5) / S;
        all.push(wd);
        if (t > 0.18 && t < 0.82 && cov > 0.6) { tt.push(t - 0.5); ww.push(wd); cc.push((hi[k] + lo[k]) / 2); }
      }
      if (tt.length < 6) return null;
      let keep = tt.map(() => true), coef = null;
      for (let it = 0; it < 6; it++) {
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
        tt.forEach((t, j) => {
          if (!keep[j]) return;
          const r = [1, t, t * t];
          for (let a = 0; a < 3; a++) { v[a] += r[a] * ww[j]; for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; }
        });
        coef = solve3(M, v);
        if (!coef) return null;
        const mean = ww.reduce((a, b) => a + b, 0) / ww.length;
        keep = tt.map((t, j) => ww[j] >= coef[0] + coef[1] * t + coef[2] * t * t - 0.04 * mean);
      }
      const waist = coef[0];
      if (!(waist > 3) || coef[2] < -0.01 * waist) return null;
      const ratio = Lp / waist;
      let area = 0, border = 0;
      for (let i = 0; i < N; i++) area += U[i];
      for (let x = 0; x < w; x++) border += U[x] + U[(h - 1) * w + x];
      for (let y = 0; y < h; y++) border += U[y * w] + U[y * w + w - 1];
      const medW = all.slice().sort((a, b) => a - b)[all.length >> 1];
      const fill = area / (Lp * medW);
      const score = Math.pow(area / N, 0.5) * fill * Math.exp(-(((ratio - 6.3) / 1.1) ** 2)) * (1 - Math.min(1, border / (2 * (w + h)) * 8));
      const cs = cc.slice().sort((a, b) => a - b), off = cs[cs.length >> 1];
      // boards are usually framed near the middle of the photo
      const cx = mu[0] + u[0] * (a0 + a1) / 2 + p[0] * off, cy = mu[1] + u[1] * (a0 + a1) / 2 + p[1] * off;
      const cen = Math.exp(-((Math.hypot(cx - w / 2, cy - h / 2) / (0.3 * Math.hypot(w, h))) ** 2));
      if (typeof process !== 'undefined' && process.env && process.env.DBG) console.log(JSON.stringify({ sx, sy, thr, ratio: +ratio.toFixed(2), fill: +fill.toFixed(2), area: +(area / N).toFixed(3), cen: +cen.toFixed(2), score: +score.toFixed(3) }));
      return { score: score * cen, U, mu, u, p, a0, a1, waist, off, coef, lo, hi, cnt, S };
    }
    let best = null;
    const tryOne = (x, y, thr) => { const r = analyze(x, y, thr); if (r && r.score > 0 && (!best || r.score > best.score)) best = r; };
    if (seed) {
      const sx = Math.round(seed[0]), sy = Math.round(seed[1]);
      for (const thr of [8, 12, 18, 24]) tryOne(sx, sy, thr);
    } else {
      const tried = [];
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 7; gx++) {
        const x = Math.round((0.2 + 0.1 * gx) * (w - 1)), y = Math.round((0.2 + 0.1 * gy) * (h - 1)), i = y * w + x;
        if (tried.some(t => Math.hypot(t[0] - L[i], t[1] - A[i], t[2] - B[i]) < 2.5)) continue;
        tried.push([L[i], A[i], B[i]]);
        for (const thr of [8, 12, 18]) tryOne(x, y, thr);
      }
    }
    if (!best) return null;
    const { mu, u, p, a0, a1, waist, off, coef, lo, hi, cnt } = best;
    const at = (a, b) => [mu[0] + u[0] * a + p[0] * b, mu[1] + u[1] * a + p[1] * b];
    const mid = (a0 + a1) / 2, Lp = a1 - a0, SS = best.S;
    // board-shaped outline: fitted sidecut through the middle, measured shape at the tips
    const left = [], right = [];
    for (let k = 0; k < SS; k++) {
      const t = (k + 0.5) / SS, a = a0 + t * Lp;
      let l, r;
      if (t > 0.15 && t < 0.85) { const tt = t - 0.5, wd = coef[0] + coef[1] * tt + coef[2] * tt * tt; l = off - wd / 2; r = off + wd / 2; }
      else if (cnt[k] >= 4) { l = lo[k] - 0.5; r = hi[k] + 0.5; }
      else continue;
      left.push(at(a, l)); right.push(at(a, r));
    }
    const outline = [at(a0, off)].concat(left, [at(a1, off)], right.reverse());
    return {
      nose: at(a0, off), tail: at(a1, off),
      edgeA: at(mid, off - waist / 2), edgeB: at(mid, off + waist / 2),
      waistPx: waist, lengthPx: Lp, outline, score: best.score
    };
  }

  // Grip patterns in mm: ridges, diamonds, dots, hex (honeycomb walls), chevrons.
  function patternMask(w, h, mm, pat) {
    const P = pat.pitch || 7, lw = pat.line || P * 0.4, out = new Uint8Array(w * h);
    const mod = (a, b) => ((a % b) + b) % b, r2 = Math.SQRT1_2, rowH = P * Math.sqrt(3) / 2;
    const ca = Math.cos(pat.angle || 0), sa = Math.sin(pat.angle || 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X0 = (x - w / 2) * mm, Y0 = (y - h / 2) * mm;
      const X = X0 * ca + Y0 * sa, Y = -X0 * sa + Y0 * ca;   // pattern rotated by pat.angle
      let on = false;
      switch (pat.type) {
        case 'ridges': on = mod((X + Y) * r2, P) < lw; break;
        case 'diamonds': on = mod((X + Y) * r2, P) > lw * 0.6 && mod((X - Y) * r2, P) > lw * 0.6; break;
        case 'chevrons': on = mod(Y + Math.abs(mod(X, P * 2) - P) * 0.9, P) < lw; break;
        case 'dots': case 'hex': {
          const r0 = Math.round(Y / rowH);
          let d1 = Infinity, d2 = Infinity;
          for (let rr = r0 - 1; rr <= r0 + 1; rr++) {
            const off = (rr & 1) ? P / 2 : 0, c0 = Math.round((X - off) / P);
            for (let cc = c0 - 1; cc <= c0 + 1; cc++) {
              const d = Math.hypot(X - (cc * P + off), Y - rr * rowH);
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
            }
          }
          on = pat.type === 'dots' ? d1 < P * 0.3 : (d2 - d1) < lw * 0.55;
          break;
        }
      }
      out[y * w + x] = on ? 1 : 0;
    }
    return out;
  }

  const api = {
    patternMask, to3MF, crc32,
    quantize, assignLabels, edt, dilate, erode, open, close, fillHoles, removeSmall, sdf,
    contours, simplifyClosed, detectBoard, median3, toLab, signedArea, buildShapes, triangulate, extrude, normals, volume,
    concat, toSTL, buildPad
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PadCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
