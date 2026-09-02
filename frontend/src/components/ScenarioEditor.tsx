import { useState } from "react";
import type { Scenario } from "../types";

interface Props {
  name: string;
  config: Scenario;
  onSave: (cfg: Scenario) => Promise<void>;
}

// Editable prompt JSON: reference prompt, duration, and the keyframe beats.
export default function ScenarioEditor({ name, config, onSave }: Props) {
  const [cfg, setCfg] = useState<Scenario>(config);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Scenario>) => { setCfg({ ...cfg, ...patch }); setSaved(false); };
  const setBeat = (i: number, patch: Partial<Scenario["sequence"][number]>) => {
    const sequence = cfg.sequence.map((b, j) => (j === i ? { ...b, ...patch } : b));
    set({ sequence });
  };
  const addBeat = () =>
    set({ sequence: [...cfg.sequence, { title: `beat${cfg.sequence.length + 1}`, image: "", motion: "" }] });
  const removeBeat = (i: number) => set({ sequence: cfg.sequence.filter((_, j) => j !== i) });

  return (
    <section className="card">
      <div className="card-head">
        <h2>Scenario: {name}</h2>
        <button
          onClick={async () => { await onSave(cfg); setSaved(true); }}
          disabled={saved}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      {cfg.description && <p className="muted">{cfg.description}</p>}

      <label>Reference prompt (Flux t2i)</label>
      <textarea
        rows={3}
        value={cfg.referencePrompt}
        onChange={(e) => set({ referencePrompt: e.target.value })}
      />
      <label>Clip duration (s)</label>
      <input
        type="number"
        min={1}
        max={10}
        value={cfg.duration}
        onChange={(e) => set({ duration: Number(e.target.value) })}
      />

      {cfg.sequence.map((b, i) => (
        <div className="beat" key={i}>
          <div className="beat-head">
            <span>#{i + 1}</span>
            <input
              className="beat-title"
              value={b.title}
              onChange={(e) => setBeat(i, { title: e.target.value })}
              placeholder="title (file-safe)"
            />
            <button className="danger" onClick={() => removeBeat(i)}>✕</button>
          </div>
          <label>Keyframe image (Flux)</label>
          <textarea
            rows={2}
            value={b.image}
            onChange={(e) => setBeat(i, { image: e.target.value })}
          />
          <label>Motion / camera (LTX i2v)</label>
          <textarea
            rows={2}
            value={b.motion}
            onChange={(e) => setBeat(i, { motion: e.target.value })}
          />
        </div>
      ))}
      <button className="ghost" onClick={addBeat}>+ Add beat</button>
    </section>
  );
}
