// Photographs the house for the welcome page (index.html), written as web pictures into
// public/site/ (a wide one and a narrow one of each). Every room is seen from the fly-in camera,
// up high or wide, with no chimp in the picture; only the "chimp" shot (the "Your chimp" card)
// shows this visitor's chimp. Needs the dev server running with the builder's tools on
// (VITE_ENABLE_FLY_IN=true, see the README), so the camera can fly and the roofs can be lifted.
//   node tools/site-shots.mjs [only,these,shots]
//   RAW=.evani-shot-site node tools/site-shots.mjs      also keeps each full-size PNG there
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const URL = process.env.URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "public/site";
const RAW = process.env.RAW;

// id: the picture's name. A fly shot is the camera alone, no chimp: at [x, y, z] in the world,
// yaw (degrees, 0 looks along +z, 90 along +x), pitch (degrees, + looks down), fov (radians,
// vertical); night: after dark; view: a viewpoint (world/viewpoints.ts) instead of a pose.
// The chimp shot stands this visitor's chimp at a viewpoint and swings the camera round in front
// of it: turn (radians from behind it), boom (the camera's distance), pitch (radians, + up).
const SHOTS = [
  // the courtyard from above the approach path: the fountain, the stairs and the whole house front
  { id: "courtyard", x: 0, y: 4.0, z: -31.5, yaw: 0, pitch: 5, fov: 1.0 },
  { id: "front-night", x: 0.5, y: 1.5, z: -30, yaw: 0, pitch: 2, fov: 1.0, night: true },
  { id: "aerial", view: "aerial" },
  // indoors, from a high corner (lower level: up near the 4.8 m ceiling; upper: near 10.4 m)
  { id: "entry", x: 2.8, y: 2.6, z: 0.3, yaw: -10, pitch: 6, fov: 1.3 },
  { id: "lounge", x: -5.5, y: 4.0, z: 1.5, yaw: -48, pitch: 18, fov: 1.3 },
  { id: "game", x: 7.5, y: 4.0, z: 1.0, yaw: 56, pitch: 18, fov: 1.3 },
  { id: "trading", x: -15, y: 4.2, z: 16.5, yaw: 80, pitch: 17, fov: 1.25 },
  { id: "mixchimp", x: 8.6, y: 4.0, z: 16.0, yaw: -15, pitch: 12, fov: 1.25 },
  { id: "gallery", x: 0, y: 9.8, z: 13, yaw: 180, pitch: 30, fov: 1.3 },
  { id: "showroom", x: -8.2, y: 9.6, z: 1.8, yaw: -38, pitch: 18, fov: 1.3 },
  { id: "theatre", x: -15.8, y: 9.4, z: 20.6, yaw: 90, pitch: 20, fov: 1.2 },
  { id: "bar", x: 7, y: 8.8, z: 13.6, yaw: 15, pitch: 12, fov: 1.25 },
  // a bird's-eye view over the terrace: the whole pool, the loungers and the fire pits
  { id: "pool", x: 8, y: 18, z: -8, yaw: 37, pitch: 38, fov: 1.0 },
  // from the jungle north of the bridge: its whole span reaching the side entrance
  { id: "bridge", x: -38, y: 6.5, z: 22, yaw: 128, pitch: 5, fov: 1.15 },
  // the chimp itself, from in front, in the Game Room's light
  { id: "chimp", chimp: true, view: "game", turn: Math.PI + 0.35, boom: 1.9, pitch: 0.1 },
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
  // only the scene: no panels, no name tags
  await page.addStyleTag({ content: ".app > :not(.scene) { display: none !important; }" });
  for (const s of shots) {
    if (s.chimp) await chimpShot(page, s);
    else await flyShot(page, s);
    await page.evaluate(() => window.__chimp.whenReady());
    await page.evaluate(() => window.__chimp.settle(90));
    // nobody else in the picture: a visitor in the house at the same time would be
    const others = await page.evaluate(() => window.__chimp.chimps.describe().others.length);
    if (others && !s.chimp) console.log(`warning: ${others} other chimp(s) in the house while taking ${s.id}`);
    const png = await page.screenshot();
    if (RAW) await sharp(png).toFile(`${RAW}/${s.id}.png`);
    await sharp(png).resize(1600).webp({ quality: 78 }).toFile(`${OUT}/${s.id}.webp`);
    await sharp(png).resize(800).webp({ quality: 74 }).toFile(`${OUT}/${s.id}-800.webp`);
    console.log("shot", s.id);
  }
} finally {
  await stop();
}

/** The fly-in camera alone: this visitor's chimp is only drawn while walking. */
async function flyShot(page, s) {
  await page.evaluate(async (s) => {
    const c = window.__chimp;
    c.setNight(!!s.night);
    c.setWalking(false);
    if (s.view) c.goTo(s.view);
    else {
      const d = Math.PI / 180;
      c.setPose({ x: s.x, y: s.y, z: s.z, yaw: s.yaw * d, pitch: s.pitch * d, fov: s.fov });
    }
    // a viewpoint's camera glides there
    await c.settle(s.view ? 150 : 20);
  }, s);
}

/** This visitor's chimp at a viewpoint, the camera swung round in front of it. */
async function chimpShot(page, s) {
  const want = await page.evaluate(async (s) => {
    const c = window.__chimp;
    c.setNight(!!s.night);
    c.setWalking(false);
    c.goTo(s.view);
    // the viewpoint's camera glides there: let it arrive before the chimp is stood under it
    await c.settle(150);
    const yaw = c.pose().yaw;
    c.setWalking(true);
    return yaw;
  }, s);
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
