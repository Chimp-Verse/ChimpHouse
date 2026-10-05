import { Camera, ColorCurves, DefaultRenderingPipeline, ImageProcessingConfiguration, Scene } from "@babylonjs/core";
import { Quality } from "./store";

/**
 * HDR pipeline: ACES tone mapping, warm grade, vignette and bloom. Emissive
 * strips, bulbs and signs are brighter than 1.0 so the bloom pass gives them
 * their glow (cheaper than a separate glow layer, and walls occlude it).
 */
export class PostFx {
  readonly pipeline: DefaultRenderingPipeline;

  constructor(
    private scene: Scene,
    camera: Camera,
  ) {
    const p = new DefaultRenderingPipeline("pipeline", true, scene, [camera]);
    p.samples = 4;
    p.fxaaEnabled = false;
    p.bloomEnabled = true;
    p.bloomThreshold = 1.0;
    p.bloomWeight = 0.45;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.sharpenEnabled = true;
    p.sharpen.edgeAmount = 0.15;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.15;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.4;
    ip.vignetteStretch = 0.2;
    ip.vignetteCameraFov = 0.9;
    ip.colorCurvesEnabled = true;
    const curves = new ColorCurves();
    curves.globalSaturation = 18;
    curves.highlightsHue = 40;
    curves.highlightsDensity = 14;
    curves.highlightsSaturation = 20;
    curves.shadowsHue = 30;
    curves.shadowsDensity = 8;
    curves.shadowsSaturation = 15;
    ip.colorCurves = curves;
    this.pipeline = p;
  }

  setNight(night: boolean): void {
    const ip = this.pipeline.imageProcessing;
    ip.exposure = night ? 1.35 : 1.15;
    this.pipeline.bloomWeight = night ? 0.6 : 0.45;
    this.pipeline.bloomThreshold = night ? 0.7 : 1.0;
  }

  setQuality(q: Quality): void {
    const p = this.pipeline;
    p.samples = q === "high" ? 4 : 1;
    p.fxaaEnabled = q !== "high";
    p.bloomEnabled = q !== "low";
    p.sharpenEnabled = q === "high";
    void this.scene;
  }
}
