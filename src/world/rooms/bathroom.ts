// The bathroom behind the lift, on both floors: a marble-and-gold mansion bathroom for
// chimps. Seen from the door: a freestanding tub under a crystal chandelier, before an arched
// mural of the jungle at golden hour with a chimp on a branch. On the left a floating double
// vanity with arched gold mirrors; on the right the polished golden toilet, a bidet, and a
// walk-in rain shower behind a marble partition and a pane of glass.
//
// Everything here is the "bathroom" room (its own room lights, which light only it); the
// sliding door on the corridor side and the walls themselves stay with the core
// (structure/facades.ts). The room is clad inside: marble to 2.6 m, a gold band, fluted
// walnut above, and a dropped ceiling at 3.5 m with a coffer lit by a cove strip.

import { CubeTexture, PBRMaterial, Scene, Vector3 } from "@babylonjs/core";
import { P2, rng } from "../geometry/curves";
import { Geo, box, cylinder, disc, fixWinding, lathe, polygonFace, softBox, sphere, tube, xf } from "../geometry/geo";
import { fbmTile, hash2 } from "../geometry/noise";
import { WorldCtx, Zone, zone } from "../context";
import { LEVEL, core } from "../layout";
import { Ctx, makeCanvas, paintPixels, toTexture } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { pottedPlant } from "../props/plants";
import { faceYaw, roomLight } from "./common";

type RGB = [number, number, number];

/** The bathroom's inside, between the faces of its walls (before the cladding). */
export const BATH = (() => {
  const { wc } = core;
  const dm = (wc.x0 + wc.x1) / 2;
  return {
    x0: wc.x0 + 0.075,
    x1: core.x1 - 0.11,
    z0: wc.z0 + 0.075,
    z1: core.z1 - 0.125,
    /** the doorway in the south wall: x0–x1, h high */
    door: { x0: dm - 0.5, x1: dm + 0.5, h: 2.25, wall: wc.z0 },
  };
})();

/** Height of the dropped ceiling, and of its coffer, above the floor slab. */
const CEIL = 3.5;
const COFFER = 3.74;
/** Top of the marble floor above the floor slab. */
const FLOOR = 0.03;
/** How far the marble cladding stands off the walls. */
const CLAD = 0.025;

// ------------------------------------------------------------------ materials

function bathMats(ctx: WorldCtx): void {
  const mats = ctx.mats;
  if (mats.has("bathGold")) return;
  const s = mats.scene;
  const T = (name: string, c: HTMLCanvasElement, metres: number) => {
    const t = toTexture(s, name, c, { aniso: 16 });
    t.uScale = 1 / metres;
    t.vScale = 1 / metres;
    mats.textures[name] = t;
    return t;
  };
  // the metals, the porcelain and the polished stone reflect a warm marble room, not the sky
  const room = bathReflection(s);
  const shiny = (m: PBRMaterial) => {
    m.reflectionTexture = room;
    return m;
  };
  shiny(mats.pbr("bathGold", { color: "#ffc65a", rough: 0.14, metal: 1 }));
  shiny(mats.pbr("bathPorcelain", { color: "#f8f6f1", rough: 0.12, clearCoat: 0.8 }));
  shiny(mats.pbr("bathMirror", { color: "#dfe2dc", rough: 0.03, metal: 1 }));
  shiny(mats.pbr("bathMarble", { tex: T("bathMarble", marble(512, { base: [241, 235, 224], cloud: [226, 214, 196], vein: [168, 146, 112], period: 3, dir: [1, 2], seed: 0 }), 1.6), rough: 0.16, clearCoat: 0.6 }));
  shiny(mats.pbr("bathFloor", { tex: T("bathFloor", floorTiles(512), 1.2), rough: 0.2, clearCoat: 0.5 }));
  shiny(mats.pbr("bathVerde", { tex: T("bathVerde", verde(512), 0.9), rough: 0.15, clearCoat: 0.7 }));
  shiny(mats.pbr("bathMosaic", { tex: T("bathMosaic", mosaic(512), 0.5), rough: 0.25, clearCoat: 0.5 }));
  shiny(mats.pbr("bathWater", { color: "#76cfc8", rough: 0.03, alpha: 0.55 }));
  shiny(mats.pbr("bathCrystal", { color: "#ffffff", rough: 0.02, metal: 0.3, alpha: 0.55, emissive: "#ffe2b0", emissiveIntensity: 0.35 }));
  // walnut with its grain running up the panels and flutes (the house's timber runs across)
  mats.pbr("bathWalnut", { tex: T("bathWalnut", walnut(512), 1), rough: 0.38, clearCoat: 0.3 });
  // the warm lights would turn a cream ceiling yellow: cool whites, a touch bluer in the coffer, which the chandelier lights most
  mats.pbr("bathCeiling", { color: "#e1e2e6", rough: 0.92 });
  mats.pbr("bathCoffer", { color: "#d3d9e4", rough: 0.92 });
  mats.pbr("bathAmber", { color: "#9a4a12", rough: 0.08, clearCoat: 0.9 });
  // towels, the rug, foam and the rubber duck: soft cloth, coloured per piece (vertex colours)
  mats.pbr("bathCloth", { color: "#ffffff", rough: 0.95, sheen: 0.5 });
  // the mural, the floor medallion and the two botanical prints share one painted sheet
  const art = toTexture(s, "bathArt", artSheet(), { wrap: false, aniso: 16 });
  mats.textures.bathArt = art;
  mats.pbr("bathArt", { tex: art, rough: 0.55, emissive: "#ffffff", emissiveTex: art, emissiveIntensity: 0.18 });
}

/** Where each painting sits on the shared sheet (u0, v0, u1, v1). */
const ART: Record<"mural" | "medallion" | "printLeaf" | "printBunch", [number, number, number, number]> = {
  mural: [0, 0, 0.375, 1],
  medallion: [0.375, 0.5, 0.625, 1],
  printLeaf: [0.625, 0.5, 0.8125, 1],
  printBunch: [0.8125, 0.5, 1, 1],
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Tileable veined marble: a cloudy ground, one bold vein system and a fainter one across it. */
function marble(S: number, o: { base: RGB; cloud: RGB; vein: RGB; period: number; dir: [number, number]; seed: number; phase?: (u: number, v: number) => number }): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(S);
  const sh = (o.seed * 0.618) % 1;
  paintPixels(ctx, S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const w = fbmTile((u + sh) % 1, v, o.period, 5);
    const cl = fbmTile((u + 0.37 + sh) % 1, (v + 0.21) % 1, 2, 4) * 0.5 + 0.5;
    const ph = 2 * Math.PI * (u * o.dir[0] + v * o.dir[1]) + 4.2 * w + (o.phase?.(u, v) ?? 0);
    const s1 = Math.abs(Math.sin(ph));
    const s2 = Math.abs(Math.sin(2 * Math.PI * (u * 3 - v * 1) + 5 * fbmTile(v, (u + sh) % 1, 4, 4)));
    const vein = (1 - smooth(0, 0.06, s1)) * 0.55 + (1 - smooth(0, 0.35, s1)) * 0.16 + (1 - smooth(0, 0.03, s2)) * 0.2;
    let c = mix(o.base, o.cloud, smooth(0.35, 0.8, cl) * 0.7);
    c = mix(c, o.vein, Math.min(1, vein));
    return c as [number, number, number];
  });
  return canvas;
}

/** Cream marble floor tiles, 0.6 m (a 2 × 2 period), each veined its own way, with verde cabochons at the corners. */
function floorTiles(S: number): HTMLCanvasElement {
  const base: RGB = [238, 231, 218];
  const cloud: RGB = [222, 210, 190];
  const vein: RGB = [176, 156, 124];
  const { canvas, ctx } = makeCanvas(S);
  const grout = 2.2 / S; // half a grout line, in tile units (a tile is S / 2 pixels)
  paintPixels(ctx, S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const fu = u * 2;
    const fv = v * 2;
    const tx = Math.floor(fu);
    const ty = Math.floor(fv);
    // cabochon: a verde diamond with a gold rim where four tiles meet
    const dx = Math.abs(fu - Math.round(fu));
    const dy = Math.abs(fv - Math.round(fv));
    const dd = dx + dy;
    if (dd < 0.062) {
      const g = fbmTile(u, v, 8, 3) * 0.5 + 0.5;
      return mix([28, 70, 54], [52, 104, 82], g) as [number, number, number];
    }
    if (dd < 0.074) return [214, 170, 82];
    if (dx < grout || dy < grout) return [196, 184, 162];
    const flip = (tx + ty) % 2;
    const w = fbmTile(u, v, 3, 5);
    const cl = fbmTile((u + 0.4) % 1, v, 2, 4) * 0.5 + 0.5;
    const d = flip ? [1, 2] : [2, -1];
    const ph = 2 * Math.PI * (u * d[0] + v * d[1]) + 6 * w + hash2(tx, ty) * 6;
    const s1 = Math.abs(Math.sin(ph));
    const veinT = (1 - smooth(0, 0.045, s1)) * 0.7 + (1 - smooth(0, 0.25, s1)) * 0.15;
    let c = mix(base, cloud, smooth(0.35, 0.85, cl) * 0.6);
    c = mix(c, vein, veinT);
    // a soft bevel darkening at each tile's edge
    const e = Math.min(dx, dy);
    c = mix(c, [205, 194, 176], (1 - smooth(grout, grout * 4, e)) * 0.5);
    return c as [number, number, number];
  });
  return canvas;
}

