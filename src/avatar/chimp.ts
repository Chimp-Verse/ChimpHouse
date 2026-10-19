// A chimp in the scene: its skeleton, its skinned skin and fur, its eyes, built
// from a model (avatar/model.ts) and dressed in its DNA's colours.
//
// The skeleton is a tree of scene nodes named after the VRM bones (hips, spine,
// leftUpperArm…), each driving the Babylon bone of the same name; animation turns
// the nodes, and anything a chimp wears or holds is parented to one. A Blender
// chimp loaded from glTF arrives with the same tree, so the animation and the
// wardrobe work on it unchanged.

import {
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  Skeleton,
  Bone,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractMesh,
} from "@babylonjs/core";
import type { ChimpDna, Slot } from "./dna";
import type { ItemMesh, ItemModel } from "./items";
import { type ChimpClothPlugin, type ChimpFurPlugin, type ChimpSkinPlugin, FABRICS, clothMaterial, dialTexture, furMaterial, linear, printTexture, skinMaterial } from "./materials";
import type { ChimpModel } from "./model";
import type { Rig } from "./rig";
import type { PartName } from "./anatomy";

/** An item being worn: its meshes, its materials, and the fur it hides. */
interface Worn {
  id: string;
  /** which of the item's colours is its print's main ink (none: one that stands out from the cloth) */
  printInk?: number;
  meshes: Mesh[];
  /** each mesh's material, and what to colour it: the item's colour n, or a colour of its own */
  dressed: { mesh: Mesh; material: PBRMaterial; cloth: ChimpClothPlugin | null; colour: number; hex?: string; kind: string; sheenTint: number }[];
  cover: ItemModel["cover"];
}

/** Shells drawn for the fur at each quality: more look fluffier, and cost more. */
export const SHELLS = { high: 14, medium: 9, low: 5 } as const;

export class Chimp {
  readonly root: TransformNode;
  /** the skeleton's nodes by bone name: turn these to pose the chimp */
  readonly nodes: Record<string, TransformNode> = {};
  /** each node's place at rest, relative to its parent */
  readonly rest: Record<string, Vector3> = {};
  readonly skeleton: Skeleton;
  readonly meshes: AbstractMesh[] = [];
  readonly furMeshes: Mesh[] = [];
  readonly eyes: Mesh[] = [];
  readonly rig: Rig;
  /** the chimp's height before scaling (the top of its head, with fur) */
  readonly baseHeight: number;
  private skin: { material: PBRMaterial; skin: ChimpSkinPlugin };
  private fur: { material: PBRMaterial; fur: ChimpFurPlugin };
  private eyeMat: PBRMaterial;
  private eyeTex: DynamicTexture;
  private shells = 0;
  /** what the chimp wears, by slot */
  private worn = new Map<Slot, Worn>();
  /** each part's fur mesh, and its carrier's vertex count (for the cover of clothes) */
  private furByPart = new Map<PartName, Mesh>();
  /** counts changes to the chimp's meshes (clothes on and off), for whoever lights them */
  version = 0;
  /** each eye's lids, turned about the eye's middle */
  private lids: { upper: Mesh; lower: Mesh }[] = [];

