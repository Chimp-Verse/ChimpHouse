// Screens and equipment: monitors, TVs, speakers, projector (arcade cabinets
// are in cabinet.ts), task chairs, keyboards, consoles.

import { Matrix, Vector3 } from "@babylonjs/core";
import { beam, box, cylinder, lathe, plane, softBox, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { loadImageTexture } from "../materials/library";
import { makeCanvas, toTexture } from "../materials/canvas";

/** Unlit screen material for an extracted reference image (public/textures/screens/<id>.png). */
export function screenMat(ctx: WorldCtx, id: string, intensity = 1.05): string {
  const key = `screen:${id}`;
  if (!ctx.mats.has(key)) {
    const tex = loadImageTexture(ctx.scene, `${import.meta.env.BASE_URL}textures/screens/${id}.png`);
    ctx.mats.screen(key, tex, intensity);
  }
  return key;
}

/** Unlit material from a canvas (procedural screens/signs). */
export function canvasMat(ctx: WorldCtx, key: string, canvas: HTMLCanvasElement, intensity = 1.05, alpha = false): string {
  if (!ctx.mats.has(key)) {
    const tex = toTexture(ctx.scene, key, canvas, { wrap: false, hasAlpha: alpha });
    ctx.mats.unlit(key, { tex, intensity, alphaTest: alpha });
  }
  return key;
}

/** Flat screen quad + bezel. Local: centred at m, facing -Z. */
export function screenPanel(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, mat: string, o: { bezel?: number; depth?: number; label?: string; frameMat?: string } = {}): void {
  const bezel = o.bezel ?? 0.03;
  const depth = o.depth ?? 0.05;
  const label = o.label ?? "Screen";
  ctx.g(z, o.frameMat ?? "black").add(box(w + bezel * 2, h + bezel * 2, depth), xf(0, 0, depth / 2).multiply(m), label);
  ctx.g(z, mat, { castShadow: false }).add(plane(w, h), xf(0, 0, -0.004).multiply(m), label);
}

/** Desktop monitor on a stand; base at m origin, screen facing -Z. */
export function monitor(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, mat: string, label = "Monitor"): void {
  const standH = 0.12;
  screenPanel(ctx, z, xf(0, standH + h / 2 + 0.03, 0).multiply(m), w, h, mat, { bezel: 0.012, depth: 0.03, label });
  const g = ctx.g(z, "black");
  g.add(box(0.05, standH + h / 2, 0.03), xf(0, (standH + h / 2) / 2, 0.06).multiply(m), label);
  g.add(box(0.22, 0.012, 0.16), xf(0, 0.006, 0.04).multiply(m), label);
}

/** Large TV on a low timber media console. Console base at m, TV facing -Z. */
export function tvConsole(ctx: WorldCtx, z: Zone, m: Matrix, tvW: number, tvH: number, mat: string, consoleW: number): void {
  const cg = ctx.g(z, "panelHoney");
  cg.add(box(consoleW, 0.5, 0.48), xf(0, 0.25, 0).multiply(m), "Media console");
  ctx.g(z, "timber").add(box(consoleW + 0.04, 0.04, 0.5), xf(0, 0.52, 0).multiply(m), "Media console");
  screenPanel(ctx, z, xf(0, 0.56 + 0.12 + tvH / 2, 0.05).multiply(m), tvW, tvH, mat, { bezel: 0.025, depth: 0.06, label: "Television" });
  ctx.g(z, "black").add(box(0.5, 0.05, 0.25), xf(0, 0.565, 0.05).multiply(m), "Television");
  // consoles and controllers
  const dev = ctx.g(z, "black");
  dev.add(softBox(0.36, 0.08, 0.26, 0.02), xf(-consoleW * 0.25, 0.58, -0.05).multiply(m), "Game console");
  dev.add(softBox(0.3, 0.07, 0.22, 0.02), xf(consoleW * 0.25, 0.575, -0.05).multiply(m), "Game console");
  ctx.g(z, "white").add(softBox(0.18, 0.32, 0.08, 0.02), xf(consoleW * 0.38, 0.69, 0).multiply(m), "Game console");
}

/** Floor-standing speaker. Base at m, facing -Z. */
export function speaker(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, d: number): void {
  ctx.g(z, "black").add(box(w, h, d), xf(0, h / 2, 0).multiply(m), "Speaker");
  const cones = ctx.g(z, "charcoal");
  const n = Math.max(1, Math.floor(h / (w * 1.3)));
  for (let i = 0; i < n; i++) {
    const y = h * ((i + 0.5) / n);
    cones.add(lathe([[w * 0.36, 0], [w * 0.3, 0.02], [w * 0.08, 0.05], [0.001, 0.05]], 20), xf(0, y, -d / 2 - 0.001, 0, 1, 1, 1, Math.PI / 2).multiply(m), "Speaker");
  }
}

/** Mesh task chair (5-star base). Seat facing -Z, base at m. */
export function taskChair(ctx: WorldCtx, z: Zone, m: Matrix, mesh = "sage"): void {
  const base = ctx.g(z, "black");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    base.add(beam([new Vector3(0, 0.08, 0), new Vector3(Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32)], 0.04, 0.03).add(cylinder(0.025, 0.04, 8), xf(Math.cos(a) * 0.32, 0.0, Math.sin(a) * 0.32)), m, "Task chair");
  }
  base.add(cylinder(0.03, 0.38, 10), xf(0, 0.08, 0).multiply(m), "Task chair");
  ctx.g(z, mesh).add(softBox(0.52, 0.09, 0.5, 0.04, 0.02), xf(0, 0.48, 0).multiply(m), "Task chair");
  ctx.g(z, mesh).add(softBox(0.5, 0.62, 0.06, 0.03, 0.02), xf(0, 0.88, 0.27, 0, 1, 1, 1, 0.12).multiply(m), "Task chair");
  const frame = ctx.g(z, "charcoal");
  frame.add(box(0.54, 0.04, 0.05), xf(0, 1.2, 0.31).multiply(m));
  for (const sx of [-0.28, 0.28]) {
    frame.add(box(0.04, 0.25, 0.04), xf(sx, 0.6, 0).multiply(m));
    frame.add(box(0.06, 0.03, 0.28), xf(sx, 0.73, 0).multiply(m));
  }
}

