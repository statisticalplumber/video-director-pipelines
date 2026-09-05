import { useState } from "react";
import type { Scenario } from "../types";
import { craftBeat } from "../api";
import { IconCheck, IconPlus, IconX, IconLayers, IconSparkles, Spinner } from "./Icons";

interface Props {
  name: string;
  config: Scenario;
  isDraft: boolean;
  onSave: (cfg: Scenario) => Promise<void>;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Editable prompt JSON: reference prompt, duration, and the keyframe beats.
export default function ScenarioEditor({ name, config, isDraft, onSave }: Props) {
  const [cfg, setCfg] = useState<Scenario>(config);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState("");
  const set = (patch: Partial<Scenario>) => { setCfg({ ...cfg, ...patch }); setSaved(false); };
  const setBeat = (i: number, patch: Partial<Scenario["sequence"][number]>) => {
    const sequence = cfg.sequence.map((b, j) => (j === i ? { ...b, ...patch } : b));
    set({ sequence });
  };
  const addBeat = () =>
    set({ sequence: [...cfg.sequence, { title: `beat${cfg.sequence.length + 1}`, image: "", motion: "" }] });
  const removeBeat = (i: number) => set({ sequence: cfg.sequence.filter((_, j) => j !== i) });

  // LLM proposes the next beat from the scenario JSON (description + existing
  // beats) and appends it — review/edit it here, then Save + run the pipeline.
  const generateBeat = async () => {
    setGenBusy(true);
    setGenError("");
    try {
      const { beat } = await craftBeat(cfg);
      set({ sequence: [...cfg.sequence, { ...beat, title: slug(beat.title) || `beat${cfg.sequence.length + 1}` }] });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(cfg);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="head-icon"><IconLayers size={15} /></span>
          Scenario
          {isDraft && <span className="pill warn">draft · unsaved</span>}
        </h2>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12, fontFamily: "var(--mono)" }}>{name}</span>
        <button
          className="primary"
          onClick={doSave}
          disabled={saving || (saved && !isDraft)}
        >
          <IconCheck size={13} />
          {saving ? "Saving…" : saved && !isDraft ? "Saved" : isDraft ? "Save scenario" : "Save"}
        </button>
      </div>
      {cfg.description && <p className="card-desc">{cfg.description}</p>}
      {error && <p className="hint err-text">{error}</p>}

      <label>Reference prompt — Flux t2i key visual</label>
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
        style={{ maxWidth: 140 }}
        onChange={(e) => set({ duration: Number(e.target.value) })}
      />

      {cfg.sequence.map((b, i) => (
        <div className="beat" key={i}>
          <div className="beat-head">
            <span className="beat-index">{i + 1}</span>
            <input
              className="beat-title"
              value={b.title}
              placeholder="title (file-safe)"
              onChange={(e) => setBeat(i, { title: e.target.value })}
            />
            <button
              className="icon-btn danger"
              title="Remove beat"
              onClick={() => removeBeat(i)}
            >
              <IconX size={13} />
            </button>
          </div>
          <p className="beat-meta">{slug(b.title) || "untitled"}</p>
          <label>Keyframe image — Flux</label>
          <textarea
            rows={2}
            value={b.image}
            onChange={(e) => setBeat(i, { image: e.target.value })}
          />
          <label>Motion &amp; camera — i2v</label>
          <textarea
            rows={2}
            value={b.motion}
            onChange={(e) => setBeat(i, { motion: e.target.value })}
          />
        </div>
      ))}
      <div className="row" style={{ marginTop: 4 }}>
        <button className="ghost" onClick={addBeat} disabled={genBusy}>
          <IconPlus size={13} />
          Add beat
        </button>
        <button className="ghost" onClick={generateBeat} disabled={genBusy} title="LLM proposes the next beat from the scenario + existing beats">
          {genBusy ? <Spinner size={13} /> : <IconSparkles size={13} />}
          {genBusy ? "Generating…" : "Generate beat"}
        </button>
      </div>
      {genError && <p className="hint err-text">{genError}</p>}
      <p className="hint">Generate beat asks the LLM for the next story beat from the scenario JSON — review, edit, then save &amp; run.</p>
    </section>
  );
}
