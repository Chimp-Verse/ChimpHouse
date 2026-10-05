// Canopy suspension bridge from the upper side entrance to an anchor tree.

import { Vector3 } from "@babylonjs/core";
import { P2, ensureCCW, rng } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, polygonFace, torus, tube, wallStrip, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { BRIDGE, TREES, deckWestX, upperDeckLoop } from "../layout";
import { ledStrip } from "../structure/elements";
import { circle, trunkCollar } from "../structure/trunks";
import { trunkShape } from "./trunkShape";
import { hangingLantern, lanternPost } from "../props/lights";
import { vine } from "../props/plants";
import { railing } from "../structure/elements";

export function buildBridge(ctx: WorldCtx): void {
  const z = zone("bridge", "upper");
  const r = rng(808);
  const { start, end, width, sag } = BRIDGE;
  const S = new Vector3(start.x, start.y, start.z);
  const E = new Vector3(end.x, end.y, end.z);
  const len = Vector3.Distance(S, E);
  const dir = E.subtract(S).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const yaw = -Math.atan2(dir.z, dir.x);
  const point = (t: number) => {
    const p = Vector3.Lerp(S, E, t);
    p.y -= sag * 4 * t * (1 - t);
    return p;
  };
  // planks
  const planks = ctx.g(z, "deck");
  planks.setLabel("Bridge planks");
  const n = Math.round(len / 0.2);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = point(t);
    const t2 = point(Math.min(1, t + 0.01));
    const pitch = Math.atan2(t2.y - p.y, Vector3.Distance(new Vector3(t2.x, 0, t2.z), new Vector3(p.x, 0, p.z)));
    planks.add(box(0.18, 0.05, width), xf(p.x, p.y - 0.03, p.z, yaw, 1, 1, 1, 0, pitch));
  }
  // stringers and lower cables
  const line = (off: number, dy: number) => Array.from({ length: 41 }, (_, i) => point(i / 40).add(side.scale(off)).add(new Vector3(0, dy, 0)));
  const str = ctx.g(z, "timberDark");
  str.add(beam(line(width / 2 - 0.05, -0.1), 0.1, 0.12), undefined, "Bridge stringer");
  str.add(beam(line(-width / 2 + 0.05, -0.1), 0.1, 0.12), undefined, "Bridge stringer");
  // posts, rope handrails, vertical cable infill
  const posts = ctx.g(z, "charcoal");
  const cables = ctx.g(z, "black", { castShadow: false });
  const H = 1.1;
  const postN = Math.round(len / 1.6);
  for (const s of [-1, 1]) {
    const off = s * (width / 2 + 0.04);
    for (let i = 0; i <= postN; i++) {
      const p = point(i / postN).add(side.scale(off));
      posts.add(box(0.08, H + 0.1, 0.08), xf(p.x, p.y + H / 2 - 0.05, p.z, yaw), "Bridge post");
      ctx.g(z, "rope").add(torus(0.07, 0.03, 12, 6), xf(p.x, p.y + H - 0.02, p.z, yaw, 1, 1, 1, Math.PI / 2), "Rope wrap");
      ctx.g(z, "rope").add(cylinder(0.065, 0.14, 10), xf(p.x, p.y + H - 0.1, p.z), "Rope wrap");
    }
    ctx.g(z, "rope").add(tube(line(off, H), 0.045, 8), undefined, "Rope handrail");
    ctx.g(z, "charcoal").add(tube(line(off, 0.08), 0.015, 5), undefined, "Bridge cable");
    ctx.g(z, "charcoal").add(tube(line(off, H * 0.55), 0.01, 5));
    const cn = Math.round(len / 0.14);
    for (let i = 0; i <= cn; i++) {
      const p = point(i / cn).add(side.scale(off));
      cables.add(cylinder(0.006, H - 0.1, 4, false), xf(p.x, p.y + 0.05, p.z), "Cable infill");
    }
    // main suspension cable dipping below the rails between taller end posts
    const main = Array.from({ length: 41 }, (_, i) => {
      const t = i / 40;
      return point(t).add(side.scale(off * 1.05)).add(new Vector3(0, H + 0.6 - 2.2 * 4 * t * (1 - t) + sag * 4 * t * (1 - t) * 0.0, 0));
    });
    ctx.g(z, "charcoal").add(tube(main, 0.02, 6), undefined, "Suspension cable");
  }
  // tall end posts with lanterns
  for (const t of [0, 1]) {
    for (const s of [-1, 1]) {
      const p = point(t).add(side.scale(s * (width / 2 + 0.15)));
      ctx.g(z, "glulam").add(box(0.22, 2.1, 0.22), xf(p.x, p.y + 1.05, p.z, yaw), "Bridge tower post");
      hangingLantern(ctx, z, new Vector3(p.x, p.y + 2.05, p.z), 0.2, 0.15);
    }
  }
  for (const t of [0.25, 0.5, 0.75]) {
    const p = point(t).add(side.scale(width / 2 + 0.04));
    lanternPost(ctx, z, p.add(new Vector3(0, H, 0)), 0.05, { addLight: t === 0.5, lightRange: 6 });
  }
  // vines on the rails
  for (let i = 0; i < 18; i++) {
    const t = r();
    const s = r() > 0.5 ? 1 : -1;
    vine(ctx, z, point(t).add(side.scale(s * (width / 2 + 0.05))).add(new Vector3(0, H, 0)), 0.4 + r() * 1.8, r, { leaf: 0.1 });
  }
  anchorPlatform(ctx, z, E, side, width, r);
  houseLanding(ctx, z, S, width);
  ctx.lights.push({ pos: point(0.5).add(new Vector3(0, 2, 0)), color: "#ffb35e", day: 0, night: 4, range: 12, rooms: ["bridge"], level: "upper" });
}

