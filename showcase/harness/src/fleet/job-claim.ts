import type { Logger } from "../types/index.js";

/**
 * Fleet job-claim primitive.
 *
 * ── WHY THIS IS NOT A PLAIN PATCH ──────────────────────────────────────
 * The harness authenticates to PocketBase as a SUPERUSER, and superuser
 * writes BYPASS collection `updateRule`s. So the obvious design — guard
 * `probe_jobs.updateRule` with `status = "pending"` and let workers PATCH
 * the row — does NOT yield an atomic claim. An empirical spike against PB
 * 0.22.21 with 20 concurrent claimers proved it:
 *
 *   - superuser naive PATCH .................. 20/20 "win" (rules bypassed)
 *   - worker-auth rule-guarded PATCH ......... 4–10 winners (rule admission
 *                                              is not transactional with the
 *                                              write; all claimers pass the
 *                                              `pending` check, then all write)
 *   - JSVM routerAdd + runInTransaction CAS .. EXACTLY 1 winner, every run
 *
 * Therefore the claim/renew/release operations are implemented as
 * server-side transactional compare-and-set endpoints in PocketBase
 * (`showcase/pocketbase/pb_hooks/fleet-claim.pb.js`, backed by the
 * `probe_jobs` collection from `1779989400_create_probe_jobs.js`). SQLite
 * serializes the write transaction, making the read-compare-write atomic
 * across all callers regardless of auth subject.
 *
 * This module is a thin, typed client over those endpoints that reuses the
 * harness's existing superuser auth + a minimal retry-free request (the
 * endpoints are fast, idempotent-on-failure CAS calls — a caller that gets
 * a transport error simply re-claims).
 */

export type JobStatus = "pending" | "claimed" | "running" | "done" | "failed";

/** A snapshot of a `probe_jobs` row as returned by the claim endpoints. */
export interface JobView {
  id: string;
  probe_key: string;
  status: JobStatus;
  claimed_by: string;
  lease_expires_at: string | null;
  version: number;
}

