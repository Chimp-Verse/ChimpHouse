import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/700.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "./ui/hud.css";
import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(<App />);
