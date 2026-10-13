// The Game Room's snack machine, CHIMP CHOMP (world/props/snackMachine.ts): its
// coils and the snacks on them, shown from the machine's state
// (engine/snackState.ts).
//
// The machine, its coils, keys, display, bin and flap are found by role and slot
// (world/roles.ts), never by how the room builds them. The coils and the packs
// are thin instances, a mesh for the coils and one per brand, so the whole stock
// costs a dozen draw calls and moving a snack is a matrix.

import { Color3, Matrix, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { COIL_CAPACITY, PACK_SIZE, SNACK, SnackStockMeshes, buildSnackStock, coilCode, snackBrand } from "../world/props/snackMachine";
import { ROLE, find, findAll } from "../world/roles";
import { Lighting } from "./lighting";
import { COILS, PLANOGRAM, SnackState, initialSnacks } from "./snackState";

/** A small, steady wobble per pack so a coil's snacks don't stand like soldiers. */
function jitter(code: string, k: number): { yaw: number; lean: number } {
  let h = k * 2654435761;
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 2246822519);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  return { yaw: (a - 0.5) * 0.12, lean: -0.04 - b * 0.08 };
}

export class SnackMachine {
  private machine: TransformNode;
  /** each coil's frame in the machine's, by code */
  private coilAt = new Map<string, Matrix>();
  private stock: SnackStockMeshes;
  private state: SnackState = initialSnacks(COIL_CAPACITY);
  private night: boolean | null = null;

  constructor(
    scene: Scene,
    mats: Materials,
    lighting: Lighting,
  ) {
    const machine = find(scene, ROLE.snackMachine, 1);
    if (!(machine instanceof TransformNode)) throw new Error("The house has no snack machine");
    this.machine = machine;
    const inv = machine.computeWorldMatrix(true).clone().invert();
    for (const n of findAll(scene, ROLE.snackCoil)) {
      if (!(n instanceof TransformNode)) continue;
      this.coilAt.set(coilCode((n.metadata as SlotMeta).slot), n.computeWorldMatrix(true).multiply(inv));
    }
    this.stock = buildSnackStock(mats, machine, this.coilAt.size);
    // not lit by the room's lamps: they're behind glass in a cabinet, and the room is past its lights per material already
    void lighting;
    this.update(false);
    this.showCoils();
    this.showPacks();
  }

  /** Each frame: the snacks glow a little more at night, lit by the cabinet's tubes when the room is dark. */
  update(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    const glow = new Color3(1, 1, 1).scale(night ? 0.42 : 0.04);
    for (const mesh of this.stock.packs.values()) (mesh.material as PBRMaterial).emissiveColor = glow;
  }

  /** The machine's base in the world, the way its front faces (unit, flat), and where a visitor stands to use it. */
  where(): { base: number[]; front: number[]; stand: number[] } {
    const wm = this.machine.computeWorldMatrix(true);
    const f = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize();
    return { base: this.machine.getAbsolutePosition().asArray(), front: f.asArray(), stand: Vector3.TransformCoordinates(Vector3.FromArray((this.machine.metadata as SlotMeta).stand), wm).asArray() };
  }

  /** The coils, each at its slot, turned to where it rests. */
  private showCoils(): void {
    const buf = new Float32Array(this.coilAt.size * 16);
    [...this.coilAt.values()].forEach((m, i) => m.copyToArray(buf, i * 16));
    this.stock.coils.thinInstanceSetBuffer("matrix", buf, 16, false);
  }

  /** Every pack where the state has it: on its coil, one per turn from the front. */
  private showPacks(): void {
    const per = new Map<string, number[]>();
    const tmp = new Matrix();
    for (const code of COILS) {
      const coil = this.coilAt.get(code);
      if (!coil) continue;
      const brand = snackBrand(PLANOGRAM[code]);
      const { h } = PACK_SIZE[brand.kind];
      const list = per.get(brand.id) ?? [];
      per.set(brand.id, list);
      for (let k = 0; k < this.state.stock[code]; k++) {
        const j = jitter(code, k);
        const local = Matrix.RotationYawPitchRoll(j.yaw, j.lean, 0).multiply(Matrix.Translation(0, -SNACK.coilR + h / 2 + 0.001, SNACK.pitch * (k + 0.5)));
        local.multiplyToRef(coil, tmp);
        list.push(...tmp.asArray());
      }
    }
    for (const [id, mesh] of this.stock.packs) {
      const list = per.get(id) ?? [];
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(list), 16, false);
      mesh.setEnabled(list.length > 0);
    }
  }
}