/**
 * Round deck round the anchor tree, concentric with the trunk where it passes
 * the deck, with a tab out to meet the bridge's last plank. A 0.3 m deep deck
 * with a glulam edge band, radial joists and knee braces back to the trunk, a
 * timber collar closing the gap at the bark, and a cable railing that runs on
 * from the bridge's rails round the whole platform.
 */
function anchorPlatform(ctx: WorldCtx, z: Zone, E: Vector3, side: Vector3, width: number, r: () => number) {
  const anchor = TREES.find((t) => t.id === "bridgeAnchor")!;
  const y = E.y;
  const D = 0.3;
  const sh = trunkShape(anchor);
  const c = sh.span(y - D - 0.05, y + 0.1);
  const hole = { x: c.x, z: c.z, R: c.R + 0.04 };
  const R = 3.6;
  // bridge axis seen from the trunk
  const ux = E.x - c.x;
  const uz = E.z - c.z;
  const ul = Math.hypot(ux, uz);
  const u = { x: ux / ul, z: uz / ul };
  const v = { x: -side.x, z: -side.z };
  const hw = width / 2 + 0.14;
  const a0 = Math.atan2(u.z, u.x);
  const outline = (rad: number, lat: number, endBack: number): P2[] => {
    const phi = Math.asin(Math.min(0.99, lat / rad));
    const pts: P2[] = [];
    const n = 56;
    for (let i = 0; i <= n; i++) {
      const a = a0 + phi + ((Math.PI * 2 - 2 * phi) * i) / n;
      pts.push({ x: c.x + Math.cos(a) * rad, z: c.z + Math.sin(a) * rad });
    }
    // along the tab's sides to the bridge end
    const e = { x: E.x - u.x * endBack, z: E.z - u.z * endBack };
    const sgn = (pts[pts.length - 1].x - c.x) * v.x + (pts[pts.length - 1].z - c.z) * v.z > 0 ? 1 : -1;
    pts.push({ x: e.x + v.x * lat * sgn, z: e.z + v.z * lat * sgn }, { x: e.x - v.x * lat * sgn, z: e.z - v.z * lat * sgn });
    return pts;
  };
  const deck = ensureCCW(outline(R, hw, 0));
  const holeLoop = circle(hole.x, hole.z, hole.R, 48);
  const g = ctx.g(z, "deck");
  g.setLabel("Anchor tree platform");
  g.add(polygonFace(deck, y, true, [holeLoop]));
  g.add(polygonFace(deck, y - D, false, [holeLoop]));
  const band = ctx.g(z, "glulam");
  band.setLabel("Anchor tree platform");
  band.add(wallStrip(deck, y - D, y, true));
  band.add(wallStrip([...holeLoop].reverse(), y - D, y, true));
  // warm strip under the round edge (not round the tab's inside corners)
  ledStrip(ctx, z, at(outline(R + 0.02, hw, 0).slice(1, -3), y - D - 0.01), "amberStrip", 0.025);
  trunkCollar(ctx, z, anchor, y, hole, "up");
  trunkCollar(ctx, z, anchor, y - D, hole, "down");
  // radial joists under the deck, each with a knee brace back to the trunk
  const joists = new Geo();
  for (let k = 0; k < 10; k++) {
    const a = a0 + Math.PI / 10 + (k / 10) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const inner = new Vector3(c.x + ca * (hole.R - 0.05), y - D - 0.11, c.z + sa * (hole.R - 0.05));
    const outer = new Vector3(c.x + ca * (R - 0.15), y - D - 0.11, c.z + sa * (R - 0.15));
    joists.add(beam([inner, outer], 0.14, 0.22));
    const foot = sh.centre(y - 2.0);
    const fr = sh.inner(y - 2.0) * 0.95;
    joists.add(beam([new Vector3(foot.x + ca * fr, y - 2.0, foot.z + sa * fr), new Vector3(c.x + ca * (R * 0.62), y - D - 0.2, c.z + sa * (R * 0.62))], 0.12, 0.14));
  }
  ctx.g(z, "glulam").add(joists, undefined, "Platform joists");
  // railing: on from the bridge's rails, along the tab and round the platform
  // the rail outline is the arc then the two tab corners (the first beside the arc's end), so
  // it runs from the bridge rail by the arc's start, round the platform, to the other bridge rail
  const rail = outline(R - 0.07, width / 2 + 0.04, 0);
  const arcPts = rail.slice(0, -2);
  const [byEnd, byStart] = rail.slice(-2);
  railing(ctx, z, [byStart, ...arcPts, byEnd], y, { infill: "cable", label: "Platform railing" });
  for (let i = 0; i < 4; i++) {
    const a = a0 + Math.PI * (0.5 + i * 0.35);
    const p = new Vector3(c.x + Math.cos(a) * (R - 0.07), y + 1.08, c.z + Math.sin(a) * (R - 0.07));
    vine(ctx, z, p, 0.5 + r() * 1.4, r, { leaf: 0.1 });
  }
}

/** Deck between the house's curved deck edge and the bridge's first plank, so there is no gap. */
function houseLanding(ctx: WorldCtx, z: Zone, S: Vector3, width: number) {
  const hw = width / 2 + 0.14;
  const n = 10;
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const zz = S.z - hw + (2 * hw * i) / n;
    pts.push({ x: Math.max(S.x, deckWestX(upperDeckLoop, zz)), z: zz });
  }
  const gaps = pts.filter((p) => p.x - S.x > 0.01);
  if (!gaps.length) return;
  const outline = ensureCCW([{ x: S.x, z: S.z - hw }, ...pts, { x: S.x, z: S.z + hw }].filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) > 1e-4));
  const g = ctx.g(z, "deck");
  g.setLabel("Bridge landing");
  g.add(polygonFace(outline, S.y, true));
  g.add(polygonFace(outline, S.y - 0.3, false));
}
