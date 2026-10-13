// The Game Room's air hockey table (world/props/airHockey.ts). The table, its
// playfield, its ends and its scoreboard are found by role; the mallets and the
// puck are built on the table at run time.

import { Mesh, Scene, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { Materials } from "../world/materials/library";
import { AirHockeyPieces, buildAirHockeyPieces } from "../world/props/airHockey";
import { ROLE, find } from "../world/roles";
import { Lighting } from "./lighting";

/** The playfield in the table's own space: its centre, half-sizes along X and Z, and its height. */
export interface Playfield {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  y: number;
}

/** The playfield's bounds in the table's space, read from its mesh. */
function readPlayfield(table: TransformNode, surface: Mesh): Playfield {
  const inv = table.computeWorldMatrix(true).clone().invert();
  const wm = surface.computeWorldMatrix(true).multiply(inv);
  const P = surface.getVerticesData(VertexBuffer.PositionKind) ?? [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let y = 0;
  const v = new Vector3();
  for (let i = 0; i < P.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(P[i], P[i + 1], P[i + 2], wm, v);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    z0 = Math.min(z0, v.z);
    z1 = Math.max(z1, v.z);
    y = v.y;
  }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y };
}

export class AirHockey {
  readonly table: TransformNode | null;
  readonly field: Playfield | null = null;
  private pieces: AirHockeyPieces | null = null;

  constructor(
    scene: Scene,
    mats: Materials,
    lighting: Lighting,
  ) {
    const table = find(scene, ROLE.airHockeyTable);
    const surface = find(scene, ROLE.airHockeySurface);
    this.table = table instanceof TransformNode ? table : null;
    if (!this.table || !(surface instanceof Mesh)) return;
    this.table.computeWorldMatrix(true);
    this.field = readPlayfield(this.table, surface);
    this.pieces = buildAirHockeyPieces(mats, this.table);
    lighting.addMeshes(this.pieces.meshes, []);
    this.rest();
  }

  /** The pieces where they wait between games: each mallet near its own goal, the puck on the centre spot. */
  private rest(): void {
    const f = this.field;
    const p = this.pieces;
    if (!f || !p) return;
    p.mallets[0].position.set(f.cx - f.hx * 0.78, f.y, f.cz + 0.12);
    p.mallets[1].position.set(f.cx + f.hx * 0.72, f.y, f.cz - 0.18);
    p.puck.position.set(f.cx + 0.16, f.y, f.cz + 0.09);
  }

  /** Where the table is in the world: its base, and the turn of its long axis. */
  where(): { at: number[]; yaw: number } | null {
    if (!this.table) return null;
    const m = this.table.computeWorldMatrix(true);
    const at = Vector3.TransformCoordinates(Vector3.Zero(), m);
    const ax = Vector3.TransformNormal(Vector3.Right(), m);
    return { at: at.asArray(), yaw: Math.atan2(-ax.z, ax.x) };
  }
}
