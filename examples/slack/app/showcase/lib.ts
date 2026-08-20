/**
 * Shared data helpers for the showcase features.
 *
 * GitHub reads are UNAUTHENTICATED by design — CopilotKit's repos are public,
 * so PRs/issues/stars need no token. A `GITHUB_TOKEN`, if present in the env,
 * is used only to raise the rate limit (60→5000 req/hr); it is never required.
 * npm's downloads API is fully public. Only Linear (no public read) needs a key.
 */
import type { ChannelToolContext } from "@copilotkit/channels";

/**
 * The `thread` handed to tool/command handlers. Aliased so the shared `render*`
 * fns take exactly the type the handlers pass (avoids the channels-core class
 * vs. channels-ui interface `Thread` mismatch).
 */
export type ShowcaseThread = ChannelToolContext["thread"];

export const REPO = "CopilotKit/CopilotKit";

/**
 * Per-request timeout. Without it a stalled upstream (connection accepted but
 * never responding) would hang the handler forever — `fetch` never rejects, so
 * the sample-data `catch` never runs. `AbortSignal.timeout` turns a stall into
 * a catchable error that hits the existing fallback + log path.
 */
export const FETCH_TIMEOUT_MS = 8000;

const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "copilotkit-channels-showcase",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** Fetch JSON from the GitHub REST API. Adds the optional token only if set. */
export async function ghFetch<T>(path: string): Promise<T> {
  const token = process.env["GITHUB_TOKEN"];
  const headers = token
    ? { ...GH_HEADERS, Authorization: `Bearer ${token}` }
    : GH_HEADERS;
  const res = await fetch(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GitHub ${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Fetch JSON from any URL (npm downloads, etc.). */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** `" (sample)"` when not live — so charts posted from sample data are labelled too. */
export function sampleTag(live: boolean): string {
  return live ? "" : " (sample)";
}

/** Whole days between `iso` and now (>= 0). */
export function ageInDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** `YYYY-MM-DD` for `n` days ago (UTC) — for GitHub search date filters. */
export function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Compact number for KPI tiles: 12_800 → "12.8k", 1_500_000 → "1.5M". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
