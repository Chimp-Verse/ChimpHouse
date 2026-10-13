// Games-room furniture: a claw machine full of plush chimps and bananas, a
// snack vending machine, pinball machines and bean bags (the air hockey table
// is in airHockey.ts, the foosball table in foosball.ts).
// Each is built in a local frame with its base at m and its front (where the
// player stands) toward -Z.

import { Matrix, Vector3 } from "@babylonjs/core";
import { Geo, box, cylinder, lathe, plane, softBox, sphere, torus, tube, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { makeCanvas } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { canvasMat } from "./tech";
import type { Rand } from "./plants";

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

// ------------------------------------------------------------------ claw machine

/** Claw machine full of plush chimps and bananas, 0.9 m square, 2.0 m tall. Base at m, front -Z. */
export function clawMachine(ctx: WorldCtx, z: Zone, m: Matrix, r: Rand): void {
  mats(ctx);
  const label = "Claw machine";
  const S = 0.9;
  const base = 0.85;
  const glassH = 0.9;
  ctx.g(z, "arcadePink").add(box(S, base, S), xf(0, base / 2, 0).multiply(m), label);
  ctx.g(z, "neonCyan").add(box(S + 0.01, 0.025, S + 0.01), xf(0, base - 0.02, 0).multiply(m), label);
  // prize chute and control deck on the front
  ctx.g(z, "black").add(box(0.3, 0.26, 0.02), xf(0.22, 0.4, -S / 2 - 0.005).multiply(m), "Prize chute");
  ctx.g(z, "arcadeWhite").add(box(S, 0.06, 0.22), xf(0, base - 0.05, -S / 2 - 0.1).multiply(m), label);
  ctx.g(z, "black").add(new Geo().add(cylinder(0.035, 0.02, 12)).add(cylinder(0.008, 0.1, 6), xf(0, 0.02, 0)).add(sphere(0.022, 10, 8), xf(0, 0.12, 0)), xf(-0.18, base - 0.02, -S / 2 - 0.1).multiply(m), "Joystick");
  ctx.g(z, "arcadeRed").add(cylinder(0.035, 0.02, 14), xf(0.12, base - 0.02, -S / 2 - 0.1).multiply(m), "Button");
  // glass box: corner posts, glass, roof and lit header
  const posts = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.add(box(0.04, glassH, 0.04), xf(sx * (S / 2 - 0.02), base + glassH / 2, sz * (S / 2 - 0.02)));
  ctx.g(z, "chrome").add(posts, m, label);
  const glass = new Geo();
  for (const s of [-1, 1]) {
    glass.add(box(S - 0.06, glassH, 0.008), xf(0, base + glassH / 2, s * (S / 2 - 0.02)));
    glass.add(box(0.008, glassH, S - 0.06), xf(s * (S / 2 - 0.02), base + glassH / 2, 0));
  }
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(glass, m, label);
  ctx.g(z, "arcadePink").add(box(S + 0.02, 0.28, S + 0.02), xf(0, base + glassH + 0.14, 0).multiply(m), label);
  const header = canvasMat(
    ctx,
    "clawHeader",
    (() => {
      const { canvas, ctx: c } = makeCanvas(512, 140);
      c.fillStyle = "#1b1030";
      c.fillRect(0, 0, 512, 140);
      for (let i = 0; i < 18; i++) {
        c.fillStyle = i % 2 ? "#ffd54a" : "#ff4fa3";
        c.beginPath();
        c.arc(14 + i * 28.5, 12, 6, 0, Math.PI * 2);
        c.arc(14 + i * 28.5, 128, 6, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = "#40e6ff";
      c.font = "800 66px Nunito";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("CHIMP CLAW", 256, 72);
      return canvas;
    })(),
    1.3,
  );
  ctx.mats.glowing.add(header);
  face(ctx, z, header, xf(0, base + glassH + 0.14, -S / 2 - 0.012).multiply(m), S - 0.04, 0.25, label);
  // gantry and claw
  ctx.g(z, "chrome").add(box(S - 0.06, 0.03, 0.04), xf(0, base + glassH - 0.04, 0.05).multiply(m), "Claw gantry");
  const clawTop = new Vector3(0.12, base + glassH - 0.06, 0.05);
  const cm = xf(clawTop.x, 0, clawTop.z).multiply(m);
  ctx.g(z, "chrome").add(new Geo().add(cylinder(0.004, 0.32, 4), xf(0, clawTop.y - 0.32, 0)).add(cylinder(0.04, 0.05, 12), xf(0, clawTop.y - 0.37, 0)), cm, "Claw");
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p0 = new Vector3(Math.cos(a) * 0.03, clawTop.y - 0.37, Math.sin(a) * 0.03);
    const p1 = new Vector3(Math.cos(a) * 0.08, clawTop.y - 0.45, Math.sin(a) * 0.08);
    const p2 = new Vector3(Math.cos(a) * 0.05, clawTop.y - 0.52, Math.sin(a) * 0.05);
    ctx.g(z, "chrome").add(tube([p0, p1, p2], 0.008, 6), cm, "Claw");
  }
  // the prizes
  ctx.g(z, "arcadeWhite").add(box(S - 0.06, 0.02, S - 0.06), xf(0, base + 0.01, 0).multiply(m));
  for (let i = 0; i < 16; i++) {
    const x = (r() - 0.5) * (S - 0.25);
    const zz = (r() - 0.5) * (S - 0.25);
    const y = base + 0.08 + (i > 9 ? 0.12 : 0) + r() * 0.04;
    if (i % 3 === 2) {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = -0.8 + (k / 8) * 1.6;
        pts.push(new Vector3(Math.sin(t) * 0.1, -Math.cos(t) * 0.1 + 0.1, 0));
      }
      ctx.g(z, "bananaYellow").add(tube(pts, (t) => 0.035 * Math.sin(Math.PI * (0.1 + t * 0.8)) + 0.006, 8), xf(x, y, zz, r() * 6, 1, 1, 1, 0, 0.6).multiply(m), "Plush banana");
    } else plushChimp(ctx, z, xf(x, y - 0.06, zz, r() * 6).multiply(m), 0.85 + r() * 0.3);
  }
  ctx.lights.push({ pos: Vector3.TransformCoordinates(new Vector3(0, base + glassH - 0.1, 0), m), color: "#ffd9f0", day: 0.6, night: 2, range: 2.5, rooms: [z.room], level: z.level });
}

/** Little plush chimp, sitting. Base at m. */
export function plushChimp(ctx: WorldCtx, z: Zone, m: Matrix, s = 1): void {
  const fur = new Geo();
  fur.add(sphere(0.07 * s, 12, 10), xf(0, 0.07 * s, 0, 0, 1, 1.05, 0.9));
  fur.add(sphere(0.06 * s, 12, 10), xf(0, 0.17 * s, 0));
  for (const sx of [-1, 1]) {
    fur.add(sphere(0.022 * s, 8, 6), xf(sx * 0.06 * s, 0.19 * s, 0));
    fur.add(sphere(0.026 * s, 8, 6), xf(sx * 0.05 * s, 0.03 * s, -0.05 * s));
  }
  ctx.g(z, "plushBrown").add(fur, m, "Plush chimp");
  ctx.g(z, "plushTan").add(new Geo().add(sphere(0.035 * s, 10, 8, 0.8), xf(0, 0.16 * s, -0.04 * s)).add(sphere(0.03 * s, 8, 6, 0.6), xf(0, 0.07 * s, -0.055 * s)), m, "Plush chimp");
}

// ------------------------------------------------------------------ vending machine

/** Snack vending machine, 0.95 m wide, 1.85 m tall: lit window of snack rows, keypad, coin slot. Base at m, front -Z. */
export function vendingMachine(ctx: WorldCtx, z: Zone, m: Matrix): void {
  mats(ctx);
  const label = "Snack vending machine";
  const W = 0.95;
  const H = 1.85;
  const D = 0.8;
  ctx.g(z, "arcadeRed").add(softBox(W, H, D, 0.03), xf(0, H / 2, 0).multiply(m), label);
  const win = canvasMat(
    ctx,
    "vendWindow",
    (() => {
      const { canvas, ctx: c } = makeCanvas(400, 600);
      c.fillStyle = "#e8eef2";
      c.fillRect(0, 0, 400, 600);
      const cols = ["#f2c230", "#d6322b", "#2a5bd7", "#2fbf8f", "#ff7a1a", "#9b59b6", "#e2407e"];
      for (let row = 0; row < 6; row++) {
        const y = 20 + row * 96;
        c.fillStyle = "#9aa4ab";
        c.fillRect(0, y + 74, 400, 6);
        for (let k = 0; k < 5; k++) {
          const x = 14 + k * 76;
          c.fillStyle = cols[(row * 3 + k) % cols.length];
          c.fillRect(x, y + 12, 56, 62);
          c.fillStyle = "rgba(255,255,255,0.55)";
          c.fillRect(x + 6, y + 24, 44, 10);
          c.fillStyle = "#333";
          c.font = "600 14px Montserrat";
          c.fillText(`${String.fromCharCode(65 + row)}${k + 1}`, x + 18, y + 92);
        }
      }
      return canvas;
    })(),
    1.05,
  );
  face(ctx, z, win, xf(-0.1, 1.05, -D / 2 - 0.004).multiply(m), 0.62, 0.93, label);
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(0.64, 0.95, 0.01), xf(-0.1, 1.05, -D / 2 - 0.012).multiply(m), label);
  // header, keypad, coin slot and pickup flap
  const hdr = canvasMat(
    ctx,
    "vendHeader",
    (() => {
      const { canvas, ctx: c } = makeCanvas(512, 120);
      c.fillStyle = "#1b1030";
      c.fillRect(0, 0, 512, 120);
      c.fillStyle = "#ffd54a";
      c.font = "800 72px Nunito";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("SNACKS", 256, 64);
      return canvas;
    })(),
    1.3,
  );
  ctx.mats.glowing.add(hdr);
  face(ctx, z, hdr, xf(0, H - 0.16, -D / 2 - 0.004).multiply(m), W - 0.12, 0.2, label);
  ctx.g(z, "black").add(box(0.18, 0.5, 0.02), xf(W / 2 - 0.15, 1.1, -D / 2 - 0.006).multiply(m), "Keypad");
  const keysG = new Geo();
  for (let i = 0; i < 12; i++) keysG.add(box(0.03, 0.03, 0.01), xf(W / 2 - 0.19 + (i % 3) * 0.04, 1.2 - Math.floor(i / 3) * 0.05, -D / 2 - 0.018));
  ctx.g(z, "chrome").add(keysG, m, "Keypad");
  ctx.g(z, "neonCyan", { castShadow: false }).add(plane(0.13, 0.05), xf(W / 2 - 0.15, 1.3, -D / 2 - 0.018).multiply(m), "Keypad");
  ctx.g(z, "chrome").add(box(0.06, 0.02, 0.01), xf(W / 2 - 0.15, 0.95, -D / 2 - 0.016).multiply(m), "Coin slot");
  ctx.g(z, "black").add(box(0.62, 0.18, 0.02), xf(-0.1, 0.3, -D / 2 - 0.006).multiply(m), "Pickup flap");
  ctx.lights.push({ pos: Vector3.TransformCoordinates(new Vector3(-0.1, 1.1, -D / 2 - 0.3), m), color: "#eaf4ff", day: 0.4, night: 1.6, range: 2.5, rooms: [z.room], level: z.level });
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

