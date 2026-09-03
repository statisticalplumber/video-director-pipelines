import { useEffect, useState } from "react";
import { listOutputs, outputUrl, type AssetEvent } from "../api";
import { IconFilm, IconImage } from "./Icons";

interface Props {
  scenario: string;
  refreshKey: number; // bump to re-list files
  assets?: AssetEvent[]; // live: assets finished so far in the current run
  bare?: boolean; // render without the outer card (for nesting in RunPanel)
}

const pretty = (f: string) =>
  f.replace(/_[a-z]+\d+_.*\.(mp4|png)$/, "")
    .replace(/_/g, " ")
    .trim();

// Gallery of outputs/<scenario>/: ref, keyframes, clips, final cut.
export default function OutputGallery({ scenario, refreshKey, assets, bare }: Props) {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    setFiles([]);
    if (!assets) listOutputs(scenario).then((r) => setFiles(r.files));
  }, [scenario, refreshKey, assets]);

  const byIndex = (a: AssetEvent, b: AssetEvent) => (a.index ?? 0) - (b.index ?? 0);
  const final = assets
    ? assets.find((a) => a.stage === "final")?.file
    : files.find((f) => f.endsWith("_final.mp4"));
  const ref = assets
    ? assets.find((a) => a.stage === "reference")?.file
    : files.find((f) => f.endsWith("_ref.png"));
  const keyframes = assets
    ? assets.filter((a) => a.stage === "keyframe").sort(byIndex).map((a) => a.file)
    : files.filter((f) => /_seq\d+_.*\.png$/.test(f));
  const clips = assets
    ? assets.filter((a) => a.stage === "clip").sort(byIndex).map((a) => a.file)
    : files.filter((f) => /_clip\d+_.*\.mp4$/.test(f));
  const mediaCount = keyframes.length + clips.length + (ref ? 1 : 0) + (final ? 1 : 0);

  const Tag = bare ? "div" : "section";
  return (
    <Tag className={bare ? undefined : "card"}>
      {!bare && (
        <div className="card-head">
          <h2>
            <span className="head-icon"><IconFilm size={15} /></span>
            Outputs
          </h2>
          <span className="spacer" />
          {scenario && (
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--mono)" }}>
              outputs/{scenario}/
            </span>
          )}
        </div>
      )}

      {bare && <div className="section-label">Generated so far</div>}

      {final && (
        <>
          <div className="section-label">Final cut</div>
          <div className="video-frame">
            <video controls src={outputUrl(scenario, final)} />
          </div>
        </>
      )}
      {ref && (
        <>
          <div className="section-label">Reference</div>
          <div className="img-frame">
            <img src={outputUrl(scenario, ref)} alt="reference" loading="lazy" />
          </div>
        </>
      )}
      {keyframes.length > 0 && (
        <>
          <div className="section-label">Keyframes → clips</div>
          <div className="grid">
            {keyframes.map((kf, i) => (
              <div className="shot" key={kf}>
                <div className="img-frame">
                  <img src={outputUrl(scenario, kf)} alt={pretty(kf)} loading="lazy" />
                </div>
                {clips[i] && (
                  <div className="video-frame">
                    <video controls src={outputUrl(scenario, clips[i])} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {mediaCount === 0 && (
        <div className="empty">
          <span className="empty-icon">
            <IconImage size={20} />
          </span>
          <span className="empty-title">No outputs yet</span>
          <span className="empty-sub">
            {scenario
              ? "Start a run to see the reference, keyframes, and final cut land here."
              : "Select a scenario to view its outputs."}
          </span>
        </div>
      )}
    </Tag>
  );
}
