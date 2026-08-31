// MAKE MUSIC: music-only generation via the movie pipeline's audio workflow —
// LTX t2v at the smallest frame the node allows (video is throwaway, we extract
// the generated audio). Optionally lays the track onto an existing video with
// the video's own audio ducked underneath.
//
// Prompt JSON shape:
//   { "musicPrompt", "duration", "fps"=24, "size"=[64,64],
//     "video" (optional path, relative to video_test/),
//     "videoVolume"=0.25, "musicVolume"=1.0, "out" (optional) }
//
// Usage:
//   node scripts/make_music.mjs [scenario]   # default: music_boy_school
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  run, download, uploadToInput,
  buildLtxGraph, firstVideoUrl,
} from "../lib/comfy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("-")) || "music_boy_school";
const cfg = JSON.parse(fs.readFileSync(path.join(here, `../prompts/${scenario}.json`), "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}`);
fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve(here, "..");

const TOTAL = cfg.duration ?? 10;

function ff(args) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
}

// 1) Generate the music: LTX t2v at the smallest frame the node allows
{
  const wav = path.join(outDir, `${scenario}.wav`);
  if (fs.existsSync(wav)) console.log(`[music] track exists, skipping generation: ${wav}`);
  else {
    console.log(`[music] generating ${TOTAL}s music (t2v, tiny frame)...`);
    const mp4 = path.join(outDir, `${scenario}_raw.mp4`);
    const ph = path.join(outDir, "placeholder.png");
    if (!fs.existsSync(ph)) ff(["-f", "lavfi", "-i", "color=0x111111:s=64x64", "-frames:v", "1", ph]);
    const inputName = await uploadToInput(ph, `${scenario}_ph`);
    const graph = buildLtxGraph({
      prompt: cfg.musicPrompt,
      image: inputName,
      t2v: true,
      duration: TOTAL,
      fps: cfg.fps ?? 24,
      size: cfg.size ?? [64, 64],
      prefix: `${scenario}/music`,
    });
    const entry = await run(graph, "music");
    await download(firstVideoUrl(entry), mp4);
    ff(["-i", mp4, "-vn", "-t", String(TOTAL), "-acodec", "pcm_s16le", "-ar", "44100", wav]);
    console.log(`[music] track -> ${wav}`);
  }
}

// 2) Optional: lay the music onto an existing video (video audio ducked under)
if (cfg.video) {
  const src = path.resolve(root, cfg.video);
  const dest = path.resolve(root, cfg.out || path.join(outDir, `${scenario}_with_music.mp4`));
  const vvol = cfg.videoVolume ?? 0.25;
  const mvol = cfg.musicVolume ?? 1.0;
  const filter =
    `[0:a]volume=${vvol},apad=whole_dur=${TOTAL}[bg];` +
    `[1:a]atrim=0:${TOTAL},asetpts=N/SR/TB[mus];` +
    `[mus][bg]amix=inputs=2:normalize=0,atrim=0:${TOTAL},asetpts=N/SR/TB[aout]`;
  ff(["-i", src, "-i", path.join(outDir, `${scenario}.wav`), "-filter_complex", filter,
      "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac",
      "-t", String(TOTAL), dest]);
  console.log(`[music] final -> ${dest}`);
}
console.log("[music] DONE");
