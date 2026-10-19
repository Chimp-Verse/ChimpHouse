// A remote: whoever holds it controls a screen, the theatre's
// (engine/remotes.ts) or the Game Room's TV (engine/gameTv.ts). Like an arcade cabinet it is built as meshes of its own
// on its spot on the stand, since it comes and goes at run time; the room keeps
// the spot (a slot), so the Blender files hold the spots, not the remotes.

import { Mesh, TransformNode } from "@babylonjs/core";
import { Geo, cylinder, softBox, xf } from "../geometry/geo";
import { MeshMeta, SlotMeta } from "../context";
import { Materials } from "../materials/library";
import { ROLE } from "../roles";

export interface Remote {
  root: TransformNode;
  meshes: Mesh[];
}

/**
 * Build remote n lying on its spot (a slot node whose front, -Z, faces the
 * viewer): its long side towards the viewer, turned a little as if just put down.
 */
export function buildRemote(mats: Materials, spot: TransformNode, n: number, o: { label?: string; role?: string } = {}): Remote {
  const scene = mats.scene;
  const sm = spot.metadata as SlotMeta;
  const label = o.label ?? `Theatre remote ${n}`;
  const parts = new Map<string, Geo>();
  const g = (m: string) => {
    let geo = parts.get(m);
    if (!geo) parts.set(m, (geo = new Geo()));
    return geo;
  };
  // the body, buttons on top; its top end (+Z) points at the screen
  g("black").add(softBox(0.05, 0.022, 0.17, 0.009), xf(0, 0.011, 0), label);
  g("red").add(cylinder(0.006, 0.004, 12), xf(0, 0.021, 0.064), label);
  g("charcoal").add(cylinder(0.016, 0.003, 20), xf(0, 0.021, 0.025), label);
  g("steel").add(cylinder(0.006, 0.005, 12), xf(0, 0.021, 0.025), label);
  for (let i = 0; i < 6; i++) g("charcoal").add(cylinder(0.005, 0.003, 10), xf((i % 2 ? 1 : -1) * 0.011, 0.021, -0.018 - Math.floor(i / 2) * 0.02), label);

  const root = new TransformNode(label, scene);
  root.parent = spot;
  root.rotation.y = n % 2 ? 0.22 : -0.18;
  const meshes: Mesh[] = [];
  for (const [mat, geo] of parts) {
    const mesh = geo.build(`${label}:${mat}`, scene);
    mesh.parent = root;
    mesh.material = mats.get(mat);
    mesh.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label }], matKey: mat, kind: "dynamic", role: o.role ?? ROLE.theatreRemote, slot: n } satisfies MeshMeta;
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
    meshes.push(mesh);
  }
  return { root, meshes };
}