  constructor(
    readonly scene: Scene,
    model: ChimpModel,
    dna: ChimpDna,
    name = "chimp",
  ) {
    this.rig = model.rig;
    this.baseHeight = model.rig.marks.top;
    this.root = new TransformNode(name, scene);
    const armature = new TransformNode(`${name} armature`, scene);
    armature.parent = this.root;

    // ---------------------------------------------------------------- skeleton
    this.skeleton = new Skeleton(`${name} skeleton`, `${name}-skeleton`, scene);
    const bones: Bone[] = [];
    model.rig.bones.forEach((b, i) => {
      const parentHead = b.parent >= 0 ? model.rig.bones[b.parent].head : [0, 0, 0];
      const local = new Vector3(b.head[0] - parentHead[0], b.head[1] - parentHead[1], b.head[2] - parentHead[2]);
      const node = new TransformNode(b.name, scene);
      node.parent = b.parent >= 0 ? this.nodes[model.rig.bones[b.parent].name] : armature;
      node.position.copyFrom(local);
      node.rotationQuaternion = Quaternion.Identity();
      this.nodes[b.name] = node;
      this.rest[b.name] = local.clone();
      const m = Matrix.Translation(local.x, local.y, local.z);
      const bone = new Bone(b.name, this.skeleton, b.parent >= 0 ? bones[b.parent] : null, m, m, m, i);
      bone.linkTransformNode(node);
      bones.push(bone);
    });

    // ---------------------------------------------------------------- skin and fur
    this.skin = skinMaterial(`${name} skin`, scene);
    this.fur = furMaterial(`${name} fur`, scene);
    for (const part of model.parts) {
      const s = part.skin;
      const mesh = new Mesh(`${name} ${part.name}`, scene);
      const vd = new VertexData();
      vd.positions = s.positions;
      vd.normals = s.normals;
      vd.indices = s.indices;
      vd.matricesIndices = s.bones;
      vd.matricesWeights = s.weights;
      vd.applyToMesh(mesh, false);
      mesh.setVerticesData("chimpPaintA", s.paintA, false, 4);
      mesh.setVerticesData("chimpPaintB", s.paintB, false, 4);
      this.prepare(mesh);
      mesh.material = this.skin.material;
      this.meshes.push(mesh);

      if (!part.fur) continue;
      const f = part.fur;
      const fm = new Mesh(`${name} ${part.name} fur`, scene);
      const fv = new VertexData();
      fv.positions = f.positions;
      fv.normals = f.normals;
      fv.indices = f.indices;
      fv.matricesIndices = f.bones;
      fv.matricesWeights = f.weights;
      fv.applyToMesh(fm, false);
      fm.setVerticesData("chimpFur", f.furA, false, 4);
      fm.setVerticesData("chimpFlow", f.flow, false, 4);
      // nothing worn yet: no fur hidden
      fm.setVerticesData("chimpCover", new Float32Array(f.positions.length / 3), true, 1);
      this.furByPart.set(part.name, fm);
      this.prepare(fm);
      fm.material = this.fur.material;
      this.furMeshes.push(fm);
      this.meshes.push(fm);
    }
    this.setShells(SHELLS.high);

    // ---------------------------------------------------------------- eyes
    this.eyeTex = new DynamicTexture(`${name} eyes`, { width: 256, height: 256 }, scene, true);
    this.eyeTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.eyeTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.eyeMat = new PBRMaterial(`${name} eye`, scene);
    this.eyeMat.albedoTexture = this.eyeTex;
    this.eyeMat.roughness = 0.3;
    this.eyeMat.metallic = 0;
    // the wet cornea's sharp highlight
    this.eyeMat.clearCoat.isEnabled = true;
    this.eyeMat.clearCoat.intensity = 1;
    this.eyeMat.clearCoat.roughness = 0.04;
    this.eyeMat.emissiveTexture = this.eyeTex;
    this.eyeMat.emissiveColor = new Color3(0.06, 0.06, 0.06);
    this.eyeMat.maxSimultaneousLights = 8;
    const r = model.rig.marks.eyeRadius;
    for (const side of ["leftEye", "rightEye"]) {
      const eye = MeshBuilder.CreateSphere(`${name} ${side}`, { diameter: 2 * r, segments: 20 }, scene);
      // the iris drawn straight on from the front: a planar projection along the eye's gaze (+Z)
      const p = eye.getVerticesData(VertexBuffer.PositionKind)!;
      const uv = new Float32Array((p.length / 3) * 2);
      for (let i = 0; i < p.length / 3; i++) {
        uv[i * 2] = 0.5 - p[i * 3] / (2 * r);
        uv[i * 2 + 1] = 0.5 + p[i * 3 + 1] / (2 * r);
      }
      eye.setVerticesData(VertexBuffer.UVKind, uv);
      eye.parent = this.nodes[side];
      eye.material = this.eyeMat;
      this.prepare(eye, false);
      this.eyes.push(eye);
      this.meshes.push(eye);
      // the lids hang from the head, not the eye: the eye turns under them
      const pivot = new TransformNode(`${name} ${side} lids`, scene);
      pivot.parent = this.nodes.head;
      const headAt = model.rig.bones[model.rig.index.head].head;
      const at = model.rig.bones[model.rig.index[side]].head;
      pivot.position.set(at[0] - headAt[0], at[1] - headAt[1], at[2] - headAt[2]);
      const upper = lidMesh(`${name} ${side} upper lid`, scene, r, true);
      const lower = lidMesh(`${name} ${side} lower lid`, scene, r, false);
      for (const lid of [upper, lower]) {
        lid.parent = pivot;
        lid.rotationQuaternion = Quaternion.Identity();
        lid.material = this.skin.material;
        this.prepare(lid, false);
        this.meshes.push(lid);
      }
      this.lids.push({ upper, lower });
    }
    this.setLids(1);
    this.setColours(dna);
  }

