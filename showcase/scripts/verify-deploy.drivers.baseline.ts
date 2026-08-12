import fs from "fs";
import path from "path";
import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { ENV_ID_BY_NAME, SERVICES } from "./railway-envs";
import type { EnvName } from "./railway-envs";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { resolveRailwayTokenFromConfig } from "./lib/railway-token";

/**
 * Shared baseline implementation for every `verify-deploy` driver. Every
 * driver must enforce the same two minimum invariants before any
 * driver-specific feature-level checks run:
 *
 *   1. **deployment-SUCCESS** — query Railway GraphQL
 *      (`deployments(first:1, input:{serviceId, environmentId})`) for the
 *      service's latest deployment in the target env, and assert
 *      `status === "SUCCESS"`. This catches the "Railway accepted the
 *      image but the container crash-loops" case that a naked HTTP probe
 *      can miss (Railway briefly serves the previous good deploy via
 *      sticky routing).
 *   2. **HTTP 200** — GET `https://<host><healthcheckPath>` and assert
 *      `res.status === 200`.
 *
 * Each driver wraps `probeBaseline` with its own `driverLabel` and a
 * sensible `healthcheckPath` for that service shape (Next.js shells use
 * `/`, agent backends use `/api/health`, etc.; matches the Railway
 * healthcheck config set by `deploy-to-railway.ts`). The
 * "200 ≠ healthy" rule is still owed to the per-driver feature-level
 * extensions (DOM string, fixture replay, admin login, etc.) —
 * `probeBaseline` is the floor, not the ceiling.
 *
 * Network seams (`fetchImpl`, `getRailwayToken`) are injected so tests
 * can run fully offline. Production callers omit them and get the real
 * `globalThis.fetch` + the `~/.railway/config.json` resolver.
 */

export interface RailwayDeploymentNode {
  id: string;
  status: string;
}

export interface RailwayDeploymentsResponse {
  data?: {
    deployments?: {
      edges?: Array<{ node?: RailwayDeploymentNode }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /**
   * Optional WHATWG body — exposed so we can drain/cancel it after
   * reading status. Undici (Node's fetch impl) leaks sockets when the
   * body is not consumed or cancelled. Test seams that return a plain
   * stub omit this field; production fetch always populates it.
   */
  body?: { cancel?: () => Promise<void> } | null;
}>;

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: unknown }).name;
  return name === "AbortError";
}

/**
 * Drain/cancel an HTTP response body so undici releases the socket.
 * Safe on stubs (test seams) that lack a body — we only cancel when
 * the runtime supplies one.
 */
async function releaseBody(res: Awaited<ReturnType<FetchLike>>): Promise<void> {
  try {
    await res.body?.cancel?.();
  } catch (e: unknown) {
    // Expected benign case: undici throws when the body is already
    // "locked" (a reader is attached, or it was fully read by an
    // earlier `res.json()` / `res.text()`). In every such case the
    // socket is already released, so this is a no-op — swallow it.
    // Anything else is unexpected; surface it on stderr so we don't
    // hide a real bug, but keep `releaseBody` best-effort (never
    // propagate — undici socket release is an optimization, not a
    // correctness invariant).
    const msg = e instanceof Error ? e.message : String(e);
    const locked = /lock/i.test(msg);
    if (!locked) {
      process.stderr.write(
        `[verify-deploy] releaseBody: unexpected cancel error: ${msg}\n`,
      );
    }
  }
}

