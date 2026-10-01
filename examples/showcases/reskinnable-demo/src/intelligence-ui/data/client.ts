"use client";

/**
 * Client for the Automatic Learning demo API, same origin (`/api/learning/v1`).
 *
 * Live data first. When the API cannot be reached (network failure, or a
 * response that is not the API's JSON), every read falls back to the bundled
 * sample data, which follows the same contract, and writes are applied to an
 * in-memory copy of it. An API that answers with a JSON error is NOT a fallback:
 * that error is real and is thrown with the API's own message.
 */
import { useSyncExternalStore } from "react";
import sampleJson from "./sample-data.json";
import type {
  DemoInsight,
  DemoSkill,
  EvalCandidate,
  EvalSuite,
  FineTunePreview,
  FineTuneTarget,
  LearnResult,
  TrajectoryDetail,
  TrajectorySummary,
} from "./contract";

const BASE = "/api/learning/v1";

export type DataSource = "probing" | "live" | "sample";

type SampleStore = Record<string, unknown>;
const seed = sampleJson as unknown as SampleStore;
let sample: SampleStore = structuredClone(seed);

let source: DataSource = "probing";
const listeners = new Set<() => void>();
function setSource(next: DataSource): void {
  if (source === next) return;
  source = next;
  listeners.forEach((listener) => listener());
}

/** Subscribes a component to the Live / Sample indicator. */
export function useDataSource(): DataSource {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => source,
    () => "probing",
  );
}

/** Raised when the API answered with its own `{ error, message }` body. */
export class LearningApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

class Unreachable extends Error {}

async function request<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      ...init,
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Unreachable(String(error));
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Unreachable(`Non-JSON response for ${path}`);
  }
  if (!response.ok) {
    const detail = (body ?? {}) as { error?: string; message?: string };
    if (!detail.error && !detail.message) throw new Unreachable(`${response.status} for ${path}`);
    throw new LearningApiError(
      detail.message ?? `${response.status} ${response.statusText}`,
      response.status,
      detail.error,
    );
  }
  setSource("live");
  return body as T;
}

function sampleRead<T>(path: string): T {
  const exportMatch = path.match(/^\/trajectories\/([^/?]+)\/export$/);
  const key = exportMatch ? `/trajectories/${exportMatch[1]}` : path;
  if (!(key in sample)) {
    throw new LearningApiError(`Not in the sample data: ${path}`, 404, "NOT_FOUND");
  }
  return structuredClone(sample[key]) as T;
}

function sampleWrite(path: string, body: Record<string, unknown>): unknown {
  let match: RegExpMatchArray | null;
  if ((match = path.match(/^\/eval-candidates\/([^/]+)\/review$/))) {
    const list = sample["/eval-candidates"] as EvalCandidate[];
    const candidate = list.find((c) => c.id === match?.[1]);
    if (candidate) (candidate as { status: string }).status = String(body.decision);
    return candidate;
  }
  if ((match = path.match(/^\/skills\/([^/]+)\/(approve|disable)$/))) {
    const list = sample["/skills"] as DemoSkill[];
    const skill = list.find((s) => s.name === decodeURIComponent(match?.[1] ?? ""));
    if (skill) (skill as { status: string }).status = match[2] === "approve" ? "published" : "disabled";
    return skill;
  }
  if (path === "/learn") {
    const result = structuredClone(seed["/learn"]) as LearnResult;
    sample["/insights"] = result.insights;
    sample["/skills"] = result.skills;
    sample["/eval-candidates"] = result.evalCandidates;
    return result;
  }
  if (path === "/reset") {
    sample = structuredClone(seed);
    return { ok: true };
  }
  throw new LearningApiError(`No sample handler for ${path}`, 404, "NOT_FOUND");
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (source !== "sample") {
    try {
      return await request<T>(path, undefined, signal);
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      setSource("sample");
    }
  }
  return sampleRead<T>(path);
}

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (source !== "sample") {
    try {
      return await request<T>(path, { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      setSource("sample");
    }
  }
  return sampleWrite(path, body) as T;
}

/** Re-checks the API so the indicator can return to Live after an outage. */
export async function probe(): Promise<void> {
  try {
    await request<unknown>("/trajectories");
  } catch (error) {
    if (error instanceof Unreachable) setSource("sample");
  }
}

export const learningV1 = {
  trajectories: (signal?: AbortSignal) => get<TrajectorySummary[]>("/trajectories", signal),
  trajectory: (id: string, signal?: AbortSignal) =>
    get<TrajectoryDetail>(`/trajectories/${encodeURIComponent(id)}`, signal),
  exportTrajectory: (id: string) => get<unknown>(`/trajectories/${encodeURIComponent(id)}/export`),
  evals: (signal?: AbortSignal) => get<EvalSuite>("/evals", signal),
  evalCandidates: (signal?: AbortSignal) => get<EvalCandidate[]>("/eval-candidates", signal),
  reviewEvalCandidate: (id: string, decision: "accepted" | "rejected") =>
    post<unknown>(`/eval-candidates/${encodeURIComponent(id)}/review`, { decision }),
  insights: (signal?: AbortSignal) => get<DemoInsight[]>("/insights", signal),
  skills: (signal?: AbortSignal) => get<DemoSkill[]>("/skills", signal),
  approveSkill: (name: string) => post<unknown>(`/skills/${encodeURIComponent(name)}/approve`),
  disableSkill: (name: string) => post<unknown>(`/skills/${encodeURIComponent(name)}/disable`),
  learn: () => post<LearnResult>("/learn"),
  fineTunePreview: (target: FineTuneTarget, signal?: AbortSignal) =>
    get<FineTunePreview>(`/fine-tune/preview?target=${target}`, signal),
  reset: () => post<unknown>("/reset"),
};

/** Saves text as a file from the browser. */
export function downloadFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
