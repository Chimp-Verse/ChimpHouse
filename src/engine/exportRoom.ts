import { Color3, DynamicTexture, Material, Matrix, Mesh, MultiMaterial, PBRMaterial, Quaternion, Scene, SubMesh, Texture, TransformNode, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0";
import { LightDef, MeshMeta } from "../world/context";
import { pointInPolygon } from "../world/geometry/curves";
import { ROOMS } from "../world/layout";
import { SUN_DIR } from "../world/environment/sky";
import { VIEWPOINTS } from "../world/viewpoints";

/**
 * Export one room as a .glb for Blender, at the quality the master file
 * needs: one object per item (a sofa, a lamp, a planter with its plant)
 * named after its label, turned to face the way the item was placed and with
 * its origin at the centre of its base, under Level › Room nodes. The house is generated as a few merged meshes per
 * room and material; the pieces recorded while it was built (MeshMeta.pieces)
 * and their labels split those meshes back into items.
 *
 * Coordinates in `extras` (lights, camera, sun) are the preview's: Babylon,
 * left-handed, y up. The exporter itself converts the geometry to glTF's
 * right-handed axes by negating x.
 */

interface Segment {
  /** its label, or for a generic piece the one it inherited (or its mesh's name) */
  label: string;
  /** no label of its own (a pot's soil, plant stems, glass in a door): joins the item it touches */
  generic: boolean;
  /** turn about the vertical it was placed with (NaN when built in place) */
  yaw: number;
  mat: Material;
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
  min: Vector3;
  max: Vector3;
}

interface Item {
  label: string;
  segs: Segment[];
  min: Vector3;
  max: Vector3;
}

/** Building fabric: items too big to be what a small loose part belongs to, while anything else is near it. */
const FABRIC = /wall|glazing|\barch\b|floor|ceiling|roof|fascia|slab|soffit|stringer|railing glass|balustrade glass/i;

/** Items that leaves are attached to: plants, planters, vines, trees. */
const PLANT = /plant|planter|pot\b|fern|palm|vine|bush|shrub|grass|bed\b|tree|trunk|limb|branch|canopy/i;

export async function exportRoom(scene: Scene, roomId: string, lights: LightDef[]): Promise<Blob> {
  const room = ROOMS.find((r) => r.id === roomId);
  if (!room) throw new Error(`Unknown room ${roomId}`);
  const levelName = room.level === "lower" ? "Lower" : "Upper";
  const { items, joins } = buildItems(selectZone(scene, roomId, room.level));
  for (const [what, n] of joins) console.info(`[export] ${n} unlabelled ${what}`);

  // ---- build the export nodes: Level › Room › items
  const root = new TransformNode(levelName, scene);
  const roomNode = new TransformNode(room.name, scene);
  roomNode.parent = root;
  const view = VIEWPOINTS.find((v) => v.id === roomId);
  // lights, sun and viewpoint for rebuilding the scene in Blender, as one JSON string
  // (Blender keeps glTF extras as custom properties, which can't hold lists of objects)
  const preview = {
    coordinates: "Babylon preview: left-handed, y up, metres; glTF = (-x, y, z)",
    lights: lights.filter((l) => l.rooms.includes(roomId) && l.level === room.level).map((l) => ({ ...l, pos: l.pos.asArray(), dir: l.dir?.asArray() })),
    sun: { dir: SUN_DIR.asArray(), color: "#ffc98f" },
    camera: view && { name: view.label, ...view.pose, ref: view.refName ?? null },
  };
  roomNode.metadata = { gltf: { extras: { room: roomId, level: room.level, preview: JSON.stringify(preview) } } };
  const made: Made = { mats: [], textures: [], restore: [] };
  const matFor = exportMaterials(scene, made);
  for (const [i, it] of nameItems(items).entries()) {
    const mesh = buildItemMesh(scene, it, matFor, made);
    mesh.name = it.label;
    mesh.parent = roomNode;
    mesh.metadata = { gltf: { extras: { level: room.level, room: roomId, item: it.label, order: i } } };
  }
  // in the scene only for the export: never drawn
  for (const n of root.getDescendants(false)) if (n instanceof Mesh) n.layerMask = 0;

  try {
    const data = await GLTF2Export.GLBAsync(scene, roomId, {
      shouldExportNode: (n) => n === root || n.isDescendantOf(root),
      exportWithoutWaitingForScene: true,
      removeNoopRootNodes: false,
    });
    return data.files[`${roomId}.glb`] as Blob;
  } finally {
    root.dispose(false, false);
    for (const undo of made.restore) undo();
    for (const m of made.mats) m.dispose(false, false);
    for (const t of made.textures) t.dispose();
  }
}

/** What an export adds to the scene, and how to put the scene's own materials back. */
interface Made {
  mats: Material[];
  textures: Texture[];
  restore: (() => void)[];
}

/** What one zone of the house is made of: its merged meshes' pieces and its leaf instances. */
interface Selection {
  segs: Segment[];
  leafMeshes: Mesh[];
}

/**
 * The pieces of a zone: a room (by id and level) with the roof pieces over it, or any
 * other zone of the house by its id (structure, approach, bridge, trees…), on all levels.
 */
function selectZone(scene: Scene, zoneId: string, level?: string): Selection {
  const room = ROOMS.find((r) => r.id === zoneId && (!level || r.level === level));
  const segs: Segment[] = [];
  const leafMeshes: Mesh[] = [];
  for (const m of scene.meshes) {
    const md = m.metadata as MeshMeta | undefined;
    if (!(m instanceof Mesh) || !md || !m.material || m.getTotalIndices() === 0) continue;
    if (md.room === zoneId && (!room || md.level === room.level)) {
      if (md.kind === "leaves") leafMeshes.push(m);
      else segs.push(...segmentsOf(m));
    } else if (room && md.room === "roofs" && !md.kind) {
      segs.push(...segmentsOf(m).filter((s) => pointInPolygon({ x: (s.min.x + s.max.x) / 2, z: (s.min.z + s.max.z) / 2 }, room.loop)));
    }
  }
  return { segs, leafMeshes };
}

/**
 * Items from a zone's pieces: pieces with the same label that touch. A piece without a
 * label of its own first joins an item with the label it inherited within 30 cm
 * (builders often set a label, add one piece, build something else and add the rest:
 * stair treads, balustrade panes), repeating as items grow. A small part (under 1 m)
 * then joins the nearest item within 50 cm that isn't building fabric (a bulb its
 * lantern, a glass its rack, not the window behind them). Anything else joins the
 * item that holds most of it, the smaller on a tie (a pot's soil and stems join the
 * pot). A piece no item holds a fifth of becomes its own item, named after its
 * material, for its label to be fixed in the code. Leaves join the plant or tree they
 * grow from; leaves with none (grass, bromeliads) form clumps of their own. `joins` counts how unlabelled
 * pieces were placed; `odd` lists placements worth a look (a piece bigger than the item
 * it joined, leaves with no plant).
 */
function buildItems({ segs, leafMeshes }: Selection): { items: Item[]; joins: Map<string, number>; odd: string[] } {
  const items = groupItems(segs.filter((s) => !s.generic));
  const joins = new Map<string, number>();
  const odd: string[] = [];
  const join = (s: Segment, it: Item | null) => {
    const key = `${s.mat.name} pieces (after "${s.label}") -> ${it ? `"${it.label}"` : "own item"}`;
    joins.set(key, (joins.get(key) ?? 0) + 1);
    if (it) {
      // a piece more than 30 cm bigger than the item it joins, in any direction
      const excess = [0, 1, 2].map((k) => s.max.asArray()[k] - s.min.asArray()[k] - (it.max.asArray()[k] - it.min.asArray()[k]));
      if (it.label !== s.label && Math.max(...excess) > 0.3)
        odd.push(`a ${s.mat.name} piece ${size(s)} (after "${s.label}") joined the smaller "${it.label}" ${size(it)}`);
      addTo(it, s);
    } else items.push({ label: `${s.mat.name} parts`, segs: [{ ...s, generic: false }], min: s.min.clone(), max: s.max.clone() });
  };
  let pending = segs.filter((s) => s.generic);
  for (let grew = true; grew; ) {
    grew = false;
    pending = pending.filter((s) => {
      const it = items.find((i) => i.label === s.label && overlap(s.min, s.max, i.min, i.max, 0.15) > 0);
      if (it) (grew = true), join(s, it);
      return !it;
    });
  }
  for (const s of pending) {
    if (Math.max(s.max.x - s.min.x, s.max.y - s.min.y, s.max.z - s.min.z) < 1) {
      let near: Item | null = null;
      let nearGap = 0.5;
      for (const it of items) {
        if (FABRIC.test(it.label)) continue;
        const g = gap(s, it);
        if (g < nearGap - 1e-4 || (g < nearGap + 1e-4 && near && volume(it) < volume(near))) (nearGap = g), (near = it);
      }
      if (near) {
        join(s, near);
        continue;
      }
    }
    const own = volume(s);
    let best: Item | null = null;
    let bestShare = 0.2;
    for (const it of items) {
      const share = overlap(s.min, s.max, it.min, it.max, 0.03) / own;
      if (share > bestShare * 1.1 || (share > bestShare * 0.9 && best && volume(it) < volume(best))) (bestShare = Math.max(share, bestShare)), (best = it);
    }
    join(s, best);
  }

  // leaves: each instance baked into the plant it grows from
  const plants = items.filter((it) => PLANT.test(it.label));
  const foliage = new Map<Item, Segment>();
  // leaves with no plant gather into clumps: one per 0.6 m cube they start in, joined with a touching cube's
  const clumps = new Map<string, Item>();
  const clumpAt = (at: Vector3): Item => {
    const [i, j, k] = [at.x, at.y, at.z].map((v) => Math.floor(v / 0.6));
    let c = clumps.get(`${i},${j},${k}`);
    for (let d = 0; !c && d < 27; d++) c = clumps.get(`${i + (d % 3) - 1},${j + (Math.floor(d / 3) % 3) - 1},${k + Math.floor(d / 9) - 1}`);
    c ??= { label: "Foliage", segs: [], min: at.clone(), max: at.clone() };
    clumps.set(`${i},${j},${k}`, c);
    return c;
  };
  for (const lm of leafMeshes) {
    const base = segmentsOf(lm, true)[0];
    for (const w of lm.thinInstanceGetWorldMatrices()) {
      const at = w.getTranslation();
      // the smallest plant whose stems reach the leaf, else the nearest one close by
      let host: Item | null = null;
      let best = Infinity;
      for (const p of plants) if (inBox(at, p, 0.15) && volume(p) < best) (best = volume(p)), (host = p);
      if (!host) {
        best = Infinity;
        for (const p of plants) {
          const d = Math.hypot(at.x - (p.min.x + p.max.x) / 2, at.z - (p.min.z + p.max.z) / 2);
          if (inBox(at, p, 0.8) && d < best) (best = d), (host = p);
        }
      }
      if (!host) {
        // a canopy leaf out at the end of its twig: the nearest tree or plant within 3 m
        best = 3;
        const pt = { min: at, max: at };
        for (const p of plants) {
          const g = gap(pt, p);
          if (g < best) (best = g), (host = p);
        }
      }
      if (!host) host = clumpAt(at);
      let seg = foliage.get(host);
      if (!seg) {
        seg = { label: host.label, generic: true, yaw: NaN, mat: base.mat, pos: [], nrm: [], uv: [], idx: [], min: at.clone(), max: at.clone() };
        foliage.set(host, seg);
      }
      appendTransformed(seg, base, w);
    }
  }
  const clumped = new Set(clumps.values());
  for (const c of clumped) items.push(c);
  if (clumped.size) odd.push(`${clumped.size} clumps of leaves with no plant or tree (exported as "Foliage")`);
  for (const [host, seg] of foliage) addTo(host, seg);
  return { items, joins, odd };
}

/** An item's or piece's size, "(w x h x d m)". */
function size(b: { min: Vector3; max: Vector3 }): string {
  return `(${b.max.subtract(b.min).asArray().map((v) => v.toFixed(2)).join(" x ")} m)`;
}

export interface ItemSummary {
  name: string;
  materials: string[];
  /** width, height and depth in the item's own frame, metres */
  size: number[];
  yawDeg: number;
}

/** A zone's items as the export would make them, and how its unlabelled pieces were placed, for review. */
export function auditZone(scene: Scene, zoneId: string, level?: string): { items: ItemSummary[]; joins: Record<string, number>; odd: string[] } {
  const { items, joins, odd } = buildItems(selectZone(scene, zoneId, level));
  const summaries = nameItems(items).map((it) => {
    const yaw = itemYaw(it);
    const inv = Matrix.RotationYawPitchRoll(-yaw, 0, 0);
    const lo = new Vector3(Infinity, Infinity, Infinity);
    const hi = new Vector3(-Infinity, -Infinity, -Infinity);
    const v = new Vector3();
    for (const s of it.segs)
      for (let i = 0; i < s.pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(s.pos[i], s.pos[i + 1], s.pos[i + 2], inv, v);
        lo.minimizeInPlace(v);
        hi.maximizeInPlace(v);
      }
    return { name: it.label, materials: [...new Set(it.segs.map((s) => s.mat.name))], size: hi.subtract(lo).asArray().map((x) => +x.toFixed(2)), yawDeg: Math.round((yaw * 180) / Math.PI) };
  });
  return { items: summaries, joins: Object.fromEntries(joins), odd };
}

/** Split a merged mesh into its pieces (one per `add` and label change), in world space. */
function segmentsOf(mesh: Mesh, whole = false): Segment[] {
  const md = mesh.metadata as MeshMeta;
  const wm = mesh.computeWorldMatrix(true);
  const P = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const N = mesh.getVerticesData(VertexBuffer.NormalKind) ?? [];
  const UV = mesh.getVerticesData(VertexBuffer.UVKind) ?? [];
  const I = mesh.getIndices()!;
  const faces = I.length / 3;
  const cuts = whole ? [0] : [...new Set([0, ...(md.pieces ?? []), ...md.labels.map((l) => l.face)])].filter((f) => f < faces).sort((a, b) => a - b);
  const loose = new Set(md.loose ?? []);
  const pieces = md.pieces ?? [];
  const yaws = md.yaws ?? [];
  /** the yaw of the piece containing face f */
  const yawAt = (f: number) => {
    let lo = 0;
    let hi = pieces.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pieces[mid] <= f) (found = mid), (lo = mid + 1);
      else hi = mid - 1;
    }
    return found < 0 ? NaN : (yaws[found] ?? NaN);
  };
  const identity = wm.isIdentity();
  const nm = identity ? null : wm.clone().invert().transpose();
  const out: Segment[] = [];
  const v = new Vector3();
  for (let c = 0; c < cuts.length; c++) {
    const f0 = cuts[c];
    const f1 = c + 1 < cuts.length ? cuts[c + 1] : faces;
    let label = "";
    for (const l of md.labels) if (l.face <= f0) label = l.label;
    const seg: Segment = { label: label || mesh.name, generic: !label || loose.has(f0), yaw: whole ? NaN : yawAt(f0), mat: mesh.material!, pos: [], nrm: [], uv: [], idx: [], min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
    const remap = new Map<number, number>();
    for (let k = f0 * 3; k < f1 * 3; k++) {
      const src = I[k];
      let dst = remap.get(src);
      if (dst === undefined) {
        dst = seg.pos.length / 3;
        remap.set(src, dst);
        v.set(P[src * 3], P[src * 3 + 1], P[src * 3 + 2]);
        if (!identity) Vector3.TransformCoordinatesToRef(v, wm, v);
        seg.pos.push(v.x, v.y, v.z);
        seg.min.minimizeInPlace(v);
        seg.max.maximizeInPlace(v);
        v.set(N[src * 3] ?? 0, N[src * 3 + 1] ?? 1, N[src * 3 + 2] ?? 0);
        if (nm) Vector3.TransformNormalToRef(v, nm, v);
        v.normalize();
        seg.nrm.push(v.x, v.y, v.z);
        seg.uv.push(UV[src * 2] ?? 0, UV[src * 2 + 1] ?? 0);
      }
      seg.idx.push(dst);
    }
    if (seg.idx.length) out.push(seg);
  }
  return out;
}

