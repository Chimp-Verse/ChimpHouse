// The snack machine's rules, as pure functions of its state and the room's
// clock (no Babylon), like liftState.ts: what each coil holds, a vend from the
// keypad to the snack lying in the bin, taking it out, and restocking.
//
// The state is one object shared by everyone in the room (engine/room.ts), so
// all visitors see the same coils turn and the same snacks fall. A vend is a
// start time: the coil's turn and the snack's fall are worked out from it, the
// fall by a small rigid-body simulation (fallPath) that every visitor runs the
// same way, so nothing needs sending while it happens.

/** What each coil holds: one brand per coil, as a real machine is stocked (rows A–C bags, D bars, E boxes). */
export const PLANOGRAM: Record<string, string> = {
  A1: "jungleCrunch",
  A2: "canopyPuffs",
  A3: "termiteTwigs",
  A4: "mangoMischief",
  A5: "silverback",
  B1: "knucklePops",
  B2: "vineSwingers",
  B3: "jungleCrunch",
  B4: "canopyPuffs",
  B5: "termiteTwigs",
  C1: "silverback",
  C2: "mangoMischief",
  C3: "knucklePops",
  C4: "vineSwingers",
  C5: "jungleCrunch",
  D1: "bonoboBar",
  D2: "apeEscape",
  D3: "bonoboBar",
  D4: "apeEscape",
  D5: "bonoboBar",
  D6: "apeEscape",
  E1: "chocoChimps",
  E2: "nutCracker",
  E3: "chocoChimps",
  E4: "nutCracker",
  E5: "chocoChimps",
  E6: "nutCracker",
};

/** Every coil's code, in slot order (A1, A2 … E6). */
export const COILS = Object.keys(PLANOGRAM);

export const SNACK_TIMING = {
  /** a coil's one turn (ms) */
  turn: 1700,
  /** how long the fall can take at most (ms): it is over sooner, once the snack lies still */
  fallMax: 3500,
  /** how long a sold-out coil stays empty before the machine restocks it (ms) */
  restock: 45_000,
  /** how long a chosen code stays on the display without its number (ms) */
  entry: 6000,
};

/** How many snacks the bin holds before the machine asks for them to be taken. */
export const BIN_LIMIT = 4;

/** A snack on its way out: its coil turned at `at` (room time, ms). Once it has fallen it lies in the bin until someone takes it. */
export interface Vend {
  id: number;
  coil: string;
  brand: string;
  /** who chose it */
  by: string;
  at: number;
  /** how high it lands above the bin's floor (m): on the packs already lying under it */
  stack: number;
}

export interface SnackState {
  /** how many snacks each coil holds now (its front one goes first) */
  stock: Record<string, number>;
  /** snacks falling or lying in the bin, oldest first */
  vends: Vend[];
  /** when each sold-out coil is filled again (room time, ms) */
  restock: Record<string, number>;
  nextId: number;
}

/** How the machine opens: most coils full, a few part sold. */
export function initialSnacks(capacity: number): SnackState {
  const stock: Record<string, number> = {};
  COILS.forEach((code, i) => (stock[code] = i % 7 === 3 ? capacity - 2 : i % 5 === 1 ? capacity - 1 : capacity));
  return { stock, vends: [], restock: {}, nextId: 1 };
}

/** Whether a vend's coil is still turning at `now`. */
export const turning = (v: Vend, now: number) => now - v.at < SNACK_TIMING.turn;

/** The vend under way at `now` (its coil turning), if any: the machine sells one snack at a time. */
export function busy(s: SnackState, now: number): Vend | null {
  return s.vends.find((v) => turning(v, now)) ?? null;
}

/** Why a code can't be sold now, in the display's words, or null when it can. */
export function refusal(s: SnackState, code: string, now: number): string | null {
  if (!(code in PLANOGRAM)) return "NO SUCH SNACK";
  if (busy(s, now)) return "ONE MOMENT…";
  if (s.vends.length >= BIN_LIMIT) return "PLEASE TAKE YOUR SNACKS";
  if (s.stock[code] <= 0) return "SOLD OUT";
  return null;
}

