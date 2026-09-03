import { useEffect, useState } from "react";
import { listOutputs, outputUrl, selectMain, type AssetEvent } from "../api";
import type { AssetVersion, MainsInfo, VersionsInfo, AssetKind } from "../types";
import { IconFilm, IconImage, IconRefresh, IconScissors, IconCheck } from "./Icons";

interface Props {
  scenario: string;
  refreshKey: number; // bump to re-list files
  assets?: AssetEvent[]; // live: assets finished so far in the current run
  bare?: boolean; // render without the outer card (for nesting in RunPanel)
  onStitch?: () => void; // ask the run panel to re-stitch the final cut
  onRegen?: (kind: AssetKind, index: number | null) => void;
}

const pretty = (f: string) =>
  f.replace(/_[a-z]+\d+_.*\.(mp4|png)$/, "")
    .replace(/_/g, " ")
    .trim();

const byIndex = (a: AssetEvent, b: AssetEvent) => (a.index ?? 0) - (b.index ?? 0);

// Gallery of outputs/<scenario>/: ref, keyframes, clips (with version
// pickers + regenerate), final cut.
export default function OutputGallery({ scenario, refreshKey, assets, bare, onStitch, onRegen }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionsInfo>({ ref: [], beats: {} });
  const [mains, setMains] = useState<MainsInfo>({ ref: null, beats: {} });
  const [error, setError] = useState("");

  useEffect(() => {
    setFiles([]);
    setVersions({ ref: [], beats: {} });
    setMains({ ref: null, beats: {} });
    setError("");
    if (!assets) {
      listOutputs(scenario).then((r) => {
        setFiles(r.files);
        setVersions(r.versions);
        setMains(r.mains);
      }).catch((e) => setError(String(e.message || e)));
    }
  }, [scenario, refreshKey, assets]);

  // Live-run view: no versioning UI (versions are created by the run itself).
  if (assets) {
    const live = assets;
    const final = live.find((a) => a.stage === "final")?.file;
    const ref = live.find((a) => a.stage === "reference")?.file;
    const keyframes = live.filter((a) => a.stage === "keyframe").sort(byIndex).map((a) => a.file);
    const clips = live.filter((a) => a.stage === "clip").sort(byIndex).map((a) => a.file);
    const mediaCount = keyframes.length + clips.length + (ref ? 1 : 0) + (final ? 1 : 0);
    const Tag = bare ? "div" : "section";
    return (
      <Tag className={bare ? undefined : "card"}>
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
          </div>
        )}
      </Tag>
    );
  }

  // Static view with versioning.
  const final = files.find((f) => f.endsWith("_final.mp4"));
  const refFile = mains.ref || versions.ref[versions.ref.length - 1]?.file
    || files.find((f) => /_ref(\.png|_v\d+\.png)$/.test(f)) || null;
  const beatNums = Object.keys(versions.beats).map(Number).sort((a, b) => a - b);
  // Fallback for legacy dirs where versioning can't resolve (e.g. beat titles renamed since).
  const fallbackShots = beatNums.length === 0
    ? files
        .filter((f) => /_seq\d+_.*\.png$/.test(f))
        .sort()
        .map((kf) => ({
          kf,
          clip: files.find((c) => /_clip\d+_.*\.mp4$/.test(c) && c.replace(/\.mp4$/, ".png") === kf) || null,
        }))
    : [];
  const hasClips = beatNums.some((n) => (versions.beats[String(n)].clip?.length ?? 0) > 0) || fallbackShots.some((s) => s.clip);

  const pickMain = async (kind: "ref" | "keyframe" | "clip", index: number | null, file: string) => {
    try {
      const r = await selectMain(scenario, kind, index, file);
      setVersions(r.versions);
      setMains(r.mains);
      setFiles(r.files);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doStitch = () => onStitch?.();

  const mediaCount = beatNums.length + (refFile ? 1 : 0) + (final ? 1 : 0);

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
          {hasClips && (
            <button
              onClick={doStitch}
              title="Concatenate the selected main clip versions into the final cut"
            >
              <IconScissors size={12} />
              Stitch final
            </button>
          )}
          {scenario && (
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--mono)" }}>
              outputs/{scenario}/
            </span>
          )}
        </div>
      )}

      {error && <p className="hint err-text">{error}</p>}

      {final && (
        <>
          <div className="section-label">Final cut</div>
          <div className="video-frame">
            <video controls src={outputUrl(scenario, final)} />
          </div>
        </>
      )}
      {refFile && (
        <>
          <div className="section-label">
            Reference
            {versions.ref.length > 1 && <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}> · {versions.ref.length} versions</span>}
          </div>
          <div className="img-frame">
            <img src={outputUrl(scenario, refFile)} alt="reference" loading="lazy" />
          </div>
          <VersionRow
            versions={versions.ref}
            main={mains.ref}
            kind="image"
            onSelect={(f) => pickMain("ref", null, f)}
            onRegen={() => onRegen?.("ref", null)}
          />
        </>
      )}
      {(beatNums.length > 0 || fallbackShots.length > 0) && (
        <>
          <div className="section-label">Keyframes → clips</div>
          <div className="grid">
            {beatNums.map((n) => {
              const bv = versions.beats[String(n)];
              const kfMain = mains.beats[String(n)]?.keyframe || bv.keyframe[bv.keyframe.length - 1]?.file || null;
              const clipMain = mains.beats[String(n)]?.clip || bv.clip[bv.clip.length - 1]?.file || null;
              return (
                <div className="shot" key={n}>
                  <div className="img-frame">
                    {kfMain
                      ? <img src={outputUrl(scenario, kfMain)} alt={pretty(kfMain)} loading="lazy" />
                      : <div className="frame-missing">no keyframe</div>}
                  </div>
                  <VersionRow
                    versions={bv.keyframe}
                    main={mains.beats[String(n)]?.keyframe}
                    kind="image"
                    onSelect={(f) => pickMain("keyframe", n, f)}
                    onRegen={() => onRegen?.("keyframe", n)}
                  />
                  <div className="video-frame">
                    {clipMain
                      ? <video controls src={outputUrl(scenario, clipMain)} />
                      : <div className="frame-missing">no clip</div>}
                  </div>
                  <VersionRow
                    versions={bv.clip}
                    main={mains.beats[String(n)]?.clip}
                    kind="video"
                    onSelect={(f) => pickMain("clip", n, f)}
                    onRegen={() => onRegen?.("clip", n)}
                  />
                </div>
              );
            })}
            {fallbackShots.map(({ kf, clip }) => (
              <div className="shot" key={kf}>
                <div className="img-frame">
                  <img src={outputUrl(scenario, kf)} alt={pretty(kf)} loading="lazy" />
                </div>
                {clip && (
                  <div className="video-frame">
                    <video controls src={outputUrl(scenario, clip)} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="hint">
            Pick a version to make it <b>main</b> — the final cut stitches the main version of every beat.
            Regenerate keeps old versions.
          </p>
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

// Version chips (v1, v2, …) + regenerate button for one versioned asset.
function VersionRow({ versions, main, kind, onSelect, onRegen }: {
  versions: AssetVersion[];
  main: string | null;
  kind: "image" | "video";
  onSelect: (file: string) => void;
  onRegen?: () => void;
}) {
  if (versions.length === 0) return null;
  return (
    <div className="versions">
      {versions.map((v) => (
        <button
          key={v.file}
          className={`vchip ${main === v.file ? "on" : ""}`}
          title={main === v.file ? `${v.file} (main — used in stitch)` : `Set ${v.file} as main`}
          onClick={() => onSelect(v.file)}
        >
          {main === v.file && <IconCheck size={10} />}
          v{v.v}
        </button>
      ))}
      {onRegen && (
        <button
          className="vchip regen"
          title={`Regenerate ${kind} — keeps previous versions`}
          onClick={onRegen}
        >
          <IconRefresh size={10} />
          regen
        </button>
      )}
    </div>
  );
}
