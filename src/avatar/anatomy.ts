// The chimp's anatomy as distance fields (avatar/sdf.ts), from its DNA and skeleton:
// a body with a barrel chest, a pot belly, long arms and short legs; a low skull with
// a heavy brow, a long muzzle and big round ears; long-fingered hands and hand-like
// feet. Each part is meshed at its own grid size (the face and fingers need finer
// detail than the back), and the parts overlap where they meet, under fur.
//
// It also says what each point of the skin is: furred or bare, how long the fur is
// and which way it lies, the beard, the lips, the nails, and which bones move it.
// That is the code-first stand-in for what a Blender model will carry as vertex
// groups, weights and texture masks (docs/plans/2026-10-16-chimp-avatar-plan.md).

import type { ChimpDna } from "./dna";
import { FINGERS, type Rig, SIDES, buildRig, children } from "./rig";
import { Field, Prim, type V3, add, clamp01, cross, dot, len, lerp3, norm, scale, segment, smin, smoothstep, sub } from "./sdf";

export type PartName = "body" | "head" | "handL" | "handR" | "footL" | "footR";

export interface Part {
  name: PartName;
  field: Field;
  min: V3;
  max: V3;
  /** the grid the part is first meshed on: fine enough for its smallest feature */
  h: number;
  /** the skin's budget once simplified: triangles, and the longest edge allowed */
  skin: { tris: number; edge: number };
  /** the fur carrier's (simplified further, then only its furred triangles kept) */
  fur: { tris: number; edge: number };
}

/** What a point of the skin is (see `Anatomy.paint`). */
export interface Paint {
  /** 0 bare skin, 1 full fur */
  fur: number;
  /** fur length, as a multiple of the DNA's */
  furLen: number;
  /** 0 the face's skin colour, 1 the hands-and-feet colour */
  palm: number;
  /** darker skin: round the eyes, in the ears and nostrils */
  dark: number;
  /** the grey beard (scaled by the DNA's beard) */
  grey: number;
  /** fingernails and toenails */
  nail: number;
  /** 0 skin, about 0.4 the lips, 1 inside the mouth */
  mouth: number;
  /** the way the fur lies along the skin (unit, square to the normal) */
  flow: V3;
}

