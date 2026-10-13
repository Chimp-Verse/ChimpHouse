// The Game Room's foosball table, built to be played (engine/foosball.ts): a
// wooden cabinet on heavy legs, a green playfield between walls the rods pass
// through, a goal in each end with a ball return below it, a serve cup on each
// side and a bead score counter over each end. Its dimensions and rod layout are
// in foosballSpec.ts, which the ball's physics shares.
//
// The static parts are merged into the room, labelled for inspect. What moves
// (each rod with its men, bumpers and grip; the ball; the counters' beads) is
// built at run time on the table's slots, the way cabinets and remotes are, and
// found by role (roles.ts): the table's frame, its playfield, its rods' places
// and its counters'.

import { Color3, Matrix, Mesh, MeshBuilder, TransformNode, Vector3 } from "@babylonjs/core";
import { Geo, box, cylinder, fixWinding, lathe, plane, softBox, sphere, torus, xf } from "../geometry/geo";
import { MeshMeta, SlotMeta, WorldCtx, Zone } from "../context";
import { Materials } from "../materials/library";
import { makeCanvas, toTexture } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { ROLE } from "../roles";
import { BALL_R, END_WALL, FIELD, GOAL, GRIP, MAN, ROD_CLEAR, ROD_Y, RODS, RodSpec, SIDE, SIDE_WALL, Team, WALL_TOP, WIN_SCORE, manZ } from "./foosballSpec";

const L = FIELD.length;
const W = FIELD.width;
const FY = FIELD.y;
/** the cabinet's outside: half its length and width, the top of its walls, the bottom of its apron */
const OX = L / 2 + END_WALL;
const OZ = W / 2 + SIDE_WALL;
const TOP = FY + WALL_TOP;
const APRON = FY - 0.2;
/** where a player stands at their handles: this far out from the wall's outer face */
export const STAND_OUT = 0.5;
/** the ball return's cup on each end, in the table's frame (red's end at -X): where a ball scored at that end comes out to rest */
export const RETURN_CUP = { x: OX + 0.016, y: -0.13 } as const;
/** the cup's axis, above the resting ball's centre, its radius inside and its length */
const CUP = { y: RETURN_CUP.y + 0.0125, r: 0.03, len: 0.03 } as const;
/** the score counter's rod over each end: its height above the field, half its length, and the beads' size */
const COUNTER = { y: WALL_TOP + 0.045, half: 0.15 } as const;
const BEAD = { r: 0.012, len: 0.02 } as const;

export const TEAM_COLOR: Record<Team, string> = { red: "#d6322b", blue: "#2a5bd7" };

function mats(ctx: WorldCtx): { field: string; plaque: string } {
  const m = ctx.mats;
  if (!m.has("foosWallInner")) m.pbr("foosWallInner", { color: "#1d2b22", rough: 0.55, clearCoat: 0.3 });
  if (!m.has("foosField")) {
    // a little light of its own, as if from the lamp over the table, so the game still reads at night
    const tex = toTexture(ctx.scene, "foosField", fieldCanvas(), { wrap: false, aniso: 8 });
    m.pbr("foosField", { tex, rough: 0.78, emissive: "#2a2a2a", emissiveTex: tex });
  }
  if (!m.has("foosPlaque")) m.pbr("foosPlaque", { tex: toTexture(ctx.scene, "foosPlaque", plaqueCanvas(), { wrap: false }), rough: 0.4, clearCoat: 0.4 });
  return { field: "foosField", plaque: "foosPlaque" };
}

