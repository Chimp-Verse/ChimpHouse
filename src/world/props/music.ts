// MixChimp studio equipment and the showroom's firetruck model.

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import { ensureCCW } from "../geometry/curves";
import { Geo, beam, box, cylinder, disc, fixWinding, lathe, plane, slab, softBox, sphere, torus, tube, xf } from "../geometry/geo";
import { drawLeafEmblem } from "../materials/textures";
import { WorldCtx, Zone } from "../context";
import { makeCanvas } from "../materials/canvas";
import { canvasMat } from "./tech";
import { placeFiretruckModel } from "./firetruckModel";

const STAND = "drumHardware";

/** Matrix at pos whose local +Y points along dir. */
export function alongY(pos: Vector3, dir: Vector3): Matrix {
  const d = dir.normalizeToNew();
  const dot = Vector3.Dot(Vector3.Up(), d);
  let q: Quaternion;
  if (dot > 0.9999) q = Quaternion.Identity();
  else if (dot < -0.9999) q = Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  else q = Quaternion.RotationAxis(Vector3.Cross(Vector3.Up(), d).normalize(), Math.acos(dot));
  return Matrix.Compose(Vector3.One(), q, pos);
}

/** Round rod between two points. */
function rod(a: Vector3, b: Vector3, r: number): Geo {
  return tube([a, b], r, 8);
}

/** Tripod base: three legs from a collar at height h down to the floor at radius rr (all in m's frame). */
function tripod(g: Geo, x: number, zz: number, h: number, rr: number, phase = 0) {
  for (let i = 0; i < 3; i++) {
    const a = phase + (i / 3) * Math.PI * 2;
    g.add(rod(new Vector3(x, h, zz), new Vector3(x + Math.cos(a) * rr, 0.01, zz + Math.sin(a) * rr), 0.009));
    g.add(cylinder(0.014, 0.012, 8), xf(x + Math.cos(a) * rr, 0, zz + Math.sin(a) * rr));
  }
}

/**
 * Drum: shell around local Y centred at the origin, coated batter head on top,
 * resonant head below, chrome hoops and tension lugs.
 */
function drum(ctx: WorldCtx, z: Zone, m: Matrix, r: number, depth: number, shell: string, label: string) {
  const h = depth / 2;
  ctx.g(z, shell).add(cylinder(r, depth, 36, false), xf(0, -h, 0).multiply(m), label);
  ctx.g(z, shell).add(cylinder(r * 0.995, depth, 36, false).flip(), xf(0, -h, 0).multiply(m));
  ctx.g(z, "drumHead").add(disc(r * 0.99, 36), xf(0, h + 0.004, 0).multiply(m), label);
  ctx.g(z, "drumHead").add(disc(r * 0.99, 36).flip(), xf(0, -h - 0.004, 0).multiply(m), label);
  const hw = new Geo();
  hw.add(torus(r + 0.004, 0.008, 36, 6), xf(0, h, 0));
  hw.add(torus(r + 0.004, 0.008, 36, 6), xf(0, -h, 0));
  const lugs = Math.max(6, Math.round(r * 50));
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    hw.add(box(0.022, Math.min(depth * 0.5, 0.12), 0.026), xf(Math.cos(a) * (r + 0.012), 0, Math.sin(a) * (r + 0.012), -a));
  }
  ctx.g(z, STAND).add(hw, m, label);
}

/** Cymbal: bell and bow with real thickness so it reads from above and below. Centre at m, +Y up. */
function cymbalDisc(ctx: WorldCtx, z: Zone, m: Matrix, r: number, label: string) {
  const prof: [number, number][] = [
    [0.001, 0.026],
    [0.04, 0.021],
    [0.055, 0.007],
    [r, -0.012],
    [r, -0.008],
    [0.055, 0.012],
    [0.04, 0.03],
    [0.001, 0.034],
  ];
  ctx.g(z, "cymbal").add(lathe(prof, 40), m, label);
  ctx.g(z, "black").add(cylinder(0.018, 0.02, 10), xf(0, 0.03, 0).multiply(m));
}

/**
 * Boom cymbal stand from a tripod at (x, zz) to a cymbal centred at c (all in
 * the kit frame m), the cymbal tilted by rotX/rotZ.
 */
function cymbalOnBoom(ctx: WorldCtx, z: Zone, m: Matrix, x: number, zz: number, c: Vector3, r: number, rotX: number, rotZ: number, label: string) {
  const g = new Geo();
  tripod(g, x, zz, 0.32, 0.3);
  const postTop = new Vector3(x, c.y - 0.3, zz);
  g.add(rod(new Vector3(x, 0.32, zz), postTop, 0.012));
  const under = c.add(new Vector3(0, -0.05, 0));
  g.add(rod(postTop, under, 0.009));
  g.add(rod(under, c, 0.006));
  g.add(cylinder(0.02, 0.05, 8), xf(x, c.y - 0.33, zz));
  ctx.g(z, STAND).add(g, m, "Cymbal stand");
  cymbalDisc(ctx, z, xf(c.x, c.y, c.z, 0, 1, 1, 1, rotX, rotZ).multiply(m), r, label);
}

/**
 * Five-piece drum kit with hi-hat, crash, ride and splash, kick pedal and
 * throne. Kit frame m: the drummer sits at +Z facing -Z; the kick's front
 * head (with the MixChimp logo) faces -Z.
 */
