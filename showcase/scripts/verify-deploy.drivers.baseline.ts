import fs from "fs";
import path from "path";
import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { PRODUCTION_ENV_ID, SERVICES, STAGING_ENV_ID } from "./railway-envs";
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
}

const DEFAULT_TIMEOUT_MS = 30_000;

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
  if (target.host === entry.domains.staging) return "staging";
  if (target.host === entry.domains.prod) return "prod";
  return undefined;
}

function envIdFor(env: EnvName): string {
  return env === "prod" ? PRODUCTION_ENV_ID : STAGING_ENV_ID;
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
 * Query Railway for the latest deployment of the given service in the
 * given env and assert `status === "SUCCESS"`. Returns a string error
 * message on any failure (network, GraphQL `errors[]`, missing edge,
 * non-SUCCESS status); returns `undefined` on success.
 */
export async function checkDeploymentSuccess(
  serviceId: string,
  env: EnvName,
  token: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  driverLabel: string,
  serviceName?: string,
): Promise<string | undefined> {
  const environmentId = envIdFor(env);
  // Tag identifies the offending service in multi-service runs. When
  // the caller does not supply a name we fall back to the serviceId so
  // a Railway operator can still grep the diagnostic to a target.
  const tag = serviceName
    ? `service="${serviceName}" (serviceId=${serviceId})`
    : `serviceId=${serviceId}`;
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
    return `${driverLabel}: Railway GraphQL fetch failed [${tag}]: ${msg}`;
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    return `${driverLabel}: Railway GraphQL HTTP ${res.status} [${tag}]: ${body}`;
  }
  let json: RailwayDeploymentsResponse;
  try {
    json = (await res.json()) as RailwayDeploymentsResponse;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Release the body in the error path even if json() partially
    // consumed it — undici will leak the socket otherwise.
    await releaseBody(res);
    return `${driverLabel}: Railway GraphQL JSON parse failed [${tag}]: ${msg}`;
  }
  if (json.errors?.length) {
    return `${driverLabel}: Railway GraphQL errors [${tag}]: ${json.errors
      .map((e) => e.message)
      .join("; ")}`;
  }
  const node = json.data?.deployments?.edges?.[0]?.node;
  if (!node) {
    return `${driverLabel}: Railway returned no deployments for ${env} [${tag}]`;
  }
  if (node.status !== "SUCCESS") {
    return `${driverLabel}: latest ${env} deployment status="${node.status}" (expected SUCCESS) [${tag}]`;
  }
  return undefined;
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
