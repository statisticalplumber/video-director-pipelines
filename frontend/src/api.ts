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
export const getScenario = (name: string) => get<{ name: string; config: Scenario }>(`/api/scenario/${name}`);
export const saveScenario = (name: string, config: Scenario) =>
  fetch(`/api/scenario/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then((r) => r.json());

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

// Re-stitch the final cut from the currently selected main versions.
export const stitchOnly = (scenario: string, engine: Engine = "ltx") =>
  fetch("/api/outputs/stitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, engine }),
  }).then((r) => r.json() as Promise<{ id: string }>);

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