/** Walnut, its grain running along v (up a wall panel): fine streaks and long soft figure, a cool brown. */
function walnut(S: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(S);
  paintPixels(ctx, S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const warp = fbmTile(u, v, 2, 4) * 0.5;
    const figure = Math.sin((u * 9 + warp * 2.5) * Math.PI * 2) * 0.5 + 0.5;
    const streak = Math.sin((u * 61 + fbmTile(v, u, 3, 3) * 3) * Math.PI * 2) * 0.5 + 0.5;
    const k = 0.84 + figure * 0.16 + streak * 0.1;
    return [92 * k, 62 * k, 44 * k];
  });
  return canvas;
}

/** Verde antico: deep green stone netted with pale veins. */
function verde(S: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(S);
  paintPixels(ctx, S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const w = fbmTile(u, v, 3, 5);
    const cl = fbmTile((u + 0.5) % 1, (v + 0.5) % 1, 4, 4) * 0.5 + 0.5;
    const s1 = Math.abs(Math.sin(2 * Math.PI * (u * 2 + v * 1) + 9 * w));
    const s2 = Math.abs(Math.sin(2 * Math.PI * (u * -1 + v * 3) + 11 * fbmTile(v, u, 5, 4)));
    const vein = (1 - smooth(0, 0.04, s1)) * 0.75 + (1 - smooth(0, 0.03, s2)) * 0.45;
    let c = mix([20, 58, 44], [44, 96, 74], smooth(0.3, 0.85, cl));
    c = mix(c, [210, 226, 214], Math.min(1, vein));
    return c as [number, number, number];
  });
  return canvas;
}

/** Small square mosaic for the shower tray: cream and sand, with verde and a few gold tesserae. */
function mosaic(S: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(S);
  const n = 20;
  const t = S / n;
  ctx.fillStyle = "#b9ae99";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const h = hash2(i * 1.3 + 4, j * 2.1 + 7);
      ctx.fillStyle = h < 0.04 ? "#d2a64c" : h < 0.22 ? "#2f6a55" : h < 0.6 ? "#ece4d4" : "#dcd0b9";
      ctx.fillRect(i * t + 1.2, j * t + 1.2, t - 2.4, t - 2.4);
    }
  return canvas;
}

/**
 * The warm room the bathroom's metals and porcelain reflect: a cream ceiling with the
 * chandelier's glow, fluted walnut and a gold band above cream marble, a cream floor.
 */
function bathReflection(scene: Scene): CubeTexture {
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
        let c: RGB;
        if (d.y > 0.62) {
          const glow = Math.max(0, d.y - 0.85) * 6;
          c = mix([238, 226, 206], [255, 236, 196], Math.min(1, glow));
        } else if (d.y > 0.3) {
          const flute = Math.sin(az * 60) > 0 ? 1 : 0.75;
          c = [92 * flute, 62 * flute, 42 * flute];
        } else if (d.y > 0.24) c = [232, 182, 86];
        else if (d.y > -0.35) {
          const vein = Math.abs(Math.sin(az * 5 + d.y * 7)) < 0.08 ? 0.82 : 1;
          const lamp = Math.max(0, Math.cos(az * 2 - 0.4)) ** 10 * Math.max(0, 1 - Math.abs(d.y - 0.05) * 3);
          c = [Math.min(255, 236 * vein + 40 * lamp), Math.min(255, 228 * vein + 34 * lamp), Math.min(255, 214 * vein + 24 * lamp)];
        } else c = [214, 204, 188];
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
  tex.name = "bathRoom";
  tex.gammaSpace = true;
  return tex;
}

// ------------------------------------------------------------------ the painted sheet

/** One 2048 × 1024 sheet: the mural (left), the floor medallion and two botanical prints (top right). */
function artSheet(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(2048, 1024);
  ctx.fillStyle = "#e9dfca";
  ctx.fillRect(0, 0, 2048, 1024);
  mural(ctx, 0, 0, 768, 1024);
  medallion(ctx, 768 + 256, 256, 252);
  print(ctx, 1280, 0, 384, 512, "leaf");
  print(ctx, 1664, 0, 384, 512, "bunch");
  return canvas;
}

/** A banana leaf: a long blade on a midrib from (x, y) at angle a (0 = up), with torn slits. */
function bananaLeaf(c: Ctx, x: number, y: number, a: number, len: number, wid: number, fill: string | CanvasGradient, rib: string, slit?: string) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(wid, -len * 0.2, wid * 1.05, -len * 0.7, len * 0.06, -len);
  c.bezierCurveTo(-wid * 0.95, -len * 0.72, -wid * 1.05, -len * 0.25, 0, 0);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (slit) {
    c.strokeStyle = slit;
    c.lineWidth = Math.max(1.5, wid * 0.04);
    for (let i = 0; i < 5; i++) {
      const t = 0.3 + i * 0.13;
      const side = i % 2 ? 1 : -1;
      c.beginPath();
      c.moveTo(side * wid * 0.25, -len * t);
      c.lineTo(side * wid * 1.05, -len * (t + 0.08));
      c.stroke();
    }
  }
  c.strokeStyle = rib;
  c.lineWidth = Math.max(1.5, wid * 0.05);
  c.beginPath();
  c.moveTo(0, len * 0.08);
  c.quadraticCurveTo(wid * 0.1, -len * 0.5, len * 0.05, -len * 0.97);
  c.stroke();
  c.restore();
}

/** A banana (a crescent) centred at (x, y), turned by a, length L. */
function bananaShape(c: Ctx, x: number, y: number, a: number, L: number, fill: string, edge: string) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(-L / 2, 0);
  c.quadraticCurveTo(0, L * 0.42, L / 2, 0);
  c.quadraticCurveTo(0, L * 0.2, -L / 2, 0);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = edge;
  c.lineWidth = Math.max(1, L * 0.03);
  c.stroke();
  c.restore();
}