export function drumKit(ctx: WorldCtx, z: Zone, m: Matrix, shell = "tealDeep"): void {
  if (!ctx.mats.has("drumHead")) ctx.mats.pbr("drumHead", { color: "#f1eee6", rough: 0.55 });
  if (!ctx.mats.has("drumHardware")) ctx.mats.pbr("drumHardware", { color: "#3a3d42", rough: 0.32, metal: 0.85 });
  if (!ctx.mats.has("cymbal")) ctx.mats.pbr("cymbal", { color: "#c9a24a", rough: 0.32, metal: 0.9 });
  const p = (x: number, y: number, zz: number) => new Vector3(x, y, zz);
  const toDrummer = (rx: number, rz = 0) => ({ rx, rz });

  // kick drum lying on its side, axis along Z, on two spurs; pedal and beater at the back
  const kr = 0.28;
  const kd = 0.42;
  const kc = p(0, kr + 0.01, -0.08);
  const kick = xf(kc.x, kc.y, kc.z, 0, 1, 1, 1, Math.PI / 2).multiply(m);
  drum(ctx, z, kick, kr, kd, shell, "Kick drum");
  kickLogo(ctx, z, xf(kc.x, kc.y, kc.z - kd / 2 - 0.007).multiply(m), kr * 0.97);
  const hw = new Geo();
  for (const s of [-1, 1]) {
    hw.add(rod(p(s * (kr - 0.02), kc.y - 0.05, kc.z - 0.12), p(s * (kr + 0.12), 0.01, kc.z - 0.26), 0.009));
    hw.add(cylinder(0.014, 0.012, 8), xf(s * (kr + 0.12), 0, kc.z - 0.26));
  }
  // pedal: footboard, frame, beater
  const pz = kc.z + kd / 2;
  hw.add(box(0.1, 0.012, 0.26), xf(0, 0.03, pz + 0.17, 0, 1, 1, 1, 0.14));
  hw.add(box(0.2, 0.012, 0.05), xf(0, 0.006, pz + 0.02));
  for (const s of [-1, 1]) hw.add(rod(p(s * 0.08, 0.01, pz + 0.02), p(s * 0.08, 0.2, pz + 0.02), 0.008));
  hw.add(rod(p(-0.08, 0.2, pz + 0.02), p(0.08, 0.2, pz + 0.02), 0.008));
  hw.add(rod(p(0, 0.2, pz + 0.02), p(0, 0.33, pz + 0.01), 0.005));
  ctx.g(z, STAND).add(hw, m, "Kick pedal");
  ctx.g(z, "drumHead").add(sphere(0.03, 10, 8), xf(0, 0.34, pz + 0.01).multiply(m), "Kick beater");

  // rack toms on a mount from the kick, tilted toward the drummer
  const mount = new Geo();
  mount.add(rod(p(0, kc.y + kr - 0.01, kc.z), p(0, 0.68, kc.z), 0.014));
  const toms: [number, number, number, number][] = [
    [-0.16, 0.78, 0.127, 0.2],
    [0.17, 0.8, 0.14, 0.22],
  ];
  for (const [x, y, r, d] of toms) {
    const t = toDrummer(0.38, x < 0 ? 0.12 : -0.12);
    drum(ctx, z, xf(x, y, kc.z + 0.02, 0, 1, 1, 1, t.rx, t.rz).multiply(m), r, d, shell, "Rack tom");
    mount.add(rod(p(0, 0.68, kc.z), p(x * 0.55, y - 0.04, kc.z + 0.04), 0.01));
  }
  ctx.g(z, STAND).add(mount, m, "Tom mount");

  // snare on its stand, drummer's left
  const sn = p(-0.34, 0.62, 0.2);
  drum(ctx, z, xf(sn.x, sn.y, sn.z, 0, 1, 1, 1, 0.1, 0.04).multiply(m), 0.178, 0.14, shell, "Snare drum");
  const ss = new Geo();
  tripod(ss, sn.x, sn.z, 0.22, 0.24, 0.5);
  ss.add(rod(p(sn.x, 0.22, sn.z), p(sn.x, sn.y - 0.1, sn.z), 0.011));
  for (let i = 0; i < 3; i++) {
    const a = 0.5 + (i / 3) * Math.PI * 2;
    ss.add(rod(p(sn.x, sn.y - 0.1, sn.z), p(sn.x + Math.cos(a) * 0.15, sn.y - 0.075, sn.z + Math.sin(a) * 0.15), 0.006));
  }
  ctx.g(z, STAND).add(ss, m, "Snare stand");

  // floor tom on three legs, drummer's right
  const ft = p(0.5, 0.4, 0.18);
  drum(ctx, z, xf(ft.x, ft.y, ft.z, 0, 1, 1, 1, 0.06, -0.05).multiply(m), 0.2, 0.36, shell, "Floor tom");
  const fl = new Geo();
  for (let i = 0; i < 3; i++) {
    const a = 1.2 + (i / 3) * Math.PI * 2;
    fl.add(rod(p(ft.x + Math.cos(a) * 0.215, ft.y + 0.05, ft.z + Math.sin(a) * 0.215), p(ft.x + Math.cos(a) * 0.3, 0.01, ft.z + Math.sin(a) * 0.3), 0.008));
  }
  ctx.g(z, STAND).add(fl, m, "Floor tom legs");

  // hi-hat: pair of cymbals on a pedal stand, left of the snare
  const hh = p(-0.66, 0.9, 0.16);
  const hs = new Geo();
  tripod(hs, hh.x, hh.z, 0.3, 0.26, 1.0);
  hs.add(rod(p(hh.x, 0.3, hh.z), p(hh.x, hh.y + 0.06, hh.z), 0.011));
  hs.add(box(0.09, 0.012, 0.26), xf(hh.x, 0.035, hh.z + 0.2, 0, 1, 1, 1, 0.12));
  ctx.g(z, STAND).add(hs, m, "Hi-hat stand");
  cymbalDisc(ctx, z, xf(hh.x, hh.y, hh.z).multiply(m), 0.178, "Hi-hat");
  cymbalDisc(ctx, z, xf(hh.x, hh.y + 0.075, hh.z, 0, 1, 1, 1, Math.PI).multiply(m), 0.178, "Hi-hat");

  // crash (left), splash (over the toms), ride (right)
  cymbalOnBoom(ctx, z, m, -0.78, -0.42, p(-0.45, 1.24, -0.28), 0.23, 0.32, 0.18, "Crash cymbal");
  cymbalOnBoom(ctx, z, m, 0.2, -0.62, p(0.12, 1.12, -0.36), 0.16, 0.42, 0, "Splash cymbal");
  cymbalOnBoom(ctx, z, m, 0.92, -0.18, p(0.66, 1.08, -0.1), 0.28, 0.24, -0.2, "Ride cymbal");

  // throne
  const th = new Geo();
  tripod(th, 0, 0.62, 0.22, 0.26, 0.3);
  th.add(rod(p(0, 0.22, 0.62), p(0, 0.47, 0.62), 0.02));
  ctx.g(z, STAND).add(th, m, "Drum throne");
  ctx.g(z, "leatherBlack").add(softBox(0.36, 0.09, 0.36, 0.045, 0.02), xf(0, 0.51, 0.62).multiply(m), "Drum throne");
  // sticks resting on the snare
  for (const s of [-1, 1]) ctx.g(z, "timberPale", { castShadow: false }).add(rod(p(sn.x - 0.12, sn.y + 0.085, sn.z + s * 0.03), p(sn.x + 0.14, sn.y + 0.09, sn.z + s * 0.05), 0.007), m, "Drumsticks");
}

