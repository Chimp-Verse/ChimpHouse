import { AbstractMesh, Matrix, Mesh, Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { Geo, plane } from "./geometry/geo";
import { Leaf, LEAF_ASPECT, leafUV } from "./materials/leaves";
import { Materials } from "./materials/library";

export type Level = "lower" | "upper" | "roof" | "site";

export interface Zone {
  room: string;
  roomName: string;
  level: Level;
}

export interface PartOpts {
  castShadow?: boolean;
  receiveShadow?: boolean;
  pickable?: boolean;
}

export interface MeshMeta {
  room: string;
  roomName: string;
  level: Level;
  labels: { face: number; label: string }[];
  /** first face of each piece added to a merged mesh, and of those without a label of their own (see Geo.pieces) */
  pieces?: number[];
  loose?: number[];
  /** each piece's turn about the vertical, NaN when unknown (see Geo.yaws) */
  yaws?: number[];
  matKey: string;
  /** "dynamic": added and removed at run time (a game's cabinet), so solid but never part of the room's export */
  /** "lift": a part of the lift that moves (the car, its doors): solid where it is now, see engine/collision.ts */
  /** "moving": a machine's moving part built at run time (a puck, a flipper, a rod): never solid, never part of the room's export */
  kind?: "leaves" | "special" | "dynamic" | "lift" | "moving";
  /** what the client attaches behaviour to (see roles.ts), with its slot number when it fills one */
  role?: string;
  slot?: number;
}

/**
 * A named place in a room that is filled at run time (a cabinet slot): an empty
 * node at the place, turned the way its contents face (-Z, as items are built).
 * The client finds it by role and slot number alone; the room export carries the
 * same fields, so the Blender files hold the slots instead of what fills them.
 */
export interface SlotMeta {
  role: string;
  slot: number;
  room: string;
  roomName: string;
  level: Level;
  label: string;
  /** where a visitor stands to use what fills the slot: a floor point in the slot's own space (its front is -Z) */
  stand: [number, number, number];
}

const ROOM_NAMES: Record<string, string> = {
  entryHall: "Entry Hall & Atrium",
  arrivalLounge: "Arrival Lounge",
  gameRoom: "ChimpVibe Game Room",
  tradingRoom: "Trading Room",
  mixchimp: "MixChimp Studio",
  core: "Stair & Lift",
  bathroom: "Bathroom",
  gallery: "Gallery & Stair Landing",
  showroom: "Community Builds Showroom",
  theatre: "Theatre",
  barLounge: "Bar & Lounge",
  poolTerrace: "Pool Terrace",
  sideEntrance: "Side Entrance",
  exterior: "Exterior",
  structure: "Structure",
  roofs: "Roofs",
  trees: "Living Trees",
  approach: "Front Approach",
  courtyard: "Front Courtyard",
  bridge: "Canopy Bridge",
  jungle: "Jungle",
  landscape: "Landscape",
  sky: "Sky",
};

/** Inspect label of a mesh face: "Level › Room › Object". */
export function faceLabel(mesh: AbstractMesh, face: number): string {
  const md = mesh.metadata as MeshMeta | undefined;
  if (!md) return mesh.name;
  let l = md.labels[0]?.label ?? mesh.name;
  for (const entry of md.labels) {
    if (entry.face <= face) l = entry.label;
    else break;
  }
  const lvl = md.level === "lower" ? "Lower" : md.level === "upper" ? "Upper" : md.level === "roof" ? "Roof" : "Site";
  return `${lvl} › ${md.roomName} › ${l}`;
}

export function zone(room: string, level: Level): Zone {
  return { room, roomName: ROOM_NAMES[room] ?? room, level };
}

export interface LightDef {
  pos: Vector3;
  color: string;
  day: number;
  night: number;
  range: number;
  rooms: string[];
  level: Level;
  kind?: "point" | "spot";
  dir?: Vector3;
  angle?: number;
}

interface Part {
  geo: Geo;
  zone: Zone;
  mat: string;
  opts: PartOpts;
}

interface LeafBucket {
  type: Leaf;
  zone: Zone;
  matrices: number[];
}

/**
 * Collects all generated geometry. Geometry is bucketed per (room, level,
 * material) so each bucket becomes one mesh; labels survive for picking.
 */
export class WorldCtx {
  private parts = new Map<string, Part>();
  private leafBuckets = new Map<string, LeafBucket>();
  readonly meshes: Mesh[] = [];
  readonly shadowCasters: AbstractMesh[] = [];
  readonly glowMeshes: Mesh[] = [];
  readonly animators: ((t: number, dt: number) => void)[] = [];
  readonly lights: LightDef[] = [];
  /** slots filled at run time (see `slot`) */
  readonly slots: TransformNode[] = [];
  /** meshes that only show at night (e.g. fireflies) or day */
  readonly nightOnly: Mesh[] = [];
  private leafBase = new Map<Leaf, Geo>();

  constructor(
    readonly scene: Scene,
    readonly mats: Materials,
  ) {}

  /** Geometry bucket for a zone + material. */
  g(z: Zone, mat: string, opts: PartOpts = {}): Geo {
    const key = `${z.level}|${z.room}|${mat}|${opts.castShadow === false ? "n" : "s"}`;
    let p = this.parts.get(key);
    if (!p) {
      p = { geo: new Geo(), zone: z, mat, opts };
      p.geo.pieces = [];
      p.geo.loose = [];
      p.geo.yaws = [];
      this.parts.set(key, p);
    }
    return p.geo;
  }

  /** Add a prebuilt local Geo into a bucket with a transform and label. */
  put(z: Zone, mat: string, geo: Geo, m: Matrix | undefined, label: string, opts?: PartOpts): void {
    this.g(z, mat, opts).add(geo, m, label);
  }

  /** Register a standalone mesh (screens, water, animated things). */
  addMesh(mesh: Mesh, z: Zone, label: string, opts: PartOpts & { glow?: boolean } = {}): Mesh {
    mesh.metadata = { room: z.room, roomName: z.roomName, level: z.level, labels: [{ face: 0, label }], matKey: mesh.material?.name ?? "", kind: "special" } satisfies MeshMeta;
    mesh.receiveShadows = opts.receiveShadow !== false;
    mesh.isPickable = opts.pickable !== false;
    mesh.renderingGroupId = 1;
    if (opts.castShadow) this.shadowCasters.push(mesh);
    if (opts.glow) this.glowMeshes.push(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  /**
   * Add a screen with a role (see roles.ts): a w × h quad of its own, centred at m and
   * facing -Z, UVs 0..1 across it, where the client shows a video or a game. Unlike
   * the rest of the house it isn't merged by material, so code can find it by its role.
   */
  screen(z: Zone, role: string, m: Matrix, w: number, h: number, mat: string, label: string): Mesh {
    const mesh = plane(w, h).build(label, this.scene);
    const q = new Quaternion();
    m.decompose(undefined, q, mesh.position);
    mesh.rotationQuaternion = q;
    mesh.material = this.mats.get(mat);
    this.addMesh(mesh, z, label);
    mesh.metadata = { ...(mesh.metadata as MeshMeta), role };
    return mesh;
  }

  /** Add a slot: an empty node at m (position and turn) with its role and number, filled at run time; `stand` is in its own space. */
  slot(z: Zone, role: string, n: number, m: Matrix, stand: Vector3, label: string): TransformNode {
    const node = new TransformNode(label, this.scene);
    const q = new Quaternion();
    m.decompose(undefined, q, node.position);
    node.rotationQuaternion = q;
    node.metadata = { role, slot: n, room: z.room, roomName: z.roomName, level: z.level, label, stand: [stand.x, stand.y, stand.z] } satisfies SlotMeta;
    this.slots.push(node);
    return node;
  }

  private extraFence: { a: { x: number; z: number }; b: { x: number; z: number }; x0: number; x1: number; z0: number; z1: number; y0?: number; y1?: number }[] | null = null;

  /**
   * Run `fn` with extra fence lines (plan paths) that every leaf it adds must
   * stay inside of, whatever its zone: e.g. a deck railing for the planters beside it.
   * With `ys` the fence only applies to leaves based between those heights (a railing's glass).
   */
  withFence(paths: { x: number; z: number }[][], fn: () => void, ys?: [number, number]): void {
    const prev = this.extraFence;
    const list = [...(prev ?? [])];
    for (const path of paths)
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        list.push({ a, b, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), y0: ys?.[0], y1: ys?.[1] });
      }
    this.extraFence = list;
    try {
      fn();
    } finally {
      this.extraFence = prev;
    }
  }

  private walls: { a: { x: number; z: number }; b: { x: number; z: number }; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[] = [];

  /**
   * Register a wall, pane of glass or railing (plan path, from y0 up to y1) that
   * no leaf may reach through, whichever zone it belongs to: a leaf based within
   * that height band that would cross it is shortened to fit, or left out.
   */
  wall(path: { x: number; z: number }[], y0: number, y1: number): void {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      this.walls.push({ a, b, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), y0, y1 });
    }
  }

  /** Scale (0..1) that keeps a leaf clear of walls, glass and fences; 1 when nothing is in the way. */
  private fenceScale(type: Leaf, m: Matrix): number {
    const list = [...(this.extraFence ?? []), ...this.walls];
    if (!list.length) return 1;
    const w = LEAF_ASPECT[type];
    const local = [
      [0, 1, -0.15],
      [w / 2, 0.6, 0],
      [-w / 2, 0.6, 0],
      [w * 0.4, 0.85, -0.08],
      [-w * 0.4, 0.85, -0.08],
    ];
    const base = Vector3.TransformCoordinates(Vector3.Zero(), m);
    const tips = local.map(([x, y, zz]) => Vector3.TransformCoordinates(new Vector3(x, y, zz), m));
    const pad = 0.06;
    let bx0 = base.x;
    let bx1 = base.x;
    let bz0 = base.z;
    let bz1 = base.z;
    for (const t of tips) {
      bx0 = Math.min(bx0, t.x);
      bx1 = Math.max(bx1, t.x);
      bz0 = Math.min(bz0, t.z);
      bz1 = Math.max(bz1, t.z);
    }
    const near = (list as { x0: number; x1: number; z0: number; z1: number; y0?: number; y1?: number; a: { x: number; z: number }; b: { x: number; z: number } }[]).filter(
      (s) => s.x1 > bx0 - pad && s.x0 < bx1 + pad && s.z1 > bz0 - pad && s.z0 < bz1 + pad && (s.y0 === undefined || (base.y > s.y0 && base.y < (s.y1 ?? Infinity))),
    );
    if (!near.length) return 1;
    const segDist = (p: { x: number; z: number }) => {
      let best = Infinity;
      for (const s of near) {
        const dx = s.b.x - s.a.x;
        const dz = s.b.z - s.a.z;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / l2));
        best = Math.min(best, Math.hypot(p.x - s.a.x - dx * t, p.z - s.a.z - dz * t));
      }
      return best;
    };
    const crosses = (p: { x: number; z: number }) => {
      for (const s of near) {
        const d1 = (s.b.x - s.a.x) * (base.z - s.a.z) - (s.b.z - s.a.z) * (base.x - s.a.x);
        const d2 = (s.b.x - s.a.x) * (p.z - s.a.z) - (s.b.z - s.a.z) * (p.x - s.a.x);
        const d3 = (p.x - base.x) * (s.a.z - base.z) - (p.z - base.z) * (s.a.x - base.x);
        const d4 = (p.x - base.x) * (s.b.z - base.z) - (p.z - base.z) * (s.b.x - base.x);
        if (d1 * d2 < 0 && d3 * d4 < 0) return true;
      }
      return false;
    };
    const margin = Math.min(pad, segDist(base) * 0.9);
    const fits = (k: number) =>
      tips.every((t) => {
        const p = { x: base.x + (t.x - base.x) * k, z: base.z + (t.z - base.z) * k };
        return !crosses(p) && segDist(p) >= margin;
      });
    if (fits(1)) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Queue a leaf instance (thin instances per leaf type and zone). */
  leaf(z: Zone, type: Leaf, m: Matrix): void {
    const k = this.fenceScale(type, m);
    if (k < 0.4) return;
    if (k < 1) m = Matrix.Scaling(k, k, k).multiply(m);
    const key = `${z.level}|${z.room}|${type}`;
    let b = this.leafBuckets.get(key);
    if (!b) {
      b = { type, zone: z, matrices: [] };
      this.leafBuckets.set(key, b);
    }
    const a = m.asArray();
    for (let i = 0; i < 16; i++) b.matrices.push(a[i]);
  }

  /**
   * Leaf card geometry. The shape (a centre fold, linear across each half, and
   * a gentle curl along the length) and its smooth normals are computed on a
   * fine 4 x 6 grid; the card keeps only the vertices that define that shape
   * (both edges and the fold, every other row), with the fine grid's normals.
   * That is 16 triangles per leaf instead of 48, drawn the same; with tens of
   * thousands of leaves it is a large share of the frame.
   */
  private leafGeo(type: Leaf): Geo {
    let g = this.leafBase.get(type);
    if (g) return g;
    const fine = new Geo();
    const w = LEAF_ASPECT[type];
    const [u0, v0, u1, v1] = leafUV(type);
    const nx = 4;
    const ny = 6;
    const curl = type === Leaf.CanopyA || type === Leaf.CanopyB ? 0.08 : 0.18;
    const fold = type === Leaf.CanopyA || type === Leaf.CanopyB || type === Leaf.Twig ? 0.0 : 0.12;
    const grid: number[][] = [];
    for (let j = 0; j <= ny; j++) {
      const t = j / ny;
      const row: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const s = i / nx - 0.5;
        const x = s * w;
        const y = t;
        const z = curl * t * t + fold * Math.abs(s) * w;
        row.push(fine.vert(x, y, -z, u0 + (s + 0.5) * (u1 - u0), v0 + t * (v1 - v0)));
      }
      grid.push(row);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) fine.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
    fine.computeNormals();
    // the card: columns 0, 2, 4 (edges and fold) and rows 0, 2, 4, 6, with the fine normals
    g = new Geo();
    const cols = [0, 2, 4];
    const rows = [0, 2, 4, 6];
    const at: number[][] = rows.map((j) =>
      cols.map((i) => {
        const k = grid[j][i];
        return g!.vert(fine.pos[k * 3], fine.pos[k * 3 + 1], fine.pos[k * 3 + 2], fine.uv[k * 2], fine.uv[k * 2 + 1], fine.nrm[k * 3], fine.nrm[k * 3 + 1], fine.nrm[k * 3 + 2]);
      }),
    );
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols.length - 1; i++) g.quad(at[j][i], at[j][i + 1], at[j + 1][i + 1], at[j + 1][i]);
    this.leafBase.set(type, g);
    return g;
  }


  finalize(): void {
    for (const [key, p] of this.parts) {
      if (p.geo.vertexCount === 0) continue;
      const mesh = p.geo.build(`${p.zone.room}:${p.mat}`, this.scene);
      mesh.material = this.mats.get(p.mat);
      mesh.metadata = { room: p.zone.room, roomName: p.zone.roomName, level: p.zone.level, labels: p.geo.labels, pieces: p.geo.pieces ?? undefined, loose: p.geo.loose ?? undefined, yaws: p.geo.yaws ?? undefined, matKey: p.mat } satisfies MeshMeta;
      mesh.receiveShadows = p.opts.receiveShadow !== false;
      mesh.isPickable = p.opts.pickable !== false;
      if (p.opts.castShadow !== false && p.mat !== "glass" && p.mat !== "glassRail" && p.mat !== "glassBooth") this.shadowCasters.push(mesh);
      if (this.mats.glowing.has(p.mat)) this.glowMeshes.push(mesh);
      mesh.renderingGroupId = 1;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      this.meshes.push(mesh);
      void key;
    }
    this.parts.clear();
    for (const b of this.leafBuckets.values()) {
      const mesh = this.leafGeo(b.type).build(`${b.zone.room}:leaves:${Leaf[b.type]}`, this.scene);
      mesh.material = this.mats.get("leaves");
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(b.matrices), 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.metadata = { room: b.zone.room, roomName: b.zone.roomName, level: b.zone.level, labels: [{ face: 0, label: `Plants (${Leaf[b.type]})` }], matKey: "leaves", kind: "leaves" } satisfies MeshMeta;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      this.shadowCasters.push(mesh);
      mesh.freezeWorldMatrix();
      this.meshes.push(mesh);
    }
    this.leafBuckets.clear();
  }
}

export function v3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

export { ROOM_NAMES };
