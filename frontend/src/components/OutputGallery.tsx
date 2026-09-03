import { useEffect, useRef, useState } from "react";
import { listOutputs, outputUrl, selectMain, uploadRef, type AssetEvent } from "../api";
import type { AssetVersion, MainsInfo, VersionsInfo, AssetKind } from "../types";
import { IconFilm, IconImage, IconRefresh, IconScissors, IconCheck, IconUpload, IconClipboard, IconX } from "./Icons";

interface Props {
  scenario: string;
  refreshKey: number; // bump to re-list files
  assets?: AssetEvent[]; // live: assets finished so far in the current run
  bare?: boolean; // render without the outer card (for nesting in RunPanel)
  generatingScenario?: string | null; // output dir of the scenario currently being generated
  regenTarget?: { kind: AssetKind; index?: number } | null; // exact asset a regen run is producing
  onStitch?: () => void; // ask the run panel to re-stitch the final cut
  onRegen?: (kind: AssetKind, index: number | null) => void;
  onUploaded?: () => void; // a ref upload landed — ask the app to re-list outputs
}

type RefMode = "generate" | "upload";

const pretty = (f: string) =>
  f.replace(/_[a-z]+\d+_.*\.(mp4|png)$/, "")
    .replace(/_/g, " ")
    .trim();

const byIndex = (a: AssetEvent, b: AssetEvent) => (a.index ?? 0) - (b.index ?? 0);