  /** Settings every mesh of the chimp shares. */
  private prepare(mesh: Mesh, skinned = true) {
    if (skinned) {
      mesh.skeleton = this.skeleton;
      mesh.numBoneInfluencers = 4;
      mesh.parent = this.root;
    }
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
    // skinned on the GPU: its box at rest doesn't follow the pose, so it is never culled by it
    mesh.alwaysSelectAsActiveMesh = true;
  }

  /**
   * The lids: 1 open (relaxed, the upper lid over the iris's top), 0 shut;
   * `gaze` (radians, up positive) lifts or lowers the upper lids with the eyes.
   */
  setLids(open: number, gaze = 0): void {
    const o = Math.max(0, Math.min(1, open));
    // where each lid's edge sits, as an angle above (+) or below the eye's middle
    const upper = -0.16 + (0.5 + 0.55 * gaze) * o;
    const lower = -0.2 - (0.36 - 0.25 * Math.min(0, gaze)) * o;
    for (const l of this.lids) {
      Quaternion.RotationAxisToRef(Vector3.RightReadOnly, -upper, l.upper.rotationQuaternion!);
      Quaternion.RotationAxisToRef(Vector3.RightReadOnly, -lower, l.lower.rotationQuaternion!);
    }
  }

  /** How many fur shells to draw (fewer far away, or on lower quality). */
  setShells(n: number): void {
    if (n === this.shells) return;
    this.shells = n;
    for (const fm of this.furMeshes) {
      const mats = new Float32Array(16 * Math.max(1, n));
      const t = new Float32Array(Math.max(1, n));
      for (let i = 0; i < Math.max(1, n); i++) {
        Matrix.IdentityReadOnly.copyToArray(mats, i * 16);
        t[i] = (i + 1) / Math.max(1, n);
      }
      fm.thinInstanceSetBuffer("matrix", mats, 16, true);
      fm.thinInstanceSetBuffer("chimpShell", t, 1, true);
      fm.setEnabled(n > 0);
    }
  }

  /** Dress the materials in the DNA's colours (no rebuild). */
  setColours(dna: ChimpDna): void {
    const c = dna.colors;
    const fur = linear(c.fur);
    const tips = linear(c.furTips);
    const s = this.skin.skin;
    s.furRoot = fur.scale(0.55);
    s.skin = linear(c.skin);
    s.palms = linear(c.palms);
    s.lip = linear(c.skin).multiply(new Color3(0.62, 0.42, 0.42));
    s.beard = dna.shape.beard;
    const f = this.fur.fur;
    f.root = fur.scale(0.5);
    // the tips: the fur's own colour, lifted toward the tips' colour
    f.tip = Color3.Lerp(fur, tips, 0.55);
    f.beard = dna.shape.beard;
    f.length = 0.016 + 0.036 * dna.shape.furLength;
    this.paintEyes(c.eyeColor);
  }

