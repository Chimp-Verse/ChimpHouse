// The lift's materials: brushed stainless for its doors and frames, the car's walnut panels,
// smoked glass and granite floor, the grooved sills the doors run in, the dark shaft, the
// car's lights, and its buttons. Made once, the first time the lift is built, as the house's
// other materials are (library.ts), so they export to Blender with it.
//
// The textures are drawn finer than the house's general ones: the lift is seen from arm's
// length, so its stainless needs a hairline grain, not streaks, and its buttons crisp symbols.

import { CubeTexture, Scene, Vector2, Vector3 } from "@babylonjs/core";
import { hash2, perlin2Tile } from "../geometry/noise";
import { Ctx, clamp255, makeCanvas, normalFromHeight, toTexture } from "./canvas";
import { Materials } from "./library";

/** The symbols on the lift's buttons: the landings' up and down, the car's floors, and its door buttons. */
export type LiftGlyph = "up" | "down" | "1" | "2" | "open" | "close";
export const LIFT_GLYPHS: LiftGlyph[] = ["up", "down", "1", "2", "open", "close"];

/** A button's material: lit while its call waits (or while it is held), unlit otherwise. */
export function buttonMat(glyph: LiftGlyph, lit: boolean): string {
  return `liftButton-${glyph}${lit ? "-lit" : ""}`;
}

/** Make the lift's materials, once. */
export function liftMaterials(mats: Materials): void {
  if (mats.has("liftSteel")) return;
  const s = mats.scene;
  const T = (name: string, c: HTMLCanvasElement, metres: number, linear = false) => {
    const t = toTexture(s, name, c, { linear, aniso: 16 });
    t.uScale = 1 / metres;
    t.vScale = 1 / metres;
    mats.textures[name] = t;
    return t;
  };

  // the metals reflect a warm room, not the sky the house's environment map is drawn from
  const room = roomReflection(s);
  // brushed stainless: a hairline grain running up the doors, and the sheen stretched along it
  const brushed = stainless();
  const steelTex = T("liftBrushed", brushed.albedo, 0.5);
  const steelN = T("liftBrushedN", brushed.normal, 0.5, true);
  const steel = (key: string, color: string, rough: number) => {
    const m = mats.pbr(key, { color, tex: steelTex, bump: steelN, bumpLevel: 0.25, rough, metal: 0.9 });
    m.anisotropy.isEnabled = true;
    m.anisotropy.intensity = 0.7;
    m.anisotropy.direction = new Vector2(0, 1);
    m.reflectionTexture = room;
    return m;
  };
  steel("liftSteel", "#e4e2dc", 0.28);
  steel("liftSteelDark", "#6d6b67", 0.38);
  mats.pbr("liftChrome", { color: "#ecebe7", rough: 0.1, metal: 1 }).reflectionTexture = room;

  // the car: walnut veneer panels, a smoked glass back panel, a granite floor, a pale ceiling
  const walnut = walnutTexture();
  mats.pbr("liftWalnut", { tex: T("liftWalnut", walnut.albedo, 1), bump: T("liftWalnutN", walnut.normal, 1, true), bumpLevel: 0.35, rough: 0.38, clearCoat: 0.45 }).reflectionTexture = room;
  // the back wall's smoked bronze glass
  mats.pbr("liftGlass", { color: "#4a3c30", rough: 0.18, metal: 0.7 }).reflectionTexture = room;
  const granite = graniteTexture();
  mats.pbr("liftFloor", { tex: T("liftGranite", granite.albedo, 1.2), bump: T("liftGraniteN", granite.normal, 1.2, true), bumpLevel: 0.3, rough: 0.22, clearCoat: 0.5 }).reflectionTexture = room;
  // the ceiling glows a little with the light its lamps throw on it
  mats.pbr("liftCeiling", { color: "#efede7", rough: 0.55, emissive: "#2a2824" }).reflectionTexture = room;
  mats.unlit("liftLed", { color: "#fff3df", intensity: 4 });
  mats.glowing.add("liftLed");

  // the sills: extruded aluminium, grooved along the doorway for the doors' guides
  const sill = sillTexture();
  mats.pbr("liftSill", { color: "#cfcfcb", tex: T("liftSill", sill.albedo, 0.25), bump: T("liftSillN", sill.normal, 0.25, true), bumpLevel: 0.4, rough: 0.42, metal: 0.9 }).reflectionTexture = room;

  // the shaft: dark painted concrete, and the black rubber of the doors' meeting edges
  mats.pbr("liftShaft", { color: "#3b3a38", rough: 0.95 });
  mats.pbr("liftRubber", { color: "#050505", rough: 0.95 });
  // the indicators' black glass, round their displays
  mats.pbr("liftBlackGlass", { color: "#08090a", rough: 0.08, clearCoat: 1 }).reflectionTexture = room;

  // the buttons: a satin steel face with its symbol engraved, and, lit, a glowing symbol and halo
  for (const g of LIFT_GLYPHS) {
    const face = makeCanvas(256, 256);
    paintButton(face.ctx, g, false);
    const glow = makeCanvas(256, 256);
    paintButton(glow.ctx, g, true);
    const faceTex = toTexture(s, `liftButton-${g}`, face.canvas, { wrap: false, aniso: 16 });
    const glowTex = toTexture(s, `liftButton-${g}-glow`, glow.canvas, { wrap: false, aniso: 16 });
    mats.pbr(buttonMat(g, false), { tex: faceTex, rough: 0.3, metal: 0.85 }).reflectionTexture = room;
    const on = mats.pbr(buttonMat(g, true), { tex: faceTex, rough: 0.3, metal: 0.85, emissive: "#ffffff", emissiveIntensity: 1.6 });
    on.emissiveTexture = glowTex;
    on.reflectionTexture = room;
  }
}

