// MOVIE DIRECTOR: 20s National Geographic narration (LTX t2v at tiny 1:1 frame —
// video is throwaway, we extract the generated audio) + 5 cinematic 9:16 trailer
// clips (Flux keyframe -> LTX i2v, ~4s each) -> final cut: clips as video,
// narration as main audio, clips' own audio mixed under at 20%.
//
// Usage:
//   node scripts/movie_director.mjs [scenario]            # full pipeline (resumable, default: movie_director)
//   node scripts/movie_director.mjs [scenario] --stitch   # only re-stitch the final cut
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
const scenario = args.find((a) => !a.startsWith("-")) || "movie_director";
const cfg = JSON.parse(fs.readFileSync(path.join(here, `../prompts/${scenario}.json`), "utf8"));
const outDir = path.resolve(here, `../outputs/${scenario}`);
fs.mkdirSync(outDir, { recursive: true });

const seq = cfg.sequence;
const N = seq.length;
const TOTAL = cfg.narrationDuration ?? 20;
const FINAL = cfg.finalDuration ?? TOTAL; // cut the final to this many seconds (default: narration length)
const finalPath = path.join(outDir, `${scenario}_final.mp4`);

function ff(args) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
}

function stitch() {
  // 1) concat the clips (same codec/res/fps from one ComfyUI run -> stream copy)
  const concat = path.join(outDir, "clips_concat.mp4");
  const list = path.join(outDir, "concat_list.txt");
  fs.writeFileSync(list, seq.map((s, i) => `file 'movie_clip${i + 1}_${s.title}.mp4'`).join("\n") + "\n");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", concat]);

  // 2) mix audio: narration full volume (main), clip audio at clipAudioVolume,
  //    total capped at FINAL (finalDuration, default = narration length)
  const vol = cfg.clipAudioVolume ?? 0.2;
  const filter =
    `[0:a]volume=${vol},apad=whole_dur=${FINAL}[bg];` +
    `[1:a]atrim=0:${FINAL},asetpts=N/SR/TB[narr];` +
    `[narr][bg]amix=inputs=2:normalize=0,atrim=0:${FINAL},asetpts=N/SR/TB[aout]`;
  ff(["-i", concat, "-i", path.join(outDir, "narration.wav"), "-filter_complex", filter,
      "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac",
      "-t", String(FINAL), finalPath]);
  console.log(`[movie] final cut -> ${finalPath}`);
}

if (process.argv.includes("--stitch")) {
  stitch();
  process.exit(0);
}

// Stage 1: narration — LTX t2v at the smallest frame the node allows (video is
// throwaway; we only want the 20s of generated narration audio)
{
  const wav = path.join(outDir, "narration.wav");
  const mp4 = path.join(outDir, "narration_raw.mp4");
  if (fs.existsSync(wav)) console.log("[movie] 1/8 narration — exists, skipping");
  else {
    console.log(`[movie] 1/8 narration video (t2v, ${TOTAL}s, tiny frame)...`);
    const ph = path.join(outDir, "placeholder.png");
    if (!fs.existsSync(ph)) ff(["-f", "lavfi", "-i", "color=0x111111:s=64x64", "-frames:v", "1", ph]);
    const inputName = await uploadToInput(ph, "movie_ph");
    const graph = buildLtxGraph({
      prompt: cfg.narrationPrompt,
      image: inputName,
      t2v: true,
      duration: TOTAL,
      fps: cfg.narrationFps ?? 24,
      size: cfg.narrationSize ?? [64, 64], // exact WxH (bypasses ResolutionSelector's 0.1MP floor)
      prefix: "movie/narration",
    });
    const entry = await run(graph, "narration");
    await download(firstVideoUrl(entry), mp4);
    ff(["-i", mp4, "-vn", "-t", String(TOTAL), "-acodec", "pcm_s16le", "-ar", "44100", wav]);
  }
}

// Stage 2: cinematic keyframes (9:16, Flux 4 steps)
const keyframes = [];
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `movie_kf${i + 1}_${seq[i].title}.png`);
  keyframes.push(dest);
  if (fs.existsSync(dest)) { console.log(`[movie] ${i + 2}/8 keyframe ${i + 1}/${N} — exists, skipping`); continue; }
  console.log(`[movie] ${i + 2}/8 keyframe ${i + 1}/${N} (${seq[i].title})...`);
  const entry = await run(buildFluxGraph({
    prompt: seq[i].image,
    width: cfg.keyframeWidth ?? 768,
    height: cfg.keyframeHeight ?? 1280,
    prefix: `movie/kf${i + 1}`,
  }), `kf${i + 1}`);
  await download(firstImageUrl(entry), dest);
}

// Stage 3: keyframe -> LTX i2v clip (9:16, 0.5MP)
for (let i = 0; i < N; i++) {
  const dest = path.join(outDir, `movie_clip${i + 1}_${seq[i].title}.mp4`);
  if (fs.existsSync(dest)) { console.log(`[movie] ${i + 4}/8 clip ${i + 1}/${N} — exists, skipping`); continue; }
  console.log(`[movie] ${i + 4}/8 i2v clip ${i + 1}/${N}...`);
  const inputName = await uploadToInput(keyframes[i], `movie_kf${i + 1}`);
  const graph = buildLtxGraph({
    prompt: seq[i].motion,
    image: inputName,
    duration: seq[i].duration ?? 4,
    ratio: cfg.ratio ?? "9:16 (Portrait Widescreen)",
    megapixels: cfg.megapixels ?? 0.5,
    prefix: `movie/clip${i + 1}_${seq[i].title}`,
  });
  const entry = await run(graph, `clip${i + 1}`);
  await download(firstVideoUrl(entry), dest);
}

stitch();
console.log("[movie] DONE");