export interface Anatomy {
  rig: Rig;
  parts: Part[];
  /** say what the skin is at p (rest space) with outward normal n, on a part */
  paint(part: PartName, p: V3, n: V3, out: Paint): void;
  /** the bones that move p, and how much (up to four, summing to one) */
  weigh(part: Part, p: V3, list: ArrayLike<number>, bones: Int32Array, weights: Float32Array): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function buildAnatomy(dna: ChimpDna): Anatomy {
  const shape = dna.shape;
  const rig = buildRig(shape);
  const { bones, index, marks } = rig;
  const kids = children(rig);
  const B = (n: string) => index[n];
  const J = (n: string): V3 => bones[index[n]].head;
  const T = (n: string): V3 => bones[index[n]].tail;
  const g = marks.girth;
  const hk = lerp(0.96, 1.2, shape.head);
  const mk = lerp(0.85, 1.18, shape.muzzle);
  const bk = lerp(0.7, 1.35, shape.brow);
  const ek = lerp(0.8, 1.15, shape.ears);
  const ak = lerp(0.9, 1.1, shape.arms);
  const lk = lerp(0.88, 1.12, shape.legs);
  const bellyK = lerp(0.55, 1.3, shape.belly);
  const C = marks.cranium;
  /** a point in the head's frame: offsets from the middle of the skull, scaled with the head */
  const HP = (x: number, y: number, z: number): V3 => add(C, [x * hk, y * hk, z * hk]);

  // ================================================================ body
  const body = new Field();
  const hips = J("hips");
  const spine = J("spine");
  const chest = J("chest");
  const upper = J("upperChest");
  // the pelvis, wide and deep
  body.add(Prim.ellipsoid(add(hips, [0, -0.008, -0.012]), [0.146 * g, 0.102, 0.116 * g], B("hips"), "pelvis"));
  // the chimp's round pot belly, low and forward
  body.add(Prim.ellipsoid(add(spine, [0, 0.02, 0.018 + 0.028 * (bellyK - 1)]), [0.158 * g * lerp(0.95, 1.07, shape.belly), 0.148, 0.124 * g * bellyK], B("spine"), "belly"), 0.075);
  // a barrel chest
  body.add(Prim.ellipsoid(add(chest, [0, 0.035, -0.004]), [0.166 * g, 0.165, 0.127 * g], B("chest"), "ribs"), 0.075);
  // broad shoulders and the hump of muscle behind the neck
  body.add(Prim.ellipsoid(add(upper, [0, 0.056, -0.014]), [0.178 * g, 0.092, 0.11 * g], B("upperChest"), "shoulders"), 0.065);
  body.add(Prim.ellipsoid(add(upper, [0, 0.11, -0.064]), [0.124 * g, 0.1, 0.086 * g], B("upperChest"), "hump"), 0.055);
  // a short, thick neck, carried forward, running up inside the head
  body.add(Prim.cone(add(upper, [0, 0.07, -0.006]), add(J("head"), [0, 0.045, 0.004]), 0.09 * g, 0.066, B("neck"), "neck"), 0.055);
  SIDES.forEach((side, si) => {
    const s = si === 0 ? -1 : 1;
    body.add(Prim.sphere(add(hips, [s * 0.062 * g, -0.035, -0.06 * g]), 0.068 * g, B("hips"), "glute"), 0.045);
    const sh = J(`${side}UpperArm`);
    body.add(Prim.ellipsoid(add(sh, [-s * 0.008, 0.006, -0.004]), [0.052 * g, 0.058 * g, 0.056 * g], B(`${side}UpperArm`), "deltoid"), 0.04);
  });
  body.fork();
  SIDES.forEach((side, si) => {
    const s = si === 0 ? -1 : 1;
    // the arm: a thick upper arm, a muscled forearm, ending in a stub inside the hand's own mesh
    const sh = J(`${side}UpperArm`);
    const el = J(`${side}LowerArm`);
    const wr = J(`${side}Hand`);
    const along = marks.hands[si].along;
    const up = norm(sub(el, sh));
    const fo = norm(sub(wr, el));
    const front: V3 = [0, 0, 1];
    const arm = new Field();
    arm.add(Prim.cone(sh, el, 0.06 * g, 0.046 * g, B(`${side}UpperArm`), "upperArm"));
    arm.add(Prim.ellipsoid(add(lerp3(sh, el, 0.46), scale(front, 0.008)), [0.053 * g, 0.052 * g, 0.105 * ak], B(`${side}UpperArm`), "biceps", up, front), 0.024);
    arm.add(Prim.cone(el, wr, 0.05 * g, 0.032 * g, B(`${side}LowerArm`), "forearm"), 0.026);
    arm.add(Prim.ellipsoid(add(lerp3(el, wr, 0.3), scale(cross(fo, front), -s * 0.004)), [0.057 * g, 0.05 * g, 0.094 * ak], B(`${side}LowerArm`), "forearmMuscle", fo, front), 0.026);
    arm.add(Prim.cone(wr, add(wr, scale(along, 0.032)), 0.029 * g, 0.026, B(`${side}Hand`), "wristStub"), 0.012);
    body.limb(arm, 0.026);
    // the leg: short, a strong thigh, a slim shin, ending in a stub inside the foot's mesh
    const hp = J(`${side}UpperLeg`);
    const kn = J(`${side}LowerLeg`);
    const an = J(`${side}Foot`);
    const th = norm(sub(kn, hp));
    const sn = norm(sub(an, kn));
    const leg = new Field();
    leg.add(Prim.cone(hp, kn, 0.077 * g, 0.05 * g, B(`${side}UpperLeg`), "thigh"));
    leg.add(Prim.ellipsoid(add(lerp3(hp, kn, 0.42), [s * 0.004, 0, 0.012]), [0.066 * g, 0.064 * g, 0.125 * lk], B(`${side}UpperLeg`), "quads", th, front), 0.03);
    leg.add(Prim.cone(kn, an, 0.049 * g, 0.032 * g, B(`${side}LowerLeg`), "shin"), 0.026);
    leg.add(Prim.ellipsoid(add(lerp3(kn, an, 0.3), [0, 0, -0.016]), [0.044 * g, 0.043 * g, 0.085 * lk], B(`${side}LowerLeg`), "calf", sn, front), 0.022);
    leg.add(Prim.sphere(an, 0.029, B(`${side}Foot`), "ankleStub"), 0.012);
    body.limb(leg, 0.05);
  });

  // ================================================================ head
  const head = new Field();
  const HEAD = B("head");
  const JAW = B("jaw");
  const eyeR = marks.eyeRadius;
  // a low skull, flatter on top than a person's, longer front to back
  head.add(Prim.ellipsoid(HP(0, 0.004, -0.014), marks.craniumR, HEAD, "cranium"));
  head.add(Prim.ellipsoid(HP(0, -0.02, -0.044), [0.075 * hk, 0.062 * hk, 0.064 * hk], HEAD, "occiput"), 0.03);
  // the brow ridge: a heavy shelf over each eye, dipping where they meet
  for (const s of [-1, 1]) head.add(Prim.cone(HP(s * 0.058, 0.026, 0.068), HP(s * 0.007, 0.029, 0.096), 0.0148 * bk * hk, 0.0132 * bk * hk, HEAD, "brow"), 0.018);
  // cheekbones, and the pads beside the muzzle
  for (const s of [-1, 1]) {
    head.add(Prim.sphere(HP(s * 0.05, -0.014, 0.064), 0.027 * hk, HEAD, "cheek"), 0.026);
    head.add(Prim.sphere(HP(s * 0.035, -0.052, 0.1 + 0.016 * (mk - 1)), 0.026 * hk, HEAD, "jowl"), 0.022);
  }
  // the muzzle: forward and low; the long, mobile upper lip of a chimp
  const muzzleC = HP(0, -0.044, 0.088 + 0.02 * (mk - 1));
  const muzzleR: V3 = [0.054 * hk, 0.045 * hk, 0.062 * hk * mk];
  head.add(Prim.ellipsoid(muzzleC, muzzleR, HEAD, "muzzle"), 0.03);
  /** where the muzzle's front is, at a height and across it (rest space) */
  const front = (x: number, y: number) => muzzleC[2] + muzzleR[2] * Math.sqrt(Math.max(0, 1 - (x / muzzleR[0]) ** 2 - ((y - muzzleC[1]) / muzzleR[1]) ** 2));
  const lipY = C[1] - 0.059 * hk;
  head.add(Prim.ellipsoid([C[0], lipY, front(0, lipY) - 0.012 * hk], [0.046 * hk, 0.02 * hk, 0.02 * hk], HEAD, "upperLip", [0, -0.3, 1]), 0.014);
  // the nose: a flat bridge from between the eyes down to a soft pad that carries the nostrils
  head.add(Prim.ellipsoid(HP(0, -0.006, 0.106 + 0.014 * (mk - 1)), [0.012 * hk, 0.03 * hk, 0.011 * hk], HEAD, "nose", [0, 0.3, 1]), 0.012);
  const noseY = C[1] - 0.025 * hk;
  head.add(Prim.ellipsoid([C[0], noseY, front(0, noseY) - 0.005 * hk], [0.017 * hk, 0.011 * hk, 0.009 * hk], HEAD, "nosePad", [0, 0.2, 1]), 0.008);
  // the jaw and chin, which drop when the jaw opens
  head.add(Prim.ellipsoid(HP(0, -0.089, 0.094 + 0.022 * (mk - 1)), [0.05 * hk, 0.026 * hk, 0.054 * hk * mk], JAW, "chin"), 0.026);
  head.add(Prim.ellipsoid(HP(0, -0.0795, 0.124 + 0.034 * (mk - 1)), [0.044 * hk, 0.016 * hk, 0.026 * hk * mk], JAW, "lowerLip", [0, -0.1, 1]), 0.012);
  // the top of the neck, down into the body's
  head.add(Prim.cone(add(J("neck"), [0, 0.02, -0.005]), HP(0, -0.05, -0.03), 0.07 * g, 0.064, B("neck"), "neck"), 0.035);
  // eye sockets, nostrils and the mouth's line, cut in
  for (const e of [marks.eyeL, marks.eyeR]) head.cut(Prim.sphere(e, eyeR + 0.0022, HEAD, "socket"), 0.004);
  // the nostrils, on the pad's front
  const noseTip: V3 = [C[0], noseY - 0.002 * hk, front(0, noseY) + 0.0035 * hk];
  for (const s of [-1, 1]) head.cut(Prim.ellipsoid(add(noseTip, [s * 0.0085 * hk, 0, -0.001]), [0.0038 * hk, 0.0027 * hk, 0.0065 * hk], HEAD, "nostril", [s * 0.35, -0.45, 1]), 0.002);
  const mouthW = 0.035 * hk * Math.sqrt(mk);
  const mouthFwd = norm([0, -0.12, 1]);
  const slit = Prim.box(add(marks.mouth, scale(mouthFwd, -0.008)), [mouthW, 0.0012 * hk, 0.026 * hk], 0.0007, HEAD, "mouth", mouthFwd, [0, 1, 0], 3.2);
  head.cut(slit, 0.0022);
  // the ears, added after the cuts: big round discs standing out from the skull, cupped
  const earPrims: Prim[] = [];
  const earNormals: V3[] = [];
  SIDES.forEach((side, si) => {
    const s = si === 0 ? -1 : 1;
    const n = norm([s, 0.12, 0.85]);
    const base = si === 0 ? marks.earL : marks.earR;
    const c = add(add(base, scale(n, 0.012 * ek * hk)), [s * 0.006 * ek * hk, 0.002, -0.004]);
    const ear = Prim.ellipsoid(c, [0.035 * ek * hk, 0.041 * ek * hk, 0.0095 * ek * hk], B(`${side}Ear`), "ear", n, [0, 1, 0]);
    head.add(ear, 0.009);
    const cup = Prim.ellipsoid(add(c, scale(n, 0.0092 * ek * hk)), [0.0255 * ek * hk, 0.03 * ek * hk, 0.0078 * ek * hk], B(`${side}Ear`), "earCup", n, [0, 1, 0]);
    head.cut(cup, 0.004);
    // the fold inside the cup (the antihelix)
    const fold = Prim.ellipsoid(add(add(c, scale(n, 0.004 * ek * hk)), [s * 0.004 * ek * hk, -0.004 * ek * hk, -0.006 * ek * hk]), [0.012 * ek * hk, 0.02 * ek * hk, 0.004 * ek * hk], B(`${side}Ear`), "earFold", n, [0, 1, 0]);
    head.add(fold, 0.004);
    earPrims.push(ear, cup);
    earNormals.push(n);
  });

  // ================================================================ hands
  const hands: Field[] = [];
  const nailPrims: Prim[] = [];
  SIDES.forEach((side, si) => {
    const s = si === 0 ? -1 : 1;
    const { along, palm, thumb, wrist } = marks.hands[si];
    const hand = new Field();
    const HB = B(`${side}Hand`);
    // the wrist, reaching back inside the forearm
    hand.add(Prim.cone(add(wrist, scale(along, -0.05)), add(wrist, scale(along, 0.012)), 0.03 * g, 0.029 * g, B(`${side}LowerArm`), "wrist"));
    // the palm: long and narrow, padded at its heel; the knuckles a ridge across its back
    hand.add(Prim.ellipsoid(add(add(wrist, scale(along, 0.047 * ak)), scale(palm, 0.001)), [0.035 * Math.sqrt(g), 0.05 * ak, 0.0158 * Math.sqrt(g)], HB, "palm", palm, along), 0.014);
    hand.add(Prim.ellipsoid(add(add(wrist, scale(along, 0.02 * ak)), scale(palm, 0.006)), [0.031, 0.026, 0.0165], HB, "heel", palm, along), 0.012);
    const knuckles = T(`${side}Hand`);
    hand.add(Prim.ellipsoid(add(knuckles, add(scale(along, -0.007), scale(palm, -0.003))), [0.043 * Math.sqrt(g), 0.0125, 0.0128], HB, "knuckles", palm, along), 0.01);
    hand.fork();
    for (let f = 1; f < 5; f++) {
      const name = FINGERS[f];
      const finger = new Field();
      const thin = f === 4 ? 0.88 : f === 1 ? 0.97 : 1;
      const radii = [
        [0.0106, 0.0099],
        [0.0099, 0.0092],
        [0.0092, 0.0079],
      ];
      ["Proximal", "Intermediate", "Distal"].forEach((seg, k) => {
        const bn = `${side}${name}${seg}`;
        const a = J(bn);
        const b = T(bn);
        finger.add(Prim.cone(a, b, radii[k][0] * thin * Math.pow(g, 0.3), radii[k][1] * thin * Math.pow(g, 0.3), B(bn), "finger"), 0.003);
        // the knuckle at the joint, a little proud
        finger.add(Prim.sphere(a, radii[k][0] * thin * 1.06 * Math.pow(g, 0.3), B(bn), "knuckle"), 0.003);
        if (k === 2) {
          // the nail, on the back of the fingertip
          const d = norm(sub(b, a));
          const nail = Prim.ellipsoid(add(lerp3(a, b, 0.62), scale(palm, -radii[k][1] * thin * 0.78)), [0.0062 * thin, 0.0022, 0.009 * thin], B(bn), "nail", d, scale(palm, -1));
          finger.add(nail, 0.0015);
          nailPrims.push(nail);
        }
      });
      hand.limb(finger, 0.0085);
    }
    // the thumb: short, set low on the palm
    const thumbF = new Field();
    ["Metacarpal", "Proximal", "Distal"].forEach((seg, k) => {
      const bn = `${side}Thumb${seg}`;
      const a = J(bn);
      const b = T(bn);
      const r = [
        [0.0135, 0.0118],
        [0.0118, 0.0104],
        [0.0104, 0.0088],
      ][k];
      thumbF.add(Prim.cone(a, b, r[0], r[1], B(bn), "thumb"), 0.004);
      if (k === 2) {
        const d = norm(sub(b, a));
        const back = norm(cross(d, scale(thumb, s)));
        const nail = Prim.ellipsoid(add(lerp3(a, b, 0.6), scale(back, r[1] * 0.78)), [0.0066, 0.0022, 0.0085], B(bn), "nail", d, back);
        thumbF.add(nail, 0.0015);
        nailPrims.push(nail);
      }
    });
    hand.limb(thumbF, 0.013);
    hands.push(hand);
  });

  // ================================================================ feet
  const feet: Field[] = [];
  SIDES.forEach((side, si) => {
    const s = si === 0 ? -1 : 1;
    const { along, out, ankle, ball } = marks.feet[si];
    const foot = new Field();
    const FB = B(`${side}Foot`);
    const TB = B(`${side}Toes`);
    const up: V3 = [0, 1, 0];
    foot.add(Prim.cone(add(ankle, [0, 0.07, 0.004]), ankle, 0.031 * g, 0.03 * g, B(`${side}LowerLeg`), "ankle"));
    // heel, sole and the arch's top
    const heel = add(ankle, [0, -0.043, -0.03]);
    foot.add(Prim.sphere(heel, 0.026, FB, "heel"), 0.02);
    const mid = lerp3(heel, ball, 0.55);
    foot.add(Prim.ellipsoid(add(mid, [0, -0.004, 0]), [0.037, 0.021, 0.083 * lk], FB, "sole", along, up), 0.022);
    foot.add(Prim.ellipsoid(add(lerp3(ankle, ball, 0.5), [0, 0.008, 0]), [0.03, 0.024, 0.06 * lk], FB, "instep", along, up), 0.02);
    foot.fork();
    // four toes from the ball, a little curled
    for (let t = 0; t < 4; t++) {
      const across = (t - 1.2) * 0.0205;
      const start = add(add(ball, scale(out, across)), scale(along, -0.006));
      const lenT = [0.05, 0.047, 0.043, 0.036][t] * lk;
      const dir = norm(add(add(along, scale(out, (t - 1.2) * 0.07)), [0, -0.12, 0]));
      const k1 = add(start, scale(dir, lenT * 0.55));
      const tip = add(k1, scale(norm(add(dir, [0, -0.35, 0])), lenT * 0.45));
      const toe = new Field();
      toe.add(Prim.cone(start, k1, 0.0108, 0.0096, TB, "toe"));
      toe.add(Prim.cone(k1, tip, 0.0096, 0.0082, TB, "toe"), 0.003);
      const nail = Prim.ellipsoid(add(lerp3(k1, tip, 0.6), [0, 0.0072, 0]), [0.0058, 0.002, 0.0075], TB, "nail", norm(sub(tip, k1)), up);
      toe.add(nail, 0.0015);
      nailPrims.push(nail);
      foot.limb(toe, 0.009);
    }
    // the big toe: on the inside of the foot, turned in and apart, as a thumb is
    const bigStart = add(add(lerp3(heel, ball, 0.66), scale(out, -0.034)), [0, -0.002, 0]);
    const bigDir = norm(add(add(along, scale(out, -0.75)), [0, -0.05, 0]));
    const bigMid = add(bigStart, scale(bigDir, 0.034 * lk));
    const bigTip = add(bigMid, scale(norm(add(bigDir, [0, -0.25, 0])), 0.026 * lk));
    const big = new Field();
    big.add(Prim.cone(bigStart, bigMid, 0.0145, 0.0128, TB, "bigToe"));
    big.add(Prim.cone(bigMid, bigTip, 0.0128, 0.0104, TB, "bigToe"), 0.004);
    const bigNail = Prim.ellipsoid(add(lerp3(bigMid, bigTip, 0.55), [0, 0.0095, 0]), [0.0072, 0.002, 0.0085], TB, "nail", norm(sub(bigTip, bigMid)), up);
    big.add(bigNail, 0.0015);
    nailPrims.push(bigNail);
    foot.limb(big, 0.012);
    void s;
    feet.push(foot);
  });

  // ================================================================ parts
  const box = (f: Field, pad: number): [V3, V3] => {
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of f.prims()) {
      for (let i = 0; i < 3; i++) {
        const c = [p.bx, p.by, p.bz][i];
        lo[i] = Math.min(lo[i], c - p.br - pad);
        hi[i] = Math.max(hi[i], c + p.br + pad);
      }
    }
    return [lo, hi];
  };
  const part = (name: PartName, field: Field, h: number, skin: Part["skin"], fur: Part["fur"]): Part => {
    const [min, max] = box(field, 3 * h);
    return { name, field, min, max, h, skin, fur };
  };
  const parts: Part[] = [
    part("body", body, 0.0105, { tris: 14000, edge: 0.045 }, { tris: 6500, edge: 0.06 }),
    part("head", head, 0.0033, { tris: 16000, edge: 0.014 }, { tris: 9000, edge: 0.012 }),
    part("handL", hands[0], 0.003, { tris: 5200, edge: 0.012 }, { tris: 2600, edge: 0.009 }),
    part("handR", hands[1], 0.003, { tris: 5200, edge: 0.012 }, { tris: 2600, edge: 0.009 }),
    part("footL", feet[0], 0.0042, { tris: 3600, edge: 0.014 }, { tris: 1200, edge: 0.022 }),
    part("footR", feet[1], 0.0042, { tris: 3600, edge: 0.014 }, { tris: 1200, edge: 0.022 }),
  ];

