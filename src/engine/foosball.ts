// The Game Room's foosball table in the page: its rods, ball and score counters,
// built at run time on the table's slots (world/props/foosball.ts) and found by
// role (world/roles.ts), never by how the room code builds them.

import { Mesh, Scene, TransformNode } from "@babylonjs/core";
import { Materials } from "../world/materials/library";
import { FoosballRod, buildFoosballBall, buildFoosballBeads, buildFoosballRod, setBeads } from "../world/props/foosball";
import { BALL_R, RODS, Team } from "../world/props/foosballSpec";
import { ROLE, find, findAll } from "../world/roles";
import { SlotMeta } from "../world/context";
import { Lighting } from "./lighting";

export class Foosball {
  /** the table's frame: the playfield's centre, X along it from red's goal, Z along the rods */
  readonly table: TransformNode;
  readonly rods: FoosballRod[] = [];
  readonly ball: Mesh;
  private beads = new Map<Team, Mesh>();

  constructor(scene: Scene, mats: Materials, lighting: Lighting) {
    const table = find(scene, ROLE.foosballTable) as TransformNode | null;
    if (!table) throw new Error("The house has no foosball table");
    this.table = table;
    const meshes: Mesh[] = [];
    for (const node of findAll(scene, ROLE.foosballRodSlot) as TransformNode[]) {
      const n = (node.metadata as SlotMeta).slot;
      const rod = buildFoosballRod(mats, node, n);
      this.rods[n - 1] = rod;
      meshes.push(...rod.meshes);
    }
    if (this.rods.length !== RODS.length || this.rods.some((r) => !r)) throw new Error("The foosball table is missing rods");
    this.ball = buildFoosballBall(mats, table);
    this.ball.position.set(0, BALL_R, 0);
    meshes.push(this.ball);
    for (const node of findAll(scene, ROLE.foosballCounter) as TransformNode[]) {
      const team: Team = (node.metadata as SlotMeta).slot === 1 ? "red" : "blue";
      const beads = buildFoosballBeads(mats, node, team);
      this.beads.set(team, beads);
      meshes.push(beads);
    }
    // moving parts don't cast the sun's shadow, which is drawn once
    lighting.addMeshes(meshes, []);
  }

  /** Show each team's score on its counter. */
  showScore(red: number, blue: number): void {
    const r = this.beads.get("red");
    const b = this.beads.get("blue");
    if (r) setBeads(r, "red", red);
    if (b) setBeads(b, "blue", blue);
  }

  /** Where things are, for tests. */
  describe() {
    const t = this.table.getAbsolutePosition();
    return {
      table: [t.x, t.y, t.z],
      rods: this.rods.map((r) => ({ slide: r.root.position.z, turn: r.root.rotation.z })),
      ball: this.ball.position.asArray(),
    };
  }
}