/**
 * A small cube map of a warm room, for the lift's metals to reflect: a pale lit ceiling with
 * bright lamps, timber-slatted walls glowing amber, a darker floor. Drawn as lighting.ts draws
 * the sky's (the same face order and directions).
 */
function roomReflection(scene: Scene): CubeTexture {
  const S = 64;
  const dirs = [
    (u: number, v: number) => new Vector3(1, -v, -u),
    (u: number, v: number) => new Vector3(u, 1, v),
    (u: number, v: number) => new Vector3(u, -v, 1),
    (u: number, v: number) => new Vector3(-1, -v, u),
    (u: number, v: number) => new Vector3(u, -1, -v),
    (u: number, v: number) => new Vector3(-u, -v, -1),
  ];
  const faces: string[] = [];
  for (const f of dirs) {
    const { canvas, ctx } = makeCanvas(S, S);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = f((2 * (x + 0.5)) / S - 1, (2 * (y + 0.5)) / S - 1).normalize();
        const az = Math.atan2(d.z, d.x);
        let c: [number, number, number];
        if (d.y > 0.55) {
          // the ceiling, with a few round lamps
          const lamp = Math.cos(az * 3) > 0.92 && d.y < 0.8 ? 1 : 0;
          c = lamp ? [255, 250, 240] : [236, 233, 226];
        } else if (d.y > -0.35) {
          // the walls: timber slats and their dark gaps, brighter where the lamps are
          const slat = Math.sin(az * 40) > -0.3 ? 1 : 0.7;
          const glow = Math.max(0, Math.cos(az * 2 - 0.6)) ** 6 * Math.max(0, 1 - Math.abs(d.y - 0.15) * 2);
          c = [Math.min(255, 178 * slat + 70 * glow), Math.min(255, 166 * slat + 64 * glow), Math.min(255, 150 * slat + 56 * glow)];
        } else {
          c = [110, 100, 90];
        }
        const i = (y * S + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    faces.push(canvas.toDataURL("image/png"));
  }
  const tex = CubeTexture.CreateFromImages(faces, scene, false);
  tex.name = "liftRoom";
  tex.gammaSpace = true;
  return tex;
}

/** Brushed stainless: fine lines along v, each a slightly different tone, with a few longer scratches. */
function stainless(): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const line = new Float32Array(S);
  for (let x = 0; x < S; x++) line[x] = (hash2(x * 0.37, 11.3) - 0.5) * 1.0 + perlin2Tile((x / S) * 64, 0.5, 64, 1) * 0.6;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // each line wavers a little in tone along its length, and the lines are broken by soft streaks
      const streak = perlin2Tile((x / S) * 128, (y / S) * 4, 128, 4) * 0.5;
      const n = line[x] + streak + (hash2(x, y) - 0.5) * 0.25;
      const i = y * S + x;
      height[i] = n * 0.5;
      const v = 196 + n * 9;
      d[i * 4] = clamp255(v);
      d[i * 4 + 1] = clamp255(v);
      d[i * 4 + 2] = clamp255(v - 2);
      d[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 0.6) };
}

/** Walnut veneer: straight grain running up the panel, with darker figure and fine pores. */
function walnutTexture(): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const light: [number, number, number] = [132, 96, 70];
  const dark: [number, number, number] = [72, 50, 36];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const warp = perlin2Tile(u * 4, v * 1, 4, 1) * 0.008 + perlin2Tile(u * 16, v * 2, 16, 2) * 0.002;
      // the grain's lines come closer and spread apart across the panel, as a real flitch's do
      const grain = Math.pow(Math.sin((u + warp) * Math.PI * 2 * 48 + perlin2Tile(u * 6, 0.5, 6, 1) * 9) * 0.5 + 0.5, 4);
      const figure = perlin2Tile(u * 12, v * 2, 12, 2) * 0.5 + 0.5;
      const pores = hash2(x, Math.floor(y / 3)) > 0.93 ? 1 : 0;
      const t = Math.min(1, Math.max(0, 0.2 + figure * 0.55 + grain * 0.2 - pores * 0.2 + (hash2(x * 3.1, y * 0.2) - 0.5) * 0.1));
      const i = y * S + x;
      height[i] = grain * 0.4 - pores * 0.4;
      for (let k = 0; k < 3; k++) d[i * 4 + k] = clamp255(dark[k] + (light[k] - dark[k]) * t);
      d[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 0.8) };
}

