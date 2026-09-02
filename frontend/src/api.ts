import type { Scenario, ScenarioInfo, Run, ComfyStatus } from "./types";

const get = async <T,>(url: string) => (await fetch(url)).json() as Promise<T>;

export const listScenarios = () => get<ScenarioInfo[]>("/api/scenarios");
export const getScenario = (name: string) => get<{ name: string; config: Scenario }>(`/api/scenario/${name}`);
export const saveScenario = (name: string, config: Scenario) =>
  fetch(`/api/scenario/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then((r) => r.json());

export type Engine = "ltx" | "wan";

export const startRun = (scenario: string, stitch = false, engine: Engine = "ltx") =>
  fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, stitch, engine }),
  }).then((r) => r.json() as Promise<{ id: string }>);

// Output dir for a scenario+engine (Wan runs write to outputs/<scenario>_wan/).
export const outScenario = (scenario: string, engine: Engine) =>
  engine === "wan" ? `${scenario}_wan` : scenario;

export const listRuns = () => get<Run[]>("/api/runs");
export const killRun = (id: string) => fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) => r.json());
export const comfyStatus = () => get<ComfyStatus>("/api/comfy");
export const listOutputs = (scenario: string) =>
  get<{ files: string[] }>(`/api/outputs?scenario=${scenario}`);

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
