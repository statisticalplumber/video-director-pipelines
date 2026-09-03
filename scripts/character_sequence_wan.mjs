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
//     "sequence": [ { "title", "image", "motion" } ] }
//
// Versioning: regenerating an asset writes a new _vN file (previous versions
// are kept). The stitched final always uses the version selected as "main"
// (outputs/<scenario>_wan/state.json; default = latest).
//
// Usage:
//   node scripts/character_sequence_wan.mjs [scenario]           # default: anime_sequence
//   node scripts/character_sequence_wan.mjs [scenario] --stitch  # only re-stitch (from selected mains)
//   node scripts/character_sequence_wan.mjs [scenario] --regen ref
//   node scripts/character_sequence_wan.mjs [scenario] --regen keyframe <beat>
//   node scripts/character_sequence_wan.mjs [scenario] --regen clip <beat>
// Outputs go to outputs/<scenario>_wan/ (never clobbers the LTX run of the same scenario).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFluxGraph, buildWanGraph,
} from "../lib/comfy.mjs";
import { runSequence, stitchSequence } from "../lib/sequence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) || "anime_sequence";
const regenIdx = args.indexOf("--regen");
const regen = regenIdx >= 0
  ? { kind: args[regenIdx + 1], index: Number(args[regenIdx + 2]) || 0 }
  : null;

const cfgPath = path.join(here, `../prompts/${scenario}.json`);
if (!fs.existsSync(cfgPath)) {
  console.error(`[wanchar] no prompts/${scenario}.json — available:`);
  console.error("  " + fs.readdirSync(path.join(here, "../prompts")).filter((f) => f.endsWith(".json")).join("\n  "));
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}_wan`);
fs.mkdirSync(outDir, { recursive: true });

/** duration (s) -> Wan frame count (4n+1 at fixed 16fps). 3s -> 49, 4s -> 65. */
const wanFrames = (duration) => Math.floor((duration * 16) / 4) * 4 + 1;
const length = cfg.length ?? wanFrames(cfg.duration ?? 3);

const opts = {
  scenario,
  outDir,
  prefix: `${scenario}_wan`,
  tag: `[wanchar:${scenario}]`,
  cfg,
  buildRef: (prompt) => buildFluxGraph({ prompt, prefix: `${scenario}/wan_ref` }),
  buildKeyframe: (prompt, i) => buildFluxGraph({ prompt, prefix: `${scenario}/wan_seq${i + 1}` }),
  buildClip: (motion, image, i) => buildWanGraph({
    prompt: motion,
    image,
    width: cfg.width ?? 512,
    height: cfg.height ?? 512,
    length,
    steps: cfg.steps ?? 8,
    negative: cfg.negative,
    prefix: `${scenario}/wan_clip${i + 1}_${cfg.sequence[i].title}`,
  }),
  videoNode: "56",
};

if (process.argv.includes("--stitch")) {
  try { stitchSequence(opts); }
  catch (e) { console.error(`[wanchar] ${e.message}`); process.exit(1); }
  process.exit(0);
}

try {
  await runSequence({ ...opts, regen });
} catch (e) {
  console.error(`[wanchar] ${e.message}`);
  process.exit(1);
}