  /** The iris and sclera, painted once per colour. */
  private paintEyes(iris: string) {
    const ctx = this.eyeTex.getContext() as CanvasRenderingContext2D;
    const W = 256;
    const c = W / 2;
    // the sclera: warm white, darker toward the edges where the lids shade it
    const scl = ctx.createRadialGradient(c, c, 0, c, c, c);
    scl.addColorStop(0, "#f4ece2");
    scl.addColorStop(0.7, "#e7d8ca");
    scl.addColorStop(1, "#b89c88");
    ctx.fillStyle = scl;
    ctx.fillRect(0, 0, W, W);
    const ir = W * 0.31;
    const base = Color3.FromHexString(iris);
    const dark = base.scale(0.45).toHexString();
    const light = Color3.Lerp(base, Color3.White(), 0.25).toHexString();
    const g = ctx.createRadialGradient(c, c, ir * 0.25, c, c, ir);
    g.addColorStop(0, light);
    g.addColorStop(0.65, iris);
    g.addColorStop(0.92, dark);
    g.addColorStop(1, "#1a0f08");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, ir, 0, Math.PI * 2);
    ctx.fill();
    // radial fibres
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1.2;
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2 + (a % 3) * 0.03;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(t) * ir * 0.42, c + Math.sin(t) * ir * 0.42);
      ctx.lineTo(c + Math.cos(t) * ir * 0.95, c + Math.sin(t) * ir * 0.95);
      ctx.stroke();
    }
    ctx.fillStyle = "#060403";
    ctx.beginPath();
    ctx.arc(c, c, ir * 0.42, 0, Math.PI * 2);
    ctx.fill();
    this.eyeTex.update(true);
  }

  /**
   * Put an item on (made for this chimp's shape: avatar/builder.ts itemModel), in a
   * slot, in its colours; or, with null, take off what is there. The fur it hides goes,
   * and comes back when it comes off.
   */
  wear(slot: Slot, item: ItemModel | null, colours: string[]): void {
    const was = this.worn.get(slot);
    if (was) {
      for (const d of was.dressed) d.material.dispose();
      for (const m of was.meshes) {
        this.meshes.splice(this.meshes.indexOf(m), 1);
        m.dispose();
      }
      this.worn.delete(slot);
    }
    if (item) {
      const w: Worn = { id: item.id, printInk: item.printInk, meshes: [], dressed: [], cover: item.cover };
      item.meshes.forEach((im, i) => {
        const mesh = new Mesh(`${this.root.name} ${item.id} ${i}`, this.scene);
        const vd = new VertexData();
        vd.positions = im.positions;
        vd.normals = im.normals;
        vd.indices = im.indices;
        if (!im.bone) {
          vd.matricesIndices = im.bones!;
          vd.matricesWeights = im.weights!;
        }
        if (im.uvs) vd.uvs = im.uvs;
        vd.applyToMesh(mesh, false);
        mesh.setVerticesData("chimpCloth", im.cloth, false, 4);
        // a garment's folds and seams
        if (im.folds) mesh.setVerticesData("chimpFold", im.folds, false, 4);
        if (im.seamLines) mesh.setVerticesData("chimpSeam", im.seamLines, false, 4);
        if (im.bone) {
          // made in the rest pose's space: carried by its bone, from the bone's joint
          const at = this.rig.bones[this.rig.index[im.bone]].head;
          mesh.parent = this.nodes[im.bone];
          mesh.position.set(-at[0], -at[1], -at[2]);
          this.prepare(mesh, false);
        } else this.prepare(mesh);
        const { material, cloth } = this.itemMaterial(im, `${this.root.name} ${item.id} ${i}`, item);
        if (cloth) {
          if (im.seams) cloth.seams.set(...im.seams);
          cloth.fuzz = Math.max(cloth.fuzz, im.fuzz ?? 0);
          cloth.pattern = item.pattern ?? 0;
          cloth.setSewn(!!im.folds, !!im.seamLines);
          if (im.seamStyle) cloth.seamStyle.set(...im.seamStyle);
          if (im.stitch) cloth.stitch.set(...im.stitch);
          cloth.hem = im.hem ?? 0;
        }
        mesh.material = material;
        w.meshes.push(mesh);
        w.dressed.push({ mesh, material, cloth, colour: im.colour, hex: im.hex, kind: im.kind, sheenTint: im.kind === "cloth" ? FABRICS[im.fabric ?? "plain"].sheenTint : 0 });
        this.meshes.push(mesh);
      });
      this.worn.set(slot, w);
      this.colourWorn(slot, colours);
    }
    this.coverFur();
    this.version++;
  }

  /** Recolour what is worn in a slot (no rebuild). */
  colourWorn(slot: Slot, colours: string[]): void {
    const w = this.worn.get(slot);
    if (!w) return;
    for (const d of w.dressed) {
      const main = linear(d.hex ?? colours[d.colour] ?? colours[0] ?? "#808080");
      // the second colour for bands; things of one colour band in a darker shade of it
      const band = colours[1] ? linear(colours[1]) : main.scale(0.55);
      if (d.cloth) {
        d.cloth.main = main;
        d.cloth.band = band;
        // the print: its main ink one of the item's colours, or one that stands out from the cloth; its second always that
        d.cloth.printColour = w.printInk !== undefined && colours[w.printInk] ? linear(colours[w.printInk]) : standOut(main);
        d.cloth.printColour2 = standOut(main);
        // the fibres' sheen: the cloth's own colour, lighter
        if (d.material.sheen.isEnabled) d.material.sheen.color = Color3.Lerp(main, Color3.White(), d.sheenTint);
      } else if (d.kind !== "dial") d.material.albedoColor = main;
    }
  }

  /** What the chimp wears now, by slot (item ids). */
  wearing(): Partial<Record<Slot, string>> {
    const out: Partial<Record<Slot, string>> = {};
    for (const [slot, w] of this.worn) out[slot] = w.id;
    return out;
  }

  /** A material for a piece of an item: cloth (as its fabric is) and plastic, coloured; metal, tinted glass, or a glowing screen. */
  private itemMaterial(im: ItemMesh, name: string, item: ItemModel): { material: PBRMaterial; cloth: ChimpClothPlugin | null } {
    const kind = im.kind;
    if (kind === "cloth" || kind === "plastic") {
      const { material, cloth } = clothMaterial(name, this.scene, kind === "plastic" ? "plastic" : (im.fabric ?? "plain"));
      if (item.print) {
        cloth.printRect.set(...item.print);
        cloth.print = printTexture(this.scene, item.printArt);
      }
      return { material, cloth };
    }
    const m = new PBRMaterial(name, this.scene);
    m.maxSimultaneousLights = 8;
    if (kind === "metal") {
      m.metallic = 1;
      m.roughness = 0.22;
    } else if (kind === "dial") {
      // a watch's face, under its glass
      m.metallic = 0;
      m.roughness = 0.45;
      m.albedoTexture = dialTexture(this.scene);
    } else if (kind === "glass") {
      m.metallic = 0;
      m.roughness = 0.04;
      // tinted lenses (shades) mostly dark; clear ones (glasses) mostly see-through
      m.alpha = item.id === "shades" ? 0.86 : 0.16;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      m.useRadianceOverAlpha = true;
      m.useSpecularOverAlpha = true;
    } else {
      // a screen: ChimpVibe mint, glowing
      m.unlit = true;
      m.albedoColor = Color3.Black();
      m.emissiveColor = linear("#78d8aa").scale(1.4);
    }
    return { material: m, cloth: null };
  }

  /** Hide the fur under everything worn: each part's carrier gets the most any item hides at each vertex. */
  private coverFur() {
    for (const [part, fm] of this.furByPart) {
      const n = fm.getTotalVertices();
      const c = new Float32Array(n);
      for (const w of this.worn.values()) {
        const wc = w.cover[part];
        if (!wc || wc.length !== n) continue;
        for (let i = 0; i < n; i++) if (wc[i] > c[i]) c[i] = wc[i];
      }
      fm.updateVerticesData("chimpCover", c);
    }
  }

  /** Stand the chimp at (x, y, z) facing `yaw` (radians, as the camera's), scaled to `height` metres. */
  place(x: number, y: number, z: number, yaw: number, height: number): void {
    this.root.position.set(x, y, z);
    this.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, 0, 0);
    this.root.scaling.setAll(height / this.baseHeight);
  }

  /** Fade the whole chimp out (0) or in (1), dithered. */
  setFade(v: number): void {
    this.skin.skin.fade = v;
    this.fur.fur.fade = v;
    for (const e of this.eyes) e.visibility = v > 0.5 ? 1 : 0;
    for (const w of this.worn.values())
      for (const d of w.dressed) {
        if (d.cloth) d.cloth.fade = v;
        else d.mesh.visibility = v > 0.5 ? (d.kind === "glass" ? 1 : 1) : 0;
      }
  }

  dispose(): void {
    for (const w of this.worn.values()) for (const d of w.dressed) d.material.dispose();
    for (const m of this.meshes) m.dispose();
    this.skeleton.dispose();
    this.skin.material.dispose();
    this.fur.material.dispose();
    this.eyeMat.dispose();
    this.eyeTex.dispose();
    this.root.dispose();
  }
}

