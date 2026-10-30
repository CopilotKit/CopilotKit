import type { Snapshot } from "@/lib/build-timeline";

export type RecordedRun = {
  file: string;
  prompt: string;
  mode: string;
  path: string;
  tool?: string;
  firstFrameMs: number;
  totalMs: number;
  tps: number | null;
  tokens: number | null;
  events: Array<{ t: number; kind: string; label: string; detail?: string }>;
  frames: Snapshot[];
  recordedAt?: string;
};

export type Recipe = { key: string; name: string; text: string };
