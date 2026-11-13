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
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
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
      for (let c = 0; c < cand.length && c < 400; c++) {
        const P = pts[cand[c][0]];
        if (!clearOf(M, P, pts)) continue;
        let ok = true;
        for (let j = k; j < hs.length && ok; j++) ok = clearOf(M, P, hs[j]);
        if (ok) { pick = cand[c][0]; break; }
      }
      if (pick < 0) pick = cand[0][0];
      const rot = hole.slice(mi).concat(hole.slice(0, mi));
      pts = pts.slice(0, pick + 1).concat(rot, [M, pts[pick]], pts.slice(pick + 1));
    }
    return pts;
  }
  function inTri(p, a, b, c) {
    return orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0;
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
      const t = triangulate(s.outer, s.holes);
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
    const pieces = removeSmall(base, w, h, px(4) ** 2);

    const toMM = loop => loop.map(q => [(q[0] - w / 2) * mm, -(q[1] - h / 2) * mm]);
    const tol = Math.max(0.35, 0.06 / mm);
    const shapesAt = (field, level, minAreaMM2) =>
      buildShapes(contours(field, w, h, level).map(l => toMM(simplifyClosed(l, tol))), minAreaMM2);

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
      layers.push({ kind: 'raised', color: c, pos: extrude(sh, T - 0.05, T + R) });
    });

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
      stats: { width: x1 - x0, length: y1 - y0, height: T + (layers.length > 1 ? R : 0), tris, volume: vol }
    };
  }

  const api = {
    quantize, assignLabels, edt, dilate, erode, open, close, fillHoles, removeSmall, sdf,
    contours, simplifyClosed, signedArea, buildShapes, triangulate, extrude, normals, volume,
    concat, toSTL, buildPad
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PadCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
