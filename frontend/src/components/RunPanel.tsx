import { useEffect, useRef, useState } from "react";
import { startRun, killRun, tailRun, outScenario, type AssetEvent, type Engine, type RegenSpec } from "../api";
import OutputGallery from "./OutputGallery";
import { IconPlay, IconScissors, IconStop, IconTerminal, Spinner } from "./Icons";

export type RunStatus = "idle" | "running" | "done" | "error";

interface Props {
  scenario: string;
  engine: Engine;
  onEngine: (e: Engine) => void;
  onDone: () => void;
  onStatus?: (s: RunStatus, scenario: string) => void;
  // External run trigger (Stitch final / Regenerate from the output gallery).
  pendingRun: { nonce: number; stitch?: boolean; regen?: RegenSpec | null } | null;
}

const STAGES = ["Reference", "Keyframes", "Clips", "Stitch"];

// Start / stitch / stop a run + live log tail (SSE) + live asset gallery.
export default function RunPanel({ scenario, engine, onEngine, onDone, onStatus, pendingRun }: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  // Scenario this panel's run is generating (captured at start, so it stays
  // correct even if the user switches scenarios mid-run).
  const [runScenario, setRunScenario] = useState<string | null>(null);

  useEffect(() => { onStatus?.(status, runScenario ?? scenario); }, [status, onStatus, runScenario, scenario]);
  const [log, setLog] = useState("");
  const [assets, setAssets] = useState<AssetEvent[]>([]);
  const closeTail = useRef<() => void>(() => {});
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => () => closeTail.current(), []);
  useEffect(() => {
    boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
  }, [log]);

  const begin = async (stitch: boolean, regen: RegenSpec | null = null) => {
    if (!scenario) return;
    try {
      const { id } = await startRun(scenario, { stitch, regen, engine });
      setRunId(id);
      setRunScenario(scenario);
      setStatus("running");
      setLog("");
      setAssets([]);
      closeTail.current();
      closeTail.current = tailRun(
        id,
        (line) => setLog((l) => l + line),
        (s) => { setStatus(s === "done" ? "done" : "error"); onDone(); },
        (a) => setAssets((prev) => prev.some((x) => x.file === a.file) ? prev : [...prev, a])
      );
    } catch (e) {
      setStatus("error");
      setLog(`run failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  };

  // Runs triggered from the output gallery (stitch / regenerate).
  useEffect(() => {
    if (pendingRun) begin(!!pendingRun.stitch, pendingRun.regen || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun?.nonce]);

  // Derive a coarse stage from the live asset stream.
  const stage =
    assets.some((a) => a.stage === "final") ? 3 :
    assets.some((a) => a.stage === "clip") ? 2 :
    assets.some((a) => a.stage === "keyframe") ? 1 :
    assets.some((a) => a.stage === "reference") ? 0.5 : 0;
  const pct = Math.min(100, (stage / 3) * 100);

  const statusPill = {
    idle: <span className="pill">idle</span>,
    running: (
      <span className="pill running">
        <Spinner size={11} />
        running{runScenario && runScenario !== scenario ? ` · ${runScenario}` : ""}
      </span>
    ),
    done: <span className="pill done">done</span>,
    error: <span className="pill error">error</span>,
  }[status];

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="head-icon"><IconTerminal size={15} /></span>
          Run
        </h2>
        <span className="spacer" />
        <span className="seg" title="i2v engine">
          <button className={engine === "ltx" ? "on" : ""} onClick={() => onEngine("ltx")}>
            LTX 2.5
          </button>
          <button className={engine === "wan" ? "on" : ""} onClick={() => onEngine("wan")}>
            Wan 2.1
          </button>
        </span>
        {statusPill}
      </div>

      {status === "running" && (
        <div className="progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-meta">
            <span>{STAGES[Math.min(3, Math.floor(stage))]}…</span>
            <span className="muted">{assets.length} asset{assets.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      )}

      <div className="row">
        <button className="primary" onClick={() => begin(false)} disabled={status === "running" || !scenario}>
          <IconPlay size={12} />
          Generate
        </button>
        <button onClick={() => begin(true)} disabled={status === "running" || !scenario}>
          <IconScissors size={12} />
          Stitch only
        </button>
        <button
          className="danger"
          disabled={status !== "running" || !runId}
          onClick={() => runId && killRun(runId)}
        >
          <IconStop size={12} />
          Stop
        </button>
      </div>
      {!scenario && (
        <p className="hint">Select or save a scenario first, then start a run.</p>
      )}

      <pre ref={boxRef} className="log">
        {log || <span className="log-empty">— log will stream here once a run starts —</span>}
      </pre>

      {assets.length > 0 && (
        <OutputGallery scenario={outScenario(scenario, engine)} refreshKey={0} assets={assets} bare />
      )}
    </section>
  );
}