/** Append `src` (world space) transformed by `m` into `dst`. */
function appendTransformed(dst: Segment, src: Segment, m: Matrix) {
  const base = dst.pos.length / 3;
  const nm = m.clone().invert().transpose();
  const v = new Vector3();
  for (let i = 0; i < src.pos.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(src.pos[i], src.pos[i + 1], src.pos[i + 2], m, v);
    dst.pos.push(v.x, v.y, v.z);
    dst.min.minimizeInPlace(v);
    dst.max.maximizeInPlace(v);
    Vector3.TransformNormalFromFloatsToRef(src.nrm[i], src.nrm[i + 1], src.nrm[i + 2], nm, v);
    v.normalize();
    dst.nrm.push(v.x, v.y, v.z);
  }
  dst.uv.push(...src.uv);
  for (const i of src.idx) dst.idx.push(i + base);
}

/** Overlap volume of two boxes, each grown by `pad`; 0 when apart. */
function overlap(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3, pad: number): number {
  const dx = Math.min(a1.x, b1.x) - Math.max(a0.x, b0.x) + 2 * pad;
  const dy = Math.min(a1.y, b1.y) - Math.max(a0.y, b0.y) + 2 * pad;
  const dz = Math.min(a1.z, b1.z) - Math.max(a0.z, b0.z) + 2 * pad;
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

/**
 * Which way an item faces: the turn of most of it, by size, as its labelled pieces
 * were placed (a speaker's cabinet, not its many small tilted cones), when that is
 * known; otherwise the turn of the smallest rectangle round its footprint (a curved
 * sofa lines up with its chord), or none for round things.
 */
function itemYaw(it: Item): number {
  const votes: { yaw: number; w: number }[] = [];
  let total = 0;
  for (const s of it.segs) {
    if (s.generic) continue;
    const w = Math.max(0.02, s.max.x - s.min.x) * Math.max(0.02, s.max.y - s.min.y) * Math.max(0.02, s.max.z - s.min.z);
    total += w;
    if (!Number.isFinite(s.yaw)) continue;
    const v = votes.find((o) => Math.abs(Math.atan2(Math.sin(o.yaw - s.yaw), Math.cos(o.yaw - s.yaw))) < 0.02);
    if (v) v.w += w;
    else votes.push({ yaw: s.yaw, w });
  }
  const best = votes.sort((a, b) => b.w - a.w)[0];
  if (best && best.w >= 0.5 * total) return Math.abs(best.yaw) < 1e-4 ? 0 : best.yaw;
  return footprintYaw(it);
}

/** The turn (within ±45°) of the smallest rectangle round an item's plan; 0 unless it is clearly smaller. */
function footprintYaw(it: Item): number {
  const pts: { x: number; z: number }[] = [];
  for (const s of it.segs) for (let i = 0; i < s.pos.length; i += 3) pts.push({ x: s.pos[i], z: s.pos[i + 2] });
  const hull = convexHull(pts);
  if (hull.length < 3) return 0;
  const area = (t: number) => {
    const c = Math.cos(t);
    const sn = Math.sin(t);
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const p of hull) {
      // along and across the direction at angle t (from +x towards +z)
      const u = p.x * c + p.z * sn;
      const w = -p.x * sn + p.z * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
    }
    return Math.max(u1 - u0, 0.01) * Math.max(w1 - w0, 0.01);
  };
  let bestT = 0;
  let bestA = area(0);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    let t = Math.atan2(b.z - a.z, b.x - a.x);
    t = ((t % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (t > Math.PI / 4) t -= Math.PI / 2;
    const ar = area(t);
    if (ar < bestA) (bestA = ar), (bestT = t);
  }
  // xf's rotY turns +x towards -z; the rectangle that lines up with the item at angle t is turned by -t
  return bestA < 0.97 * area(0) ? -bestT : 0;
}

/** Convex hull of plan points (monotone chain). */
function convexHull(pts: { x: number; z: number }[]): { x: number; z: number }[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: typeof p = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: typeof p = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Distance between two boxes, 0 when they touch. */
function gap(a: { min: Vector3; max: Vector3 }, b: { min: Vector3; max: Vector3 }): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

/** Box volume, with each side at least 5 cm so flat items (a floor, a rug) don't count as tiny. */
function volume(it: { min: Vector3; max: Vector3 }): number {
  return Math.max(0.05, it.max.x - it.min.x) * Math.max(0.05, it.max.y - it.min.y) * Math.max(0.05, it.max.z - it.min.z);
}

function inBox(p: Vector3, it: Item, pad: number): boolean {
  return p.x > it.min.x - pad && p.x < it.max.x + pad && p.y > it.min.y - pad && p.y < it.max.y + pad && p.z > it.min.z - pad && p.z < it.max.z + pad;
}

function addTo(it: Item, s: Segment) {
  it.segs.push(s);
  it.min.minimizeInPlace(s.min);
  it.max.maximizeInPlace(s.max);
}

/** Group labelled pieces into items: same label and touching (2 cm), across materials. */
function groupItems(segs: Segment[]): Item[] {
  const byLabel = new Map<string, Segment[]>();
  for (const s of segs) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
  const items: Item[] = [];
  for (const [label, list] of byLabel) {
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) if (overlap(list[i].min, list[i].max, list[j].min, list[j].max, 0.02) > 0) parent[find(i)] = find(j);
    const groups = new Map<number, Item>();
    list.forEach((s, i) => {
      const r = find(i);
      let it = groups.get(r);
      if (!it) groups.set(r, (it = { label, segs: [], min: s.min.clone(), max: s.max.clone() }));
      addTo(it, s);
    });
    items.push(...groups.values());
  }
  return items;
}

/** Number items that share a label ("Cushion 1", "Cushion 2"), ordered across the room; sort by name. */
function nameItems(items: Item[]): Item[] {
  const byLabel = new Map<string, Item[]>();
  for (const it of items) byLabel.set(it.label, [...(byLabel.get(it.label) ?? []), it]);
  const out: Item[] = [];
  for (const [label, list] of byLabel) {
    list.sort((a, b) => a.min.x + a.max.x - (b.min.x + b.max.x) || a.min.z + a.max.z - (b.min.z + b.max.z));
    list.forEach((it, i) => out.push({ ...it, label: list.length > 1 ? `${label} ${i + 1}` : label }));
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** One mesh per item, one submesh per material, turned to the item's yaw, with its origin at the centre of its base. */
function buildItemMesh(scene: Scene, it: Item, matFor: (m: Material) => Material, made: Made): Mesh {
  const yaw = itemYaw(it);
  const rot = Matrix.RotationYawPitchRoll(yaw, 0, 0);
  const inv = Matrix.RotationYawPitchRoll(-yaw, 0, 0);
  // the item's box in its own frame, about the centre of its world box
  const pivot = new Vector3((it.min.x + it.max.x) / 2, 0, (it.min.z + it.max.z) / 2);
  const lmin = new Vector3(Infinity, Infinity, Infinity);
  const lmax = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  for (const s of it.segs)
    for (let i = 0; i < s.pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(s.pos[i] - pivot.x, s.pos[i + 1], s.pos[i + 2] - pivot.z, inv, v);
      lmin.minimizeInPlace(v);
      lmax.maximizeInPlace(v);
    }
  const local0 = new Vector3((lmin.x + lmax.x) / 2, lmin.y, (lmin.z + lmax.z) / 2);
  const origin = Vector3.TransformCoordinates(local0, rot).addInPlace(pivot);
  const byMat = new Map<Material, Segment[]>();
  for (const s of it.segs) byMat.set(s.mat, [...(byMat.get(s.mat) ?? []), s]);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ranges: { mat: Material; start: number; count: number }[] = [];
  for (const [mat, list] of byMat) {
    const start = idx.length;
    for (const s of list) {
      const base = pos.length / 3;
      for (let i = 0; i < s.pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(s.pos[i] - origin.x, s.pos[i + 1] - origin.y, s.pos[i + 2] - origin.z, inv, v);
        pos.push(v.x, v.y, v.z);
        Vector3.TransformNormalFromFloatsToRef(s.nrm[i], s.nrm[i + 1], s.nrm[i + 2], inv, v);
        nrm.push(v.x, v.y, v.z);
      }
      uv.push(...s.uv);
      for (const i of s.idx) idx.push(i + base);
    }
    ranges.push({ mat: matFor(mat), start, count: idx.length - start });
  }
  const mesh = new Mesh(it.label, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.indices = idx;
  vd.applyToMesh(mesh);
  mesh.position.copyFrom(origin);
  mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, 0, 0);
  mesh.isPickable = false;
  if (ranges.length === 1) mesh.material = ranges[0].mat;
  else {
    const multi = new MultiMaterial(`${it.label} materials`, scene);
    multi.subMaterials = ranges.map((r) => r.mat);
    made.mats.push(multi);
    mesh.material = multi;
    mesh.subMeshes = [];
    ranges.forEach((r, i) => new SubMesh(i, 0, pos.length / 3, r.start, r.count, mesh));
  }
  return mesh;
}

/**
 * Materials as glTF should see them. Unlit glowing materials (LED strips,
 * screens, signs) become emissive ones, since glTF's unlit takes its colour
 * from the base colour, which these keep black. Normal maps are painted for
 * the preview's left-handed convention (invertNormalMapY); glTF's needs both
 * the red and green channels flipped, so during the export each material
 * carries a converted copy (swapped back afterwards, so shared textures such
 * as the fabric stay one image in the file).
 */
function exportMaterials(scene: Scene, made: Made): (m: Material) => Material {
  const cache = new Map<Material, Material>();
  const normals = new Map<Texture, Texture>();
  const convertNormal = (t: Texture): Texture => {
    let out = normals.get(t);
    if (out) return out;
    out = t;
    if (t instanceof DynamicTexture) {
      const src = t.getContext().canvas as HTMLCanvasElement;
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext("2d")!;
      g.drawImage(src, 0, 0);
      const img = g.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = 255 - img.data[i];
        img.data[i + 1] = 255 - img.data[i + 1];
      }
      g.putImageData(img, 0, 0);
      const d = new DynamicTexture(t.name, c, scene, true);
      d.update(false);
      d.gammaSpace = false;
      d.wrapU = t.wrapU;
      d.wrapV = t.wrapV;
      d.uScale = t.uScale;
      d.vScale = t.vScale;
      d.uOffset = t.uOffset;
      d.vOffset = t.vOffset;
      d.level = t.level;
      made.textures.push(d);
      out = d;
    }
    normals.set(t, out);
    return out;
  };
  return (m: Material) => {
    let out = cache.get(m);
    if (out) return out;
    out = m;
    if (m instanceof PBRMaterial && m.unlit) {
      const e = new PBRMaterial(m.name, scene);
      e.albedoColor = Color3.Black();
      e.albedoTexture = m.albedoTexture;
      e.useAlphaFromAlbedoTexture = m.useAlphaFromAlbedoTexture;
      e.emissiveColor = m.emissiveColor.clone();
      e.emissiveIntensity = m.emissiveIntensity;
      e.emissiveTexture = m.emissiveTexture;
      e.alpha = m.alpha;
      e.transparencyMode = m.transparencyMode;
      e.alphaCutOff = m.alphaCutOff;
      e.backFaceCulling = m.backFaceCulling;
      e.roughness = 1;
      e.metallic = 0;
      made.mats.push(e);
      out = e;
    } else if (m instanceof PBRMaterial && m.bumpTexture instanceof Texture) {
      const own = m.bumpTexture;
      m.bumpTexture = convertNormal(own);
      made.restore.push(() => (m.bumpTexture = own));
    }
    // every image gets a name in the file (the leaf atlas has none)
    for (const t of out.getActiveTextures()) if (!t.name) t.name = m.name;
    cache.set(m, out);
    return out;
  };
}