/** Keyboard + mouse on a desk. m at desk surface. */
export function keyboard(ctx: WorldCtx, z: Zone, m: Matrix): void {
  ctx.g(z, "black", { castShadow: false }).add(box(0.44, 0.02, 0.14), xf(0, 0.01, 0).multiply(m), "Keyboard");
  ctx.g(z, "black", { castShadow: false }).add(softBox(0.06, 0.03, 0.1, 0.015), xf(0.32, 0.015, 0.02).multiply(m), "Mouse");
}

/** Ceiling projector with mint ring. */
export function projector(ctx: WorldCtx, z: Zone, pos: Vector3, yaw: number): void {
  const m = xf(pos.x, pos.y, pos.z, yaw);
  ctx.g(z, "black").add(softBox(0.6, 0.22, 0.5, 0.05), xf(0, -0.35, 0).multiply(m), "Projector");
  ctx.g(z, "black").add(cylinder(0.03, 0.25, 8), xf(0, -0.25, 0).multiply(m), "Projector");
  ctx.g(z, "mint", { castShadow: false }).add(lathe([[0.1, 0], [0.12, 0], [0.12, 0.02], [0.1, 0.02]], 24), xf(0, -0.47, 0.05).multiply(m), "Projector");
  ctx.g(z, "screenOff").add(cylinder(0.07, 0.05, 16), xf(0, -0.35, -0.25, 0, 1, 1, 1, Math.PI / 2).multiply(m), "Projector lens");
}

/** Simple procedural dashboard canvas for trading monitors. */
export function chartCanvas(seed: number, kind: "candles" | "map" | "table" | "lines"): HTMLCanvasElement {
  const W = 512;
  const H = 300;
  const { canvas, ctx } = makeCanvas(W, H);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = "#0b1420";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#13233a";
  ctx.fillRect(0, 0, W, 24);
  ctx.fillStyle = "#7ff0c4";
  ctx.font = "600 14px Montserrat";
  ctx.fillText(kind === "map" ? "GLOBAL MARKETS" : kind === "table" ? "WATCHLIST" : "CHIMPX · 1D", 10, 17);
  ctx.strokeStyle = "rgba(120,160,200,0.15)";
  for (let x = 0; x < W; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 24; y < H; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  if (kind === "candles") {
    let p = 150;
    for (let i = 0; i < 46; i++) {
      const o = p;
      p += (rnd() - 0.45) * 18;
      const hi = Math.max(o, p) + rnd() * 8;
      const lo = Math.min(o, p) - rnd() * 8;
      const x = 12 + i * 10.6;
      ctx.strokeStyle = ctx.fillStyle = p < o ? "#3ddc97" : "#ff5a6a";
      ctx.beginPath();
      ctx.moveTo(x + 3, H - 40 - hi * 0.9 + 60);
      ctx.lineTo(x + 3, H - 40 - lo * 0.9 + 60);
      ctx.stroke();
      ctx.fillRect(x, H - 40 - Math.max(o, p) * 0.9 + 60, 6, Math.max(2, Math.abs(p - o) * 0.9));
      ctx.fillStyle = "rgba(61,220,151,0.45)";
      ctx.fillRect(x, H - 4 - rnd() * 26, 6, 30);
    }
  } else if (kind === "lines") {
    for (const col of ["#3ddc97", "#56b4ff", "#ffb25e"]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let y = 140 + rnd() * 60;
      for (let x = 0; x < W; x += 8) {
        y += (rnd() - 0.5) * 14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (kind === "map") {
    ctx.fillStyle = "#1d3f6e";
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W;
      const y = 40 + rnd() * (H - 60);
      const land = Math.sin(x * 0.02) + Math.cos(y * 0.03) > 0.3;
      if (land) {
        ctx.fillStyle = rnd() > 0.85 ? "#ff5a6a" : rnd() > 0.7 ? "#3ddc97" : "#2b6db4";
        ctx.fillRect(x, y, 8, 6);
      }
    }
  } else {
    ctx.font = "500 15px Montserrat";
    const syms = ["CHIMPX", "BANANA", "JUNGLE", "TREE", "VIBE", "APESIM", "GREEN", "MOON", "RIVER"];
    syms.forEach((sym, i) => {
      const up = rnd() > 0.3;
      ctx.fillStyle = "#cfe3f5";
      ctx.fillText(sym, 12, 50 + i * 27);
      ctx.fillStyle = up ? "#3ddc97" : "#ff5a6a";
      ctx.fillText(`${up ? "+" : "-"}${(rnd() * 3).toFixed(2)}%`, 150, 50 + i * 27);
      ctx.fillText((80 + rnd() * 60).toFixed(2), 260, 50 + i * 27);
    });
  }
  return canvas;
}