export interface JobClaimConfig {
  /** PocketBase base URL, e.g. http://127.0.0.1:8090 */
  url: string;
  /** Superuser email (PB ≤0.22 admin). */
  email?: string;
  /** Superuser password. */
  password?: string;
  logger: Logger;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Result of a claim attempt. `won` is the exactly-one-winner signal. */
export interface ClaimResult {
  won: boolean;
  job?: JobView;
}

export interface RenewResult {
  renewed: boolean;
  job?: JobView;
}

/**
 * The release endpoint's refusal reason for `released: false` (threaded from
 * the hook so callers can be truthful about WHY). The load-bearing value is
 * `refused_terminal_same_holder`: the row is already terminal UNDER THE
 * CALLER'S OWN workerId, which can only mean the caller's earlier release
 * COMMITTED and its response was lost (timeout-after-commit) — the caller's
 * result write is still authorized, so a report() retry must proceed to it
 * rather than declare the result discarded. `refused_lease_live` is the
 * TOCTOU-close refusal of a sweeper re-queue on a still-live lease;
 * `refused_not_holder` covers everything else (unknown row, another holder,
 * or a terminal-target release on an already-expired lease).
 */
export type ReleaseRefusalReason =
  | "refused_terminal_same_holder"
  | "refused_lease_live"
  | "refused_not_holder";

/** The committed-terminal-under-my-id refusal — see `ReleaseRefusalReason`. */
export const RELEASE_REFUSED_TERMINAL_SAME_HOLDER =
  "refused_terminal_same_holder" satisfies ReleaseRefusalReason;

export interface ReleaseResult {
  released: boolean;
  job?: JobView;
  /** Present (string) only when `released` is false AND the hook supplied a
   * reason. Typed loose (`string`) because the wire value is untrusted —
   * callers compare against the known `ReleaseRefusalReason` values and
   * treat anything else as a generic refusal. */
  reason?: string;
}

export interface JobClaimClient {
  /**
   * Attempt to claim `jobId` for `workerId` with a lease of `leaseSeconds`.
   * Exactly one of N concurrent claimers will get `won: true`; the rest get
   * `won: false`. The CAS itself ALSO admits a row whose lease has already
   * expired even if it is in a claimed/running state, so it CAN reclaim a dead
   * worker's row. Note the worker claim loop does not drive that path: the
   * queue-client's `claimNext` only lists `status = "pending"` candidates, so it
   * never hands a claimed/running id here. Expired-row reclamation is instead
   * producer-sweep / fleet-health driven (they re-queue to `pending` first); the
   * expired-claim admission is the CAS's safety net, not the normal hot path.
   */
  claimJob(
    jobId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<ClaimResult>;
  /**
   * Extend the lease on a job the caller currently holds. Fails (`renewed:
   * false`) if the caller is not the lease holder, the lease already
   * expired (it was stolen), or the job is no longer in a claimed/running
   * state. Promotes a `claimed` row to `running` on first renew.
   */
  renewLease(
    jobId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<RenewResult>;
  /**
   * Record a terminal result for a job the caller holds. `status` is
   * `done` | `failed` to finish, or `pending` to re-queue. Fails
   * (`released: false`) if the caller is not the lease holder or the job
   * is no longer in a claimed/running state. NOTE the hook admits BOTH
   * `claimed` and `running` rows (its RUNNING_STATES) — a row can be
   * released terminal straight from `claimed`, which the queue-client's
   * decode-failure cleanup depends on (it releases a just-won, never-renewed
   * row as `failed`). This doc previously said "running state" only; the
   * hook was always the broader (correct) side.
   */
  releaseJob(
    jobId: string,
    workerId: string,
    status: "done" | "failed" | "pending",
  ): Promise<ReleaseResult>;
}

/**
 * A non-2xx response from a fleet claim endpoint, with the HTTP status
 * threaded as a FIELD (not just message text) so callers can discriminate
 * DETERMINISTIC refusals from indeterminate failures:
 *
 *   - 4xx → the hook REJECTED the request before its transaction ran;
 *     definitively NOTHING committed (the sweep uses this to avoid
 *     synthesizing a false worker-reclaimed-pending for a wedge row it
 *     can never actually release).
 *   - 5xx → indeterminate; the transition may have committed before the
 *     error surfaced — callers must stay conservative.
 *
 * The 2xx-unreadable indeterminate throw is deliberately NOT this class:
 * it has no refusal semantics (the CAS committed; only the outcome is
 * unknown), so it must take callers' conservative paths.
 *
 * ALSO thrown by the superuser auth round-trip for 4xx auth responses
 * (rotated/invalid creds — `path` is the auth-with-password route): an auth
 * rejection fails identically on every retry, so it belongs to the same
 * deterministic class the carve-outs key on. Auth 5xx / network failures
 * stay plain Errors (indeterminate).
 */
export class JobClaimEndpointError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number, body: string) {
    super(`job-claim ${path} failed: ${status} ${body}`);
    this.name = "JobClaimEndpointError";
    this.path = path;
    this.status = status;
  }
}

interface ClaimEndpointBody {
  claimed?: boolean;
  renewed?: boolean;
  released?: boolean;
  job?: JobView;
  error?: string;
  /** Release refusal reason (released: false only) — see `ReleaseRefusalReason`. */
  reason?: string;
  /**
   * Claim idempotency marker (claimed: true only): the row was ALREADY held
   * by this workerId with a live lease — a timeout-after-commit retry of the
   * caller's own committed claim. Deliberately NOT threaded onto
   * `ClaimResult`: the caller treats it as a plain win (the existing lease
   * is retained, and the heartbeat renews on its normal cadence), so the
   * marker is informational wire detail only.
   */
  alreadyHeld?: boolean;
}

export function createJobClaimClient(config: JobClaimConfig): JobClaimClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const baseUrl = config.url.replace(/\/$/, "");
  const logger = config.logger;
  let authToken: string | null = null;
  let authInFlight: Promise<void> | null = null;
  /**
   * The auth route that WORKED last time (v0.23+ `/_superusers` vs the
   * v0.22 `/api/admins` fallback), memoized across re-auths: route
   * discovery used to be a local inside authenticate(), so EVERY token
   * expiry re-paid a wasted 404 probe against a backend whose route cannot
   * have changed mid-process. Only a SUCCESSFUL auth memoizes (a failed one
   * proves nothing about the route); null until the first success.
   */
  let knownAuthPath: string | null = null;

