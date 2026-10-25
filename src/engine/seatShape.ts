// A seat's shape, read from the furniture itself: how high its top is where the hips go, how far
// in front of them its front edge is, how far behind them its back is and how it leans, and how far
// its sides are. The seat's slot (world/props/seats.ts) only says where the sitter's hips go and
// which way they face; everything else is measured here, by rays against the house's solid
// surfaces (engine/collision.ts), the first time a seat is sat on. So the chimp fits whatever it
// sits on (a sofa's pillows, a toilet's ring, a seat modelled in Blender) without numbers typed in
// for it, and a seat that is reshaped is sat on as it now is.

import type { SeatInfo } from "../world/context";

/** What a seat's shape is, in metres, from its slot (on the seat's top, where the hips go). */
export interface SeatShape {
  /** the top the sitter sits on, above the floor their feet are on */
  height: number;
  /** from the slot forward to the seat's front edge */
  depth: number;
  /** from the slot back to the seat's rear edge (a backless seat), or to the face of its back */
  rear: number;
  /** from the slot back to the face of the seat's back, at the hips; null without one */
  back: number | null;
  /** how far the back leans back (radians) */
  recline: number;
  /** from the slot to the nearer of the seat's sides */
  width: number;
  /** from the slot forward to the front of whatever is under the seat, down by the feet (a plinth, a bowl, legs); 0 when nothing is */
  base: number;
  /** how far in front of the slot the way is clear at a standing chimp's height (a desk, a counter, a piano in front of it); FAR when it is */
  clear: number;
  /** how far the floor beside the seat is clear, to its right and to its left (from the slot, at a sitter's shins and hips) */
  sides: [number, number];
  /** whether it has arms (or sides) by the sitter's hips: nobody sits on it from beside it */
  arms: boolean;
  /** from the slot out to the side of what is under the seat by the feet (a lounger's side rail, a stool's legs); 0 when nothing is */
  sideBase: number;
  /** how far in front of the slot the way is clear down by the feet (a bar's front panel, a desk's); FAR when it is */
  room: number;
}

/** A ray from (x, y, z) along a unit direction: how far it goes before a solid surface, up to max. */
export type Ray = (x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number) => number;

/** How far from the slot the edges are looked for (m). */
const FAR = 1.6;
/** A drop in the top this deep (m) is an edge. */
const DROP = 0.07;
/** A back is looked for this far behind the slot (m). */
const BACK_FAR = 0.55;

/**
 * How far ahead of a seat's slot (along fx, fz) the way is clear down by a sitter's feet, from
 * past the seat itself out (`past`: its front edge or what is under it, whichever is further).
 */
export function roomAhead(ray: Ray, x: number, z: number, fx: number, fz: number, floor: number, h: number, past: number): number {
  const rx = fz;
  const rz = -fx;
  const from = past + 0.05;
  let room = FAR;
  for (let up = 0.08; up < h - 0.05; up += 0.12) for (const a of [-0.12, 0.12]) room = Math.min(room, from + ray(x + fx * from + rx * a, floor + up, z + fz * from + rz * a, fx, 0, fz, FAR));
  return room;
}

/**
 * Measure a seat: its slot at (x, y, z) (y its top as the house builds it), facing (fx, fz) (unit,
 * flat), on a floor at `floor`. `info` is what the seat says about itself, kept where the rays find
 * nothing better.
 */
