// Giant living trees: buttressed fig-like trunks rising through the house,
// spreading limbs over the roofs, leaf canopy, vines and hanging lanterns.

import { Vector3 } from "@babylonjs/core";
import { rng } from "../geometry/curves";
import { Geo, tube } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { Leaf } from "../materials/leaves";
import { BRIDGE, LEVEL, TREES, TreeDef, bridgeAt, galleryOuter, upperDeckLoop } from "../layout";
import { offsetPath, pointInPolygon } from "../geometry/curves";

const footprint = offsetPath(upperDeckLoop, 1.8, true);

/**
 * Whether p is inside the walking space over the canopy bridge (its width plus
 * `pad` either side, from just under the deck to 3 m above it), which foliage keeps clear of.
 */
function inBridgeTunnel(p: Vector3, pad = 0.75): boolean {
  const b = bridgeAt(p);
  return b.t > -0.03 && b.t < 1.03 && b.d < BRIDGE.width / 2 + pad && p.y > b.y - 0.6 && p.y < b.y + 3.0;
}

/** Highest point a vine or lantern hanging at plan point p may reach down to, to stay over the bridge's headroom. */
function bridgeHeadroom(p: Vector3): number {
  const b = bridgeAt(p);
  return b.t > -0.03 && b.t < 1.03 && b.d < BRIDGE.width / 2 + 0.75 ? b.y + 3.0 : -Infinity;
}

/** Lowest height foliage may reach at (x, z) so it never pokes through roofs into rooms. */
function clearance(x: number, z: number): number {
  const ex = (x - galleryOuter.cx) / (galleryOuter.rx + 1);
  const ez = (z - galleryOuter.cz) / (galleryOuter.rz + 1);
  if (ex * ex + ez * ez < 1) return LEVEL.domeApex + 0.5;
  if (pointInPolygon({ x, z }, footprint)) return LEVEL.roof + 0.7;
  return -Infinity;
}
import { leafMatrix, vine } from "../props/plants";
import { hangingLantern } from "../props/lights";
import { TRUNK_SIDES, TrunkShape, trunkShape } from "./trunkShape";

/** Organic trunk mesh with buttress roots and a rounded top, from the shared trunk shape. */
function trunkGeo(shape: TrunkShape): Geo {
  const g = new Geo();
  const { rings, ringV, def } = shape;
  const rows = rings.map((ring, i) => ring.map((w, j) => g.vert(w.x, w.y, w.z, (j / TRUNK_SIDES) * def.r * 2 * Math.PI * 1.1, ringV[i])));
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < TRUNK_SIDES; j++) g.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  g.computeNormals();
  // seam normals
  for (const row of rows) {
    const a = row[0] * 3;
    const b = row[TRUNK_SIDES] * 3;
    for (let k = 0; k < 3; k++) {
      const m = (g.nrm[a + k] + g.nrm[b + k]) / 2;
      g.nrm[a + k] = m;
      g.nrm[b + k] = m;
    }
  }
  return g;
}

/** Fix winding so the trunk faces outward regardless of frame handedness. */
function outward(g: Geo, axis: Vector3[]): Geo {
  // compare first triangle normal with the radial direction
  const P = g.pos;
  const a = g.idx[0];
  const b = g.idx[1];
  const c = g.idx[2];
  const pa = new Vector3(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
  const pb = new Vector3(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
  const pc = new Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
  const f = Vector3.Cross(pc.subtract(pa), pb.subtract(pa));
  const radial = pa.subtract(axis[0]);
  radial.y = 0;
  if (Vector3.Dot(f, radial) < 0) g.flip();
  return g;
}

function bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, n: number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(p0.scale(u * u * u).add(p1.scale(3 * u * u * t)).add(p2.scale(3 * u * t * t)).add(p3.scale(t * t * t)));
  }
  return out;
}

interface CrownOpts {
  limbs: number;
  reach: [number, number];
  spreadDir?: number; // preferred heading (radians) for limbs
  spreadBias?: number;
  leafScale?: number;
  lanterns?: number;
  vines?: number;
  density?: number;
}

