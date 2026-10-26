// How far a sitting chimp goes into the furniture: every seat in the house, sat on by chimps of
// three bodies (an average one; the smallest, short in the leg and arm; the biggest, long in the leg
// and arm, burly and round), in a real browser against the running preview (npm run dev, with the fly-in flag).
//
// For each seat and body the chimp walks up and sits as a visitor would (seats.sit), then gets up.
// At the end of the sit and at several moments of sitting down and getting up, every vertex of the
// chimp's skin (skinned on the CPU, as the GPU draws it) is tested against the triangles of every
// mesh drawn near the seat: the nearest surface and its outward normal say whether the vertex is
// inside, and how deep. Reported per seat (worst seated, worst while sitting down or getting up,
// which part of the chimp, into what), per kind of seat, and in a JSON file. The head is checked
// for going right through a surface too (a thin shell's top: past it, it is outside it again), and
// how close the nearest surface comes to it. A worn cap, hoodie and backpack are checked the same
// way on the Game Room's couch and in the egg chairs, on every body (WEAR=0 skips it).
//
//   URL=http://localhost:5173 node tools/test-sit-clip.mjs
//     SEATS=sofa,stool or SEATS=301,302   only these kinds or seat numbers
//     BODIES=default,small,big            which bodies (default all three)
//     LIMIT=1.5                           the most a vertex may go in (cm); exits non-zero past it
//     OUT=.evani/tmp/sit-clip/clip.json   where the numbers go
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const URL = process.env.URL ?? "http://localhost:5173";
const LIMIT = Number(process.env.LIMIT ?? 1.5);
const OUT = process.env.OUT ?? ".evani/tmp/sit-clip/clip.json";
const ONLY = process.env.SEATS ? process.env.SEATS.split(",").map((s) => s.trim()) : null;
const BODIES = (process.env.BODIES ?? "default,small,big").split(",");
// (each set in full, so every run measures the same chimps: a new visitor's own chimp is made at random)
const SHAPES = {
  default: { height: 1.5, legs: 0.5, build: 0.5, belly: 0.4, arms: 0.5 },
  small: { height: 1.3, legs: 0, build: 0, belly: 0, arms: 0 },
  big: { height: 1.8, legs: 1, build: 1, belly: 1, arms: 1 },
};
await mkdir(dirname(OUT), { recursive: true });

