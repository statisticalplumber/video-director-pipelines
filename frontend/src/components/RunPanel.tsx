import { useEffect, useRef, useState } from "react";
import { startRun, killRun, tailRun, outScenario, type AssetEvent, type Engine } from "../api";
import OutputGallery from "./OutputGallery";

interface Props {
  scenario: string;
  engine: Engine;
  onEngine: (e: Engine) => void;
  onDone: () => void;
}

// Start / stitch / stop a run + live log tail (SSE) + live asset gallery.
export default function RunPanel({ scenario, engine, onEngine, onDone }: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [log, setLog] = useState("");
  const [assets, setAssets] = useState<AssetEvent[]>([]);
  const closeTail = useRef<() => void>(() => {});
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => () => closeTail.current(), []);
  useEffect(() => {
    boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
  }, [log]);

  const begin = async (stitch: boolean) => {
    if (!scenario) return;
    const { id } = await startRun(scenario, stitch, engine);
    setRunId(id);
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
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Run</h2>
        <span className={`pill ${status}`}>{status}</span>
      </div>
      <div className="row">
        <div className="seg" title="i2v engine">
          <button className={engine === "ltx" ? "on" : ""} onClick={() => onEngine("ltx")}>
            LTX 2.5
          </button>
          <button className={engine === "wan" ? "on" : ""} onClick={() => onEngine("wan")}>
            Wan 2.1
          </button>
        </div>
      </div>
      <div className="row">
        <button onClick={() => begin(false)} disabled={status === "running" || !scenario}>
          ▶ Generate (resumable)
        </button>
        <button className="ghost" onClick={() => begin(true)} disabled={status === "running" || !scenario}>
          Stitch only
        </button>
        <button
          className="danger"
          disabled={status !== "running" || !runId}
          onClick={() => runId && killRun(runId)}
        >
          Stop
        </button>
      </div>
      {!scenario && <p className="muted">Save the draft scenario first, then run.</p>}
      <pre ref={boxRef} className="log">{log || "(no log yet)"}</pre>
      {assets.length > 0 && (
        <OutputGallery scenario={outScenario(scenario, engine)} refreshKey={0} assets={assets} bare />
      )}
    </section>
  );
}
