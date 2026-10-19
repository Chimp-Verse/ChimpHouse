// What the Game Room TV shows in the room: an idle card with no game, and the
// chosen game's card, saying who is playing it now, each player in their
// controller's colour. A player's own game (ChimpVibe's play page, another
// site's page) can't be drawn here, so engine/gameTv.ts lays it over the whole
// screen for them while they sit at the TV; everyone else sees this card.
// Showing the players' games to the room (spectating) is still to be designed.

import { roundRect } from "../materials/signs";
import { drawLeafEmblem } from "../materials/textures";
import { PLAYER_COLORS } from "./gamepad";

/** A player's colour, by controller number. */
export function playerColor(controller: number): string {
  return PLAYER_COLORS[(controller - 1) % PLAYER_COLORS.length];
}

export type TvCard =
  | { kind: "idle" }
  /** the game failed to connect: static, with a small notice over it */
  | { kind: "failed"; name: string; reason: string }
  | {
      kind: "game";
      name: string;
      author: string;
      art: HTMLImageElement | null;
      palette: string[];
      /** who is playing, by controller number */
      players: { controller: number; name: string }[];
      /** a line under the name while nobody plays */
      note: string;
    };

export function drawTvCard(ctx: CanvasRenderingContext2D, card: TvCard, w: number, h: number): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (card.kind === "failed") return drawFailed(ctx, card, w, h);
  if (card.kind === "idle") {
    const bg = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.05, w / 2, h / 2, w * 0.7);
    bg.addColorStop(0, "#1d2c3f");
    bg.addColorStop(1, "#080b12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    drawLeafEmblem(ctx, w / 2, h * 0.3, h * 0.12, "#7ff0c4");
    ctx.fillStyle = "#e9f6ff";
    ctx.font = `800 ${Math.round(h * 0.1)}px Nunito`;
    ctx.fillText("ChimpVibe TV", w / 2, h * 0.5, w * 0.86);
    ctx.fillStyle = "#a9bdd3";
    ctx.font = `600 ${Math.round(h * 0.048)}px Montserrat`;
    ctx.fillText("Pick up the remote on the coffee table to choose a game", w / 2, h * 0.65, w * 0.86);
    ctx.font = `500 ${Math.round(h * 0.038)}px Montserrat`;
    ctx.fillText("then grab a controller and play together", w / 2, h * 0.74, w * 0.86);
    return;
  }
  drawArt(ctx, card, 0, 0, w, h, card.players.length ? 0.45 : 1);
  // a band for the name, and how to join or who is playing
  const playing = card.players.length > 0;
  const bh = h * (playing ? 0.44 : 0.24);
  ctx.fillStyle = "rgba(6, 8, 12, 0.8)";
  ctx.fillRect(0, h - bh, w, bh);
  if (!playing) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${Math.round(h * 0.075)}px Nunito`;
    ctx.fillText(card.name, w / 2, h - bh * 0.64, w * 0.9);
    ctx.fillStyle = "#c8d6e6";
    ctx.font = `600 ${Math.round(h * 0.04)}px Montserrat`;
    ctx.fillText(card.note, w / 2, h - bh * 0.26, w * 0.9);
    return;
  }
  const top = h - bh;
  ctx.fillStyle = "#7ff0c4";
  ctx.font = `700 ${Math.round(h * 0.04)}px Montserrat`;
  ctx.fillText("P L A Y I N G   N O W", w / 2, top + bh * 0.16, w * 0.9);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(h * 0.08)}px Nunito`;
  ctx.fillText(card.name, w / 2, top + bh * 0.4, w * 0.9);
  // the players, as tags in their controllers' colours
  const fs = Math.round(h * 0.042);
  ctx.font = `800 ${fs}px Nunito`;
  const tags = card.players.map((p) => ({ text: `P${p.controller}  ${p.name}`, color: playerColor(p.controller) }));
  const pad = fs * 0.7;
  const widths = tags.map((t) => Math.min(w * 0.3, ctx.measureText(t.text).width + pad * 2));
  const gap = fs * 0.6;
  let x = w / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (tags.length - 1)) / 2;
  const y = top + bh * 0.74;
  tags.forEach((t, i) => {
    ctx.fillStyle = t.color;
    roundRect(ctx, x, y - fs * 0.8, widths[i], fs * 1.6, fs * 0.8);
    ctx.fill();
    ctx.fillStyle = "#08090d";
    ctx.fillText(t.text, x + widths[i] / 2, y, widths[i] - pad);
    x += widths[i] + gap;
  });
}

/** The game's art over a part of the screen, filling it, at `alpha`; its colours without art. */
function drawArt(ctx: CanvasRenderingContext2D, card: Extract<TvCard, { kind: "game" }>, x: number, y: number, w: number, h: number, alpha: number): void {
  if (!card.art) {
    const bg = ctx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, w * 0.7);
    bg.addColorStop(0, card.palette[2] ?? "#4fb98a");
    bg.addColorStop(1, card.palette[0] ?? "#1b2a24");
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    return;
  }
  const img = card.art;
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * k;
  const ih = img.naturalHeight * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  ctx.restore();
}

/** A small canvas of noise, drawn afresh for each frame of static and stretched over the screen. */
const noise = document.createElement("canvas");
noise.width = 320;
noise.height = 180;

/**
 * A screen of static, a frame of it each time it is drawn, with a notice over
 * it: "Failed to connect", the game, why, and how to clear it.
 */
function drawFailed(ctx: CanvasRenderingContext2D, card: Extract<TvCard, { kind: "failed" }>, w: number, h: number): void {
  const nctx = noise.getContext("2d")!;
  const img = nctx.createImageData(noise.width, noise.height);
  const d = img.data;
  // a brighter band rolls down the screen
  const band = ((performance.now() / 1600) % 1.4) - 0.2;
  for (let y = 0; y < noise.height; y++) {
    const lift = Math.max(0, 1 - Math.abs(y / noise.height - band) * 9) * 60;
    for (let x = 0; x < noise.width; x++) {
      const v = Math.min(255, Math.random() * 200 + lift);
      const i = (y * noise.width + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(noise, 0, 0, w, h);
  ctx.restore();
  // the notice, small, in the middle
  const bw = w * 0.42;
  const bh = h * 0.27;
  const x = (w - bw) / 2;
  const y = (h - bh) / 2;
  ctx.fillStyle = "rgba(10, 12, 18, 0.88)";
  roundRect(ctx, x, y, bw, bh, h * 0.02);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 120, 100, 0.85)";
  ctx.lineWidth = Math.max(2, h * 0.004);
  ctx.stroke();
  ctx.fillStyle = "#ff8a73";
  ctx.font = `800 ${Math.round(h * 0.058)}px Nunito`;
  ctx.fillText("Failed to connect", w / 2, y + bh * 0.3, bw * 0.9);
  ctx.fillStyle = "#e6ebf2";
  ctx.font = `600 ${Math.round(h * 0.03)}px Montserrat`;
  ctx.fillText(card.reason ? `${card.name}: ${card.reason}` : card.name, w / 2, y + bh * 0.58, bw * 0.9);
  ctx.fillStyle = "#9aa7b8";
  ctx.font = `500 ${Math.round(h * 0.025)}px Montserrat`;
  ctx.fillText("Turn the TV off with the remote", w / 2, y + bh * 0.8, bw * 0.9);
}