// ------------------------------------------------------------------ in the page: the measuring
function clipLib() {
  const CELL = 0.12;
  const lib = {
    grid: null,
    cache: new Map(),
    /** Gather the triangles of every mesh drawn within `box` (world min/max), bar the chimp's own. */
    prepare(min, max, skipRoot) {
      const scene = window.__chimp.scene;
      const tris = [];
      const nrm = [];
      const names = [];
      const over = (a, b) => a.x <= max[0] && b.x >= min[0] && a.y <= max[1] && b.y >= min[1] && a.z <= max[2] && b.z >= min[2];
      const tf = (m, x, y, z, w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
      for (const mesh of scene.meshes) {
        if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility === 0) continue;
        // plants' leaves are soft: walkers go through them (engine/collision.ts), and so may a sitter's elbow
        if (/:leaves/.test(mesh.name)) continue;
        if (skipRoot && mesh.isDescendantOf(skipRoot)) continue;
        // the chimp's own (its blob shadow isn't under its root)
        if (/^My chimp/.test(mesh.name)) continue;
        const src = mesh.sourceMesh ?? mesh;
        const pos = src.getVerticesData?.("position");
        const idx = src.getIndices?.();
        if (!pos || !idx || !idx.length) continue;
        const norms = src.getVerticesData("normal");
        const mats = [];
        if (src === mesh && mesh.thinInstanceCount > 0) {
          const wm = mesh.computeWorldMatrix(true);
          for (const t of mesh.thinInstanceGetWorldMatrices()) mats.push(t.multiply(wm).m);
        } else {
          const bb = mesh.getBoundingInfo().boundingBox;
          if (!over(bb.minimumWorld, bb.maximumWorld)) continue;
          mats.push(mesh.computeWorldMatrix(true).m);
        }
        const label = mesh.metadata?.label ?? mesh.name;
        for (let mi = 0; mi < mats.length; mi++) {
          const m = mats[mi];
          // the house stands still: each mesh's world positions worked out once, for every seat
          const ck = `${mesh.uniqueId}:${mi}`;
          let cached = lib.cache.get(ck);
          if (!cached) {
          const n = pos.length / 3;
          const wp = new Float32Array(pos.length);
          const wn = new Float32Array(pos.length);
          for (let i = 0; i < n; i++) {
            const p = tf(m, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 1);
            wp[i * 3] = p[0];
            wp[i * 3 + 1] = p[1];
            wp[i * 3 + 2] = p[2];
            if (norms) {
              const q = tf(m, norms[i * 3], norms[i * 3 + 1], norms[i * 3 + 2], 0);
              const l = Math.hypot(q[0], q[1], q[2]) || 1;
              wn[i * 3] = q[0] / l;
              wn[i * 3 + 1] = q[1] / l;
              wn[i * 3 + 2] = q[2] / l;
            }
          }
          cached = { wp, wn };
          lib.cache.set(ck, cached);
          }
          const { wp, wn } = cached;
          for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t] * 3;
            const b = idx[t + 1] * 3;
            const c = idx[t + 2] * 3;
            const lo = [Math.min(wp[a], wp[b], wp[c]), Math.min(wp[a + 1], wp[b + 1], wp[c + 1]), Math.min(wp[a + 2], wp[b + 2], wp[c + 2])];
            const hi = [Math.max(wp[a], wp[b], wp[c]), Math.max(wp[a + 1], wp[b + 1], wp[c + 1]), Math.max(wp[a + 2], wp[b + 2], wp[c + 2])];
            if (lo[0] > max[0] || hi[0] < min[0] || lo[1] > max[1] || hi[1] < min[1] || lo[2] > max[2] || hi[2] < min[2]) continue;
            tris.push(wp[a], wp[a + 1], wp[a + 2], wp[b], wp[b + 1], wp[b + 2], wp[c], wp[c + 1], wp[c + 2]);
            if (norms) nrm.push(wn[a], wn[a + 1], wn[a + 2], wn[b], wn[b + 1], wn[b + 2], wn[c], wn[c + 1], wn[c + 2]);
            else {
              // no normals: the face's own, from its winding (Babylon's front faces wind clockwise)
              const ux = wp[b] - wp[a], uy = wp[b + 1] - wp[a + 1], uz = wp[b + 2] - wp[a + 2];
              const vx = wp[c] - wp[a], vy = wp[c + 1] - wp[a + 1], vz = wp[c + 2] - wp[a + 2];
              let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
              const l = Math.hypot(nx, ny, nz) || 1;
              nx /= -l; ny /= -l; nz /= -l;
              nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
            }
            names.push(label);
          }
        }
      }
      // a grid of cells, each listing the triangles whose box overlaps it
      const cells = new Map();
      const key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
      const T = tris.length / 9;
      for (let t = 0; t < T; t++) {
        const o = t * 9;
        const lo = [0, 1, 2].map((d) => Math.floor((Math.max(min[d], Math.min(tris[o + d], tris[o + 3 + d], tris[o + 6 + d])) - min[d]) / CELL));
        const hi = [0, 1, 2].map((d) => Math.floor((Math.min(max[d], Math.max(tris[o + d], tris[o + 3 + d], tris[o + 6 + d])) - min[d]) / CELL));
        for (let i = lo[0]; i <= hi[0]; i++)
          for (let j = lo[1]; j <= hi[1]; j++)
            for (let k = lo[2]; k <= hi[2]; k++) {
              const h = key(i, j, k);
              let l = cells.get(h);
              if (!l) cells.set(h, (l = []));
              l.push(t);
            }
      }
      lib.grid = { min, max, tris, nrm, names, cells, key };
      return T;
    },
    /**
     * The closest point on triangle t to p, and its barycentric weights (Ericson, Real-Time Collision
     * Detection 5.1.5).
     */
    closest(t, px, py, pz, out) {
      const g = lib.grid.tris;
      const o = t * 9;
      const ax = g[o], ay = g[o + 1], az = g[o + 2];
      const abx = g[o + 3] - ax, aby = g[o + 4] - ay, abz = g[o + 5] - az;
      const acx = g[o + 6] - ax, acy = g[o + 7] - ay, acz = g[o + 8] - az;
      const apx = px - ax, apy = py - ay, apz = pz - az;
      const d1 = abx * apx + aby * apy + abz * apz;
      const d2 = acx * apx + acy * apy + acz * apz;
      let u, v, w;
      if (d1 <= 0 && d2 <= 0) [u, v, w] = [1, 0, 0];
      else {
        const bpx = px - g[o + 3], bpy = py - g[o + 4], bpz = pz - g[o + 5];
        const d3 = abx * bpx + aby * bpy + abz * bpz;
        const d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - g[o + 6], cpy = py - g[o + 7], cpz = pz - g[o + 8];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2;
        const vb = d5 * d2 - d1 * d6;
        const va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) [u, v, w] = [0, 1, 0];
        else if (d6 >= 0 && d5 <= d6) [u, v, w] = [0, 0, 1];
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          const s = d1 / (d1 - d3);
          [u, v, w] = [1 - s, s, 0];
        } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
          const s = d2 / (d2 - d6);
          [u, v, w] = [1 - s, 0, s];
        } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
          const s = (d4 - d3) / (d4 - d3 + (d5 - d6));
          [u, v, w] = [0, 1 - s, s];
        } else {
          const den = 1 / (va + vb + vc);
          v = vb * den;
          w = vc * den;
          u = 1 - v - w;
        }
      }
      out[0] = ax + abx * v + acx * w;
      out[1] = ay + aby * v + acy * w;
      out[2] = az + abz * v + acz * w;
      out[3] = u;
      out[4] = v;
      out[5] = w;
    },
    /** How deep p is inside the gathered surfaces (m; 0 outside), and into which. */
    depth(px, py, pz) {
      const G = lib.grid;
      const { min, cells, key, nrm } = G;
      if (px < G.min[0] || px > G.max[0] || py < G.min[1] || py > G.max[1] || pz < G.min[2] || pz > G.max[2]) return null;
      const ci = Math.floor((px - min[0]) / CELL), cj = Math.floor((py - min[1]) / CELL), ck = Math.floor((pz - min[2]) / CELL);
      const c = new Float64Array(6);
      let best = Infinity;
      const near = [];
      const seen = new Set();
      for (let i = ci - 1; i <= ci + 1; i++)
        for (let j = cj - 1; j <= cj + 1; j++)
          for (let k = ck - 1; k <= ck + 1; k++) {
            const l = cells.get(key(i, j, k));
            if (!l) continue;
            for (const t of l) {
              if (seen.has(t)) continue;
              seen.add(t);
              lib.closest(t, px, py, pz, c);
              const dx = px - c[0], dy = py - c[1], dz = pz - c[2];
              const d = Math.hypot(dx, dy, dz);
              // (a degenerate triangle has no closest point)
              if (!(d >= 0) || d > best + 2e-4) continue;
              const o = t * 9;
              const nx = nrm[o] * c[3] + nrm[o + 3] * c[4] + nrm[o + 6] * c[5];
              const ny = nrm[o + 1] * c[3] + nrm[o + 4] * c[4] + nrm[o + 7] * c[5];
              const nz = nrm[o + 2] * c[3] + nrm[o + 5] * c[4] + nrm[o + 8] * c[5];
              const outside = dx * nx + dy * ny + dz * nz >= -1e-5;
              if (d < best - 2e-4) near.length = 0;
              best = Math.min(best, d);
              near.push({ d, outside, t });
            }
          }
      if (!near.length || best > CELL) return null;
      const close = near.filter((n) => n.d <= best + 2e-4);
      if (close.some((n) => n.outside)) return null;
      // behind the nearest surface; inside a solid only if, going on deeper, the way out is through
      // the back of a surface (the far side of a cushion, a shell's outer skin, a slab's underside).
      // Just outside the open rim of a thin shell (an egg chair's), the nearest surface is its inner
      // skin seen from behind, but nothing closes the way on.
      lib.closest(close[0].t, px, py, pz, c);
      let rx = c[0] - px, ry = c[1] - py, rz = c[2] - pz;
      const rl = Math.hypot(rx, ry, rz);
      if (rl < 1e-6) return { depth: best, into: G.names[close[0].t] };
      rx /= -rl;
      ry /= -rl;
      rz /= -rl;
      if (!lib.exits(px, py, pz, rx, ry, rz, 0.6)) return null;
      return { depth: best, into: G.names[close[0].t] };
    },
    /** Whether a ray from p along (dx, dy, dz) first meets a surface from behind it (leaving a solid), within `max`. */
    exits(px, py, pz, dx, dy, dz, max) {
      return lib.hit(px, py, pz, dx, dy, dz, max)?.out ?? false;
    },
    /** The first surface a ray from p along (dx, dy, dz) meets within `max`: how far, which triangle, and whether from behind it; null when none. */
    hit(px, py, pz, dx, dy, dz, max) {
      const G = lib.grid;
      const { min, cells, key, tris, nrm } = G;
      const seen = new Set();
      let best = max;
      let out = false;
      let tri = -1;
      for (let s = 0; s <= max; s += CELL * 0.25) {
        const l = cells.get(key(Math.floor((px + dx * s - min[0]) / CELL), Math.floor((py + dy * s - min[1]) / CELL), Math.floor((pz + dz * s - min[2]) / CELL)));
        if (!l) continue;
        for (const t of l) {
          if (seen.has(t)) continue;
          seen.add(t);
          const o = t * 9;
          // Möller–Trumbore
          const e1x = tris[o + 3] - tris[o], e1y = tris[o + 4] - tris[o + 1], e1z = tris[o + 5] - tris[o + 2];
          const e2x = tris[o + 6] - tris[o], e2y = tris[o + 7] - tris[o + 1], e2z = tris[o + 8] - tris[o + 2];
          const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x;
          const det = e1x * qx + e1y * qy + e1z * qz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const tx = px - tris[o], ty = py - tris[o + 1], tz = pz - tris[o + 2];
          const u = (tx * qx + ty * qy + tz * qz) * inv;
          if (u < 0 || u > 1) continue;
          const rx = ty * e1z - tz * e1y, ry = tz * e1x - tx * e1z, rz = tx * e1y - ty * e1x;
          const v = (dx * rx + dy * ry + dz * rz) * inv;
          if (v < 0 || u + v > 1) continue;
          const d = (e2x * rx + e2y * ry + e2z * rz) * inv;
          if (d <= 1e-5 || d >= best) continue;
          best = d;
          tri = t;
          const w = 1 - u - v;
          const nx = nrm[o] * w + nrm[o + 3] * u + nrm[o + 6] * v;
          const ny = nrm[o + 1] * w + nrm[o + 4] * u + nrm[o + 7] * v;
          const nz = nrm[o + 2] * w + nrm[o + 5] * u + nrm[o + 8] * v;
          out = nx * dx + ny * dy + nz * dz > 0;
        }
        // a hit nearer than the cells still to come can't be beaten
        if (best < s - CELL) break;
      }
      return tri < 0 ? null : { d: best, t: tri, out };
    },
    /** How far p is from the nearest gathered surface (m), looked for up to a cell away; Infinity past that. */
    nearest(px, py, pz) {
      const G = lib.grid;
      const { min, cells, key } = G;
      const ci = Math.floor((px - min[0]) / CELL), cj = Math.floor((py - min[1]) / CELL), ck = Math.floor((pz - min[2]) / CELL);
      const c = new Float64Array(6);
      const seen = new Set();
      let best = Infinity;
      for (let i = ci - 1; i <= ci + 1; i++)
        for (let j = cj - 1; j <= cj + 1; j++)
          for (let k = ck - 1; k <= ck + 1; k++) {
            const l = cells.get(key(i, j, k));
            if (!l) continue;
            for (const t of l) {
              if (seen.has(t)) continue;
              seen.add(t);
              lib.closest(t, px, py, pz, c);
              const d = Math.hypot(px - c[0], py - c[1], pz - c[2]);
              if (d < best) best = d;
            }
          }
      return best <= CELL ? best : Infinity;
    },
    /**
     * The head: whether any of it (or a hat) is through a surface, and how near the nearest is.
     * A head gone right through a thin shell (an egg chair's top) is outside it again, so the depth
     * test doesn't see it: here the spine is followed from the hips up to the head, and the head
     * from its joint out to each point of its skin and of what it wears on it; a surface met on
     * the way is one it is through, by what is past it. Returns the worst (cm), and the head's
     * clearance: how near the nearest surface is to any point of it, up to 12 cm.
     */
    head() {
      const c = window.__chimp.chimps.body();
      const N = c.nodes;
      const res = { through: 0, part: null, into: null, clear: Infinity };
      const seg = (a, bx, by, bz, part) => {
        const dx = bx - a.x, dy = by - a.y, dz = bz - a.z;
        const L = Math.hypot(dx, dy, dz);
        if (L < 1e-4) return;
        const h = lib.hit(a.x, a.y, a.z, dx / L, dy / L, dz / L, L);
        if (h && L - h.d > res.through) {
          res.through = L - h.d;
          res.part = part;
          res.into = lib.grid.names[h.t];
          res.at = [bx, by, bz].map((v) => +v.toFixed(3));
        }
      };
      const chain = ["hips", "spine", "chest", "upperChest", "neck", "head"].filter((n) => N[n]);
      for (let i = 1; i < chain.length; i++) {
        const b = N[chain[i]].getAbsolutePosition();
        seg(N[chain[i - 1]].getAbsolutePosition(), b.x, b.y, b.z, chain[i]);
      }
      const head = N.head;
      const from = head.getAbsolutePosition().clone();
      const bones = c.skeleton.bones;
      // the skin's bones from the head up (its jaw, ears, eyes)
      const onHead = new Set(bones.filter((b) => { for (let p = b; p; p = p.getParent()) if (p.name === "head") return true; return false; }).map((b) => bones.indexOf(b)));
      const furs = new Set(c.furMeshes);
      for (const m of c.root.getChildMeshes(false)) {
        if (furs.has(m) || !m.isVisible) continue;
        const skinned = !!m.skeleton;
        if (!skinned && !m.isDescendantOf(head)) continue;
        const pos = m.getPositionData(true, false);
        if (!pos) continue;
        const wm = m.computeWorldMatrix(true).m;
        const mi = skinned ? m.getVerticesData("matricesIndices") : null;
        const mw = skinned ? m.getVerticesData("matricesWeights") : null;
        const worn = !c.meshes.includes(m);
        for (let i = 0; i < pos.length; i += 3) {
          if (skinned) {
            if (!mi || !mw) break;
            const v = (i / 3) * 4;
            let b = 0;
            for (let k = 1; k < 4; k++) if (mw[v + k] > mw[v + b]) b = k;
            if (!onHead.has(mi[v + b])) continue;
          }
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          const px = wm[0] * x + wm[4] * y + wm[8] * z + wm[12];
          const py = wm[1] * x + wm[5] * y + wm[9] * z + wm[13];
          const pz = wm[2] * x + wm[6] * y + wm[10] * z + wm[14];
          seg(from, px, py, pz, worn ? `${m.name.replace(/^.*? /, "")} (worn)` : "head");
          const d = lib.nearest(px, py, pz);
          if (d < res.clear) res.clear = d;
        }
      }
      return { through: +(res.through * 100).toFixed(2), part: res.part, into: res.into, at: res.at ?? null, clear: res.clear === Infinity ? 12 : +(res.clear * 100).toFixed(1) };
    },
    /**
     * The chimp now: how deep its skin (and, apart, what it wears) goes into the gathered surfaces.
     * Returns the worst vertex: depth (cm), the bone it hangs from, what it is in, and how many are in past `limit` cm.
     */
    measure(limit) {
      const c = window.__chimp.chimps.body();
      const bones = c.skeleton.bones;
      const furs = new Set(c.furMeshes);
      const eyes = new Set(c.eyes);
      const parts = [];
      for (const m of c.root.getChildMeshes(false)) {
        // (not isEnabled: from its own eyes the chimp isn't drawn, but it is posed all the same)
        if (furs.has(m) || !m.isVisible) continue;
        const skin = c.meshes.includes(m);
        if (skin && eyes.has(m)) continue;
        if (skin && !m.skeleton) continue;
        parts.push({ m, skin });
      }
      const res = { skin: { cm: 0, bone: null, into: null, over: 0 }, worn: { cm: 0, bone: null, into: null, over: 0 } };
      for (const { m, skin } of parts) {
        const pos = m.getPositionData(true, false);
        if (!pos) continue;
        const wm = m.computeWorldMatrix(true).m;
        const mi = m.skeleton ? m.getVerticesData("matricesIndices") : null;
        const mw = m.skeleton ? m.getVerticesData("matricesWeights") : null;
        const r = skin ? res.skin : res.worn;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          const px = wm[0] * x + wm[4] * y + wm[8] * z + wm[12];
          const py = wm[1] * x + wm[5] * y + wm[9] * z + wm[13];
          const pz = wm[2] * x + wm[6] * y + wm[10] * z + wm[14];
          const h = lib.depth(px, py, pz);
          if (!h) continue;
          const cm = h.depth * 100;
          if (cm > limit) r.over++;
          if (cm <= r.cm) continue;
          r.cm = cm;
          r.into = h.into;
          r.at = [px, py, pz].map((v) => +v.toFixed(3));
          if (mi && mw) {
            const v = (i / 3) * 4;
            let b = 0;
            for (let k = 1; k < 4; k++) if (mw[v + k] > mw[v + b]) b = k;
            r.bone = bones[mi[v + b]]?.name ?? null;
          } else r.bone = m.parent?.name ?? m.name;
        }
      }
      res.skin.cm = +res.skin.cm.toFixed(2);
      res.worn.cm = +res.worn.cm.toFixed(2);
      res.head = lib.head();
      return res;
    },
    /**
     * Sit on seat n and get up, measuring at moments of sitting down (sitting passing each of `at`),
     * seated, and getting up (passing them on the way down). Resolves with the worst of each.
     */
    run(n, limit, at) {
      const C = window.__chimp;
      const scene = C.scene;
      return new Promise((resolve) => {
        const out = { down: [], seated: null, up: [], sat: false, error: null };
        let phase = "down";
        let last = 0;
        let next = 0;
        let heldAt = 0;
        let t0 = performance.now();
        const done = (err) => {
          scene.onAfterRenderObservable.remove(obs);
          if (err) out.error = err;
          resolve(out);
        };
        const obs = scene.onAfterRenderObservable.add(() => {
          try {
            frame();
          } catch (e) {
            done(`measuring failed: ${e.message}`);
          }
        });
        const frame = () => {
          const m = C.chimps.describe().mine;
          const s = m.sitting;
          const now = performance.now();
          if (phase === "down") {
            while (next < at.length && s >= at[next]) {
              out.down.push({ at: at[next], s: +s.toFixed(2), ...lib.measure(limit) });
              next++;
            }
            if (s >= 0.999) {
              phase = "hold";
              heldAt = now;
            } else if (now - t0 > 8000) done(`never sat (sitting ${s.toFixed(2)})`);
          } else if (phase === "hold") {
            if (now - heldAt > 400) {
              out.sat = true;
              out.seated = { s: 1, hips: m.hips, root: m.at, ...lib.measure(limit) };
              out.place = { root: m.at, hips: m.hips };
              C.seats.stand();
              phase = "up";
              next = at.length - 1;
              t0 = now;
            }
          } else if (phase === "up") {
            while (next >= 0 && s <= at[next] && last > at[next]) {
              out.up.push({ at: at[next], s: +s.toFixed(2), ...lib.measure(limit) });
              next--;
            }
            if (s <= 0.001 && !C.walker().seated) done(null);
            else if (now - t0 > 8000) done(`never got up (sitting ${s.toFixed(2)})`);
          }
          last = s;
        };
        if (!C.seats.sit(n)) done("the seat refused");
      });
    },
  };
  window.__clip = lib;
}

