// Shared ComfyUI client + workflow graph builders.
// All scripts in ../scripts import from here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- env
// Minimal .env loader (no deps): reads video_test/.env, never overrides
// variables already set in the environment.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let [, key, val] = m;
    val = val.replace(/^["'](.*)["']$/, "$1");
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(path.resolve(__dirname, "../.env"));

export const BASE = (process.env.COMFY_BASE || "").replace(/\/+$/, "");
if (!BASE) {
  console.error("COMFY_BASE is not set. Copy .env.example to .env and set COMFY_BASE there.");
  process.exit(1);
}

// Base workflow JSONs live in video_test/workflows (override with WORKFLOWS_DIR)
const WF_DIR = process.env.WORKFLOWS_DIR || path.resolve(__dirname, "../workflows");
const fluxBase = JSON.parse(fs.readFileSync(path.join(WF_DIR, "flux-t2i.json"), "utf8"));
const ltxBase = JSON.parse(fs.readFileSync(path.join(WF_DIR, "ltx2_5_i2v.json"), "utf8"));
const wanBase = JSON.parse(fs.readFileSync(path.join(WF_DIR, "image_to_video_wan.json"), "utf8"));

// ---------------------------------------------------------------- HTTP core

// The ComfyUI endpoint intermittently returns HTML error pages — retry until JSON.
export async function fetchJson(url, opts, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        console.log(`  (proxy returned ${r.status}, retrying...)`);
        await sleep(5000 * (i + 1));
        continue;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ` + JSON.stringify(d));
      return d;
    } catch (e) {
      if (e.message.startsWith("HTTP")) throw e;
      console.log(`  (fetch failed: ${e.message}, retrying...)`);
      await sleep(5000 * (i + 1));
    }
  }
  throw new Error(`fetchJson gave up: ${url}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randSeed = () => Math.floor(Math.random() * 1e15);

/** Queue a graph, return { number, prompt_id }. */
export async function queue(prompt) {
  return fetchJson(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

/** Poll /history/<id> until the item completes. Returns the history entry. */
export async function wait(promptId, label = "", timeoutMs = 30 * 60 * 1000) {
  const t0 = Date.now();
  while (true) {
    const h = await fetchJson(`${BASE}/history/${promptId}`);
    const e = h[promptId];
    if (e) {
      if (e.status?.messages?.some((m) => m[0] === "execution_error"))
        throw new Error(`EXEC ERROR ${label}: ` + JSON.stringify(e.status));
      if (label) console.log(`  ${label} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return e;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timeout waiting for ${label}`);
    await sleep(5000);
  }
}

/** Run a graph end-to-end: queue + wait. */
export async function run(prompt, label = "") {
  const { prompt_id } = await queue(prompt);
  console.log(`  queued ${label || ""} (${prompt_id})`);
  return wait(prompt_id, label);
}

/** Download a /view asset (retries on proxy HTML). */
export async function download(url, dest) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url);
    const ct = r.headers.get("content-type") || "";
    if (r.ok && !ct.includes("html")) {
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return dest;
    }
    console.log(`  (download got ${r.status}/${ct}, retrying...)`);
    await sleep(5000 * (i + 1));
  }
  throw new Error(`download failed: ${url}`);
}

/** Upload a local file into ComfyUI's input folder. Returns the input filename. */
export async function uploadToInput(file, namePrefix = "upload") {
  const buf = fs.readFileSync(file);
  const uniqueFilename = `${namePrefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.png`;
  const fd = new FormData();
  fd.append("image", new Blob([buf]), uniqueFilename);
  fd.append("overwrite", "false");
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(`${BASE}/upload/image`, { method: "POST", body: fd });
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const d = await r.json();
        if (!r.ok) throw new Error("UPLOAD ERROR: " + JSON.stringify(d));
        return d.name || uniqueFilename;
      }
      console.log(`  (upload got ${r.status}/${ct}, retrying...)`);
    } catch (e) {
      if (e.message.startsWith("UPLOAD ERROR")) throw e;
      console.log(`  (upload failed: ${e.message}, retrying...)`);
    }
    await sleep(5000 * (i + 1));
  }
  throw new Error("upload gave up");
}

/** First image URL from a SaveImage node output in a history entry. */
export function firstImageUrl(entry, nodeId = "9") {
  const o = entry.outputs?.[nodeId] || {};
  const imgs = o.images || [];
  if (!imgs.length) throw new Error("no image output");
  const v = imgs[0];
  return viewUrl(v);
}

/** First video URL from a SaveVideo node output in a history entry. */
export function firstVideoUrl(entry, nodeId = "75") {
  const o = entry.outputs?.[nodeId] || {};
  const vids = o.videos || o.images || [];
  if (!vids.length) throw new Error("no video output");
  return viewUrl(vids[0]);
}

function viewUrl(v) {
  return `${BASE}/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder || "")}&type=${v.type || "output"}`;
}

// ---------------------------------------------------------------- Graph builders