/**
 * Sell the snack at the front of coil `code`: its coil starts turning, and the snack lands in
 * the bin on the packs already lying there (`landStack` says how high, from the bin's contents).
 */
export function vend(s: SnackState, code: string, by: string, now: number, landStack: (coil: string, inBin: Vend[]) => number): SnackState {
  if (refusal(s, code, now)) return s;
  const left = s.stock[code] - 1;
  const v: Vend = { id: s.nextId, coil: code, brand: PLANOGRAM[code], by, at: now, stack: landStack(code, s.vends) };
  return {
    stock: { ...s.stock, [code]: left },
    vends: [...s.vends, v],
    restock: left === 0 ? { ...s.restock, [code]: now + SNACK_TIMING.restock } : s.restock,
    nextId: s.nextId + 1,
  };
}

/** Take snack `id` out of the bin (once it has landed). */
export function take(s: SnackState, id: number, now: number, landed: (v: Vend, now: number) => boolean): SnackState {
  const v = s.vends.find((x) => x.id === id);
  if (!v || !landed(v, now)) return s;
  return { ...s, vends: s.vends.filter((x) => x.id !== id) };
}

/** Fill every coil whose restock time has come; the same state when none has. */
export function restock(s: SnackState, now: number, capacity: number): SnackState {
  const due = Object.entries(s.restock).filter(([, t]) => t <= now);
  if (!due.length) return s;
  const stock = { ...s.stock };
  const left = { ...s.restock };
  for (const [code] of due) {
    stock[code] = capacity;
    delete left[code];
  }
  return { ...s, stock, restock: left };
}

/** How far through its one turn a vend's coil is at `now`, 0..1, easing in and out as a motor does. */
export function coilTurn(v: Vend, now: number): number {
  const x = Math.min(1, Math.max(0, (now - v.at) / SNACK_TIMING.turn));
  return x * x * (3 - 2 * x);
}

// ------------------------------------------------------------------ the fall

/**
 * Where the shaft a snack falls down is, in its coil's frame: z toward the back, y up, both
 * from the coil's front end on its axis (m). The snack's lane fixes its x; it falls in the
 * plane across the machine.
 */
export interface Shaft {
  /** the coil's radius: the tray's top is at y = -r */
  r: number;
  /** the tray's front edge (its lip's face) */
  edge: number;
  /** the glass, and below the window the front panel's back */
  front: number;
  /** the bin: its floor, and the back of its chute where the floor meets it, and the top of the chute */
  floor: number;
  binBack: number;
  binTop: number;
  pitch: number;
}

/** A pack, as the simulation sees it: a rectangle `d` thick (along z) and `h` tall. */
export interface PackShape {
  d: number;
  h: number;
}

/** A frame of a fall: the pack's centre (z, y) in the coil's frame and how far it has tipped forward (rad). */
export interface FallFrame {
  z: number;
  y: number;
  tip: number;
}

export interface FallPath {
  /** frames every FALL_STEP ms from the moment the coil lets go of it */
  frames: FallFrame[];
  /** when the coil lets go (ms after the vend starts) */
  release: number;
  /** what it hit and how hard, for the sounds (ms after the vend starts) */
  hits: { at: number; what: "glass" | "floor" | "pack" | "tray"; speed: number }[];
}

export const FALL_STEP = 1000 / 60;

/** Where the front pack is while the coil pushes it, before it lets go, at turn progress `s`. */
export function pushedFrame(shape: PackShape, sh: Shaft, s: number): FallFrame {
  return { z: sh.pitch * (0.5 - s), y: -sh.r + shape.h / 2, tip: 0 };
}

