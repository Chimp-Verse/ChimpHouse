// The welcome page (index.html): the same fonts and colours as the house's own screens.
import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/700.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "./site.css";
import { Site } from "./Site";

createRoot(document.getElementById("root")!).render(<Site />);