/** Printed front head of the kick: MixChimp leaf and lettering. Centre at m, facing -Z. */
function kickLogo(ctx: WorldCtx, z: Zone, m: Matrix, r: number) {
  const key = "kickLogo";
  if (!ctx.mats.has(key)) {
    const { canvas, ctx: c } = makeCanvas(512, 512);
    c.fillStyle = "#14302e";
    c.beginPath();
    c.arc(256, 256, 256, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#c9a24a";
    c.lineWidth = 10;
    c.beginPath();
    c.arc(256, 256, 236, 0, Math.PI * 2);
    c.stroke();
    drawLeafEmblem(c, 256, 250, 150, "#7ff0c4");
    c.fillStyle = "#f1e6cc";
    c.font = "600 64px Montserrat";
    c.textAlign = "center";
    c.fillText("MIXCHIMP", 256, 360);
    canvasMat(ctx, key, canvas, 0.55);
  }
  const g = new Geo();
  const n = 40;
  const c0 = g.vert(0, 0, 0, 0.5, 0.5, 0, 0, -1);
  const first = g.vertexCount;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.vert(Math.cos(a) * r, Math.sin(a) * r, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, 0, 0, -1);
  }
  for (let i = 0; i < n; i++) g.tri(c0, first + i, first + i + 1);
  ctx.g(z, key, { castShadow: false }).add(fixWinding(g), m, "Kick drum logo");
}

/**
 * Mic on a boom stand: tripod at base, upright post standH tall, boom out to
 * tip, and the mic at tip aimed at `aim`. "condenser" is a slim pencil mic,
 * "vocal" a large-diaphragm mic with a pop filter, "dynamic" a short instrument mic.
 */
export function boomMic(ctx: WorldCtx, z: Zone, base: Vector3, standH: number, tip: Vector3, aim: Vector3, kind: "condenser" | "vocal" | "dynamic", label = "Microphone"): void {
  const g = new Geo();
  const post = base.add(new Vector3(0, standH, 0));
  const legsH = Math.min(0.28, standH * 0.6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    g.add(rod(base.add(new Vector3(0, legsH, 0)), base.add(new Vector3(Math.cos(a) * 0.3, 0.01, Math.sin(a) * 0.3)), 0.009));
  }
  g.add(rod(base, post, 0.012));
  const out = tip.subtract(post);
  g.add(rod(post.subtract(out.scale(0.3)), tip, 0.008));
  g.add(cylinder(0.025, 0.08, 10), alongY(post.subtract(out.scale(0.3)).subtract(out.normalizeToNew().scale(0.04)), out));
  ctx.g(z, "black").add(g, undefined, "Mic stand");
  const dir = aim.subtract(tip).normalize();
  const mm = alongY(tip, dir);
  if (kind === "condenser") {
    ctx.g(z, "black").add(cylinder(0.011, 0.14, 12), xf(0, -0.04, 0).multiply(mm), label);
    ctx.g(z, "chrome").add(cylinder(0.0115, 0.03, 12), xf(0, 0.1, 0).multiply(mm), label);
  } else if (kind === "dynamic") {
    ctx.g(z, "black").add(lathe([[0.001, -0.06], [0.014, -0.06], [0.02, 0.05], [0.001, 0.05]], 14), mm, label);
    ctx.g(z, "chrome").add(lathe([[0.001, 0.05], [0.02, 0.05], [0.02, 0.08], [0.012, 0.095], [0.001, 0.1]], 14), mm, label);
  } else {
    const ring = new Geo().add(torus(0.07, 0.006, 24, 4));
    for (const s of [-1, 1]) ring.add(rod(new Vector3(s * 0.07, 0, 0), new Vector3(s * 0.04, -0.09, 0), 0.004));
    ctx.g(z, "black").add(ring, xf(0, 0.02, 0, 0, 1, 1, 1, Math.PI / 2).multiply(mm), "Shock mount");
    ctx.g(z, "chrome").add(lathe([[0.001, -0.08], [0.028, -0.08], [0.028, 0.02], [0.03, 0.04], [0.03, 0.09], [0.02, 0.11], [0.001, 0.12]], 18), xf(0, 0, 0, 0, 1, 1, 1, Math.PI / 2).multiply(mm), label);
  }
}

