// The chimp avatar in the house, in a real browser against the running preview
// (npm run dev):
//   1. walking builds this visitor's chimp, stands it where the walker is, and gives the
//      walker the chimp's eye height; the camera sits behind it (third person)
//   2. walking forward (W) moves the chimp and turns it the way it goes; running (Shift)
//   3. the camera pulls in from a wall behind the chimp rather than going through it
//   4. V switches to the chimp's own eyes (the chimp isn't drawn) and back
//   5. the wardrobe (C) swings the camera round in front of the chimp, and holds it still
//   6. a change of colour takes at once; a change of shape rebuilds the chimp
// and the chimp is lit by its own copies of the room lights, the house's left alone
// Screenshots: captures/chimp-*.png. Exits non-zero when a check fails.
//   node tools/test-chimp.mjs        (VIEW=lounge to start elsewhere)
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const VIEW = process.env.VIEW ?? "entry";
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
  const shot = (name) => page.screenshot({ path: `captures/chimp-${name}.png` });
  const mine = () => ev(() => window.__chimp.chimps.describe().mine);
  // this visitor's chimp's draw calls over a few frames: how many of its meshes were drawn, and any
  // WebGL refused (INVALID_OPERATION and the like: the mesh silently isn't there)
  const draws = () =>
    ev(() => {
      const s = window.__chimp.scene;
      const g = s.getEngine()._gl;
      const drawn = new Set();
      const refused = new Set();
      let current = null;
      const obs = s.meshes.filter((m) => m.name.startsWith("My chimp")).map((m) => [m, m.onBeforeRenderObservable.add(() => (current = m))]);
      const orig = {};
      for (const fn of ["drawElements", "drawElementsInstanced"]) {
        orig[fn] = g[fn];
        g[fn] = (...args) => {
          const m = current;
          current = null;
          if (!m) return orig[fn].apply(g, args);
          while (g.getError() !== g.NO_ERROR);
          orig[fn].apply(g, args);
          (g.getError() === g.NO_ERROR ? drawn : refused).add(m.name);
        };
      }
      return new Promise((done) => {
        let f = 0;
        const o = s.onAfterRenderObservable.add(() => {
          if (++f < 4) return;
          s.onAfterRenderObservable.remove(o);
          for (const fn of Object.keys(orig)) g[fn] = orig[fn];
          for (const [m, ob] of obs) m.onBeforeRenderObservable.remove(ob);
          done({ drawn: drawn.size, refused: [...refused] });
        });
      });
    });

  // the cabinets from the local list: ChimpVibe's own can be empty, leaving no cabinet to walk up to
  await page.goto(`${URL}/?view=${VIEW}&arcade=fixture`);
  await waitFor(() => window.__chimp?.ready === true, null, 300000);
  await sleep(300);

  // ------------------------------------------------ 1. walking as the chimp
  await ev(() => window.__chimp.setWalking(true));
  await waitFor(() => !!window.__chimp.chimps.describe().mine, null, 60000);
  await ev(() => window.__chimp.settle(30));
  const m0 = await mine();
  const w0 = await ev(() => {
    const w = window.__chimp.walker();
    return { feet: [w.feet.x, w.feet.y, w.feet.z], eye: w.eye };
  });
  check(m0.shown, "walking shows this visitor's chimp");
  check(Math.hypot(m0.at[0] - w0.feet[0], m0.at[2] - w0.feet[2]) < 0.05, "the chimp stands where the walker is", `chimp ${m0.at.map((v) => v.toFixed(2))} walker ${w0.feet.map((v) => v.toFixed(2))}`);
  check(w0.eye > 1.1 && w0.eye < 1.45, "the walker sees from the chimp's eye height", `${w0.eye.toFixed(2)} m`);
  const cam0 = await ev(() => ({ cam: window.__chimp.pose(), eye: window.__chimp.chimps.eye() }));
  const behind = Math.hypot(cam0.cam.x - cam0.eye.at[0], cam0.cam.z - cam0.eye.at[2]);
  check(behind > 0.4, "the camera is behind the chimp, not at its eyes", `${behind.toFixed(2)} m back`);
  await shot("idle");

  // ------------------------------------------------ 2. walking and running
  const start = await mine();
  await page.keyboard.down("KeyW");
  await sleep(1200);
  await shot("walk");
  await page.keyboard.up("KeyW");
  await sleep(400);
  const walked = await mine();
  const moved = Math.hypot(walked.at[0] - start.at[0], walked.at[2] - start.at[2]);
  check(moved > 1.0, "W walks the chimp forward", `${moved.toFixed(2)} m`);
  const pose = await ev(() => window.__chimp.pose());
  const dYaw = Math.abs(Math.atan2(Math.sin(walked.facing - pose.yaw), Math.cos(walked.facing - pose.yaw)));
  check(dYaw < 0.3, "it turns to face the way it walks (the camera's way)", `${dYaw.toFixed(2)} rad off`);
  // turn the camera right and walk: the chimp turns to the new way
  await ev(() => {
    const p = window.__chimp.pose();
    window.__chimp.setPose({ ...p, yaw: p.yaw + Math.PI / 2 });
  });
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  await sleep(900);
  await shot("run");
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  await sleep(600);
  const ran = await mine();
  const pose2 = await ev(() => window.__chimp.pose());
  const dYaw2 = Math.abs(Math.atan2(Math.sin(ran.facing - pose2.yaw), Math.cos(ran.facing - pose2.yaw)));
  check(dYaw2 < 0.3, "it turns when the way changes, and runs with Shift", `${dYaw2.toFixed(2)} rad off`);

  // ------------------------------------------------ 3. the camera stays out of walls
  const wallTest = await ev(async () => {
    const c = window.__chimp;
    const w = c.walker();
    // look along each of eight headings; the camera's boom must never pass through anything solid
    const out = [];
    for (let i = 0; i < 8; i++) {
      const p = c.pose();
      c.setPose({ ...p, yaw: (i / 8) * Math.PI * 2, pitch: 0.1 });
      await c.settle(3);
      const cam = c.pose();
      const pivot = [w.feet.x, w.groundY + 1.6, w.feet.z];
      const d = [cam.x - pivot[0], cam.y - pivot[1], cam.z - pivot[2]];
      const len = Math.hypot(...d);
      const free = w.world.raycast(pivot[0], pivot[1], pivot[2], d[0] / len, d[1] / len, d[2] / len, len + 1);
      out.push({ boom: +len.toFixed(2), free: +free.toFixed(2) });
    }
    return out;
  });
  check(wallTest.every((t) => t.boom <= t.free + 0.02), "the camera never sits beyond a wall behind the chimp", JSON.stringify(wallTest));

  // ------------------------------------------------ 4. first person and back
  await ev(() => window.__chimp.chimps.toggleView());
  await ev(() => window.__chimp.settle(5));
  const fp = await ev(() => ({ s: window.__chimp.state().firstPerson, mine: window.__chimp.chimps.describe().mine, cam: window.__chimp.pose(), eye: window.__chimp.chimps.eye() }));
  check(fp.s && !fp.mine.shown, "V sees from the chimp's eyes, and the chimp isn't drawn");
  check(Math.hypot(fp.cam.x - fp.eye.at[0], fp.cam.y - fp.eye.at[1], fp.cam.z - fp.eye.at[2]) < 0.01, "first person: the camera is at the eyes");
  await ev(() => window.__chimp.chimps.toggleView());
  await ev(() => window.__chimp.settle(5));
  check(!(await ev(() => window.__chimp.state().firstPerson)) && (await mine()).shown, "V again: back behind the chimp");

  // ------------------------------------------------ 5. the wardrobe
  await ev(() => window.__chimp.chimps.wardrobe(true));
  await sleep(1100);
  const wr = await ev(() => ({ open: window.__chimp.state().wardrobe, mine: window.__chimp.chimps.describe().mine, cam: window.__chimp.pose() }));
  const toCam = Math.atan2(wr.cam.x - wr.mine.at[0], wr.cam.z - wr.mine.at[2]);
  const front = Math.abs(Math.atan2(Math.sin(toCam - wr.mine.facing), Math.cos(toCam - wr.mine.facing)));
  check(wr.open && front < 0.8, "the wardrobe swings the camera round in front of the chimp", `${front.toFixed(2)} rad from its front`);
  await shot("wardrobe");
  const before = (await mine()).at;
  await page.keyboard.down("KeyW");
  await sleep(500);
  await page.keyboard.up("KeyW");
  const after = (await mine()).at;
  check(Math.hypot(after[0] - before[0], after[2] - before[2]) < 0.02, "with the wardrobe open, the chimp stands still");

  // ------------------------------------------------ 5a. dressing it from the wardrobe's panel
  await page.click(".wardrobe-tabs button:has-text('Clothes')");
  await page.click(".wardrobe-slot:has-text('Head') button:has-text('Cap')");
  await page.click(".wardrobe-slot:has-text('Top') button:has-text('ChimpVibe tee')");
  await page.click(".wardrobe-slot:has-text('Back') button:has-text('Backpack')");
  await waitFor(() => {
    const w = window.__chimp.chimps.describe().mine?.wearing ?? {};
    return w.head === "cap" && w.top === "tee" && w.back === "backpack";
  }, null, 60000);
  check(true, "the wardrobe's panel dresses the chimp: a cap, a tee, a backpack");
  await ev(() => window.__chimp.settle(10));
  await shot("dressed");
  const kept = await ev(() => JSON.parse(localStorage.getItem("chimphouse.chimp.v1") ?? "{}").outfit ?? {});
  check(kept.head?.id === "cap" && kept.top?.id === "tee", "and the outfit is kept for the next visit");
  await page.click(".wardrobe-slot:has-text('Head') button:has-text('None')");
  await page.click(".wardrobe-slot:has-text('Top') button:has-text('None')");
  await page.click(".wardrobe-slot:has-text('Back') button:has-text('None')");
  await waitFor(() => Object.keys(window.__chimp.chimps.describe().mine?.wearing ?? {}).length === 0, null, 20000);
  check(true, "and takes it all off again");

  // every item can be worn: two outfits that between them put on all twelve, each made in the workers
  const bare = await ev(() => window.__chimp.chimps.dna());
  for (const [label, outfit] of [
    ["headphones, shades, chain, hoodie, shorts, backpack, watch", { head: "headphones", eyes: "shades", neck: "chain", top: "hoodie", bottom: "shorts", back: "backpack", wrist: "watch" }],
    ["beanie, glasses, bandana, tee", { head: "beanie", eyes: "specs", neck: "bandana", top: "tee" }],
  ]) {
    const want = Object.fromEntries(Object.entries(outfit).map(([slot, id]) => [slot, { id, colors: [] }]));
    await ev(([d, o]) => window.__chimp.chimps.setDna({ ...d, outfit: o }), [bare, want]);
    const worn = await waitFor((o) => {
      const w = window.__chimp.chimps.describe().mine?.wearing ?? {};
      return Object.entries(o).every(([slot, id]) => w[slot] === id) && w;
    }, outfit, 60000).then((h) => h.jsonValue()).catch(() => null);
    check(!!worn, `it wears ${label}`, JSON.stringify(worn));
    await ev(() => window.__chimp.settle(8));
    const d = await draws();
    check(d.drawn > 20 && d.refused.length === 0, "and every piece of it is drawn", `${d.drawn} meshes drawn${d.refused.length ? `; refused: ${d.refused.join(", ")}` : ""}`);
  }
  await ev(() => window.__chimp.settle(10));
  await shot("outfit");
  await ev((d) => window.__chimp.chimps.setDna(d), bare);
  await waitFor(() => Object.keys(window.__chimp.chimps.describe().mine?.wearing ?? {}).length === 0, null, 20000);

  // a preset makes the chimp over, in the clothes it has on
  const plain = await ev(() => window.__chimp.chimps.dna());
  await page.click(".wardrobe-slot:has-text('Head') button:has-text('Beanie')");
  await waitFor(() => window.__chimp.chimps.describe().mine?.wearing?.head === "beanie", null, 60000);
  await page.click(".wardrobe-tabs button:has-text('Body')");
  await page.click(".wardrobe-row:has-text('Start from') button:has-text('Golden')");
  await waitFor(() => {
    const c = window.__chimp;
    return !c.state().chimpBuilding && c.chimps.dna().colors.fur === "#7a5236" && c.chimps.describe().mine?.wearing?.head === "beanie";
  }, null, 60000).catch(() => undefined);
  const golden = await ev(() => ({ dna: window.__chimp.chimps.dna(), wearing: window.__chimp.chimps.describe().mine?.wearing ?? {} }));
  check(golden.dna.colors.fur === "#7a5236" && golden.dna.colors.furTips === "#c9a06a" && golden.wearing.head === "beanie", "a preset makes the chimp over, in the same clothes", `fur ${golden.dna.colors.fur}, tips ${golden.dna.colors.furTips}, wearing ${JSON.stringify(golden.wearing)}`);
  await ev(() => window.__chimp.settle(10));
  await shot("preset");
  await ev((d) => window.__chimp.chimps.setDna(d), plain);
  await waitFor(() => !window.__chimp.state().chimpBuilding && !window.__chimp.chimps.describe().mine?.wearing?.head, null, 60000);

  // ------------------------------------------------ 5b. reach from the chimp, not the camera behind it
  await ev(() => window.__chimp.chimps.wardrobe(false));
  const cab = await ev(async () => {
    const c = window.__chimp;
    await c.arcade.ready();
    const slot = c.scene.transformNodes.find((n) => n.metadata?.role === "cabinet-slot" && c.arcade.games().some((g) => g.slot === n.metadata.slot));
    if (!slot) return null;
    const wm = slot.computeWorldMatrix(true);
    const BABYLON = slot.position.constructor;
    const stand = BABYLON.TransformCoordinates(BABYLON.FromArray(slot.metadata.stand), wm);
    const screen = BABYLON.TransformCoordinates(new BABYLON(0, 1.4, 0), wm);
    const w = c.walker();
    w.place(stand.x, stand.y + 0.5, stand.z, 2);
    // the camera behind the chimp, looking at the cabinet over its head
    const yaw = Math.atan2(screen.x - stand.x, screen.z - stand.z);
    c.setPose({ ...c.pose(), yaw, pitch: 0.12 });
    await c.settle(10);
    const cam = c.pose();
    return { slot: slot.metadata.slot, prompt: c.state().arcadePrompt, camBack: Math.hypot(cam.x - stand.x, cam.z - stand.z) };
  });
  if (cab) {
    check(cab.camBack > 0.8, "at a cabinet, the camera is well behind the chimp", `${cab.camBack.toFixed(2)} m`);
    check(cab.prompt?.slot === cab.slot, "and the cabinet in front of the chimp offers to play (reach is the chimp's)", JSON.stringify(cab.prompt));
    await shot("cabinet");
    // at night, in the Game Room: its lamps light the chimp, through copies of them
    await ev(() => window.__chimp.setNight(true));
    await ev(() => window.__chimp.settle(5));
    const lit = (await mine()).lights;
    check(!!lit.room && lit.copied[0] > 0, "the chimp is lit by copies of the room's lights where it stands", JSON.stringify(lit));
    await shot("cabinet-night");
    await ev(() => window.__chimp.setNight(false));
  } else console.log("SKIP  no cabinet in the Game Room to walk up to");

  // what each of the house's room lights lights (the cabinets in by now): the chimp's walk must leave these alone
  const roomLists = () => ev(() => window.__chimp.scene.lights.filter((l) => l.name === "roomLight" || l.name === "roomSpot").map((l) => l.includedOnlyMeshes.length).join(","));
  const lists0 = await roomLists();

  // ------------------------------------------------ 5c. feet on the steps of the main stair
  const stair = await ev(() => window.__chimp.chimps.stair());
  const flights = [stair.x0 + stair.flight / 2, stair.x1 - stair.flight / 2];
  let climbed = null;
  for (const x of flights) {
    // at the foot of a flight, facing up it (north), walking slowly up a few steps
    const start = await ev(([x, z]) => {
      const c = window.__chimp;
      c.walker().place(x, 1.5, z, 3);
      c.setPose({ ...c.pose(), yaw: 0, pitch: 0.15 });
      return c.walker().feet.y;
    }, [x, stair.z0 - 0.5]);
    await page.keyboard.down("AltLeft");
    await page.keyboard.down("KeyW");
    await sleep(1800);
    await page.keyboard.up("KeyW");
    await page.keyboard.up("AltLeft");
    await sleep(900);
    const up = (await ev(() => window.__chimp.walker().feet.y)) - start;
    if (up > 0.5) {
      climbed = { x, up };
      break;
    }
  }
  check(!!climbed, "the chimp climbs the main stair", climbed ? `${climbed.up.toFixed(2)} m up` : "neither flight rose");
  if (climbed) {
    const feet = await ev(() => window.__chimp.chimps.feet());
    // each ankle about its own height over the step under it (7 cm at rest, scaled), not floating or sunk a riser
    const gaps = feet.map((f) => (f.ankle - f.ground) / f.scale);
    check(gaps.every((g) => g > 0.02 && g < 0.13), "standing on the stair, each foot is on the step under it", gaps.map((g) => `${(g * 100).toFixed(0)} cm`).join(", "));
    await shot("stair");
  }

  check((await roomLists()) === lists0, "walking from room to room leaves the house's lights as they were");

  // ------------------------------------------------ 6. changing the chimp
  const dna = await ev(() => window.__chimp.chimps.dna());
  await ev((d) => window.__chimp.chimps.setDna({ ...d, colors: { ...d.colors, fur: "#a87b52" } }), dna);
  check(!(await ev(() => window.__chimp.state().chimpBuilding)), "a new colour needs no rebuild");
  await ev((d) => window.__chimp.chimps.setDna({ ...d, shape: { ...d.shape, build: 0.95, ears: 1 } }), dna);
  await waitFor(() => !window.__chimp.state().chimpBuilding, null, 60000);
  await ev(() => window.__chimp.settle(10));
  check((await mine()).shown, "a new shape rebuilds the chimp and shows it");
  await shot("reshaped");
  // back as it was
  await ev((d) => window.__chimp.chimps.setDna(d), dna);
  await ev(() => window.__chimp.chimps.wardrobe(false));
  const info = await ev(() => window.__chimp.info());
  console.log(`info: ${info.fps} fps, ${info.drawCalls} draw calls`);
} finally {
  await stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
