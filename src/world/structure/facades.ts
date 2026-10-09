// Room enclosures: curved glazing on jungle-facing sides, solid walls toward
// the core and neighbours, open sides toward the hall and terrace.

import { P2, resample } from "../geometry/curves";
import { box, cylinder, ribbonWall, wallStrip, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { BAR, CANOPY_BAR, GAME, LEVEL, LIFT_DOOR, LOUNGE, MIX, MIX_CORNER, MIX_DOOR, MIX_WINDOWS, SHOWROOM, SHOWROOM_DOOR, THEATRE, THEATRE_DOOR, TRADING, TRADING_DOOR, core } from "../layout";
import { glazing } from "./elements";
import { insideTrunk } from "./trunks";
import { loungeBar } from "../rooms/lounge";

export type Edge = "glass" | "wall" | "open";

export function runs(loop: P2[], classify: (p: P2) => Edge, step = 0.2): { kind: Edge; path: P2[] }[] {
  const pts = resample(loop, step, true);
  const n = pts.length;
  const kinds: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    kinds.push(classify({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }));
  }
  // rotate so we start at a kind boundary
  let start = 0;
  for (let i = 0; i < n; i++) if (kinds[i] !== kinds[(i - 1 + n) % n]) {
    start = i;
    break;
  }
  const out: { kind: Edge; path: P2[] }[] = [];
  let cur: { kind: Edge; path: P2[] } | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!cur || cur.kind !== kinds[i]) {
      cur = { kind: kinds[i], path: [pts[i]] };
      out.push(cur);
    }
    cur.path.push(pts[(i + 1) % n]);
  }
  return out;
}

/** Enclose a room: glazing runs, solid wall runs (inner face material, outer timber). */
export function enclose(
  ctx: WorldCtx,
  z: Zone,
  loop: P2[],
  y0: number,
  y1: number,
  classify: (p: P2) => Edge,
  o: { wallMat?: string; outerMat?: string; label: string; step?: number },
): { kind: Edge; path: P2[] }[] {
  // a wall or glazing that meets a trunk stops just inside the bark
  const rs = runs(loop, (p) => (insideTrunk(p, y0, y1) ? "open" : classify(p)));
  // no plant, inside or out, reaches through the room's walls and glass
  for (const r of rs) if (r.kind !== "open") ctx.wall(r.path, y0 - 0.1, y1);
  for (const r of rs) {
    if (r.kind === "glass") glazing(ctx, z, r.path, y0, y1, { label: `${o.label} glazing`, step: o.step });
    else if (r.kind === "wall") {
      // inner face
      const inner = ctx.g(z, o.wallMat ?? "panelHoney");
      inner.setLabel(`${o.label} wall`);
      inner.add(ribbonWall([...r.path].reverse(), y0, y1, false));
      const outer = ctx.g(z, o.outerMat ?? "panelHoney");
      outer.setLabel(`${o.label} outer wall`);
      const off = r.path.map((p, i) => {
        const prev = r.path[Math.max(0, i - 1)];
        const next = r.path[Math.min(r.path.length - 1, i + 1)];
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const l = Math.hypot(tx, tz) || 1;
        return { x: p.x + (tz / l) * 0.18, z: p.z - (tx / l) * 0.18 };
      });
      outer.add(ribbonWall(off, y0, y1, false));
      // timber caps over the wall's two ends belong to the wall
      const cap = ctx.g(z, "timberDark");
      cap.add(wallStrip([r.path[0], off[0]], y0, y1), undefined, `${o.label} wall`);
      cap.add(wallStrip([off[off.length - 1], r.path[r.path.length - 1]], y0, y1), undefined, `${o.label} wall`);
    }
  }
  return rs;
}