// ------------------------------------------------------------------ the run
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
const results = [];
let failed = 0;
try {
  /** The page; made again if its renderer crashes (a new one, as a fresh visitor). */
  let page = null;
  const newPage = async () => {
    await page?.close().catch(() => undefined);
    page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await page.addInitScript(() => {
      Element.prototype.requestPointerLock = function () {
        return Promise.resolve();
      };
      Element.prototype.requestFullscreen = function () {
        return Promise.resolve();
      };
      if (navigator.keyboard) navigator.keyboard.lock = () => Promise.resolve();
    });
    await page.addInitScript(clipLib);
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    page.on("crash", () => console.log("[the page crashed]"));
  };
  await newPage();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const settle = (n) => ev((n) => window.__chimp.settle(n), n);
  /** The house open and walking, every seat free, the camera behind the chimp (so it is drawn, and its skeleton posed, as everyone sees it). */
  const open = async (go) => {
    if (go) await page.goto(`${URL}/house.html?view=game&pov=first&name=Clip&arcade=fixture`);
    await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
    await ev(() => window.__chimp.setWalking(true));
    await page.waitForFunction(() => !!window.__chimp.chimps.describe().mine, null, { timeout: 60000 });
    await ev(() => window.__chimp.seats.reset());
    await ev(() => window.__chimp.chimps.setBoom(2.3));
    await settle(10);
  };
  await open(true);
  /**
   * The page reloaded under the run (the dev server sent a reload: a source file changed, or its
   * dependencies were optimized again), or its renderer crashed: open the house again, as it was.
   */
  const reloaded = (e) => /context was destroyed|navigation|Target closed|crashed|has been closed|__chimp/.test(String(e?.message ?? e));
  let reopens = 0;
  const reopen = async (where, again) => {
    if (++reopens > 12) throw new Error(`the page went away ${reopens} times: giving up at ${where}`);
    console.log(`  (the page went away at ${where}: opening the house again)`);
    if (page.isClosed() || (await page.evaluate(() => 1).catch(() => 0)) !== 1) await newPage();
    await open(true);
    await again?.();
  };
  /** Run `fn`, opening the house again (then `again`: the chimp as it was) and trying again, up to twice more, if the page goes away under it. */
  const retrying = async (where, again, fn) => {
    for (let attempt = 0; ; attempt++)
      try {
        return await fn();
      } catch (e) {
        if (attempt >= 2 || !reloaded(e)) throw e;
        await reopen(where, again);
      }
  };
  const all = await ev(() => window.__chimp.seats.describe().seats);
  const seats = all.filter((s) => !ONLY || ONLY.includes(s.kind) || ONLY.includes(String(s.n)) || ONLY.some((o) => s.label.startsWith(o)));
  console.log(`${seats.length} of ${all.length} seats, bodies ${BODIES.join(", ")}`);

  /** Stand the walker near seat s, in front of it, clear of things (as test-sit.mjs does). */
  const approach = (s) =>
    ev((s) => {
      const w = window.__chimp.walker();
      const open = s.info.turn || s.info.recline <= 0.12;
      const dirs = open ? Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2) : [0, 0.35, -0.35, 0.7, -0.7];
      const base = Math.atan2(s.front[0], s.front[2]);
      for (const d of [0.9, 1.15, 0.7, 1.4, 1.6])
        for (const a of dirs) {
          const x = s.at[0] + Math.sin(base + a) * d;
          const z = s.at[2] + Math.cos(base + a) * d;
          if (!w.place(x, s.floor + 0.35, z, 0.8)) continue;
          if (Math.abs(w.feet.y - s.floor) > 0.08 || Math.hypot(w.feet.x - x, w.feet.z - z) > 0.04) continue;
          // facing the seat, as a visitor who looked at it
          const c = window.__chimp;
          c.setPose({ ...c.pose(), yaw: Math.atan2(s.at[0] - x, s.at[2] - z), pitch: 0.3 });
          return true;
        }
      return false;
    }, s);

  const AT = [0.2, 0.4, 0.6, 0.8];
  /** The head's numbers from a sit: seated (through and clearance) and the worst through while moving. */
  const heads = (r) => {
    const moving = [...r.down, ...r.up].reduce((a, f) => (f.head && f.head.through > a.through ? f.head : a), { through: 0, part: null, into: null });
    return { head: r.seated?.head ?? null, headMoving: moving };
  };
  const headBad = (row) => (row.head?.through ?? 0) > LIMIT || row.headMoving.through > LIMIT;
  const headText = (row) =>
    `head through ${(row.head?.through ?? NaN).toFixed(1)}${row.head?.part ? ` (${row.head.part} in ${row.head.into})` : ""}, clear ${(row.head?.clear ?? NaN).toFixed(1)} cm, moving ${row.headMoving.through.toFixed(1)}${row.headMoving.part ? ` (${row.headMoving.part} in ${row.headMoving.into})` : ""}`;
  const setBody = async (body) => {
    await ev(async (shape) => {
      const c = window.__chimp.chimps;
      const d = structuredClone(c.dna());
      d.outfit = {};
      Object.assign(d.shape, shape);
      await c.setDna(d);
    }, SHAPES[body]);
    await page.waitForFunction((h) => window.__chimp.chimps.describe().mine?.height === h, SHAPES[body].height ?? 1.5, { timeout: 60000 }).catch(() => undefined);
    await settle(20);
  };
  /** Sit on seat s and get up, measuring; null when there is nowhere to stand near it. */
  const sitOn = async (s) => {
    if (!(await approach(s))) return null;
    await settle(3);
    // the furniture round the seat: 1.3 m about it, floor to 1.6 m over the seat
    await ev(([s]) => {
      const r = 1.3;
      window.__clip.prepare([s.at[0] - r, s.floor - 0.1, s.at[2] - r], [s.at[0] + r, s.at[1] + 1.6, s.at[2] + r], window.__chimp.chimps.body().root);
    }, [s]);
    const r = await ev(([n, lim, at]) => window.__clip.run(n, lim, at), [s.n, LIMIT, AT]);
    await settle(2);
    return r;
  };
  for (const body of BODIES) {
    await retrying(`${body}'s body`, null, () => setBody(body));
    for (const s of seats) {
      const r = await retrying(`${body} ${s.n}`, () => setBody(body), () => sitOn(s));
      if (!r) {
        results.push({ body, n: s.n, kind: s.kind, label: s.label, error: "nowhere to stand near it" });
        failed++;
        console.log(`  FAIL ${body} ${s.n} ${s.label}: nowhere to stand near it`);
        continue;
      }
      const worst = (l) => l.reduce((a, b) => (b.skin.cm > a.skin.cm ? b : a), { skin: { cm: 0 } });
      const tr = worst([...r.down, ...r.up]);
      const row = { body, n: s.n, kind: s.kind, label: s.label, room: s.room, error: r.error, seated: r.seated?.skin ?? null, transition: tr.skin, transitionAt: tr.at ?? null, phase: r.down.includes(tr) ? "down" : r.up.includes(tr) ? "up" : null, frames: { down: r.down.map((f) => f.skin.cm), up: r.up.map((f) => f.skin.cm) }, ...heads(r) };
      results.push(row);
      const bad = !!r.error || (row.seated?.cm ?? 99) > LIMIT || row.transition.cm > LIMIT || headBad(row);
      if (bad) failed++;
      console.log(
        `  ${bad ? "FAIL" : "ok  "} ${body.padEnd(7)} ${String(s.n).padStart(5)} ${s.kind.padEnd(8)} ${s.label.slice(0, 28).padEnd(28)} seated ${(row.seated?.cm ?? NaN).toFixed(1).padStart(5)} cm${row.seated?.bone ? ` (${row.seated.bone} in ${row.seated.into})` : ""}  moving ${row.transition.cm.toFixed(1).padStart(5)} cm${row.transition.bone ? ` (${row.transition.bone} in ${row.transition.into} ${row.phase} at ${row.transitionAt})` : ""}  ${headText(row)}${r.error ? `  ${r.error}` : ""}`,
      );
    }
  }

  // a hat and a backpack on the Game Room's couch and in the egg chairs (round shells close over the head), on every body
  if (process.env.WEAR !== "0") {
    const dressSeats = all.filter((s) => (s.label.startsWith("Curved console sofa") || s.kind === "eggChair") && (!ONLY || seats.includes(s)));
    const dress = (body) => async () => {
      await ev(async (shape) => {
        const c = window.__chimp.chimps;
        const d = structuredClone(c.dna());
        Object.assign(d.shape, shape);
        d.outfit = { head: { id: "cap", colors: ["#1f6f6c", "#24272b"] }, back: { id: "backpack", colors: ["#6d8c58", "#6a4128"] }, top: { id: "hoodie", colors: ["#2f8a62", "#24272b"] }, bottom: { id: "shorts", colors: ["#24365a"] } };
        await c.setDna(d);
      }, SHAPES[body]);
      await page.waitForFunction((h) => window.__chimp.chimps.describe().mine?.height === h, SHAPES[body].height ?? 1.5, { timeout: 60000 }).catch(() => undefined);
      await settle(40);
    };
    for (const body of dressSeats.length ? BODIES : []) {
      await retrying(`dressing ${body}`, null, dress(body));
      for (const s of dressSeats) {
        const r = await retrying(`dressed ${body} ${s.n}`, dress(body), () => sitOn(s));
        if (!r) continue;
        const worn = r.seated?.worn ?? { cm: NaN };
        const row = { body: `dressed ${body}`, n: s.n, kind: s.kind, label: s.label, room: s.room, error: r.error, seated: r.seated?.skin ?? null, worn, transition: { cm: Math.max(0, ...[...r.down, ...r.up].map((f) => f.skin.cm)) }, wornMoving: Math.max(0, ...[...r.down, ...r.up].map((f) => f.worn.cm)), ...heads(r) };
        results.push(row);
        const bad = !!r.error || (row.seated?.cm ?? 99) > LIMIT || row.transition.cm > LIMIT || worn.cm > LIMIT || row.wornMoving > LIMIT || headBad(row);
        if (bad) failed++;
        console.log(`  ${bad ? "FAIL" : "ok  "} dressed ${body.padEnd(7)} ${String(s.n).padStart(5)} ${s.label.slice(0, 28).padEnd(28)} skin ${(row.seated?.cm ?? NaN).toFixed(1)} cm, moving ${row.transition.cm.toFixed(1)} cm, cap/backpack/hoodie seated ${worn.cm.toFixed(1)} cm${worn.bone ? ` (${worn.bone} in ${worn.into})` : ""}, moving ${row.wornMoving.toFixed(1)} cm  ${headText(row)}`);
      }
    }
  }
} finally {
  await stop();
}