export interface BaselineOpts {
  /** Short driver-name tag woven into every error string for grep-ability. */
  driverLabel: string;
  /** Path appended to `https://<host>` for the healthcheck GET. */
  healthcheckPath: string;
  /**
   * Test seam — replaces `globalThis.fetch` for BOTH the Railway
   * GraphQL call and the healthcheck call. Production callers omit
   * this and get the real `fetch`.
   */
  fetchImpl?: FetchLike;
  /**
   * Test seam — provides the Railway bearer used for the GraphQL
   * call. When omitted, the real resolver walks `RAILWAY_TOKEN` env
   * var → `~/.railway/config.json`. Returns `undefined` when no
   * usable credential is present; the driver fails loud at that
   * point rather than hitting Railway unauthenticated.
   */
  getRailwayToken?: () => string | undefined;
  /** Per-call timeout for each fetch (ms). Default 30s. */
  timeoutMs?: number;
  /**
   * Poll/wait config for the deployment-SUCCESS check. Forwarded to
   * `checkDeploymentSuccess` so an in-progress Railway rollout is waited
   * out rather than failed on the first read. Production callers omit it
   * (defaults: ~150s budget / 5s interval, real sleep). Tests inject a
   * `sleep`/`now` seam + a small budget for determinism.
   */
  deployPoll?: DeployPollOpts;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Railway deployment statuses that are NON-terminal — the rollout is
 * still in flight and the status WILL change to a terminal state on its
 * own. `checkDeploymentSuccess` polls (rather than failing fast) while
 * the latest deployment sits in any of these, because a verify-prod that
 * fires seconds after a promote pins a new digest legitimately observes
 * the new deployment mid-roll. (Empirically: promote run 26966193624's
 * predecessor pinned the docs digest, then verify-prod ran ~17s later and
 * saw status="DEPLOYING" — a transient, not a failure.)
 *
 * Matches Railway's `DeploymentStatus` enum non-terminal members.
 */
const IN_PROGRESS_DEPLOY_STATUSES: ReadonlySet<string> = new Set([
  "QUEUED",
  "BUILDING",
  "INITIALIZING",
  "DEPLOYING",
  "WAITING",
  "NEEDS_APPROVAL",
]);

/**
 * Poll budget for waiting out an in-progress deployment. ~150s total at
 * a 5s interval — long enough to outlast a normal Railway container
 * rollout, short enough that a genuinely stuck deploy still reds the gate
 * in bounded time. Terminal-failure statuses (FAILED/CRASHED/REMOVED/...)
 * NEVER consume this budget; only the in-progress set above triggers a
 * wait.
 */
const DEFAULT_DEPLOY_POLL_TIMEOUT_MS = 150_000;
const DEFAULT_DEPLOY_POLL_INTERVAL_MS = 5_000;

export interface DeployPollOpts {
  /** Total budget to wait out in-progress statuses (ms). */
  pollTimeoutMs?: number;
  /** Delay between polls while in-progress (ms). */
  pollIntervalMs?: number;
  /**
   * Test seam — replaces the real wall-clock sleep so the poll loop is
   * deterministic and instant under test. Production callers omit it and
   * get a real `setTimeout`-backed delay.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Test seam — monotonic clock source for the budget check. Defaults to
   * `Date.now`. Injected so tests can drive the timeout deterministically.
   */
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk `RAILWAY_TOKEN` env var → `~/.railway/config.json` and return the
 * Railway public-GraphQL bearer. Mirrors the resolution chain in
 * `redeploy-env.ts::getToken` but returns `undefined` on miss instead of
 * exiting the process — driver code surfaces the miss as a probe
 * failure so verify-deploy can keep iterating remaining targets.
 */
export function defaultGetRailwayToken(): string | undefined {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;
  const home = process.env.HOME;
  if (!home) return undefined;
  const configPath = path.join(home, ".railway", "config.json");
  if (!fs.existsSync(configPath)) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err: unknown) {
    // ENOENT is the legitimate "no config file" path (TOCTOU between
    // existsSync and readFileSync) — return undefined silently.
    // Any OTHER error (EACCES, EISDIR, EIO, ...) is a configuration
    // problem the operator needs to see; do NOT swallow it. Mirrors
    // the read-vs-parse split in lib/railway-token.ts::resolveRailwayToken
    // (NO_FILE vs MALFORMED) — here we keep returning undefined so the
    // caller's "no token" failure path still fires, but with a clear
    // stderr diagnostic identifying the offending config path.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return undefined;
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[verify-deploy] failed to read Railway config at ${configPath}: ${msg}\n`,
    );
    return undefined;
  }
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (err: unknown) {
    // Malformed JSON is distinct from a missing file — surface the
    // diagnostic, then return undefined so the caller's no-token path
    // produces a clean probe failure rather than crashing verify-deploy.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[verify-deploy] malformed JSON in Railway config at ${configPath}: ${msg}\n`,
    );
    return undefined;
  }
  return resolveRailwayTokenFromConfig(
    config as Parameters<typeof resolveRailwayTokenFromConfig>[0],
  );
}

/**
 * Resolve the target env (`prod` / `staging`) for a probe target by
 * matching its `host` against the SSOT's per-env domain literals.
 *
 * `ProbeTarget` intentionally does NOT carry the env (verify-deploy's
 * `resolveProbeTargets` collapses it into the host literal so drivers
 * cannot accidentally probe one env with the other env's token). We
 * recover the env here by reversing the lookup against `SERVICES`. A
 * service whose host matches neither env literal is a configuration
 * bug — surface it as a probe failure, do not guess.
 */
export function envForTarget(target: ProbeTarget): EnvName | undefined {
  const entry = SERVICES[target.name];
  if (!entry) return undefined;
  // Reverse-map: find the env whose declared domain matches the target
  // host. Iterates the service's `environments` (not a hardcoded
  // prod/staging pair) so it generalizes to any SSOT env. Domainless envs
  // (no `domain`) never match a real host, so they are naturally skipped.
  for (const [env, cfg] of Object.entries(entry.environments)) {
    if (cfg.domain !== undefined && target.host === cfg.domain) return env;
  }
  return undefined;
}

