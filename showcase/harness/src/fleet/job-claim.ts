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
   * is not in a running state.
   */
  releaseJob(
    jobId: string,
    workerId: string,
    status: "done" | "failed" | "pending",
  ): Promise<ReleaseResult>;
}

interface ClaimEndpointBody {
  claimed?: boolean;
  renewed?: boolean;
  released?: boolean;
  job?: JobView;
  error?: string;
  /** Release refusal reason (released: false only) — see `ReleaseRefusalReason`. */
  reason?: string;
}

export function createJobClaimClient(config: JobClaimConfig): JobClaimClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const baseUrl = config.url.replace(/\/$/, "");
  const logger = config.logger;
  let authToken: string | null = null;

  async function ensureAuth(): Promise<void> {
    if (authToken) return;
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
    let res = await fetchImpl(
      `${baseUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: authBody,
      },
    );
    if (res.status === 404) {
      res = await fetchImpl(`${baseUrl}/api/admins/auth-with-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: authBody,
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`job-claim auth failed: ${res.status} ${text}`);
    }
    const text = await res.text();
    const body: { token?: unknown } = text
      ? (JSON.parse(text) as { token?: unknown })
      : {};
    if (typeof body.token !== "string" || body.token.length === 0) {
      throw new Error("job-claim auth returned empty or non-string token");
    }
    authToken = body.token;
  }

  async function postFleet(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<ClaimEndpointBody> {
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
    let res = await doPost();
    // Single re-auth on 401 — token may have expired between calls.
    if (res.status === 401) {
      authToken = null;
      await ensureAuth();
      res = await doPost();
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logger.warn("job-claim.endpoint-error", {
        path,
        status: res.status,
        body: text,
      });
      throw new Error(`job-claim ${path} failed: ${res.status} ${text}`);
    }
    return text ? (JSON.parse(text) as ClaimEndpointBody) : {};
  }

  return {
    async claimJob(jobId, workerId, leaseSeconds): Promise<ClaimResult> {
      const body = await postFleet("/api/fleet/claim", {
        jobId,
        workerId,
        leaseSeconds,
      });
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