export function buildTree(ctx: WorldCtx, def: TreeDef, o: CrownOpts): void {
  const zt: Zone = zone("trees", "site");
  const z: Zone = zone("trees", "roof");
  const r = rng(def.seed);
  const shape = trunkShape(def);
  const ctrl = shape.path;
  const trunk = outward(trunkGeo(shape), ctrl);
  ctx.g(zt, "bark").add(trunk, undefined, def.name);

  // limbs
  const top = ctrl[ctrl.length - 1];
  const bark = ctx.g(z, "bark");
  const ends: { p: Vector3; dir: Vector3; size: number }[] = [];
  for (let i = 0; i < o.limbs; i++) {
    let a = (i / o.limbs) * Math.PI * 2 + r() * 0.7;
    if (o.spreadDir !== undefined) a = o.spreadDir + (r() - 0.5) * Math.PI * (o.spreadBias ?? 1.2);
    const reach = o.reach[0] + r() * (o.reach[1] - o.reach[0]);
    // limbs leave the trunk above any roof they might otherwise cross
    const minIdx = Math.max(0, ctrl.findIndex((c) => c.y >= Math.max(clearance(c.x, c.z), clearance(c.x + 3, c.z), clearance(c.x - 3, c.z), clearance(c.x, c.z + 3), clearance(c.x, c.z - 3)) + 0.9));
    const lo = Math.max(minIdx, Math.floor(0.72 * (ctrl.length - 1)));
    const sp = ctrl[Math.min(ctrl.length - 2, lo + Math.floor(r() * Math.max(1, ctrl.length - 1 - lo)))];
    const rise = 2 + r() * 4;
    const drop = r() * 1.5;
    const r0 = def.r * (0.42 + r() * 0.12);
    // a limb that would cross the walking space over the canopy bridge swings round to miss it
    const limbPath = (ang: number) => {
      const d = new Vector3(Math.cos(ang), 0, Math.sin(ang));
      const q3 = sp.add(d.scale(reach)).add(new Vector3(0, rise * 0.4 - drop, 0));
      return { d, q3, pts: bezier(sp, sp.add(d.scale(reach * 0.25)).add(new Vector3(0, rise * 0.9, 0)), sp.add(d.scale(reach * 0.65)).add(new Vector3(0, rise * 1.1, 0)), q3, 14) };
    };
    let limb = limbPath(a);
    for (let k = 1; k <= 8 && limb.pts.some((q) => inBridgeTunnel(q, 0.75 + r0)); k++) {
      a += (k % 2 ? 1 : -1) * k * 0.35;
      limb = limbPath(a);
    }
    if (limb.pts.some((q) => inBridgeTunnel(q, 0.75 + r0))) continue;
    const { d: dir, q3: p3, pts } = limb;
    bark.add(tube(pts, (t) => r0 * (1 - t * 0.78), 12), undefined, `${def.name} limb`);
    // secondary branches
    for (let k = 0; k < 4; k++) {
      const t = 0.35 + r() * 0.6;
      const bp = pts[Math.floor(t * (pts.length - 1))];
      const ba = a + (r() - 0.5) * 2.2;
      const bdir = new Vector3(Math.cos(ba), 0.35 + r() * 0.5, Math.sin(ba)).normalize();
      const bl = 2.5 + r() * 4;
      const bpts = bezier(bp, bp.add(bdir.scale(bl * 0.35)), bp.add(bdir.scale(bl * 0.7)).add(new Vector3(0, 0.3, 0)), bp.add(bdir.scale(bl)).add(new Vector3(0, -0.4, 0)), 6);
      if (bpts.some((q) => inBridgeTunnel(q, 0.95))) continue;
      bark.add(tube(bpts, (tt) => r0 * (1 - t * 0.6) * 0.45 * (1 - tt * 0.8), 8));
      ends.push({ p: bpts[bpts.length - 1], dir: bdir, size: 1 });
      ends.push({ p: bpts[Math.floor(bpts.length / 2)], dir: bdir, size: 0.8 });
    }
    ends.push({ p: p3, dir, size: 1.2 });
    ends.push({ p: pts[9], dir, size: 1 });
    // hanging vines from limbs
    for (let v = 0; v < (o.vines ?? 6); v++) {
      const vp = pts[3 + Math.floor(r() * (pts.length - 4))].add(new Vector3(0, -r0 * 0.5, 0));
      const L = Math.min(1.5 + r() * 5.5, vp.y - clearance(vp.x, vp.z) - 0.2, vp.y - bridgeHeadroom(vp));
      if (L > 0.6) vine(ctx, z, vp, L, r, { type: r() > 0.5 ? Leaf.Pothos : Leaf.Philodendron, density: 6, leaf: 0.16 });
    }
  }
  // crown: canopy clusters around branch ends and above the top
  const leafScale = o.leafScale ?? 1;
  const density = o.density ?? 1;
  const crown = (c: Vector3, rad: number, count: number) => {
    for (let k = 0; k < count; k++) {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const rr = Math.cbrt(r()) * rad;
      const off = new Vector3(Math.sqrt(1 - u * u) * Math.cos(th), u * 0.55, Math.sqrt(1 - u * u) * Math.sin(th)).scale(rr);
      const p = c.add(off);
      const outwardDir = off.lengthSquared() > 1e-4 ? off.normalizeToNew() : Vector3.Up();
      const dir = new Vector3(outwardDir.x + (r() - 0.5), 0.3 + r() * 0.6, outwardDir.z + (r() - 0.5));
      const s = (2.4 + r() * 2.2) * leafScale;
      const type = r() > 0.45 ? Leaf.CanopyA : Leaf.CanopyB;
      const start = p.add(dir.scale(-s * 0.5));
      if (start.y - s * 0.35 < clearance(start.x, start.z)) continue;
      const dn = dir.normalizeToNew();
      if ([0, 0.5, 1].some((f) => inBridgeTunnel(start.add(dn.scale(s * f)), 0.75 + s * 0.3))) continue;
      ctx.leaf(z, type, leafMatrix(start, dir, s, (r() - 0.5) * 1.5, 1, outwardDir.add(new Vector3(0, 0.8, 0))));
    }
    for (let k = 0; k < count * 1.2; k++) {
      const th = r() * Math.PI * 2;
      const rr = rad * (0.7 + r() * 0.45);
      const p = c.add(new Vector3(Math.cos(th) * rr, (r() - 0.6) * rad * 0.7, Math.sin(th) * rr));
      const dir = new Vector3(Math.cos(th), -0.2 + r() * 0.6, Math.sin(th));
      const ts = (1.0 + r() * 0.9) * leafScale;
      if (p.y - ts * 0.4 < clearance(p.x, p.z)) continue;
      if ([0, 0.5, 1].some((f) => inBridgeTunnel(p.add(dir.normalizeToNew().scale(ts * f)), 0.75 + ts * 0.3))) continue;
      ctx.leaf(z, Leaf.Twig, leafMatrix(p, dir, ts, (r() - 0.5) * 1.2));
    }
  };
  for (const e of ends) crown(e.p.add(new Vector3(0, 0.8, 0)), 2.6 * e.size * leafScale, Math.round(10 * e.size * density));
  crown(top.add(new Vector3(0, 2.5, 0)), 4.5 * leafScale, Math.round(26 * density));

  // lanterns hang from limb ends that reach out beyond the roofs (over decks and the approach)
  const open = ends.filter((e) => clearance(e.p.x, e.p.z) === -Infinity);
  for (let i = 0; i < Math.min(o.lanterns ?? 0, open.length); i++) {
    const e = open[Math.floor(r() * open.length)];
    const hang = Math.min(1.5 + r() * 3.0, e.p.y - (LEVEL.upper + 3.2), e.p.y - 0.6 - bridgeHeadroom(e.p));
    if (hang < 0.4) continue;
    hangingLantern(ctx, z, e.p.add(new Vector3(0, -0.2, 0)), 0.3 + r() * 0.12, hang);
    ctx.lights.push({ pos: e.p.add(new Vector3(0, -hang - 0.6, 0)), color: "#ffb35e", day: 0, night: 2.5, range: 6, rooms: ["trees", "structure", "roofs"], level: "site" });
  }
}

export function buildTrees(ctx: WorldCtx): void {
  for (const def of TREES) {
    switch (def.id) {
      case "treeWestCentral":
        buildTree(ctx, def, { limbs: 5, reach: [8, 13], spreadDir: Math.PI * 0.85, spreadBias: 1.4, lanterns: 5, vines: 5 });
        break;
      case "treeEastCentral":
        buildTree(ctx, def, { limbs: 5, reach: [8, 13], spreadDir: Math.PI * 0.05, spreadBias: 1.4, lanterns: 5, vines: 5 });
        break;
      case "treeTerrace":
        buildTree(ctx, def, { limbs: 4, reach: [6, 10], spreadDir: Math.PI * 1.75, spreadBias: 1.6, lanterns: 6, vines: 4 });
        break;
      case "treeWest":
        buildTree(ctx, def, { limbs: 4, reach: [6, 9], lanterns: 2, vines: 4 });
        break;
      case "treeEast":
        buildTree(ctx, def, { limbs: 4, reach: [6, 10], spreadDir: Math.PI * 1.1, lanterns: 3, vines: 4 });
        break;
      default:
        buildTree(ctx, def, { limbs: 5, reach: [6, 11], vines: 3, density: 1.2 });
    }
  }
}
