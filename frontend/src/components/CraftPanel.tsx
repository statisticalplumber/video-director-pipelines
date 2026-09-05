import { useState } from "react";
import type { Scenario } from "../types";
import { IconSparkles, Spinner } from "./Icons";

interface Props {
  onCrafted: (name: string, config: Scenario) => void;
  // Existing workflow (scenario) JSONs + which one is selected, so the user
  // can switch to another workflow (or clear the selection) without
  // refreshing the page.
  scenarios: string[];
  selected: string;
  onSelect: (name: string) => void;
}

// High-level topic + requirements -> local LLM crafts a scenario JSON.
export default function CraftPanel({ onCrafted, scenarios, selected, onSelect }: Props) {
  const [topic, setTopic] = useState("");
  const [reqs, setReqs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  const craft = async () => {
    setBusy(true);
    setError("");
    setSeconds(0);
    const t0 = Date.now();
    const tick = setInterval(() => setSeconds((Date.now() - t0) / 1000), 500);
    try {
      const r = await fetch("/api/craft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, requirements: reqs }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCrafted(d.name, d.config);
      setTopic("");
      setReqs("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="head-icon"><IconSparkles size={15} /></span>
          Craft scenario
        </h2>
        {busy && (
          <span className="pill running">
            <Spinner size={11} />
            {Math.round(seconds)}s
          </span>
        )}
      </div>

      <label>Workflow</label>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        disabled={busy}
        title="Pick a workflow (scenario JSON), or clear the selection"
      >
        <option value="">(new)</option>
        {scenarios.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <label>High-level topic</label>
      <input
        value={topic}
        placeholder="e.g. a cyberpunk street medic in Neo-Mumbai"
        onChange={(e) => setTopic(e.target.value)}
        disabled={busy}
      />
      <label>Requirements — style, mood, beats, length…</label>
      <textarea
        rows={3}
        value={reqs}
        placeholder="e.g. neo-noir, rain, 4 beats: arrival, surgery, escape, dawn on the roof"
        onChange={(e) => setReqs(e.target.value)}
        disabled={busy}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={craft} disabled={busy || !topic.trim()}>
          {busy ? <Spinner size={13} /> : <IconSparkles size={13} />}
          {busy ? "Crafting…" : "Craft scenario"}
        </button>
      </div>
      {error && <p className="hint err-text">{error}</p>}
      <p className="hint">
        The LLM drafts a full scenario — review it in the editor below, then save and run.
      </p>
    </section>
  );
}
