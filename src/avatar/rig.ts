// The chimp's skeleton, laid out from its DNA. Bone names follow the VRM humanoid
// standard (hips, spine, leftUpperArm, leftIndexProximal…), which avatar tools and
// Blender add-ons understand, so a chimp modelled in Blender later can stand in for
// this one with its rig unchanged; the few chimp-only bones (ears) are extras, as
// VRM allows. Every bone rests unrotated (its axes are the character's), so the
// animation turns bones about the character's own axes.
//
// The character faces +Z with +Y up, and its left is -X, as a VRM model looks in
// Babylon's left-handed world. Positions are in metres before the height scale: the
// whole chimp is scaled so the top of its head reaches the DNA's height.

import type { ShapeKey } from "./dna";
import { type V3, add, cross, len, lerp3, norm, scale, sub } from "./sdf";

export interface BoneDef {
  name: string;
  parent: number;
  /** where the joint is */
  head: V3;
  /** where the bone ends: its main child's joint, or its tip */
  tail: V3;
  /** for a hinge (elbow, knee, finger joint): the axis it bends about, at rest, in character space */
  hinge?: V3;
}

/** Points the anatomy and the clothes are built round, at rest. */
export interface Landmarks {
  /** the middle of the skull */
  cranium: V3;
  /** cranium radii (half width, half height, half depth) */
  craniumR: V3;
  eyeL: V3;
  eyeR: V3;
  eyeRadius: number;
  earL: V3;
  earR: V3;
  /** the middle of the mouth's line */
  mouth: V3;
  muzzle: V3;
  chin: V3;
  /** the hand's frame at rest: its fingers' way, the palm's outward normal, the thumb's side */
  hands: { along: V3; palm: V3; thumb: V3; wrist: V3 }[];
  /** the foot's frame at rest: its toes' way, and its outer side */
  feet: { along: V3; out: V3; ankle: V3; ball: V3 }[];
  /** the top of the head with its fur: the chimp's height before scaling */
  top: number;
  /** the shoulders' half width, and the chest's half depth (for clothes) */
  shoulderX: number;
  chestZ: number;
  /** girth factor from the build (1 = average) */
  girth: number;
}

export interface Rig {
  bones: BoneDef[];
  marks: Landmarks;
  index: Record<string, number>;
}