/** The playfield's print: mown stripes, white markings, each goal's line in its team's colour, the ChimpVibe leaf on the centre spot. */
function fieldCanvas(): HTMLCanvasElement {
  const PX = 1024 / L; // pixels per metre
  const w = 1024;
  const h = Math.round(W * PX);
  const { canvas, ctx: c } = makeCanvas(w, h);
  // u runs along the table from red's end, v across it from the -Z wall (red's handles) at the canvas's foot
  const X = (x: number) => (x + L / 2) * PX;
  const Y = (z: number) => (W / 2 - z) * PX;
  c.fillStyle = "#2c7d48";
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) {
    c.fillStyle = i % 2 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.05)";
    c.fillRect(X(-L / 2 + i * 0.1), 0, 0.1 * PX, h);
  }
  // a fine speckle, so the felt-like print isn't flat
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
    c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  drawLeafEmblem(c, X(0), Y(0) + 6, 70, "rgba(255,255,255,0.12)");
  c.strokeStyle = "rgba(246,244,238,0.92)";
  c.fillStyle = "rgba(246,244,238,0.92)";
  c.lineWidth = 0.006 * PX;
  const inset = 0.012;
  c.strokeRect(X(-L / 2 + inset), Y(W / 2 - inset), (L - 2 * inset) * PX, (W - 2 * inset) * PX);
  c.beginPath();
  c.moveTo(X(0), Y(W / 2 - inset));
  c.lineTo(X(0), Y(-W / 2 + inset));
  c.stroke();
  c.beginPath();
  c.arc(X(0), Y(0), 0.09 * PX, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(X(0), Y(0), 0.008 * PX, 0, Math.PI * 2);
  c.fill();
  for (const s of [-1, 1]) {
    const gx = s * (L / 2 - inset);
    // goal area and penalty area, the penalty spot and the arc
    c.strokeRect(Math.min(X(gx), X(gx - s * 0.07)), Y(0.15), 0.07 * PX, 0.3 * PX);
    c.strokeRect(Math.min(X(gx), X(gx - s * 0.17)), Y(0.25), 0.17 * PX, 0.5 * PX);
    c.beginPath();
    c.arc(X(gx - s * 0.12), Y(0), 0.006 * PX, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    const a0 = s > 0 ? Math.PI - 0.9 : -0.9;
    c.arc(X(gx - s * 0.12), Y(0), 0.07 * PX, a0, a0 + 1.8);
    c.stroke();
    // corner arcs
    for (const t of [-1, 1]) {
      c.beginPath();
      c.arc(X(gx), Y(t * (W / 2 - inset)), 0.025 * PX, 0, Math.PI * 2);
      c.stroke();
    }
    // the goal line in front of the mouth, in the colour of the team defending it
    c.save();
    c.fillStyle = s < 0 ? "#e2483f" : "#3d6ee8";
    c.fillRect(Math.min(X(gx), X(gx - s * 0.012)), Y(GOAL.half), 0.012 * PX, 2 * GOAL.half * PX);
    c.restore();
  }
  return canvas;
}

/** The plaque on each long side of the cabinet. */
function plaqueCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(1024, 192);
  const g = c.createLinearGradient(0, 0, 0, 192);
  g.addColorStop(0, "#3a2516");
  g.addColorStop(1, "#24170e");
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 192);
  c.strokeStyle = "#c8a15a";
  c.lineWidth = 5;
  c.strokeRect(10, 10, 1004, 172);
  drawLeafEmblem(c, 120, 104, 60, "#2fbf8f");
  drawLeafEmblem(c, 904, 104, 60, "#2fbf8f");
  c.fillStyle = "#e8c77a";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "800 78px Nunito";
  c.fillText("CHIMP CUP", 512, 82);
  c.font = "700 30px Montserrat";
  c.fillStyle = "#c9b48a";
  c.fillText("CHIMPHOUSE  ·  TABLE FOOTBALL CLUB", 512, 146);
  return canvas;
}

