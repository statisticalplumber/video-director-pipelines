// Versioned asset management for character-sequence outputs.
//
// Every generated asset keeps all its versions on disk:
//   v1 (first generation)  -> <prefix>_ref.png / <prefix>_seq1_<title>.png / <prefix>_clip1_<title>.mp4
//   vN (regenerations)     -> same base name + "_vN" before the extension
//
// The "main" version of each asset (the one stitched into the final cut, and
// the keyframe a clip is generated from) is stored in <outDir>/state.json:
//   { "ref": "<file>", "beats": { "1": { "keyframe": "<file>", "clip": "<file>" } } }
// Missing entries mean "latest version on disk".
//
// Used by scripts/character_sequence{,_wan}.mjs and frontend/server.mjs.
import fs from "node:fs";
import path from "node:path";

export const stateFile = (outDir) => path.join(outDir, "state.json");

export function loadState(outDir) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(outDir), "utf8"));
    return { ref: null, beats: {}, ...s };
  } catch {
    return { ref: null, beats: {} };
  }
}

export function saveState(outDir, state) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(stateFile(outDir), JSON.stringify(state, null, 2));
}

// kind: "ref" | "seq" | "clip"
export function baseName(prefix, kind, index, title) {
  return kind === "ref" ? `${prefix}_ref` : `${prefix}_${kind}${index}_${title}`;
}

const VERSION_RE = /_v(\d+)$/;

/**
 * All versions of one asset, sorted by version (v1 first).
 * Returns [{ file, v }].
 */
export function versionsOf(outDir, prefix, kind, index, ext, title) {
  const dir = outDir;
  if (!fs.existsSync(dir)) return [];
  const base = baseName(prefix, kind, index, title);
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(ext)) continue;
    let v = 1;
    if (f === base + ext) out.push({ file: f, v });
    else {
      const m = f.slice(0, -ext.length).match(new RegExp(`^${escapeRe(base)}_v(\\d+)$`));
      if (m) { v = Number(m[1]); out.push({ file: f, v }); }
    }
  }
  return out.sort((a, b) => a.v - b.v);
}

/**
 * Resolve the file to use as "main" for an asset:
 * explicit state selection (if it still exists) -> latest version -> null.
 */
export function resolveMain(outDir, prefix, kind, index, ext, title, state) {
  const versions = versionsOf(outDir, prefix, kind, index, ext, title);
  if (!versions.length) return null;
  const sel = kind === "ref" ? state.ref : state.beats?.[String(index)]?.[kind === "seq" ? "keyframe" : "clip"];
  const pick = versions.find((x) => x.file === sel);
  return (pick || versions[versions.length - 1]).file;
}

/** Set the main version for an asset (must be an existing file). */
export function setMain(outDir, prefix, kind, index, title, file) {
  const state = loadState(outDir);
  if (kind === "ref") state.ref = file;
  else {
    const key = kind === "seq" || kind === "keyframe" ? "keyframe" : "clip";
    state.beats[String(index)] = { ...(state.beats[String(index)] || {}), [key]: file };
  }
  saveState(outDir, state);
  return state;
}

/** Next free version number for a new file (1 if none exist yet). */
export function nextVersion(outDir, prefix, kind, index, ext, title) {
  const versions = versionsOf(outDir, prefix, kind, index, ext, title);
  return versions.length ? versions[versions.length - 1].v + 1 : 1;
}

/**
 * Full version map for one scenario output dir (served by the frontend).
 * Returns { ref: [v], beats: { "1": { keyframe: [v], clip: [v] } }, mains: {...} }.
 */
export function versionMap(outDir, prefix, seq) {
  const state = loadState(outDir);
  const refVersions = versionsOf(outDir, prefix, "ref", 0, ".png");
  const beats = {};
  seq.forEach((s, i) => {
    const n = i + 1;
    const kf = versionsOf(outDir, prefix, "seq", n, ".png", s.title);
    const clip = versionsOf(outDir, prefix, "clip", n, ".mp4", s.title);
    beats[String(n)] = {
      keyframe: kf,
      clip,
      keyframeMain: resolveMain(outDir, prefix, "seq", n, ".png", s.title, state),
      clipMain: resolveMain(outDir, prefix, "clip", n, ".mp4", s.title, state),
    };
  });
  return {
    ref: refVersions,
    refMain: resolveMain(outDir, prefix, "ref", 0, ".png", null, state),
    beats,
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