/** Golden hour in the jungle: layered hills, a low sun, banana leaves, and a chimp on a branch with a banana. */
function mural(c: Ctx, X: number, Y: number, W: number, H: number) {
  c.save();
  c.beginPath();
  c.rect(X, Y, W, H);
  c.clip();
  c.translate(X, Y);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#2d5266");
  sky.addColorStop(0.3, "#8f8a73");
  sky.addColorStop(0.48, "#e9a95c");
  sky.addColorStop(0.62, "#ffd696");
  sky.addColorStop(1, "#f3b56a");
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  const sx = W * 0.64;
  const sy = H * 0.54;
  const glow = c.createRadialGradient(sx, sy, 0, sx, sy, W * 0.55);
  glow.addColorStop(0, "rgba(255,248,220,1)");
  glow.addColorStop(0.12, "rgba(255,232,170,0.95)");
  glow.addColorStop(0.4, "rgba(255,200,120,0.35)");
  glow.addColorStop(1, "rgba(255,190,110,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);
  // a few birds
  c.strokeStyle = "rgba(60,40,30,0.7)";
  c.lineWidth = 2.5;
  for (const [bx, by, s] of [[0.3, 0.26, 14], [0.36, 0.23, 10], [0.78, 0.3, 12]] as const) {
    c.beginPath();
    c.moveTo(W * bx - s, H * by);
    c.quadraticCurveTo(W * bx - s * 0.4, H * by - s * 0.6, W * bx, H * by);
    c.quadraticCurveTo(W * bx + s * 0.4, H * by - s * 0.6, W * bx + s, H * by);
    c.stroke();
  }
  // hills, far to near
  const ridge = (base: number, amp: number, freq: number, seed: number, fill: string) => {
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const t = x / W;
      const yy = base + amp * (Math.sin(t * freq + seed) * 0.6 + Math.sin(t * freq * 2.7 + seed * 2) * 0.3 + Math.sin(t * freq * 6.1 + seed) * 0.1);
      c.lineTo(x, H * yy);
    }
    c.lineTo(W, H);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  };
  ridge(0.6, 0.035, 5, 1, "rgba(214,150,96,0.75)");
  ridge(0.66, 0.045, 7, 3, "rgba(160,108,72,0.85)");
  // a row of jungle trees along the near ridge
  const r = rng(17);
  for (let i = 0; i < 14; i++) {
    const tx = (i / 13) * W + (r() - 0.5) * 30;
    const ty = H * (0.7 + r() * 0.03);
    const tr = 30 + r() * 30;
    c.fillStyle = "#4c4a33";
    c.fillRect(tx - 3, ty - tr * 0.4, 6, tr);
    c.beginPath();
    c.arc(tx, ty - tr * 0.6, tr * 0.7, 0, Math.PI * 2);
    c.arc(tx - tr * 0.5, ty - tr * 0.35, tr * 0.5, 0, Math.PI * 2);
    c.arc(tx + tr * 0.5, ty - tr * 0.35, tr * 0.5, 0, Math.PI * 2);
    c.fill();
  }
  ridge(0.76, 0.03, 4, 5, "#3a4a2c");
  // a still pool catching the sun
  const pool = c.createLinearGradient(0, H * 0.8, 0, H);
  pool.addColorStop(0, "#f2c27a");
  pool.addColorStop(1, "#9a6a44");
  c.fillStyle = pool;
  c.beginPath();
  c.ellipse(W * 0.6, H * 0.86, W * 0.32, H * 0.05, 0, 0, Math.PI * 2);
  c.fill();
  // foreground banana leaves from both sides
  const leaf = (x: number, y: number, a: number, len: number, wid: number) => {
    const g = c.createLinearGradient(x, y, x + Math.sin(a) * len, y - Math.cos(a) * len);
    g.addColorStop(0, "#1c3520");
    g.addColorStop(1, "#3d6a36");
    bananaLeaf(c, x, y, a, len, wid, g, "#8fb36a", "rgba(40,60,34,0.6)");
  };
  leaf(-20, H * 1.02, 0.55, H * 0.62, W * 0.11);
  leaf(10, H * 1.0, 0.95, H * 0.5, W * 0.1);
  leaf(-30, H * 0.75, 1.35, H * 0.4, W * 0.08);
  leaf(W + 20, H * 1.02, -0.5, H * 0.6, W * 0.11);
  leaf(W - 10, H * 0.98, -0.95, H * 0.46, W * 0.1);
  leaf(W + 30, H * 0.7, -1.4, H * 0.36, W * 0.08);
  // a hanging banana bunch on the right
  c.strokeStyle = "#3a2a1a";
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(W * 0.84, H * 0.25);
  c.quadraticCurveTo(W * 0.86, H * 0.32, W * 0.83, H * 0.38);
  c.stroke();
  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    bananaShape(c, W * (0.8 + col * 0.035), H * (0.38 + row * 0.045), -0.9 + col * 0.25, W * 0.085, "#f1c443", "#a87a1e");
  }
  c.fillStyle = "#6b2433";
  c.beginPath();
  c.ellipse(W * 0.83, H * 0.55, W * 0.022, H * 0.035, 0.2, 0, Math.PI * 2);
  c.fill();
  // the branch
  c.strokeStyle = "#2a1c13";
  c.lineCap = "round";
  c.lineWidth = 24;
  c.beginPath();
  c.moveTo(-10, H * 0.5);
  c.bezierCurveTo(W * 0.2, H * 0.47, W * 0.35, H * 0.5, W * 0.56, H * 0.46);
  c.stroke();
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(W * 0.42, H * 0.49);
  c.quadraticCurveTo(W * 0.5, H * 0.42, W * 0.55, H * 0.38);
  c.stroke();
  bananaLeaf(c, W * 0.55, H * 0.385, 0.9, H * 0.12, W * 0.04, "#2a4a26", "#7fa25e");
  // the chimp, sitting on the branch, rim-lit by the sun, a banana in hand
  const cx = W * 0.33;
  const cy = H * 0.455;
  const ink = "#1a120d";
  const rim = "rgba(255,206,120,0.9)";
  c.fillStyle = ink;
  // back, body
  c.beginPath();
  c.ellipse(cx, cy - 34, 44, 58, -0.1, 0, Math.PI * 2);
  c.fill();
  // legs dangling
  c.lineWidth = 22;
  c.strokeStyle = ink;
  c.beginPath();
  c.moveTo(cx - 14, cy + 2);
  c.quadraticCurveTo(cx - 8, cy + 40, cx - 18, cy + 78);
  c.moveTo(cx + 22, cy + 2);
  c.quadraticCurveTo(cx + 30, cy + 44, cx + 22, cy + 80);
  c.stroke();
  c.beginPath();
  c.ellipse(cx - 22, cy + 84, 16, 8, 0.2, 0, Math.PI * 2);
  c.ellipse(cx + 26, cy + 86, 16, 8, -0.1, 0, Math.PI * 2);
  c.fill();
  // arm reaching out with the banana
  c.lineWidth = 18;
  c.beginPath();
  c.moveTo(cx + 26, cy - 62);
  c.quadraticCurveTo(cx + 68, cy - 52, cx + 84, cy - 82);
  c.stroke();
  bananaShape(c, cx + 94, cy - 98, -1.1, 46, "#f4cc4c", "#a87a1e");
  // other arm holding the branch
  c.beginPath();
  c.moveTo(cx - 30, cy - 50);
  c.quadraticCurveTo(cx - 52, cy - 18, cx - 40, cy + 4);
  c.stroke();
  // head
  const hx = cx + 10;
  const hy = cy - 112;
  c.beginPath();
  c.arc(hx, hy, 32, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(hx - 32, hy + 2, 11, 0, Math.PI * 2);
  c.arc(hx + 32, hy + 2, 11, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(hx + 14, hy + 14, 20, 15, 0.3, 0, Math.PI * 2);
  c.fill();
  // the sun catching its right side
  c.strokeStyle = rim;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(hx, hy, 32, -1.3, 0.6);
  c.stroke();
  c.beginPath();
  c.ellipse(cx, cy - 34, 44, 58, -0.1, -1.0, 0.7);
  c.stroke();
  c.beginPath();
  c.arc(hx + 32, hy + 2, 11, -1.4, 1.2);
  c.stroke();
  // a warm vignette
  const vg = c.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 0.8);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(60,30,10,0.35)");
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);
  c.restore();
}

/** The round floor inlay: verde field, cream and gold bands, an eight-point star, the leaf emblem. */
function medallion(c: Ctx, cx: number, cy: number, R: number) {
  c.save();
  const ring = (r: number, fill: string) => {
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
  };
  ring(R, "#d6a845");
  ring(R * 0.95, "#efe6d4");
  ring(R * 0.88, "#d6a845");
  ring(R * 0.85, "#1f4c3b");
  // the field's veins
  c.save();
  c.beginPath();
  c.arc(cx, cy, R * 0.85, 0, Math.PI * 2);
  c.clip();
  c.strokeStyle = "rgba(210,228,214,0.45)";
  c.lineWidth = 1.6;
  const r = rng(5);
  for (let i = 0; i < 18; i++) {
    c.beginPath();
    let x = cx - R + r() * R * 2;
    let y = cy - R;
    c.moveTo(x, y);
    while (y < cy + R) {
      x += (r() - 0.5) * 30;
      y += 14 + r() * 14;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  c.restore();
  // eight-point star, alternating cream and gold
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const long = i % 2 === 0;
    const L = R * (long ? 0.8 : 0.55);
    const w = R * (long ? 0.12 : 0.09);
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a - Math.PI / 2) * w + Math.cos(a) * w, cy + Math.sin(a - Math.PI / 2) * w + Math.sin(a) * w);
    c.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
    c.lineTo(cx + Math.cos(a + Math.PI / 2) * w + Math.cos(a) * w, cy + Math.sin(a + Math.PI / 2) * w + Math.sin(a) * w);
    c.closePath();
    c.fillStyle = long ? "#efe6d4" : "#d6a845";
    c.fill();
  }
  ring(R * 0.3, "#1f4c3b");
  ring(R * 0.28, "#d6a845");
  ring(R * 0.25, "#1f4c3b");
  drawLeafEmblem(c, cx, cy + R * 0.12, R * 0.2, "#e6bb55", "#1f4c3b");
  c.restore();
}

/** A botanical print on cream paper: a banana leaf, or a bunch with its flower. */
function print(c: Ctx, X: number, Y: number, W: number, H: number, kind: "leaf" | "bunch") {
  c.save();
  c.translate(X, Y);
  c.fillStyle = "#f3ecdb";
  c.fillRect(6, 6, W - 12, H - 12);
  c.strokeStyle = "#b8975a";
  c.lineWidth = 2;
  c.strokeRect(24, 24, W - 48, H - 48);
  if (kind === "leaf") {
    const g = c.createLinearGradient(W / 2, H * 0.85, W / 2, H * 0.12);
    g.addColorStop(0, "#2f5a2c");
    g.addColorStop(1, "#6a9a4a");
    bananaLeaf(c, W * 0.45, H * 0.86, 0.12, H * 0.72, W * 0.2, g, "#c9d9a2", "rgba(243,236,219,0.9)");
    c.strokeStyle = "#5a7a3a";
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(W * 0.45, H * 0.86);
    c.lineTo(W * 0.44, H * 0.9);
    c.stroke();
  } else {
    c.strokeStyle = "#5a7a3a";
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(W * 0.5, H * 0.1);
    c.quadraticCurveTo(W * 0.56, H * 0.4, W * 0.5, H * 0.72);
    c.stroke();
    for (let i = 0; i < 12; i++) {
      const row = Math.floor(i / 4);
      const col = i % 4;
      bananaShape(c, W * (0.36 + col * 0.09), H * (0.26 + row * 0.12), -1.15 + col * 0.25, W * 0.2, "#e9c24a", "#9a7020");
    }
    c.fillStyle = "#7a2a3a";
    c.beginPath();
    c.ellipse(W * 0.5, H * 0.75, W * 0.06, H * 0.07, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#a8495a";
    c.lineWidth = 2;
    c.stroke();
  }
  c.fillStyle = "#6b5a3a";
  c.font = "italic 20px Georgia, serif";
  c.textAlign = "center";
  c.fillText(kind === "leaf" ? "Musa acuminata" : "Musa × paradisiaca", W / 2, H - 38);
  c.restore();
}

// ------------------------------------------------------------------ geometry helpers

/** An arched panel (round head) w wide and h high in the XY plane, base centred at the origin, facing -Z, UVs 0..1. */
function archFace(w: number, h: number, n = 24): Geo {
  const g = new Geo();
  const r = w / 2;
  const sh = h - r;
  const pts: [number, number][] = [[-r, 0], [r, 0]];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([Math.cos(a) * r, sh + Math.sin(a) * r]);
  }
  const c = g.vert(0, h / 2, 0, 0.5, 0.5, 0, 0, -1);
  const idx = pts.map(([x, y]) => g.vert(x, y, 0, x / w + 0.5, y / h, 0, 0, -1));
  for (let i = 0; i < idx.length; i++) g.tri(c, idx[i], idx[(i + 1) % idx.length]);
  return fixWinding(g);
}

