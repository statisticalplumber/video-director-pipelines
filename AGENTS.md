# AGENTS.md — operating notes for agents working in video_test/

## What this is
Standalone Node scripts that drive a **remote ComfyUI** (gradio.live proxy) to generate
videos. No local GPU. Everything is ESM (`.mjs`), Node ≥ 18, no dependencies.

## Ground rules
1. **Never edit the base workflows** (`workflows/flux-t2i.json`, `workflows/ltx2_5_i2v.json`,
   `workflows/image_to_video_wan.json`). Clone them (`structuredClone`) and mutate the
   clone via the builders in `lib/comfy.mjs`.
2. **All new generation code goes through `lib/comfy.mjs`** (`run`, `download`,
   `uploadToInput`, `buildFluxGraph`, `buildLtxGraph`, `buildMergedGraph`, `buildWanGraph`).
   Don't re-implement HTTP/retries in scripts — fix the lib instead.
3. **Prompts live in `prompts/*.json`**, not in scripts. Scripts read their config from
   the matching JSON. Most new content needs **no new script** — just a new prompts JSON
   run through one of the generic runners below.
4. **Outputs go to `outputs/<project>/`**. Scripts are resumable by checking for existing
   output files — keep that pattern.
5. **Stitch with ffmpeg concat** (`-c copy`): all clips from one ComfyUI run share
   codec/resolution/fps, so stream-copy concat is safe and lossless.
6. **The project is self-contained**: all base workflow JSONs live in `video_test/workflows/`
   and are loaded from there by `lib/comfy.mjs`. No files outside `video_test/` are read
   at runtime (only the remote ComfyUI via `COMFY_BASE`).

## Scripts (current layout)
Generic runners (a new scenario = one new `prompts/<scenario>.json`, no new script):
- `director.mjs [scenario]` — N scenes, **merged** Flux→LTX per scene (one queue item each).
  JSON: `{ duration, scenes: [{ title, fluxPrompt, ltxPrompt }] }`
- `character_sequence.mjs [scenario]` — reference visual + N keyframe beats (same
  subject), **split** Flux→LTX (keyframes kept on disk). Default scenario: `anime_sequence`.
  JSON: `{ duration, referencePrompt, sequence: [{ title, image, motion }] }`
- `character_sequence_wan.mjs [scenario]` — same as above but clips use **Wan 2.1 i2v**
  (`buildWanGraph`, video-only, no audio). JSON adds optional `width`/`height` (min 16,
  step 16), `steps` (default 8), `length` (frames, 4n+1; default derived from `duration`
  at fixed 16fps), `negative`. Outputs to `outputs/<scenario>_wan/` so it never
  clobbers the LTX run of the same scenario.
Single-shot test tools:
- `run_flux_ltx_test.mjs` — one merged Flux→LTX shot; runs from
  `prompts/merged_test.json`, one named run via argv, or ad-hoc via
  `FLUX_PROMPT`/`LTX_PROMPT` env vars. Output: `outputs/merged_test/`.
- `run_flux_wan_test.mjs` — one Flux keyframe → Wan 2.1 i2v shot; config
  `prompts/wan_i2v.json` (`imagePrompt`, `motionPrompt`, width/height/length/steps),
  `--image <file>` skips Flux. Output: `outputs/wan_i2v/`.
Projects (own scripts, own output dirs):
- `movie_director.mjs [scenario]` — 20s LTX **t2v** narration at 64×64 (audio extracted, video
  throwaway) + 5× 9:16 0.5MP trailer clips → final with narration at 100% and clip
  audio mixed at 20% (`clipAudioVolume`). Scenario = `prompts/<scenario>.json`,
  outputs in `outputs/<scenario>/` (default scenario: `movie_director`).
- `man_eras.mjs` — 5-era character film (same pattern as `character_sequence`).
All runners support `--stitch` (re-stitch final only) and skip existing outputs.

## Configuration
- `COMFY_BASE` comes from `video_test/.env` (gitignored) via the tiny built-in loader
  in `lib/comfy.mjs` — **never hardcode the gradio.live URL in code or docs**.
  `.env.example` is the template. Real env vars override `.env`.

