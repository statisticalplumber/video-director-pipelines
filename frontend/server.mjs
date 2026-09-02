// Backend for the character-sequence frontend. Zero deps, Node >= 18.
// Serves the built React app (dist/) + a small JSON API that drives
// scripts/character_sequence.mjs. Run: node server.mjs  (PORT env, default 8790)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Same tiny .env loader as lib/comfy.mjs (real env vars always win).
{
  const envFile = path.join(ROOT, ".env");
  if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
  }
}
const PROMPTS = path.join(ROOT, "prompts");
const OUTPUTS = path.join(ROOT, "outputs");
const DIST = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT || 8790);
const LLM_BASE = (process.env.LLM_BASE || "https://furian-1.tailb2c0b0.ts.net").replace(/\/+$/, "");

// ---------------------------------------------------------------- helpers
const isSafe = (name) => !name.includes("..") && !name.includes("/") && !name.includes("\\");
const json = (res, code, data) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
const readJson = (req) => new Promise((res, rej) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => { try { res(JSON.parse(b)); } catch { rej(new Error("bad json")); } });
});

// ---------------------------------------------------------------- runs
// One run = one spawned `node scripts/character_sequence.mjs <scenario>`.
const runs = new Map(); // id -> { scenario, status, log, startedAt, proc, subs:Set<res> }

function startRun(scenario, stitch = false) {
  if ([...runs.values()].some((r) => r.status === "running"))
    throw new Error("another run is still active (ComfyUI queue is serial)");
  const id = Date.now().toString(36);
  const proc = spawn("node", ["scripts/character_sequence.mjs", scenario, ...(stitch ? ["--stitch"] : [])], {
    cwd: ROOT, env: process.env,
  });
  const run = { id, scenario, status: "running", log: "", startedAt: Date.now(), proc, subs: new Set() };
  runs.set(id, run);
  const push = (chunk) => {
    run.log += chunk;
    for (const s of run.subs) s.write(`data: ${JSON.stringify({ line: chunk })}\n\n`);
  };
  proc.stdout.on("data", (d) => push(d.toString()));
  proc.stderr.on("data", (d) => push(d.toString()));
  proc.on("close", (code) => {
    run.status = code === 0 ? "done" : "error";
    push(`\n[exit ${code}]\n`);
    for (const s of run.subs) { s.write("event: close\ndata: " + JSON.stringify({ status: run.status }) + "\n\n"); s.end(); }
    run.subs.clear();
  });
  return run;
}

