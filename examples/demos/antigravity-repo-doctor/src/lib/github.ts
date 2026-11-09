import { serverEnv } from "@/lib/env";
import type { CiFacts, RepoFacts } from "@/lib/example-repos";

/**
 * Live facts for the empty state's repository cards, read from the GitHub REST
 * API on the server. Uses GITHUB_TOKEN when set (read-only, 5,000 requests an
 * hour); without it the API allows 60 an hour per IP, so results are cached
 * for ten minutes and served stale while a refresh runs. A card whose facts
 * cannot be read renders without them; nothing is filled in.
 */

const API = "https://api.github.com";
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;
// Runs that are not the default branch's own CI: Dependabot update jobs, and
// pull request runs (a fork's branch can share the default branch's name).
const NOT_BRANCH_CI = new Set([
  "dynamic",
  "pull_request",
  "pull_request_target",
]);
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

interface Run {
  workflow_id: number;
  name: string | null;
  event: string;
  conclusion: string | null;
  created_at: string;
}

async function get<T>(path: string): Promise<T> {
  const token = serverEnv().GITHUB_TOKEN;
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "repo-doctor",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`GitHub API ${response.status} for ${path}`);
  return (await response.json()) as T;
}

const branchRuns = (runs: Run[]) =>
  runs.filter((run) => !NOT_BRANCH_CI.has(run.event));

/** The newest completed run of each workflow, newest first. */
export function latestPerWorkflow(runs: Run[]): Run[] {
  const seen = new Set<number>();
  return branchRuns(runs).filter((run) => {
    if (seen.has(run.workflow_id)) return false;
    seen.add(run.workflow_id);
    return true;
  });
}

/**
 * Where the current run of failures began, from one workflow's history (newest
 * first). Only a success ends the streak; cancelled or skipped runs do not.
 */
export function redSince(
  history: Run[],
): { since: string; atLeast: boolean } | null {
  let since: string | null = null;
  for (const run of branchRuns(history)) {
    if (run.conclusion === "success")
      return since ? { since, atLeast: false } : null;
    if (run.conclusion && FAILED.has(run.conclusion)) since = run.created_at;
  }
  return since ? { since, atLeast: true } : null;
}

async function readCi(slug: string, branch: string): Promise<CiFacts | null> {
  const query = `branch=${encodeURIComponent(branch)}&status=completed&per_page=100`;
  const { workflow_runs } = await get<{ workflow_runs: Run[] }>(
    `/repos/${slug}/actions/runs?${query}`,
  );
  const latest = latestPerWorkflow(workflow_runs);
  if (latest.length === 0) return null;
  const failing = latest.filter(
    (run) => run.conclusion && FAILED.has(run.conclusion),
  );
  const newest = failing[0];
  if (!newest) return { state: "passing", workflows: latest.length };
  const history = await get<{ workflow_runs: Run[] }>(
    `/repos/${slug}/actions/workflows/${newest.workflow_id}/runs?${query}`,
  );
  const streak = redSince(history.workflow_runs) ?? {
    since: newest.created_at,
    atLeast: false,
  };
  return {
    state: "failing",
    workflow: newest.name ?? "A workflow",
    failingWorkflows: failing.length,
    ...streak,
  };
}

async function readFacts(
  slug: string,
): Promise<RepoFacts & { ciRead: boolean }> {
  const repo = await get<{
    stargazers_count: number;
    language: string | null;
    default_branch: string;
    owner: { avatar_url: string };
  }>(`/repos/${slug}`);
  // CI is read separately so a repo without Actions access still shows its facts.
  const ci = await readCi(slug, repo.default_branch).catch((error: unknown) => {
    console.warn(
      `Could not read CI for ${slug}:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  });
  const avatar = new URL(repo.owner.avatar_url);
  avatar.searchParams.set("s", "96");
  return {
    stars: repo.stargazers_count,
    language: repo.language,
    avatarUrl: avatar.toString(),
    defaultBranch: repo.default_branch,
    ci: ci ?? null,
    ciRead: ci !== undefined,
  };
}

const cache = new Map<string, { at: number; facts: RepoFacts }>();
const inFlight = new Map<string, Promise<RepoFacts | null>>();

function refresh(slug: string): Promise<RepoFacts | null> {
  const pending = inFlight.get(slug);
  if (pending) return pending;
  const next = readFacts(slug)
    .then((facts) => {
      // A failed CI read is retried on the next request instead of cached.
      if (facts.ciRead) cache.set(slug, { at: Date.now(), facts });
      return facts;
    })
    .catch((error: unknown) => {
      console.warn(
        `Could not read ${slug} from GitHub:`,
        error instanceof Error ? error.message : error,
      );
      return cache.get(slug)?.facts ?? null;
    })
    .finally(() => inFlight.delete(slug));
  inFlight.set(slug, next);
  return next;
}

/** Facts for one repository: cached, refreshed in the background once stale. */
export async function repoFacts(slug: string): Promise<RepoFacts | null> {
  const hit = cache.get(slug);
  if (hit) {
    if (Date.now() - hit.at > TTL_MS) void refresh(slug);
    return hit.facts;
  }
  return refresh(slug);
}
