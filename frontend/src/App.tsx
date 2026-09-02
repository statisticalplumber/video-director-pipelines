import { useCallback, useEffect, useState } from "react";
import { listScenarios, getScenario, saveScenario, comfyStatus, outScenario, type Engine } from "./api";
import type { Scenario, ScenarioInfo, ComfyStatus } from "./types";
import ScenarioEditor from "./components/ScenarioEditor";
import RunPanel from "./components/RunPanel";
import OutputGallery from "./components/OutputGallery";
import CraftPanel from "./components/CraftPanel";

export default function App() {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<Scenario | null>(null);
  const [draft, setDraft] = useState<{ name: string; config: Scenario } | null>(null);
  const [engine, setEngine] = useState<Engine>("ltx");
  const [comfy, setComfy] = useState<ComfyStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const refreshScenarios = useCallback(async () => {
    const all = await listScenarios();
    setScenarios(all.filter((s) => s.isSequence));
  }, []);

  useEffect(() => {
    refreshScenarios().then(() => {});
  }, [refreshScenarios]);

  useEffect(() => {
    if (!name) return;
    getScenario(name).then((r) => setCfg(r.config));
  }, [name]);

  useEffect(() => {
    comfyStatus().then(setComfy);
    const t = setInterval(() => comfyStatus().then(setComfy), 15000);
    return () => clearInterval(t);
  }, []);

  const handleSave = async (c: Scenario) => {
    const target = draft ? draft.name : name;
    await saveScenario(target, c);
    if (draft) {
      await refreshScenarios();
      setName(target);
      setDraft(null);
    }
  };

  const editor = draft
    ? { name: draft.name, config: draft.config }
    : cfg ? { name, config: cfg } : null;

  return (
    <div className="app">
      <header>
        <h1>comfyui-video-pipelines — Character Sequence</h1>
        <span className={`pill ${comfy?.up ? "ok" : "err"}`}>
          {comfy?.up ? "ComfyUI online" : "ComfyUI offline"}
        </span>
      </header>
      <div className="layout">
        <div className="col">
          <CraftPanel
            onCrafted={(n, c) => setDraft({ name: n, config: c })}
          />
          <section className="card">
            <label>Scenario (prompts/*.json)</label>
            <select
              value={draft ? "" : name}
              onChange={(e) => { setDraft(null); setName(e.target.value); }}
            >
              <option value="" disabled>{draft ? `draft: ${draft.name} (unsaved)` : "select…"}</option>
              {scenarios.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </section>
          {editor && (
            <ScenarioEditor
              key={editor.name}
              name={editor.name}
              config={editor.config}
              onSave={handleSave}
            />
          )}
          <RunPanel
            scenario={draft ? "" : name}
            engine={engine}
            onEngine={setEngine}
            onDone={refresh}
          />
        </div>
        <div className="col">
          <OutputGallery
            scenario={outScenario(draft ? draft.name : name, engine)}
            refreshKey={refreshKey}
          />
        </div>
      </div>
    </div>
  );
}