export function buildFacades(ctx: WorldCtx): void {
  const L = LEVEL;
  // ---------------- lower level
  // the north wall backs the bar and stops just past it, opening the corner by the
  // west trunk to the passage so the Trading Room door can be seen from the hall
  const counterEnd = loungeBar().wallEnd;
  enclose(ctx, zone("arrivalLounge", "lower"), LOUNGE.loop, L.lower, L.lowerCeil, (p) => (p.x > LOUNGE.x1 - 0.4 ? "open" : p.z > LOUNGE.z1 - 0.45 && p.x > counterEnd ? "open" : p.z > LOUNGE.z1 - 0.45 && p.x > LOUNGE.c.x - 0.6 ? "wall" : "glass"), {
    label: "Arrival Lounge",
  });
  enclose(ctx, zone("gameRoom", "lower"), GAME.loop, L.lower, L.lowerCeil, (p) => (p.x < GAME.x0 + 0.4 ? "open" : p.z > GAME.z1 - 0.45 && p.x < GAME.c.x - 0.3 ? "wall" : "glass"), {
    label: "Game Room",
    wallMat: "panelDark",
  });
  // door cut as for the theatre: 0.1 m wider each side, the glulam lining in trading.ts covers the edge
  const tradingDoor = (p: P2) => p.z < TRADING.z0 + 0.45 && Math.abs(p.x - TRADING_DOOR.x) < TRADING_DOOR.w / 2 + 0.1;
  enclose(ctx, zone("tradingRoom", "lower"), TRADING.loop, L.lower, L.lowerCeil, (p) => (tradingDoor(p) ? "open" : p.x > TRADING.x1 - 0.35 ? "wall" : p.z < TRADING.z0 + 0.45 && p.x > TRADING.c.x + 0.2 ? "wall" : "glass"), {
    label: "Trading Room",
  });
  enclose(ctx, zone("mixchimp", "lower"), MIX.loop, L.lower, L.lowerCeil, mixEdge, {
    label: "MixChimp Studio",
    wallMat: "panelDark",
  });
  // ---------------- upper level
  // the door cut on the gallery side is 0.1 m wider each side than the doors; the portal in upper.ts covers the edge
  const showroomDoor = (p: P2) => p.x > SHOWROOM.x1 - 0.45 && Math.abs(p.z - SHOWROOM_DOOR.z) < SHOWROOM_DOOR.w / 2 + 0.1;
  enclose(ctx, zone("showroom", "upper"), SHOWROOM.loop, L.upper, L.upperCeil, (p) => (showroomDoor(p) ? "open" : p.z > SHOWROOM.z1 - 0.45 ? "wall" : "glass"), {
    label: "Showroom",
  });
  // the cut is 0.1 m wider each side than the doors; the glulam lining in upper.ts covers the edge
  const theatreDoor = (p: P2) => p.z < THEATRE.z0 + 0.45 && Math.abs(p.x - THEATRE_DOOR.x) < THEATRE_DOOR.w / 2 + 0.1;
  enclose(ctx, zone("theatre", "upper"), THEATRE.loop, L.upper, L.upperCeil, (p) => (theatreDoor(p) ? "open" : p.x > THEATRE.x1 - 0.35 ? "wall" : p.z < THEATRE.z0 + 0.45 && p.x > THEATRE.c.x - 0.3 ? "wall" : "glass"), {
    label: "Theatre",
    wallMat: "panelDark",
  });
  // solid behind the back bar, glazed on the rest of the north and west sides, open to the terrace
  const barWall = (p: P2) => p.z > BAR.z1 - 0.05 && p.x > CANOPY_BAR.wallX0 && p.x < CANOPY_BAR.wallX1;
  enclose(ctx, zone("barLounge", "upper"), BAR.loop, L.upper, L.upperCeil - 0.2, (p) => (barWall(p) ? "wall" : p.x < BAR.x0 + 0.35 || p.z > BAR.z1 - 0.4 ? "glass" : "open"), {
    label: "Bar",
  });

  buildCoreWalls(ctx);
}

/**
 * How MixChimp Studio is enclosed. Its rounded south-west corner holds the door
 * (open here, built in lower.ts) and the start of a window band that wraps the
 * corner and runs along the south wall (also open here, built in lower.ts);
 * otherwise solid toward the core and the hall, glazed toward the jungle.
 */
export function mixEdge(p: P2): Edge {
  const k = MIX_CORNER;
  if (p.x < k.x + 0.01 && p.z < k.z + 0.01) {
    if (Math.hypot(p.x - MIX_DOOR.x, p.z - MIX_DOOR.z) < MIX_DOOR.w / 2 + 0.1) return "open";
    const a = ((Math.atan2(p.z - k.z, p.x - k.x) * 180) / Math.PI + 360) % 360;
    return a > MIX_WINDOWS.a0 || a < MIX_WINDOWS.a1 ? "open" : "wall";
  }
  if (p.z < MIX.z0 + 0.45 && p.x < MIX_WINDOWS.x1) return "open";
  if (p.x < MIX.x0 + 0.35 && p.z < MIX_WINDOWS.z1) return "open";
  return p.x < MIX.x0 + 0.35 ? "wall" : p.z < MIX.z0 + 0.45 && p.x < MIX.c.x - 0.6 ? "wall" : "glass";
}

