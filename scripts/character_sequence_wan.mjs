// CHARACTER SEQUENCE (WAN): 1 reference visual -> N keyframe story beats (same
// subject) -> each keyframe uploaded + fed to Wan 2.1 i2v -> stitched final.
// Same scenario JSON shape as character_sequence.mjs; clips are built with
// buildWanGraph (wan2.1-i2v-14b GGUF + AccVid LoRA) instead of LTX.
//
// Wan facts: fixed 16fps, length = frames (4n+1, step 4), width/height min 16
// step 16, 8 steps default, VIDEO ONLY (no generated audio, unlike LTX-2.5).
//
// Prompt JSON shape:
//   { "duration": 3, "referencePrompt": "...", "width"=512, "height"=512,
//     "steps"=8, "negative" (optional),
//     "sequence": [ { "title", "image", "motion" }, ... ] }
//
// Usage:
//   node scripts/character_sequence_wan.mjs [scenario]           # default: anime_sequence
//   node scripts/character_sequence_wan.mjs [scenario] --stitch  # only re-stitch
// Outputs go to outputs/<scenario>_wan/ (never clobbers the LTX run of the same scenario).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  run, download, uploadToInput,
  buildFluxGraph, buildWanGraph, firstImageUrl, firstVideoUrl,
} from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) || "anime_sequence";

const cfgPath = path.join(here, `../prompts/${scenario}.json`);
if (!fs.existsSync(cfgPath)) {
  console.error(`[wanchar] no prompts/${scenario}.json — available:`);
  console.error("  " + fs.readdirSync(path.join(here, "../prompts")).filter((f) => f.endsWith(".json")).join("\n  "));
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}_wan`);
fs.mkdirSync(outDir, { recursive: true });

const seq = cfg.sequence;
const N = seq.length;
const finalPath = path.join(outDir, `${scenario}_wan_final.mp4`);
const tag = `[wanchar:${scenario}]`;

// Structured progress events for the frontend (ignored by plain terminals).
const asset = (kind, file, stage, index) =>
  console.log(`[asset] ${JSON.stringify({ kind, file, stage, index })}`);

/** duration (s) -> Wan frame count (4n+1 at fixed 16fps). 3s -> 49, 4s -> 65. */
function wanFrames(duration) {
  return Math.floor((duration * 16) / 4) * 4 + 1;
}

function stitch() {
  const list = path.join(outDir, "concat_list.txt");
  fs.writeFileSync(list, seq.map((s, i) => `file '${scenario}_wan_clip${i + 1}_${s.title}.mp4'`).join("\n"));
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", finalPath], { stdio: "inherit" });
  console.log(`${tag} final cut -> ${finalPath}`);
}

if (process.argv.includes("--stitch")) {
  stitch();
  process.exit(0);
}

// Stage 1: reference key visual (Flux)
{
  const dest = path.join(outDir, `${scenario}_wan_ref.png`);
  if (fs.existsSync(dest)) console.log(`${tag} 1/3 reference — exists, skipping`);
  else {
    console.log(`${tag} 1/3 reference image...`);
    const entry = await run(buildFluxGraph({ prompt: cfg.referencePrompt, prefix: `${scenario}/wan_ref` }), "ref");
    await download(firstImageUrl(entry), dest);
  }
  asset("image", path.basename(dest), "reference");
}

// Stage 2: keyframes (Flux) — same subject, N story beats
const keyframes = [];
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `${scenario}_wan_seq${i + 1}_${seq[i].title}.png`);
  keyframes.push(dest);
  if (fs.existsSync(dest)) console.log(`${tag} 2/3 keyframe ${i + 1}/${N} — exists, skipping`);
  else {
    console.log(`${tag} 2/3 keyframe ${i + 1}/${N} (${seq[i].title})...`);
    const entry = await run(buildFluxGraph({ prompt: seq[i].image, prefix: `${scenario}/wan_seq${i + 1}` }), `seq${i + 1}`);
    await download(firstImageUrl(entry), dest);
  }
  asset("image", path.basename(dest), "keyframe", i + 1);
}

// Stage 3: each keyframe -> Wan 2.1 i2v clip
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `${scenario}_wan_clip${i + 1}_${seq[i].title}.mp4`);
  if (fs.existsSync(dest)) console.log(`${tag} 3/3 clip ${i + 1}/${N} — exists, skipping`);
  else {
    const length = cfg.length ?? wanFrames(cfg.duration ?? 3);
    console.log(`${tag} 3/3 Wan i2v clip ${i + 1}/${N} (${cfg.width ?? 512}x${cfg.height ?? 512}, ${length} frames, ${cfg.steps ?? 8} steps)...`);
    const inputName = await uploadToInput(keyframes[i], `${scenario}_wan_kf${i + 1}`);
    const graph = buildWanGraph({
      prompt: seq[i].motion,
      image: inputName,
      width: cfg.width ?? 512,
      height: cfg.height ?? 512,
      length,
      steps: cfg.steps ?? 8,
      negative: cfg.negative,
      prefix: `${scenario}/wan_clip${i + 1}_${seq[i].title}`,
    });
    const entry = await run(graph, `clip${i + 1}`);
    await download(firstVideoUrl(entry, "56"), dest); // Wan SaveVideo is node 56
  }
  asset("video", path.basename(dest), "clip", i + 1);
}

stitch();
asset("video", path.basename(finalPath), "final");
console.log(`${tag} DONE`);