/** Pop filter: fabric disc in a ring, centred at c facing along n. */
export function popFilter(ctx: WorldCtx, z: Zone, c: Vector3, n: Vector3): void {
  const m = alongY(c, n);
  ctx.g(z, "black").add(torus(0.08, 0.006, 28, 4), m, "Pop filter");
  ctx.g(z, "popMesh", { castShadow: false }).add(new Geo().add(disc(0.078, 28)).add(disc(0.078, 28).flip()), m, "Pop filter");
}

/**
 * Guitar, body facing -Z. On a stand (the default) it leans back by `tilt`
 * radians, its body resting in the stand's padded cradle and its neck in the
 * yoke; the stand is shaped around the guitar. With stand: false it hangs
 * upright (tilt 0) on a wall hanger.
 */
export function guitar(ctx: WorldCtx, z: Zone, m: Matrix, kind: "acoustic" | "electric", finish = "timberPale", o: { stand?: boolean; tilt?: number } = {}): void {
  const bodyProf = ensureCCW(
    Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      const lower = Math.sin(a) < 0;
      const rx = lower ? 0.2 : 0.16;
      const waist = 1 - 0.18 * Math.exp(-Math.pow(Math.sin(a), 2) * 0) * (Math.abs(Math.cos(a)) > 0.95 ? 1 : 0);
      return { x: Math.cos(a) * rx * waist, z: Math.sin(a) * (lower ? 0.24 : 0.2) + (lower ? 0 : 0) };
    }),
  );
  const depth = kind === "acoustic" ? 0.1 : 0.045;
  // slab in xz then rotate to stand upright (z -> y), thickness along -Z
  const perm = Matrix.FromValues(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  const body = new Geo().add(slab(bodyProf, -depth / 2, depth / 2), perm);
  const lean = o.tilt ?? 0.25;
  const pose = xf(0, 0.42, 0, 0, 1, 1, 1, lean);
  const tilt = pose.multiply(m);
  ctx.g(z, kind === "acoustic" ? "timberPale" : finish).add(body, tilt, kind === "acoustic" ? "Acoustic guitar" : "Electric guitar");
  ctx.g(z, "timberDark").add(box(0.05, 0.62, 0.025), xf(0, 0.5, -depth / 2 - 0.005).multiply(tilt), "Guitar neck");
  ctx.g(z, "timberDark").add(box(0.08, 0.17, 0.03), xf(0, 0.88, -depth / 2).multiply(tilt));
  if (kind === "acoustic") ctx.g(z, "black").add(cylinder(0.05, 0.005, 16), xf(0, 0.05, -depth / 2 - 0.002, 0, 1, 1, 1, Math.PI / 2).multiply(tilt));
  else ctx.g(z, "white").add(box(0.16, 0.2, 0.004), xf(0, -0.05, -depth / 2 - 0.003).multiply(tilt));
  // strings and bridge
  ctx.g(z, "chrome", { castShadow: false }).add(box(0.03, 0.78, 0.004), xf(0, 0.36, -depth / 2 - 0.02).multiply(tilt), "Guitar strings");
  ctx.g(z, "black").add(box(0.09, 0.02, 0.012), xf(0, -0.07, -depth / 2 - 0.008).multiply(tilt));
  for (let i = 0; i < 6; i++) ctx.g(z, "chrome").add(cylinder(0.006, 0.02, 6), xf((i % 3) * 0.022 - 0.022, 0.91 - Math.floor(i / 3) * 0.05, -depth / 2 - 0.02, 0, 1, 1, 1, Math.PI / 2).multiply(xf(i < 3 ? -0.05 : 0.05, 0, 0)).multiply(tilt));
  if (o.stand === false) {
    // wall hanger cradling the headstock
    ctx.g(z, "black").add(new Geo().add(box(0.06, 0.06, 0.06), xf(0, 0.98, 0.04)).add(box(0.1, 0.015, 0.08), xf(0, 0.96, 0.0)), tilt, "Guitar hanger");
    return;
  }
  // stand, fitted to where the leaning guitar actually is (in m's frame)
  const at = (x: number, y: number, zz: number) => Vector3.TransformCoordinates(new Vector3(x, y, zz), pose);
  const bx = 0.12; // cradle arms under the lower bout, where its edge is 0.192 below the body centre
  const bf = at(bx, -0.192, -depth / 2); // body bottom edge, front face
  const bb = at(bx, -0.192, depth / 2); // body bottom edge, back face
  const yc = Math.min(bf.y, bb.y) - 0.014; // cradle arm centre height (arm radius 0.014)
  const zf = bf.z - 0.03;
  const zb = bb.z + 0.03;
  const yl = (0.98 - 0.42) / Math.cos(lean);
  const nk = at(0, yl, -depth / 2 + 0.0075); // back of the neck at the yoke
  const yk = { y: nk.y, z: nk.z + 0.013 };
  const hub = new Vector3(0, 0.13, zb + 0.04);
  const frame = new Geo();
  for (const foot of [new Vector3(-0.2, 0.012, zf), new Vector3(0.2, 0.012, zf), new Vector3(0, 0.012, hub.z + 0.3)]) {
    frame.add(rod(hub, foot, 0.011));
    frame.add(cylinder(0.018, 0.014, 8), xf(foot.x, 0, foot.z));
  }
  frame.add(rod(new Vector3(-bx, yc - 0.03, zb), new Vector3(bx, yc - 0.03, zb), 0.011));
  frame.add(rod(new Vector3(0, yc - 0.03, zb), hub, 0.011));
  for (const sx of [-1, 1]) frame.add(rod(new Vector3(sx * bx, yc - 0.03, zb), new Vector3(sx * bx, yc, zb), 0.011));
  frame.add(rod(hub, new Vector3(0, yk.y - 0.015, yk.z), 0.012));
  frame.add(rod(new Vector3(-0.045, yk.y, yk.z), new Vector3(0.045, yk.y, yk.z), 0.011));
  ctx.g(z, "black").add(frame, m, "Guitar stand");
  // padded cradle arms with front lips, and padded yoke prongs either side of the neck
  const pads = new Geo();
  for (const sx of [-1, 1]) {
    pads.add(rod(new Vector3(sx * bx, yc, zb), new Vector3(sx * bx, yc, zf), 0.014));
    pads.add(rod(new Vector3(sx * bx, yc, zf), new Vector3(sx * bx, yc + 0.045, zf - 0.005), 0.012));
    pads.add(rod(new Vector3(sx * 0.045, yk.y, yk.z), new Vector3(sx * 0.045, yk.y + 0.02, yk.z - 0.07), 0.01));
  }
  ctx.g(z, "leatherBlack").add(pads, m, "Guitar stand");
}

