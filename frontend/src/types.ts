export interface Beat {
  title: string;
  image: string;
  motion: string;
}

export interface Scenario {
  description?: string;
  character?: string;
  referencePrompt: string;
  duration: number;
  sequence: Beat[];
}

export interface ScenarioInfo {
  name: string;
  isSequence: boolean;
}

export interface Run {
  id: string;
  scenario: string;
  status: "running" | "done" | "error";
  log: string;
  startedAt: number;
}

export interface AuthUser {
  user: string;
}

export interface ComfyStatus {
  up: boolean;
  error?: string;
  queue?: { queue_running?: unknown[]; queue_pending?: unknown[] };
  stats?: Record<string, unknown>;
}

// One version of a versioned asset (v1 = original file, vN = _vN suffix).
export interface AssetVersion {
  file: string;
  v: number;
}

export interface BeatVersions {
  keyframe: AssetVersion[];
  clip: AssetVersion[];
}

export interface VersionsInfo {
  ref: AssetVersion[];
  beats: Record<string, BeatVersions>;
}

export interface MainsInfo {
  ref: string | null;
  beats: Record<string, { keyframe: string | null; clip: string | null }>;
}

export interface OutputsInfo {
  files: string[];
  versions: VersionsInfo;
  mains: MainsInfo;
}

export type AssetKind = "ref" | "keyframe" | "clip";