/** A wedge in a playfield corner: the corner is raised so a ball there rolls back out. `sx`, `sz` pick the corner. */
function cornerRamp(sx: number, sz: number, leg: number, h: number): Geo {
  const g = new Geo();
  const c = [sx * (L / 2), 0, sz * (W / 2)] as const;
  const a = [sx * (L / 2 - leg), 0, sz * (W / 2)] as const;
  const b = [sx * (L / 2), 0, sz * (W / 2 - leg)] as const;
  const t = [c[0], h, c[2]] as const;
  // the slope, facing up and out of the corner
  const e1 = [a[0] - t[0], a[1] - t[1], a[2] - t[2]];
  const e2 = [b[0] - t[0], b[1] - t[1], b[2] - t[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (n[1] < 0) n = n.map((v) => -v);
  const l = Math.hypot(n[0], n[1], n[2]);
  const i0 = g.vert(...t, 0.5, 1, n[0] / l, n[1] / l, n[2] / l);
  const i1 = g.vert(...a, 0, 0, n[0] / l, n[1] / l, n[2] / l);
  const i2 = g.vert(...b, 1, 0, n[0] / l, n[1] / l, n[2] / l);
  g.tri(i0, i1, i2);
  return fixWinding(g);
}

/** A ring round a hole along Z (a rod's bushing), r across, at m. */
const zRing = (R: number, r: number, m: Matrix) => new Geo().add(torus(R, r, 18, 6), xf(0, 0, 0, 0, 1, 1, 1, Math.PI / 2).multiply(m));

/**
 * The foosball table, its base at m: playfield length along local X (red's goal at
 * -X), the rods along Z, red's handles at -Z. Adds the table's slots: its frame
 * (role foosball-table), the eight rods' places and the two counters'.
 */
export function foosball(ctx: WorldCtx, z: Zone, m: Matrix): void {
  const { field, plaque } = mats(ctx);
  const label = "Foosball table";
  const at = (x: number, y: number, zz: number, ry = 0, rx = 0) => xf(x, y, zz, ry, 1, 1, 1, rx).multiply(m);

  // ---------------------------------------------------------------- the cabinet
  const wood = new Geo();
  // the long side walls, which the rods pass through, from the apron's foot to the top
  for (const s of [-1, 1]) wood.add(box(2 * OX, TOP - APRON, SIDE_WALL), xf(0, (TOP + APRON) / 2, s * (OZ - SIDE_WALL / 2)));
  // each end: the outer skin, the blocks either side of the goal box, the lintel over the mouth, the block under the box
  const boxDepth = END_WALL - 0.022;
  for (const s of [-1, 1]) {
    const xi = s * (L / 2 + boxDepth / 2);
    wood.add(box(0.022, TOP - APRON, W), xf(s * (OX - 0.011), (TOP + APRON) / 2, 0));
    for (const t of [-1, 1]) wood.add(box(boxDepth, TOP - APRON, W / 2 - GOAL.half - 0.012), xf(xi, (TOP + APRON) / 2, t * (W / 2 + GOAL.half + 0.012) / 2));
    wood.add(box(boxDepth, TOP - FY - GOAL.height, 2 * GOAL.half + 0.024), xf(xi, (TOP + FY + GOAL.height) / 2, 0));
    wood.add(box(boxDepth, FY - 0.07 - APRON, 2 * GOAL.half + 0.024), xf(xi, (FY - 0.07 + APRON) / 2, 0));
  }
  // the bed under the playfield
  wood.add(box(L, 0.03, W), xf(0, FY - 0.016, 0));
  ctx.g(z, "timber").add(wood, m, label);
  // dark rails capping the walls, and a band round the apron's foot
  const trim = new Geo();
  for (const s of [-1, 1]) {
    trim.add(softBox(2 * OX + 0.02, 0.024, SIDE_WALL + 0.014, 0.008, 0, 1), xf(0, TOP + 0.012, s * (OZ - SIDE_WALL / 2)));
    trim.add(softBox(END_WALL + 0.014, 0.024, W, 0.008, 0, 1), xf(s * (OX - END_WALL / 2), TOP + 0.012, 0));
    trim.add(box(2 * OX + 0.012, 0.035, 0.012), xf(0, APRON + 0.0175, s * (OZ + 0.006)));
    trim.add(box(0.012, 0.035, 2 * OZ + 0.012), xf(s * (OX + 0.006), APRON + 0.0175, 0));
  }
  ctx.g(z, "timberDark").add(trim, m, label);
  // the walls' inner faces round the field, in dark lacquer, so the white ball reads against them
  const inner = new Geo();
  for (const s of [-1, 1]) {
    inner.add(box(L, WALL_TOP, 0.004), xf(0, FY + WALL_TOP / 2, s * (W / 2 - 0.002)));
    for (const t of [-1, 1]) inner.add(box(0.004, WALL_TOP, W / 2 - GOAL.half), xf(s * (L / 2 - 0.002), FY + WALL_TOP / 2, t * (W / 2 + GOAL.half) / 2));
    inner.add(box(0.004, WALL_TOP - GOAL.height, 2 * GOAL.half), xf(s * (L / 2 - 0.002), FY + (WALL_TOP + GOAL.height) / 2, 0));
  }
  ctx.g(z, "foosWallInner").add(inner, m, label);

  // ---------------------------------------------------------------- goals and ball returns
  const goal = new Geo();
  for (const s of [-1, 1]) {
    const x0 = s * L / 2;
    const x1 = s * (L / 2 + boxDepth);
    const cx = (x0 + x1) / 2;
    // the goal box behind the mouth: floor falling away to the back, sides, roof and back, all black
    goal.add(box(boxDepth, 0.008, 2 * GOAL.half + 0.02), xf(cx, FY - 0.035, 0, 0, 1, 1, 1, 0, -s * 0.35));
    for (const t of [-1, 1]) goal.add(box(boxDepth, GOAL.height + 0.07, 0.008), xf(cx, FY + GOAL.height / 2 - 0.035, t * (GOAL.half + 0.006)));
    goal.add(box(boxDepth, 0.008, 2 * GOAL.half + 0.02), xf(cx, FY + GOAL.height + 0.004, 0));
    goal.add(box(0.008, GOAL.height + 0.07, 2 * GOAL.half + 0.02), xf(x1 - s * 0.004, FY + GOAL.height / 2 - 0.035, 0));
    // the ball return on the end, under the goal: a short tube, dark inside, that the ball rolls out into
    goal.add(lathe([[CUP.r, 0], [CUP.r, CUP.len]], 24).flip(), xf(s * OX, FY + CUP.y, 0, 0, 1, 1, 1, 0, -s * Math.PI / 2));
    goal.add(cylinder(CUP.r, 0.002, 24), xf(s * (OX - 0.001), FY + CUP.y, 0, 0, 1, 1, 1, 0, -s * Math.PI / 2));
  }
  ctx.g(z, "black").add(goal, m, "Foosball goal");
  const metal = new Geo();
  for (const s of [-1, 1]) {
    // the goal mouth's frame
    metal.add(box(0.012, 0.01, 2 * GOAL.half + 0.024), xf(s * (L / 2 - 0.004), FY + GOAL.height + 0.005, 0));
    for (const t of [-1, 1]) metal.add(box(0.012, GOAL.height + 0.01, 0.012), xf(s * (L / 2 - 0.004), FY + GOAL.height / 2, t * (GOAL.half + 0.006)));
    // the return tube's chrome outside, and its rolled rim
    metal.add(lathe([[CUP.r + 0.004, 0], [CUP.r + 0.004, CUP.len]], 24), xf(s * OX, FY + CUP.y, 0, 0, 1, 1, 1, 0, -s * Math.PI / 2), "Ball return");
    metal.add(torus(CUP.r + 0.002, 0.0035, 24, 6), xf(s * (OX + CUP.len), FY + CUP.y, 0, 0, 1, 1, 1, 0, Math.PI / 2), "Ball return");
    // the score counter over the end: two posts and the rod the beads slide on
    for (const t of [-1, 1]) metal.add(cylinder(0.006, COUNTER.y - WALL_TOP - 0.014, 10), xf(s * (OX - END_WALL / 2), TOP + 0.02, t * (COUNTER.half + 0.008)), label);
    metal.add(cylinder(0.0035, 2 * COUNTER.half + 0.03, 10), xf(s * (OX - END_WALL / 2), FY + COUNTER.y, -(COUNTER.half + 0.015), 0, 1, 1, 1, Math.PI / 2));
    for (const t of [-1, 1]) metal.add(sphere(0.008, 10, 8), xf(s * (OX - END_WALL / 2), FY + COUNTER.y, t * (COUNTER.half + 0.008)));
  }
  // the serve cup in the middle of each side's top rail, and the serve hole it feeds at the foot of the wall
  for (const s of [-1, 1]) metal.add(torus(0.022, 0.005, 20, 6), xf(0, TOP + 0.025, s * (OZ - SIDE_WALL / 2)));
  // each rod's bushings, inside and outside both walls
  for (const r of RODS) for (const s of [-1, 1]) for (const face of [W / 2 + 0.001, OZ + 0.001]) metal.add(zRing(0.0118, 0.0032, xf(r.x, FY + ROD_Y, s * face)));
  ctx.g(z, "chrome").add(metal, m, label);
  const holes = new Geo();
  for (const s of [-1, 1]) {
    holes.add(cylinder(0.019, 0.004, 18), xf(0, TOP + 0.022, s * (OZ - SIDE_WALL / 2)));
    holes.add(cylinder(0.022, 0.003, 18, true), xf(0, FY, s > 0 ? W / 2 - 0.003 : -W / 2, 0, 1, 1, 1, Math.PI / 2));
  }
  ctx.g(z, "black").add(holes, m, "Serve cup");

  // ---------------------------------------------------------------- the playfield
  ctx.g(z, "foosWallInner", { castShadow: false }).add(new Geo().add(cornerRamp(-1, -1, 0.05, 0.014)).add(cornerRamp(-1, 1, 0.05, 0.014)).add(cornerRamp(1, -1, 0.05, 0.014)).add(cornerRamp(1, 1, 0.05, 0.014)), xf(0, FY + 0.0005, 0).multiply(m), "Foosball corner ramp");
  ctx.screen(z, ROLE.foosballField, at(0, FY + 0.0002, 0, 0, Math.PI / 2), L, W, field, "Foosball playfield");

  // ---------------------------------------------------------------- legs
  const legs = new Geo();
  const lx = OX - 0.1;
  const lz = OZ - 0.085;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      legs.add(box(0.085, APRON - 0.03, 0.085), xf(sx * lx, (APRON + 0.03) / 2, sz * lz));
      legs.add(cylinder(0.03, 0.012, 16), xf(sx * lx, 0, sz * lz), label);
    }
  // a cross brace between each end's legs, and a stretcher joining them
  for (const sx of [-1, 1]) legs.add(box(0.05, 0.06, 2 * lz), xf(sx * lx, 0.17, 0));
  legs.add(box(2 * lx, 0.05, 0.05), xf(0, 0.17, 0));
  ctx.g(z, "black").add(legs, m, label);
  const feet = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) feet.add(cylinder(0.012, 0.018, 10), xf(sx * lx, 0.012, sz * lz));
  ctx.g(z, "chrome").add(feet, m, label);

  // ---------------------------------------------------------------- plaques
  for (const s of [-1, 1]) {
    const pm = at(0, (APRON + 0.035 + FY + ROD_Y - 0.03) / 2, s * (OZ + 0.002), s < 0 ? 0 : Math.PI);
    ctx.g(z, plaque, { castShadow: false }).add(plane(0.62, 0.116), pm, "Foosball table plaque");
  }

  // ---------------------------------------------------------------- slots for what moves
  const standRed = new Vector3(0, -FY, -(OZ + STAND_OUT));
  ctx.slot(z, ROLE.foosballTable, 1, at(0, FY, 0), standRed, label);
  RODS.forEach((r, i) => {
    ctx.slot(z, ROLE.foosballRodSlot, i + 1, at(r.x, FY + ROD_Y, 0), new Vector3(-r.x, -(FY + ROD_Y), SIDE[r.team] * (OZ + STAND_OUT)), `Foosball rod ${i + 1}`);
  });
  for (const [n, team] of [[1, "red"], [2, "blue"]] as [number, Team][]) {
    const s = team === "red" ? -1 : 1;
    ctx.slot(z, ROLE.foosballCounter, n, at(s * (OX - END_WALL / 2), FY + COUNTER.y, 0), new Vector3(0, -(FY + COUNTER.y), SIDE[team] * (OZ + STAND_OUT)), `Foosball score counter ${n}`);
  }
}