/** Combo amp, base at m, facing -Z. */
export function amp(ctx: WorldCtx, z: Zone, m: Matrix, w = 0.62, h = 0.5): void {
  ctx.g(z, "leatherBlack").add(softBox(w, h, 0.28, 0.02), xf(0, h / 2, 0).multiply(m), "Guitar amp");
  ctx.g(z, "darkPanel").add(box(w - 0.06, h * 0.62, 0.01), xf(0, h * 0.38, -0.141).multiply(m), "Guitar amp");
  ctx.g(z, "brass").add(box(w - 0.06, 0.06, 0.01), xf(0, h * 0.82, -0.142).multiply(m));
}

/** Keyboard on X-stand or digital piano. base at m, keys face -Z. */
export function keys(ctx: WorldCtx, z: Zone, m: Matrix, w = 1.3, piano = false): void {
  const kb = keysCanvas(ctx);
  if (piano) {
    ctx.g(z, "black").add(box(w, 0.12, 0.38), xf(0, 0.78, 0).multiply(m), "Digital piano");
    ctx.g(z, "black").add(box(0.05, 0.72, 0.36), xf(-w / 2 + 0.03, 0.36, 0).multiply(m));
    ctx.g(z, "black").add(box(0.05, 0.72, 0.36), xf(w / 2 - 0.03, 0.36, 0).multiply(m));
    ctx.g(z, "black").add(box(w, 0.12, 0.04), xf(0, 0.95, 0.17).multiply(m));
  } else {
    // X-stand seen from the front: two crossing legs, feet along the floor, support arms on top
    const yA = 0.76;
    const xs = Math.min(0.38, w / 2 - 0.15);
    const st = new Geo();
    for (const [sx, dz] of [
      [-1, -0.022],
      [1, 0.022],
    ]) {
      st.add(rod(new Vector3(sx * xs, 0.03, dz), new Vector3(-sx * xs, yA - 0.03, dz), 0.016));
      st.add(rod(new Vector3(sx * xs, 0.03, dz), new Vector3(sx * xs, 0.03, 0), 0.016));
      st.add(rod(new Vector3(-sx * xs, yA - 0.03, dz), new Vector3(-sx * xs, yA - 0.016, 0), 0.016));
    }
    st.add(cylinder(0.03, 0.08, 12), xf(0, yA / 2, -0.04, 0, 1, 1, 1, Math.PI / 2));
    for (const sx of [-1, 1]) {
      st.add(rod(new Vector3(sx * xs, 0.022, -0.21), new Vector3(sx * xs, 0.022, 0.21), 0.016));
      st.add(rod(new Vector3(sx * xs, yA - 0.016, -0.17), new Vector3(sx * xs, yA - 0.016, 0.17), 0.016));
    }
    ctx.g(z, "black").add(st, m, "Keyboard stand");
    const caps = new Geo();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) caps.add(box(0.04, 0.035, 0.05), xf(sx * xs, 0.0175, sz * 0.22));
      caps.add(box(0.045, 0.012, 0.3), xf(sx * xs, yA - 0.006, 0));
    }
    ctx.g(z, "leatherBlack").add(caps, m, "Keyboard stand");
    ctx.g(z, "black").add(box(w, 0.09, 0.32), xf(0, yA + 0.045, 0).multiply(m), "Keyboard");
    // control panel: pitch and mod wheels, knobs, a small screen
    const ctl = new Geo();
    for (let i = 0; i < 8; i++) ctl.add(cylinder(0.011, 0.016, 10), xf(-w / 2 + 0.3 + i * 0.07, yA + 0.09, 0.08));
    ctx.g(z, "chrome").add(ctl, m, "Keyboard");
    for (const dx of [0.04, 0.085]) ctx.g(z, "charcoal").add(cylinder(0.03, 0.018, 16), xf(0, -0.009, 0).multiply(xf(-w / 2 + dx, yA + 0.075, -0.08, 0, 1, 1, 1, 0, Math.PI / 2)).multiply(m), "Pitch and mod wheels");
    ctx.g(z, "mint", { castShadow: false }).add(box(0.16, 0.004, 0.06), xf(w / 2 - 0.22, yA + 0.092, 0.08).multiply(m), "Keyboard screen");
  }
  const y = piano ? 0.84 : 0.85;
  const keysQuad = new Geo();
  const k0 = -w / 2 + (piano ? 0.06 : 0.13);
  const a = keysQuad.vert(k0, 0, -0.16, 0, 0, 0, 1, 0);
  const b = keysQuad.vert(w / 2 - 0.06, 0, -0.16, 1, 0, 0, 1, 0);
  const c = keysQuad.vert(w / 2 - 0.06, 0, -0.01, 1, 1, 0, 1, 0);
  const d = keysQuad.vert(k0, 0, -0.01, 0, 1, 0, 1, 0);
  keysQuad.tri(a, d, c);
  keysQuad.tri(a, c, b);
  fixWinding(keysQuad);
  ctx.g(z, kb, { castShadow: false }).add(keysQuad, xf(0, y + 0.001, 0).multiply(m), "Keys");
}

