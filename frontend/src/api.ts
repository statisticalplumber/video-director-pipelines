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

export const startRun = (scenario: string, stitch = false) =>
  fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, stitch }),
  }).then((r) => r.json() as Promise<{ id: string }>);

export const listRuns = () => get<Run[]>("/api/runs");
export const killRun = (id: string) => fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) => r.json());
export const comfyStatus = () => get<ComfyStatus>("/api/comfy");
export const listOutputs = (scenario: string) =>
  get<{ files: string[] }>(`/api/outputs?scenario=${scenario}`);

// SSE tail of a run's log. Returns a close function.
export function tailRun(id: string, onChunk: (line: string) => void, onDone: (status: string) => void) {
  const es = new EventSource(`/api/runs/${id}/logs`);
  es.onmessage = (e) => onChunk(JSON.parse(e.data).line);
  es.addEventListener("close", (e) => { onDone(JSON.parse(e.data).status); es.close(); });
  return () => es.close();
}

export const outputUrl = (scenario: string, file: string) => `/outputs/${scenario}/${file}`;