/** Core: stair enclosure, lift shaft, WC, rear cladding with slim windows. */
function buildCoreWalls(ctx: WorldCtx) {
  const { x0, x1, z0, z1, lift, wc } = core;
  for (const level of ["lower", "upper"] as const) {
    const zz = zone("core", level);
    // no plant reaches through the stair hall's side and rear walls
    ctx.wall(
      [
        { x: x0 + 0.11, z: z0 },
        { x: x0 + 0.11, z: z1 - 0.125 },
        { x: x1 - 0.11, z: z1 - 0.125 },
        { x: x1 - 0.11, z: z0 },
      ],
      level === "lower" ? LEVEL.lower - 0.1 : LEVEL.upper - 0.1,
      level === "lower" ? LEVEL.lowerCeil : LEVEL.upperCeil,
    );
    const y0 = level === "lower" ? LEVEL.lower : LEVEL.upper;
    const y1 = level === "lower" ? LEVEL.lowerCeil : LEVEL.upperCeil;
    const h = y1 - y0;
    const g = ctx.g(zz, "panelHoney");
    g.setLabel("Core wall");
    // rear wall (with slim stair windows cut as separate pieces)
    const winXs = [core.stair.x0 + 0.5, core.stair.x1 - 0.5];
    let prevX = x0;
    for (const wx of winXs) {
      g.add(box(wx - 0.3 - prevX, h, 0.25), xf((prevX + wx - 0.3) / 2, y0 + h / 2, z1));
      // window: glass + frame
      ctx.g(zz, "glass", { castShadow: false }).add(ribbonWall([{ x: wx + 0.3, z: z1 }, { x: wx - 0.3, z: z1 }], y0 + 0.4, y1 - 0.3));
      ctx.g(zz, "charcoal").add(box(0.7, 0.08, 0.3), xf(wx, y0 + 0.36, z1));
      ctx.g(zz, "charcoal").add(box(0.7, 0.08, 0.3), xf(wx, y1 - 0.26, z1));
      g.add(box(0.6, 0.32, 0.25), xf(wx, y0 + 0.16, z1));
      g.add(box(0.6, 0.22, 0.25), xf(wx, y1 - 0.11, z1));
      prevX = wx + 0.3;
    }
    g.add(box(x1 - prevX, h, 0.25), xf((prevX + x1) / 2, y0 + h / 2, z1));
    // west wall (stair side)
    g.add(box(0.22, h, z1 - z0), xf(x0, y0 + h / 2, (z0 + z1) / 2));
    // east wall: on the lower level it stops short of the hall, opening the lift lobby onto MixChimp's curved corner
    const ez0 = level === "lower" ? MIX_WINDOWS.coreZ : z0;
    g.add(box(0.22, h, z1 - ez0), xf(x1, y0 + h / 2, (ez0 + z1) / 2));
    // rounded timber ends where the side walls stop
    if (level === "lower") {
      ctx.g(zz, "glulam").add(cylinder(0.12, h, 20), xf(x0, y0, z0), "Core wall end");
      ctx.g(zz, "glulam").add(cylinder(0.12, h, 20), xf(x1, y0, ez0), "Core wall end");
    }
    // lift shaft
    const lf = ctx.g(zz, "panelHoney");
    lf.setLabel("Lift shaft");
    lf.add(box(lift.x1 - lift.x0 + 0.3, h, 0.18), xf((lift.x0 + lift.x1) / 2, y0 + h / 2, lift.z1 + 0.09));
    lf.add(box(0.18, h, lift.z1 - lift.z0), xf(lift.x0 - 0.06, y0 + h / 2, (lift.z0 + lift.z1) / 2));
    lf.add(box(0.18, h, lift.z1 - lift.z0), xf(lift.x1 + 0.06, y0 + h / 2, (lift.z0 + lift.z1) / 2));
    // lift front: a wall with the door opening, lintel over it. The landing doors and
    // the call panel are built by structure/lift.ts, since they move or light up.
    const doorW = LIFT_DOOR.w;
    const doorH = LIFT_DOOR.h;
    const lx = (lift.x0 + lift.x1) / 2;
    const fw = (lift.x1 - lift.x0 + 0.3 - doorW) / 2;
    lf.add(box(fw, h, 0.2), xf(lift.x0 - 0.15 + fw / 2, y0 + h / 2, lift.z0));
    lf.add(box(fw, h, 0.2), xf(lift.x1 + 0.15 - fw / 2, y0 + h / 2, lift.z0));
    lf.add(box(doorW, h - doorH, 0.2), xf(lx, y0 + doorH + (h - doorH) / 2, lift.z0));
    // WC
    const w = ctx.g(zz, "panelHoney");
    w.setLabel("WC wall");
    const dm = (wc.x0 + wc.x1) / 2;
    w.add(box(dm - 0.5 - wc.x0, h, 0.15), xf((wc.x0 + dm - 0.5) / 2, y0 + h / 2, wc.z0));
    w.add(box(wc.x1 + 0.2 - (dm + 0.5), h, 0.15), xf((dm + 0.5 + wc.x1 + 0.2) / 2, y0 + h / 2, wc.z0));
    w.add(box(1.0, h - 2.25, 0.15), xf(dm, y0 + 2.25 + (h - 2.25) / 2, wc.z0));
    w.add(box(0.15, h, wc.z1 - wc.z0), xf(wc.x0, y0 + h / 2, (wc.z0 + wc.z1) / 2));
    const door = ctx.g(zz, "timberDark");
    door.setLabel("WC door");
    door.add(box(0.9, 2.2, 0.06), xf((wc.x0 + wc.x1) / 2, y0 + 1.1, wc.z0 - 0.08));
    const wcFix = ctx.g(zz, "white");
    wcFix.setLabel("WC fixtures");
    wcFix.add(box(0.4, 0.42, 0.65), xf(wc.x1 - 0.5, y0 + 0.21, wc.z1 - 0.5));
    wcFix.add(box(0.55, 0.12, 0.42), xf(wc.x0 + 0.5, y0 + 0.85, wc.z1 - 0.3));
  }
}