function keysCanvas(ctx: WorldCtx): string {
  if (ctx.mats.has("keysTex")) return "keysTex";
  const { canvas, ctx: c } = makeCanvas(1024, 128);
  c.fillStyle = "#f4f2ec";
  c.fillRect(0, 0, 1024, 128);
  const n = 52;
  for (let i = 0; i <= n; i++) {
    c.fillStyle = "#555";
    c.fillRect((i / n) * 1024, 0, 1.5, 128);
  }
  for (let i = 0; i < n; i++) {
    const k = i % 7;
    if (k === 0 || k === 1 || k === 3 || k === 4 || k === 5) {
      c.fillStyle = "#111";
      c.fillRect(((i + 0.68) / n) * 1024, 0, (0.6 / n) * 1024, 80);
    }
  }
  canvasMat(ctx, "keysTex", canvas, 0.7);
  return "keysTex";
}

/** Flat quad from four corners (counter-clockwise seen from the side it faces), facing n, with uvs. */
function quad(g: Geo, c: Vector3[], n: Vector3, uv: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]) {
  const i = c.map((p, k) => g.vert(p.x, p.y, p.z, uv[k][0], uv[k][1], n.x, n.y, n.z));
  g.tri(i[0], i[1], i[2]);
  g.tri(i[0], i[2], i[3]);
}

function consoleTexture(ctx: WorldCtx): string {
  const key = "consoleTex";
  if (ctx.mats.has(key)) return key;
  const { canvas, ctx: c } = makeCanvas(1024, 512);
  c.fillStyle = "#2b2d31";
  c.fillRect(0, 0, 1024, 512);
  for (let ch = 0; ch < 24; ch++) {
    const x = 14 + ch * 41.5;
    c.fillStyle = "#1a1b1e";
    c.fillRect(x - 2, 8, 35, 496);
    for (let k = 0; k < 7; k++) {
      c.fillStyle = ["#e8b04a", "#d9534f", "#5bc0de", "#e8e8e8", "#5cb85c", "#e8b04a", "#9a7fe0"][k];
      c.beginPath();
      c.arc(x + 15, 26 + k * 32, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#111";
      c.fillRect(x + 14, 19 + k * 32, 2, 7);
    }
    c.fillStyle = ch % 4 === 0 ? "#ff5b5b" : "#3a3d42";
    c.fillRect(x + 3, 256, 24, 14);
    c.fillStyle = "#111";
    c.fillRect(x + 13, 300, 5, 190);
    c.fillStyle = "#e9e9e9";
    c.fillRect(x + 4, 330 + ((ch * 37) % 120), 22, 14);
    c.fillStyle = ch % 3 ? "#3ddc97" : "#ffb25e";
    c.fillRect(x + 27, 286, 4, 10);
  }
  canvasMat(ctx, key, canvas, 0.6);
  return key;
}

/**
 * Mixing console: a wedge whose top slopes up away from the engineer, faders
 * nearest them and EQ knobs behind, with a meter bridge along the back.
 * m at the desk top; the engineer sits at -Z.
 */
export function studioConsole(ctx: WorldCtx, z: Zone, m: Matrix, w: number, d: number): void {
  const tex = consoleTexture(ctx);
  const hf = 0.035;
  const hb = 0.13;
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  const body = new Geo();
  const V = (x: number, y: number, zz: number) => new Vector3(x, y, zz);
  quad(body, [V(x0, 0, z0), V(x1, 0, z0), V(x1, hf, z0), V(x0, hf, z0)], new Vector3(0, 0, -1));
  quad(body, [V(x1, 0, z1), V(x0, 0, z1), V(x0, hb, z1), V(x1, hb, z1)], new Vector3(0, 0, 1));
  quad(body, [V(x0, 0, z1), V(x0, 0, z0), V(x0, hf, z0), V(x0, hb, z1)], new Vector3(-1, 0, 0));
  quad(body, [V(x1, 0, z0), V(x1, 0, z1), V(x1, hb, z1), V(x1, hf, z0)], new Vector3(1, 0, 0));
  ctx.g(z, "black").add(fixWinding(body), m, "Mixing console");
  const top = new Geo();
  const slope = new Vector3(0, d, -(hb - hf)).normalize();
  const inset = 0.015;
  quad(top, [V(x0 + inset, hf + 0.001, z0 + inset), V(x1 - inset, hf + 0.001, z0 + inset), V(x1 - inset, hb + 0.001, z1 - inset), V(x0 + inset, hb + 0.001, z1 - inset)], slope);
  ctx.g(z, tex, { castShadow: false }).add(fixWinding(top), m, "Mixing console");
  // meter bridge with lit level meters
  ctx.g(z, "black").add(box(w - 0.04, 0.07, 0.05), xf(0, hb + 0.035, z1 - 0.03).multiply(m), "Meter bridge");
  const meters = new Geo();
  const n = 24;
  for (let i = 0; i < n; i++) meters.add(box(0.012, 0.02 + ((i * 7) % 5) * 0.008, 0.004), xf(x0 + 0.04 + ((w - 0.08) * (i + 0.5)) / n, hb + 0.03, z1 - 0.056));
  ctx.g(z, "mint", { castShadow: false }).add(meters, m, "Meter bridge");
}

/**
 * Curved ultrawide monitor, concave toward the viewer at -Z: the screen bends
 * round them with radius R. Base of the stand at m.
 */
export function curvedMonitor(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, R: number, screen: string, label = "Curved monitor"): void {
  const y0 = 0.16;
  const zc = -R; // centre of curvature, toward the viewer
  const half = w / 2 / R;
  const n = 28;
  const scr = new Geo();
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -half + (2 * half * i) / n;
    const x = Math.sin(a) * R;
    const zz = zc + Math.cos(a) * R;
    const nx = -Math.sin(a);
    const nz = -Math.cos(a);
    lo.push(scr.vert(x, y0, zz, i / n, 0, nx, 0, nz));
    hi.push(scr.vert(x, y0 + h, zz, i / n, 1, nx, 0, nz));
  }
  for (let i = 0; i < n; i++) {
    scr.tri(lo[i], lo[i + 1], hi[i + 1]);
    scr.tri(lo[i], hi[i + 1], hi[i]);
  }
  ctx.g(z, screen, { castShadow: false }).add(fixWinding(scr), m, label);
  // shell just behind the screen, with a slim bezel all round
  const back: Vector3[] = [];
  const bh = half + 0.012 / R;
  for (let i = 0; i <= n; i++) {
    const a = -bh + (2 * bh * i) / n;
    back.push(new Vector3(Math.sin(a) * (R + 0.016), y0 + h / 2, zc + Math.cos(a) * (R + 0.016)));
  }
  ctx.g(z, "black").add(beam(back, 0.026, h + 0.03), m, label);
  // stand: neck and foot
  ctx.g(z, "black").add(new Geo().add(box(0.06, y0 + h / 2, 0.04), xf(0, (y0 + h / 2) / 2, 0.06)).add(box(0.32, 0.015, 0.22), xf(0, 0.0075, 0.04)), m, label);
}