/** The outline of archFace(w, h), as a closed path (local XY, z = dz). */
function archLine(w: number, h: number, dz = 0, n = 24): Vector3[] {
  const r = w / 2;
  const sh = h - r;
  const pts = [new Vector3(0, 0, dz), new Vector3(r, 0, dz)];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push(new Vector3(Math.cos(a) * r, sh + Math.sin(a) * r, dz));
  }
  pts.push(new Vector3(-r, 0, dz), new Vector3(0, 0, dz));
  return pts;
}

/** Closed ellipse at height y. */
function ellipse(cx: number, y: number, cz: number, rx: number, rz: number, n = 40): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(new Vector3(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz));
  }
  return out;
}

/** Cubic Bézier sampled into n + 1 points. */
function bez(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, n = 12): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(p0.scale(u * u * u).add(p1.scale(3 * u * u * t)).add(p2.scale(3 * u * t * t)).add(p3.scale(t * t * t)));
  }
  return out;
}

/** A banana: curving up out of +X from the origin, length about 1.3 R, tapering at both ends. */
function banana(R: number, thick: number): Geo {
  const path: Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * 1.15;
    path.push(new Vector3(R * Math.sin(t), R * (1 - Math.cos(t)), 0));
  }
  return tube(path, (t) => thick * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.6), 8, true);
}

function shiftUV(g: Geo, du: number, dv: number): Geo {
  for (let i = 0; i < g.uv.length; i += 2) {
    g.uv[i] += du;
    g.uv[i + 1] += dv;
  }
  return g;
}

const hexRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ------------------------------------------------------------------ the room