// ---------------------------------------------------------------- what moves, built at run time

/** Linear colour, for vertex colours. */
const lin = (hex: string) => Color3.FromHexString(hex).toLinearSpace();
const painted = (g: Geo, hex: string) => {
  const c = lin(hex);
  return g.paint(c.r, c.g, c.b);
};

const FUR = "#4e3526";
const FACE = "#d4ab84";
const SHORTS = "#f2f0ea";
const BOOTS = "#17181a";

/** One man, hanging from his rod at the origin, facing +X: a little chimp in his team's strip. */
function manGeo(team: Team): Geo {
  const shirt = TEAM_COLOR[team];
  const g = new Geo();
  g.add(painted(sphere(0.0118, 12, 9), FUR), xf(0, 0.039, 0));
  g.add(painted(sphere(0.0078, 10, 7, 0.78), FACE), xf(0.0074, 0.0355, 0));
  for (const s of [-1, 1]) g.add(painted(sphere(0.0046, 8, 6), FACE), xf(-0.001, 0.041, s * 0.0118));
  g.add(painted(softBox(0.02, 0.038, 0.03, 0.006, 0, 1), shirt), xf(0, 0.012, 0));
  for (const s of [-1, 1]) {
    g.add(painted(softBox(0.011, 0.03, 0.0075, 0.003, 0, 1), shirt), xf(0, 0.013, s * 0.0185));
    g.add(painted(sphere(0.0045, 8, 6), FUR), xf(0.001, -0.004, s * 0.0185));
  }
  g.add(painted(softBox(0.021, 0.016, 0.029, 0.004, 0, 1), SHORTS), xf(0, -0.014, 0));
  g.add(painted(box(0.014, 0.014, 0.025), FUR), xf(0, -0.029, 0));
  g.add(painted(box(0.015, 0.03, 0.026), shirt), xf(0, -0.05, 0));
  g.add(painted(softBox(0.022, 0.014, 0.027, 0.004, 0, 1), BOOTS), xf(0.003, -(MAN.toe - 0.007), 0));
  return g;
}