## ComfyUI API facts (verified)
- Base URL: `COMFY_BASE` (from `.env`). Endpoints used:
  `POST /prompt`, `GET /history/{id}`, `GET /view?filename&subfolder&type`,
  `POST /upload/image` (multipart: `image` file + `overwrite`),
  `GET /object_info/{Node}` (for node schemas), `GET /system_stats`, `GET /queue`.
- **The gradio.live proxy intermittently returns HTML error pages (404/502) instead of
  JSON.** All HTTP in `lib/comfy.mjs` retries on non-JSON content-type. Keep that.
- `SaveVideo` emits its file under `outputs[node].images` (not `.videos`).
- `LoadImage` can only read ComfyUI's **input** folder → external images must go through
  `uploadToInput()` first.
- History entries: `entry.outputs[nodeId]`, `entry.status.messages` contains
  `["execution_error", ...]` on failure.

## Workflow node map (the ones that matter)
`ltx2_5_i2v.json`:
- `395` LoadImage (first frame, input-folder filename)
- `398:376` PrimitiveStringMultiline (video prompt) — motion/camera description
- `403` ResolutionSelector (aspect_ratio, megapixels, multiple)
- `398:362` / `398:361` duration (s) / fps; frames = duration×fps+1
- `398:363` "Switch to Text to Video?" (false = i2v path; `buildLtxGraph` sets it true
  for t2v runs — used by movie_director for narration audio generation)
- `398:372` / `398:360` PrimitiveInt width/height — `buildLtxGraph({ size: [w, h] })`
  sets these to **literals**, bypassing ResolutionSelector (lets us go below its
  0.1MP floor, e.g. 64×64 narration runs)
- `398:383` "Enable Prompt Enhance" (false; leave false — gemma e2b not needed)
- `75` SaveVideo (final mp4)
- latent gen runs at **half** resolution (`a/2` math nodes) then 2× `LTXVLatentUpsampler`
- LTX-2.5 **generates audio** (AAC) alongside video — expected, not a bug

`flux-t2i.json`:
- `75:74` positive prompt, `75:68`/`75:69` width/height, `75:73` seed
- `75:65` VAEDecode (IMAGE) — the bridge point into the merged graph
- `9` SaveImage

Merged bridge: `398:351` (ResizeImageMaskNode) `.inputs.input = ["75:65", 0]`;
delete nodes `395` and `9`.

`workflows/image_to_video_wan.json` (Wan 2.1 i2v):
- `52` LoadImage (first frame, input-folder filename)
- `6` / `7` CLIPTextEncode positive / negative (negative = CN quality list)
- `50` WanImageToVideo (width/height min 16 step 16; `length` = frames, **4n+1**,
  step 4 — 33≈2s, 65≈4s at the fixed 16fps of `55` CreateVideo)
- `3` KSampler (8 steps, cfg 1, uni_pc/simple — few-step thanks to the AccVid LoRA)
- `56` SaveVideo (final mp4)
- Wan produces **video only** (no generated audio, unlike LTX-2.5)

## Models on the remote box (RTX 3080 Ti, 12GB)
- UNets: `flux-2-klein-9b-fp8`, `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot`,
  `wan2.1-i2v-14b-480p-Q4_K_M.gguf` (+ `Wan21_AccVid_I2V_480P_14B_lora_rank32` LoRA)
- CLIPs: `qwen_3_8b_fp4mixed` (flux), `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot` (ltx),
  `umt5_xxl_fp8_e4m3fn_scaled` (wan), `clip_vision_h` (wan CLIPVision)
- VAEs: `flux2-vae`, `ltx-2.5-video-vae-bf16`, `ltx-2.5-audio-vae-bf16`, `wan_2.1_vae`
- Upscaler: `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0`

## Performance notes
- Back-to-back runs are much faster (models stay in VRAM): ~30s vs ~120s for i2v.
- Flux decode of one frame is <1s — don't try to "optimize it away"; the VAEs are
  incompatible between Flux and LTX, pixels are the only bridge.
- Keep `megapixels` at 0.5 for 16:9 (960×512) unless quality demands otherwise.

## Debugging
- `curl $COMFY_BASE/system_stats` — is the box alive?
- `curl $COMFY_BASE/queue` — anything stuck?
- `curl $COMFY_BASE/object_info/{Node}` — node schema (required/optional inputs).
- `workflows/merged_pipeline.json` — a full merged graph for visual inspection.
- Execution errors land in `entry.status.messages` — `run()` in the lib throws with them.