/** Build the bathroom on one floor. */
export function buildBathroom(ctx: WorldCtx, level: "lower" | "upper"): void {
  bathMats(ctx);
  const z: Zone = zone("bathroom", level);
  const y0 = level === "lower" ? LEVEL.lower : LEVEL.upper;
  const r = rng(level === "lower" ? 301 : 302);
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, door } = BATH;
  // the faces of the cladding
  const CX0 = X0 + CLAD;
  const CX1 = X1 - CLAD;
  const CZ0 = Z0 + CLAD;
  const CZ1 = Z1 - CLAD;
  const G = (mat: string) => ctx.g(z, mat, { castShadow: false });
  const cloth = (g: Geo, hex: string) => g.paint(...hexRGB(hex));
  const v = (x: number, y: number, zz: number) => new Vector3(x, y0 + y, zz);

  // no leaf reaches through the walls, the partitions or the shower glass
  ctx.wall([{ x: X0, z: Z0 }, { x: X0, z: Z1 }, { x: X1, z: Z1 }, { x: X1, z: Z0 }, { x: X0, z: Z0 }], y0 - 0.1, y0 + CEIL);

  // ---------------------------------------------------------------- floor
  G("bathFloor").add(box(X1 - X0, FLOOR - 0.014, Z1 - Z0), xf((X0 + X1) / 2, y0 + (FLOOR + 0.014) / 2, (Z0 + Z1) / 2), "Marble floor");
  // the threshold through the doorway
  G("bathVerde").add(box(door.x1 - door.x0, FLOOR - 0.008, Z0 - (door.wall - 0.075)), xf((door.x0 + door.x1) / 2, y0 + (FLOOR + 0.008) / 2, (door.wall - 0.075 + Z0) / 2), "Marble threshold");
  // a verde border band with a gold pinstripe inside it, set 0.14 in from the walls
  const band = (inset: number, w: number, h: number, mat: string, label: string) => {
    const a = { x0: CX0 + inset, x1: CX1 - inset, z0: CZ0 + inset, z1: CZ1 - inset };
    const y = y0 + FLOOR + h / 2;
    G(mat).add(box(a.x1 - a.x0, h, w), xf((a.x0 + a.x1) / 2, y, a.z0 + w / 2), label);
    G(mat).add(box(a.x1 - a.x0, h, w), xf((a.x0 + a.x1) / 2, y, a.z1 - w / 2), label);
    G(mat).add(box(w, h, a.z1 - a.z0 - 2 * w), xf(a.x0 + w / 2, y, (a.z0 + a.z1) / 2), label);
    G(mat).add(box(w, h, a.z1 - a.z0 - 2 * w), xf(a.x1 - w / 2, y, (a.z0 + a.z1) / 2), label);
  };
  band(0.14, 0.15, 0.0016, "bathVerde", "Verde floor border");
  band(0.33, 0.012, 0.0022, "bathGold", "Gold floor inlay");
  // the medallion before the tub
  const TX = (X0 + X1) / 2;
  const TZ = CZ1 - 0.14 - 0.42;
  const MZ = TZ - 1.2;
  G("bathGold").add(disc(0.6, 64), xf(TX, y0 + FLOOR + 0.0024, MZ), "Floor medallion");
  G("bathArt").add(disc(0.57, 64).remapUV(...ART.medallion), xf(TX, y0 + FLOOR + 0.0034, MZ), "Floor medallion");

  // ---------------------------------------------------------------- walls
  interface Run {
    along: "x" | "z";
    at: number;
    s: 1 | -1;
    a: number;
    b: number;
    gap?: [number, number, number];
  }
  const runs: Run[] = [
    { along: "x", at: Z0, s: 1, a: X0, b: X1, gap: [door.x0, door.x1, door.h] },
    { along: "x", at: Z1, s: -1, a: X0, b: X1 },
    { along: "z", at: X0, s: 1, a: Z0, b: Z1 },
    { along: "z", at: X1, s: -1, a: Z0, b: Z1 },
  ];
  const piece = (mat: string, run: Run, a: number, b: number, ya: number, yb: number, t: number, label: string, du = 0) => {
    if (b - a < 0.005 || yb - ya < 0.002) return;
    const g = box(run.along === "x" ? b - a : t, yb - ya, run.along === "x" ? t : b - a);
    if (du) shiftUV(g, du, du * 0.37);
    const c = run.at + run.s * (t / 2 - 0.005);
    const m = (a + b) / 2;
    G(mat).add(g, run.along === "x" ? xf(m, y0 + (ya + yb) / 2, c) : xf(c, y0 + (ya + yb) / 2, m), label);
  };
  const span = (run: Run, mat: string, ya: number, yb: number, t: number, label: string, slabs = false) => {
    const segs: [number, number, number, number][] = [];
    const g = run.gap;
    if (!g || ya >= g[2]) segs.push([run.a, run.b, ya, yb]);
    else {
      const top = Math.min(yb, g[2]);
      segs.push([run.a, g[0], ya, top], [g[1], run.b, ya, top]);
      if (yb > g[2]) segs.push([run.a, run.b, g[2], yb]);
    }
    for (const [a, b, y1, y2] of segs) {
      const n = slabs ? Math.max(1, Math.round((b - a) / 1.25)) : 1;
      for (let i = 0; i < n; i++) piece(mat, run, a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n, y1, y2, t, label, slabs ? r() * 3 : 0);
    }
  };
  for (const run of runs) {
    span(run, "bathVerde", FLOOR, 0.15, CLAD + 0.015, "Verde skirting");
    span(run, "bathMarble", 0.15, 2.6, CLAD + 0.005, "Marble wall", true);
    span(run, "bathGold", 2.6, 2.65, CLAD + 0.02, "Gold band");
    span(run, "bathWalnut", 2.65, CEIL, CLAD + 0.005, "Fluted walnut");
    for (let p = run.a + 0.08; p < run.b - 0.08; p += 0.07) piece("bathWalnut", run, p - 0.0175, p + 0.0175, 2.67, CEIL - 0.02, CLAD + 0.016, "Fluted walnut");
  }
  // the doorway lined in walnut, with a slim gold architrave on the room side
  const jz0 = door.wall - 0.075;
  const jz1 = CZ0 + 0.006;
  const jambs = G("bathWalnut");
  jambs.add(box(0.03, door.h - 0.012, jz1 - jz0), xf(door.x0 + 0.015, y0 + 0.012 + (door.h - 0.012) / 2, (jz0 + jz1) / 2), "Door lining");
  jambs.add(box(0.03, door.h - 0.012, jz1 - jz0), xf(door.x1 - 0.015, y0 + 0.012 + (door.h - 0.012) / 2, (jz0 + jz1) / 2), "Door lining");
  jambs.add(box(door.x1 - door.x0, 0.03, jz1 - jz0), xf((door.x0 + door.x1) / 2, y0 + door.h - 0.015, (jz0 + jz1) / 2), "Door lining");
  const arch = G("bathGold");
  arch.add(box(0.035, door.h, 0.012), xf(door.x0 - 0.0175, y0 + door.h / 2, CZ0 + 0.012), "Door architrave");
  arch.add(box(0.035, door.h, 0.012), xf(door.x1 + 0.0175, y0 + door.h / 2, CZ0 + 0.012), "Door architrave");
  arch.add(box(door.x1 - door.x0 + 0.07, 0.035, 0.012), xf((door.x0 + door.x1) / 2, y0 + door.h + 0.0175, CZ0 + 0.012), "Door architrave");

  // ---------------------------------------------------------------- ceiling and coffer
  const hole = { x0: X0 + 0.55, x1: X1 - 0.55, z0: Z0 + 0.75, z1: Z1 - 0.45 };
  const rect = (a: { x0: number; x1: number; z0: number; z1: number }): P2[] => [
    { x: a.x0, z: a.z0 },
    { x: a.x1, z: a.z0 },
    { x: a.x1, z: a.z1 },
    { x: a.x0, z: a.z1 },
  ];
  const ceil = G("bathCeiling");
  ceil.add(polygonFace(rect({ x0: X0, x1: X1, z0: Z0, z1: Z1 }), y0 + CEIL, false, [rect(hole).reverse()]), undefined, "Dropped ceiling");
  G("bathCoffer").add(polygonFace(rect(hole), y0 + COFFER, false), undefined, "Ceiling coffer");
  const cw = 0.02;
  const cofH = COFFER - CEIL;
  const cy = y0 + CEIL + cofH / 2;
  ceil.add(box(hole.x1 - hole.x0, cofH, cw), xf((hole.x0 + hole.x1) / 2, cy, hole.z0 - cw / 2), "Ceiling coffer");
  ceil.add(box(hole.x1 - hole.x0, cofH, cw), xf((hole.x0 + hole.x1) / 2, cy, hole.z1 + cw / 2), "Ceiling coffer");
  ceil.add(box(cw, cofH, hole.z1 - hole.z0), xf(hole.x0 - cw / 2, cy, (hole.z0 + hole.z1) / 2), "Ceiling coffer");
  ceil.add(box(cw, cofH, hole.z1 - hole.z0), xf(hole.x1 + cw / 2, cy, (hole.z0 + hole.z1) / 2), "Ceiling coffer");
  // the cove strip high in the coffer, and a gold bead round its edge
  const cove = G("amberStrip");
  const ly = y0 + COFFER - 0.035;
  cove.add(box(hole.x1 - hole.x0 - 0.04, 0.012, 0.012), xf((hole.x0 + hole.x1) / 2, ly, hole.z0 + 0.012), "Cove light");
  cove.add(box(hole.x1 - hole.x0 - 0.04, 0.012, 0.012), xf((hole.x0 + hole.x1) / 2, ly, hole.z1 - 0.012), "Cove light");
  cove.add(box(0.012, 0.012, hole.z1 - hole.z0 - 0.04), xf(hole.x0 + 0.012, ly, (hole.z0 + hole.z1) / 2), "Cove light");
  cove.add(box(0.012, 0.012, hole.z1 - hole.z0 - 0.04), xf(hole.x1 - 0.012, ly, (hole.z0 + hole.z1) / 2), "Cove light");
  const bead = G("bathGold");
  const by = y0 + CEIL - 0.01;
  bead.add(box(hole.x1 - hole.x0 + 0.06, 0.022, 0.03), xf((hole.x0 + hole.x1) / 2, by, hole.z0 - 0.005), "Ceiling bead");
  bead.add(box(hole.x1 - hole.x0 + 0.06, 0.022, 0.03), xf((hole.x0 + hole.x1) / 2, by, hole.z1 + 0.005), "Ceiling bead");
  bead.add(box(0.03, 0.022, hole.z1 - hole.z0), xf(hole.x0 - 0.005, by, (hole.z0 + hole.z1) / 2), "Ceiling bead");
  bead.add(box(0.03, 0.022, hole.z1 - hole.z0), xf(hole.x1 + 0.005, by, (hole.z0 + hole.z1) / 2), "Ceiling bead");
  // small gold-ringed downlights in the flat border of the ceiling
  for (const [x, zz] of [[CX0 + 0.35, 21.6], [CX0 + 0.35, 22.8], [CX1 - 0.3, 21.25], [CX1 - 0.3, 23.25], [TX, Z0 + 0.38]] as const) {
    G("bulb").add(disc(0.045, 20).flip(), xf(x, y0 + CEIL - 0.004, zz), "Downlight");
    G("bathGold").add(lathe([[0.045, -0.006], [0.065, -0.004], [0.065, 0.001]], 20), xf(x, y0 + CEIL, zz), "Downlight");
  }

  // ---------------------------------------------------------------- the tub, the mural, the chandelier
  const sx = 1.75 / 0.84;
  const tubProfile: [number, number][] = [
    [0.28, FLOOR],
    [0.33, 0.09],
    [0.39, 0.3],
    [0.42, 0.56],
    [0.425, 0.62],
    [0.405, 0.635],
    [0.385, 0.615],
    [0.36, 0.42],
    [0.32, 0.26],
    [0.24, 0.15],
    [0.001, 0.13],
  ];
  G("bathPorcelain").add(lathe(tubProfile, 56), xf(TX, y0, TZ, 0, sx, 1, 1), "Freestanding bathtub");
  const gold = G("bathGold");
  gold.add(tube(ellipse(TX, y0 + 0.627, TZ, 0.414 * sx, 0.414), 0.012, 8), undefined, "Freestanding bathtub");
  gold.add(tube(ellipse(TX, y0 + 0.075, TZ, 0.315 * sx, 0.315), 0.018, 8), undefined, "Freestanding bathtub");
  G("bathWater").add(disc(0.371, 48), xf(TX, y0 + 0.5, TZ, 0, sx, 1, 1), "Bath water");
  // bubbles at the far end, and a rubber duck
  const foam = new Geo();
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const fx = -0.48 + Math.cos(a) * d * 0.22;
    const fz = Math.sin(a) * d * 0.24;
    const s = 0.035 + r() * 0.035;
    foam.add(sphere(s, 10, 6, 0.55), xf(TX + fx, y0 + 0.5 + s * 0.15, TZ + fz));
  }
  G("bathCloth").add(cloth(foam, "#fbf8f2"), undefined, "Bubbles");
  const duck = new Geo();
  duck.add(cloth(sphere(0.045, 12, 8, 0.75), "#ffcf2e"), xf(0, 0.02, 0));
  duck.add(cloth(sphere(0.028, 10, 8), "#ffcf2e"), xf(-0.035, 0.065, 0));
  duck.add(cloth(sphere(0.012, 8, 6, 0.5), "#ff7a1a"), xf(-0.064, 0.06, 0, 0, 1.4, 1, 1));
  G("bathCloth").add(duck, xf(TX + 0.15, y0 + 0.5, TZ + 0.08, 0.5), "Rubber duck");
  // a walnut bath caddy across the tub, with a candle and a banana on it
  const cadX = TX + 0.32;
  G("bathWalnut").add(box(0.2, 0.022, 0.98), xf(cadX, y0 + 0.646, TZ), "Bath caddy");
  candle(ctx, z, v(cadX, 0.657, TZ - 0.2));
  G("bathCloth").add(cloth(banana(0.12, 0.02), "#f2c63c"), xf(cadX - 0.02, y0 + 0.675, TZ + 0.12, 0.3, 1, 1, 1, Math.PI / 2), "Banana");
  // the floor-standing filler at the east end
  const fx = TX + 0.414 * sx + 0.12;
  gold.add(cylinder(0.075, 0.018, 24), xf(fx, y0 + FLOOR, TZ), "Tub filler");
  gold.add(tube([v(fx, FLOOR, TZ), ...bez(v(fx, 0.9, TZ), v(fx, 1.08, TZ), v(fx - 0.16, 1.08, TZ), v(fx - 0.2, 0.86, TZ), 10)], 0.018, 12), undefined, "Tub filler");
  gold.add(cylinder(0.018, 0.04, 12), xf(fx, y0 + 0.62, TZ), "Tub filler");
  for (const s of [-1, 1]) gold.add(box(0.015, 0.015, 0.09), xf(fx, y0 + 0.64, TZ + s * 0.06), "Tub filler");
  // the arched mural behind the tub, framed in gold
  const muralW = 1.9;
  const muralH = 2.5;
  const muralZ = Z1 - 0.05;
  const mm = xf(TX, y0 + 0.72, muralZ);
  G("bathArt").add(archFace(muralW, muralH, 32).remapUV(...ART.mural), mm, "Jungle mural");
  gold.add(tube(archLine(muralW + 0.03, muralH + 0.015, 0, 32).map((p) => Vector3.TransformCoordinates(p, mm)), 0.026, 10), undefined, "Mural frame");
  // a banana plant on either side of the tub
  for (const px of [CX0 + 0.24, CX1 - 0.24]) pottedPlant(ctx, z, v(px, FLOOR, CZ1 - 0.3), "banana", { pot: "cream", potR: 0.2, potH: 0.5, scale: 0.85, r, label: "Banana plant" });
  // the chandelier over the tub
  chandelier(ctx, z, v(TX, 0, TZ - 0.12), y0 + COFFER, r);

  // ---------------------------------------------------------------- the double vanity (west wall)
  const VZ0 = 21.05;
  const VZ1 = 23.35;
  const VZ = (VZ0 + VZ1) / 2;
  const VD = 0.56;
  const VF = CX0 + VD;
  const wal = G("bathWalnut");
  wal.add(box(VD, 0.46, VZ1 - VZ0), xf(CX0 + VD / 2, y0 + 0.55, VZ), "Floating vanity");
  const dw = (VZ1 - VZ0 - 0.05) / 4;
  for (let i = 0; i < 4; i++) {
    const zc = VZ0 + 0.025 + dw * (i + 0.5);
    wal.add(box(0.02, 0.4, dw - 0.02), xf(VF + 0.01, y0 + 0.55, zc), "Vanity drawer");
    gold.add(tube([v(VF + 0.045, 0.66, zc - 0.11), v(VF + 0.045, 0.66, zc + 0.11)], 0.009, 8, true), undefined, "Drawer pull");
    for (const s of [-1, 1]) gold.add(box(0.03, 0.012, 0.012), xf(VF + 0.032, y0 + 0.66, zc + s * 0.1));
  }
  G("amberStrip").add(box(0.012, 0.006, VZ1 - VZ0 - 0.1), xf(VF - 0.05, y0 + 0.317, VZ), "Vanity under-glow");
  G("bathVerde").add(box(VD + 0.03, 0.045, VZ1 - VZ0 + 0.04), xf(CX0 + (VD + 0.03) / 2, y0 + 0.8425, VZ), "Verde vanity top");
  gold.add(box(0.006, 0.045, VZ1 - VZ0 + 0.04), xf(CX0 + VD + 0.033, y0 + 0.8425, VZ), "Verde vanity top");
  const top = 0.865;
  for (const bz of [VZ - 0.58, VZ + 0.58]) {
    const bx = CX0 + 0.3;
    const basin: [number, number][] = [
      [0.1, top],
      [0.17, top + 0.03],
      [0.205, top + 0.1],
      [0.21, top + 0.135],
      [0.198, top + 0.142],
      [0.188, top + 0.13],
      [0.17, top + 0.06],
      [0.09, top + 0.03],
      [0.001, top + 0.025],
    ];
    G("bathPorcelain").add(lathe(basin, 36, false, true), xf(bx, y0, bz), "Vessel basin");
    gold.add(disc(0.025, 16), xf(bx, y0 + top + 0.027, bz), "Vessel basin");
    // a gold gooseneck tap behind it, a lever beside
    const tx = CX0 + 0.06;
    gold.add(cylinder(0.03, 0.02, 16), xf(tx, y0 + top, bz), "Basin tap");
    gold.add(tube([v(tx, top, bz), ...bez(v(tx, top + 0.28, bz), v(tx, top + 0.42, bz), v(bx - 0.06, top + 0.42, bz), v(bx - 0.02, top + 0.3, bz), 12)], 0.013, 10), undefined, "Basin tap");
    gold.add(tube([v(tx, top + 0.1, bz + 0.035), v(tx + 0.07, top + 0.14, bz + 0.05)], 0.007, 6, true), undefined, "Basin tap");
    // the arched mirror above, its gold frame
    const mm2 = xf(CX0 + 0.012, y0 + 1.12, bz, faceYaw(1, 0));
    G("bathMirror").add(archFace(0.66, 1.05), mm2, "Arched mirror");
    gold.add(tube(archLine(0.68, 1.06).map((p) => Vector3.TransformCoordinates(p, mm2)), 0.02, 10), undefined, "Mirror frame");
  }
  // three gold globe sconces
  for (const sz of [VZ0 + 0.02, VZ, VZ1 - 0.02]) {
    const sy = y0 + 1.78;
    gold.add(cylinder(0.055, 0.016, 20), xf(CX0, sy, sz, 0, 1, 1, 1, 0, -Math.PI / 2), "Wall sconce");
    gold.add(tube([new Vector3(CX0 + 0.01, sy, sz), new Vector3(CX0 + 0.09, sy - 0.03, sz), new Vector3(CX0 + 0.13, sy + 0.02, sz)], 0.009, 8), undefined, "Wall sconce");
    gold.add(lathe([[0.025, 0], [0.035, 0.02], [0.03, 0.03]], 16), xf(CX0 + 0.13, sy + 0.01, sz), "Wall sconce");
    G("bulb").add(sphere(0.07, 16, 12), xf(CX0 + 0.13, sy + 0.1, sz), "Wall sconce");
  }
  // on the counter: rolled towels, a plant, a gold banana bunch, soap and a candle
  const ct = y0 + top;
  const towels = new Geo();
  for (const [dz, dy, dx, col] of [[-0.07, 0, 0, "#a8e2cf"], [0.07, 0, 0, "#a8e2cf"], [0, 0.09, 0, "#f3ead8"]] as const)
    towels.add(cloth(cylinder(0.045, 0.24, 14), col), xf(CX0 + 0.26 + dx, ct + 0.045 + dy, VZ0 + 0.17 + dz, 0, 1, 1, 1, 0, Math.PI / 2));
  G("bathCloth").add(towels, undefined, "Rolled towels");
  pottedPlant(ctx, z, v(CX0 + 0.13, top, VZ + 0.16), "bromeliad", { pot: "cream", potR: 0.065, potH: 0.11, scale: 0.4, r, label: "Little bromeliad" });
  bananaBunch(ctx, z, v(CX0 + 0.3, top, VZ - 0.12));
  for (const bz of [VZ1 - 0.14]) {
    G("bathAmber").add(lathe([[0.035, 0], [0.038, 0.12], [0.02, 0.15], [0.012, 0.16]], 16, true, true), xf(CX0 + 0.14, ct, bz), "Soap bottle");
    gold.add(new Geo().add(cylinder(0.01, 0.05, 8)).add(box(0.05, 0.012, 0.014), xf(0.02, 0.05, 0)), xf(CX0 + 0.14, ct + 0.16, bz), "Soap bottle");
    gold.add(cylinder(0.09, 0.008, 24), xf(CX0 + 0.3, ct, bz), "Gold tray");
    candle(ctx, z, v(CX0 + 0.3, top + 0.008, bz));
  }
  // a plush rug before the vanity
  G("bathCloth").add(cloth(softBox(0.64, 0.018, 1.5, 0.008), "#efe6d4"), xf(VF + 0.48, y0 + FLOOR + 0.0105, VZ), "Bath rug");
  G("bathCloth").add(cloth(softBox(0.54, 0.02, 1.4, 0.008), "#1d4639"), xf(VF + 0.48, y0 + FLOOR + 0.012, VZ), "Bath rug");

  // ---------------------------------------------------------------- the golden toilet, the bidet (east wall)
  // the golden throne on a low verde dais with a gold nosing
  const DAIS = 0.06;
  G("bathVerde").add(box(0.78, DAIS - FLOOR, 0.66), xf(CX1 - 0.39, y0 + (FLOOR + DAIS) / 2, 20.95), "Toilet dais");
  gold.add(box(0.012, 0.012, 0.67), xf(CX1 - 0.78, y0 + DAIS - 0.003, 20.95), "Toilet dais");
  goldenToilet(ctx, z, v(CX1, DAIS - 0.03, 20.95));
  bidet(ctx, z, v(CX1, 0, 21.68));
  // paper holder
  gold.add(box(0.1, 0.02, 0.02), xf(CX1 - 0.05, y0 + 0.72, 20.5), "Paper holder");
  gold.add(cylinder(0.035, 0.008, 16), xf(CX1, y0 + 0.72, 20.5, 0, 1, 1, 1, 0, Math.PI / 2), "Paper holder");
  G("bathCloth").add(cloth(cylinder(0.058, 0.11, 18), "#fbf9f3"), xf(CX1 - 0.1, y0 + 0.66, 20.445, 0, 1, 1, 1, Math.PI / 2), "Paper roll");
  // the shelf above, with candles and a little gold chimp
  const shY = y0 + 1.2;
  G("bathVerde").add(box(0.16, 0.04, 1.4), xf(CX1 - 0.08, shY, 21.3), "Marble shelf");
  gold.add(box(0.006, 0.04, 1.4), xf(CX1 - 0.163, shY, 21.3), "Marble shelf");
  for (const sz of [20.72, 20.84]) candle(ctx, z, v(CX1 - 0.08, 1.22, sz));
  chimpBust(ctx, z, v(CX1 - 0.08, 1.22, 21.25));
  G("bathAmber").add(lathe([[0.04, 0], [0.042, 0.08], [0.015, 0.11], [0.012, 0.13]], 16, true, true), xf(CX1 - 0.08, shY + 0.02, 21.8), "Reed diffuser");
  for (let i = 0; i < 5; i++) G("bathWalnut").add(cylinder(0.003, 0.3, 4), xf(CX1 - 0.08 + (i - 2) * 0.006, shY + 0.13, 21.8 + (i % 2) * 0.006, 0, 1, 1, 1, (i - 2) * 0.1, 0.08));
  // two framed banana botanicals
  for (const [pz, uv] of [[20.95, ART.printLeaf], [21.65, ART.printBunch]] as [number, [number, number, number, number]][]) {
    const pm = xf(CX1 - 0.022, y0 + 1.85, pz, faceYaw(-1, 0));
    G("bathArt").add(planeUV(0.42, 0.56).remapUV(...uv), pm, "Botanical print");
    const f = new Geo();
    f.add(box(0.5, 0.04, 0.02), xf(0, 0.3, 0.005));
    f.add(box(0.5, 0.04, 0.02), xf(0, -0.3, 0.005));
    f.add(box(0.04, 0.64, 0.02), xf(0.23, 0, 0.005));
    f.add(box(0.04, 0.64, 0.02), xf(-0.23, 0, 0.005));
    gold.add(f, pm, "Print frame");
  }

  // ---------------------------------------------------------------- the rain shower (north-east)
  const SX0 = 0.0;
  const SZ0 = 22.3;
  const SZ1 = 24.2;
  const pt = 0.08;
  const partH = 2.2;
  const marb = G("bathMarble");
  for (const [pz, label] of [[SZ0, "Marble partition"], [SZ1, "Shower wall"]] as const) {
    marb.add(box(CX1 - SX0, partH - FLOOR, pt), xf((SX0 + CX1) / 2, y0 + FLOOR + (partH - FLOOR) / 2, pz), label);
    gold.add(box(CX1 - SX0 + 0.01, 0.02, pt + 0.01), xf((SX0 + CX1) / 2 - 0.005, y0 + partH + 0.01, pz), label);
    gold.add(box(0.012, partH - FLOOR, pt + 0.004), xf(SX0 - 0.006, y0 + FLOOR + (partH - FLOOR) / 2, pz), label);
  }
  ctx.wall([{ x: SX0, z: SZ0 }, { x: X1, z: SZ0 }], y0 - 0.1, y0 + partH);
  ctx.wall([{ x: SX0, z: SZ1 }, { x: X1, z: SZ1 }], y0 - 0.1, y0 + partH);
  ctx.wall([{ x: SX0, z: 23.05 }, { x: SX0, z: SZ1 }], y0 - 0.1, y0 + 2.1);
  const tray0 = SZ0 + pt / 2;
  const tray1 = SZ1 - pt / 2;
  G("bathMosaic").add(box(CX1 - SX0, 0.02, tray1 - tray0), xf((SX0 + CX1) / 2, y0 + FLOOR + 0.01, (tray0 + tray1) / 2), "Mosaic shower floor");
  gold.add(box(0.7, 0.003, 0.05), xf((SX0 + CX1) / 2, y0 + FLOOR + 0.0215, tray1 - 0.1), "Linear drain");
  // the glass pane on its west side, in a slim gold frame
  const gz0 = 23.05;
  G("glass").add(box(0.012, 2.05, tray1 - gz0), xf(SX0, y0 + FLOOR + 0.02 + 1.025, (gz0 + tray1) / 2), "Shower glass");
  gold.add(box(0.03, 0.03, tray1 - gz0), xf(SX0, y0 + 2.1 + 0.015, (gz0 + tray1) / 2), "Shower glass");
  gold.add(box(0.03, 0.03, tray1 - gz0), xf(SX0, y0 + FLOOR + 0.035, (gz0 + tray1) / 2), "Shower glass");
  gold.add(box(0.03, 2.1 - FLOOR - 0.02, 0.03), xf(SX0, y0 + FLOOR + 0.02 + (2.1 - FLOOR - 0.02) / 2, gz0), "Shower glass");
  gold.add(tube([v(SX0, 2.1, gz0 + 0.5), v(CX1, 2.1, gz0 + 0.5)], 0.009, 8, true), undefined, "Shower glass stay");
  // the rain head on its arm, the valve, a hand shower
  const rhX = 0.5;
  const rhZ = (tray0 + tray1) / 2;
  gold.add(tube([v(CX1, 2.5, rhZ), v(rhX, 2.5, rhZ), v(rhX, 2.42, rhZ)], 0.014, 10), undefined, "Rain shower");
  gold.add(box(0.34, 0.02, 0.34), xf(rhX, y0 + 2.41, rhZ), "Rain shower");
  G("bathCeiling").add(box(0.3, 0.002, 0.3), xf(rhX, y0 + 2.3995, rhZ), "Rain shower");
  gold.add(cylinder(0.07, 0.015, 24), xf(CX1, y0 + 1.15, SZ0 + 0.35, 0, 1, 1, 1, 0, Math.PI / 2), "Shower valve");
  gold.add(box(0.06, 0.016, 0.016), xf(CX1 - 0.04, y0 + 1.15, SZ0 + 0.35), "Shower valve");
  gold.add(tube([v(CX1 - 0.015, 0.95, SZ0 + 0.6), v(CX1 - 0.015, 1.75, SZ0 + 0.6)], 0.01, 8, true), undefined, "Hand shower");
  gold.add(tube([v(CX1 - 0.03, 1.45, SZ0 + 0.6), v(CX1 - 0.09, 1.62, SZ0 + 0.6)], 0.018, 10, true), undefined, "Hand shower");
  // a lit niche in the wall, with two bottles
  const nz = SZ1 - 0.6;
  const ny0 = y0 + 1.05;
  const nW = 0.5;
  const nH = 0.36;
  const nd = 0.1;
  G("bathVerde").add(box(0.01, nH, nW), xf(CX1 - 0.005, ny0 + nH / 2, nz), "Shower niche");
  const nf = new Geo();
  nf.add(box(nd, 0.02, nW + 0.04), xf(-nd / 2, nH + 0.01, 0));
  nf.add(box(nd, 0.02, nW + 0.04), xf(-nd / 2, -0.01, 0));
  nf.add(box(nd, nH, 0.02), xf(-nd / 2, nH / 2, nW / 2 + 0.01));
  nf.add(box(nd, nH, 0.02), xf(-nd / 2, nH / 2, -nW / 2 - 0.01));
  gold.add(nf, xf(CX1, ny0, nz), "Shower niche");
  G("mint").add(box(0.01, 0.006, nW - 0.02), xf(CX1 - 0.05, ny0 + nH - 0.006, nz), "Niche light");
  G("bathAmber").add(lathe([[0.03, 0], [0.032, 0.17], [0.012, 0.2], [0.01, 0.22]], 16, true, true), xf(CX1 - 0.05, ny0, nz - 0.1), "Shampoo");
  G("bathPorcelain").add(lathe([[0.03, 0], [0.032, 0.13], [0.012, 0.16], [0.01, 0.18]], 16, true, true), xf(CX1 - 0.05, ny0, nz + 0.06), "Body wash");

  // ---------------------------------------------------------------- corners: a towel warmer, a palm
  const twX = CX0 + 0.075;
  const twZ = 20.38;
  for (const s of [-1, 1]) {
    gold.add(cylinder(0.014, 1.15, 12), xf(twX, y0 + 0.25, twZ + s * 0.25), "Towel warmer");
    for (const hy of [0.4, 1.25]) gold.add(tube([v(CX0, hy, twZ + s * 0.25), v(twX, hy, twZ + s * 0.25)], 0.008, 6), undefined, "Towel warmer");
  }
  for (let i = 0; i < 8; i++) gold.add(tube([v(twX, 0.3 + i * 0.14, twZ - 0.25), v(twX, 0.3 + i * 0.14, twZ + 0.25)], 0.009, 8), undefined, "Towel warmer");
  const tw = new Geo();
  // a mint bath towel folded over the top rung, an amber stripe near its hem; a cream hand towel lower down
  const drape = (y: number, front: number, back: number, wide: number, col: string) => {
    tw.add(cloth(cylinder(0.026, wide, 14), col), xf(twX, y0 + y, twZ, 0, 1, 1, 1, Math.PI / 2));
    tw.add(cloth(softBox(0.02, front, wide, 0.007), col), xf(twX + 0.02, y0 + y - front / 2, twZ));
    tw.add(cloth(softBox(0.02, back, wide, 0.007), col), xf(twX - 0.02, y0 + y - back / 2, twZ));
  };
  drape(1.28, 0.54, 0.3, 0.44, "#a8e2cf");
  tw.add(cloth(box(0.004, 0.045, 0.43), "#f0a64a"), xf(twX + 0.0315, y0 + 0.84, twZ));
  drape(0.58, 0.28, 0.14, 0.3, "#f3ead8");
  G("bathCloth").add(tw, undefined, "Plush towels");
  pottedPlant(ctx, z, v(CX1 - 0.28, FLOOR, CZ0 + 0.28), "palm", { pot: "cream", potR: 0.2, potH: 0.46, scale: 0.9, narrow: 0.75, r, label: "Corner palm" });

  // ---------------------------------------------------------------- lights (the room has no windows)
  roomLight(ctx, "bathroom", level, v(TX, 2.75, TZ - 0.3), 4.5, 3.3, 6.5, "#ffc27a");
  roomLight(ctx, "bathroom", level, v(CX0 + 0.9, 2.1, VZ), 3.6, 2.6, 5.5, "#ffc98a");
  roomLight(ctx, "bathroom", level, v(0.2, 2.7, 20.9), 3.4, 2.5, 5.5, "#ffb766");
  roomLight(ctx, "bathroom", level, v(0.5, 2.2, 23.25), 2.6, 1.9, 4.5, "#ffd7a0");
}