// ---------------------------------------------------------------- comfy status
async function comfyStatus() {
  const base = (process.env.COMFY_BASE || "").replace(/\/+$/, "");
  if (!base) return { up: false, error: "COMFY_BASE not set" };
  try {
    const [stats, queue] = await Promise.all([
      fetch(`${base}/system_stats`).then((r) => r.json()),
      fetch(`${base}/queue`).then((r) => r.json()),
    ]);
    return { up: true, stats, queue };
  } catch (e) {
    return { up: false, error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------- LLM craft
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "scenario";

/**
 * Ask the local LLM (llama-server, OpenAI-compatible) to craft a
 * character-sequence scenario JSON from a high-level topic + requirements.
 * Uses prompts/anime_sequence.json as the in-prompt format reference.
 */
async function craftScenario({ topic, requirements = "", name }) {
  const reference = JSON.parse(fs.readFileSync(path.join(PROMPTS, "anime_sequence.json"), "utf8"));
  const system = [
    "You write ComfyUI video-generation scenario configs. Output ONLY a JSON object, no prose, no markdown fences.",
    "Schema: { description: string, character: string, referencePrompt: string, duration: number,",
    '  sequence: [ { title: snake_case_file_safe, image: string, motion: string } ] }',
    "Rules: character = one consistent subject description reused verbatim in referencePrompt and every image prompt.",
    "referencePrompt = cinematic key-visual of the character (static).",
    "sequence = 4 story beats in chronological order; each image = static keyframe prompt for Flux t2i (include the character block);",
    "each motion = 1-2 sentences of motion + camera direction for LTX image-to-video (no cuts, no new characters).",
    "duration = seconds per clip (2-5). Titles must be unique, short, snake_case.",
  ].join(" ");
  const user = `Reference example (match its style and level of detail, NOT its subject):
${JSON.stringify(reference, null, 2)}

New scenario to craft:
Topic: ${topic}
Requirements: ${requirements || "(none)"}`;
  const r = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.7,
      max_tokens: 8000,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  let text = d.choices?.[0]?.message?.content || "";
  text = text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM returned no JSON object");
  const cfg = JSON.parse(m[0]);
  if (!cfg.referencePrompt || !Array.isArray(cfg.sequence) || !cfg.sequence.length)
    throw new Error("crafted config missing referencePrompt/sequence");
  cfg.duration = Number(cfg.duration) || 3;
  cfg.sequence = cfg.sequence.map((b, i) => ({
    title: slug(b.title) || `beat${i + 1}`,
    image: String(b.image || ""),
    motion: String(b.motion || ""),
  }));
  const scenarioName = slug(name || topic);
  return { name: scenarioName, config: cfg };
}

// ---------------------------------------------------------------- static files
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".wav": "audio/wav", ".ico": "image/x-icon" };
function serveStatic(req, res, urlPath) {
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}
function serveOutput(res, scenario, file) {
  const p = path.join(OUTPUTS, scenario, file);
  if (!isSafe(scenario) || !isSafe(file) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}

// ---------------------------------------------------------------- router
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  try {
    if (p === "/api/scenarios" && req.method === "GET")
      return json(res, 200, fs.readdirSync(PROMPTS).filter((f) => f.endsWith(".json")).map((f) => {
        const c = JSON.parse(fs.readFileSync(path.join(PROMPTS, f), "utf8"));
        return { name: f.replace(/\.json$/, ""), isSequence: !!(c.sequence && c.referencePrompt) };
      }));
    if (p.startsWith("/api/scenario/") && req.method === "GET") {
      const name = p.split("/")[3];
      if (!isSafe(name)) return json(res, 400, { error: "bad name" });
      const c = JSON.parse(fs.readFileSync(path.join(PROMPTS, name + ".json"), "utf8"));
      return json(res, 200, { name, config: c });
    }
    if (p.startsWith("/api/scenario/") && req.method === "PUT") {
      const name = p.split("/")[3];
      if (!isSafe(name)) return json(res, 400, { error: "bad name" });
      const cfg = await readJson(req);
      fs.writeFileSync(path.join(PROMPTS, name + ".json"), JSON.stringify(cfg, null, 2));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/runs" && req.method === "POST") {
      const body = await readJson(req);
      const run = startRun(body.scenario, body.stitch);
      return json(res, 200, { id: run.id });
    }
    if (p === "/api/runs" && req.method === "GET")
      return json(res, 200, [...runs.values()].map(({ proc, subs, ...r }) => r).reverse());
    if (p.startsWith("/api/runs/") && req.method === "GET") {
      const run = runs.get(p.split("/")[3]);
      if (!run) return json(res, 404, { error: "no run" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(`data: ${JSON.stringify({ line: run.log })}\n\n`);
      run.subs.add(res);
      req.on("close", () => run.subs.delete(res));
      return;
    }
    if (p.startsWith("/api/runs/") && req.method === "DELETE") {
      const run = runs.get(p.split("/")[3]);
      if (run && run.status === "running") run.proc.kill("SIGTERM");
      return json(res, 200, { ok: true });
    }
    if (p === "/api/outputs" && req.method === "GET") {
      const name = u.searchParams.get("scenario");
      if (!isSafe(name)) return json(res, 400, { error: "bad name" });
      const dir = path.join(OUTPUTS, name);
      if (!fs.existsSync(dir)) return json(res, 200, { files: [] });
      return json(res, 200, { files: fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort() });
    }
    if (p === "/api/craft" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.topic) return json(res, 400, { error: "topic required" });
      return json(res, 200, await craftScenario(body));
    }
    if (p === "/api/comfy" && req.method === "GET") return json(res, 200, await comfyStatus());
    if (p.startsWith("/outputs/")) {
      const [, , scenario, file] = p.split("/");
      return serveOutput(res, decodeURIComponent(scenario), decodeURIComponent(file));
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "unknown route" });
    serveStatic(req, res, p === "/" ? "/index.html" : p);
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, () => console.log(`frontend server on http://localhost:${PORT}`));
