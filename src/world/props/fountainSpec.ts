// The courtyard fountain's measurements: its stone (environment/courtyard.ts) and its water
// (engine/fountain.ts) are both built from these, in the fountain's own space: y up from the
// paving, the basin's middle at the origin. The fountain's slot carries them in its metadata
// (roles.ts ROLE.fountain), so the water finds them however the stone was built.

/** A point in the fountain's own space (x, y, z). */
export type Vec3 = [number, number, number];

export interface FountainSpec {
  /** the basin: its wall's outer radius, the water's radius inside it, the coping's top and the water's surface */
  basin: { r: number; inner: number; rim: number; water: number };
  /** the two bowls on the pedestal, the lower first: the lip's radius and height, and the water in them */
  bowls: { r: number; lip: number; inner: number; water: number; spill: number }[];
  /** the jet from the top of the pedestal: its nozzle, and how far above it the water climbs */
  jet: { at: Vec3; rise: number };
  /** the arcs from nozzles round the basin's coping, landing short of the lower bowl's falling sheet */
  arcs: { count: number; turn: number; from: { r: number; y: number }; to: { r: number; y: number }; peak: number };
}

export const FOUNTAIN: FountainSpec = {
  basin: { r: 2.72, inner: 2.37, rim: 0.53, water: 0.36 },
  bowls: [
    // `spill`: how fast (m/s) water leaves the lip, outwards, as it falls in a sheet
    { r: 1.04, lip: 1.03, inner: 0.97, water: 1.0, spill: 0.55 },
    { r: 0.54, lip: 1.62, inner: 0.48, water: 1.595, spill: 0.42 },
  ],
  jet: { at: [0, 1.7, 0], rise: 0.8 },
  // turned half a step off north, so the arcs fall between the paving's radial strips
  arcs: { count: 8, turn: Math.PI / 8, from: { r: 2.5, y: 0.6 }, to: { r: 1.5, y: 0.36 }, peak: 1.38 },
};

/** Gravity the water falls by (m/s²). */
export const G = 9.81;

/** Point `t` (0..1) along arc `i`'s flight: a parabola from its nozzle up to `peak` and down to where it lands. */
export function arcPoint(s: FountainSpec, i: number, t: number): Vec3 {
  const a = s.arcs.turn + (i / s.arcs.count) * Math.PI * 2;
  const { from, to } = s.arcs;
  const r = from.r + (to.r - from.r) * t;
  // y = from.y + b t + c t², through `to` at t = 1 and peaking at `peak`
  const [b, c] = arcCoefficients(s);
  const y = from.y + b * t + c * t * t;
  return [Math.sin(a) * r, y, Math.cos(a) * r];
}

/** The arc's height as from.y + b t + c t² (t 0..1 along it). */
export function arcCoefficients(s: FountainSpec): [number, number] {
  const { from, to, peak } = s.arcs;
  // with d = to.y - from.y and h = peak - from.y: b + c = d and -b²/(4c) = h
  const d = to.y - from.y;
  const h = peak - from.y;
  // b² - 4hb + 4hd = 0, the root with b > 0 (d < 0: the arc lands below its nozzle)
  const b = 2 * h + 2 * Math.sqrt(h * h - h * d);
  return [b, d - b];
}

/** How long (s) water takes along an arc: the time to rise to its peak and fall to the water. */
export function arcFlightTime(s: FountainSpec): number {
  const { from, to, peak } = s.arcs;
  return Math.sqrt((2 * (peak - from.y)) / G) + Math.sqrt((2 * (peak - to.y)) / G);
}
