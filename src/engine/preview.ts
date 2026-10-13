import { Color3, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, Vector3, VertexData } from "@babylonjs/core";
import { buildWorld, World } from "../world/build";
import { MeshMeta, faceLabel } from "../world/context";
import { pointInPolygon } from "../world/geometry/curves";
import { FLOOR_PLAN, HALL_TRACED, LEVEL, M, ROOMS, levelAt, lowerDeckLoop, roomAt, upperDeckLoop } from "../world/layout";
import { VIEWPOINTS, Viewpoint, findView } from "../world/viewpoints";
import floorPlanUrl from "../../Reference Images/FloorPlan.png";
import { FlyCamera, isTyping } from "./flyCamera";
import { Lighting } from "./lighting";
import { PostFx } from "./postfx";
import { Quality, store } from "./store";
import { CollisionWorld } from "./collision";
import { Walker } from "./walker";
import { Arcade } from "./arcade";
import { ScreenFocus, screenGeometry, toPage } from "./focus";
import { loadGameList } from "./gameList";
import { ButtonId, Lift } from "./lift";
import { Remotes } from "./remotes";
import { Theatre } from "./theatre";
import { Pinball } from "./pinball";
import { parseYouTube } from "./youtube";

export interface PreviewController {
  goTo(id: string): void;
  setNight(n: boolean): void;
  setRoofHidden(v: boolean): void;
  setUpperHidden(v: boolean): void;
  setPlanOverlay(v: boolean): void;
  setQuality(q: Quality): void;
  setWalking(v: boolean): void;
  /** Play the game at the cabinet in a slot (walk mode), or leave it. */
  useCabinet(slot: number): Promise<boolean>;
  leaveCabinet(): Promise<void>;
  /** The theatre: what it shows, choosing videos, watching (walk mode) and its player. */
  readonly theatre: Theatre;
  /** The theatre's remotes: whoever holds one controls the theatre. */
  readonly remotes: Remotes;
  /** Export a room (by default the one the camera is in) as a .glb file for Blender and download it. */
  downloadRoom(id?: string): Promise<void>;
  copyReport(): Promise<string>;
}

const params = new URLSearchParams(location.search);
export const CAPTURE = params.get("capture") === "1";

