// Single-pipeline test: Flux 2 t2i -> (pixel bridge) -> LTX-2.5 i2v -> SaveVideo.
// One queue item per run, no image saved to disk.
//
// Usage:
//   node scripts/run_flux_ltx_test.mjs                        # all runs from prompts/merged_test.json
//   node scripts/run_flux_ltx_test.mjs oil_painting_lighthouse # one named run
//   FLUX_PROMPT='...' LTX_PROMPT='...' node scripts/run_flux_ltx_test.mjs  # ad-hoc override
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, firstVideoUrl, download, buildMergedGraph } from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../outputs/merged_test");
fs.mkdirSync(outDir, { recursive: true });

const cfg = JSON.parse(fs.readFileSync(path.join(here, "../prompts/merged_test.json"), "utf8"));
let runs = cfg.runs;
if (process.argv[2]) runs = runs.filter((r) => r.name === process.argv[2]);
if (process.env.FLUX_PROMPT) {
  runs = [{ name: "adhoc", fluxPrompt: process.env.FLUX_PROMPT, ltxPrompt: process.env.LTX_PROMPT || "Subtle natural motion, cinematic, 3 seconds, no cuts.", duration: 3 }];
}

for (const r of runs) {
  const dest = path.join(outDir, `${r.name}.mp4`);
  if (fs.existsSync(dest)) { console.log(`[merged] ${r.name} — exists, skipping`); continue; }
  const graph = buildMergedGraph({
    fluxPrompt: r.fluxPrompt,
    ltxPrompt: r.ltxPrompt,
    duration: r.duration ?? 3,
    prefix: `video_test/merged_${r.name}`,
  });
  const entry = await run(graph, r.name);
  await download(firstVideoUrl(entry), dest);
  console.log(`[merged] ${r.name} -> ${dest}`);
}
console.log("[merged] DONE");
