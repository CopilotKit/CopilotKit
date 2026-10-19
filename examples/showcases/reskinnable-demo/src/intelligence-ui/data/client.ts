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
import {
  SEED_EVAL_CANDIDATES,
  SEED_FINE_TUNE,
  SEED_INSIGHTS,
  SEED_SKILLS,
  SEED_TRAJECTORIES,
  seedDetail,
} from "../seed/history";
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
    if (!detail.error && !detail.message)
      throw new Unreachable(`${response.status} for ${path}`);
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
    throw new LearningApiError(
      `Not in the sample data: ${path}`,
      404,
      "NOT_FOUND",
    );
  }
  return structuredClone(sample[key]) as T;
}

function sampleWrite(path: string, body: Record<string, unknown>): unknown {
  let match: RegExpMatchArray | null;
  if ((match = path.match(/^\/eval-candidates\/([^/]+)\/review$/))) {
    const list = sample["/eval-candidates"] as EvalCandidate[];
    const candidate = list.find((c) => c.id === match?.[1]);
    if (candidate)
      (candidate as { status: string }).status = String(body.decision);
    return candidate;
  }
  if ((match = path.match(/^\/skills\/([^/]+)\/(approve|disable)$/))) {
    const list = sample["/skills"] as DemoSkill[];
    const skill = list.find(
      (s) => s.name === decodeURIComponent(match?.[1] ?? ""),
    );
    if (skill)
      (skill as { status: string }).status =
        match[2] === "approve" ? "published" : "disabled";
    return skill;
  }
  if (path === "/learn") {
    const result = structuredClone(seed["/learn"]) as LearnResult;
    sample["/insights"] = result.insights;
    sample["/skills"] = result.skills;
    sample["/eval-candidates"] = result.evalCandidates;
    return result;
  }
  if (path === "/evals/import") {
    // Sample mode: nothing reaches the eval platform; report it honestly.
    return { imported: body.cases, platform: "Benchline Evals", sample: true };
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

async function post<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (source !== "sample") {
    try {
      return await request<T>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
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

/*
 * Seeded history overlay (seed/history.ts): two weeks of earlier Ledgerline
 * activity merged under the live data, so no screen starts empty. Writes to a
 * seeded item stay in this browser; live items go to the API as before.
 */
const seeded = {
  candidates: SEED_EVAL_CANDIDATES.map((c) => ({ ...c })),
  skills: SEED_SKILLS.map((s) => ({ ...s })),
};
const isSeedTrajectory = (id: string) =>
  SEED_TRAJECTORIES.some((t) => t.trajectoryId === id);
const byNewest = <T extends { lastEventAt: number }>(rows: T[]) =>
  rows.sort((x, y) => y.lastEventAt - x.lastEventAt);
const mergeById = <T>(
  live: readonly T[],
  seed: readonly T[],
  key: (row: T) => string,
): T[] => {
  const ids = new Set(live.map(key));
  return [...live, ...seed.filter((row) => !ids.has(key(row)))];
};

export const learningV1 = {
  trajectories: async (signal?: AbortSignal) =>
    byNewest(
      mergeById(
        await get<TrajectorySummary[]>("/trajectories", signal),
        SEED_TRAJECTORIES,
        (t) => t.trajectoryId,
      ),
    ),
  trajectory: async (id: string, signal?: AbortSignal) => {
    const seed = isSeedTrajectory(id) ? seedDetail(id) : null;
    return (
      seed ??
      get<TrajectoryDetail>(`/trajectories/${encodeURIComponent(id)}`, signal)
    );
  },
  exportTrajectory: (id: string) =>
    get<unknown>(`/trajectories/${encodeURIComponent(id)}/agui`),
  evals: (signal?: AbortSignal) => get<EvalSuite>("/evals", signal),
  evalCandidates: async (signal?: AbortSignal) =>
    mergeById(
      await get<EvalCandidate[]>("/eval-candidates", signal),
      seeded.candidates,
      (c) => c.id,
    ),
  reviewEvalCandidate: async (
    id: string,
    decision: "accepted" | "rejected",
  ) => {
    const seed = seeded.candidates.find((c) => c.id === id);
    if (seed) {
      (seed as { status: string }).status = decision;
      return seed;
    }
    return post<unknown>(`/eval-candidates/${encodeURIComponent(id)}/review`, {
      decision,
    });
  },
  importToEvalPlatform: (
    cases: readonly {
      id: string;
      query: string;
      checks: readonly string[];
      sourceTrajectoryIds: readonly string[];
    }[],
  ) =>
    post<{ imported: unknown[]; platform: string; sample?: boolean }>(
      "/evals/import",
      { cases },
    ),
  insights: async (signal?: AbortSignal) =>
    mergeById(
      await get<DemoInsight[]>("/insights", signal),
      SEED_INSIGHTS,
      (i) => i.id,
    ),
  skills: async (signal?: AbortSignal) =>
    mergeById(
      await get<DemoSkill[]>("/skills", signal),
      seeded.skills,
      (s) => s.name,
    ),
  approveSkill: async (name: string) => {
    const seed = seeded.skills.find((s) => s.name === name);
    if (seed) {
      (seed as { status: string }).status = "published";
      return seed;
    }
    return post<unknown>(`/skills/${encodeURIComponent(name)}/approve`);
  },
  disableSkill: async (name: string) => {
    const seed = seeded.skills.find((s) => s.name === name);
    if (seed) {
      (seed as { status: string }).status = "disabled";
      return seed;
    }
    return post<unknown>(`/skills/${encodeURIComponent(name)}/disable`);
  },
  learn: () => post<LearnResult>("/learn"),
  fineTunePreview: async (
    target: FineTuneTarget,
    signal?: AbortSignal,
  ): Promise<FineTunePreview> => {
    const live = await get<FineTunePreview>(
      `/fine-tune/preview?target=${target}`,
      signal,
    );
    return {
      ...live,
      examples: live.examples + SEED_FINE_TUNE.examples,
      sample: [
        ...live.sample,
        ...(SEED_FINE_TUNE.sample as unknown as FineTunePreview["sample"]),
      ],
      lastExport: SEED_FINE_TUNE.lastExport,
    };
  },
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
