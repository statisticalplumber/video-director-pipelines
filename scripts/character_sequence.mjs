// CHARACTER SEQUENCE: 1 reference visual -> N keyframe story beats (same subject)
// -> each keyframe uploaded + fed to LTX i2v -> stitched final.
// Generic: any prompts/<scenario>.json with the anime_sequence shape.
//
// Prompt JSON shape:
//   { "duration": 3, "referencePrompt": "...",
//     "sequence": [ { "title", "image", "motion" }, ... ] }
//
// Versioning: regenerating an asset writes a new _vN file (previous versions
// are kept). The stitched final always uses the version selected as "main"
// (outputs/<scenario>/state.json; default = latest).
//
// Usage:
//   node scripts/character_sequence.mjs [scenario]           # default: anime_sequence
//   node scripts/character_sequence.mjs [scenario] --stitch  # only re-stitch (from selected mains)
//   node scripts/character_sequence.mjs [scenario] --regen ref
//   node scripts/character_sequence.mjs [scenario] --regen keyframe <beat>
//   node scripts/character_sequence.mjs [scenario] --regen clip <beat>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFluxGraph, buildLtxGraph,
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
  console.error(`[char] no prompts/${scenario}.json — available:`);
  console.error("  " + fs.readdirSync(path.join(here, "../prompts")).filter((f) => f.endsWith(".json")).join("\n  "));
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}`);
fs.mkdirSync(outDir, { recursive: true });

const opts = {
  scenario,
  outDir,
  prefix: scenario,
  tag: `[char:${scenario}]`,
  cfg,
  buildRef: (prompt) => buildFluxGraph({ prompt, prefix: `${scenario}/ref` }),
  buildKeyframe: (prompt, i) => buildFluxGraph({ prompt, prefix: `${scenario}/seq${i + 1}` }),
  buildClip: (motion, image, i) => buildLtxGraph({
    prompt: motion,
    image,
    duration: cfg.duration ?? 3,
    prefix: `${scenario}/clip${i + 1}_${cfg.sequence[i].title}`,
  }),
  videoNode: "75",
};

if (process.argv.includes("--stitch")) {
  try { stitchSequence(opts); }
  catch (e) { console.error(`[char] ${e.message}`); process.exit(1); }
  process.exit(0);
}

try {
  await runSequence({ ...opts, regen });
} catch (e) {
  console.error(`[char] ${e.message}`);
  process.exit(1);
}