/** Dark granite in 0.6 m tiles with fine grout: grey crystals, black and pale speckles. */
function graniteTexture(): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const tile = S / 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const cloud = perlin2Tile(u * 6, v * 6, 6, 6) * 0.5 + perlin2Tile(u * 24, v * 24, 24, 24) * 0.3;
      const h1 = hash2(Math.floor(x / 2), Math.floor(y / 2));
      const h2 = hash2(x * 1.7 + 3, y * 1.3 + 7);
      let c = 58 + cloud * 14 + (h2 - 0.5) * 16;
      if (h1 > 0.9) c = 112 + h2 * 50; // pale feldspar
      else if (h1 < 0.12) c = 26 + h2 * 10; // black mica
      const gx = x % tile;
      const gy = y % tile;
      const grout = gx < 2 || gy < 2;
      const i = y * S + x;
      height[i] = grout ? -1 : 0;
      const g = grout ? 92 : c;
      d[i * 4] = clamp255(g + 2);
      d[i * 4 + 1] = clamp255(g);
      d[i * 4 + 2] = clamp255(g - 1);
      d[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 1.5) };
}

/** An aluminium sill: grooves 6 mm apart, running along u (across the doorway). */
function sillTexture(): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const pitch = S / 42;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const f = (y % pitch) / pitch;
      const groove = f > 0.62 ? 1 : 0;
      const i = y * S + x;
      height[i] = groove ? -1 : 0;
      const v = groove ? 70 : 200 + (hash2(x, y) - 0.5) * 12;
      d[i * 4] = clamp255(v);
      d[i * 4 + 1] = clamp255(v);
      d[i * 4 + 2] = clamp255(v);
      d[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 2) };
}

/**
 * A button's face (256 px square, a disc filling it): satin steel with the symbol engraved
 * dark in it and a fine ring round its edge; or, `glow`, the light that shows when it is lit:
 * the symbol and the ring in amber on black, which the material adds as emission.
 */
function paintButton(g: Ctx, glyph: LiftGlyph, glow: boolean): void {
  const c = 128;
  if (glow) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 256, 256);
  } else {
    const grad = g.createRadialGradient(c - 30, c - 40, 10, c, c, 140);
    grad.addColorStop(0, "#e2e1dc");
    grad.addColorStop(1, "#a9a8a3");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // the face's circular brushing
    g.globalAlpha = 0.08;
    for (let r = 6; r < 128; r += 3) {
      g.strokeStyle = r % 2 ? "#fff" : "#555";
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  const ink = glow ? "#ffb35a" : "#2b2b2b";
  // the halo ring round the face
  g.strokeStyle = glow ? "#ffb35a" : "#6f6e6a";
  g.lineWidth = glow ? 14 : 6;
  g.beginPath();
  g.arc(c, c, 112, 0, Math.PI * 2);
  g.stroke();
  if (glow) {
    g.shadowColor = "#ff9a2a";
    g.shadowBlur = 18;
  }
  g.fillStyle = ink;
  const tri = (x: number, y: number, w: number, h: number, dir: "up" | "down" | "left" | "right") => {
    g.beginPath();
    if (dir === "up") g.moveTo(x, y - h / 2), g.lineTo(x + w / 2, y + h / 2), g.lineTo(x - w / 2, y + h / 2);
    if (dir === "down") g.moveTo(x, y + h / 2), g.lineTo(x + w / 2, y - h / 2), g.lineTo(x - w / 2, y - h / 2);
    if (dir === "left") g.moveTo(x - w / 2, y), g.lineTo(x + w / 2, y - h / 2), g.lineTo(x + w / 2, y + h / 2);
    if (dir === "right") g.moveTo(x + w / 2, y), g.lineTo(x - w / 2, y - h / 2), g.lineTo(x - w / 2, y + h / 2);
    g.closePath();
    g.fill();
  };
  if (glyph === "up" || glyph === "down") tri(c, c, 92, 78, glyph);
  else if (glyph === "open" || glyph === "close") {
    // the doors parting (◀|▶) or meeting (▶|◀)
    g.fillRect(c - 4, c - 46, 8, 92);
    if (glyph === "open") tri(c - 44, c, 44, 56, "left"), tri(c + 44, c, 44, 56, "right");
    else tri(c - 36, c, 44, 56, "right"), tri(c + 36, c, 44, 56, "left");
  } else {
    g.font = "700 150px Montserrat, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(glyph, c, c + 10);
  }
  g.shadowBlur = 0;
}