/** The grip on a rod's handle end, along +Z from the origin: ridged black rubber with a cap in the team's colour. */
function gripGeo(team: Team): Geo {
  const prof: [number, number][] = [[0.0095, 0], [0.0155, 0.006]];
  for (let i = 0; i < 10; i++) prof.push([GRIP.r - 0.0012, 0.012 + i * 0.011], [GRIP.r, 0.0175 + i * 0.011]);
  prof.push([GRIP.r, GRIP.length - 0.006], [0.0185, GRIP.length - 0.004]);
  const rubber = painted(lathe(prof, 20, false, true), "#1b1b1d");
  const cap = painted(lathe([[0.0185, 0], [0.019, 0.006], [0.014, 0.012], [0.0005, 0.0135]], 20), TEAM_COLOR[team]);
  return new Geo().add(rubber).add(cap, xf(0, GRIP.length - 0.004, 0));
}

/** Where a rod's far end and its grip start, along Z (rod in the middle of its travel). */
export function rodEnds(r: RodSpec): { far: number; grip: number } {
  const out = W / 2 + SIDE_WALL + r.travel + ROD_CLEAR;
  return { far: -SIDE[r.team] * out, grip: SIDE[r.team] * out };
}

export interface FoosballRod {
  /** slides along Z and turns about Z: position.z is the slide, rotation.z the turn (+ swings the men's toes towards +X) */
  root: TransformNode;
  /** the men, bumpers, grip and end cap: role foosball-rod, numbered with the slot */
  men: Mesh;
  shaft: Mesh;
  meshes: Mesh[];
}

