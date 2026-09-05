import type { Scenario, ScenarioInfo, Run, ComfyStatus, AuthUser, OutputsInfo, AssetKind } from "./types";

const get = async <T,>(url: string) => (await fetch(url)).json() as Promise<T>;

// ---------------------------------------------------------------- auth
export type { AuthUser } from "./types";

export const me = async (): Promise<AuthUser> => {
  const r = await fetch("/api/me");
  if (!r.ok) throw new Error("unauthorized");
  return r.json() as Promise<AuthUser>;
};
export const login = (username: string, password: string) =>
  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((r) => (r.ok ? r.json() as Promise<AuthUser> : r.json().then((d) => Promise.reject(new Error(d.error || "login failed")))));
export const logout = () => fetch("/api/logout", { method: "POST" }).then((r) => r.json());

export const listScenarios = () => get<ScenarioInfo[]>("/api/scenarios");

// 06-Sep-2025
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};
export const getScenario = (name: string) => get<{ name: string; config: Scenario }>(`/api/scenario/${name}`);
export const saveScenario = (name: string, config: Scenario) =>
  fetch(`/api/scenario/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then((r) => r.json());
export const deleteScenario = (name: string) =>
  fetch(`/api/scenario/${name}`, { method: "DELETE" }).then((r) =>
    r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error || `HTTP ${r.status}`)))
  );

export const setFavorite = (name: string, on: boolean) =>
  fetch("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, on }),
  }).then((r) => r.json() as Promise<{ ok: boolean; names: string[] }>);

export type Engine = "ltx" | "wan";

export interface RegenSpec {
  kind: "ref" | "keyframe" | "clip";
  index?: number;
}

export const startRun = (scenario: string, opts: { stitch?: boolean; engine?: Engine; regen?: RegenSpec | null } = {}) =>
  fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenario,
      stitch: !!opts.stitch,
      engine: opts.engine || "ltx",
      regen: opts.regen || null,
    }),
  }).then((r) => r.json() as Promise<{ id: string }>);

// Output dir for a scenario+engine (Wan runs write to outputs/<scenario>_wan/).
export const outScenario = (scenario: string, engine: Engine) =>
  engine === "wan" ? `${scenario}_wan` : scenario;

export const listRuns = () => get<Run[]>("/api/runs");
export const killRun = (id: string) => fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) => r.json());
export const comfyStatus = () => get<ComfyStatus>("/api/comfy");
export const listOutputs = (scenario: string) =>
  get<OutputsInfo>(`/api/outputs?scenario=${scenario}`);

// Pick which version of an asset is "main" (used for stitching / clip generation).
export const selectMain = (scenario: string, kind: AssetKind, index: number | null, file: string) =>
  fetch("/api/outputs/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, kind, index, file }),
  }).then((r) => (r.ok ? r.json() as Promise<OutputsInfo> : r.json().then((d) => Promise.reject(new Error(d.error || "select failed")))));

// Upload an image (data URL) as the scenario's reference — stored as the next
// ref version and selected as main (the pipeline then skips Flux ref generation).
export const uploadRef = (scenario: string, data: string) =>
  fetch("/api/upload/ref", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, data }),
  }).then((r) => (r.ok ? r.json() as Promise<OutputsInfo> : r.json().then((d) => Promise.reject(new Error(d.error || "upload failed")))));

// Re-stitch the final cut from the currently selected main versions.
export const stitchOnly = (scenario: string, engine: Engine = "ltx") =>
  fetch("/api/outputs/stitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, engine }),
  }).then((r) => r.json() as Promise<{ id: string }>);

// Ask the local LLM to extend a scenario with the next `count` beats in the story.
export const craftBeat = (config: Scenario, count = 1) =>
  fetch("/api/craft-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, count }),
  }).then(
    (r) =>
      r.ok
        ? r.json() as Promise<{ beats?: { title: string; image: string; motion: string }[]; beat?: { title: string; image: string; motion: string } }>
        : r.json().then((d) => Promise.reject(new Error(d.error || "craft beat failed")))
  );

export interface AssetEvent {
  kind: "image" | "video";
  file: string;
  stage: "reference" | "keyframe" | "clip" | "final";
  index?: number;
}

// SSE tail of a run's log. Returns a close function.
export function tailRun(
  id: string,
  onChunk: (line: string) => void,
  onDone: (status: string) => void,
  onAsset?: (a: AssetEvent) => void
) {
  const es = new EventSource(`/api/runs/${id}/logs`);
  es.onmessage = (e) => onChunk(JSON.parse(e.data).line);
  if (onAsset) es.addEventListener("asset", (e) => onAsset(JSON.parse(e.data) as AssetEvent));
  es.addEventListener("close", (e) => { onDone(JSON.parse(e.data).status); es.close(); });
  return () => es.close();
}

export const outputUrl = (scenario: string, file: string) => `/outputs/${scenario}/${file}`;