// ------------------------------------------------------------------ per kind
const kinds = {};
for (const r of results) {
  const k = (kinds[r.kind] ??= { seats: new Set(), seated: 0, moving: 0, head: 0, headClear: 12, worst: null, errors: 0 });
  k.seats.add(r.n);
  if (r.error) k.errors++;
  if ((r.seated?.cm ?? 0) > k.seated) {
    k.seated = r.seated.cm;
    k.worst = `${r.body} ${r.n} ${r.label}: ${r.seated.bone} in ${r.seated.into}`;
  }
  k.moving = Math.max(k.moving, r.transition?.cm ?? 0);
  k.head = Math.max(k.head, r.head?.through ?? 0, r.headMoving?.through ?? 0);
  k.headClear = Math.min(k.headClear, r.head?.clear ?? 12);
}
console.log("\nper kind (worst over every seat and body, cm):");
for (const [k, v] of Object.entries(kinds)) console.log(`  ${k.padEnd(9)} ${String(v.seats.size).padStart(3)} seats  seated ${v.seated.toFixed(1).padStart(5)}  moving ${v.moving.toFixed(1).padStart(5)}  head through ${v.head.toFixed(1).padStart(4)} clear ${v.headClear.toFixed(1).padStart(4)}${v.errors ? `  ${v.errors} errors` : ""}  ${v.worst ?? ""}`);
await writeFile(OUT, JSON.stringify({ limit: LIMIT, results, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { ...v, seats: v.seats.size }])) }, null, 1));
console.log(`\n${results.length} sits measured; ${failed} past ${LIMIT} cm (or failed). Numbers: ${OUT}`);
process.exit(failed ? 1 : 0);
