// GENERIC SCENARIO DIRECTOR: any prompts/<scenario>.json with scenes[]
// -> each scene runs the merged pipeline (Flux frame -> LTX i2v)
// -> scenes are stitched into one film at outputs/<scenario>/.
//
// Prompt JSON shape:
//   { "duration": 3, "scenes": [ { "title", "fluxPrompt", "ltxPrompt" }, ... ] }
//
// Usage:
//   node scripts/director.mjs [scenario]           # default: wildlife_doc
//   node scripts/director.mjs [scenario] --stitch  # only re-stitch the final cut
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { run, firstVideoUrl, download, buildMergedGraph } from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) || "wildlife_doc";

const cfgPath = path.join(here, `../prompts/${scenario}.json`);
if (!fs.existsSync(cfgPath)) {
  console.error(`[director] no prompts/${scenario}.json — available:`);
  console.error("  " + fs.readdirSync(path.join(here, "../prompts")).filter((f) => f.endsWith(".json")).join("\n  "));
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}`);
fs.mkdirSync(outDir, { recursive: true });

const scenes = cfg.scenes;
const finalPath = path.join(outDir, `${scenario}_final.mp4`);

function stitch() {
  const list = path.join(outDir, "concat_list.txt");
  fs.writeFileSync(list, scenes.map((s, i) => `file 'scene${i + 1}_${s.title}.mp4'`).join("\n") + "\n");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", finalPath], { stdio: "inherit" });
  console.log(`[director:${scenario}] final cut -> ${finalPath}`);
}

if (process.argv.includes("--stitch")) {
  stitch();
  process.exit(0);
}

for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i];
  const dest = path.join(outDir, `scene${i + 1}_${s.title}.mp4`);
  if (fs.existsSync(dest)) { console.log(`[director:${scenario}] scene ${i + 1}/${scenes.length} — exists, skipping`); continue; }
  const graph = buildMergedGraph({
    fluxPrompt: s.fluxPrompt,
    ltxPrompt: s.ltxPrompt,
    duration: cfg.duration ?? 3,
    prefix: `video_test/${scenario}_scene${i + 1}_${s.title}`,
  });
  const entry = await run(graph, `${scenario} scene ${i + 1}/${scenes.length} (${s.title})`);
  await download(firstVideoUrl(entry), dest);
  console.log(`[director:${scenario}] scene ${i + 1}/${scenes.length} -> ${dest}`);
}
stitch();
console.log(`[director:${scenario}] DONE`);