  // ================================================================ what the skin is
  const eyes = [marks.eyeL, marks.eyeR];
  // the bare face every ChimpVerse chimp has: a lobe round each eye, the nose between,
  // the muzzle below; its edge is where the fur starts
  const faceShapes = [
    Prim.ellipsoid(HP(-0.031, 0.009, 0.078), [0.031 * hk, 0.03 * hk, 0.04 * hk], 0),
    Prim.ellipsoid(HP(0.031, 0.009, 0.078), [0.031 * hk, 0.03 * hk, 0.04 * hk], 0),
    Prim.ellipsoid(HP(0, -0.002, 0.1), [0.024 * hk, 0.035 * hk, 0.04 * hk], 0),
    Prim.ellipsoid(HP(0, -0.066, 0.106 + 0.022 * (mk - 1)), [0.06 * hk, 0.064 * hk, 0.074 * hk * mk], 0),
  ];
  const faceD = (x: number, y: number, z: number) => {
    let d = smin(faceShapes[0].d(x, y, z), faceShapes[1].d(x, y, z), 0.014);
    d = smin(d, faceShapes[2].d(x, y, z), 0.016);
    d = smin(d, faceShapes[3].d(x, y, z), 0.02);
    // nothing bare below the chin
    return Math.max(d, -(z - (C[2] + 0.045 * hk)) * 0.5);
  };
  const beardC = HP(0, -0.115, 0.07 + 0.02 * (mk - 1));
  const faceCentre = HP(0, -0.02, 0.17);
  const mouthY = marks.mouth[1];

