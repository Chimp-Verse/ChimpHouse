# ChimpHouse: chimp avatars

Plan date: 2026-10-16. Branch: `chimp-avatar`.

Status: built on the code world. Every visitor walks the house as a chimp they can reshape and dress, and sees every other visitor's chimp. The chimp is made in code, as the house is until its cut-over to Blender (`docs/plans/2026-10-02-blender-switch-plan.md`). This document records how a chimp is made, and the contract a chimp and clothes modelled in Blender must meet to take its place.

## What a visitor gets

- **Walking is walking as a chimp.** **F** stands the visitor's chimp where the camera was. The camera follows on a boom behind and above it; walls cut the boom short at once and it eases back out when they clear, so the camera never looks through a wall. The wheel brings the camera in or out, and all the way in is the chimp's own eyes. **V** switches between the two.
- **Reach is the chimp's.** Everything that asks whether a visitor is within reach of something and looking at it, measures from the chimp's eyes, never from a camera 2.7 m behind it: a cabinet, a remote, the claw, the lift's buttons, a click on a screen. The lens is `viewer` in `engine/flyCamera.ts`. Older browser tests walk from the chimp's eyes with `?pov=first`, as they were written for.
- **The wardrobe** (**C**, or **Dress your chimp** in the side panel) swings the camera round in front of the chimp, which stands still and looks at the camera. It has four tabs:
  - **Body:** a chimp to start from (`PRESETS` in `dna.ts`: Classic, Youngster, Elder, Golden, Mint), in the clothes it has on; height, build, belly, arms, legs.
  - **Face:** head size, muzzle, brow, ears, eyes, and the face's and eyes' colours.
  - **Fur:** colour, tips, length, grey beard, and the hands' and feet's colour.
  - **Clothes:** a slot each for head, eyes, neck, top, bottom, back and wrist.

  Colours, height and clothes change at once. A new shape is built in about a second. The chimp is kept in the browser for the next visit (`localStorage` key `chimphouse.chimp.v1`) and shown to everyone.
- **Other visitors' chimps** walk where their visitors walk, dressed as they dressed them, with their names over their heads, and go when their visitors leave.

## The look

The chimp belongs to the ChimpVerse family:

- the dark chimps of the concept art (`Reference Images/`);
- the cartoon chimps of Chimp Battle;
- ChimpVibe's Review Chimp face;
- the chimp in ChimpVibe's tree mark.

What makes it read as a chimp:

- **The face:** the bare, heart-shaped face of every ChimpVerse chimp (a lobe round each eye, the nose between, a long muzzle below), framed by long side-whiskers.
- **The head:** a heavy brow over deep-set eyes with lids, a low skull, and big round cupped ears.
- **The body:** long arms with knuckle-level hands, short bent legs, a stoop, a barrel chest and a pot belly.
- **The extremities:** bare palms and soles, long fingers with nails, and a big toe set apart like a thumb.
- **The coat:** dark brown, coarse and gathered into locks, longer and shaggier over the shoulders. The forearm hair points back to the elbow, as a chimp's does. An optional grey chin beard.

The clothes are ChimpVerse's too: the ChimpVibe tee carries the tree mark (from `public/brand/chimpvibe-mark.svg`), and the colours are the house's and ChimpVibe's (teal, mustard, rust, sage, mint, coin yellow).

## How a chimp is made

