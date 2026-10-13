// Games-room furniture: pinball machines and bean bags (the air hockey table is
// in airHockey.ts, the foosball table in foosball.ts, the claw machine and its
// plush prizes in clawMachine.ts, the snack machine in snackMachine.ts).
// Each is built in a local frame with its base at m and its front (where the
// player stands) toward -Z.

import { Matrix, Vector3 } from "@babylonjs/core";
import { Geo, box, lathe, plane, softBox, sphere, torus, tube, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { makeCanvas } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { canvasMat } from "./tech";

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

/** Flat textured quad w x h in the local XY plane facing -Z, centred at m. */
function face(ctx: WorldCtx, z: Zone, mat: string, m: Matrix, w: number, h: number, label: string) {
  ctx.g(z, mat, { castShadow: false }).add(plane(w, h), m, label);
}

// ------------------------------------------------------------------ pinball

function pinballArt(ctx: WorldCtx, key: string, title: string, a: string, b: string, back: boolean): string {
  return canvasMat(
    ctx,
    key,
    (() => {
      const { canvas, ctx: c } = makeCanvas(back ? 512 : 384, back ? 400 : 700);
      const W = canvas.width;
      const H = canvas.height;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, a);
      g.addColorStop(1, b);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      if (back) {
        drawLeafEmblem(c, W / 2, H * 0.55, 150, "rgba(255,255,255,0.25)");
        c.fillStyle = "#ffe14d";
        c.font = "800 62px Nunito";
        c.textAlign = "center";
        c.fillText(title, W / 2, 88);
        c.fillStyle = "#111";
        c.fillRect(W / 2 - 120, H - 90, 240, 56);
        c.fillStyle = "#ff8a3d";
        c.font = "700 40px Montserrat";
        c.fillText("1,284,560", W / 2, H - 48);
      } else {
        c.strokeStyle = "rgba(255,255,255,0.7)";
        c.lineWidth = 6;
        c.beginPath();
        c.arc(W / 2, H * 0.42, W * 0.36, Math.PI, 0);
        c.stroke();
        for (const [x, y, rr, col] of [
          [W * 0.32, H * 0.3, 34, "#ff4fa3"],
          [W * 0.68, H * 0.3, 34, "#40e6ff"],
          [W * 0.5, H * 0.2, 34, "#ffe14d"],
        ] as [number, number, number, string][]) {
          c.fillStyle = col;
          c.beginPath();
          c.arc(x, y, rr, 0, Math.PI * 2);
          c.fill();
        }
        for (let i = 0; i < 6; i++) {
          c.fillStyle = i % 2 ? "#ffe14d" : "#ff4fa3";
          c.beginPath();
          c.moveTo(W * 0.25 + i * W * 0.1, H * 0.62);
          c.lineTo(W * 0.29 + i * W * 0.1, H * 0.66);
          c.lineTo(W * 0.25 + i * W * 0.1, H * 0.7);
          c.lineTo(W * 0.21 + i * W * 0.1, H * 0.66);
          c.fill();
        }
        c.fillStyle = "#f4f2ee";
        c.fillRect(W * 0.24, H * 0.86, W * 0.18, 12);
        c.fillRect(W * 0.58, H * 0.86, W * 0.18, 12);
        c.fillStyle = "#ffe14d";
        c.font = "800 38px Nunito";
        c.textAlign = "center";
        c.fillText(title, W / 2, H * 0.52);
      }
      return canvas;
    })(),
    back ? 1.25 : 1.0,
  );
}

/** Pinball machine: legs, a sloping playfield under glass, the lit backbox. Base at m, the player at -Z. */
export function pinball(ctx: WorldCtx, z: Zone, m: Matrix, title: string, body: string, a: string, b: string): void {
  mats(ctx);
  const label = `Pinball machine: ${title}`;
  const W = 0.72;
  const L = 1.3;
  const yF = 0.86;
  const yB = 1.02;
  const slope = Math.atan2(yB - yF, L);
  // legs
  const legs = new Geo();
  for (const sx of [-1, 1]) {
    legs.add(box(0.06, yF - 0.18, 0.06), xf(sx * (W / 2 - 0.05), (yF - 0.18) / 2, -L / 2 + 0.08));
    legs.add(box(0.06, yB - 0.18, 0.06), xf(sx * (W / 2 - 0.05), (yB - 0.18) / 2, L / 2 - 0.08));
  }
  ctx.g(z, "gunmetal").add(legs, m, label);
  // cabinet sloping up toward the back
  const cab = xf(0, (yF + yB) / 2 - 0.12, 0, 0, 1, 1, 1, -slope).multiply(m);
  ctx.g(z, body).add(box(W, 0.3, L), cab, label);
  ctx.g(z, "chrome").add(new Geo().add(box(W + 0.02, 0.03, 0.08), xf(0, 0.16, -L / 2 + 0.04)), cab, "Lockdown bar");
  const field = pinballArt(ctx, `pinField:${title}`, title, a, b, false);
  ctx.g(z, field, { castShadow: false }).add(new Geo().add(plane(W - 0.08, L - 0.12), xf(0, 0, 0, 0, 1, 1, 1, Math.PI / 2)), xf(0, 0.135, 0.02).multiply(cab), label);
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(W - 0.06, 0.006, L - 0.1), xf(0, 0.152, 0.02).multiply(cab), label);
  for (const s of [-1, 1]) ctx.g(z, "arcadeRed").add(tube([new Vector3(s * (W / 2), 0.05, -L / 2 + 0.16), new Vector3(s * (W / 2 + 0.02), 0.05, -L / 2 + 0.16)], 0.018, 10, true), cab, "Flipper button");
  ctx.g(z, "chrome").add(new Geo().add(tube([new Vector3(0, 0, 0), new Vector3(0, 0, -0.12)], 0.012, 8)).add(sphere(0.022, 10, 8), xf(0, 0, -0.12)), xf(W / 2 - 0.08, 0.02, -L / 2).multiply(cab), "Plunger");
  // backbox
  const bb = xf(0, yB + 0.08 + 0.4, L / 2 - 0.13).multiply(m);
  ctx.g(z, body).add(box(W, 0.8, 0.22), bb, label);
  const art = pinballArt(ctx, `pinBack:${title}`, title, a, b, true);
  ctx.mats.glowing.add(art);
  face(ctx, z, art, xf(0, 0.02, -0.112).multiply(bb), W - 0.08, 0.62, label);
  ctx.g(z, "chrome").add(box(W + 0.01, 0.04, 0.23), xf(0, -0.41, 0).multiply(bb));
}

// ------------------------------------------------------------------ bean bag

/** Bean bag slumped into a seat, back toward +Z. Base at m. */
export function beanBag(ctx: WorldCtx, z: Zone, m: Matrix, mat: string): void {
  const prof: [number, number][] = [
    [0.001, 0],
    [0.42, 0.02],
    [0.48, 0.14],
    [0.46, 0.3],
    [0.36, 0.48],
    [0.2, 0.6],
    [0.001, 0.63],
  ];
  ctx.g(z, mat).add(lathe(prof, 28), xf(0, 0, 0, 0, 1, 1, 0.92).multiply(m), "Bean bag");
  // the seat hollow and the raised back
  ctx.g(z, mat).add(softBox(0.62, 0.22, 0.42, 0.1, 0.06), xf(0, 0.48, 0.18, 0, 1, 1, 1, -0.35).multiply(m), "Bean bag");
  ctx.g(z, "white").add(torus(0.05, 0.006, 12, 4), xf(0.33, 0.33, -0.25, 0.6, 1, 1, 1, Math.PI / 2).multiply(m));
}

