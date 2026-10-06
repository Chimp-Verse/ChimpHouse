// What the theatre screen and the "Now Showing" lightbox show while nobody is
// watching there: an idle card when nothing has been chosen, otherwise the
// chosen video's poster. The room builds them with the idle card;
// engine/theatre.ts redraws them as videos are chosen.
//
// YouTube's rules for a thumbnail: shown whole and unaltered, with YouTube
// credited as the source. So the poster draws the thumbnail uncropped and keeps
// the title, the credit and any note in a band of their own beneath it.

import { makeCanvas } from "../materials/canvas";
import { roundRect } from "../materials/signs";
import { drawLeafEmblem } from "../materials/textures";

export type TheatreCard =
  | { kind: "idle" }
  | {
      kind: "poster";
      title: string;
      channel: string;
      /** the video's YouTube thumbnail (16:9), once it has loaded */
      thumb: HTMLImageElement | null;
      live: boolean;
      /** a line under the title: how to watch, or what went wrong */
      note: string;
      /** the note is a problem */
      warn?: boolean;
    };

/** A 16:9 canvas showing a card, sized for the screen (1280 wide) or the lightbox (640). */
export function theatreCardCanvas(card: TheatreCard, w = 1280): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(w, Math.round((w * 9) / 16));
  drawTheatreCard(ctx, card, canvas.width, canvas.height);
  return canvas;
}

export function drawTheatreCard(ctx: CanvasRenderingContext2D, card: TheatreCard, w: number, h: number): void {
  const bg = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.05, w / 2, h / 2, w * 0.7);
  bg.addColorStop(0, "#2b1e15");
  bg.addColorStop(1, "#0c0907");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (card.kind === "idle") {
    ctx.strokeStyle = "rgba(201, 163, 106, 0.55)";
    ctx.lineWidth = Math.max(2, h * 0.006);
    roundRect(ctx, h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08, h * 0.03);
    ctx.stroke();
    drawLeafEmblem(ctx, w / 2, h * 0.3, h * 0.13, "#7ff0c4");
    ctx.fillStyle = "#ffe3a8";
    ctx.font = `700 ${Math.round(h * 0.1)}px Cinzel`;
    ctx.fillText("CHIMPHOUSE THEATRE", w / 2, h * 0.5, w * 0.86);
    ctx.fillStyle = "#c9bba3";
    ctx.font = `600 ${Math.round(h * 0.055)}px Montserrat`;
    ctx.fillText("Nothing showing yet", w / 2, h * 0.64, w * 0.86);
    ctx.font = `500 ${Math.round(h * 0.036)}px Montserrat`;
    ctx.fillText("Choose a YouTube video or stream in the Theatre panel", w / 2, h * 0.76, w * 0.86);
    return;
  }
  // the thumbnail, whole, above a band for the title, the credit and the note
  const band = h * 0.24;
  const th = h - band - h * 0.04;
  const tw = (th * 16) / 9;
  const tx = (w - tw) / 2;
  const ty = h * 0.03;
  if (card.thumb) ctx.drawImage(card.thumb, tx, ty, tw, th);
  else {
    ctx.fillStyle = "#000";
    ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    const s = th * 0.12;
    ctx.moveTo(w / 2 - s * 0.6, ty + th / 2 - s);
    ctx.lineTo(w / 2 + s, ty + th / 2);
    ctx.lineTo(w / 2 - s * 0.6, ty + th / 2 + s);
    ctx.closePath();
    ctx.fill();
  }
  const y0 = ty + th;
  ctx.fillStyle = "#f6efe2";
  ctx.font = `800 ${Math.round(band * 0.3)}px Nunito`;
  ctx.fillText(ellipsize(ctx, card.title, w * 0.9), w / 2, y0 + band * 0.3);
  const credit = `▶ YouTube${card.channel ? ` · ${card.channel}` : ""}${card.live ? " · LIVE" : ""}`;
  ctx.font = `600 ${Math.round(band * 0.17)}px Montserrat`;
  ctx.fillStyle = card.warn ? "#ffb25e" : "#c9bba3";
  ctx.fillText(ellipsize(ctx, card.note ? `${credit}  —  ${card.note}` : credit, w * 0.9), w / 2, y0 + band * 0.62);
}

/** `text` cut short with an ellipsis to fit `maxW` in the current font. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