/**
 * Flux 2 Klein text-to-image graph.
 * @param {object} o { prompt, width=1280, height=768, prefix, save=true, steps=4 }
 *   save=false drops the SaveImage node (used when bridging in-process).
 *   steps — Flux2Scheduler steps (default 4, fast draft; base workflow ships 20).
 */
export function buildFluxGraph({ prompt, width = 1280, height = 768, prefix = "out/flux", save = true, steps = 4 }) {
  const g = structuredClone(fluxBase);
  g["75:68"].inputs.value = width;
  g["75:69"].inputs.value = height;
  g["75:62"].inputs.steps = steps;
  g["75:73"].inputs.noise_seed = randSeed();
  g["75:74"].inputs.text = prompt;
  if (save) g["9"].inputs.filename_prefix = prefix;
  else delete g["9"];
  return g;
}

/**
 * LTX-2.5 image-to-video graph (loads the first frame from ComfyUI's input folder).
 * @param {object} o { prompt, image (input-folder filename), duration=3, fps=24,
 *                     ratio="16:9 (Widescreen)", megapixels=0.5, prefix }
 */
export function buildLtxGraph({ prompt, image, duration = 3, fps = 24, ratio = "16:9 (Widescreen)", megapixels = 0.5, prefix = "out/ltx", t2v = false, size = null }) {
  const g = structuredClone(ltxBase);
  g["395"].inputs.image = image; // LoadImage always runs; for t2v pass any small placeholder
  if (t2v) g["398:363"].inputs.value = true; // bypass both LTXVImgToVideoInplace -> text-to-video
  g["398:376"].inputs.value = prompt;
  if (size) {
    // Exact WxH: override the PrimitiveInt width/height nodes with literals,
    // bypassing ResolutionSelector (lets us go below its 0.1MP floor, e.g. 64x64).
    g["398:372"].inputs.value = size[0];
    g["398:360"].inputs.value = size[1];
  } else {
    g["403"].inputs.aspect_ratio = ratio;
    g["403"].inputs.megapixels = megapixels;
  }
  g["398:362"].inputs.value = duration;
  g["398:361"].inputs.value = fps;
  g["398:339"].inputs.noise_seed = randSeed();
  g["398:338"].inputs.noise_seed = randSeed();
  g["75"].inputs.filename_prefix = prefix;
  return g;
}

/**
 * Wan 2.1 i2v graph (image-to-video, video-only — no generated audio).
 * Base workflow: workflows/image_to_video_wan.json (wan2.1-i2v-14b GGUF + AccVid LoRA,
 * umt5_xxl CLIP, wan_2.1_vae, CLIPVision first-frame conditioning).
 * @param {object} o { prompt, image (input-folder filename), width=512, height=512,
 *                     length=33 (frames), steps=8, prefix, negative }
 */
export function buildWanGraph({ prompt, image, width = 512, height = 512, length = 33, steps = 8, prefix = "out/wan", negative }) {
  const g = structuredClone(wanBase);
  g["52"].inputs.image = image;
  g["6"].inputs.text = prompt;
  if (negative) g["7"].inputs.text = negative;
  g["50"].inputs.width = width;
  g["50"].inputs.height = height;
  g["50"].inputs.length = length;
  g["3"].inputs.steps = steps;
  g["3"].inputs.seed = randSeed();
  g["56"].inputs.filename_prefix = prefix;
  return g;
}

/**
 * Single merged pipeline: Flux t2i -> (pixel bridge) -> LTX i2v -> SaveVideo.
 * No image touches disk: Flux VAEDecode feeds LTX's ResizeImageMaskNode directly.
 * @param {object} o { fluxPrompt, ltxPrompt, duration=3, fps=24, ratio, megapixels=0.5, prefix, fluxSteps=4 }
 */
export function buildMergedGraph({ fluxPrompt, ltxPrompt, duration = 3, fps = 24, ratio = "16:9 (Widescreen)", megapixels = 0.5, prefix = "out/merged", fluxSteps = 4 }) {
  const g = structuredClone({ ...ltxBase, ...fluxBase });
  // Bridge: Flux VAEDecode (75:65, IMAGE) -> LTX ResizeImageMaskNode (was LoadImage 395)
  g["398:351"].inputs.input = ["75:65", 0];
  delete g["395"]; // LoadImage
  delete g["9"];   // Flux SaveImage
  // Flux side
  g["75:68"].inputs.value = 1280;
  g["75:69"].inputs.value = 768;
  g["75:62"].inputs.steps = fluxSteps;
  g["75:73"].inputs.noise_seed = randSeed();
  g["75:74"].inputs.text = fluxPrompt;
  // LTX side
  g["398:376"].inputs.value = ltxPrompt;
  g["403"].inputs.aspect_ratio = ratio;
  g["403"].inputs.megapixels = megapixels;
  g["398:362"].inputs.value = duration;
  g["398:361"].inputs.value = fps;
  g["398:339"].inputs.noise_seed = randSeed();
  g["398:338"].inputs.noise_seed = randSeed();
  g["75"].inputs.filename_prefix = prefix;
  return g;
}