/**
 * Build rod n (1-8) on its slot: the chrome shaft through both walls, its men
 * facing the way their team attacks, rubber bumpers inside the walls, the grip
 * on its team's side and a cap on the far end.
 */
export function buildFoosballRod(mats: Materials, slot: TransformNode, n: number): FoosballRod {
  ensureRunMats(mats);
  const scene = mats.scene;
  const sm = slot.metadata as SlotMeta;
  const r = RODS[n - 1];
  const label = `Foosball rod ${n}: ${r.team} ${r.name}`;
  const { far, grip } = rodEnds(r);
  const plastic = new Geo();
  const man = manGeo(r.team);
  const face = r.team === "red" ? 0 : Math.PI;
  for (let k = 0; k < r.men; k++) plastic.add(man, xf(0, 0, manZ(r, k), face));
  // bumpers, meeting the walls' inner faces at the ends of the travel
  for (const s of [-1, 1]) plastic.add(painted(cylinder(0.0135, 0.01, 16), "#202022"), xf(0, 0, s > 0 ? W / 2 - r.travel - 0.01 : -W / 2 + r.travel, 0, 1, 1, 1, Math.PI / 2));
  // the grip on the team's side, a rubber cap on the far end
  const out = Math.sign(grip);
  plastic.add(gripGeo(r.team), xf(0, 0, grip, 0, 1, 1, 1, out * Math.PI / 2));
  plastic.add(painted(lathe([[0.0098, 0], [0.0098, 0.012], [0.006, 0.016], [0.0005, 0.0165]], 14, false, true), "#202022"), xf(0, 0, far, 0, 1, 1, 1, -out * Math.PI / 2));
  const shaftLen = Math.abs(grip - far) + 0.02;
  const shaftGeo = new Geo().add(cylinder(0.008, shaftLen, 14, false), xf(0, 0, Math.min(far, grip + out * 0.02), 0, 1, 1, 1, Math.PI / 2));

  const root = new TransformNode(label, scene);
  root.parent = slot;
  const meta = (matKey: string, role?: string): MeshMeta => ({ room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label }], matKey, kind: "special", ...(role && { role, slot: n }) });
  const men = plastic.build(`${label}:men`, scene);
  men.material = mats.get("foosPlastic");
  men.metadata = meta("foosPlastic", ROLE.foosballRod);
  const shaft = shaftGeo.build(`${label}:shaft`, scene);
  shaft.material = mats.get("chrome");
  shaft.metadata = meta("chrome");
  for (const mesh of [men, shaft]) {
    mesh.parent = root;
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
  }
  return { root, men, shaft, meshes: [men, shaft] };
}

