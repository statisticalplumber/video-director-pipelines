# comfyui-video-pipelines — Flux 2 + LTX-2.5 + Wan 2.1 video generation

Generates videos on a remote ComfyUI using base workflows from `workflows/`:

- **Flux 2 Klein 9B** (`flux-t2i.json`) — text-to-image first frames
- **LTX-2.5 22B** (`ltx2_5_i2v.json`) — image-to-video with audio (int8, half-res gen + 2× latent upscale)

## Quick start

```bash
# 1) Single-pipeline test: t2i frame -> i2v video, one queue item, no image on disk
node scripts/run_flux_ltx_test.mjs oil_painting_lighthouse
FLUX_PROMPT='...' LTX_PROMPT='...' node scripts/run_flux_ltx_test.mjs   # ad-hoc

# 2) Wildlife documentary: 4 x 3s scenes -> 12s film
node scripts/director.mjs

# 3) Anime sequence: ref image -> 4 keyframes -> 4 i2v clips -> 12s film
node scripts/character_sequence.mjs anime_sequence
```

All scripts are **resumable**: any stage whose output file already exists is skipped.
Re-stitch a final cut without regenerating: `node scripts/director.mjs --stitch`.

## Frontend (web UI)

`frontend/` is a React + TypeScript (Vite) UI over the character-sequence
pipeline, with a tiny zero-dependency Node backend (`frontend/server.mjs`):

```bash
cd frontend && npm install && npm run build && npm run serve
# -> http://localhost:8790
```

- **Craft** — a local LLM (`LLM_BASE`, llama-server / OpenAI-compatible) turns a
  topic + requirements into a full scenario JSON draft
- **Edit** — scenario picker + editor over `prompts/*.json`
- **Run** — resumable runs with live log (SSE), **LTX 2.5 / Wan 2.1** engine
  toggle, live asset preview (files appear as each stage finishes), Stop
- **Outputs** — final cut, reference, keyframes + clips in the browser

See `frontend/README.md` for the API and layout.

## Layout

```
comfyui-video-pipelines/
├── README.md            # this file
├── AGENTS.md            # agent operating notes (architecture, gotchas)
├── lib/
│   └── comfy.mjs        # shared ComfyUI client + graph builders (import from here)
├── prompts/
│   ├── merged_test.json     # artistic t2i->i2v test runs
│   ├── wildlife_doc.json    # 4-scene documentary (story beats + prompts)
│   └── anime_sequence.json  # character + 4 keyframe beats
├── frontend/
│   ├── server.mjs             # zero-dep Node backend (API + SSE + static UI)
│   ├── src/                   # React + TypeScript UI (Vite)
│   └── dist/                  # built UI (served by server.mjs)
├── scripts/
│   ├── run_flux_ltx_test.mjs  # single merged pipeline (t2i -> i2v)
│   ├── director.mjs         # scene-by-scene documentary + stitch
│   ├── character_sequence.mjs # ref + keyframe beats -> clips + stitch (generic: [scenario])
│   └── character_sequence_wan.mjs # same, with Wan 2.1 i2v (outputs/<scenario>_wan/)
├── workflows/
│   ├── flux-t2i.json          # Flux 2 Klein t2i base graph (cloned by builders)
│   ├── ltx2_5_i2v.json        # LTX-2.5 i2v base graph (cloned by builders)
│   ├── image_to_video_wan.json # Wan 2.1 i2v base graph (cloned by builders)
│   └── merged_pipeline.json   # last built merged graph (debug reference)
└── outputs/
    ├── merged_test/         # standalone test videos
    ├── wildlife_doc/        # scenes + the_rivers_dawn_final.mp4
    └── anime_sequence/      # ref, keyframes, clips + <scenario>_final.mp4
```

## Environment

Copy `.env.example` to `.env` and set your URL (`.env` is gitignored):

```bash
COMFY_BASE="https://YOUR-COMFYUI-HOST:8188"
```

| Var | Default | Meaning |
|-----|---------|---------|
| `COMFY_BASE` | *(required, from `.env`)* | ComfyUI API base (host:port) |
| `LLM_BASE` | *(optional, frontend Craft)* | local LLM base URL (llama-server, OpenAI-compatible) |
| `WORKFLOWS_DIR` | `workflows/` (inside the repo) | where the base workflow JSONs live |

`lib/comfy.mjs` loads `.env` automatically (tiny built-in parser, no deps; real
environment variables always win). No API keys needed. Node ≥ 18 (uses global
`fetch`/`FormData`). `ffmpeg` required for stitching.

## How it works

### Merged pipeline (no image on disk)
Flux and LTX use **different VAEs**, so latents can't be shared — but a pixel bridge works:

```
Flux UNet -> SamplerCustomAdvanced -> VAEDecode (flux2-vae)
    └─ IMAGE ─> ResizeImageMask -> LTXVPreprocess -> LTXVImgToVideoInplace
                -> LTX 2.5 sampler (8+4 steps) -> 2x latent upscale -> VAE decode
                -> CreateVideo (h264 + generated AAC audio) -> SaveVideo
```

Built by `buildMergedGraph()` in `lib/comfy.mjs` (merges both JSONs, rewires node `398:351`
to consume Flux's `VAEDecode` output, drops `LoadImage` + Flux `SaveImage`).

### Keyframe pipeline (anime)
Keyframes are generated as images, **uploaded to ComfyUI's input folder**
(`/upload/image`) and loaded via `LoadImage` — because LTX's i2v node can only condition
on an input-folder image, not an in-graph tensor from another model.

## Knobs (per graph builder, see `lib/comfy.mjs`)

- `duration` (s), `fps` — video length (frames = duration×fps+1)
- `megapixels` — 0.5 → 960×512 @16:9; 1.0 → ~1280×720 (slower)
- `ratio` — any `ResolutionSelector` option, e.g. `"9:16 (Portrait Widescreen)"`
- `fluxPrompt` / `ltxPrompt` — the LTX prompt should describe **motion + camera**,
  the Flux prompt the **static key frame**; keep them consistent

## Typical timings (RTX 3080 Ti, 960×512, 3s)

| Stage | Time |
|-------|------|
| Flux 2 Klein 9B, 20 steps, 1280×768 | ~45–55s |
| LTX-2.5 i2v (8+4 steps, half-res + upscale) | ~30–120s (faster when model stays warm) |
| Full merged pipeline | ~90–120s |
