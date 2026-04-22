import { z } from "zod";
import type { ProbeDriver } from "../types.js";
import type { ProbeResult } from "../../types/index.js";

/**
 * Version-drift driver: compares the pinned version of a single package
 * against its upstream registry's `latest` tag (npm or pypi). Emits a
 * ProbeResult per discovery-enumerated package; the surrounding probe-invoker
 * handles fan-out + concurrency + timeouts.
 *
 * Design notes:
 *   - NO retry loop inside the driver. The probe-scheduler skips overlapping
 *     ticks anyway — a retry here would just delay the next real tick and
 *     mask transient registry flakiness that an operator WANTS to see in
 *     their red-count. If rate-limiting becomes chronic, add a caching
 *     layer in front, not a retry loop.
 *   - 404 / 429 / other error responses each collapse to state:"red" with
 *     a distinct `errorDesc`. Keeping them as "red" (not "error") means
 *     alert rules that match on `state=red` fire without special casing;
 *     operators who want to filter rate-limit vs genuine drift branch on
 *     signal.drift (false during all error paths).
 *   - The legacy `src/probes/version-drift.ts` carries a different contract
 *     (coarse npmDrift/pythonDrift aggregates). That probe is NOT deleted
 *     here — Phase 4.1 migrates the weekly alert rule onto this driver's
 *     per-package signal and retires the aggregate probe. See
 *     `config/probes/version-drift.yml` for the new path.
 *
 * Error shape: signal always carries `{ name, pinned, latest, drift, errorDesc? }`.
 * `latest` is `null` on any error path so templates can branch on
 * `signal.latest === null` when they want to render an error-specific message.
 */

const versionDriftInputSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    pinnedVersion: z.string().min(1),
    ecosystem: z.enum(["npm", "pypi"]),
  })
  .passthrough();

export type VersionDriftDriverInput = z.infer<typeof versionDriftInputSchema>;

export interface VersionDriftDriverSignal {
  name: string;
  pinned: string;
  latest: string | null;
  drift: boolean;
  errorDesc?: string;
}

export const versionDriftDriver: ProbeDriver<
  VersionDriftDriverInput,
  VersionDriftDriverSignal
> = {
  kind: "version_drift",
  inputSchema: versionDriftInputSchema,
  async run(ctx, input): Promise<ProbeResult<VersionDriftDriverSignal>> {
    const { name, pinnedVersion, ecosystem } = input;
    const observedAt = ctx.now().toISOString();
    const url =
      ecosystem === "npm"
        ? `https://registry.npmjs.org/${encodeURIComponent(name)}`
        : `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

    // Registry fetch. `ProbeContext.fetchImpl` is the canonical injection
    // point (passed through by the probe-invoker from orchestrator-level
    // deps). We also honor `input.fetchImpl` as a fallback so the driver
    // tests can stub without constructing a full context — matches the
    // pattern in `smoke.ts`. In production, neither ctx nor input carries
    // a fetch fn and we fall back to `globalThis.fetch`.
    const fetchImpl =
      ctx.fetchImpl ??
      (input as unknown as { fetchImpl?: typeof fetch }).fetchImpl ??
      globalThis.fetch.bind(globalThis);

    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return redResult(input.key, name, pinnedVersion, message, observedAt);
    }

    if (res.status === 404) {
      return redResult(
        input.key,
        name,
        pinnedVersion,
        "package not found",
        observedAt,
      );
    }
    if (res.status === 429) {
      return redResult(
        input.key,
        name,
        pinnedVersion,
        "rate-limited",
        observedAt,
      );
    }
    if (!res.ok) {
      return redResult(
        input.key,
        name,
        pinnedVersion,
        `registry returned ${res.status}`,
        observedAt,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return redResult(
        input.key,
        name,
        pinnedVersion,
        `response parse failed: ${message}`,
        observedAt,
      );
    }

    const latest = extractLatest(body, ecosystem);
    if (!latest) {
      return redResult(
        input.key,
        name,
        pinnedVersion,
        "registry response missing latest version",
        observedAt,
      );
    }

    const drift = latest !== pinnedVersion;
    ctx.logger.debug("probe.version-drift.checked", {
      name,
      ecosystem,
      pinned: pinnedVersion,
      latest,
      drift,
    });
    return {
      key: input.key,
      state: drift ? "red" : "green",
      signal: { name, pinned: pinnedVersion, latest, drift },
      observedAt,
    };
  },
};

/**
 * Pull `latest` from a registry response. npm uses `dist-tags.latest`;
 * pypi uses `info.version`. Kept narrow — if a registry returns extra
 * shape we don't care about it; if it omits this specific field we fall
 * through to the "missing latest" error path.
 */
function extractLatest(
  body: unknown,
  ecosystem: "npm" | "pypi",
): string | null {
  if (!body || typeof body !== "object") return null;
  if (ecosystem === "npm") {
    const distTags = (body as Record<string, unknown>)["dist-tags"];
    if (!distTags || typeof distTags !== "object") return null;
    const latest = (distTags as Record<string, unknown>).latest;
    return typeof latest === "string" && latest.length > 0 ? latest : null;
  }
  const info = (body as Record<string, unknown>).info;
  if (!info || typeof info !== "object") return null;
  const version = (info as Record<string, unknown>).version;
  return typeof version === "string" && version.length > 0 ? version : null;
}

function redResult(
  key: string,
  name: string,
  pinned: string,
  errorDesc: string,
  observedAt: string,
): ProbeResult<VersionDriftDriverSignal> {
  return {
    key,
    state: "red",
    signal: { name, pinned, latest: null, drift: false, errorDesc },
    observedAt,
  };
}
