// Games-room furniture: bean bags (the air hockey table is in airHockey.ts, the
// foosball table in foosball.ts, the claw machine and its plush prizes in
// clawMachine.ts, the snack machine in snackMachine.ts, the pinball machines in
// pinball.ts).
// Each is built in a local frame with its base at m and its front (where the
// player stands) toward -Z.

import { Matrix } from "@babylonjs/core";
import { lathe, softBox, torus, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { seat } from "./seats";

/** The games room's shared colours and neons, which its other builders and the room itself use too. */
function mats(ctx: WorldCtx) {
  const add = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
  };
  add("arcadePink", { color: "#e2407e", rough: 0.35, clearCoat: 0.5 });
  add("arcadeBlue", { color: "#2a5bd7", rough: 0.35, clearCoat: 0.5 });
  add("arcadeRed", { color: "#d6322b", rough: 0.35, clearCoat: 0.5 });
  add("arcadeYellow", { color: "#f2c230", rough: 0.4 });
  add("arcadeWhite", { color: "#f4f2ee", rough: 0.25, clearCoat: 0.6 });
  add("plushBrown", { color: "#6b4a33", rough: 0.95 });
  add("plushTan", { color: "#d9b48f", rough: 0.95 });
  add("bananaYellow", { color: "#f2c94c", rough: 0.55 });
  add("feltGreen", { color: "#2e7d4f", rough: 0.9 });
  add("gunmetal", { color: "#3a3d42", rough: 0.32, metal: 0.85 });
  if (!ctx.mats.has("neonPink")) ctx.mats.unlit("neonPink", { color: "#ff4fa3", intensity: 1.8 });
  if (!ctx.mats.has("neonCyan")) ctx.mats.unlit("neonCyan", { color: "#40e6ff", intensity: 1.8 });
  ctx.mats.glowing.add("neonPink");
  ctx.mats.glowing.add("neonCyan");
}

// ------------------------------------------------------------------ bean bag

/** Bean bag slumped into a seat, back toward +Z. Base at m. */
export function beanBag(ctx: WorldCtx, z: Zone, m: Matrix, mat: string): void {
  mats(ctx);
  // a low bag, its top sunk into a shallow hollow where it is sat on
  const prof: [number, number][] = [
    [0.001, 0],
    [0.42, 0.02],
    [0.48, 0.12],
    [0.47, 0.21],
    [0.41, 0.28],
    [0.3, 0.312],
    [0.15, 0.302],
    [0.001, 0.3],
  ];
  ctx.g(z, mat).add(lathe(prof, 28), xf(0, 0, 0, 0, 1, 1, 0.92).multiply(m), "Bean bag");
  // the raised back, slumped back from the hollow
  ctx.g(z, mat).add(softBox(0.62, 0.34, 0.28, 0.12, 0.06), xf(0, 0.44, 0.27, 0, 1, 1, 1, -0.4).multiply(m), "Bean bag");
  ctx.g(z, "white").add(torus(0.05, 0.006, 12, 4), xf(0.33, 0.2, -0.29, 0.6, 1, 1, 1, Math.PI / 2).multiply(m));
  // sunk into its hollow, leaning back into the raised back
  seat(ctx, z, xf(0, 0.3, -0.02).multiply(m), { kind: "beanBag", height: 0.3, recline: 0.45, legs: "down" }, "Bean bag");
}

