// Generic Wan 2.1 image-to-video pipeline:
//   Flux keyframe (imagePrompt)  ->  Wan i2v (motionPrompt)  ->  outputs/wan_i2v/
// Config: prompts/wan_i2v.json (imagePrompt, motionPrompt, width, height, length, steps)
//
// Usage:
//   node scripts/run_flux_wan_test.mjs                     # Flux keyframe -> Wan i2v
//   node scripts/run_flux_wan_test.mjs --image <file.png>  # skip Flux, animate this image
// Resumable: existing keyframe/video are skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  run, download, uploadToInput,
  buildFluxGraph, buildWanGraph, firstImageUrl, firstVideoUrl,
} from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, "../prompts/wan_i2v.json"), "utf8"));
const outDir = path.resolve(here, "../outputs/wan_i2v");
fs.mkdirSync(outDir, { recursive: true });

const imgArg = process.argv.indexOf("--image");
const externalImage = imgArg > -1 ? path.resolve(process.argv[imgArg + 1]) : null;

// Stage 1: keyframe — Flux t2i, or an externally provided image
let keyframe;
if (externalImage) {
  keyframe = externalImage;
  console.log(`[wan] keyframe: using provided image ${keyframe}`);
} else {
  keyframe = path.join(outDir, "keyframe.png");
  if (fs.existsSync(keyframe)) console.log("[wan] keyframe — exists, skipping");
  else {
    console.log("[wan] keyframe (Flux 4-step)...");
    const entry = await run(buildFluxGraph({
      prompt: cfg.imagePrompt,
      width: cfg.keyframeWidth ?? 1280,
      height: cfg.keyframeHeight ?? 720,
      prefix: "wan/keyframe",
    }), "wan-kf");
    await download(firstImageUrl(entry), keyframe);
  }
}

// Stage 2: Wan i2v animate
const dest = path.join(outDir, "wan_result.mp4");
if (fs.existsSync(dest)) console.log("[wan] result — exists, skipping");
else {
  console.log(`[wan] Wan i2v (${cfg.width ?? 512}x${cfg.height ?? 512}, ${cfg.length ?? 33} frames, ${cfg.steps ?? 8} steps)...`);
  const inputName = await uploadToInput(keyframe, "wan_kf");
  const entry = await run(buildWanGraph({
    prompt: cfg.motionPrompt,
    image: inputName,
    width: cfg.width ?? 512,
    height: cfg.height ?? 512,
    length: cfg.length ?? 33,
    steps: cfg.steps ?? 8,
    prefix: "wan/result",
  }), "wan");
  await download(firstVideoUrl(entry, "56"), dest);
}
console.log(`[wan] result -> ${dest}`);
console.log("[wan] DONE");
