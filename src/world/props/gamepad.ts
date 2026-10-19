// A game controller for the Game Room's TV: whoever holds one is a player at
// the TV (engine/gameTv.ts). Like the theatre's remotes it is built as meshes
// of its own on its spot on the coffee table, since it comes and goes at run
// time; the room keeps the spot (a slot), so the Blender files hold the spots,
// not the controllers. Its light bar has its player's colour, the colour of
// that player's part of the split screen.

import { Mesh, TransformNode } from "@babylonjs/core";
import { Geo, cylinder, softBox, sphere, xf } from "../geometry/geo";
import { MeshMeta, SlotMeta } from "../context";
import { Materials } from "../materials/library";
import { ROLE } from "../roles";

export interface Gamepad {
  root: TransformNode;
  meshes: Mesh[];
}

/** Each player's colour (player 1 at 0): the controller's light bar and their part of the screen. */
export const PLAYER_COLORS = ["#4fa8ff", "#ff5a6e", "#5ee08a", "#ffc53d"];

/**
 * Build controller n lying on its spot (a slot node whose front, -Z, faces the
 * player): grips towards them, turned a little as if just put down.
 */
export function buildGamepad(mats: Materials, spot: TransformNode, n: number): Gamepad {
  const scene = mats.scene;
  const sm = spot.metadata as SlotMeta;
  const label = `Game controller ${n}`;
  const lightKey = `gamepadLight:${n}`;
  if (!mats.has(lightKey)) mats.unlit(lightKey, { color: PLAYER_COLORS[(n - 1) % PLAYER_COLORS.length], intensity: 1.8 });
  const parts = new Map<string, Geo>();
  const g = (m: string) => {
    let geo = parts.get(m);
    if (!geo) parts.set(m, (geo = new Geo()));
    return geo;
  };
  // the body, and a grip either side reaching towards the player (-Z)
  g("black").add(softBox(0.15, 0.03, 0.075, 0.012), xf(0, 0.017, 0.005), label);
  for (const s of [-1, 1]) g("black").add(sphere(0.026, 10, 8), xf(s * 0.055, 0.017, -0.034, 0, 1, 0.7, 1.3), label);
  // thumbsticks, a d-pad and four face buttons on top
  for (const [x, z] of [
    [-0.03, -0.012],
    [0.03, -0.012],
  ])
    g("charcoal").add(cylinder(0.011, 0.01, 12), xf(x, 0.03, z), label);
  g("charcoal").add(softBox(0.022, 0.006, 0.008, 0.002), xf(-0.05, 0.034, 0.014), label);
  g("charcoal").add(softBox(0.008, 0.006, 0.022, 0.002), xf(-0.05, 0.034, 0.014), label);
  for (let i = 0; i < 4; i++) g("steel").add(cylinder(0.005, 0.004, 10), xf(0.05 + [0, 0.011, 0, -0.011][i], 0.03, 0.014 + [0.011, 0, -0.011, 0][i]), label);
  // the light bar along its top edge, towards the TV
  g(lightKey).add(softBox(0.06, 0.006, 0.006, 0.002), xf(0, 0.026, 0.043), label);

  const root = new TransformNode(label, scene);
  root.parent = spot;
  root.rotation.y = [0.16, -0.12, 0.08, -0.2][(n - 1) % 4];
  const meshes: Mesh[] = [];
  for (const [mat, geo] of parts) {
    const mesh = geo.build(`${label}:${mat}`, scene);
    mesh.parent = root;
    mesh.material = mats.get(mat);
    mesh.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label }], matKey: mat, kind: "dynamic", role: ROLE.gameTvController, slot: n } satisfies MeshMeta;
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
    meshes.push(mesh);
  }
  return { root, meshes };
}
