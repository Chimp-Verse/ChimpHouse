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
import { AirHockey } from "./airHockey";
import { ScreenFocus, screenGeometry, toPage } from "./focus";
import { loadGameList } from "./gameList";
import { Foosball } from "./foosball";
import * as foosballMatch from "./foosballMatch";
import * as foosballPhysics from "./foosballPhysics";
import * as foosballRobot from "./foosballRobot";
import * as foosballSpec from "../world/props/foosballSpec";
import { ButtonId, Lift } from "./lift";
import { ClawMachine } from "./clawMachine";
import { Remotes } from "./remotes";
import { SnackMachine } from "./snackMachine";
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
  /** The claw machine: playing it (walk mode), its drop button, leaving. */
  readonly claw: ClawMachine;
  /** The pinball machines: playing one (walk mode), leaving, a new game. */
  readonly pinball: Pinball;
  /** The air hockey table: playing at it, and leaving. */
  readonly airHockey: AirHockey;
  /** The foosball table: playing it, against the robot or another visitor. */
  readonly foosball: Foosball;
  /** The Game Room's snack machine. */
  readonly snacks: SnackMachine;
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
  // the foosball table: its rods, ball and score counters, and playing it
  const foosball = new Foosball(scene, world.mats, lighting, fly, focus, canvas);
  // the air hockey table: its mallets and puck
  const airHockey = new AirHockey(scene, world.mats, lighting, fly, focus, canvas, (msg) => flash(msg));
  // the snack machine: its coils and snacks, shown from its shared state (engine/snackState.ts)
  const snacks = new SnackMachine(scene, world.mats, fly, focus, canvas, (msg) => flash(msg));
  // the claw machine: its prizes settle into a pile as the house opens
  const claw = new ClawMachine(scene, world.mats, lighting, fly, focus);
  // the pinball machines: their moving parts, lamps and displays, and playing them
  const pinball = new Pinball(scene, world.mats, lighting, fly, focus, canvas);
  // a click on a screen, a remote or a lift button in reach uses it, instead of capturing the mouse
  fly.onClick = (e) => arcade.click(e) || remotes.click(e) || theatre.click(e) || lift.click(e) || pinball.click(e) || snacks.click(e);
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
    claw,
    pinball,
    airHockey,
    foosball,
    snacks,
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
    else if (e.code === "KeyE" && s.walking && s.clawPrompt) void claw.use();
    else if (e.code === "KeyE" && s.walking && s.pinballPrompt) {
      if (s.pinballPrompt.busy) flash(`${s.pinballPrompt.busy} is playing ${s.pinballPrompt.name}`);
      else void pinball.use(s.pinballPrompt.slot);
    }
    else if (e.code === "KeyE" && s.walking && s.airHockeyPrompt?.end) airHockey.act();
    else if (e.code === "KeyE" && s.walking && s.foosballPrompt && "side" in s.foosballPrompt) void foosball.use();
    else if (e.code === "KeyE" && s.walking && s.snackPrompt) snacks.act();
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
    foosball: {
      /** where the table, its rods and ball are, and how the game stands */
      describe: () => foosball.describe(),
      /** play a side (walk mode, at the table), or the side offered; leave; rematch once a match is over */
      use: (side?: "red" | "blue") => foosball.use(side),
      leave: () => foosball.leave(),
      rematch: () => foosball.rematch(),
      /** the player's hands: a click's spin kick, a flick of px to the right, the lift held, aiming at a line across the table (null: the cursor) */
      kick: () => foosball.kick(),
      flick: (px: number) => foosball.flick(px),
      lift: (on: boolean) => foosball.setLift(on),
      aim: (z: number | null) => (foosball.aimOverride = z),
      /** on the host: the ball put in play somewhere, the score set; and everyone's table back as new */
      place: (x: number, z: number, vx?: number, vz?: number) => foosball.place(x, z, vx, vz),
      setScore: (red: number, blue: number) => foosball.setScore(red, blue),
      reset: () => foosball.reset(),
      /** the pure rules, physics and robot, to test in the page */
      pure: { physics: foosballPhysics, match: foosballMatch, robot: foosballRobot, spec: foosballSpec },
    },
    airHockey: {
      /** the table's base in the world and the turn of its long axis, and its playfield in its own space */
      where: () => airHockey.where(),
      field: () => airHockey.field,
      /** the game as this page has it: the score, the puck and mallets (playfield coordinates), who plays and who runs it */
      describe: () => airHockey.describe(),
      /** play at an end (walk mode), and leave */
      sit: (end: 1 | 2) => airHockey.sit(end),
      leave: () => airHockey.leave(),
      rematch: () => airHockey.askRematch(),
      /** point the cursor at a spot on the playfield, as the mouse would */
      aim: (x: number, z: number) => airHockey.aim(x, z),
      /** on the page running the game: put the puck somewhere moving, or set the score */
      setPuck: (x: number, z: number, vx: number, vz: number) => airHockey.setPuck(x, z, vx, vz),
      setScore: (red: number, blue: number) => airHockey.setScore(red, blue),
      /** both ends free and the game stopped, for everyone in the room */
      reset: () => airHockey.reset(),
      /** the pure physics and robot, to test on their own */
      physics: () => import("./airHockeyPhysics"),
    },
    snacks: {
      /** the machine's base and the way its front faces, for placing the camera */
      machine: () => snacks.where(),
      /** the shared state and what shows: display, code typed, vends, the snack in hand */
      describe: () => snacks.describe(),
      /** a key pressed (A–E, 1–6, CLR), or a whole code typed */
      press: (key: string) => snacks.press(key),
      choose: (code: string) => snacks.choose(code),
      /** E or a click, as the visitor would: whatever is pointed at, or what the prompt offers */
      act: () => snacks.act(),
      take: () => snacks.takeSnack(),
      eat: () => snacks.eat(),
      use: () => snacks.use(),
      leave: () => snacks.leave(),
      /** where the packs on a coil stand, from its front end (m) */
      coilPacks: (code: string) => snacks.coilPacks(code),
      /** where each key and the flap are in the world */
      places: () => snacks.places(),
      /** the shaft a coil's snacks fall down, in the coil's frame */
      shaft: (code: string) => snacks.shaftOf(code),
      /** hold the stock still as it was `ms` after the last vend started (null runs on), for screenshots */
      pauseAt: (ms: number | null) => snacks.pauseAt(ms),
      /** hold eating still `ms` into it (null runs on), for screenshots */
      holdEat: (ms: number | null) => snacks.holdEat(ms),
      setState: (patch: Parameters<typeof snacks.setState>[0]) => snacks.setState(patch),
      drop: () => snacks.drop(),
    },
    claw: {
      /** the claw's pose (trolley place, cable, swing, prongs, controls), and setting parts of it */
      pose: () => ({ ...claw.pose }),
      setPose: (p: Partial<typeof claw.pose>) => {
        Object.assign(claw.pose, p);
        claw.touch();
      },
      /** each prize: its kind, where its centre is (machine frame), whether it is asleep or out of play */
      prizes: () =>
        claw.world.kinds.map((kind, b) => ({ kind, at: Array.from(claw.world.pose.subarray(b * 7, b * 7 + 3)), asleep: claw.world.isAsleep(b), gone: claw.world.isGone(b) })),
      /** the machine's root in the world: its position and the turn it faces */
      root: () => ({ at: claw.root.getAbsolutePosition().asArray(), yaw: claw.root.rotationQuaternion?.toEulerAngles().y ?? 0 }),
      /** the inside's measurements (ClawSpec), from the root */
      spec: () => claw.spec,
      /** where a player stands at the deck (on the floor) and the point of the machine they face, in the world */
      standPoint: () => {
        const wm = claw.root.computeWorldMatrix(true);
        const stand = Vector3.TransformCoordinates(Vector3.FromArray((claw.root.metadata as { stand: number[] }).stand), wm);
        return { stand: stand.asArray(), look: Vector3.TransformCoordinates(new Vector3(0, 1.2, 0), wm).asArray() };
      },
      /** the pickup door's middle, in the world */
      doorAt: () => {
        const S = claw.spec;
        return Vector3.TransformCoordinates(new Vector3((S.chute[0] + S.chute[1]) / 2, S.binY + 0.13, S.doorZ), claw.root.computeWorldMatrix(true)).asArray();
      },
      /** the play: its phase, timer, grip, the prizes behind the door, the last message, and whether the test's aim is set */
      state: () => ({ phase: claw.game.phase, timer: claw.game.timer, strength: claw.game.strength, inBin: claw.game.inBin(), message: store.get().claw?.message ?? "", aimed: claw.aimed }),
      display: () => (claw.game.phase === "aim" ? "timer" : claw.game.inBin().length ? "WIN!" : claw.game.busy ? "----" : "PLAY"),
      use: () => claw.use(),
      leave: () => claw.leave(),
      play: () => claw.play(),
      /** force every play's grip strength (0..1), or null for the machine's own payout */
      force: (s: number | null) => (claw.game.forceStrength = s),
      aimAtBest: () => claw.aimAtBest(),
      /** cut the credit timer to t seconds */
      fastTimer: (t: number) => (claw.game.timer = Math.min(claw.game.timer, t)),
      /** hold the joystick and button as given (null gives the keys back) */
      drive: (i: { x: number; z: number; drop: boolean } | null) => (claw.override = i),
      simulate: (n: number, strategy: "aim" | "random", strength: number | null) => claw.simulate(n, strategy, strength),
    },
    pinball: {
      /** the machines, by slot */
      machines: () => pinball.machines.map((m) => ({ slot: m.def.slot, id: m.def.id, name: m.def.title, flippers: m.def.flippers.length, player: m.player, high: m.high })),
      use: (slot: number) => pinball.use(slot),
      leave: () => pinball.leave(),
      start: () => pinball.start(),
      /** a control pressed or let go, as its key: ShiftLeft, ShiftRight, Space, KeyX, Period, ArrowUp, Enter */
      press: (slot: number, key: string, down: boolean) => {
        const m = pinball.machine(slot);
        if (m) pinball.input(m, key, down);
      },
      /** the table and game as they are: balls, flippers, plunger, score */
      state: (slot: number) => {
        const m = pinball.machine(slot);
        if (!m) return null;
        const { table, game } = m;
        return {
          balls: table.balls.map((b) => ({ mode: b.mode, x: b.x, y: b.y, h: b.h, vx: b.vx, vy: b.vy })),
          flippers: table.flippers.map((f) => ({ id: f.def.id, angle: f.angle, held: f.held })),
          plunger: table.plunger.pull,
          state: game.state,
          score: game.score,
          ball: game.ball,
          tilted: game.tilted,
          saving: game.saving,
          multiball: game.multiball,
          message: game.message?.top ?? null,
          lamps: Object.fromEntries(game.lamps),
          status: game.status,
        };
      },
      /** put a ball where a test wants it: [x, y] on the playfield and [vx, vy] */
      place: (slot: number, ball: number, at: [number, number], v: [number, number]) => {
        const b = pinball.machine(slot)?.table.balls[ball];
        if (!b) return;
        Object.assign(b, { mode: "free", x: at[0], y: at[1], px: at[0], py: at[1], vx: v[0], vy: v[1], h: 0.0135, still: 0 });
      },
      /** the pure physics and rules, for tests run in the page */
      lab: async () => ({ ...(await import("./pinballPhysics")), ...(await import("./pinballRules")), ...(await import("../world/props/pinballTables")) }),
      pose: (slot: number) => {
        const m = pinball.machine(slot);
        return m ? pinball.pose(m) : null;
      },
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
    snacks.update(dt);
    claw.update(dt);
    pinball.update(dt);
    airHockey.update();
    foosball.update(dt);
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