| File | What it does |
| --- | --- |
| `src/avatar/dna.ts` | The DNA: every setting as a row in a table (`SHAPES`, `COLOURS`) and the outfit by slot. `sanitize` makes any DNA safe to build from (another visitor's, an old save); `geometryKey` names the shape, so chimps shaped alike share their meshes |
| `src/avatar/rig.ts` | The skeleton laid out from the DNA: VRM humanoid bone names, an A-pose rest with every bone unrotated, each hinge's axis, and landmarks (the skull, eyes, ears, mouth, hands' and feet's frames) |
| `src/avatar/sdf.ts` | Signed distance fields: spheres, ellipsoids, tapered capsules, rounded boxes and rings, added, cut and intersected with smooth blends; *limbs* blend with the trunk but meet each other with a hard edge, so fingers never web |
| `src/avatar/anatomy.ts` | The chimp as distance fields, in six parts meshed at their own detail (body, head, two hands, two feet; the face and fingers are finest); what each point of the skin is (bare or furred, fur length and the way it lies, beard, lips, nails, the shade of creases) and which bones move it |
| `src/avatar/mesher.ts` | Surface nets on a grid sampled only near the surface, then each vertex settled onto it with the field's own normal |
| `src/avatar/decimate.ts` | Quadric-error simplification (Garland and Heckbert), with a cap on edge length so the joints keep rings to bend on |
| `src/avatar/model.ts` | One chimp's geometry: each part meshed, simplified to its budget, settled and painted, and its fur carrier |
| `src/avatar/build.worker.ts`, `builder.ts` | Building in two workers side by side, each making some of the parts, and kept by geometry key (12 bodies, 12 items) |
| `src/avatar/materials.ts` | Babylon PBR materials with plugins, so a chimp is lit as the house is: the skin (painted from each vertex), the fur (shells), cloth (two colours, a weave or knit, a print). All fade with a dither |
| `src/avatar/chimp.ts` | A chimp in the scene: the bone nodes driving the Babylon skeleton, the skinned skin, the fur shells (thin instances, one draw call a part), eyes and lids, and what it wears |
| `src/avatar/animator.ts` | Procedural animation: the gait from a walk through a jog to a run, feet placed by two-bone IK and kept still while they bear weight, each on the ground under it (a step of the stairs), stepping round when it turns on the spot, the stoop, sway, twist, lean, arm swing, breathing, glances, blinks and the look |
| `src/avatar/wardrobe.ts` | The items, by slot, with their colours |
| `src/avatar/items.ts`, `garments.ts` | Making an item for a chimp's shape: worn on a bone (cap, beanie, headphones, glasses, bandana, chain, backpack, watch) or fitted to the body and skinned (tee, hoodie, shorts), each saying which fur it hides |
| `src/engine/avatars.ts` | Chimps in the house: this visitor's (where the walker is, which way it turns, what it looks at) and the others' (from the room server, drawn a moment behind, smoothly); its lights (copies of the room lights where it stands, `ChimpLights` in `src/engine/lighting.ts`), fur detail by distance, shadows, name tags |
| `src/ui/Wardrobe.tsx` | The wardrobe's panel, drawn from the DNA's tables and the items |
| `chimp.html`, `src/lab/chimpLab.ts` | The chimp lab: one chimp under the house's kind of light, for working on its look and movement without loading the house |

The pipeline for a body:

1. Mesh each part's field on a fine grid. The face's grid is 3.3 mm, fine enough for the nostrils and the mouth's line.
2. Simplify it to the part's budget.
3. Settle every vertex exactly on the surface.
4. Paint each vertex: fur, fur length, palm, dark skin, beard, crease shade, nail and mouth, plus four bone weights.
5. Simplify again for the fur's carrier, keeping only its furred triangles.

The default chimp has 47.6k skin triangles and 15k fur-carrier triangles, and 57 bones. It builds in about 0.75 s in Node. In the house it builds in about a second, in two workers, while the house builds, so it is ready when the house is.

### Fur

Fur is drawn as shells: the fur carrier drawn up to 14 times, each copy pushed further out along the skin's normal and combed along the fur's flow. Gravity droops the tips. Each shell keeps only the pixels where a strand reaches that high, from a 3D strand pattern looked up at the strand's root, so strands rise straight through the shells. Toward their tips strands lean with their neighbours, so the hair gathers into locks. Where clothes cover it, the fur goes, and it spills out at the cuffs.

Fewer shells are drawn the further a chimp is from the camera (14, 9, 5, then none at high quality; fewer at lower).

## The DNA

```json
{
  "v": 1,
  "shape": { "height": 1.5, "build": 0.5, "belly": 0.4, "arms": 0.5, "legs": 0.5, "head": 0.5, "muzzle": 0.5, "brow": 0.5, "ears": 0.5, "eyes": 0.5, "furLength": 0.5, "beard": 0.25 },
  "colors": { "fur": "#3a2a20", "furTips": "#76563e", "skin": "#d2a286", "palms": "#7a6156", "eyeColor": "#6a3e1d" },
  "outfit": { "head": { "id": "cap", "colors": ["#1f6f6c", "#24272b"] }, "top": { "id": "tee", "colors": ["#24272b", "#78d8aa"] } }
}
```

- Height is in metres, the top of the head standing upright. The chimp is scaled to it whatever its proportions, so height never needs a rebuild.
- Every other shape setting runs from 0 to 1, with 0.5 as the default chimp.
- Settings marked `geometry` rebuild the body; the rest only change materials or scale.
- **Adding a setting:** add a row to `SHAPES` or `COLOURS`, then use it in `anatomy.ts` (shape) or `chimp.ts` `setColours` (colour). The wardrobe shows it; DNA without it takes its default.
- **Adding an item:** add an entry to `ITEMS` in `wardrobe.ts`, then add its plan to `items.ts` (worn on a bone) or its pattern to `garments.ts` (fitted). An item another visitor's page doesn't know is simply not worn there.

## Other visitors

Chimps go through the room server (`server/roomServer.ts`, `engine/room.ts`) as two families of topics, one member per visitor:

- `chimpdna:<visitor id>`: the visitor's name and DNA, sent whenever they change.
- `chimp:<visitor id>`: where the chimp stands, which way it faces and moves, whether it's on the ground, where it looks, and the room's clock. Sent ten times a second while it moves, and every 1.5 s while it stands.

Each page draws other visitors' chimps 160 ms behind the room's clock, smoothly between what it last heard, and carries on a moment at the last speed heard. When a visitor leaves, the room server drops their topics and every page drops their chimp. The standalone room server (`docs/plans/2026-10-09-standalone-room-server-plan.md`) should own these positions, checking movement against the house as the research recommends.

## The contract with Blender

The code-built chimp is the stand-in, as the code-built arcade cabinet is: once the house has moved to Blender, a chimp and clothes modelled there take its place. These are the terms they must meet, so the animation, the wardrobe, presence and the materials carry over unchanged.

### The skeleton

- **Bone names:** VRM humanoid names:
  - `hips`, `spine`, `chest`, `upperChest`, `neck`, `head`, `jaw`, `leftEye`, `rightEye`;
  - per side: `leftShoulder`, `leftUpperArm`, `leftLowerArm`, `leftHand`;
  - per finger: `leftThumbMetacarpal`, `leftThumbProximal`, `leftThumbDistal`, and `left{Index,Middle,Ring,Little}{Proximal,Intermediate,Distal}`;
  - per leg: `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `leftToes`;
  - the right side mirrored;
  - plus `leftEar` and `rightEar`, as VRM allows extra bones.
- **Facing and axes:** +Z forward, +Y up, metres. Its left is −X in Babylon, which is +X in glTF; Babylon's glTF loader converts.
- **Rest pose:** the A-pose (arms about 38° down from level, knees and elbows a touch bent). Every bone rests unrotated, so the animator turns bones about the character's own axes. A Blender rig whose bones carry rest rotations needs them applied before export, or the animator taught them.
- **Hinges:** each hinge joint's axis is worked out from the rest pose: elbows, knees, finger joints (bending toward the palm), the jaw and the toes.

### The meshes

The skin is skinned to that skeleton, at most four bones a vertex. It carries two vertex attributes:

- `chimpPaintA`: fur amount, fur length, palm colour and darker skin.
- `chimpPaintB`: grey beard, crease shade (AO), nail and mouth.

In Blender these can be colour attributes, or the skin material can move to textures with the same meaning.

The fur carrier is a lower-detail copy of the furred skin, skinned the same way, with two attributes:

- `chimpFur`: amount, length, beard and crease shade.
- `chimpFlow`: the way the fur lies.

A Blender groom can be converted to these: its flow as the carrier's flow, its density as the amount.

### Clothes and accessories

- **Worn on a bone** (a cap, glasses): a mesh in rest-pose space, carried by its bone (`head`, `neck`, `upperChest`, `leftLowerArm`).
- **Fitted** (a tee): skinned to the same skeleton.
- Each is fitted to the chimp it is made for, from that chimp's own shapes: a hat's crown is its skull grown a centimetre, its band set over the brow ridge found on its head; a strap, a collar or a watch's band follows the skin found along its path (`avatar/fit.ts`). So every item fits every build, belly and head the DNA makes.
- Each carries `chimpCloth`: on a band (the second colour), how far the edge is and how far along it (for stitching along it, as on a cap's peak), crease shade. A cap's panel seams and a knitted hat's ribs are drawn round its axis (`seams` on the mesh).
- Over the fur, an item says how much of it it covers: up to about 0.8 the fur is pressed down, shorter the more (round a strap, under a peak); fully covered, under cloth, there is none.
- Each also needs a mask of the fur it hides. In Blender that's a vertex group on the fur carrier, or a volume the code can test.
- An item modelled for the default chimp fits others through the skeleton's proportions. Garments whose wearers change shape a lot need shape keys too.

### The DNA's shapes

Shapes become shape keys: a key or a pair for each geometry setting in `SHAPES` (`build+`, `build-`, `muzzle+`…), weighted from the DNA. That replaces rebuilding with blending, and it is the larger part of the move. Height stays a scale.

Until then, the generator is cheap to keep. It builds any chimp in about a second.

## Performance

- **Per chimp,** at high quality and close by: 47.6k skin triangles, and 15k fur-carrier triangles drawn up to 14 times. About 15 draw calls (six skin, six fur, eyes, lids), plus two to four per worn item.
- **Distance:** fur shells drop with distance and quality. A chimp out of the camera's view isn't drawn or posed.
- **Light:** each chimp has three point lights of its own that copy the room's lamps that light it most, and light only it (`ChimpLights` in `engine/lighting.ts`). They come from a pool made with the sun, before the room lights, for twelve chimps: a light made once the house is built costs a pass over every mesh against every room light's list. A thirteenth chimp makes its own, at that cost.
- **Main thread:** the chimp's own code (posing, the feet's ground, the lights, telling the room) took 0.2 to 0.3 ms a frame in a profile of the house in the Game Room, about 1% of the page's time; Babylon's binding of the house's materials took about a third.
- **In the headless test,** the house ran at 40 to 52 fps in the Game Room with a chimp at 2.5 m.
- **Still to measure:** a crowd, and a chimp on the target laptops (the research's 1, 8, 16, 32 and 50 avatar steps). Chimps shaped alike already share their models' arrays; sharing their GPU buffers too is the next saving for a crowd.

## Next

- **Sitting and holding:**
  - sitting on the theatre's seats, the sofas and stools;
  - holding a remote, a controller or a carried plush in a hand;
  - the chimp's pose at a cabinet or table while its visitor plays.
- **Emotes and talking:**
  - a wave, a clap, a chest beat, a dance;
  - the jaw moving with voice once ChimpVerse has it (the jaw bone and the mouth's line are there).
- **Clothes:**
  - more items, and more patterns (the bandana has the first);
  - colours for every part of an item;
  - a mirror in the house for the wardrobe.
- **Identity and moderation:**
  - DNA tied to a visitor's account once ChimpVerse has accounts;
  - names and DNA checked by the standalone room server.