/** A quad w × h facing -Z with UVs 0..1 (like plane(), kept here so the art can be remapped). */
function planeUV(w: number, h: number): Geo {
  const g = new Geo();
  const a = g.vert(-w / 2, -h / 2, 0, 0, 0, 0, 0, -1);
  const b = g.vert(w / 2, -h / 2, 0, 1, 0, 0, 0, -1);
  const c = g.vert(w / 2, h / 2, 0, 1, 1, 0, 0, -1);
  const d = g.vert(-w / 2, h / 2, 0, 0, 1, 0, 0, -1);
  g.tri(a, b, c);
  g.tri(a, c, d);
  return fixWinding(g);
}

/** A candle in a glass holder on a gold foot. Base at p. */
function candle(ctx: WorldCtx, z: Zone, p: Vector3): void {
  ctx.g(z, "glass", { castShadow: false }).add(cylinder(0.045, 0.1, 14, false), xf(p.x, p.y, p.z), "Candle");
  ctx.g(z, "bulb", { castShadow: false }).add(cylinder(0.026, 0.05, 12), xf(p.x, p.y + 0.008, p.z), "Candle");
  ctx.g(z, "bathGold", { castShadow: false }).add(cylinder(0.05, 0.008, 16), xf(p.x, p.y, p.z), "Candle");
}

