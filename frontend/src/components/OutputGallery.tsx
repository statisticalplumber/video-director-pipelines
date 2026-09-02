import { useEffect, useState } from "react";
import { listOutputs, outputUrl } from "../api";

interface Props {
  scenario: string;
  refreshKey: number; // bump to re-list files
}

const kind = (f: string) =>
  f.endsWith(".mp4") ? "video" : f.endsWith(".png") || f.endsWith(".jpg") ? "image" : "other";

// Gallery of outputs/<scenario>/: ref, keyframes, clips, final cut.
export default function OutputGallery({ scenario, refreshKey }: Props) {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    listOutputs(scenario).then((r) => setFiles(r.files));
  }, [scenario, refreshKey]);

  const media = files.filter((f) => kind(f) !== "other");
  const final = files.find((f) => f.endsWith("_final.mp4"));
  const ref = files.find((f) => f.endsWith("_ref.png"));
  const keyframes = files.filter((f) => /_seq\d+_.*\.png$/.test(f));
  const clips = files.filter((f) => /_clip\d+_.*\.mp4$/.test(f));

  return (
    <section className="card">
      <h2>Outputs</h2>
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
      {media.length === 0 && <p className="muted">No outputs yet — run the pipeline.</p>}
    </section>
  );
}
