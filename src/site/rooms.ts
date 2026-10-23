// What the welcome page says about each place in the house (index.html, Site.tsx). The words
// follow chimphouse-description.md; the pictures are in public/site/ (tools/site-shots.mjs takes
// the photos, the concept art is a small copy of "Reference Images/").

export interface Room {
  /** the section's anchor, and the photo's name in public/site/ */
  id: string;
  name: string;
  /** where it is in the house */
  where: string;
  /** one short line */
  line: string;
  copy: string[];
  /** what there is to do or see */
  things: string[];
  /** the concept art it was built from, in public/site/concept/ */
  concept?: string;
  /** what the photo shows, for people who can't see it */
  alt: string;
}

export const ROOMS: Room[] = [
  {
    id: "courtyard",
    name: "Front Courtyard",
    where: "Arrival · outside the front doors",
    line: "Every visit starts by the fountain.",
    copy: [
      "You arrive as your chimp in the front courtyard, beside the fountain, with the whole front of the house ahead of you: sweeping timber arches, the glowing ChimpHouse sign, and broad timber stairs climbing to the glazed front doors.",
      "Planted paths, lanterns and the jungle all around. Take a look, then head up the stairs.",
    ],
    things: ["Fountain and planted paths", "Broad timber stairs", "Lanterns after dark"],
    concept: "front",
    alt: "A chimp standing in the front courtyard, the fountain and the curved timber front of ChimpHouse ahead",
  },
  {
    id: "entry",
    name: "Entry Hall & Atrium",
    where: "Lower level · front centre",
    line: "Step inside and see the whole house at once.",
    copy: [
      "Glazed doors open into a clear timber-floored foyer, with a circular botanical-emblem rug marking the welcome area. The lounge opens to the left, the Game Room to the right, and the stair and lift wait farther back.",
      "Above you the atrium rises through both storeys, wrapped by the upstairs gallery, so friends on the upper floor can lean on the railing and wave you in.",
    ],
    things: ["Emblem rug welcome area", "Atrium open to both floors", "Stair and lift upstairs"],
    concept: "entry",
    alt: "A chimp at the glass front doors looking into the entry hall, its emblem rug and the gallery above",
  },
  {
    id: "lounge",
    name: "Arrival Lounge",
    where: "Lower level · front left",
    line: "A comfy first stop before you pick an activity.",
    copy: [
      "A long teal sofa follows the curve of the glass wall, piled with mustard, rust and patterned cushions, with round timber tables and woven rugs for a proper catch-up.",
      "At the back, a refreshments counter with teal stools, coffee, fruit and glowing shelves sits beside a living tree trunk. Meet your friends here, or come back after a game or a stream.",
    ],
    things: ["Curved teal sofa", "Refreshments counter", "Jungle views"],
    concept: "lounge",
    alt: "A chimp in the arrival lounge, with round tables, a woven rug and the refreshments counter behind",
  },
  {
    id: "game",
    name: "ChimpVibe Game Room",
    where: "Lower level · front right",
    line: "Game on. Together.",
    copy: [
      "ChimpVibe's games, brought into a real arcade. Every game the moderators admit to ChimpHouse gets a cabinet of its own: walk up to one and play it right there on the cabinet's screen.",
      "Gather on the curved teal sofa around the big TV, which plays any ChimpVibe game somebody loads onto it, live for everyone in the room. And between rounds there's pinball, a claw machine full of plushes, air hockey, foosball and a snack machine.",
    ],
    things: ["Arcade cabinets", "Game TV", "Pinball", "Claw machine", "Air hockey", "Foosball"],
    concept: "game",
    alt: "A chimp in the Game Room by the curved teal sofa, the big TV, pinball tables and the claw machine",
  },
  {
    id: "trading",
    name: "Trading Room",
    where: "Lower level · rear left",
    line: "Watch the charts and talk the trades.",
    copy: [
      "Yousef's interest in markets gets a room of its own. Three workstations with multiple monitors face a big shared display of a simulated market: candlesticks, volume, prices, an order book and time-and-sales.",
      "It's all clearly simulated, with fictional symbols, so it's a place to learn and talk charts together, not to risk anything.",
    ],
    things: ["Simulated market wall", "Multi-monitor desks", "Order book and tape"],
    concept: "trading",
    alt: "A chimp in the Trading Room facing the big Simulated Market chart and the trading desks",
  },
  {
    id: "mixchimp",
    name: "MixChimp Studio",
    where: "Lower level · rear right",
    line: "Make music, mix it, play it loud.",
    copy: [
      "The physical home of MixChimp, Yousef's music app. A production desk with a mixing console, monitor speakers and a big display of the music library and multitrack mixer.",
      "Over in the performance area: a drum kit, guitars, amps, a keyboard and microphones, plus a glazed vocal booth. Acoustic timber slats and a lit MixChimp sign set it apart from the rest of the house.",
    ],
    things: ["Production desk", "Drum kit and guitars", "Vocal booth"],
    concept: "mixchimp",
    alt: "A chimp in the MixChimp Studio between the production desk and the drum kit, under the MixChimp sign",
  },
  {
    id: "gallery",
    name: "Gallery & Stair Landing",
    where: "Upper level · around the atrium",
    line: "Look down, wave hello, keep moving.",
    copy: [
      "The upstairs gallery wraps around the open atrium: a broad timber walkway with clear glass balustrades and trailing plants. From the railing you can see the emblem rug, the front doors and everyone arriving below.",
      "Signs point the way to the showroom, the theatre and the pool and bar, and the canopy bridge comes in on this level too.",
    ],
    things: ["Atrium overlook", "Signs to every room", "Lift and stair"],
    concept: "gallery",
    alt: "A chimp on the upper gallery beside the round glass railing around the atrium",
  },
  {
    id: "showroom",
    name: "Community Builds Showroom",
    where: "Upper level · front left",
    line: "Where the community shows what it made.",
    copy: [
      "Named after Yousef's “Community builds” stream segment, this is where viewers' projects get their moment. A wall of submission screens shows several builds at once, while the featured-build screen and a display plinth (with its red firetruck model) focus on the one being reviewed.",
      "A host desk faces teal sofas and poufs for the audience: come for the feedback, the demos and the discussion.",
    ],
    things: ["Submission wall", "Featured build screen", "Host desk and audience"],
    concept: "showroom",
    alt: "A chimp in the Community Builds Showroom near the featured build screen and the red firetruck model",
  },
  {
    id: "theatre",
    name: "Theatre",
    where: "Upper level · rear left",
    line: "Watch the stream together.",
    copy: [
      "Two rows of teal and mustard seats face a big screen, with speakers, a ceiling projector and charcoal roller shades for the jungle-facing windows.",
      "Put on Yousef's stream or any YouTube video and everyone in the room watches it together, in step. Whoever holds a remote chooses what's on.",
    ],
    things: ["Big screen", "YouTube and live streams", "Shared remotes"],
    concept: "theatre",
    alt: "A chimp in the theatre between rows of teal sofas, facing the big ChimpHouse Theatre screen",
  },
  {
    id: "bar",
    name: "Canopy Bar & Lounge",
    where: "Upper level · rear right",
    line: "Meet up after the game.",
    copy: [
      "A curved bar with glowing shelves and upholstered stools, sheltered by the timber canopy and the trees. Teal sofas, cushions, low tables and a fire pit make room for the whole group.",
      "It opens straight onto the pool terrace, and string lights and woven pendants make it especially good at night.",
    ],
    things: ["Curved bar", "Sofas round a fire pit", "Open to the pool"],
    concept: "poolbar",
    alt: "A chimp standing by the fire pit and teal sofas, the Canopy Bar behind",
  },
  {
    id: "pool",
    name: "Pool Terrace",
    where: "Upper level · front right",
    line: "Take a dip above the treetops.",
    copy: [
      "A turquoise infinity pool follows the curve of the terrace, out over the Game Room and looking across the canopy to the mountains. Loungers and seating sit around the water, with the bar just behind.",
      "At night the pool glows cyan against the amber bar and the mint lights of the house.",
    ],
    things: ["Infinity pool", "Loungers", "Canopy views"],
    alt: "A chimp wading in the turquoise pool, the Canopy Bar and the jungle beyond",
  },
  {
    id: "bridge",
    name: "Canopy Bridge & Side Entrance",
    where: "Upper level · left side",
    line: "Arrive at treetop height.",
    copy: [
      "A suspension bridge crosses the treetops to an upper-level side entrance: timber boards, dark cables and rope-wrapped handrails, with lanterns marking the way.",
      "You see the curved house through the leaves as you cross, and the bridge brings you straight onto the upstairs gallery.",
    ],
    things: ["Suspension bridge", "Side entrance", "Views through the leaves"],
    concept: "bridge",
    alt: "A chimp crossing the canopy bridge towards the side entrance of ChimpHouse",
  },
];