/** The polished golden toilet against the wall at x = wall.x, facing west. */
function goldenToilet(ctx: WorldCtx, z: Zone, wall: Vector3): void {
  const g = new Geo();
  // local: front is -Z, the wall at local z = +0.53
  const bowl: [number, number][] = [
    [0.12, 0.03],
    [0.13, 0.08],
    [0.11, 0.17],
    [0.13, 0.27],
    [0.18, 0.37],
    [0.19, 0.4],
    [0.172, 0.405],
    [0.15, 0.37],
    [0.09, 0.27],
    [0.001, 0.25],
  ];
  g.add(lathe(bowl, 40), xf(0, 0, 0.05, 0, 1, 1, 1.28));
  g.add(softBox(0.24, 0.3, 0.26, 0.05), xf(0, 0.2, 0.3));
  // seat and the raised lid
  g.add(tube(ellipse(0, 0.418, 0.05, 0.168, 0.215, 40), 0.022, 10));
  g.add(cylinder(0.19, 0.022, 36), xf(0, 0.64, 0.33, 0, 1, 1, 1.18, -1.42));
  g.add(softBox(0.12, 0.04, 0.05, 0.015), xf(0, 0.43, 0.3));
  // the tank, its lid, and a banana-shaped flush lever
  g.add(softBox(0.46, 0.38, 0.18, 0.04, 0.05), xf(0, 0.63, 0.43));
  g.add(softBox(0.49, 0.04, 0.21, 0.015), xf(0, 0.84, 0.43));
  g.add(banana(0.06, 0.012), xf(-0.21, 0.74, 0.34, Math.PI / 2, 1, 1, 1, 0, Math.PI));
  ctx.g(z, "bathGold", { castShadow: false }).add(g, xf(wall.x - 0.53, wall.y, wall.z, faceYaw(-1, 0)), "Golden toilet");
  ctx.g(z, "bathWater", { castShadow: false }).add(disc(0.1, 24), xf(wall.x - 0.53 + 0.05, wall.y + 0.31, wall.z, 0, 1.28, 1, 1), "Toilet water");
}