// Gallery of outputs/<scenario>/: ref, keyframes, clips (with version
// pickers + regenerate), final cut.
export default function OutputGallery({ scenario, refreshKey, assets, bare, generatingScenario, regenTarget, onStitch, onRegen, onUploaded }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionsInfo>({ ref: [], beats: {} });
  const [mains, setMains] = useState<MainsInfo>({ ref: null, beats: {} });
  const [error, setError] = useState("");
  // Reference source: generate with Flux, or upload/paste an image.
  const [refMode, setRefMode] = useState<RefMode>("generate");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readAsDataUrl = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("could not read file"));
      r.readAsDataURL(f);
    });

  const doUpload = async (f: File) => {
    if (!scenario || uploading) return;
    if (!f.type.startsWith("image/")) { setUploadError("not an image file"); return; }
    setUploading(true);
    setUploadError("");
    try {
      const data = await readAsDataUrl(f);
      await uploadRef(scenario, data);
      onUploaded?.();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Clipboard paste (Ctrl+V) uploads the image as the reference while in
  // upload mode. Window-scoped so it works no matter where focus is.
  useEffect(() => {
    if (refMode !== "upload" || assets) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (f) { e.preventDefault(); doUpload(f); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [refMode, scenario, uploading, assets]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // True when the active run is generating into THIS output dir. The version
  // rows then show a blinking "generating vN" chip on the asset that is
  // actually in progress. For regen runs the exact target is known; for full
  // runs it's the first asset in pipeline order (ref -> keyframes -> clips)
  // without a version yet.
  const generating = !!generatingScenario && generatingScenario === scenario;
  const genTarget = (() => {
    if (!generating) return null;
    if (regenTarget) {
      if (regenTarget.kind === "ref") return "ref";
      if (regenTarget.kind === "keyframe") return `kf:${regenTarget.index}`;
      if (regenTarget.kind === "clip") return `clip:${regenTarget.index}`;
    }
    if (!versions.ref.length) return "ref";
    for (const n of beatNums) {
      if (!versions.beats[String(n)].keyframe.length) return `kf:${n}`;
    }
    for (const n of beatNums) {
      if (!versions.beats[String(n)].clip.length) return `clip:${n}`;
    }
    return null; // everything exists — the run is re-stitching the final cut
  })();

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
          <div className="section-label">
            Final cut
            {generating && genTarget === null && (
              <span className="gen-flag" title="Re-stitching the final cut from the selected main versions">
                <span className="dot pulse" /> stitching
              </span>
            )}
          </div>
          <div className="video-frame">
            <video controls src={outputUrl(scenario, final)} />
          </div>
        </>
      )}
      {scenario ? (
        <>
          <div className="section-label">
            Reference
            {versions.ref.length > 1 && <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}> · {versions.ref.length} versions</span>}
          </div>
          <div className="seg ref-mode">
            <button className={refMode === "generate" ? "on" : ""} onClick={() => setRefMode("generate")} title="Generate the reference with Flux from the reference prompt">
              Generate
            </button>
            <button className={refMode === "upload" ? "on" : ""} onClick={() => setRefMode("upload")} title="Upload or paste your own reference image">
              <IconUpload size={11} />
              Upload
            </button>
          </div>
          {refMode === "generate" ? (
            <>
              <div className="img-frame">
                {refFile ? (
                  <img src={outputUrl(scenario, refFile)} alt="reference" loading="lazy" />
                ) : (
                  <div className="frame-missing">
                    {genTarget === "ref"
                      ? <span className="gen-flag"><span className="dot pulse" /> generating…</span>
                      : "no reference yet — start a run, or switch to Upload"}
                  </div>
                )}
              </div>
              <VersionRow
                versions={versions.ref}
                main={mains.ref}
                kind="image"
                onSelect={(f) => pickMain("ref", null, f)}
                onRegen={() => onRegen?.("ref", null)}
                generating={genTarget === "ref"}
              />
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doUpload(f);
                }}
              />
              <div
                className={`upload-zone${dragOver ? " over" : ""}${uploading ? " busy" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) doUpload(f);
                }}
              >
                {refFile ? (
                  <img src={outputUrl(scenario, refFile)} alt="reference" loading="lazy" />
                ) : (
                  <div className="frame-missing">
                    <span className="gen-flag"><span className="dot pulse" /> {uploading ? "uploading…" : genTarget === "ref" ? "generating…" : "no reference yet"}</span>
                  </div>
                )}
                <div className="upload-actions">
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    <IconUpload size={11} />
                    Browse
                  </button>
                  <button
                    disabled={uploading}
                    title="Paste the clipboard image (or press Ctrl+V anywhere)"
                    onClick={async () => {
                      try {
                        const items = await navigator.clipboard.read();
                        const img = items.find((i) => i.types.includes("image/png")) || items.find((i) => i.types[0]?.startsWith("image/"));
                        if (img) {
                          const t = img.types.find((x) => x.startsWith("image/"))!;
                          const blob = await img.getType(t);
                          doUpload(new File([blob], "clipboard.png", { type: t }));
                        } else setUploadError("no image on the clipboard");
                      } catch {
                        setUploadError("clipboard unavailable — copy an image or use Ctrl+V");
                      }
                    }}
                  >
                    <IconClipboard size={11} />
                    Paste
                  </button>
                  <span className="muted upload-hint">or drag &amp; drop / Ctrl+V</span>
                </div>
              </div>
              {uploadError && <p className="hint err-text">{uploadError}</p>}
              <p className="hint">Uploaded image becomes the main reference — the run uses it instead of generating one.</p>
              <VersionRow
                versions={versions.ref}
                main={mains.ref}
                kind="image"
                onSelect={(f) => pickMain("ref", null, f)}
                onRegen={() => onRegen?.("ref", null)}
                generating={genTarget === "ref"}
              />
            </>
          )}
        </>
      ) : null}
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
                  {genTarget === `kf:${n}` && !bv.keyframe.length && (
                    <GenChip v={1} />
                  )}
                  <VersionRow
                    versions={bv.keyframe}
                    main={mains.beats[String(n)]?.keyframe}
                    kind="image"
                    onSelect={(f) => pickMain("keyframe", n, f)}
                    onRegen={() => onRegen?.("keyframe", n)}
                    generating={genTarget === `kf:${n}`}
                  />
                  <div className="video-frame">
                    {clipMain
                      ? <video controls src={outputUrl(scenario, clipMain)} />
                      : <div className="frame-missing">no clip</div>}
                  </div>
                  {genTarget === `clip:${n}` && !bv.clip.length && (
                    <GenChip v={1} />
                  )}
                  <VersionRow
                    versions={bv.clip}
                    main={mains.beats[String(n)]?.clip}
                    kind="video"
                    onSelect={(f) => pickMain("clip", n, f)}
                    onRegen={() => onRegen?.("clip", n)}
                    generating={genTarget === `clip:${n}`}
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
      {mediaCount === 0 && !generating && (
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

// Blinking "generating vN" chip (blinking dot) — shown while a run is
// producing this version; previous versions are kept.
function GenChip({ v }: { v: number }) {
  return (
    <div className="versions">
      <span className="vchip gen" title={`Generating v${v} — previous versions are kept`}>
        <span className="dot pulse" />
        v{v} generating
      </span>
    </div>
  );
}

// Version chips (v1, v2, …) + regenerate button for one versioned asset.
function VersionRow({ versions, main, kind, onSelect, onRegen, generating }: {
  versions: AssetVersion[];
  main: string | null;
  kind: "image" | "video";
  onSelect: (file: string) => void;
  onRegen?: () => void;
  generating?: boolean; // a run is producing the next version right now
}) {
  if (versions.length === 0) return null;
  const nextV = versions[versions.length - 1].v + 1;
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
      {generating && (
        <span className="vchip gen" title={`Generating v${nextV} — previous versions are kept`}>
          <span className="dot pulse" />
          v{nextV} generating
        </span>
      )}
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