/** The ball: white, with a few dark patches so it can be seen to roll. Its centre at the origin of `parent` (the table's frame). */
export function buildFoosballBall(mats: Materials, table: TransformNode): Mesh {
  ensureRunMats(mats);
  const sm = table.metadata as SlotMeta;
  const ball = MeshBuilder.CreateSphere("Foosball", { diameter: 2 * BALL_R, segments: 12 }, mats.scene);
  ball.parent = table;
  ball.rotationQuaternion = null;
  ball.material = mats.get("foosBall");
  ball.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label: "Foosball" }], matKey: "foosBall", kind: "special", role: ROLE.foosballBall } satisfies MeshMeta;
  ball.receiveShadows = true;
  ball.renderingGroupId = 1;
  return ball;
}

/**
 * A score counter's beads, on counter slot n (1 red's, 2 blue's): WIN_SCORE beads in
 * the team's colour as thin instances of one mesh; `setBeads` slides them.
 */
export function buildFoosballBeads(mats: Materials, counter: TransformNode, team: Team): Mesh {
  ensureRunMats(mats);
  const sm = counter.metadata as SlotMeta;
  const bead = painted(lathe([[0.004, -BEAD.len / 2], [BEAD.r * 0.85, -BEAD.len / 2], [BEAD.r, -BEAD.len / 4], [BEAD.r, BEAD.len / 4], [BEAD.r * 0.85, BEAD.len / 2], [0.004, BEAD.len / 2]], 16), TEAM_COLOR[team]);
  const mesh = new Geo().add(bead, xf(0, 0, 0, 0, 1, 1, 1, Math.PI / 2)).build(`Foosball score beads ${sm.slot}`, mats.scene);
  mesh.parent = counter;
  mesh.material = mats.get("foosPlastic");
  mesh.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label: `Foosball score counter (${team})` }], matKey: "foosPlastic", kind: "special" } satisfies MeshMeta;
  mesh.receiveShadows = true;
  mesh.renderingGroupId = 1;
  const id = Matrix.Identity();
  mesh.thinInstanceAdd(Array.from({ length: WIN_SCORE }, () => id), true);
  setBeads(mesh, team, 0);
  return mesh;
}

