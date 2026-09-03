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