/**
 * The fall of a pack pushed off its tray: a rigid rectangle under gravity, tipping over the tray's
 * edge and dropping down the shaft between the glass and the trays below, bouncing off them, to
 * lie in the bin `stack` metres above its floor. Pure and deterministic, so every visitor sees
 * the same fall.
 */
export function fallPath(shape: PackShape, sh: Shaft, stack: number): FallPath {
  const a = shape.d / 2;
  const b = shape.h / 2;
  const inv = 1;
  const invI = 3 / (a * a + b * b);
  const g = 9.81;
  const floor = sh.floor + stack;
  // the coil lets go once the pack's centre is past the tray's edge by a little
  const letGo = sh.edge - 0.012;
  const sRelease = 0.5 - letGo / sh.pitch;
  // invert the turn's ease for the moment it reaches sRelease
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (mid * mid * (3 - 2 * mid) < sRelease) lo = mid;
    else hi = mid;
  }
  const tRelease = lo;
  const release = tRelease * SNACK_TIMING.turn;
  // the coil's push speed there (m/s): d/dt of pitch * ease(t / turn)
  const push = (sh.pitch * 6 * tRelease * (1 - tRelease)) / (SNACK_TIMING.turn / 1000);
  let z = letGo;
  let y = -sh.r + b;
  let th = 0;
  let vz = -push;
  let vy = 0;
  let w = 0;
  const frames: FallFrame[] = [];
  const hits: FallPath["hits"] = [];
  const dt = 1 / 600;
  const perFrame = Math.round(FALL_STEP / 1000 / dt);
  let still = 0;
  let step = 0;
  const lastHit: Record<string, number> = {};
  const contacts: { px: number; py: number; nx: number; ny: number; depth: number; what: FallPath["hits"][number]["what"] }[] = [];
  // the back wall at height y: the trays' fronts down the shaft, then the bin's chute sloping back
  const backAt = (py: number) => (py >= sh.binTop ? sh.edge : sh.binBack + ((sh.edge - sh.binBack) * (py - floor)) / Math.max(0.01, sh.binTop - floor));
  const chuteN = (() => {
    // the chute's normal, pointing into the shaft (toward -z, up a little)
    const dz = sh.edge - sh.binBack;
    const dy = sh.binTop - floor;
    const l = Math.hypot(dz, dy);
    return { nz: -dy / l, ny: dz / l };
  })();
  while (step * dt * 1000 < SNACK_TIMING.fallMax) {
    if (step % perFrame === 0) frames.push({ z, y, tip: th });
    vy -= g * dt;
    // contacts at the corners, and the tray's edge against the pack's faces
    contacts.length = 0;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (const [u, v] of [
      [-a, -b],
      [a, -b],
      [a, b],
      [-a, b],
    ]) {
      const px = z + u * c - v * s;
      const py = y + u * s + v * c;
      if (px > sh.edge && py < -sh.r && py > -sh.r - 0.03 && y > -sh.r) contacts.push({ px, py, nx: 0, ny: 1, depth: -sh.r - py, what: "tray" });
      if (px < sh.front) contacts.push({ px, py, nx: 1, ny: 0, depth: sh.front - px, what: "glass" });
      if (py < floor) contacts.push({ px, py, nx: 0, ny: 1, depth: floor - py, what: stack > 0 ? "pack" : "floor" });
      if (py < -sh.r - 0.002) {
        const back = backAt(py);
        // a corner in the tray's own thickness is pushed out the nearer way: up onto it, or forward off it
        if (px > back && !(py > -sh.r - 0.03 && -sh.r - py < px - back)) {
          if (py >= sh.binTop) contacts.push({ px, py, nx: -1, ny: 0, depth: px - back, what: "tray" });
          else contacts.push({ px, py, nx: chuteN.nz, ny: chuteN.ny, depth: (px - back) * -chuteN.nz, what: "floor" });
        }
      }
    }
    // the tray's edge inside the pack: push the pack off it through the nearest face
    {
      const ex = sh.edge - z;
      const ey = -sh.r - y;
      const u = ex * c + ey * s;
      const v = -ex * s + ey * c;
      if (Math.abs(u) < a && Math.abs(v) < b) {
        const du = a - Math.abs(u);
        const dv = b - Math.abs(v);
        // the body moves away from the face the edge is coming in through
        const [lx, ly, depth] = du < dv ? [-Math.sign(u), 0, du] : [0, -Math.sign(v), dv];
        contacts.push({ px: sh.edge, py: -sh.r, nx: lx * c - ly * s, ny: lx * s + ly * c, depth, what: "tray" });
      }
    }
    for (let it = 0; it < 6; it++)
      for (const k of contacts) {
        const rx = k.px - z;
        const ry = k.py - y;
        const cvz = vz - w * ry;
        const cvy = vy + w * rx;
        const vn = cvz * k.nx + cvy * k.ny;
        if (vn >= 0) continue;
        const rn = rx * k.ny - ry * k.nx;
        const e = vn < -0.6 ? 0.25 : 0;
        const j = (-(1 + e) * vn) / (inv + rn * rn * invI);
        if (it === 0 && -vn > 0.25 && (lastHit[k.what] ?? -1e9) < step - 60) {
          hits.push({ at: release + step * dt * 1000, what: k.what, speed: -vn });
          lastHit[k.what] = step;
        }
        vz += j * k.nx * inv;
        vy += j * k.ny * inv;
        w += rn * j * invI;
        // friction along the surface
        const tx = -k.ny;
        const ty = k.nx;
        const cvz2 = vz - w * ry;
        const cvy2 = vy + w * rx;
        const vt = cvz2 * tx + cvy2 * ty;
        const rt = rx * ty - ry * tx;
        let jt = -vt / (inv + rt * rt * invI);
        const lim = 0.5 * j;
        jt = Math.max(-lim, Math.min(lim, jt));
        vz += jt * tx * inv;
        vy += jt * ty * inv;
        w += rt * jt * invI;
      }
    // positional correction, the deepest contact per direction
    let pz = 0;
    let py = 0;
    for (const k of contacts) {
      pz = Math.abs(k.nx * k.depth) > Math.abs(pz) ? k.nx * k.depth : pz;
      py = Math.abs(k.ny * k.depth) > Math.abs(py) ? k.ny * k.depth : py;
    }
    z += pz * 0.8;
    y += py * 0.8;
    // a little air drag on the spin
    w *= 0.999;
    z += vz * dt;
    y += vy * dt;
    th += w * dt;
    // lying still on the floor: done
    const resting = contacts.some((k) => k.what === "floor" || k.what === "pack") && Math.hypot(vz, vy) < 0.02 && Math.abs(w) < 0.2;
    still = resting ? still + 1 : 0;
    step++;
    if (still > 90) break;
  }
  frames.push({ z, y, tip: th });
  return { frames, release, hits };
}

/** A fall's frame at `t` ms after its vend started (before release: pushed along by the coil). */
export function fallAt(path: FallPath, shape: PackShape, sh: Shaft, t: number): FallFrame {
  if (t < path.release) return pushedFrame(shape, sh, coilTurn({ at: 0 } as Vend, t));
  const f = (t - path.release) / FALL_STEP;
  const i = Math.floor(f);
  const fr = path.frames;
  if (i >= fr.length - 1) return fr[fr.length - 1];
  const k = f - i;
  const p = fr[i];
  const q = fr[i + 1];
  return { z: p.z + (q.z - p.z) * k, y: p.y + (q.y - p.y) * k, tip: p.tip + (q.tip - p.tip) * k };
}

/** How long a fall lasts from its vend's start (ms): until it lies still in the bin. */
export const fallEnds = (path: FallPath) => path.release + (path.frames.length - 1) * FALL_STEP;
