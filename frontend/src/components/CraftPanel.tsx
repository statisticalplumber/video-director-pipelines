import { useState } from "react";
import type { Scenario } from "../types";

interface Props {
  onCrafted: (name: string, config: Scenario) => void;
}

// High-level topic + requirements -> local LLM crafts a scenario JSON.
export default function CraftPanel({ onCrafted }: Props) {
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
        <h2>Craft scenario with LLM</h2>
        {busy && <span className="pill running">{Math.round(seconds)}s…</span>}
      </div>
      <label>High-level topic</label>
      <input
        value={topic}
        placeholder="e.g. a cyberpunk street medic in Neo-Mumbai"
        onChange={(e) => setTopic(e.target.value)}
      />
      <label>Requirements (style, mood, beats, length…)</label>
      <textarea
        rows={3}
        value={reqs}
        placeholder="e.g. neo-noir, rain, 4 beats: arrival, surgery, escape, dawn on the roof"
        onChange={(e) => setReqs(e.target.value)}
      />
      <div className="row">
        <button onClick={craft} disabled={busy || !topic.trim()}>
          ✨ Craft scenario
        </button>
      </div>
      {error && <p className="muted err-text">{error}</p>}
      <p className="muted hint">Result loads into the editor below — review, then Save.</p>
    </section>
  );
}