  async function authenticate(): Promise<void> {
    if (!config.email || !config.password) {
      // No creds → the endpoints require auth; surface the gap loudly
      // rather than silently producing 401s the caller can't diagnose.
      throw new Error(
        "job-claim: POCKETBASE_SUPERUSER_EMAIL/PASSWORD not set — claim endpoints require auth",
      );
    }
    const authBody = JSON.stringify({
      identity: config.email,
      password: config.password,
    });
    // PB v0.23+ → /_superusers; v0.22 → /api/admins. Match pb-client.ts.
    // A memoized route from a prior successful auth skips the 404 probe.
    let authPath =
      knownAuthPath ?? "/api/collections/_superusers/auth-with-password";
    let res = await fetchImpl(`${baseUrl}${authPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: authBody,
    });
    if (res.status === 404 && knownAuthPath === null) {
      authPath = "/api/admins/auth-with-password";
      res = await fetchImpl(`${baseUrl}${authPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: authBody,
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // DETERMINISTIC 4xx (rotated/invalid creds → PB 400s; route drift):
      // the callers' deterministic-rejection carve-outs (queue-client's
      // renewLease and sweepExpired) discriminate on
      // `JobClaimEndpointError` + 4xx. A plain Error here routed every
      // rotated-credential failure down the INDETERMINATE path forever — a
      // phantom assumed-live lease on every renew beat and a false
      // worker-reclaimed-pending comm error per sweep. The same creds fail
      // identically on every retry, so thread the discriminable class with
      // the auth path + HTTP status. 5xx (and thrown network errors) stay
      // plain: a momentarily-sick PB is genuinely indeterminate and must
      // keep the callers' conservative handling.
      if (res.status >= 400 && res.status < 500) {
        throw new JobClaimEndpointError(authPath, res.status, text);
      }
      throw new Error(`job-claim auth failed: ${res.status} ${text}`);
    }
    const text = await res.text();
    let body: { token?: unknown };
    try {
      body = text ? (JSON.parse(text) as { token?: unknown }) : {};
    } catch (err) {
      // A bare SyntaxError ("Unexpected token <...") gives the operator no
      // idea WHICH request choked — wrap with the boundary + status.
      throw new Error(
        `job-claim auth: unparseable response body (status ${res.status}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (typeof body.token !== "string" || body.token.length === 0) {
      throw new Error("job-claim auth returned empty or non-string token");
    }
    authToken = body.token;
    // Memoize only on SUCCESS: the route is proven good for this backend.
    knownAuthPath = authPath;
  }

  function ensureAuth(): Promise<void> {
    if (authToken) return Promise.resolve();
    // MEMOIZE the in-flight auth: concurrent callers (claimNext racing a
    // heartbeat racing a report) used to each fire their own
    // auth-with-password — a needless stampede on PB, and N redundant
    // credential round-trips per token expiry. Share one promise; clear it
    // in finally so a FAILED auth is retried by the next caller instead of
    // caching the rejection forever.
    if (!authInFlight) {
      authInFlight = authenticate().finally(() => {
        authInFlight = null;
      });
    }
    return authInFlight;
  }

  function postFleet(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<ClaimEndpointBody>;
  function postFleet(
    path: string,
    payload: Record<string, unknown>,
    opts: { nullOn5xx: boolean },
  ): Promise<ClaimEndpointBody | null>;
  async function postFleet(
    path: string,
    payload: Record<string, unknown>,
    opts?: { nullOn5xx: boolean },
  ): Promise<ClaimEndpointBody | null> {
    await ensureAuth();
    const doPost = async (): Promise<Response> =>
      fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: authToken ?? "",
        },
        body: JSON.stringify(payload),
      });
    // Snapshot the token THIS request goes out under: a concurrent caller
    // can refresh `authToken` while our 401 response is in flight, and
    // blindly nulling it here would discard the FRESH token — forcing a
    // redundant re-auth round-trip per racing caller (an auth stampede
    // under sustained concurrency). Only invalidate if it is unchanged.
    const tokenUsed = authToken;
    let res = await doPost();
    // Single re-auth on 401 — token may have expired between calls.
    if (res.status === 401) {
      if (authToken === tokenUsed) authToken = null;
      await ensureAuth();
      res = await doPost();
    }
    if (!res.ok) {
      // Failure path: the body is diagnostics only — a failed read is fine.
      const text = await res.text().catch(() => "");
      logger.warn("job-claim.endpoint-error", {
        path,
        status: res.status,
        body: text,
      });
      // Opt-in 5xx containment (the claim CAS): a server error is returned
      // as null for the caller to map; 4xx (caller bugs) ALWAYS throw loud.
      if (opts?.nullOn5xx && res.status >= 500) return null;
      throw new JobClaimEndpointError(path, res.status, text);
    }
    // 2xx: the endpoint COMMITTED the transition server-side. A body we
    // cannot read/parse — or an empty one — means the OUTCOME of a committed
    // CAS is UNKNOWN. The old empty→`{}` mapping FABRICATED a CAS loss for
    // an operation that may have WON: a won claim was abandoned (stranded
    // claimed row), a successful renew read back as `renewed: false` killed
    // the worker's heartbeat (recreating the false worker-crashed-mid-job
    // class), and a committed release read back as `released: false` made
    // report() falsely declare the result discarded. Indeterminate must
    // THROW with context; every caller contains the throw (claimNext
    // per-candidate, queue-client renewLease assumed-live, the sweep's
    // conservative path, report()'s retry).
    const indeterminate = (detail: string): Error =>
      new Error(
        `job-claim ${path}: 2xx body unreadable — outcome indeterminate (${detail})`,
      );
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw indeterminate(
        `read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!text) throw indeterminate("empty body");
    try {
      return JSON.parse(text) as ClaimEndpointBody;
    } catch (err) {
      throw indeterminate(
        `unparseable JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    async claimJob(jobId, workerId, leaseSeconds): Promise<ClaimResult> {
      const body = await postFleet(
        "/api/fleet/claim",
        {
          jobId,
          workerId,
          leaseSeconds,
        },
        { nullOn5xx: true },
      );
      if (body === null) {
        // A 5xx from the claim CAS is treated as a LOST CAS, not an error: a
        // WAL serialization/busy error escaping runInTransaction surfaces as
        // a 500, and the contested row either was or will be won by a peer —
        // exactly the lost-race shape. Throwing here aborted the caller's
        // whole candidate rotation for one contested row; won:false lets
        // claimNext fall through to the next candidate. (Already warned by
        // postFleet's endpoint-error log.)
        //
        // BOUNDED FALSE-OVERLAY SOURCE (documented, accepted): the 5xx can
        // ALSO mask a claim that COMMITTED under THIS workerId before the
        // error surfaced. The caller then treats it as lost and never
        // renews/reports, so the row sits claimed until its lease expires
        // and the sweeper re-queues it — synthesizing a neutral (gray)
        // worker-reclaimed-pending overlay for a worker that never knew it
        // held the job. Bounded by one lease duration, self-healing (the
        // re-queued job re-runs), and never a red crash overlay.
        return { won: false };
      }
      return { won: body.claimed === true, job: body.job };
    },

    async renewLease(jobId, workerId, leaseSeconds): Promise<RenewResult> {
      const body = await postFleet("/api/fleet/renew", {
        jobId,
        workerId,
        leaseSeconds,
      });
      return { renewed: body.renewed === true, job: body.job };
    },

    async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
      const body = await postFleet("/api/fleet/release", {
        jobId,
        workerId,
        status,
      });
      return {
        released: body.released === true,
        job: body.job,
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      };
    },
  };
}
