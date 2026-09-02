// MAN ACROSS THE AGES: 1 reference portrait -> 5 era keyframes (same man,
// ancient -> cyberpunk) -> each keyframe drives a 3s LTX i2v clip (9:16)
// -> stitched 15s final.
//
// Usage:
//   node scripts/man_eras.mjs            # full pipeline (resumable)
//   node scripts/man_eras.mjs --stitch   # only re-stitch the final cut
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  run, download, uploadToInput,
  buildFluxGraph, buildLtxGraph, firstImageUrl, firstVideoUrl,
} from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, "../prompts/man_eras.json"), "utf8"));
const outDir = path.resolve(here, "../outputs/man_eras");
fs.mkdirSync(outDir, { recursive: true });

const seq = cfg.sequence;
const finalPath = path.join(outDir, "man_eras_final.mp4");
const N = seq.length;

function stitch() {
  const list = path.join(outDir, "concat_list.txt");
  fs.writeFileSync(list, seq.map((s, i) => `file 'man_clip${i + 1}_${s.title}.mp4'`).join("\n") + "\n");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", finalPath], { stdio: "inherit" });
  console.log(`[man] final cut -> ${finalPath}`);
}

if (process.argv.includes("--stitch")) {
  stitch();
  process.exit(0);
}

// Stage 1: reference portrait (the "same man" anchor)
{
  const dest = path.join(outDir, "man_ref.png");
  if (fs.existsSync(dest)) console.log("[man] 1/7 reference — exists, skipping");
  else {
    console.log("[man] 1/7 reference portrait...");
    const entry = await run(buildFluxGraph({ prompt: cfg.referencePrompt, prefix: "man/ref" }), "ref");
    await download(firstImageUrl(entry), dest);
  }
}

// Stage 2: era keyframes (9:16, same man in each era)
const keyframes = [];
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `man_kf${i + 1}_${seq[i].title}.png`);
  keyframes.push(dest);
  if (fs.existsSync(dest)) { console.log(`[man] ${i + 2}/7 keyframe ${i + 1}/${N} — exists, skipping`); continue; }
  console.log(`[man] ${i + 2}/7 keyframe ${i + 1}/${N} (${seq[i].title})...`);
  const entry = await run(buildFluxGraph({
    prompt: seq[i].image,
    width: cfg.keyframeWidth ?? 768,
    height: cfg.keyframeHeight ?? 1280,
    prefix: `man/kf${i + 1}`,
  }), `kf${i + 1}`);
  await download(firstImageUrl(entry), dest);
}

// Stage 3: each keyframe -> LTX i2v clip (3s, 9:16)
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `man_clip${i + 1}_${seq[i].title}.mp4`);
  if (fs.existsSync(dest)) { console.log(`[man] ${i + 4}/7 clip ${i + 1}/${N} — exists, skipping`); continue; }
  console.log(`[man] ${i + 4}/7 i2v clip ${i + 1}/${N} from keyframe...`);
  const inputName = await uploadToInput(keyframes[i], `man_kf${i + 1}`);
  const graph = buildLtxGraph({
    prompt: seq[i].motion,
    image: inputName,
    duration: cfg.duration ?? 3,
    ratio: cfg.ratio ?? "9:16 (Portrait Widescreen)",
    megapixels: cfg.megapixels ?? 0.5,
    prefix: `man/clip${i + 1}_${seq[i].title}`,
  });
  const entry = await run(graph, `clip${i + 1}`);
  await download(firstVideoUrl(entry), dest);
}

stitch();
console.log("[man] DONE");