  const paint = (name: PartName, p: V3, n: V3, out: Paint) => {
    const [x, y, z] = p;
    out.fur = 1;
    out.furLen = 1;
    out.palm = 0;
    out.dark = 0;
    out.grey = 0;
    out.nail = 0;
    out.mouth = 0;
    let flow: V3 = [0, -1, 0];
    if (name === "head") {
      const fd = faceD(x, y, z);
      out.fur = smoothstep(0.0008, 0.0035, fd);
      // the fur lies away from the face: back over the crown, out over the cheeks, down off the chin
      flow = add(norm(sub(p, faceCentre)), [0, -0.45, 0]);
      // long side-whiskers framing the face below the eyes; short fur on the brow
      const side = Math.abs(x - C[0]) / (0.07 * hk);
      const below = smoothstep(C[1] + 0.02 * hk, C[1] - 0.03 * hk, y);
      const whiskers = smoothstep(0.55, 0.95, side) * below * smoothstep(C[2] - 0.05 * hk, C[2] + 0.03 * hk, z);
      const brow = smoothstep(C[1], C[1] + 0.03 * hk, y) * smoothstep(C[2] + 0.02 * hk, C[2] + 0.07 * hk, z);
      out.furLen = lerp(lerp(1, 1.85, whiskers), 0.5, brow) * lerp(0.65, 1, smoothstep(0, 0.02, fd));
      // the grey beard, under the lower lip and round the chin
      const bd = len(sub(p, beardC)) / (0.05 * hk);
      out.grey = (1 - smoothstep(0.55, 1.05, bd)) * smoothstep(mouthY - 0.004, mouthY - 0.018, y);
      if (out.grey > 0) out.furLen = Math.max(out.furLen, lerp(out.furLen, 1.35, out.grey));
      // the ears are bare skin, darker in their cups
      let earD = Infinity;
      let cupD = Infinity;
      for (let i = 0; i < earPrims.length; i += 2) {
        earD = Math.min(earD, Math.abs(earPrims[i].d(x, y, z)));
        cupD = Math.min(cupD, Math.abs(earPrims[i + 1].d(x, y, z)));
      }
      const onEar = 1 - smoothstep(0.0025, 0.009, Math.min(earD, cupD));
      out.fur *= 1 - onEar;
      out.dark = Math.max(out.dark, (0.3 + 0.4 * (1 - smoothstep(0.0, 0.004, cupD))) * onEar);
      // darker skin round the eyes and down the nose's sides
      for (const e of eyes) {
        const de = len(sub(p, e));
        out.dark = Math.max(out.dark, 1 - smoothstep(eyeR + 0.0012, eyeR + 0.017, de));
      }
      // nostrils
      for (const s of [-1, 1]) {
        const dn = len(sub(p, add(noseTip, [s * 0.0085 * hk, 0, 0])));
        out.dark = Math.max(out.dark, 1 - smoothstep(0.003, 0.0065, dn));
      }
      // lips, and inside the mouth
      const ds = slit.d(x, y, z);
      const lip = (1 - smoothstep(0.001, 0.009, ds)) * (1 - smoothstep(0.02, 0.04, Math.abs(x - C[0]) / Math.sqrt(mk)));
      const depth = dot(sub(marks.mouth, p), mouthFwd);
      out.mouth = Math.max(lip * 0.4, (1 - smoothstep(0.0004, 0.0018, ds)) * smoothstep(0.0, 0.006, depth));
    } else if (name === "body") {
      flow = bodyFlow(p, n);
      out.furLen = bodyFurLength(p, n);
    } else if (name === "handL" || name === "handR") {
      const si = name === "handL" ? 0 : 1;
      const { along, palm, wrist } = marks.hands[si];
      const t = dot(sub(p, wrist), along);
      const back = smoothstep(0.05, 0.45, -dot(n, palm));
      out.fur = 1 - smoothstep(-0.006, 0.012 + 0.012 * back, t);
      out.furLen = lerp(0.45, 1.05, 1 - smoothstep(-0.03, 0.03, t));
      out.palm = 1;
      // as on the forearm, the hair at the wrist points back up the arm
      flow = scale(along, -1);
      out.nail = nailAt(p);
      // the knuckles' backs a little darker
      out.dark = 0.25 * back * smoothstep(0.05, 0.09, t);
    } else {
      const si = name === "footL" ? 0 : 1;
      const { along, ankle } = marks.feet[si];
      const top = smoothstep(-0.2, 0.4, n[1]);
      out.fur = smoothstep(ankle[1] - 0.012, ankle[1] + 0.022, y) * lerp(0.4, 1, top) + top * (1 - smoothstep(0.0, 0.06, dot(sub(p, ankle), along))) * smoothstep(0.02, 0.045, y) * 0.9;
      out.fur = clamp01(out.fur);
      out.furLen = lerp(0.5, 1, smoothstep(ankle[1] - 0.01, ankle[1] + 0.04, y));
      out.palm = 1;
      flow = add(along, [0, -1.2, 0]);
      out.nail = nailAt(p);
    }
    // the flow lies along the skin
    const fn = dot(flow, n);
    let f = sub(flow, scale(n, fn));
    if (len(f) < 1e-4) f = cross(n, [1, 0, 0]);
    out.flow = norm(f);
  };