export async function startPreview(canvas: HTMLCanvasElement): Promise<PreviewController> {
  // the drawing buffer isn't kept between frames (nothing reads the canvas back; screenshots
  // come from the browser), which saves a full-screen copy on every frame
  const engine = new Engine(canvas, false, { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance", antialias: false }, false);
  const dpr = window.devicePixelRatio || 1;
  const applyScale = (q: Quality) => engine.setHardwareScalingLevel(1 / Math.min(dpr, q === "high" ? 1.25 : q === "medium" ? 1.0 : 0.75));
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  const fly = new FlyCamera(scene, canvas);
  // the arcade's game list loads while the house builds
  const gameList = loadGameList();

  const world: World = await buildWorld(scene, async (f, msg) => {
    store.set({ progress: f, message: msg });
    await new Promise((r) => setTimeout(r, 0));
  });
  const lighting = new Lighting(scene, world.sky);
  lighting.attach(world.ctx);
  const post = new PostFx(scene, fly.camera);
  // using a screen: a cabinet's game, the theatre's video
  const focus = new ScreenFocus(scene, fly, canvas);
  // cabinets for the admitted games; the walker's collisions are rebuilt when they come or go
  const arcade = new Arcade(scene, world.mats, lighting, fly, focus, canvas, () => {
    if (walker) walker.world = new CollisionWorld(scene);
  });
  const theatre = new Theatre(scene, world.mats, fly, focus, canvas);
  const remotes = new Remotes(scene, world.mats, lighting, fly, canvas, (msg) => flash(msg));
  // the lift: its car and doors are shown from its shared state (engine/liftState.ts)
  const lift = new Lift(scene, world.mats, fly, canvas);
  // the pinball machines: their moving parts, lamps and displays
  const pinball = new Pinball(scene, world.mats, lighting, fly);
  // a click on a screen, a remote or a lift button in reach uses it, instead of capturing the mouse
  fly.onClick = (e) => arcade.click(e) || remotes.click(e) || theatre.click(e) || lift.click(e);
  const arcadeReady = arcade.refresh(gameList).catch((e: unknown) => console.warn("[arcade] no game list:", e));

  const levelMeshes = (lv: string) => scene.meshes.filter((m) => (m.metadata as MeshMeta | undefined)?.level === lv);
  const upper = levelMeshes("upper");
  const roof = levelMeshes("roof");
  const planOverlays = makePlanOverlays(scene);
  // walk mode's collision grid is built the first time it is switched on
  let walker: Walker | null = null;
  /** while a room is being exported the scene isn't drawn */
  let exporting = false;

  const applyVisibility = () => {
    const s = store.get();
    for (const m of upper) m.setEnabled(!s.upperHidden);
    for (const m of roof) m.setEnabled(!(s.roofHidden || s.upperHidden));
    planOverlays.lower.setEnabled(s.planOverlay && s.upperHidden);
    planOverlays.upper.setEnabled(s.planOverlay && !s.upperHidden);
  };

  const controller: PreviewController = {
    goTo(id) {
      const v = findView(id);
      if (!v) return;
      applyView(v, !CAPTURE && !v.pose.ortho);
    },
    setNight(n) {
      store.set({ night: n });
      lighting.setNight(n);
      post.setNight(n);
      for (const m of world.ctx.nightOnly) m.setEnabled(n);
    },
    setRoofHidden(v) {
      store.set({ roofHidden: v });
      applyVisibility();
    },
    setUpperHidden(v) {
      store.set({ upperHidden: v });
      applyVisibility();
    },
    setPlanOverlay(v) {
      store.set({ planOverlay: v });
      applyVisibility();
    },
    setQuality(q) {
      store.set({ quality: q });
      applyScale(q);
      lighting.setQuality(q);
      post.setQuality(q);
    },
    setWalking(v) {
      if (store.get().focus) return;
      if (!v) {
        fly.walker = null;
        store.set({ walking: false, blocked: null });
        return;
      }
      if (fly.isOrtho) {
        flash("Walk mode needs a 3D view: pick a viewpoint or fly first");
        return;
      }
      if (!walker) {
        const t0 = performance.now();
        const collision = new CollisionWorld(scene);
        walker = new Walker(collision);
        console.info(`Walk mode: ${collision.triangles} triangles, ${collision.nx} x ${collision.nz} cells, built in ${Math.round(performance.now() - t0)} ms`);
      }
      fly.setPose(fly.getPose()); // stops a viewpoint transition where it is
      const p = fly.camera.position;
      if (!walker.place(p.x, p.y, p.z, 500)) {
        flash("Nothing to stand on below the camera");
        return;
      }
      fly.walker = walker;
      store.set({ walking: true });
      flash("Walking at avatar height · F to fly");
    },
    useCabinet: (slot) => arcade.use(slot),
    leaveCabinet: () => arcade.leave(),
    theatre,
    remotes,
    async downloadRoom(id) {
      const room = id ? ROOMS.find((r) => r.id === id) : roomAt(fly.camera.position);
      if (!room) {
        flash("Fly into a room to download it");
        return;
      }
      flash(`Exporting ${room.name}…`);
      const { exportRoom } = await import("./exportRoom");
      // the exporter reads textures back from the GPU a frame at a time: with the scene
      // still drawing every frame that takes tens of seconds, paused about one
      exporting = true;
      let blob: Blob;
      try {
        blob = await exportRoom(scene, room.id, world.ctx.lights);
      } finally {
        exporting = false;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${room.id}.glb`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      flash(`Downloaded ${room.id}.glb (${(blob.size / 1e6).toFixed(1)} MB)`);
    },
    async copyReport() {
      const text = report();
      try {
        await navigator.clipboard.writeText(text);
        flash("Copied view details to clipboard");
      } catch {
        flash("Clipboard unavailable — details logged to console");
        console.info(text);
      }
      return text;
    },
  };

  function applyView(v: Viewpoint, animate: boolean) {
    store.set({ viewId: v.id });
    if (v.night !== undefined || store.get().night) controller.setNight(!!v.night);
    store.set({ upperHidden: !!v.hideUpper, roofHidden: !!v.hideRoof, planOverlay: !!v.planOverlay });
    applyVisibility();
    if (fly.walker) {
      // stand on the floor under an eye-level viewpoint; fly to one in the air
      const { x, y, z } = v.pose;
      if (!v.pose.ortho && fly.walker.place(x, y, z, 3.5)) {
        fly.setPose({ ...v.pose, y: fly.walker.eyeY });
        return;
      }
      controller.setWalking(false);
      flash(v.pose.ortho ? "Plan views are flown, not walked" : "That viewpoint is in the air: flying there");
    }
    fly.setPose(v.pose, animate ? 1.1 : 0);
  }

  function report(): string {
    const s = store.get();
    const p = fly.getPose();
    const lines = [
      `ChimpHouse preview — ${s.viewId ? `last viewpoint "${findView(s.viewId)?.label}"` : "custom view"}${s.night ? " (night)" : ""}`,
      `Camera: (${p.x}, ${p.y}, ${p.z})  heading ${Math.round(fly.headingDeg)}°  pitch ${Math.round((-p.pitch * 180) / Math.PI)}°  fov ${p.fov}`,
      `Area: ${s.area}`,
    ];
    if (s.walking && fly.walker) lines.push(`Walking: feet at y ${fly.walker.feet.y.toFixed(2)}${s.blocked ? `, bumped into ${s.blocked}` : ""}`);
    if (s.picked) lines.push(`Picked: ${s.picked.label} at (${s.picked.point.map((v) => v.toFixed(2)).join(", ")})`);
    lines.push(`Pose JSON: ${JSON.stringify(p)}`);
    return lines.join("\n");
  }

  function flash(msg: string) {
    store.set({ toast: msg });
    setTimeout(() => store.get().toast === msg && store.set({ toast: null }), 2200);
  }

  // ------------------------------------------------ picking / inspect
  const marker = MeshBuilder.CreateSphere("pickMarker", { diameter: 0.12 }, scene);
  const mm = new StandardMaterial("pickMarkerMat", scene);
  mm.emissiveColor = new Color3(1, 0.2, 0.6);
  mm.disableLighting = true;
  marker.material = mm;
  marker.isPickable = false;
  marker.renderingGroupId = 2;
  marker.setEnabled(false);
  canvas.addEventListener("pointerdown", (e) => {
    if (!(e.altKey || store.get().inspectMode) || e.button !== 0) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * engine.getRenderWidth();
    const sy = ((e.clientY - rect.top) / rect.height) * engine.getRenderHeight();
    const pick = scene.pick(sx, sy, (m) => m.isPickable && m.isEnabled() && m.isVisible);
    if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) {
      store.set({ picked: null });
      marker.setEnabled(false);
      return;
    }
    const label = faceLabel(pick.pickedMesh, pick.faceId);
    const p = pick.pickedPoint;
    marker.position.copyFrom(p);
    marker.setEnabled(true);
    store.set({ picked: { label, point: [p.x, p.y, p.z] } });
  });

  // ------------------------------------------------ keys
  window.addEventListener("keydown", (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    const s = store.get();
    // using a screen: keys are the game's or the player's, ChimpHouse's own do nothing
    if (s.focus) return;
    const v = VIEWPOINTS.find((vp) => vp.key === e.key);
    if (v) controller.goTo(v.id);
    else if (e.code === "KeyE" && s.walking && s.arcadePrompt) void arcade.use(s.arcadePrompt.slot);
    else if (e.code === "KeyE" && s.walking && s.remotePrompt) remotes.act();
    else if (e.code === "KeyE" && s.walking && s.theatrePrompt) void theatre.use();
    else if (e.code === "KeyE" && s.walking && s.liftPrompt) lift.act();
    // a remote's buttons (YouTube's own keys for them), and putting it back
    else if (remotes.held !== null && (e.code === "KeyK" || e.code === "KeyJ" || e.code === "KeyL")) {
      const why = theatre.command(e.code === "KeyK" ? "toggle" : e.code === "KeyJ" ? "back" : "forward");
      if (why) flash(why);
    } else if (e.code === "KeyB" && remotes.held !== null) {
      remotes.putBack();
      flash("The remote is back on the stand");
    }
    else if (e.code === "KeyN") controller.setNight(!s.night);
    else if (e.code === "KeyF") controller.setWalking(!s.walking);
    else if (e.code === "KeyR") controller.setRoofHidden(!s.roofHidden);
    else if (e.code === "KeyU") controller.setUpperHidden(!s.upperHidden);
    else if (e.code === "KeyG") controller.setPlanOverlay(!s.planOverlay);
    else if (e.code === "KeyO") store.set({ refOverlay: s.refOverlay === "off" ? "thumb" : s.refOverlay === "thumb" ? "full" : "off" });
    else if (e.code === "KeyH" || e.key === "?") store.set({ help: !s.help });
    else if (e.code === "KeyI") store.set({ inspectMode: !s.inspectMode });
    else if (e.code === "KeyP") void controller.copyReport();
    else if (e.code === "BracketRight" || e.code === "BracketLeft") {
      const i = VIEWPOINTS.findIndex((vp) => vp.id === s.viewId);
      const n = (i + (e.code === "BracketRight" ? 1 : -1) + VIEWPOINTS.length) % VIEWPOINTS.length;
      controller.goTo(VIEWPOINTS[n].id);
    }
  });

  // ------------------------------------------------ initial view
  controller.setQuality((params.get("quality") as Quality) || (CAPTURE ? "high" : "high"));
  const startView = findView(params.get("view"));
  if (params.get("night") === "1") controller.setNight(true);
  else lighting.refreshEnvironment();
  if (startView) applyView(startView, false);
  else if (!fly.restoreSaved()) applyView(VIEWPOINTS[0], false);
  if (params.get("pose")) {
    try {
      fly.setPose(JSON.parse(params.get("pose")!));
    } catch {
      /* ignore */
    }
  }
  window.addEventListener("resize", () => {
    engine.resize();
    if (fly.isOrtho) fly.applyOrtho();
  });

  // ------------------------------------------------ automation hook (capture tool)
  const waiters: { until: number; resolve: () => void }[] = [];
  const hook = {
    ready: false,
    scene,
    goTo: (id: string) => controller.goTo(id),
    views: () => VIEWPOINTS.map((v) => ({ id: v.id, ref: v.refName ?? null })),
    settle: (n: number) => new Promise<void>((resolve) => waiters.push({ until: frames + n, resolve })),
    whenReady: () => scene.whenReadyAsync(),
    setNight: (n: boolean) => controller.setNight(n),
    setPose: (p: Parameters<typeof fly.setPose>[0]) => fly.setPose(p),
    setWalking: (v: boolean) => controller.setWalking(v),
    downloadRoom: (id: string) => controller.downloadRoom(id),
    auditZone: async (id: string, level?: string) => (await import("./exportRoom")).auditZone(scene, id, level),
    /** Download one zone of the house as `<level>-<zone>.glb` (or `<zone>.glb`), for the Blender build. */
    downloadZone: async (id: string, level?: string) => {
      const { exportZone } = await import("./exportRoom");
      exporting = true;
      try {
        const blob = await exportZone(scene, id, level, world.ctx.lights);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${level ? `${level}-` : ""}${id}.glb`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      } finally {
        exporting = false;
      }
    },
    houseScene: async () => (await import("./exportRoom")).houseScene(world.ctx.lights),
    zones: () => [...new Set(scene.meshes.map((m) => (m.metadata as MeshMeta | undefined)?.room).filter((r): r is string => !!r))],
    walker: () => fly.walker,
    pose: () => fly.getPose(),
    state: () => store.get(),
    remotes: {
      held: () => remotes.held,
      take: (n: number) => remotes.take(n),
      putBack: () => remotes.putBack(),
      /** each remote's spot: its number, and where it is in the world */
      spots: () =>
        scene.transformNodes.filter((n) => n.metadata?.role === "theatre-remote-spot").map((n) => ({ remote: (n.metadata as { slot: number }).slot, at: n.getAbsolutePosition().asArray() })),
      /** whether each remote shows on the stand */
      onStand: () =>
        scene.transformNodes
          .filter((n) => n.name.startsWith("Theatre remote "))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((n) => n.isEnabled()),
    },
    arcade: {
      slots: () => arcade.slotNumbers,
      games: () => arcade.games().map(({ slot, game }) => ({ slot, gameId: game.gameId, name: game.name, playUrl: game.playUrl })),
      source: () => arcade.source,
      ready: () => arcadeReady,
      setGames: (games: Parameters<typeof arcade.setGames>[0]) => arcade.setGames(games),
      refresh: () => arcade.refresh(),
      use: (slot: number) => arcade.use(slot),
      leave: () => arcade.leave(),
      screenRect: (slot: number) => arcade.screenRect(slot),
    },
    theatre: {
      /** the screen and lightbox found by role, with their corners and size */
      screens: () =>
        [theatre.screen, theatre.lightbox].map((m) => {
          if (!m) return null;
          const g = screenGeometry(m);
          return { name: m.name, role: (m.metadata as { role: string }).role, corners: g.corners.map((c) => c.asArray()), normal: g.normal.asArray(), size: [g.width, g.height] };
        }),
      /** the screen's corners on the page now (CSS px): bottom-left, bottom-right, top-right, top-left */
      screenOnPage: () => (theatre.screen ? toPage(screenGeometry(theatre.screen).corners, scene, canvas) : null),
      parse: (text: string) => parseYouTube(text),
      command: (button: "toggle" | "back" | "forward") => theatre.command(button),
      choose: (text: string) => theatre.choose(text),
      use: () => theatre.use(),
      leave: () => theatre.leave(),
      position: () => theatre.position(),
      thumbnail: () => theatre.thumbnail,
      /** where the player is ("hidden", "over" the screen in perspective, or "watch"), and why while hidden */
      placement: () => theatre.placement,
      /** put a 1 m box in the theatre at [x, y, z] (null takes it away), to check the player hides when the view is blocked */
      blocker: (at: [number, number, number] | null) => {
        let box = scene.getMeshByName("testBlocker");
        if (!at) return box?.dispose();
        if (!box) {
          box = MeshBuilder.CreateBox("testBlocker", { size: 1 }, scene);
          box.renderingGroupId = 1;
          box.metadata = { room: "theatre", roomName: "Theatre", level: "upper", labels: [{ face: 0, label: "Test blocker" }], matKey: "" } satisfies MeshMeta;
        }
        box.position.set(...at);
      },
    },
    lift: {
      /** the shared state (store.lift), and the car as it is shown now */
      state: () => store.get().lift,
      describe: () => lift.describe(),
      /** a landing's call button, or a car button, pressed */
      call: (floor: 1 | 2) => lift.press(floor, "call"),
      ride: (floor: 1 | 2) => lift.press(floor, "car"),
      /** any of its buttons, as a press of it: call1, call2, car1, car2, open, close */
      use: (id: ButtonId) => lift.use(id),
      /** the shared lift back as the house opens with it, for everyone in the room (tests start from it) */
      reset: () => lift.reset(),
    },
    info: () => ({
      fps: Math.round(engine.getFps()),
      drawCalls: engine._drawCalls?.lastSecAverage ? Math.round(engine._drawCalls.lastSecAverage) : engine._drawCalls?.current ?? 0,
      env: !!scene.environmentTexture,
      meshes: scene.meshes.length,
      activeMeshes: scene.getActiveMeshes().length,
      vertices: scene.getTotalVertices(),
      gl: engine.webGLVersion,
      renderer: engine.getGlInfo().renderer,
    }),
  };
  (window as unknown as { __chimp: typeof hook }).__chimp = hook;

  // ------------------------------------------------ loop
  let t = 0;
  let hudTimer = 0;
  let frames = 0;
  engine.runRenderLoop(() => {
    if (exporting) return;
    const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
    t += dt;
    // the lift moves before the walker does, so the walker stands on the car where it is this frame
    lift.update();
    fly.update(dt);
    focus.update();
    arcade.update();
    remotes.update();
    theatre.update();
    pinball.update(dt);
    for (const a of world.ctx.animators) a(t, dt);
    engine._drawCalls.fetchNewFrame();
    scene.render();
    frames++;
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const p = fly.camera.position;
      if (store.get().loading) return;
      store.set({
        fps: Math.round(engine.getFps()),
        drawCalls: engine._drawCalls?.current ?? 0,
        pos: [round1(p.x), round1(p.y), round1(p.z)],
        heading: Math.round(fly.headingDeg),
        area: locate(p),
        blocked: fly.walker?.blockedBy ?? null,
      });
    }
    if (frames === 60) hook.ready = true;
    for (const w of waiters.splice(0)) {
      if (frames >= w.until) w.resolve();
      else waiters.push(w);
    }
  });
  // the cabinets join the first view if the list comes quickly, and later otherwise;
  // the list is checked again every couple of minutes
  store.set({ message: "Switching on the arcade…", progress: 0.985 });
  await Promise.race([arcadeReady, new Promise((r) => setTimeout(r, 5000))]);
  if (!CAPTURE) setInterval(() => void arcade.refresh().catch((e: unknown) => console.warn("[arcade] list refresh failed:", e)), 120_000);
  // keep the loading screen up until the first view's shaders have compiled
  store.set({ message: "Compiling shaders…", progress: 0.99 });
  await scene.whenReadyAsync();
  store.set({ loading: false, progress: 1 });
  return controller;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/** Name of the area containing p. */
function locate(p: Vector3): string {
  const level = levelAt(p.y);
  if (level) {
    const r = roomAt(p);
    if (r) return `${level === "lower" ? "Lower" : "Upper"} · ${r.name}`;
    if (level === "lower" && pointInPolygon({ x: p.x, z: p.z }, lowerDeckLoop)) return "Lower · Deck";
    if (level === "upper" && pointInPolygon({ x: p.x, z: p.z }, upperDeckLoop)) return "Upper · Deck & balcony";
  }
  return p.y > 30 ? "Above the canopy" : "Outside · Jungle";
}

/**
 * Semi-transparent floor-plan images laid under the model. The plan is split
 * into three strips (west wing, hall, east wing) so it follows the same
 * hall-preserving mapping `M` as the model footprints.
 */
function makePlanOverlays(scene: Scene): { lower: Mesh; upper: Mesh } {
  const tex = new Texture(floorPlanUrl, scene);
  const PX = 0.05; // traced metres per plan pixel
  const make = (name: string, origin: { px: number; py: number }, px0: number, px1: number, y: number) => {
    const { imageSize } = FLOOR_PLAN;
    const hallPx = HALL_TRACED / PX;
    const cuts = [px0, origin.px - hallPx, origin.px + hallPx, px1];
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const zTop = M(0, origin.py * PX).z;
    const zBot = M(0, (origin.py - imageSize.h) * PX).z;
    for (let i = 0; i < 3; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const xa = M((a - origin.px) * PX, 0).x;
      const xb = M((b - origin.px) * PX, 0).x;
      const k = pos.length / 3;
      pos.push(xa, y, zBot, xb, y, zBot, xb, y, zTop, xa, y, zTop);
      uvs.push(a / imageSize.w, 0, b / imageSize.w, 0, b / imageSize.w, 1, a / imageSize.w, 1);
      idx.push(k, k + 3, k + 2, k, k + 2, k + 1);
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.uvs = uvs;
    vd.indices = idx;
    vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0));
    const m = new Mesh(name, scene);
    vd.applyToMesh(m);
    const mat = new StandardMaterial(name + "Mat", scene);
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    mat.alpha = 0.6;
    mat.backFaceCulling = false;
    m.material = mat;
    m.isPickable = false;
    m.renderingGroupId = 2;
    m.setEnabled(false);
    return m;
  };
  return {
    lower: make("planOverlayLower", FLOOR_PLAN.lowerOrigin, 0, 957, LEVEL.lower + 0.08),
    upper: make("planOverlayUpper", FLOOR_PLAN.upperOrigin, 958, 1915, LEVEL.upper + 0.08),
  };
}