/** 0 is the character's left (-X), 1 its right (+X). */
export const SIDES = ["left", "right"] as const;
export const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function buildRig(shape: Record<ShapeKey, number>): Rig {
  const bones: BoneDef[] = [];
  const index: Record<string, number> = {};
  const bone = (name: string, parent: string | null, head: V3, tail: V3, hinge?: V3) => {
    index[name] = bones.length;
    bones.push({ name, parent: parent === null ? -1 : index[parent], head, tail, hinge: hinge && norm(hinge) });
    return bones.length - 1;
  };

  const girth = lerp(0.86, 1.16, shape.build);
  const armK = lerp(0.9, 1.1, shape.arms);
  const legK = lerp(0.88, 1.12, shape.legs);
  // the head a little big for the body, as a friendly character's is
  const headK = lerp(0.96, 1.2, shape.head);

  // ---------------------------------------------------------------- legs and torso
  const thigh = 0.27 * legK;
  const shin = 0.255 * legK;
  const ankleY = 0.072;
  const hipX = 0.092 * Math.sqrt(girth);
  const hipY = ankleY + thigh + shin - 0.012;
  const hips: V3 = [0, hipY + 0.03, -0.005];
  bone("hips", null, hips, add(hips, [0, 0.1, 0]));
  const spine = add(hips, [0, 0.1, -0.008]);
  const chest = add(hips, [0, 0.245, -0.004]);
  const upperChest = add(hips, [0, 0.365, 0.002]);
  const neck = add(hips, [0, 0.49, 0.04]);
  const headJ = add(neck, [0, 0.07, 0.026]);
  bone("spine", "hips", spine, chest);
  bone("chest", "spine", chest, upperChest);
  bone("upperChest", "chest", upperChest, neck);
  bone("neck", "upperChest", neck, headJ);

  // ---------------------------------------------------------------- head and face
  const cranium: V3 = add(headJ, [0, 0.098 * headK, 0.03 * headK]);
  // a chimp's skull is long and low
  const craniumR: V3 = [0.088 * headK, 0.079 * headK, 0.096 * headK];
  const eyeRadius = 0.0128 * headK * lerp(0.88, 1.16, shape.eyes);
  // set deep under the brow
  const eyeL: V3 = add(cranium, [-0.0335 * headK, 0.011 * headK, 0.0835 * headK]);
  const eyeR: V3 = [-eyeL[0], eyeL[1], eyeL[2]];
  const muzzleK = lerp(0.85, 1.18, shape.muzzle);
  const muzzle: V3 = add(cranium, [0, -0.046 * headK, (0.094 + 0.02 * (muzzleK - 1)) * headK]);
  const mouth: V3 = add(cranium, [0, -0.071 * headK, (0.147 + 0.035 * (muzzleK - 1)) * headK]);
  const chin: V3 = add(cranium, [0, -0.1 * headK, (0.108 + 0.025 * (muzzleK - 1)) * headK]);
  const earK = lerp(0.82, 1.22, shape.ears);
  const earL: V3 = add(cranium, [-0.09 * headK, 0.008 * headK, -0.004 * headK]);
  const earR: V3 = [-earL[0], earL[1], earL[2]];
  bone("head", "neck", headJ, add(cranium, [0, craniumR[1], 0]));
  const jawPivot = add(cranium, [0, -0.032 * headK, 0.018 * headK]);
  bone("jaw", "head", jawPivot, chin, [1, 0, 0]);
  bone("leftEye", "head", eyeL, add(eyeL, [0, 0, 0.02]));
  bone("rightEye", "head", eyeR, add(eyeR, [0, 0, 0.02]));
  bone("leftEar", "head", earL, add(earL, [-0.03 * earK, 0.02 * earK, 0]));
  bone("rightEar", "head", earR, add(earR, [0.03 * earK, 0.02 * earK, 0]));

  // ---------------------------------------------------------------- arms and hands
  const upperArm = 0.32 * armK;
  const foreArm = 0.29 * armK;
  const palmLen = 0.088 * armK;
  const shoulderX = 0.186 * Math.pow(girth, 0.6);
  const hands: Landmarks["hands"] = [];
  const feet: Landmarks["feet"] = [];
  SIDES.forEach((side, si) => {
    const s = si === 0 ? -1 : 1;
    const P = side;
    const clav: V3 = add(upperChest, [s * 0.03, 0.07, 0.034]);
    const shoulder: V3 = add(upperChest, [s * shoulderX, 0.088, 0.004]);
    // A-pose: the upper arm 38° out from hanging, a little forward; the elbow bent a touch
    const dUpper = norm([s * Math.sin(0.66), -Math.cos(0.66), 0.08]);
    const elbow = add(shoulder, scale(dUpper, upperArm));
    const dFore = norm([s * Math.sin(0.6), -Math.cos(0.6), 0.2]);
    const wrist = add(elbow, scale(dFore, foreArm));
    // the hand: along the forearm, palm turned down and in toward the body, thumb forward
    const along = norm([s * Math.sin(0.56), -Math.cos(0.56), 0.16]);
    // the palm's normal (the side that holds things): in toward the body and down
    const palmOut = norm(cross(along, [0, 0, s]));
    // the thumb's side of the hand: forward, on both hands
    const thumbSide = scale(norm(cross(palmOut, along)), s);
    // elbows bend about the axis square to the arm and the body's forward
    const elbowHinge = norm(cross(dUpper, [0, 0, 1]));
    bone(`${P}Shoulder`, "upperChest", clav, shoulder);
    bone(`${P}UpperArm`, `${P}Shoulder`, shoulder, elbow);
    bone(`${P}LowerArm`, `${P}UpperArm`, elbow, wrist, elbowHinge);
    const knuckles = add(wrist, scale(along, palmLen));
    bone(`${P}Hand`, `${P}LowerArm`, wrist, knuckles);
    hands.push({ along, palm: palmOut, thumb: thumbSide, wrist });

    // fingers: index nearest the thumb; each bends toward the palm (a positive turn about its hinge)
    const fingerHinge = norm(cross(along, palmOut));
    const lengths = [
      [0.046, 0.033, 0.023],
      [0.05, 0.036, 0.024],
      [0.047, 0.034, 0.023],
      [0.039, 0.027, 0.02],
    ];
    const across = [1.5, 0.5, -0.5, -1.5];
    for (let f = 0; f < 4; f++) {
      const name = FINGERS[f + 1];
      // a slight fan and a relaxed curl toward the palm
      const spread = across[f] * 0.07;
      let dir = norm(add(add(along, scale(thumbSide, spread)), scale(palmOut, 0.12)));
      let at: V3 = add(add(knuckles, scale(thumbSide, across[f] * 0.0215 * armK)), scale(along, -0.006 * Math.abs(across[f])));
      const segs = ["Proximal", "Intermediate", "Distal"];
      let parent = `${P}Hand`;
      for (let k = 0; k < 3; k++) {
        const l = lengths[f][k] * armK;
        const next = add(at, scale(dir, l));
        bone(`${P}${name}${segs[k]}`, parent, at, next, fingerHinge);
        parent = `${P}${name}${segs[k]}`;
        at = next;
        dir = norm(add(dir, scale(palmOut, 0.2)));
      }
    }
    // the thumb: from the heel of the palm on the thumb's side, out and toward the fingers
    let tdir = norm(add(add(scale(along, 0.7), scale(thumbSide, 0.6)), scale(palmOut, 0.3)));
    let tat: V3 = add(add(wrist, scale(along, 0.022 * armK)), scale(thumbSide, 0.024 * armK));
    const tl = [0.03, 0.026, 0.021];
    const tsegs = ["Metacarpal", "Proximal", "Distal"];
    let tparent = `${P}Hand`;
    for (let k = 0; k < 3; k++) {
      const next = add(tat, scale(tdir, tl[k] * armK));
      bone(`${P}Thumb${tsegs[k]}`, tparent, tat, next, norm(cross(tdir, palmOut)));
      tparent = `${P}Thumb${tsegs[k]}`;
      tat = next;
      tdir = norm(add(tdir, scale(add(along, scale(palmOut, 0.5)), 0.25)));
    }

    // the leg: a slight splay, knees a touch bent and forward
    const hip: V3 = [s * hipX, hipY, 0];
    const ankle: V3 = [s * (hipX + 0.035), ankleY, -0.012];
    const knee: V3 = add(lerp3(hip, ankle, thigh / (thigh + shin)), [s * 0.006, 0, 0.022]);
    const kneeHinge: V3 = [1, 0, 0];
    bone(`${P}UpperLeg`, "hips", hip, knee);
    bone(`${P}LowerLeg`, `${P}UpperLeg`, knee, ankle, kneeHinge);
    // the foot: toes out a little; the ball where the toes start
    const footAlong = norm([s * 0.16, 0, 1]);
    const footOut: V3 = norm(cross([0, 1, 0], footAlong));
    const footLen = 0.205 * legK;
    const ball = add(add(ankle, scale(footAlong, footLen * 0.62)), [0, -ankleY + 0.022, 0]);
    const toeTip = add(ball, scale(footAlong, footLen * 0.36));
    bone(`${P}Foot`, `${P}LowerLeg`, ankle, ball, [1, 0, 0]);
    bone(`${P}Toes`, `${P}Foot`, ball, toeTip, scale(footOut, s < 0 ? -1 : 1));
    feet.push({ along: footAlong, out: s < 0 ? scale(footOut, -1) : footOut, ankle, ball });
  });

  const top = cranium[1] + craniumR[1] + 0.012;
  return {
    bones,
    index,
    marks: { cranium, craniumR, eyeL, eyeR, eyeRadius, earL, earR, mouth, muzzle, chin, hands, feet, top, shoulderX, chestZ: 0.13 * girth, girth },
  };
}

/** Each bone's children, by index. */
export function children(rig: Rig): number[][] {
  const out: number[][] = rig.bones.map(() => []);
  rig.bones.forEach((b, i) => b.parent >= 0 && out[b.parent].push(i));
  return out;
}

/** A bone's length at rest. */
export function boneLength(b: BoneDef): number {
  return len(sub(b.tail, b.head));
}
