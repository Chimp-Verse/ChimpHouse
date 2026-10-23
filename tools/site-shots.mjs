// Photographs the house for the welcome page (index.html): this visitor's chimp, seen from
// behind, in every room, written as web pictures into public/site/ (a wide one and a narrow one
// of each). Needs the dev server running with the builder's tools on (VITE_ENABLE_FLY_IN=true,
// see the README), so the camera can be put in each room.
//   node tools/site-shots.mjs [only,these,shots]
//   RAW=.evani-shot-site node tools/site-shots.mjs      also keeps each full-size PNG there
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const URL = process.env.URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "public/site";
const RAW = process.env.RAW;

// id: the picture's name; view: the viewpoint the chimp starts at (world/viewpoints.ts), or from:
// where it stands ([x, eye height, z] in the world) and look: the point [x, z] it faces; turn:
// radians the camera swings round the chimp from behind it; boom: the camera's distance behind the
// chimp; pitch: looking up (+) or down (-); fly: the camera alone, no chimp
const SHOTS = [
  { id: "courtyard", view: "front", turn: 0, boom: 3.2, pitch: 0.02 },
  { id: "front-night", view: "front-night", turn: 0, boom: 3.2, pitch: 0.02 },
  { id: "aerial", view: "aerial", fly: true },
  { id: "entry", view: "entry", turn: 0, boom: 2.8, pitch: 0.12 },
  { id: "lounge", from: [-13.7, 1.6, 4.2], look: [-9, 13], turn: 0.2, boom: 2.4, pitch: 0.06 },
  { id: "game", from: [12.3, 1.6, 4.2], look: [20.3, 6.7], turn: 0, boom: 2.4, pitch: 0.06 },
  { id: "trading", from: [-10.7, 1.6, 17.3], look: [-1.9, 22], turn: 0, boom: 1.9, pitch: 0.08 },
  { id: "mixchimp", view: "mixchimp", turn: 0, boom: 2.6, pitch: 0.06 },
  { id: "gallery", view: "gallery", turn: 0, boom: 2.6, pitch: 0.1 },
  { id: "showroom", from: [-9.5, 7.2, 5.5], look: [-9.4, 11.4], turn: 0, boom: 2.6, pitch: 0.06 },
  { id: "theatre", from: [-12.2, 7.2, 19], look: [-6, 20.8], turn: 0, boom: 2.4, pitch: 0.1 },
  { id: "bar", from: [11, 7.2, 9], look: [12, 17], turn: 0, boom: 2.4, pitch: 0.06 },
  { id: "pool", from: [14.5, 7.2, -1], look: [14.5, 9], turn: 0, boom: 2.6, pitch: -0.06 },
  { id: "bridge", view: "side", turn: 0, boom: 3.0, pitch: 0.04 },
  // the chimp itself, from in front, in the Game Room's light
  { id: "chimp", view: "game", turn: Math.PI + 0.35, boom: 1.9, pitch: 0.1 },
];

const only = process.argv[2]?.split(",");
const shots = only ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;
mkdirSync(OUT, { recursive: true });
if (RAW) mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = () => Promise.resolve();
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${URL}/house.html?capture=1&quality=high&name=Bongo`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  if (!(await page.evaluate(() => window.__chimp.flyIn))) throw new Error("the page has no fly-in camera: start the dev server with VITE_ENABLE_FLY_IN=true");
  // only the scene and the chimps' name tags: no panels
  await page.addStyleTag({ content: ".app > :not(.scene):not(.chimp-labels) { display: none !important; }" });
  await page.waitForFunction(() => !!window.__chimp.chimps.describe().mine && !window.__chimp.state().chimpBuilding, null, { timeout: 120000 });
  for (const s of shots) {
    // the way the chimp is to face: the viewpoint's, or towards `look`
    const want = await page.evaluate(async (s) => {
      const c = window.__chimp;
      c.setNight(!!s.night);
      c.setWalking(false);
      if (s.view) c.goTo(s.view);
      else {
        const [x, y, z] = s.from;
        c.setPose({ ...c.pose(), x, y, z, yaw: Math.atan2(s.look[0] - x, s.look[1] - z), pitch: 0 });
      }
      // the viewpoint's camera glides there: let it arrive before the chimp is stood under it
      await c.settle(150);
      const yaw = c.pose().yaw;
      if (!s.fly) c.setWalking(true);
      return yaw;
    }, s);
    if (!s.fly) {
      await page.waitForFunction(() => !!window.__chimp.chimps.describe().mine && !window.__chimp.state().chimpBuilding, null, { timeout: 120000 });
      await page.evaluate(
        async ([s, want]) => {
          const c = window.__chimp;
          // a chimp keeps its heading until it walks; seen from its own eyes it turns with the
          // camera, so look the wanted way from its eyes for a moment, then step back behind it
          c.chimps.toggleView();
          c.setPose({ ...c.pose(), yaw: want, pitch: 0 });
          await c.settle(10);
          c.chimps.toggleView();
          await c.settle(5);
          c.chimps.setBoom(s.boom);
          c.setPose({ ...c.pose(), yaw: want + s.turn, pitch: s.pitch });
        },
        [s, want],
      );
    }
    await page.evaluate(() => window.__chimp.whenReady());
    await page.evaluate(() => window.__chimp.settle(90));
    const png = await page.screenshot();
    if (RAW) await sharp(png).toFile(`${RAW}/${s.id}.png`);
    await sharp(png).resize(1600).webp({ quality: 78 }).toFile(`${OUT}/${s.id}.webp`);
    await sharp(png).resize(800).webp({ quality: 74 }).toFile(`${OUT}/${s.id}-800.webp`);
    console.log("shot", s.id);
  }
} finally {
  await stop();
}
