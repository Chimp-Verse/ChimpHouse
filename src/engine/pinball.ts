// The Game Room's two pinball machines in the page: their moving parts, lamps
// and displays, attract mode while nobody plays, and playing one.
//
// Machines are found by role and slot (world/roles.ts): the playfield node
// (pinball-machine) carries the moving parts, the display (pinball-dmd) shows
// the score. The table each runs is its definition (world/props/pinballTables.ts).

import { Mesh, Scene, TransformNode } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { PinballParts, buildPinballParts } from "../world/props/pinball";
import { TABLES, TableDef, tableName } from "../world/props/pinballTables";
import { ROLE, find, findAll } from "../world/roles";
import { Dmd, DMD_W } from "./pinballDmd";
import { FlyCamera } from "./flyCamera";
import { Lighting } from "./lighting";

/** How near (m) the camera must be for a machine's attract mode to run. */
const ATTRACT_NEAR = 9;

interface Machine {
  def: TableDef;
  node: TransformNode;
  parts: PinballParts;
  dmd: Dmd;
  /** attract mode's clock and the last lamp step drawn */
  t: number;
  step: number;
}

export class Pinball {
  readonly machines: Machine[] = [];

  constructor(
    scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
  ) {
    for (const node of findAll(scene, ROLE.pinballMachine)) {
      if (!(node instanceof TransformNode)) continue;
      const n = (node.metadata as SlotMeta).slot;
      const def = TABLES.find((t) => t.slot === n);
      const screen = find(scene, ROLE.pinballDmd, n);
      if (!def || !(screen instanceof Mesh)) continue;
      node.computeWorldMatrix(true);
      const parts = buildPinballParts(mats, node, def);
      lighting.addMeshes(parts.meshes, []);
      const dmd = new Dmd(mats, screen, `pin${n}:dmd`, def.theme.dmd);
      this.machines.push({ def, node, parts, dmd, t: Math.random() * 10, step: -1 });
    }
  }

  /** Each frame: attract mode on the machines near the camera. */
  update(dt: number): void {
    const cam = this.fly.camera.position;
    for (const m of this.machines) {
      if (m.node.getAbsolutePosition().subtract(cam).length() > ATTRACT_NEAR) continue;
      m.t += dt;
      this.attract(m);
    }
  }

  /** Attract mode: the lamps chase, and the display cycles its pages. */
  private attract(m: Machine): void {
    const step = Math.floor(m.t * 8);
    if (step === m.step) return;
    m.step = step;
    const { lamps } = m.parts;
    const n = lamps.names.length;
    const phase = Math.floor(step / 48) % 3;
    for (let i = 0; i < n; i++) {
      let on: boolean;
      if (phase === 0) on = (i + step) % 6 < 2;
      else if (phase === 1) on = step % 4 < 2 ? i % 2 === 0 : i % 2 === 1;
      else on = (i * 7 + step) % 11 < 4;
      lamps.set(i, on);
    }
    lamps.flush();
    if (step % 2) return;
    const d = m.dmd;
    d.clear();
    const page = Math.floor(m.t / 4) % 4;
    const name = m.def.title;
    if (page === 0) d.fit(name, DMD_W / 2, 16, 20, 124);
    else if (page === 1) {
      d.text("PRESS START", DMD_W / 2, 10, 9);
      d.text("WALK UP AND PRESS E", DMD_W / 2, 24, 6, { shade: 0.7 });
    } else if (page === 2) {
      d.text("HIGH SCORE", DMD_W / 2, 9, 7, { shade: 0.7 });
      d.text("1,000,000", DMD_W / 2, 23, 12);
    } else {
      const x = DMD_W + 10 - ((m.t % 4) / 4) * (DMD_W + 220);
      d.text(`${tableName(m.def).toUpperCase()}  ·  CHIMPHOUSE ARCADE`, x, 16, 9, { align: "left" });
    }
    d.present();
  }
}
