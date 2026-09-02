import { useEffect, useState } from "react";
import { listOutputs, outputUrl, type AssetEvent } from "../api";

interface Props {
  scenario: string;
  refreshKey: number; // bump to re-list files
  assets?: AssetEvent[]; // live: assets finished so far in the current run
  bare?: boolean; // render without the outer card (for nesting in RunPanel)
}

// Gallery of outputs/<scenario>/: ref, keyframes, clips, final cut.
export default function OutputGallery({ scenario, refreshKey, assets, bare }: Props) {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
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
      <h2>{bare ? "Generated so far" : "Outputs"}</h2>
      {final && (
        <>
          <h3>Final cut</h3>
          <video controls src={outputUrl(scenario, final)} />
        </>
      )}
      {ref && (
        <>
          <h3>Reference</h3>
          <img src={outputUrl(scenario, ref)} alt="reference" />
        </>
      )}
      {keyframes.length > 0 && (
        <>
          <h3>Keyframes → clips</h3>
          <div className="grid">
            {keyframes.map((kf, i) => (
              <div className="shot" key={kf}>
                <img src={outputUrl(scenario, kf)} alt={kf} />
                {clips[i] && <video controls src={outputUrl(scenario, clips[i])} />}
              </div>
            ))}
          </div>
        </>
      )}
      {mediaCount === 0 && <p className="muted">No outputs yet — run the pipeline.</p>}
    </Tag>
  );
}
