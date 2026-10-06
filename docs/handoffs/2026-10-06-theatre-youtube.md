# Handoff: YouTube on the theatre screen (embedded overlay)

Written 2026-10-06. Show YouTube videos and live streams on the theatre screen with the official YouTube player, as an overlay lined up with the screen. Anyone in the preview can choose what plays. The decisions behind this are in `AGENTS.md` ("Interactive features") and the Blender plan's [Dynamic rooms](../plans/2026-10-02-blender-switch-plan.md#dynamic-rooms-and-the-order-of-work) section. The YouTube findings are in the tech-stack research, `docs/research/2026-10-01-chimpverse-technology-stack.md` (the theatre row and the three paragraphs after the room table). Read all three first.

## What exists today

As on `main`; the arcade branch below adds to the input and state code.

- `buildTheatre()` in `src/world/rooms/upper.ts` builds the theatre:
  - **The screen:** 5.0 × 2.81 m (16:9) on the east wall, its plane at `wx - 0.2`, centre height `U + 2.75`, facing west. It shows `screenMat(ctx, "theatre-stream")`, a crop of the concept art.
  - **Around the screen:** an amber LED outline, a glulam proscenium, curtains, and two curved rows of sofas. The front row is about 4.7 m back.
- The corridor's "Now Showing" lightbox, built at the end of `buildTheatre()`, uses the same crop.
- The screen is merged into the room's per-material meshes, like everything else (`screenPanel()` in `src/world/props/tech.ts`). Its position isn't available at run time, and it has no role.
- The preview's existing pieces:
  - the `theatre` viewpoint (`src/world/viewpoints.ts`);
  - walk mode (`src/engine/walker.ts`);
  - pointer lock on a canvas click, and the movement keys, in `src/engine/flyCamera.ts`;
  - the HUD keys and the `roomAt()` helper in `src/engine/preview.ts`;
  - state in `src/engine/store.ts` and the HUD in `src/ui/Hud.tsx`.
- 3D rendering goes through an HDR pipeline (`src/engine/postfx.ts`). A DOM overlay sits outside it, so the video shows without the scene's colour grading.

## Build on the arcade work

The arcade cabinets (branch `arcade-cabinets`, commit `a8aaf7e`, not yet merged into `main`) already built the pieces the theatre needs. Work on a `theatre-youtube` branch made from `arcade-cabinets`, or from `main` once that is merged. Grow those pieces into shared ones rather than copying them:

- **Roles:** `src/world/roles.ts` (`ROLE`, `find()`, `findAll()`). Add the theatre screen and the lightbox here, following the cabinet screen's metadata: faces -Z, UVs 0–1 across it, its size in `screenSize`.
- **Camera:** `FlyCamera.glide()`, `releaseKeys()` and the `onClick` hook in `src/engine/flyCamera.ts`.
- **Input off:** `playing` and `playRect` in `src/engine/store.ts`, which turn off ChimpHouse's keys and mouse look. They describe a cabinet today (`slot`, `gameId`); widen them to any screen in focus.
- **Lining up:** in `src/engine/arcade.ts`, the play pose and `screenRect()`: the glide in, how much of the view the screen fills, and refitting on resize.
- **The overlay:** `src/ui/PlayOverlay.tsx`, the iframe lined up over the screen with its frame and Leave button.

The arcade must keep working. Run `tools/test-arcade.mjs` after the change and show its output with the theatre's.

## The rule that shapes the design

YouTube's [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) covers how the player is shown: its controls stay unobscured, there is a minimum player size, and there are visibility rules for autoplay.

A browser can only show the player as a DOM element; it can't be drawn into WebGL. An overlay on top of the canvas is never covered by 3D objects. Two things are less clear:
- whether a perspective-skewed player, seen from an angle, complies;
- what happens to its sound when it's hidden.

So the work starts with a check, and the safest mode is built first.

## Steps

1. **Policy check.** Read the required minimum functionality page and YouTube's developer policies.
   - Decide whether a player that is transformed in 3D to line up with the screen at an angle complies.
   - Decide what must happen when it's hidden: keep playing, mute or pause.
   - Done when you've told the user what the rules allow for steps 3 and 4. Quote the lines, with links, and ask before building step 4 if it's unclear.
2. **The screen as a role.**
   - Build the theatre screen as its own mesh, carrying a theatre screen role from `src/world/roles.ts`, and give the lightbox its own role.
   - At run time, find the screen's corners through its role, never by repeating `upper.ts`'s numbers.
   - With nothing playing, the screen shows a placeholder.
   - Done when code finds the screen and its corners by role, and the room looks as before.
3. **Watch mode.** The mode that is always allowed:
   - Using the screen from anywhere in the theatre, the way a cabinet is used (E, or clicking the screen), frees the mouse and glides the camera to a seat-height pose square onto the screen.
   - The YouTube player then appears exactly over the screen, a plain rectangle with its own controls usable. A frame of UI sits outside the player, never over it, with the video's title and a Leave button.
   - Leave removes the frame, keeps or stops the video as step 1 decided, and returns to walking.
   - While watching, ChimpHouse's own keys do nothing. Keys typed into the player go to YouTube.
   - Done when a round trip works and the player stays lined up through window resizes.
4. **Live picture while walking.** Only if step 1 allows it. While the viewer is in the theatre and the screen is in view, keep the player lined up with the screen in perspective: a CSS `matrix3d` built each frame from the screen's four projected corners.
   - Hide it, and show the video's thumbnail or the placeholder, when any of these is true:
     - a corner is behind the camera;
     - the player would be smaller than YouTube's minimum;
     - the angle is too steep;
     - a ray from the eye to the screen is blocked;
     - the viewer leaves the theatre.
   - The mouse is locked while walking, so the player only takes clicks once the mouse is freed.
   - Done when walking around the theatre keeps the picture on the screen with no visible drift, and it hides cleanly in each of those cases.
5. **Choosing what plays.**
   - Add a HUD control: paste a YouTube link (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`) or a video ID, for a video or a live stream.
   - Use the [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) with `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`, and start playback from the user's click so sound is allowed.
   - Show YouTube's errors in plain words, especially "the owner doesn't allow embedding" (codes 101 and 150).
   - The lightbox shows the current video's thumbnail if the image can be loaded as a texture; check its CORS.
   - Keep the theatre's state as one object: video ID, play or pause, and the time reference. The room server can share that state later to keep everyone in step.
   - Done when a pasted video and a pasted live stream both play, and an embed-blocked video shows its message.
6. **Tests.**
   - Check overlay alignment, watch mode and Leave with Playwright against a same-origin stand-in page that draws a test card. Follow the arcade's pattern: `public/arcade/standin.html`, `?arcade=standin` and `tools/test-arcade.mjs`.
   - Real YouTube playback is checked by the user in their own browser. Give them the steps and a few links to try.
   - Done when the checks pass and their output has been shown to the user.

## Out of scope

- Keeping viewers in step: there's no room server yet.
- Host permissions over who may change the video.
- Mobile.
- Captions beyond what the player provides.

## When you finish

Report to the user:
- what the policy check found;
- which modes were built;
- the test output;
- the steps for their own check with real videos.

Commit when the user asks, following `AGENTS.md`.