/**
 * Slide a counter's beads to show `score` (fractional while they move): the unscored
 * beads rest at the far end, and each goal brings one along towards the team's own side.
 */
export function setBeads(mesh: Mesh, team: Team, score: number): void {
  const toward = SIDE[team];
  const m = new Matrix();
  for (let i = 0; i < WIN_SCORE; i++) {
    const rest = -toward * (COUNTER.half - BEAD.len / 2 - (WIN_SCORE - 1 - i) * BEAD.len);
    const scored = toward * (COUNTER.half - BEAD.len / 2 - i * BEAD.len);
    const k = Math.max(0, Math.min(1, score - i));
    const ease = k * k * (3 - 2 * k);
    Matrix.TranslationToRef(0, 0, rest + (scored - rest) * ease, m);
    mesh.thinInstanceSetMatrixAt(i, m, i === WIN_SCORE - 1);
  }
}

/** The run-time parts' materials: one plastic coloured by its vertices, and the ball's. */
function ensureRunMats(mats: Materials): void {
  if (!mats.has("foosPlastic")) mats.pbr("foosPlastic", { color: "#ffffff", rough: 0.34, clearCoat: 0.45 });
  if (!mats.has("foosBall")) mats.pbr("foosBall", { tex: toTexture(mats.scene, "foosBallTex", ballCanvas(), { wrap: true }), rough: 0.3, clearCoat: 0.6 });
}

/** The ball's surface (a sphere's latitude and longitude): white with dark patches spread round it. */
function ballCanvas(): HTMLCanvasElement {
  const w = 256;
  const h = 128;
  const { canvas, ctx: c } = makeCanvas(w, h);
  c.fillStyle = "#f6f5f0";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#26282c";
  const spots: [number, number][] = [[0, 90], [0, -90]];
  for (let i = 0; i < 5; i++) {
    spots.push([i * 72, 26.6]);
    spots.push([i * 72 + 36, -26.6]);
  }
  for (const [lon, lat] of spots) {
    const cy = ((90 - lat) / 180) * h;
    const stretch = 1 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (const off of [-w, 0, w]) {
      c.beginPath();
      c.ellipse((lon / 360) * w + off, cy, 11 * stretch, 11, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  return canvas;
}
