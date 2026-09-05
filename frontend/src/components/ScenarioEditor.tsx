import { useEffect, useRef, useState } from "react";
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
const AUTOSAVE_DELAY_MS = 800;

export default function ScenarioEditor({ name, config, isDraft, onSave }: Props) {
  const [cfg, setCfg] = useState<Scenario>(config);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState("");
  const [genCount, setGenCount] = useState(1);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const isDraftRef = useRef(isDraft);
  isDraftRef.current = isDraft;

  // Debounced autosave: any edit to the scenario JSON (reference prompt,
  // duration, beats) persists it after the user stops typing.
  // Drafts are excluded — they don't exist on disk until explicitly saved.
  const scheduleAutosave = () => {
    if (isDraftRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void doSave(cfgRef.current, true);
    }, AUTOSAVE_DELAY_MS);
  };
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);

  const set = (patch: Partial<Scenario>) => {
    setCfg({ ...cfg, ...patch });
    setSaved(false);
    scheduleAutosave();
  };
  const setBeat = (i: number, patch: Partial<Scenario["sequence"][number]>) => {
    const sequence = cfg.sequence.map((b, j) => (j === i ? { ...b, ...patch } : b));
    set({ sequence });
  };
  const addBeat = () =>
    set({ sequence: [...cfg.sequence, { title: `beat${cfg.sequence.length + 1}`, image: "", motion: "" }] });
  const removeBeat = (i: number) => set({ sequence: cfg.sequence.filter((_, j) => j !== i) });

  // LLM proposes the next N beats from the scenario JSON (description + existing
  // beats), each continuing from the previous one, and appends them —
  // review/edit them here, then Save + run the pipeline.
  const generateBeat = async () => {
    setGenBusy(true);
    setGenError("");
    try {
      const res = await craftBeat(cfg, genCount);
      const beats = res.beats ?? (res.beat ? [res.beat] : []); // beat = old server shape
      const used = new Set(cfg.sequence.map((b) => b.title));
      const next = beats.map((b, k) => {
        let title = slug(b.title) || `beat${cfg.sequence.length + k + 1}`;
        if (used.has(title)) title = `${title}_next`;
        used.add(title);
        return { ...b, title };
      });
      set({ sequence: [...cfg.sequence, ...next] });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const doSave = async (next: Scenario = cfg, auto = false) => {
    setSaving(true);
    setError("");
    try {
      await onSave(next);
      setSaved(true);
    } catch (e) {
      if (!auto) setError(e instanceof Error ? e.message : String(e));
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
          onClick={() => doSave()}
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
        <div className={`beat ${i % 2 ? "alt" : ""}`} key={i}>
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
        <button className="ghost" onClick={generateBeat} disabled={genBusy} title="LLM proposes the next beat(s) from the scenario + existing beats">
          {genBusy ? <Spinner size={13} /> : <IconSparkles size={13} />}
          {genBusy ? "Generating…" : "Generate beat"}
        </button>
        <label className="gen-count" title="How many next beats to generate (1–8)">
          ×
          <input
            type="number"
            min={1}
            max={8}
            value={genCount}
            disabled={genBusy}
            onChange={(e) => setGenCount(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
      </div>
      {genError && <p className="hint err-text">{genError}</p>}
      <p className="hint">Generate beat asks the LLM for the next story beat(s) from the scenario JSON. Edits autosave once you stop typing.</p>
    </section>
  );
}