  function nailAt(p: V3): number {
    let best = Infinity;
    for (const q of nailPrims) {
      if (Math.hypot(p[0] - q.bx, p[1] - q.by, p[2] - q.bz) > q.br + 0.004) continue;
      best = Math.min(best, q.d(p[0], p[1], p[2]));
    }
    return 1 - smoothstep(0.0003, 0.0016, best);
  }

  /** Which body shape a point is nearest: the arm's and leg's fur lies along them. */
  const bodyPrims = body.prims();
  function nearestBody(p: V3): Prim {
    let best = bodyPrims[0];
    let bd = Infinity;
    for (const q of bodyPrims) {
      const d = q.d(p[0], p[1], p[2]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  function bodyFlow(p: V3, n: V3): V3 {
    const q = nearestBody(p);
    const b = bones[q.bone];
    const dir = norm(sub(b.tail, b.head));
    if (q.tag === "upperArm" || q.tag === "biceps" || q.tag === "deltoid") return add(dir, [0, -0.3, 0]);
    // forearm hair points back up to the elbow, as a chimp's (and a person's) does
    if (q.tag === "forearm" || q.tag === "forearmMuscle" || q.tag === "wristStub") return add(scale(dir, -1), [0, -0.25, 0]);
    if (q.tag === "thigh" || q.tag === "quads" || q.tag === "shin" || q.tag === "calf") return add(dir, [0, -0.2, 0]);
    // the torso's fur falls down and a little out from the spine
    return add([0, -1, 0], scale([n[0], 0, n[2]], 0.25));
  }

  function bodyFurLength(p: V3, n: V3): number {
    const q = nearestBody(p);
    switch (q.tag) {
      case "belly":
        return lerp(1, 0.6, smoothstep(0.1, 0.6, n[2]));
      case "ribs":
        return lerp(1, 0.75, smoothstep(0.2, 0.7, n[2]));
      case "shoulders":
      case "hump":
      case "deltoid":
      case "upperArm":
      case "biceps":
        // long, shaggy fur over the shoulders and upper arms: the chimp's silhouette
        return 1.35;
      case "forearm":
      case "forearmMuscle":
        return 1.15;
      case "neck":
        return 1.15;
      case "shin":
      case "calf":
        return 0.9;
      default:
        return 1;
    }
  }

  // ================================================================ which bones move the skin
  const headBone = bones[HEAD];
  const neckY = headBone.head[1];
  const jawPivot = J("jaw");
  const segs = bones.map((b) => [b.head, b.tail] as [V3, V3]);
  const prims: Prim[] = [];
  const allowed = new Set<number>();

  const weigh = (pt: Part, p: V3, list: ArrayLike<number>, outB: Int32Array, outW: Float32Array) => {
    const [x, y, z] = p;
    outB.fill(0);
    outW.fill(0);
    if (pt.name === "head") {
      // head and neck by height; the jaw below the mouth's line and in front of its hinge; the ears
      const neckW = 1 - smoothstep(neckY - 0.03, neckY + 0.025, y + 0.25 * (z - jawPivot[2]));
      const curve = mouthY + 3.2 * (x - C[0]) * (x - C[0]);
      let jaw = smoothstep(curve + 0.001, curve - 0.003, y) * smoothstep(jawPivot[2] - 0.005, jawPivot[2] + 0.035, z) * (1 - neckW);
      // the throat goes with the jaw a little, so it stretches rather than tears
      jaw = Math.max(jaw, 0.5 * smoothstep(mouthY - 0.03, mouthY - 0.06, y) * smoothstep(jawPivot[2] - 0.04, jawPivot[2] + 0.02, z) * (1 - neckW));
      let earW = 0;
      let earBone = HEAD;
      for (let i = 0; i < earPrims.length; i += 2) {
        const d = earPrims[i].d(x, y, z);
        const w = 1 - smoothstep(-0.004, 0.007, d - 0.002);
        if (w > earW) {
          earW = w;
          earBone = earPrims[i].bone;
        }
      }
      const list4: [number, number][] = [
        [B("neck"), neckW],
        [JAW, jaw * (1 - earW)],
        [earBone, earW * (1 - neckW)],
        [HEAD, Math.max(0, 1 - neckW - jaw * (1 - earW) - earW * (1 - neckW))],
      ];
      writeTop(list4, outB, outW);
      return;
    }
    // elsewhere: the nearest shape owns the point; it, and any shape blending with it there,
    // name the bones allowed; each allowed bone counts by how near the point is to it
    pt.field.primsOf(list, prims);
    let owner: Prim | null = null;
    let dmin = Infinity;
    for (const q of prims) {
      const d = q.d(x, y, z);
      if (d < dmin) {
        dmin = d;
        owner = q;
      }
    }
    if (!owner) {
      outB[0] = HEAD;
      outW[0] = 1;
      return;
    }
    allowed.clear();
    allowed.add(owner.bone);
    if (bones[owner.bone].parent >= 0) allowed.add(bones[owner.bone].parent);
    for (const c of kids[owner.bone]) allowed.add(c);
    for (const q of prims) if (q.d(x, y, z) < dmin + 0.012) allowed.add(q.bone);
    const ws: [number, number][] = [];
    for (const b of allowed) {
      const { d } = segment(x, y, z, segs[b][0], segs[b][1]);
      ws.push([b, 1 / (Math.pow(Math.max(d, 0.004), 4) + 1e-14)]);
    }
    writeTop(ws, outB, outW);
  };

  return { rig, parts, paint, weigh };
}

/** The four strongest bones, their weights summing to one (weights under 2% dropped). */
function writeTop(ws: [number, number][], outB: Int32Array, outW: Float32Array) {
  ws.sort((a, b) => b[1] - a[1]);
  let total = 0;
  for (let i = 0; i < Math.min(4, ws.length); i++) total += ws[i][1];
  let kept = 0;
  for (let i = 0; i < Math.min(4, ws.length); i++) {
    const w = ws[i][1] / (total || 1);
    if (w < 0.02 && i > 0) continue;
    outB[kept] = ws[i][0];
    outW[kept] = w;
    kept++;
  }
  let s = 0;
  for (let i = 0; i < kept; i++) s += outW[i];
  for (let i = 0; i < kept; i++) outW[i] /= s || 1;
}