/** A porcelain bidet with a gold rim and tap, against the wall at x = wall.x, facing west. */
function bidet(ctx: WorldCtx, z: Zone, wall: Vector3): void {
  const prof: [number, number][] = [
    [0.12, 0.03],
    [0.14, 0.12],
    [0.17, 0.3],
    [0.18, 0.38],
    [0.165, 0.39],
    [0.14, 0.33],
    [0.07, 0.25],
    [0.001, 0.24],
  ];
  const m = xf(wall.x - 0.33, wall.y, wall.z, faceYaw(-1, 0));
  const p = new Geo();
  p.add(lathe(prof, 36), xf(0, 0, 0, 0, 1, 1, 1.3));
  p.add(softBox(0.26, 0.36, 0.16, 0.05), xf(0, 0.21, 0.22));
  ctx.g(z, "bathPorcelain", { castShadow: false }).add(p, m, "Bidet");
  const g = new Geo();
  g.add(tube(ellipse(0, 0.388, 0, 0.172, 0.172 * 1.3, 36), 0.01, 8));
  g.add(cylinder(0.022, 0.02, 12), xf(0, 0.39, 0.2));
  g.add(tube([new Vector3(0, 0.4, 0.2), new Vector3(0, 0.47, 0.2), new Vector3(0, 0.47, 0.12)], 0.011, 8, true));
  g.add(box(0.06, 0.014, 0.014), xf(0.05, 0.45, 0.22));
  ctx.g(z, "bathGold", { castShadow: false }).add(g, m, "Bidet");
}

/** A gold sculpture of a bunch of bananas on a little verde plinth. Base at p. */
function bananaBunch(ctx: WorldCtx, z: Zone, p: Vector3): void {
  ctx.g(z, "bathVerde", { castShadow: false }).add(box(0.12, 0.03, 0.12), xf(p.x, p.y + 0.015, p.z), "Gold banana bunch");
  const g = new Geo();
  g.add(cylinder(0.012, 0.17, 8, true, 0.008), xf(0, 0.03, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(banana(0.085, 0.017), xf(0, 0.07 + (i % 2) * 0.03, 0, a, 1, 1, 1, 0, -0.35));
  }
  ctx.g(z, "bathGold", { castShadow: false }).add(g, xf(p.x, p.y, p.z), "Gold banana bunch");
}

/** A little gold chimp bust facing west. Base at p. */
function chimpBust(ctx: WorldCtx, z: Zone, p: Vector3): void {
  const g = new Geo();
  g.add(cylinder(0.045, 0.02, 20));
  // shoulders, a round head, the chimp's big muzzle and brow, and its wide ears
  g.add(sphere(0.06, 16, 12), xf(0, 0.05, 0, 0, 1.35, 0.7, 0.8));
  g.add(sphere(0.042, 16, 12), xf(0, 0.125, 0.004));
  // the muzzle pushed forward and down, a heavy brow ridge, and big round ears
  g.add(sphere(0.03, 14, 10), xf(0, 0.112, -0.032, 0, 1.15, 0.85, 1));
  g.add(sphere(0.02, 12, 8), xf(0, 0.148, -0.03, 0, 2.0, 0.6, 0.9));
  for (const s of [-1, 1]) g.add(sphere(0.02, 12, 8), xf(s * 0.047, 0.13, 0.008, 0, 0.45, 1, 1));
  ctx.g(z, "bathGold", { castShadow: false }).add(g, xf(p.x, p.y, p.z, faceYaw(-1, 0), 1.45, 1.45, 1.45), "Gold chimp bust");
}

/** The crystal chandelier, hanging from the coffer at ceilY over p (x, z). */
function chandelier(ctx: WorldCtx, z: Zone, p: Vector3, ceilY: number, r: () => number): void {
  const gold = ctx.g(z, "bathGold", { castShadow: false });
  const cryst = ctx.g(z, "bathCrystal", { castShadow: false });
  const flame = ctx.g(z, "bulb", { castShadow: false });
  const yL = ceilY - 1.0; // the lower ring
  const yU = yL + 0.32;
  const P = (dx: number, y: number, dz: number) => new Vector3(p.x + dx, y, p.z + dz);
  gold.add(lathe([[0.001, -0.02], [0.08, -0.01], [0.08, 0.0]], 24), xf(p.x, ceilY, p.z), "Chandelier");
  gold.add(tube([P(0, ceilY, 0), P(0, yL - 0.05, 0)], 0.012, 8), undefined, "Chandelier");
  gold.add(sphere(0.06, 16, 12), xf(p.x, yL + 0.02, p.z), "Chandelier");
  gold.add(lathe([[0.001, -0.2], [0.03, -0.17], [0.05, -0.08], [0.03, 0], [0.001, 0.01]], 16), xf(p.x, yL, p.z), "Chandelier");
  cryst.add(sphere(0.03, 8, 6, 1.6), xf(p.x, yL - 0.25, p.z), "Chandelier crystal");
  const ring = (R: number, y: number, n: number, rr: number) => {
    gold.add(tube(ellipse(p.x, y, p.z, R, R, 48), rr, 8), undefined, "Chandelier");
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (y === yU ? Math.PI / n : 0);
      const cx = Math.cos(a) * R;
      const cz = Math.sin(a) * R;
      // an S-curved arm from the hub up to the candle cup
      gold.add(tube(bez(P(0, y - 0.05, 0), P(cx * 0.4, y - 0.12, cz * 0.4), P(cx * 0.9, y - 0.06, cz * 0.9), P(cx, y + 0.02, cz), 8), 0.008, 6), undefined, "Chandelier");
      gold.add(lathe([[0.012, 0], [0.03, 0.02], [0.032, 0.03]], 12), xf(p.x + cx, y + 0.02, p.z + cz), "Chandelier");
      flame.add(cylinder(0.011, 0.07, 8), xf(p.x + cx, y + 0.045, p.z + cz), "Chandelier candle");
      flame.add(sphere(0.016, 8, 6, 1.5), xf(p.x + cx, y + 0.13, p.z + cz), "Chandelier candle");
      // a crystal drop below each cup
      cryst.add(sphere(0.022, 8, 6, 1.6), xf(p.x + cx, y - 0.05, p.z + cz), "Chandelier crystal");
    }
    // swags of crystal beads between the cups
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + (y === yU ? Math.PI / n : 0);
      const a1 = ((i + 1) / n) * Math.PI * 2 + (y === yU ? Math.PI / n : 0);
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        const a = a0 + (a1 - a0) * t;
        const sag = Math.sin(Math.PI * t) * 0.09;
        cryst.add(sphere(0.011 + r() * 0.003, 6, 4), xf(p.x + Math.cos(a) * R * 1.02, y - 0.01 - sag, p.z + Math.sin(a) * R * 1.02), "Chandelier crystal");
      }
    }
  };
  ring(0.42, yL, 10, 0.012);
  ring(0.25, yU, 6, 0.01);
}
