# frontend — web UI for the character-sequence pipeline

React + TypeScript (Vite) UI over `scripts/character_sequence.mjs`. A tiny
zero-dependency Node server (`server.mjs`) spawns the script, streams its logs
over SSE, and serves `outputs/` for in-browser preview.

## Run

```bash
npm install
npm run build     # once (or after changing src/)
npm run serve     # backend + built UI on http://localhost:8790
```

Dev mode with hot reload (two terminals):

```bash
npm run serve     # API backend on :8790
npm run dev       # vite dev server on :5173 (proxies /api + /outputs to :8790)
```

## Features

- **Craft with LLM** — write a high-level topic + requirements; the local
  model (llama-server, OpenAI-compatible, `LLM_BASE` in the project root `.env`) crafts
  a full scenario JSON using `prompts/anime_sequence.json` as the in-prompt
  format reference. Result loads as an unsaved draft in the editor — review,
  tweak, then Save (writes `prompts/<name>.json`) and run.
- **Scenario picker** — lists `prompts/*.json` that have the
  character-sequence shape (`referencePrompt` + `sequence`).
- **Editor** — edit reference prompt, clip duration, and each beat's
  keyframe/motion prompts; Save writes back to `prompts/<scenario>.json`.
- **Run panel** — start a resumable run, re-stitch only, stop; live log tail (SSE).
  Engine toggle **LTX 2.5 / Wan 2.1** (Wan writes to `outputs/<scenario>_wan/`).
  Only one run at a time (the ComfyUI queue is serial).
- **Live assets** — finished files stream into the UI as soon as each stage
  completes (the script emits `[asset]` events, forwarded over SSE), so you
  can watch generation and Stop early if a result is unsatisfying.
- **Outputs** — final cut, reference image, keyframes with their clips,
  served from `outputs/<scenario>/`.
- **ComfyUI status pill** — polls `/api/comfy` (system_stats + queue) every 15s.

## API (server.mjs)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/craft` | POST `{topic, requirements}` | LLM crafts a scenario JSON (validated) |
| `/api/scenarios` | GET | list prompt JSONs + `isSequence` flag |
| `/api/scenario/:name` | GET / PUT | read / save scenario config |
| `/api/runs` | POST `{scenario, stitch?, engine?}` | spawn the ltx/wan sequence script |
| `/api/runs` | GET | list runs (status + log) |
| `/api/runs/:id/logs` | GET | SSE log tail (`event: close` on exit) |
| `/api/runs/:id` | DELETE | kill a running run |
| `/api/outputs?scenario=` | GET | list files in `outputs/<scenario>/` |
| `/api/comfy` | GET | remote ComfyUI system_stats + queue |
| `/outputs/<scenario>/<file>` | GET | stream an output asset (video/image) |

`COMFY_BASE` and `LLM_BASE` are read from the project root `.env` (same loader as
`lib/comfy.mjs`). The LLM call uses `/v1/chat/completions` with
`chat_template_kwargs: {enable_thinking: false}` (Qwen3 thinking off).

## Layout

```
frontend/
├── server.mjs               # zero-dep backend (API + static dist/)
├── src/
│   ├── App.tsx              # scenario picker + layout + comfy status
│   ├── api.ts               # fetch/EventSource helpers
│   ├── types.ts
│   └── components/
│       ├── CraftPanel.tsx       # topic + requirements -> LLM-crafted draft
│       ├── ScenarioEditor.tsx   # prompts JSON editor
│       ├── RunPanel.tsx         # run/stitch/stop + live log
│       └── OutputGallery.tsx    # final / ref / keyframes+clips
└── dist/                    # vite build output (served by server.mjs)
```
