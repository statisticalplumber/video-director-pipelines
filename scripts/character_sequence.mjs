// CHARACTER SEQUENCE: 1 reference visual -> N keyframe story beats (same subject)
// -> each keyframe uploaded + fed to LTX i2v -> stitched final.
// Generic: any prompts/<scenario>.json with the anime_sequence shape.
//
// Prompt JSON shape:
//   { "duration": 3, "referencePrompt": "...",
//     "sequence": [ { "title", "image", "motion" }, ... ] }
//
// Usage:
//   node scripts/character_sequence.mjs [scenario]           # default: anime_sequence
//   node scripts/character_sequence.mjs [scenario] --stitch  # only re-stitch
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  run, download, uploadToInput,
  buildFluxGraph, buildLtxGraph, firstImageUrl, firstVideoUrl,
} from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) || "anime_sequence";

const cfgPath = path.join(here, `../prompts/${scenario}.json`);
if (!fs.existsSync(cfgPath)) {
  console.error(`[char] no prompts/${scenario}.json — available:`);
  console.error("  " + fs.readdirSync(path.join(here, "../prompts")).filter((f) => f.endsWith(".json")).join("\n  "));
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}`);
fs.mkdirSync(outDir, { recursive: true });

const seq = cfg.sequence;
const N = seq.length;

// Structured progress events for the frontend (ignored by plain terminals).
const asset = (kind, file, stage, index) =>
  console.log(`[asset] ${JSON.stringify({ kind, file, stage, index })}`);
const finalPath = path.join(outDir, `${scenario}_final.mp4`);
const tag = `[char:${scenario}]`;

function stitch() {
  const list = path.join(outDir, "concat_list.txt");
  fs.writeFileSync(list, seq.map((s, i) => `file '${scenario}_clip${i + 1}_${s.title}.mp4'`).join("\n") + "\n");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", finalPath], { stdio: "inherit" });
  console.log(`${tag} final cut -> ${finalPath}`);
}

if (process.argv.includes("--stitch")) {
  stitch();
  process.exit(0);
}

// Stage 1: reference key visual
{
  const dest = path.join(outDir, `${scenario}_ref.png`);
  if (fs.existsSync(dest)) console.log(`${tag} 1/3 reference — exists, skipping`);
  else {
    console.log(`${tag} 1/3 reference image...`);
    const entry = await run(buildFluxGraph({ prompt: cfg.referencePrompt, prefix: `${scenario}/ref` }), "ref");
    await download(firstImageUrl(entry), dest);
  }
  asset("image", path.basename(dest), "reference");
}

// Stage 2: keyframes
const keyframes = [];
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `${scenario}_seq${i + 1}_${seq[i].title}.png`);
  keyframes.push(dest);
  if (fs.existsSync(dest)) console.log(`${tag} 2/3 keyframe ${i + 1}/${N} — exists, skipping`);
  else {
    console.log(`${tag} 2/3 keyframe ${i + 1}/${N} (${seq[i].title})...`);
    const entry = await run(buildFluxGraph({ prompt: seq[i].image, prefix: `${scenario}/seq${i + 1}` }), `seq${i + 1}`);
    await download(firstImageUrl(entry), dest);
  }
  asset("image", path.basename(dest), "keyframe", i + 1);
}

// Stage 3: each keyframe -> LTX i2v clip
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `${scenario}_clip${i + 1}_${seq[i].title}.mp4`);
  if (fs.existsSync(dest)) console.log(`${tag} 3/3 clip ${i + 1}/${N} — exists, skipping`);
  else {
    console.log(`${tag} 3/3 i2v clip ${i + 1}/${N} from keyframe...`);
    const inputName = await uploadToInput(keyframes[i], `${scenario}_kf${i + 1}`);
    const graph = buildLtxGraph({
      prompt: seq[i].motion,
      image: inputName,
      duration: cfg.duration ?? 3,
      prefix: `${scenario}/clip${i + 1}_${seq[i].title}`,
    });
    const entry = await run(graph, `clip${i + 1}`);
    await download(firstVideoUrl(entry), dest);
  }
  asset("video", path.basename(dest), "clip", i + 1);
}

stitch();
asset("video", path.basename(finalPath), "final");
console.log(`${tag} DONE`);
