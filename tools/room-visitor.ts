// The lightest visitor (tools/room-visitor.html): joins the room and shows where its connection stands.
import { ME, room } from "../src/engine/room";

(window as unknown as { visitor: unknown }).visitor = ME;
setInterval(() => (document.getElementById("out")!.textContent = `${ME.name} (${ME.id}): ${room.status}, joined ${room.joins} time(s)`), 250);