function envIdFor(env: EnvName): string {
  const envId = ENV_ID_BY_NAME[env];
  if (!envId) {
    throw new Error(
      `envIdFor: unknown env "${env}" — no Railway env-id registered in ENV_ID_BY_NAME.`,
    );
  }
  return envId;
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  timeoutMs: number,
): Promise<Awaited<ReturnType<FetchLike>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Outcome of a SINGLE Railway deployment-status query. Either an
 * infrastructure/contract error (terminal — surfaced immediately) or the
 * raw `status` string of the latest deployment for further classification
 * by the poll loop.
 */
type DeployQueryResult =
  | { kind: "error"; error: string }
  | { kind: "status"; status: string };

/**
 * Issue ONE `deployments(first:1)` query for the service's latest
 * deployment in the target env. Returns the raw status string on a clean
 * response, or a structured error for any network / GraphQL / shape
 * failure. Does NOT interpret the status — that classification (SUCCESS
 * vs in-progress vs terminal-fail) lives in `checkDeploymentSuccess` so
 * it can decide whether to wait or fail fast.
 */
async function queryDeploymentStatus(
  serviceId: string,
  environmentId: string,
  env: EnvName,
  token: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  driverLabel: string,
  tag: string,
): Promise<DeployQueryResult> {
  const query = `query latestDeployment($serviceId: String!, $environmentId: String!) {
  deployments(first: 1, input: { serviceId: $serviceId, environmentId: $environmentId }) {
    edges { node { id status } }
  }
}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      RAILWAY_GRAPHQL_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { serviceId, environmentId },
        }),
      },
      timeoutMs,
    );
  } catch (e: unknown) {
    const msg = isAbortError(e)
      ? `timed out after ${timeoutMs}ms`
      : e instanceof Error
        ? e.message
        : String(e);
    return {
      kind: "error",
      error: `${driverLabel}: Railway GraphQL fetch failed [${tag}]: ${msg}`,
    };
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    return {
      kind: "error",
      error: `${driverLabel}: Railway GraphQL HTTP ${res.status} [${tag}]: ${body}`,
    };
  }
  let json: RailwayDeploymentsResponse;
  try {
    json = (await res.json()) as RailwayDeploymentsResponse;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Release the body in the error path even if json() partially
    // consumed it — undici will leak the socket otherwise.
    await releaseBody(res);
    return {
      kind: "error",
      error: `${driverLabel}: Railway GraphQL JSON parse failed [${tag}]: ${msg}`,
    };
  }
  if (json.errors?.length) {
    return {
      kind: "error",
      error: `${driverLabel}: Railway GraphQL errors [${tag}]: ${json.errors
        .map((e) => e.message)
        .join("; ")}`,
    };
  }
  const node = json.data?.deployments?.edges?.[0]?.node;
  if (!node) {
    return {
      kind: "error",
      error: `${driverLabel}: Railway returned no deployments for ${env} [${tag}]`,
    };
  }
  return { kind: "status", status: node.status };
}

/**
 * Query Railway for the latest deployment of the given service in the
 * given env and assert it reaches `status === "SUCCESS"`. Returns a
 * string error message on any failure; returns `undefined` on success.
 *
 * In-progress handling: a deployment whose latest status is still in
 * flight (`DEPLOYING`/`BUILDING`/`INITIALIZING`/`QUEUED`/`WAITING`/
 * `NEEDS_APPROVAL` — see `IN_PROGRESS_DEPLOY_STATUSES`) is NOT a failure.
 * verify-prod commonly runs seconds after a promote pins a new digest,
 * while Railway is still rolling the container out. We POLL (every
 * `pollIntervalMs`, up to `pollTimeoutMs` total) until the deployment
 * reaches a terminal state, then assert SUCCESS. Terminal-failure
 * statuses (`FAILED`/`CRASHED`/`REMOVED`/anything not SUCCESS and not
 * in-progress) fail FAST with no waiting — preserving the prior
 * fail-on-non-SUCCESS behavior for those. Infrastructure/contract errors
 * (network, GraphQL `errors[]`, missing edge) also fail fast.
 *
 * Backward-compatible signature: `pollOpts` is optional and trailing.
 * Callers that omit it get the production poll budget; tests inject a
 * `sleep`/`now` seam (and a small budget) for deterministic, instant
 * runs.
 */
export async function checkDeploymentSuccess(
  serviceId: string,
  env: EnvName,
  token: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  driverLabel: string,
  serviceName?: string,
  pollOpts?: DeployPollOpts,
): Promise<string | undefined> {
  const environmentId = envIdFor(env);
  // Tag identifies the offending service in multi-service runs. When
  // the caller does not supply a name we fall back to the serviceId so
  // a Railway operator can still grep the diagnostic to a target.
  const tag = serviceName
    ? `service="${serviceName}" (serviceId=${serviceId})`
    : `serviceId=${serviceId}`;

  const pollTimeoutMs =
    pollOpts?.pollTimeoutMs ?? DEFAULT_DEPLOY_POLL_TIMEOUT_MS;
  const pollIntervalMs =
    pollOpts?.pollIntervalMs ?? DEFAULT_DEPLOY_POLL_INTERVAL_MS;
  const sleep = pollOpts?.sleep ?? defaultSleep;
  const now = pollOpts?.now ?? Date.now;

  const deadline = now() + pollTimeoutMs;
  let lastInProgressStatus = "";
  for (;;) {
    const result = await queryDeploymentStatus(
      serviceId,
      environmentId,
      env,
      token,
      fetchImpl,
      timeoutMs,
      driverLabel,
      tag,
    );
    // Infra/contract failures are terminal — surface immediately.
    if (result.kind === "error") return result.error;

    const status = result.status;
    if (status === "SUCCESS") return undefined;

    // In-progress: the rollout is still settling. Wait and re-query
    // until terminal or the poll budget is exhausted.
    if (IN_PROGRESS_DEPLOY_STATUSES.has(status)) {
      lastInProgressStatus = status;
      if (now() >= deadline) {
        return `${driverLabel}: latest ${env} deployment still in progress (status="${status}") after ${pollTimeoutMs}ms wait (expected SUCCESS) [${tag}]`;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    // Any other status (FAILED/CRASHED/REMOVED/unknown) is a terminal
    // non-SUCCESS — fail fast, no waiting. Preserves the original
    // error-string shape so existing assertions/greps keep matching.
    return `${driverLabel}: latest ${env} deployment status="${status}" (expected SUCCESS) [${tag}]${
      lastInProgressStatus
        ? ` [transitioned from in-progress "${lastInProgressStatus}"]`
        : ""
    }`;
  }
}

/**
 * GET `https://<host><healthcheckPath>` and assert HTTP 200. Returns an
 * error string on any non-200 / fetch failure; `undefined` on success.
 */
export async function checkHealthcheck200(
  host: string,
  healthcheckPath: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  driverLabel: string,
): Promise<string | undefined> {
  const url = `https://${host}${healthcheckPath}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: "GET", headers: { "User-Agent": "verify-deploy" } },
      timeoutMs,
    );
  } catch (e: unknown) {
    // The AbortController abort surfaces as a generic "The operation
    // was aborted" — substitute an actionable, timeout-aware message.
    const msg = isAbortError(e)
      ? `timed out after ${timeoutMs}ms`
      : e instanceof Error
        ? e.message
        : String(e);
    return `${driverLabel}: healthcheck GET ${url} failed: ${msg}`;
  }
  // We only need the status, not the body — drain/cancel it so undici
  // releases the socket. Applies on BOTH the 200 and non-200 branches.
  if (res.status !== 200) {
    await releaseBody(res);
    return `${driverLabel}: healthcheck GET ${url} returned HTTP ${res.status} (expected 200)`;
  }
  await releaseBody(res);
  return undefined;
}

/**
 * Baseline driver body. Runs deployment-SUCCESS check, then healthcheck
 * 200 check. Either failure yields a structured ProbeOutcome `{ok:false,
 * error}`; both passes yield `{ok:true}`. Driver-specific extensions
 * (DOM strings, fixture replay, admin login, etc.) can compose on top
 * by wrapping this and adding their own checks after a green baseline.
 */
export async function probeBaseline(
  target: ProbeTarget,
  opts: BaselineOpts,
): Promise<ProbeOutcome> {
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const getToken = opts.getRailwayToken ?? defaultGetRailwayToken;

  const env = envForTarget(target);
  if (!env) {
    return {
      ok: false,
      error: `${opts.driverLabel}: cannot resolve env for host "${target.host}" (service "${target.name}" not in SSOT or domain mismatch)`,
    };
  }
  const entry = SERVICES[target.name];
  // envForTarget already validated entry exists by returning a defined env.
  if (!entry) {
    return {
      ok: false,
      error: `${opts.driverLabel}: service "${target.name}" missing from SSOT`,
    };
  }

  const token = getToken();
  if (!token) {
    return {
      ok: false,
      error: `${opts.driverLabel}: no Railway token (set RAILWAY_TOKEN — Railway workspace token)`,
    };
  }

  const deployErr = await checkDeploymentSuccess(
    entry.serviceId,
    env,
    token,
    fetchImpl,
    timeoutMs,
    opts.driverLabel,
    target.name,
    opts.deployPoll,
  );
  if (deployErr) return { ok: false, error: deployErr };

  const healthErr = await checkHealthcheck200(
    target.host,
    opts.healthcheckPath,
    fetchImpl,
    timeoutMs,
    opts.driverLabel,
  );
  if (healthErr) return { ok: false, error: healthErr };

  return { ok: true };
}