function rackTexture(ctx: WorldCtx): string {
  const key = "rackFace";
  if (ctx.mats.has(key)) return key;
  const { canvas, ctx: c } = makeCanvas(512, 256);
  const units = 4;
  for (let u = 0; u < units; u++) {
    const y = u * 64;
    c.fillStyle = u % 2 ? "#34363b" : "#2a2c30";
    c.fillRect(0, y, 512, 64);
    c.fillStyle = "#16171a";
    c.fillRect(0, y + 62, 512, 2);
    c.fillStyle = "#8d9096";
    for (const x of [12, 500]) {
      c.beginPath();
      c.arc(x, y + 32, 4, 0, Math.PI * 2);
      c.fill();
    }
    if (u === 1) {
      c.fillStyle = "#f2d38a";
      c.fillRect(40, y + 12, 70, 40);
      c.fillRect(124, y + 12, 70, 40);
      c.strokeStyle = "#222";
      c.lineWidth = 3;
      for (const x of [75, 159]) {
        c.beginPath();
        c.moveTo(x, y + 48);
        c.lineTo(x + 18, y + 18);
        c.stroke();
      }
    }
    for (let k = 0; k < 6; k++) {
      c.fillStyle = "#c9ccd2";
      c.beginPath();
      c.arc(250 + k * 40, y + 32, 11, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#222";
      c.fillRect(249 + k * 40, y + 22, 2, 9);
    }
    c.fillStyle = u % 2 ? "#3ddc97" : "#ff8a3d";
    c.fillRect(u === 1 ? 210 : 60, y + 28, 8, 8);
  }
  canvasMat(ctx, key, canvas, 0.75);
  return key;
}

/** Box of rack gear (outboard), front panels facing -Z. Base at m. */
export function rackGear(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, d: number, label = "Outboard rack"): void {
  ctx.g(z, "black").add(box(w, h, d), xf(0, h / 2, 0).multiply(m), label);
  ctx.g(z, rackTexture(ctx), { castShadow: false }).add(plane(w - 0.02, h - 0.02), xf(0, h / 2, -d / 2 - 0.002).multiply(m), label);
}

/** Small MIDI keyboard for the desk, keys toward -Z. Base at m. */
export function midiKeys(ctx: WorldCtx, z: Zone, m: Matrix, w: number): void {
  ctx.g(z, "black").add(box(w, 0.045, 0.22), xf(0, 0.0225, 0).multiply(m), "MIDI keyboard");
  const kb = keysCanvas(ctx);
  const g = new Geo();
  quad(g, [new Vector3(-w / 2 + 0.1, 0, -0.105), new Vector3(w / 2 - 0.02, 0, -0.105), new Vector3(w / 2 - 0.02, 0, 0.04), new Vector3(-w / 2 + 0.1, 0, 0.04)], new Vector3(0, 1, 0));
  ctx.g(z, kb, { castShadow: false }).add(fixWinding(g), xf(0, 0.046, 0).multiply(m), "MIDI keyboard");
  const knobs = new Geo();
  for (let i = 0; i < 4; i++) knobs.add(cylinder(0.009, 0.012, 10), xf(-w / 2 + 0.03 + (i % 2) * 0.035, 0.045, -0.06 + Math.floor(i / 2) * 0.05));
  for (let i = 0; i < 8; i++) knobs.add(cylinder(0.006, 0.01, 8), xf(-w / 2 + 0.16 + i * 0.05, 0.045, 0.085));
  ctx.g(z, "chrome").add(knobs, m, "MIDI keyboard");
}

/** Studio headphones resting on a small stand. Base at m. */
export function headphoneStand(ctx: WorldCtx, z: Zone, m: Matrix): void {
  ctx.g(z, "timberDark").add(new Geo().add(cylinder(0.06, 0.015, 16)).add(cylinder(0.01, 0.26, 8), xf(0, 0.015, 0)).add(box(0.12, 0.015, 0.025), xf(0, 0.27, 0)), m, "Headphone stand");
  const band: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    band.push(new Vector3(Math.cos(a) * 0.085, 0.27 + Math.sin(a) * 0.02 + 0.01, 0));
  }
  ctx.g(z, "black").add(tube(band, 0.012, 8), m, "Headphones");
  for (const s of [-1, 1]) {
    ctx.g(z, "leatherBlack").add(cylinder(0.045, 0.035, 18), xf(0, -0.0175, 0).multiply(xf(s * 0.1, 0.22, 0, 0, 1, 1, 1, 0, Math.PI / 2)).multiply(m), "Headphones");
    ctx.g(z, "black").add(rod(new Vector3(s * 0.085, 0.28, 0), new Vector3(s * 0.1, 0.265, 0), 0.006), m);
  }
}

