// Arriving as your chimp, in a real browser against the running preview (npm run dev):
//   1. the page opens straight into this visitor's chimp, walking, at the spawn point in the
//      front courtyard (outside the house, on the paving in front of it), the camera behind it,
//      the fountain running in front of it
//   2. without the fly-in camera (engine/devFlags.ts) nothing reaches it: not F, the viewpoint
//      keys, the side panel, the automation hook (__chimp) from the console, ?view= / ?pose= in
//      the address, nor a camera saved in localStorage; nor are the builder's tools there (inspect
//      and Alt-click, copy view details, room download and the export hooks, the R / U cutaways,
//      the position and fps readout)
//   3. from the spawn: W walks, V switches to the chimp's eyes and back, the wheel brings the
//      camera in and out, C opens and closes the wardrobe, and walking up to a cabinet and E
//      plays its game (the stand-in), Quit game walks on
// Screenshots: captures/spawn-*.png (SHOTS=<dir> puts them elsewhere). Exits non-zero when a check fails.
//   node tools/test-spawn.mjs                       a dev server without the flag (the default)
//   EXPECT=fly node tools/test-spawn.mjs            a dev server with VITE_ENABLE_FLY_IN=true: checks
//                                                   only that fly-in and the builder's tools are there
//   URL=http://localhost:5191 picks the dev server.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? "captures";
const EXPECT_FLY = process.env.EXPECT === "fly";
const SLOT = 3;
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // a headless page never takes the real mouse or keyboard
  await context.addInitScript(() => {
    Element.prototype.requestPointerLock = function () {
      return Promise.resolve();
    };
    Element.prototype.requestFullscreen = function () {
      return Promise.resolve();
    };
    if (navigator.keyboard) navigator.keyboard.lock = () => Promise.resolve();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
  const settle = (n = 10) => ev((n) => window.__chimp.settle(n), n);
  const shot = (name) => page.screenshot({ path: `${SHOTS}/spawn-${name}.png` });
  const open = async (query) => {
    await page.goto(`${URL}/?quality=low&arcade=standin${query}`);
    await waitFor(() => window.__chimp?.ready === true, null, 300000);
    await waitFor(() => !!window.__chimp.chimps.describe().mine?.shown, null, 60000).catch(() => undefined);
    await settle(20);
  };
  const state = () =>
    ev(() => {
      const c = window.__chimp;
      const s = c.state();
      const cam = c.pose();
      const eye = c.chimps.eye().at;
      return { walking: s.walking, viewId: s.viewId, area: s.area, firstPerson: s.firstPerson, wardrobe: s.wardrobe, ortho: !!cam.ortho, cam, eye, back: Math.hypot(cam.x - eye[0], cam.y - eye[1], cam.z - eye[2]) };
    });

  // the front courtyard (world/layout.ts COURTYARD): a round court round (0, -17), 9.6 m from its middle to its
  // edge, south of the front stair's foot (z -7.27), the house's front wall further north still
  const inCourtyard = (eye) => Math.hypot(eye[0], eye[2] + 17) < 9.6 && eye[2] < -7.3;
  const fountain = () => ev(() => window.__chimp.fountain());

  // what of the builder's tools (engine/devFlags.ts DEV_TOOLS_ENABLED) the page shows
  const builderTools = () =>
    ev(() => ({
      status: document.querySelector(".panel.status")?.textContent ?? "",
      coords: !!document.querySelector(".panel.status .coords"),
      perf: !!document.querySelector(".panel.status .perf"),
      previewTag: !!document.querySelector(".panel.status .title span"),
      hint: document.querySelector(".hint")?.textContent ?? "",
      panel: document.querySelector(".panel.views")?.textContent ?? "",
      hooks: ["downloadRoom", "downloadZone", "auditZone", "houseScene", "zones"].filter((k) => typeof window.__chimp[k] === "function"),
    }));

  if (EXPECT_FLY) {
    // ------------------------------------------------ with the flag: fly-in is there
    await open("");
    check(await ev(() => window.__chimp.flyIn), "the page has the fly-in camera");
    const s0 = await state();
    check(s0.walking, "without ?view= it still arrives as the chimp", s0.area);
    check(/courtyard/i.test(s0.area) && inCourtyard(s0.eye), "in the front courtyard, outside the house", `${s0.area}, eye ${s0.eye.map((v) => v.toFixed(1)).join(", ")}`);
    // the builder's tools are there with the same flag
    const tools = await builderTools();
    check(/Night/.test(tools.panel) && /Hide roofs/.test(tools.panel) && /Hide upper level/.test(tools.panel) && /Inspect on click/.test(tools.panel) && /Copy view details/.test(tools.panel) && /Download this room/.test(tools.panel), "the side panel has night, the cutaways, inspect, copy and download");
    check(tools.coords && tools.perf && tools.previewTag, "the status panel shows the position, fps and draws", tools.status);
    check(/Alt-click/.test(tools.hint), "the controls line mentions Alt-click inspect");
    check(tools.hooks.length === 5, "the console hook has the export tools", tools.hooks.join(", "));
    const zones = await ev(() => window.__chimp.zones().length);
    check(zones > 5, "and they answer", `${zones} zones`);
    for (const k of ["KeyR", "KeyU", "KeyI"]) await page.keyboard.press(k);
    await settle(5);
    await page.keyboard.press("KeyU");
    await page.keyboard.down("AltLeft");
    await page.mouse.click(640, 300);
    await page.keyboard.up("AltLeft");
    await settle(5);
    const keyed = await ev(() => {
      const s = window.__chimp.state();
      return { roof: s.roofHidden, inspect: s.inspectMode, picked: s.picked?.label ?? null };
    });
    check(keyed.roof && keyed.inspect && !!keyed.picked, "R hides the roofs, I and Alt-click inspect", JSON.stringify(keyed));
    for (const k of ["KeyR", "KeyI"]) await page.keyboard.press(k);
    await page.keyboard.press("KeyF");
    await settle(5);
    check(!(await state()).walking, "F flies");
    check((await page.locator(".panel.views .section", { hasText: "Viewpoints" }).count()) === 1, "the side panel lists the viewpoints");
    await open("&view=aerial");
    const s1 = await state();
    check(!s1.walking && s1.viewId === "aerial", "?view=aerial opens flying at that viewpoint", `walking ${s1.walking}, view ${s1.viewId}`);
  } else {
    // ------------------------------------------------ 1. arriving
    await open("");
    check(!(await ev(() => window.__chimp.flyIn)), "the page has no fly-in camera");
    const s0 = await state();
    const mine = await ev(() => window.__chimp.chimps.describe().mine);
    check(s0.walking && mine?.shown, "it opens walking as this visitor's chimp, with no step before it");
    check(/courtyard/i.test(s0.area), "at the spawn point in the front courtyard", s0.area);
    check(inCourtyard(s0.eye), "its eyes outside the house, on the courtyard's paving", s0.eye.map((v) => v.toFixed(2)).join(", "));
    const f0 = await fountain();
    check(f0.built && f0.spraying && f0.particles > 0, "the fountain runs in front of it", JSON.stringify(f0));
    check(!s0.firstPerson && s0.back > 0.8, "the camera behind the chimp", `${s0.back.toFixed(2)} m from its eyes`);
    await shot("arrived");

    // ------------------------------------------------ 2. fly-in can't be reached
    const at = (s) => `${s.cam.x.toFixed(2)}, ${s.cam.z.toFixed(2)}`;
    for (const k of ["KeyF", "Digit1", "Digit5", "BracketRight", "BracketLeft", "KeyG"]) await page.keyboard.press(k);
    await settle(10);
    // those key presses were the visitor's first: the fountain's sound starts (heard in-page only: the browser is muted)
    const heard = await waitFor(() => window.__chimp.fountain().sound.playing, null, 10000).then(() => true, () => false);
    const f1 = await fountain();
    check(heard && f1.sound.level > 0.5, "the fountain is heard at the spawn, after the first key press", JSON.stringify(f1.sound));
    const s1 = await state();
    check(s1.walking && s1.viewId === null && Math.hypot(s1.eye[0] - s0.eye[0], s1.eye[2] - s0.eye[2]) < 0.05, "F, 1, 5, [ ] and G do nothing: still walking where it arrived", `at ${at(s1)}`);
    const panel = await ev(() => document.querySelector(".panel.views")?.textContent ?? "");
    check(!/Viewpoints|Walk mode|Front exterior|Aerial overview|Floor-plan/.test(panel), "the side panel has no viewpoints, walk/fly switch or plan overlay");
    await page.keyboard.press("KeyH");
    const help = await ev(() => document.querySelector(".help-card")?.textContent ?? "");
    check(!!help && !/Fly forward|Jump to viewpoints|base speed/.test(help), "the help card has no flying keys");
    await page.keyboard.press("KeyH");
    // the builder's tools: none shows, answers its key or is on the console hook
    const tools = await builderTools();
    check(!/Night|Hide roofs|Hide upper level|Inspect on click|Copy view details|Download this room/.test(panel), "the side panel has no night switch, cutaways, inspect, copy or download");
    check(!tools.coords && !tools.perf && !tools.previewTag && /courtyard/i.test(tools.status), "the status panel shows only ChimpHouse and the room", tools.status);
    check(!/Alt-click|inspect/i.test(tools.hint), "the controls line doesn't mention inspecting", tools.hint);
    check(!/Inspect|Hide roofs|Day \/ night|Copy viewpoint|press P/.test(help), "the help card has no builder's tools");
    check(tools.hooks.length === 0, "the console hook has no export tools", tools.hooks.join(", "));
    for (const k of ["KeyN", "KeyR", "KeyU", "KeyI", "KeyP"]) await page.keyboard.press(k);
    await page.keyboard.down("AltLeft");
    await page.mouse.click(640, 300);
    await page.keyboard.up("AltLeft");
    await settle(5);
    const keyed = await ev(() => {
      const s = window.__chimp.state();
      return { night: s.night, roof: s.roofHidden, upper: s.upperHidden, inspect: s.inspectMode, picked: s.picked, toast: s.toast };
    });
    check(!keyed.night && !keyed.roof && !keyed.upper && !keyed.inspect && !keyed.picked && !/Copied|Clipboard/.test(keyed.toast ?? ""), "N, R, U, I, P and Alt-click do nothing", JSON.stringify(keyed));
    const hook = await ev(async () => {
      const c = window.__chimp;
      c.setWalking(false);
      c.goTo("aerial");
      c.goTo("plan-lower");
      c.setPose({ x: 0, y: 120, z: 0, yaw: 0, pitch: Math.PI / 2, fov: 0.8, ortho: { cx: 0, cz: 0, halfHeight: 30 } });
      await c.settle(10);
      return { views: c.views().length, mode: c.scene.activeCamera.mode };
    });
    const s2 = await state();
    check(s2.walking && !s2.ortho && hook.mode === 0 && s2.viewId === null && hook.views === 0, "from the console, setWalking(false), goTo() and a plan pose do nothing", JSON.stringify({ ...hook, walking: s2.walking, view: s2.viewId }));

    // ------------------------------------------------ 3. walking
    const w0 = (await state()).eye;
    await page.keyboard.down("KeyW");
    await sleep(1200);
    await page.keyboard.up("KeyW");
    await sleep(400);
    const w1 = (await state()).eye;
    const walked = Math.hypot(w1[0] - w0[0], w1[2] - w0[2]);
    check(walked > 1, "W walks the chimp", `${walked.toFixed(2)} m`);
    await shot("walked");

    // V and back, the wheel
    await page.keyboard.press("KeyV");
    await settle(5);
    const v1 = await state();
    check(v1.firstPerson && v1.back < 0.01, "V: from the chimp's eyes");
    await page.keyboard.press("KeyV");
    await settle(30);
    const v2 = await state();
    check(!v2.firstPerson && v2.back > 0.8, "V again: behind it", `${v2.back.toFixed(2)} m`);
    await page.mouse.move(640, 400);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200);
    await settle(60);
    const v3 = await state();
    check(v3.back > v2.back + 0.3, "the wheel takes the camera further out", `${v2.back.toFixed(2)} → ${v3.back.toFixed(2)} m`);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
    await settle(60);
    const v4 = await state();
    check(v4.back < v3.back - 0.3, "and brings it back in", `${v3.back.toFixed(2)} → ${v4.back.toFixed(2)} m`);

    // C: the wardrobe
    await page.keyboard.press("KeyC");
    await sleep(1100);
    const c1 = await state();
    const panelShown = await page.locator(".wardrobe-tabs").count();
    check(c1.wardrobe && panelShown > 0, "C opens the wardrobe and its panel");
    await shot("wardrobe");
    await page.keyboard.press("KeyC");
    await settle(10);
    check(!(await state()).wardrobe && (await state()).walking, "C again closes it, walking on");

    // ------------------------------------------------ 4. an arcade cabinet
    await ev(() => window.__chimp.arcade.ready());
    const hasGame = await ev((n) => window.__chimp.arcade.slots().includes(n), SLOT);
    if (!hasGame) check(false, `a game in cabinet slot ${SLOT}`);
    else {
      // the test's own shortcut across the house: stand 3.6 m in front of the cabinet, facing it
      await ev((n) => {
        const c = window.__chimp;
        const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
        const wm = node.computeWorldMatrix(true);
        const V = node.position.constructor;
        const start = V.TransformCoordinates(new V(0.25, 1.6, -3.6), wm);
        const look = V.TransformCoordinates(new V(0, 1.2, 0), wm);
        c.setPose({ x: start.x, y: start.y, z: start.z, yaw: Math.atan2(look.x - start.x, look.z - start.z), pitch: 0.12, fov: 1.15 });
        c.setWalking(true);
      }, SLOT);
      await settle(10);
      await page.keyboard.down("KeyW");
      const offered = await waitFor((n) => window.__chimp.state().arcadePrompt?.slot === n, SLOT, 8000).then(() => true, () => false);
      await page.keyboard.up("KeyW");
      await settle(10);
      check(offered, "walking up to a cabinet offers its game", JSON.stringify(await ev(() => window.__chimp.state().arcadePrompt)));
      await page.keyboard.press("KeyE");
      const playing = await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!document.querySelector("iframe.play-frame"), null, 8000).then(() => true, () => false);
      await settle(10);
      check(playing, "E plays it: the game's frame is over the screen", JSON.stringify(await ev(() => window.__chimp.state().focus)));
      await shot("playing");
      if (playing) {
        // Quit game ends it (Step back, the other button, leaves it running on the cabinet: tools/test-arcade.mjs)
        await page.click(".focus-bar .leave.quit");
        await waitFor(() => window.__chimp.state().focus === null, null, 8000).catch(() => undefined);
        await settle(10);
        check((await state()).walking && (await page.locator("iframe.play-frame").count()) === 0, "Quit game walks on as the chimp, the game closed");
      }
    }

    // ------------------------------------------------ 5. the address and a saved camera
    await ev(() => localStorage.setItem("chimphouse.pose.v1", JSON.stringify({ x: -54, y: 30, z: -60, yaw: 0.7, pitch: 0.5, fov: 0.85, ortho: null })));
    const pose = encodeURIComponent(JSON.stringify({ x: -54, y: 30, z: -60, yaw: 0.7, pitch: 0.5, fov: 0.85 }));
    await open(`&view=aerial&pose=${pose}&capture=1`);
    const s3 = await state();
    check(s3.walking && s3.viewId === null && /courtyard/i.test(s3.area) && inCourtyard(s3.eye), "?view=, ?pose= and a saved camera are ignored: it arrives at the spawn point, walking", `${s3.area}, walking ${s3.walking}, view ${s3.viewId}`);
  }
} finally {
  await stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