export function measureSeat(ray: Ray, x: number, y: number, z: number, fx: number, fz: number, floor: number, info: SeatInfo): SeatShape {
  // the seat's right, flat
  const rx = fz;
  const rz = -fx;
  /** The highest top under (px, pz), looked for from `above` over `y0`; -Infinity where there is none near. */
  const top = (px: number, pz: number, y0: number, above = 0.2) => {
    const d = ray(px, y0 + above, pz, 0, -1, 0, above + 0.5);
    return d < above + 0.5 ? y0 + above - d : -Infinity;
  };
  /**
   * The top round a point `ahead` of the slot: where it is, near what the seat says; or (a hole
   * there: a toilet's bowl) the highest round it (its ring); a bench's boards have gaps between.
   */
  const topAt = (ahead: number) => {
    const at = (a: number, b: number) => {
      const t = top(x + rx * a + fx * (ahead + b), z + rz * a + fz * (ahead + b), y, 0.12);
      return t > y - 0.1 && t < y + 0.12 ? t : null;
    };
    const mid = [at(0, 0), at(0.08, 0), at(-0.08, 0), at(0, 0.05)].filter((t): t is number => t !== null).sort((p, q) => p - q);
    if (mid.length >= 2) return mid[Math.floor(mid.length / 2)];
    const ring = [at(0.16, 0), at(-0.16, 0), at(0.12, 0.08), at(-0.12, 0.08), ...mid].filter((t): t is number => t !== null);
    return ring.length ? Math.max(...ring) : y;
  };
  let h = topAt(0);
  const on = (s: number, dx: number, dz: number) => top(x + dx * s, z + dz * s, h, 0.25) >= h - DROP;
  /**
   * How far from the slot along (dx, dz) the top drops away: an edge. Gaps between boards are
   * stepped over; a hole under the hips (a toilet's bowl) is crossed to the ring round it.
   */
  const edge = (dx: number, dz: number) => {
    let s = 0.02;
    if (!on(0, dx, dz)) while (s < 0.36 && !on(s, dx, dz)) s += 0.02;
    for (; s <= FAR; s += 0.02) if (!on(s, dx, dz) && !on(s + 0.03, dx, dz)) return s;
    return FAR;
  };
  // the back: rays from in front of the hips, back along the seat, at the small of the back and
  // higher up (a pillow on a sofa's back cushion is in front of the slot; started ahead, its face is found)
  const ahead = 0.3;
  // the nearest across the sitter's back: a pillow propped off to one side still meets a shoulder
  const behind = (up: number) => {
    let near: number | null = null;
    for (const a of [0, -0.13, 0.13]) {
      const d = ray(x + fx * ahead + rx * a, h + up, z + fz * ahead + rz * a, -fx, 0, -fz, ahead + BACK_FAR);
      if (d < ahead + BACK_FAR && (near === null || d - ahead < near)) near = d - ahead;
    }
    return near;
  };
  const low = behind(0.12);
  const mid = behind(0.24);
  const high = behind(0.36);
  const back0 = low ?? (high !== null && high < 0.3 ? high : null);
  let recline = info.recline;
  // how it leans: the steeper of low to middle and low to high (a lounger's headrest pillow stands out of its back's slope)
  const slope = (b: number | null, up: number) => (low !== null && b !== null && b >= low - 0.02 ? Math.atan2(b - low, up) : null);
  const s1 = slope(mid, 0.12);
  const s2 = slope(high, 0.24);
  if (s1 !== null || s2 !== null) recline = Math.max(0, Math.min(1.1, Math.max(s1 ?? -1, s2 ?? -1)));
  // the back as a sitter leaning back that far meets it: the nearest of it at the hips, and higher up
  // less what the lean takes the body back (a back cushion that comes forward at the top, a headrest)
  let backAt = low;
  if (backAt !== null) {
    const tan = Math.tan(recline);
    if (mid !== null) backAt = Math.min(backAt, mid - 0.12 * tan);
    if (high !== null) backAt = Math.min(backAt, high - 0.24 * tan);
  }
  const back = backAt ?? back0;
  // the top again where the hips go: in front of the back (a sofa's pillow leans on the cushion behind the slot)
  if (back !== null && back < 0.14) h = topAt(0.14 - back);
  const depth = edge(fx, fz);
  const width = Math.min(edge(rx, rz), edge(-rx, -rz));
  const rear = back ?? edge(-fx, -fz);
  // what is under the front edge, where hanging feet go: a sofa's plinth stands out past its cushion
  let base = 0;
  const from = depth + 0.4;
  // (low down, where heels are: up a high stool, its own seat and foot ring are where the feet hang, not in their way)
  for (const up of [0.04, 0.12, 0.2, 0.28]) {
    if (floor + up > h - 0.05) break;
    for (const a of [-0.1, 0.1]) {
      const d = ray(x + fx * from + rx * a, floor + up, z + fz * from + rz * a, -fx, 0, -fz, from);
      // (something well in front of the seat, a table, is not under it)
      if (d < from && from - d < depth + 0.15) base = Math.max(base, from - d);
    }
  }
  // in front, at a standing chimp's knees, hips, chest and arms: a desk, a counter or a bar top the seat is pulled up to
  let clear = FAR;
  // (from the seat's front edge out: a pillow over the slot is the seat's own)
  const from0 = depth + 0.02;
  for (const up of [0.5, 0.75, 1.0, 1.1]) for (const a of [-0.15, 0, 0.15]) clear = Math.min(clear, from0 + ray(x + fx * from0 + rx * a, floor + up, z + fz * from0 + rz * a, fx, 0, fz, FAR));
  const side = (sx: number, sz: number) => {
    let d = FAR;
    for (const up of [0.3, 0.6, 0.9]) for (const b of [-0.15, 0.1]) d = Math.min(d, ray(x + fx * b, floor + up, z + fz * b, sx, 0, sz, FAR));
    return d;
  };
  let arms = false;
  for (const d of [1, -1]) if (ray(x - fx * 0.08, h + 0.15, z - fz * 0.08, rx * d, 0, rz * d, 0.43) < 0.43) arms = true;
  // the same out to the sides, where a sitter's feet hang sitting on the side edge
  let sideBase = 0;
  const fromS = width + 0.4;
  for (let up = 0.04; floor + up < Math.min(h - 0.03, floor + 0.45); up += 0.06)
    for (const d of [1, -1])
      for (const b of [-0.08, 0.08]) {
        const dd = ray(x + rx * d * fromS + fx * b, floor + up, z + rz * d * fromS + fz * b, -rx * d, 0, -rz * d, fromS);
        if (dd < fromS && fromS - dd < width + 0.15) sideBase = Math.max(sideBase, fromS - dd);
      }
  return { height: h - floor, depth, rear, back, recline, width, base, clear, sides: [side(rx, rz), side(-rx, -rz)], arms, sideBase, room: roomAhead(ray, x, z, fx, fz, floor, h, Math.max(depth, base)) };
}