/** Studio monitor speaker: cabinet, woofer and tweeter, on an isolation pad. Base at m, facing -Z. */
export function studioMonitor(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, d: number): void {
  ctx.g(z, "charcoal").add(box(w + 0.02, 0.04, d), xf(0, 0.02, 0).multiply(m), "Isolation pad");
  ctx.g(z, "black").add(softBox(w, h, d, 0.015), xf(0, 0.04 + h / 2, 0).multiply(m), "Studio monitor");
  const cones = new Geo();
  cones.add(lathe([[w * 0.4, 0], [w * 0.34, 0.02], [w * 0.1, 0.045], [0.001, 0.05]], 24), xf(0, 0.04 + h * 0.33, -d / 2 - 0.002, 0, 1, 1, 1, -Math.PI / 2));
  cones.add(lathe([[w * 0.16, 0], [w * 0.1, 0.012], [0.001, 0.02]], 18), xf(0, 0.04 + h * 0.78, -d / 2 - 0.002, 0, 1, 1, 1, -Math.PI / 2));
  ctx.g(z, "charcoal").add(cones, m, "Studio monitor");
  ctx.g(z, "chrome").add(new Geo().add(torus(w * 0.4, 0.006, 24, 4), xf(0, 0.04 + h * 0.33, -d / 2 - 0.003, 0, 1, 1, 1, -Math.PI / 2)), m);
  ctx.g(z, "mint", { castShadow: false }).add(cylinder(0.006, 0.004, 8), xf(w * 0.32, 0.04 + 0.05, -d / 2 - 0.002, 0, 1, 1, 1, -Math.PI / 2).multiply(m));
}

/**
 * Red firetruck display model (~1.6 m long), centred at m, length along X, cab at +X, wheels
 * on y = 0: its creator's model when it loaded (firetruckModel.ts), else this code-built one.
 */
export function firetruck(ctx: WorldCtx, z: Zone, m: Matrix, scale = 1): void {
  if (placeFiretruckModel(ctx, z, m, scale)) return;
  const s = xf(0, 0, 0, 0, scale).multiply(m);
  const red = ctx.g(z, "red");
  red.add(softBox(0.5, 0.42, 0.5, 0.05), xf(0.55, 0.38, 0).multiply(s), "Firetruck model");
  red.add(softBox(1.12, 0.36, 0.5, 0.03), xf(-0.25, 0.35, 0).multiply(s), "Firetruck model");
  ctx.g(z, "chrome").add(box(1.0, 0.04, 0.42), xf(-0.25, 0.55, 0).multiply(s), "Firetruck model");
  const ladder = ctx.g(z, "chrome");
  for (const zz of [-0.12, 0.12]) ladder.add(box(1.25, 0.03, 0.03), xf(-0.15, 0.66, zz, 0, 1, 1, 1, 0, 0.05).multiply(s));
  for (let i = 0; i < 11; i++) ladder.add(box(0.02, 0.02, 0.24), xf(-0.75 + i * 0.12, 0.66 + i * 0.006, 0).multiply(s));
  ctx.g(z, "screenOff").add(box(0.06, 0.18, 0.44), xf(0.79, 0.45, 0, 0, 1, 1, 1, 0, -0.15).multiply(s), "Firetruck windscreen");
  ctx.g(z, "white").add(box(1.0, 0.03, 0.505), xf(-0.25, 0.3, 0).multiply(s));
  const wheels = ctx.g(z, "black");
  for (const x of [0.55, -0.35, -0.65])
    for (const zz of [-0.24, 0.24]) {
      wheels.add(cylinder(0.13, 0.1, 16), xf(x, 0.13, zz + (zz > 0 ? -0.05 : -0.05), 0, 1, 1, 1, Math.PI / 2).multiply(s), "Firetruck model");
      ctx.g(z, "chrome").add(cylinder(0.06, 0.102, 12), xf(x, 0.13, zz - 0.051, 0, 1, 1, 1, Math.PI / 2).multiply(s));
    }
  ctx.g(z, "bulb").add(box(0.12, 0.05, 0.3), xf(0.55, 0.62, 0).multiply(s), "Light bar");
}