/** An ink that stands out from a cloth: charcoal on light cloth, near white on dark. */
function standOut(c: Color3): Color3 {
  return linear(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.18 ? "#24272b" : "#dce1e8");
}

/**
 * An eyelid: a thick shell over the eyeball from its edge (the eye's middle line,
 * elevation 0) to near its pole, rounded at the edge, which carries the dark lash
 * line. The upper lid rises from the edge, the lower falls from it; turning the
 * lid about the eye's sideways axis moves its edge.
 */
function lidMesh(name: string, scene: Scene, r: number, upper: boolean): Mesh {
  const ri = r + 0.0004;
  const ro = r + 0.0019;
  const rm = (ri + ro) / 2;
  const th = (ro - ri) / 2;
  const sign = upper ? 1 : -1;
  const A = 1.5;
  const E = upper ? 1.35 : 1.1;
  // the cross-section, inner surface from the pole to the edge, round the rim, out to the pole
  const path: { rad: number; e: number; rim: number; inner: boolean }[] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) path.push({ rad: ri, e: E * (1 - i / N), rim: 0, inner: true });
  const R = 7;
  for (let i = 1; i < R; i++) {
    const t = Math.PI * (1 - i / R);
    path.push({ rad: rm - th * Math.cos(t), e: -(th * Math.sin(t)) / rm, rim: 1, inner: false });
  }
  for (let i = 0; i <= N; i++) path.push({ rad: ro, e: (E * i) / N, rim: 0, inner: false });
  const cols = 24;
  const pos: number[] = [];
  const paintA: number[] = [];
  const paintB: number[] = [];
  for (const p of path) {
    for (let j = 0; j <= cols; j++) {
      const a = -A + (2 * A * j) / cols;
      const e = p.e * sign;
      pos.push(p.rad * Math.cos(e) * Math.sin(a), p.rad * Math.sin(e), p.rad * Math.cos(e) * Math.cos(a));
      // the lash line dark, the lid a little darker than the face round it
      const nearEdge = p.inner ? 0 : Math.max(p.rim, 1 - Math.min(1, Math.abs(p.e) / 0.12));
      paintA.push(0, 0, 0, 0.55 + 0.45 * nearEdge);
      paintB.push(0, p.inner ? 0.35 : 0.9, 0, 0);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < path.length - 1; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // wind the faces so the outer surface faces away from the eye: Babylon's front faces wind
  // so that the plain cross product points away from the viewer (as the house's geometry does)
  const v = (k: number) => new Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const a0 = (path.length - 4) * (cols + 1) + cols / 2;
  const cr = Vector3.Cross(v(a0 + cols + 1).subtract(v(a0)), v(a0 + 1).subtract(v(a0)));
  if (Vector3.Dot(cr, v(a0)) > 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  mesh.setVerticesData("chimpPaintA", new Float32Array(paintA), false, 4);
  mesh.setVerticesData("chimpPaintB", new Float32Array(paintB), false, 4);
  return mesh;
}
