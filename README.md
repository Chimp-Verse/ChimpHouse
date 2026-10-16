# ChimpHouse 3D preview

A fly-through preview of ChimpHouse, built from `chimphouse-description.md` and the concept art in `Reference Images/`. It uses the stack recommended in `docs/research/2026-10-01-chimpverse-technology-stack.md`: TypeScript, Vite and a React DOM HUD around a Babylon.js (WebGL2) scene.

This is a look-and-layout preview, with the first room activities (the arcade, the theatre, the Game Room's machines) and chimp avatars: every visitor walks the house as a chimp they shape and dress, and sees every other visitor's. There is no voice yet. The house, its furniture, its jungle setting and the chimps are generated procedurally in code, so changes are quick to make and hot-reload in the browser.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

The first load takes a few seconds while textures are painted and shaders compile.

## Flying around

| Input | Action |
| --- | --- |
| Click the view | Capture the mouse to look around (Esc releases it) |
| Right-drag | Look around without capturing the mouse |
| W A S D / arrow keys | Fly forward, left, back and right |
| E or Space / Q or C | Fly up / down |
| Shift / Alt (held) | Four times faster / slower |
| Mouse wheel | Change flying speed (zoom in plan views) |
| F | Walk mode on / off (see below) |
| 1–9, 0, `[` `]` | Jump to viewpoints, previous and next viewpoint |
| N | Day / night |
| R / U | Hide roofs / hide the upper level |
| G | Floor-plan overlay (in the plan views) |
| O | Reference image: thumbnail, then overlay, then off |
| Alt-click, or I then click | Inspect: names the object under the cursor |
| P | Copy the current viewpoint, camera position and inspected object |
| H | Help |

Each reference image has a matching viewpoint, and the reference is shown in the corner so you can compare. The camera position is remembered between reloads.

## Walking as your chimp

Press **F** to walk instead of fly: your chimp stands on the floor below the camera, and you move it with gravity, using the same mouse look. W A S D walk (a chimp's jog), Shift runs and Alt walks slowly. Use it to check that the stairs, doorways, corridor, bridge and side entrance work for someone on foot.

- **The camera** follows behind and above your chimp, which turns to face the way it goes and looks where you look; swing the camera round in front of it and it looks at you. Walls cut the camera's distance short at once (it never looks through one) and it eases back out when they clear. The **mouse wheel** brings the camera in or takes it further out; all the way in is your chimp's own eyes. **V** switches between the two.
- **Reach is your chimp's:** a cabinet, a remote, a button or a click on a screen is within reach of your chimp's eyes, wherever the camera is. Its eyes are about 1.3 m up (a chimp's height, set in the wardrobe); the body that bumps into things stays 1.7 m tall and 0.6 m wide (`AVATAR` in `src/engine/walker.ts`), so every chimp fits through the same doors.
- Walls, glass, railings and furniture block you, and you slide along them. Stairs and ledges up to 0.3 m are stepped onto. Leaves and plant stems are passed through.
- Roofs are ignored, so pressing F above the house drops you into the room below.
- When something stops you, the status panel shows **Bumped into** and the object's name, and **P** includes it in the copied details.
- Eye-level viewpoints keep you walking. Choosing a viewpoint in the air, or a plan view, switches back to flying.
- `?pov=first` starts walking from your chimp's eyes (the house's older browser tests walk that way).

## Your chimp

**C** while walking (or **Dress your chimp** in the side panel) opens the wardrobe: the camera swings round in front of your chimp, which stands still and looks at you, and the panel beside it has four tabs.

- **Body:** a chimp to start from (Classic, Youngster, Elder, Golden, or Mint in ChimpVibe's colours, each in the clothes you have on), then height (1.3 to 1.8 m), build, belly, arms and legs.
- **Face:** head size, muzzle, brow, ears and eyes; the face's and the eyes' colours.
- **Fur:** its colour, its tips' colour, its length, a grey beard, and the hands' and feet's colour.
- **Clothes:** a slot each for the head (cap, beanie, headphones), eyes (shades, glasses), neck (bandana, banana chain), top (ChimpVibe tee, hoodie), bottom (shorts), back (backpack) and wrist (watch), each in colours you choose. Each is made for your chimp's own shape, so it fits every build, belly and head the settings make: a hat over its skull and brow, straps and bands laid on its skin, the fur pressed down under them.

Colours, height and clothes change at once; a new shape is built in a second or so ("Reshaping…"). **Surprise me** makes a new chimp in the same clothes, **Start again** goes back to the first chimp, and **Done**, **C** or **Esc** closes the wardrobe. Your chimp is kept in this browser for your next visit.

**Other visitors' chimps** walk where they walk, dressed as they dressed them, with their names over their heads (`?name=` sets yours), and go when they leave. They come through the room server (below) with the lift and the TV.

How chimps are made, and what a chimp and clothes modelled in Blender must do to take their place, is in `docs/plans/2026-10-16-chimp-avatar-plan.md`. The chimp lab, **http://localhost:5173/chimp.html**, shows one chimp under the house's kind of light without loading the house, for working on its look and movement (`?view=`, `?anim=walk`, `?wear=cap,tee`; see the top of `chimp.html`).

## Playing at the arcade

The Game Room's cabinets hold the ChimpVibe games admitted to ChimpHouse, one per cabinet slot (eight, numbered 1–4 along the north wall and 5–8 by the south glass), filled in list order. Each is the shared cabinet design dressed in the game's colours, name and art.

- Walk up to a cabinet and look at it: **E**, or a click on its screen, plays it. The camera glides onto the screen and the game's play page opens over it. Every key then goes to the game; ChimpHouse's own keys do nothing.
- **Leave**, under the game, closes it and puts you back where you stood. If the game stops taking keys, click it.
- The list comes from ChimpVibe (`https://chimpvibe.dev/shared/chimphouse.json`) and is checked every two minutes. Until ChimpVibe serves it, `public/arcade/chimphouse.json` stands in (`node tools/make-arcade-fixture.mjs` rebuilds it from the live catalogue). In development, `/chimpvibe/…` on the dev server is proxied to chimpvibe.dev so the art works as a texture.
- ChimpVibe only lets its own site frame its games so far, so a real game shows a refusal over the screen. Add `?arcade=standin` to the address to play `public/arcade/standin.html` on every cabinet instead: it shows the keys it receives.

## Playing the claw machine

The Chimp Claw stands in the Game Room's south-east curve, beside the snack machine: a crane machine stocked with 27 plush prizes (Plush Chimps, Pink Party Chimps, Banana Buddies, Coco Balls, Vibe Stars and one big King Kongo), dropped in clear of one another and settled into a pile that keeps clear of the chute.

- Walk up to its deck and look at it: **E** steps up to play. The camera looks down past the joystick and drop button (they move as you play) into the glass box, with the bed and the chute (front left) in view, and a play starts with the credit timer at 20 s.
- **W A S D** or the **arrows** steer the claw (the joystick on the deck leans with them); **Space** or **Enter** (or the **Drop** button) drops it. When the timer runs out it drops by itself. After a play, **Space** plays again; **Esc** or **Leave** walks away. A play under way finishes by itself.
- **Views**: **V** steps through four (**Shift V** back), **1**–**4** picks one, or the buttons in the bar: **Panel** (the one a play starts in: the joystick and drop button in the frame's foot), **Close** (nearer and lower, in through the front glass), **Left** and **Right** (round to the machine's sides, as far as the room allows: the eye is kept clear of what stands beside the machine, looking down over it if that gets further round). The camera glides from one to the next, and each keeps the bed and the claw's travel in frame on any window shape. **The keys steer the way the view looks**: up the screen (W) is away from the eye and right (D) is its right, squared to the machine's sides, so from the left side W moves the claw across the machine, away from you. That keeps steering the same in every view, which matters more than matching the joystick on the deck (it leans the machine's way, as the claw moves).
- The claw opens, lowers until it lands on a prize or the bed, closes (each prong stops where it meets something), winds up, carries what it holds back over the chute and opens. A prize down the chute comes to rest behind the pickup door, which swings open on it, and waits there, through more plays, until someone picks it up. The door keeps three: when a fourth comes down, the oldest is set out on the floor in front of the door.

### The prize you win

- **Picking it up.** Walk up to the pickup door (front left, low down) and look at it: **E** picks up the prize behind it (the oldest, if there are several). That prompt replaces the machine's own "Play" while you look at the door. The attendant puts another prize in the machine a few seconds later.
- **Holding it.** It comes up out of the door into your hand, shown low on the left of the view as a held thing is in a first-person game (drawn over the room, so it never sinks into a wall), and you walk about with it. **Hold T** (or the panel's **Look**) to bring it up in front of you: moving the mouse turns it about; let go and it goes back to your hand, turned as you left it. The panel under the status names it and shows the keys.
- **Putting it down.** **Q** (or **Put down**) drops it from your hand: it tumbles to rest on the floor in front of you as its own soft body would. It lands at the nearest clear spot on the floor you stand on, reached without going through a wall: never inside a wall or a machine, nor on one. Look at it and **E** picks it up again. One at a time; the snack machine's snack goes in the other hand.
- **Shared.** Everyone sees who carries which plush (it goes about with them, their name over it), and where each lies (topics `claw/plushes` and `claw/carry`). A plush put down stays for as long as the room server runs; the room keeps the 20 put down last, the oldest going. A visitor who leaves with one leaves it where they stood. Plushes are never solid for walking (`src/engine/clawPlush.ts`).

- **One player at a time.** While someone plays, anyone else who walks up sees it's in use and watches: their claw follows the player's, and the prizes it moves with it. The pile each play leaves, and the prizes won, are everyone's (a newcomer sees the same pile), through the room server (topics `claw/use`, `claw/motion`, `claw/pile`). The machine is freed when the player leaves or their page closes. Anyone can pick up a prize waiting behind the door, while someone plays or not.
- The player hears the machine: the gantry motors and the winch, the prongs' clack, the clunk at the top, a jingle for a win and an "aww" for a slip.

How hard it is, as on a real machine (the numbers are `CLAW_TUNING` in `src/engine/clawRules.ts`):

- **The claw swings.** The gantry has inertia and the claw hangs on its cable like a pendulum, so stopping the trolley sets it swinging a few degrees; the swing dies out within a second, and a drop while it swings lands off target. The longer the cable, the slower and wider the swing.
- **What the prongs catch decides the hold**, from 0 to 1: the prize's own catch (a chimp's neck and arms 0.92, a banana 0.7, a star 0.62, the round Coco Ball 0.5), how many prongs touch it (one 0.35, two 0.8, three 1), whether their tips are under its centre of mass, and how near the claw's middle its centre is. The prize needs its mass (and half of whatever lies on top of it) times 2.2.
- **Grip strength is set per play**: one play in four on average is strong (0.9–1.0), the rest weak (0.3–0.62). The full grip picks up; at the top the claw stops with a jolt and drops to its carrying grip (95% of a strong play's, 62% of a weak one's), the jolt costs 15% more, and swinging on the way to the chute up to 35%. A grip that can't take the prize lets it slide out a few centimetres up; one that fails at the top or on the way drops it there, and the claw sags open so it falls clear.
- So only a good grab on a strong-enough play wins. Simulated over many plays (`__chimp.claw.simulate`, run by the test), steering perfectly over the highest chimp in reach and waiting out the swing wins about one play in ten (about one in three of the strong plays), and a drop anywhere almost never. The claw sinks a couple of centimetres into the plush before it closes; a prize that comes up can still bounce off the chute's rim. People win less often than the perfect player.
- **The prizes are soft bodies that keep to the glass** (`src/engine/clawPhysics.ts`): clusters of spheres, stepped 240 times a second. A carried prize slides over in the prongs rather than passing through the glass or the chute's guard; let go, it drops out of the prongs with the claw's own small speed, so over the chute it falls in. Prizes that end up inside one another (dropped in on top of each other) are eased apart a little at a time without being given the speed of the push, and none ever goes faster than a plush toy can (1 m/s across, 0.8 m/s up, its turn 1.5 m/s at its edge), so a jumble comes apart gently and settles in a few seconds.
- **A prize let go over the chute always goes down it, and wins.** The guard's acrylic and the glass round the chute are slick, and the guard's rim is a round chrome tube that tips a prize resting on it off toward whichever side its weight is on, so nothing balances on it or hangs there. A prize whose middle is over the hole never comes to rest there. One longer than the hole is wide (the King lying across it, hooked on the rim by its neck) folds in after a moment, squashing past the rim and turning upright, its widest way toward the hole's diagonal. A play isn't called, won or not, while a prize is still in the chute's mouth.

## Playing pinball

Two pinball machines stand in the Game Room's north-east curve, each a real machine down to the legs, lockdown bar, coin door, plunger and flipper buttons, with a playfield under glass and a lit backglass and dot-matrix display in the backbox. **Jungle Quest** (green and gold) and **Banana Blitz** (pink, purple and yellow) differ in layout, features and rules as well as looks.

- **Playing:** walk up to the front of a machine and look at it, then press **E** (or click it). The camera stands where a player does, looking down the playfield with the display in view, and a game starts. A panel beside it shows the score, the ball, the machine's high scores and its keys.
- **Keys:** **Left Shift** or **Z** for the left flipper (on Banana Blitz the upper-left flipper too), **Right Shift** or **/** for the right. Hold **Space** (or **↓**) to pull the plunger back and let go to launch: the further back, the harder. **X** and **.** (or **←** and **→**) nudge the cabinet sideways and **↑** forward, but bump it too often and it warns DANGER twice, then TILTs: the flippers die and the ball is lost. **C** switches between the player's view and a view from above the playfield. **Enter** starts a new game after one ends. **Esc** or **Leave** ends the game and walks on. While you play, ChimpHouse's own keys do nothing.
- **A game** is three balls. Each launch starts a ball save (8 s on Jungle Quest, 10 s on Banana Blitz) that puts a drained ball back in play. When a ball drains, the end-of-ball bonus counts up, times the bonus multiplier. Extra balls light SHOOT AGAIN.
- **Jungle Quest:** a left ramp climbs to the temple and returns down a wire to the left flipper; three pop bumpers sit in the SNAKE PIT under three top lanes, T-E-M; the IDOL drop targets guard the right; the TEMPLE saucer starts quests; a kickback saves the left outlane once lit. Rules: light T, E and M to raise the bonus multiplier (the flipper buttons move the lit lanes; the lane lit when you plunge is a skill shot). Knock down all three IDOLs to light the TEMPLE and relight the kickback. The lit TEMPLE starts the next quest, 35 seconds each: VINE SWING (ramps), SNAKE PIT (bumpers), LOST IDOL (the drop targets) and RIVER RUN (the right orbit). Two quests won earn an extra ball; all four start JUNGLE KING, where everything scores 100,000. Ramps back to back are a combo.
- **Banana Blitz:** three flippers (an upper-left one, fed from the bumper pit), a spinner in the right orbit, two pop bumpers up in the pit, six B-A-N-A-N-A standup targets (three under the pit, three on the orbit's wall) and the MONKEY MOUTH saucer. Rules: spell BANANA to light the lock; shoot the lit MONKEY MOUTH to lock a ball; with two locked, the next shot to the mouth starts three-ball BLITZ MULTIBALL, with a ball save, the mouth scoring a jackpot that grows with each one and with spinner turns and orbits. The orbit over the top and the mouth are major shots: one within 3.5 seconds of another is a combo, up to 5X; eight combos earn an extra ball. The spinner scores every turn.
- **The physics** is real pinball's: a 27 mm steel ball on a 0.52 m by 1.07 m playfield leaning back at 6.5°, stepped 2000 times a second so a ball can't pass through a wall, post or flipper. The ball rolls, so it gathers speed down the slope at 5/7 of what a sliding one would: from the top it takes about a second and a half to reach the flippers. A flipper swings up in about 30 ms, a full shot leaves its tip at about 3 m/s and a full plunge at 2.5 m/s, and the speed of its surface where it meets the ball goes into the shot, so a ball hit near the tip flies harder than one hit near the base, and a held flipper cradles the ball. Pop bumpers and slingshots kick (at about 1.2 m/s, rubbers giving back about 60% of a hit), the spinner spins as long as the ball's speed lasts, the saucers catch a slow ball, and a ramp shot that is too weak rolls back down. A ball that sits still for three seconds gets a nudge, as a real machine's ball search does.
- **Shared:** one visitor plays a machine at a time. Others walking up see who is playing it, and its display says so. Each machine's high scores (the best five) are shared through the room server and kept in each browser too. A visitor who closes their page frees the machine.
- The machines' code: the tables (layout, art and lamps) are `src/world/props/pinballTables.ts`, the model `pinball.ts` and `pinballArt.ts` beside it; the physics and rules are pure modules, `src/engine/pinballPhysics.ts` and `pinballRules.ts`; `src/engine/pinball.ts` runs them in the page (with `pinballDmd.ts` for the display and `pinballSound.ts` for the sounds, made in the browser).

## Playing air hockey

The Game Room's air hockey table, in the middle of the floor, plays like an arcade table: first to 7 wins.

- Walk up to either end and look at the table: **E** plays at that end (red at the west end, blue at the east). The camera stands behind your end looking down the table, and the mouse is free.
- Your mallet follows the mouse cursor across your half of the table, sweeping after it at a hand's speed, so a quick swipe strikes the puck hard. It can't cross the centre line.
- The puck moves as on a real table: a hit sends it off at about the mallet's speed (a hand tops out near 4.5 m/s, the puck at 8), it glides on the air losing a little speed, and each rail takes a quarter of its speed. The robot's hand is slower than yours, so it never hits harder than you can.
- On your own, an invisible robot plays the other end. When a second visitor walks up to its end, they take it over and a new match starts between you.
- The table sounds like one, made in the browser (`src/engine/airHockeySound.ts`) and heard from where it stands: the puck clacks off the mallets and bangs off the rails as hard as it was hit, a goal drops and rattles down the return and sounds the horn, the air hisses while a match is on, and a jingle starts each match and a fanfare ends it. It fades as you walk away.
- After a goal the puck drops into the pocket and comes back out on the side that was scored on. When the match is won, **Rematch** starts another (against a visitor, once you both ask), or **Leave**. **Esc** or **Leave** walks on at any time.

## Playing foosball

The foosball table on the Game Room's open floor is a real table: eight rods through both side walls, each team's grips on its own side, a goalie, two defenders, five midfielders and three attackers a team, goals with a ball return under each end, a serve cup on each side and a bead counter over each end. Matches are first to 5.

- **Walking up:** go to either long side and look at the table: **E** plays that side, red or blue (the side whose grips are in front of you). Alone, you play the robot. When someone is already playing, you get the other side and play them instead of the robot.
- **Your hands are the mouse.** The camera stands you behind your grips with the whole field in view, and you attack to your right.
  - **Up and down:** all your rods slide so a man is under the cursor's line across the table. Point where the ball is, or where it's going, and your men are there.
  - **Flick right:** the glowing rod swings its men through the ball, harder the faster you flick. A small, slow push taps it; a quick snap shoots. Let go and the men settle back hanging down. Flick left to draw them back first.
  - **Click** (or **Space**): the glowing rod whips right round in one spin, a strong kick with no aiming needed.
  - **The glowing rod** (outlined in gold, named in the bar at the bottom) is your rod nearest the ball, and changes as the ball moves. The **wheel**, **W**/**S** or **↑**/**↓** picks the rod in front or behind, and **1–4** the goalie, defence, midfield or attack, until the ball moves on to another rod.
  - **Hold the right button** (or **Shift**) to lift all your men, feet back, so the ball rolls under them. Your rods ahead of a hard shot of your own lift by themselves to let it through.
  - **Angling a shot:** strike the ball off the middle of a man's foot, or slide as you kick.
- **Rebounds:** a shot straight into the other side's men comes back, often faster than the eye can follow, and can roll back under your men while they are still raised from the flick (they settle back down about a tenth of a second after the mouse stops). That is the table, not a missed kick: aim past their men, or angle it.
- **Why this scheme:** it needs one hand and no learning. Pointing is how anyone aims, so sliding follows the cursor exactly, like the air hockey mallet. Kicking is the same sideways wrist snap as on a real table, with its strength straight from your speed, so the feel is real foosball. Picking rods by hand is the hardest part of real foosball for newcomers, so the rod nearest the ball is picked for you, and you can always override it.
- **The ball** is a real foosball's: solid, 35 mm, rolling on the playfield. A shot's pace comes from how fast the rod spins through it, up to about 5.5 m/s for the hardest flick. Struck, it skids and then rolls on at about 5/7 of that speed, rolling resistance slows it to a stop (a ball rolled at 1 m/s goes about a table's length), and walls and men take energy out of it.
- **The robot** plays well but can be beaten. It sees the ball a moment late, its hands are only so quick, and it isn't perfect. It blocks a straight shot, but a shot moved across first, or angled into a corner, often gets past it.
- **A match:** a serve drops in at a side's serve cup and rolls out across the middle. A goal drops into the goal box and comes out of that end's ball return; a bead slides along that team's counter, and the side scored on serves next. A ball that stops dead for five seconds is served again. At 5, **Rematch** or **Leave**.
- **Esc** or **Leave** walks you away from the table, and the robot (or nobody) takes your side.
- **Two players** (two windows, or two computers on the LAN demo): red's player's page simulates the ball and plays the robot, and shares the game through the room server. Each player's rods are shared from their own page. The other player's page runs the same physics ahead of the host's word, so their own kicks answer at once. When either leaves, the other carries on against the robot. Anyone else nearby sees the match.
- **The parts** are found by role (`src/world/roles.ts`): the table's frame, its playfield, its eight rod slots and two counters. The rods, ball and beads are built on them at run time. The physics (`src/engine/foosballPhysics.ts`), match rules (`foosballMatch.ts`) and robot (`foosballRobot.ts`) are pure modules, tested in the browser by `tools/test-foosball.mjs`.

## Watching in the theatre

The theatre screen shows YouTube videos and live streams in YouTube's own player, which YouTube's terms require.

- **The remotes:** two remotes lie on the stand under the screen. Whoever holds one controls the theatre. Walk up to the stand, look at a remote and press **E** (or click it) to pick it up; at the stand, **E** puts it down again, and **B** puts it back from anywhere in the theatre. Leaving the theatre with a remote sends it back to the stand. Handing a remote to another visitor comes with multiplayer.
- **The remote's panel** shows while you hold one: **Play/Pause** (**K**), **−10 s** (**J**) and **+10 s** (**L**), the same keys as YouTube's player, a box for choosing a video, and **Put it back** (**B**). They work for everyone in the theatre, as does whatever the holder does in YouTube's player on the screen.
- **Without a remote** you can still use the player, since YouTube's terms don't allow blocking it, but only for yourself: pausing it pauses just your copy, and pressing play rejoins the theatre where it has got to. The theatre's state, including who holds each remote, is ready for the room server to share.
- **Choosing what plays:** holding a remote, paste a YouTube link (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`) or a video ID into the remote's panel, or into the box under the screen while watching, and press **Show**. A `t=` or `start=` time in the link is kept. The screen and the "Now Showing" lightbox in the corridor show the video's thumbnail and title whenever the player isn't over the screen.
- **Watching:** walk into the theatre and look at the screen, then press **E** (or click the screen while nothing is showing). The camera glides to a seated pose square onto the screen, and the player appears exactly over it with its own controls. The title is above it. Below it are a box for choosing another video and **Leave**. While you watch, ChimpHouse's own keys do nothing, and keys typed into the player go to YouTube.
- **When a video starts:** at once, since a remote's holder is always in the theatre.
- **Walking about:** **Leave** puts you back where you stood, and the video keeps playing on the screen. As you move about the theatre the player lies over the screen in perspective, placed afresh in every frame the scene is drawn. With the mouse free, clicks on it go to YouTube's player.
- **When it hides:** a browser draws the player on top of the 3D scene, so it hides when it can't be seen properly: when you look away, something stands in front of the screen, you see it too steeply or from too far away (smaller than YouTube's 200 px minimum), or you leave the theatre. YouTube's terms don't allow a hidden player to play, so it pauses as it hides. The theatre itself keeps going, as a cinema does: when the screen is back in view, your player catches up.
- **Sound:** the player's volume falls off with your distance from the screen, scaling whatever you set on the player's own volume slider. Its sound can't come from the speakers' direction: the browser keeps YouTube's sound sealed inside the player.
- **When YouTube refuses a video** (its owner doesn't allow it outside YouTube, or it's gone), the frame says so in plain words, with a link to watch it on YouTube.
- The theatre's state is one object, the store's `theatre`: the video, playing or paused, and where it was at a moment. A room server can share it later to keep everyone in step.
- Add `?theatre=standin` to the address to use `public/theatre/standin.html` instead of YouTube's player. It draws a test card with a solid colour in each corner, a clock and the keys it receives.

### Checking it with real YouTube videos

`tools/test-theatre.mjs` checks the theatre against the stand-in. To check real YouTube, open http://localhost:5173/?view=theatre in your own browser (with `npm run dev` running). Press **F** to walk, go to the stand under the screen, look at a remote and press **E** to pick it up. Then look at the screen and press **E** to watch, paste each of these into the box under the screen and press **Show**:

| Link | What should happen |
| --- | --- |
| `https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30` | Big Buck Bunny plays with sound from 0:30, exactly over the screen. The bar above says "YouTube · Blender". |
| `https://www.youtube.com/watch?v=M3HKLzjvKPc` | NASA's live view from the space station plays, and the bar above says LIVE once it starts. Live streams come and go: if this one has ended, use any stream that's live on YouTube. |
| `https://www.youtube.com/watch?v=jfKfPfyJRdk` | An ended stream. YouTube refuses it, and the frame says so, with a link to watch it on YouTube. |
| `https://youtu.be/aaaaaaaaaaa` | A video that doesn't exist: the same refusal. |

Then try:

- Press **Leave** while it plays and walk about the theatre: the video keeps playing on the screen, in perspective, and gets quieter towards the back.
- Turn away, or walk out of the door, for ten seconds, then look at the screen again: it pauses meanwhile, and comes back about ten seconds on.
- Pause with the player's own button, then walk out and back: it is still paused where you left it.
- The player's fullscreen button, and resizing the window while you watch (the player stays on the screen).
- With the remote, **K**, **J** and **L** while you walk about; then **B**, and pause and play the player yourself: without a remote, only your copy pauses, and it rejoins the theatre.
- Walking out of the theatre with the remote: it goes back to the stand. From the corridor, the lightbox shows what's on.

## Using the lift

The lift beside the stairs runs between the lower and upper floors, and works as a real one does.

- **Using a button:** point at it, with the mouse cursor, or with the crosshair while the mouse is captured. The button you're pointing at gets an outline and the prompt names it. Press **E** or click to press it.
- **Calling it:** each landing has a call station on the pier beside the doors, with an up button on the lower floor and a down button on the upper floor. The car comes to that floor and its doors open. A call from the other floor waits until the car has finished where it is.
- **Riding it:** the car's panel is on the right-hand wall by the doors. It has a button for each floor (2 above 1), and below them the door-open and door-close buttons. The doors shut a short while after you choose a floor, and the car runs between the floors in about seven seconds, speeding up, cruising and slowing. The floor buttons light while their call waits. The indicators above each landing door and over the car's doors show the floor the car is at or passing, with an arrow while it travels.
- **Doors:** each landing has a pair of stainless doors that slide behind the wall. The car carries its own pair, which opens with them. Each pair meets in a dark line down the middle: a black rubber edge on each leaf, solid, so you can't see through it. The doors stay open for about four and a half seconds. Someone standing in the doorway holds them open, and they open again if they meet someone while closing. Once the doorway clears, they wait a moment and then shut. The door-open button reopens or holds them, and the door-close button shuts them at once unless someone is in the way.
- **Sounds** are made in the browser, not recorded: the button beep, the arrival chime (one ding for a car that came up, two for one that came down), the door operator's whirr ending in a thud, the brake's clunk as the car sets off and stops, and while it travels the motor's hum, the drive's rising whine, the rushing air and the rails' ticks. They come from the car in 3D: they fade as you walk away (full beside the car, about a quarter as loud 3 m off and a tenth 5 m off) and come from the car's side of you. They play through a little reverb. From outside a shut car its sounds are muffled. Browsers only allow sound after a key press or click, so it starts at your first one.
- **Music**: the car plays easy-listening bossa nova from its speaker, an original tune made in the browser (`liftMusic.ts`). It starts a second after anyone presses one of the lift's buttons and keeps playing through every press after that. It's part of the lift's shared state, so everyone at the lift hears the same tune at the same point, and it stops once the last person at the lift (in the car, or near a landing's doors) has walked away.
- **Shared between visitors:** everyone on the same dev server (this computer's windows, or other computers on the LAN demo) sees the same car, doors, calls and music. The lift is one object, `store.lift` (`src/engine/liftState.ts`), whose timing is pure functions of that state and the clock. Each page moves it on by the room's clock and passes on the changes its visitor makes through the room server (see below). A visitor who closes their page is let go of: out of the doorway, and away from the lift.

## Getting a snack

CHIMP CHOMP, the snack machine in the Game Room's south-east curve beside the claw machine, is a glass-front spiral machine, and the snacks are on the house.

- **Choosing a snack:** every snack has a code on the label under it, a row letter (A–E, top to bottom) and a lane number (1–5 in the rows of bags, 1–6 in the rows of bars and boxes). Point at a key on the keypad, with the cursor or the crosshair, and press **E** or click: the key lights up as you point at it. Press the letter, then the number. Or walk up and press **E** with no key pointed at to step up to the machine: the mouse is free to click its keys, or type the code on the keyboard (**Backspace** clears). **Esc** or **Leave** walks on.
- **The vend:** that snack's coil turns one turn. The snack at its front is pushed off the tray, tips over the edge and falls behind the glass into the bin, and the snacks behind it move up a place. The display says what's happening, and when a code can't be sold: sold out (with how long until it's back), a code the machine doesn't have, or the bin full (it holds four).
- **Taking it:** point at the **PUSH** flap and press **E**, or click it (at the machine, click the flap or press **Enter**). The flap swings in and the snack comes out into your hand. You can hold one at a time.
- **Eating it:** press **E** while holding it. It comes to your mouth and goes in four bites, each with a crunch and a shower of crumbs. You can walk off with it and eat it anywhere.
- **Restocking:** a coil that runs out restocks itself 45 seconds later.
- **Sounds** are made in the browser: the keys' beeps, the coil motor's whirr, the snack knocking the glass and landing in the bin, the flap, the wrapper tearing and the crunches.
- **Shared between visitors:** what each coil holds and every vend are one state shared through the room server (`src/engine/snackState.ts`). A snack bought is gone for everyone, and everyone sees its coil turn and the snack drop. The fall is a small rigid-body simulation that every page works out the same way from the moment the key was pressed. The snack in your hand, and eating it, are yours alone.

## The room server

Shared state goes through a room server. For now it lives inside the dev server (`server/roomServer.ts`, a Vite plugin), using the WebSocket Vite already keeps open to each page, so `npm run dev` (and the LAN demo) runs it with no extra setup. The page side is `src/engine/room.ts`.

- It keeps the newest version of each shared topic, so a visitor who arrives later is told how things stand, and passes each change on to everyone else.
- It keeps the room's clock, so the car is in the same place on every computer whatever its own clock says.
- It tells everyone when a visitor leaves, and forgets that visitor's own topics (their chimp: the families `chimpdna:<id>` and `chimp:<id>`, see "Your chimp").

It only exists in development. A production build has no dev server, so it falls back to sharing between tabs of the same browser. Restarting the dev server resets the lift. Before ChimpHouse is published for real players it needs a standalone, authoritative room server: see `docs/plans/2026-10-09-standalone-room-server-plan.md`.

## Requesting changes

Fly to the spot, Alt-click the object you want changed and press **P**. Paste the copied text into your request, for example:

```
ChimpHouse preview — last viewpoint "Arrival Lounge"
Camera: (-5, 1.5, 0.9)  heading 318°  pitch -4°  fov 1.15
Area: Lower · Arrival Lounge
Picked: Lower › Arrival Lounge › Long curved teal sofa at (-9.81, 0.44, 2.09)
```

## Where things live

| Path | Contents |
| --- | --- |
| `src/world/layout.ts` | Every dimension: storey heights, room footprints, trees, stairs, bridge. `PLAN_SCALE` (wings and depth) and `HALL_SCALE` (entry hall width) resize the whole house; furniture spacing, terrain and viewpoints follow. |
| `src/world/structure/` | Floors, glazing, roofs and atrium dome, arches, stairs, railings, substructure |
| `src/world/rooms/` | Room furnishing (`lower.ts`, `upper.ts`) |
| `src/world/props/` | Furniture, lights, plants, screens, the shared arcade cabinet (`cabinet.ts`), what the theatre screen shows when nobody is watching (`theatreScreen.ts`), studio equipment, firetruck |
| `src/world/roles.ts` | Roles: how code finds a screen or slot (the theatre screen, cabinet slot 3) from its metadata, which the Blender files will carry too |
| `src/world/structure/lift.ts` | The lift's car (its doors, panels, lights and buttons), each landing's frame, sill, doors, call station and indicator, and the shaft's dark lining, built at rest; the shaft's walls are in `facades.ts` and `floors.ts`, its materials in `materials/lift.ts` |
| `src/engine/liftState.ts` | The lift's shared state and its rules, as pure functions (no Babylon): the timing, the commands, and the steps the state takes on its own |
| `server/roomServer.ts` | The room server for now: a Vite plugin sharing state between the pages the dev server serves |
| `src/engine/room.ts` | This visitor (`ME`), and shared state through the room server: `room.share`, `room.onGone`, the room's clock `room.now()` |
| `src/engine/lift.ts` | The lift in the page: shows the shared state, reads the doorway, finds the button you point at, lights the car, plays the sounds (`liftSound.ts`) and the car's music (`liftMusic.ts`) |
| `src/world/props/pinballTables.ts`, `pinball.ts`, `pinballArt.ts` | The two pinball machines: each table's layout, lamps and rules' parts as one definition (read by the model and the physics), the machines' model, and their printed art (playfield, backglass, sides, apron, lamp atlas) |
| `src/engine/pinball.ts`, `pinballPhysics.ts`, `pinballRules.ts` | Playing pinball: the machines in the page (walking up, keys, the display, attract mode, sharing who plays and the high scores), the physics and the rules as pure modules (no Babylon) |
| `src/world/environment/` | Sky, terrain, waterfalls, jungle, giant trees, front approach, canopy bridge |
| `src/world/materials/` | Procedural textures, leaf atlas, signs, shared material library |
| `src/world/viewpoints.ts` | Saved camera viewpoints |
| `src/engine/` | Engine bootstrap, fly camera and the camera that follows a walking chimp (`flyCamera.ts`), walk mode (`walker.ts`, `collision.ts`), lighting, post-processing, HUD state; using a screen (`focus.ts`: the glide onto it and lining content up over it), the arcade (`arcade.ts`) and the theatre (`theatre.ts`, `youtube.ts`) |
| `src/avatar/` | The chimps: their DNA (`dna.ts`), skeleton (`rig.ts`), anatomy as distance fields (`anatomy.ts`, `sdf.ts`), meshing and simplifying (`mesher.ts`, `decimate.ts`, `model.ts`, built in two workers by `builder.ts`), materials (skin, fur shells, cloth: `materials.ts`), the chimp in the scene (`chimp.ts`), its animation (`animator.ts`) and the wardrobe's items (`wardrobe.ts`, `items.ts`, `garments.ts`) |
| `src/engine/avatars.ts`, `src/ui/Wardrobe.tsx` | This visitor's chimp and every other visitor's in the house (where they are, through the room server; their lights, fur detail and shadows), and the wardrobe's panel |
| `chimp.html`, `src/lab/chimpLab.ts` | The chimp lab: one chimp, no house |
| `public/textures/screens/` | Screen artwork extracted from the reference images |
| `docs/plans/2026-10-02-blender-switch-plan.md` | The plan for moving the house into Blender once the layout is settled |
| `art/ChimpHouse.blend` | The Blender master: links every room and zone, and holds the lights, sun, viewpoint cameras and render settings |
| `art/rooms/` | One Blender file per room or zone (`upper-theatre.blend`, `structure.blend`…), each opening on its own; edit a room here and the master shows the change |
| `art/materials.blend`, `art/textures/` | The shared material library every room file links to, and the textures as PNGs. Until the cut-over to Blender, everything in `art/` is generated from the code and kept out of git; after it, Git LFS (see `AGENTS.md`) |
| `src/engine/exportRoom.ts`, `tools/blender/` | Export to glTF and the Blender build and render scripts, for the move to Blender |
| `art/test/` | Exports, test files and renders (not in git) |

## Tools

| Command | Purpose |
| --- | --- |
| `npm run screens` | Re-extract screen artwork from the reference images (`tools/screens.json` holds the screen corners) |
| `npm run capture [ids…]` | With `npm run dev` running, render viewpoints to `captures/` along with reference/render comparison sheets |
| `node tools/try-poses.mjs out.png '[{"x":…}]'` | With `npm run dev` running, render several candidate camera poses into one contact sheet |
| `node tools/plan-grid.mjs …` | Overlay a metre grid on the floor plan, for tracing footprints |
| `node tools/px-grid.mjs …` | Overlay a pixel grid on a reference image, for locating screens |
| `node tools/debug-view.mjs <view> <out.png> "<js>"` | With `npm run dev` running, open a viewpoint, run a snippet against the scene and screenshot it |
| `node tools/export-room.mjs <room>` | With `npm run dev` running, export a room (an id from `ROOMS` in `layout.ts`) to `art/test/<room>.glb`. The preview's **Download this room** button does the same for the room you're in |
| `node tools/audit-items.mjs [zone…]` | With `npm run dev` running, review how the export splits every room and zone into items and flag what looks wrong; the full item lists go to `art/test/item-audit.txt` |
| `node tools/test-arcade.mjs [slot]` | With `npm run dev` running, check the arcade round trip in a real browser: slots and cabinets, walking up, playing the stand-in game (keys reach it, ChimpHouse ignores them, the frame lines up with the screen through a resize), leaving and walking on. `GAME=real` plays the real game instead. Screenshots go to `captures/arcade-*.png` |
| `node tools/make-arcade-fixture.mjs` | Rebuild the arcade's stand-in game list from ChimpVibe's live catalogue |
| `node tools/test-theatre.mjs` | With `npm run dev` running, check the theatre in a real browser with the stand-in player. It checks that the screen and lightbox are found by role, and the watch-mode round trip: the player exactly over the screen (also in a screenshot), nothing over it, keys going to it and not to ChimpHouse, a window resize. It checks the remotes: taking one, putting it down, leaving the theatre with it, its buttons, and a viewer without one. After Leave it checks the player over the screen in perspective (in screenshots, and in every frame while walking), each reason for it to hide (paused first), catching up, and volume by distance. It also checks choosing videos, live streams and refused videos. Screenshots go to `captures/theatre-*.png` |
| `node tools/test-claw.mjs` | With the dev server running, check the claw machine in a real browser: its parts found by role and its pile settled, the odds of its rules over many simulated plays, walking up and pressing **E**, steering with the keys (the joystick leaning, the claw swinging), dropping with **Space**, a strong well-aimed grab winning a prize that comes out of the pickup door and waits there, every view (gliding there, the machine in frame on a wide and a phone-shaped window, the keys steering the way it looks), prizes let go over the chute all winning (the oldest set out when the door holds three), the timer dropping the claw by itself, leaving with **Esc**, the prize picked up at the door, held, turned, walked with, put down on the floor (not solid, never inside the machine) and picked up again, restocked, and the floor's limit of 20. `node tools/shoot-claw.mjs` takes the look's screenshots; `SHARED=1 node tools/test-claw-sync.mjs` checks it shared between two visitors (one plays, the other sees it in use and watches the same claw and pile; a prize one wins, the other picks up and is seen carrying, puts down where both see it, and the first picks up again). Both claw tests reset the machine for everyone on the server first. Screenshots go to `captures/claw-*.png` |
| `node tools/test-pinball.mjs [look \| lab]` | With `npm run dev` running, check the pinball machines in a real browser: their parts found by role; the physics as pure functions (hundreds of hard shots never getting through a wall, the plunger's strength, flipper timing and shots, cradling, bumpers, slingshots, the ramp, the spinner, the saucers, draining); the rules (ball save, three balls, tilt, Jungle Quest's quests, Banana Blitz's locks and multiball); then walking up, E, the plunger and flipper keys, a robot playing a while, nudging and Esc. `look` only takes the screenshots, `lab` only runs the physics and rules checks in Node with no browser. `SHARED=1` instead checks two visitors (a second page): one player per machine, the other seeing who is playing, the machine freed when its player leaves or closes their page, and the shared high scores. Screenshots go to `captures/pinball-*.png` |
| `node tools/test-lift.mjs` | With `npm run dev` running, check the lift in a real browser: its parts found by role, the timing rules as pure functions (a trip, the doors, the dwell, the doorway holding them, the same state from any step size), then a visitor calling the car with **E**, walking in, riding it, holding the doors from the doorway, and walking into the shut doors. Screenshots go to `captures/lift-*.png` |
| `node tools/test-snack.mjs` | With `npm run dev` running, check the snack machine in a real browser: its parts found by role, the rules and the fall as pure functions (one snack per vend, refusals, restocking, the fall staying in its shaft and landing in the bin), then a visitor pressing keys with **E**, the coil turning and the snack falling, taking it through the flap, eating it, typing a code at the machine, sold out and restocked, a full bin, and a second visitor seeing the same vend. `SHOTS=1` only takes the look's screenshots. Screenshots go to `captures/snack-*.png` |
| `node tools/test-lift-sync.mjs` | With `npm run dev` running, check the lift shared between visitors (separate browser contexts): a press reaching another visitor, the car at the same height for both, the music playing for both from the same moment, a latecomer with its clock 5 s out seeing the car where the others do, and a visitor who leaves being let go of. Both lift tests reset the shared lift first, so anyone else on the server sees it jump back downstairs |
| `node tools/test-air-hockey.mjs [look]` | With `npm run dev` running, check the air hockey table in a real browser: the physics and the robot on their own (the glide, rail rebounds, no puck escaping or passing through a mallet, the mallet's speed passing to the puck, goals and posts, the robot saving some shots and scoring), then a visitor walking up, playing the robot with the mouse, scoring and winning a match and a rematch, then two visitors (separate browser contexts) playing each other, the game handed over when one leaves. `look` takes screenshots of the table instead. Screenshots go to `captures/air-hockey-*.png` |
| `node tools/test-foosball.mjs [pure] [solo]`, `SHARED=1 node tools/test-foosball.mjs duo` | With `npm run dev` running, check the foosball table in a real browser. **pure** checks the physics, rules and robot as pure functions: rolling, walls, corners, goals, no tunnelling at full speed, kicks, lifted men, and the robot stopping slow shots but beaten by some hard angled ones. **solo** plays the robot: the parts found by role, walking up and E, the real mouse sliding the rods and flicking a kick, a click's spin, picking rods, goals and the ball return, a match to 5, Rematch and Esc. **duo** (only with `SHARED=1`: a second page is a second house in memory) has two visitors: the second takes the robot's side, both pages see the same ball and each other's kicks, the host leaving hands over the game, and a closed page frees its side. `URL=` picks the dev server. Screenshots go to `captures/foosball-*.png` |
| `node tools/test-chimp.mjs` | With `npm run dev` running, check walking as a chimp in a real browser: the chimp stands where the walker is and gives it its eye height, the camera behind it, walking and running turn it the way it goes, the camera never sits beyond a wall, V and back, the wardrobe swings round in front of it and holds it still, its panel dresses the chimp and keeps the outfit, a chimp to start from keeps the clothes on, a cabinet in front of the chimp is in reach with the camera behind, the room's lamps light the chimp while the house's lights are left as they were, it climbs the main stair with each foot on its step, and colours and shapes change. Screenshots go to `captures/chimp-*.png` |
| `node tools/test-chimp-sync.mjs` | With `npm run dev` running, check another visitor's chimp: the house in one page and a light visitor (`tools/chimp-visitor.html`: the room server and a chimp walking a circle, no house) in another. The house builds it dressed as its DNA says, shows it with its name, follows it smoothly, and lets it go when its page closes |
| `node tools/chimp-shots.mjs [out.png] [views] [query]` | With `npm run dev` running, photograph the chimp lab from several views into a contact sheet; a view can carry a pose (`side@walk:2.2`) |
| `node tools/chimp-house-shots.mjs [out.png] [viewpoints]` | With `npm run dev` running, photograph your chimp in the house, behind and in front, at several viewpoints |
| `node tools/wardrobe-shots.mjs <items> [views] [bodies] [out.png]` | With `npm run dev` running, photograph clothes on every kind of chimp in the chimp lab: a row per body (the wardrobe's five presets, the slimmest and the biggest chimp the settings make), a column per close view (`head3`, `headBack`, `neckFront`, `torso3`, `wristOut`…), into `captures/wardrobe-<items>.png` |
| `node tools/chimp-eval.mjs "<js>"` | With `npm run dev` running, run a snippet in the chimp lab (`lab` is its hook) and print the result |
| `node tools/export-house.mjs` | With `npm run dev` running, export every room and zone to `art/test/house/` (one .glb each) with `scene.json`: the house's lights, sun and viewpoint cameras |
| `blender --background --factory-startup --python tools/blender/build_blend.py -- <out.blend> <export.glb or folder>… [--rooms <dir>]` | Build Blender files from exports: Group › Zone collections (Lower, Upper, Building, Site), shared materials and images, quads and welded vertices rebuilt from glTF's triangles (so items can be reshaped), textures saved as PNGs beside it, each zone's leaves in a "· Foliage" collection, the lights, the sun and a camera per viewpoint. With `--rooms` it writes a file per room, the material library and a master that links them: `-- art/ChimpHouse.blend art/test/house --rooms art/rooms` |
| `blender --background <file.blend> --python tools/blender/render_views.py -- <out dir> [view…] [--scale 50] [--samples 16]` | Render viewpoint cameras from a Blender file, e.g. to compare with `npm run capture` |

The export splits each room into one object per item (a sofa, a lamp, a planter with its plant), named from its inspect label, turned the way it was placed and with its origin at the centre of its base. Pieces built without a label of their own join the item they belong to; the export prints how it placed them, which is the place to look when an object comes out wrong. Blender lives at `/Applications/Blender.app/Contents/MacOS/Blender` on this Mac.

The screen artwork (community project screens, MixChimp interface and the trading display) is cropped from the concept renders, so it carries their resolution and style. Replace the PNGs in `public/textures/screens/` with real assets when they are available.
