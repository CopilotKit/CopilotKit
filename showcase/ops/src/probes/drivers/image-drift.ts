import { z } from "zod";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Driver wrapper that performs per-service image-drift detection. The
 * legacy `imageDriftProbe` in `../image-drift.ts` compares N `(service,
 * digest)` pairs in a single global probe. The driver path flips that
 * model: discovery (railway-services) produces one input per service,
 * the invoker fans out N independent driver.run() calls, and each call
 * emits one ProbeResult keyed by service. Rule templates aggregate
 * across keys at the alert-engine layer.
 *
 * Why one-call-per-service instead of a single global probe? Two reasons:
 *   1. Key uniqueness — `image_drift:showcase-a` / `image_drift:showcase-b`
 *      flow through the writer independently, so a single flaky GHCR
 *      lookup only flips ONE row red rather than flipping the whole
 *      global `image_drift:global` row red and blinding operators to
 *      per-service drift.
 *   2. Discovery composition — railway-services returns `{name, imageRef,
 *      publicUrl, env}` once, and both image-drift and redirect-decom
 *      can consume the same records via their own drivers without a
 *      second Railway round-trip.
 *
 * Phase 4.1 retires the legacy `imageDriftProbe` once the rule template
 * aggregator lands; until then both paths coexist (additive) behind
 * different probe configs.
 */

const imageDriftInputSchema = z.object({
  key: z.string().min(1),
  // Matches the `name` field emitted by railway-services discovery
  // (RailwayServiceInfo.name). Renaming this to match the discovery
  // record shape is what lets the invoker pass discovery records
  // straight through inputSchema without a translation hop.
  name: z.string().min(1),
  imageRef: z.string().min(1),
  /**
   * Override for the expected GHCR tag. Defaults to the tag embedded in
   * `imageRef` (everything after the last `:`). Useful when the deployed
   * imageRef pins by digest (`@sha256:…`) but we want to compare against
   * a channel tag like `stable` or `v1.2.3`.
   */
  expectedTag: z.string().optional(),
});

type ImageDriftDriverInput = z.infer<typeof imageDriftInputSchema>;

/**
 * Signal is a discriminated union so TS narrows success vs. error paths
 * without casts. Success carries the full comparison tuple; error carries
 * only the human-readable description. Callers (rule templates, writer
 * aggregators) discriminate on the presence of `errorDesc`.
 */
export type ImageDriftDriverSignal =
  | {
      service: string;
      /** Digest currently deployed (parsed from `imageRef`). */
      currentImage: string;
      /** Digest GHCR reports for `expectedTag`. */
      expectedImage: string;
      /**
       * True when `currentImage !== expectedImage` AND both were resolved
       * successfully.
       */
      isStale: boolean;
      /**
       * Populated only when the GHCR lookup succeeded but the deploy's
       * own `imageRef` lacked a digest — surfaces "no digest pinned on
       * the deploy" without collapsing into the error variant (the
       * upstream lookup still worked).
       */
      rebuildError?: string;
    }
  | {
      /**
       * Human-readable error description when the GHCR lookup failed
       * (404, auth fail, manifest schema mismatch, transport error, etc.).
       * Sole field on the error variant — no partial success fields.
       */
      errorDesc: string;
    };

export const imageDriftDriver: ProbeDriver<
  ImageDriftDriverInput,
  ImageDriftDriverSignal
> = {
  kind: "image_drift",
  inputSchema: imageDriftInputSchema,
  async run(ctx, input): Promise<ProbeResult<ImageDriftDriverSignal>> {
    const observedAt = ctx.now().toISOString();
    const parsed = parseImageRef(input.imageRef);
    const currentImage = parsed.digest ?? "";
    const expectedTag = input.expectedTag ?? parsed.tag ?? "latest";

    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    let expectedImage: string;
    try {
      expectedImage = await fetchGhcrDigest(fetchImpl, {
        repository: parsed.repository,
        reference: expectedTag,
        token: ctx.env.GHCR_TOKEN,
        // Forward the invoker's AbortController signal so a stalled GHCR
        // response aborts its socket when `timeout_ms` fires, rather than
        // leaking the descriptor past the synthetic-timeout ProbeResult.
        signal: ctx.abortSignal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Distinguish transport failure (can't reach GHCR) from upstream
      // failure (401/404/5xx). Transport class goes to "error" state so
      // the alert engine can collapse DNS blips separately; upstream
      // failures flip the service red with errorDesc populated so
      // operators see the fault class in the Slack payload.
      if (err instanceof GhcrTransportError) {
        ctx.logger.error("driver.image-drift.ghcr-transport", {
          service: input.name,
          err: message,
        });
        return {
          key: input.key,
          state: "error",
          signal: { errorDesc: message },
          observedAt,
        };
      }
      ctx.logger.warn("driver.image-drift.ghcr-lookup-failed", {
        service: input.name,
        err: message,
      });
      return {
        key: input.key,
        state: "red",
        signal: { errorDesc: message },
        observedAt,
      };
    }

    const isStale = currentImage !== "" && currentImage !== expectedImage;
    return {
      key: input.key,
      state: isStale || currentImage === "" ? "red" : "green",
      signal: {
        service: input.name,
        currentImage,
        expectedImage,
        isStale,
      },
      observedAt,
    };
  },
};

// Helpers -------------------------------------------------------------------

interface ParsedImageRef {
  /** `ghcr.io/copilotkit/showcase-a` without tag or digest. */
  repository: string;
  tag: string | null;
  digest: string | null;
}

/**
 * Parse `ghcr.io/<org>/<name>[:<tag>][@<digest>]` into its parts. Handles:
 *   - `ghcr.io/org/name:tag`                → { repo, tag, digest:null }
 *   - `ghcr.io/org/name@sha256:abc`         → { repo, tag:null, digest }
 *   - `ghcr.io/org/name:tag@sha256:abc`     → { repo, tag, digest }
 *   - `ghcr.io/org/name`                    → { repo, tag:null, digest:null }
 * The digest-after-colon form (seen in Docker CLI) is tolerated by
 * parsing from the right so a trailing `@sha256:...` always wins.
 */
function parseImageRef(ref: string): ParsedImageRef {
  const atIdx = ref.lastIndexOf("@");
  let withoutDigest = ref;
  let digest: string | null = null;
  if (atIdx !== -1) {
    digest = ref.slice(atIdx + 1);
    withoutDigest = ref.slice(0, atIdx);
  }
  // Tag separator is the LAST `:` in the remaining string, but only
  // when the segment after the last `/` contains a colon — otherwise
  // a port in a registry hostname (`registry:5000/org/name`) would be
  // mis-parsed as a tag.
  const slashIdx = withoutDigest.lastIndexOf("/");
  const lastSegment =
    slashIdx === -1 ? withoutDigest : withoutDigest.slice(slashIdx + 1);
  const colonIdx = lastSegment.indexOf(":");
  let tag: string | null = null;
  let repository = withoutDigest;
  if (colonIdx !== -1) {
    tag = lastSegment.slice(colonIdx + 1);
    repository =
      (slashIdx === -1 ? "" : withoutDigest.slice(0, slashIdx + 1)) +
      lastSegment.slice(0, colonIdx);
  }
  return { repository, tag, digest };
}

class GhcrTransportError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GhcrTransportError";
  }
}

/**
 * HEAD (falls back to GET) the GHCR manifest endpoint for
 * `<repository>:<reference>` and return the `docker-content-digest`
 * header value. GHCR requires an Accept header advertising the OCI
 * + Docker v2 manifest media types or the server returns
 * 406 Not Acceptable on newer images.
 *
 * Repository format: `ghcr.io/<org>/<name>`. Only the path portion
 * after `ghcr.io/` is used in the URL — the registry host is fixed.
 */
async function fetchGhcrDigest(
  fetchImpl: typeof fetch,
  opts: {
    repository: string;
    reference: string;
    token?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  const path = opts.repository.replace(/^ghcr\.io\//, "");
  const url = `https://ghcr.io/v2/${path}/manifests/${encodeURIComponent(opts.reference)}`;
  const headers: Record<string, string> = {
    Accept: [
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
    ].join(", "),
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: opts.signal,
    });
  } catch (err) {
    throw new GhcrTransportError(
      `ghcr fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `ghcr auth failed: ${res.status} ${res.statusText || ""}`.trim(),
    );
  }
  if (res.status === 404) {
    throw new Error(
      `ghcr tag not found: ${opts.reference} in ${opts.repository}`,
    );
  }
  if (!res.ok) {
    throw new Error(`ghcr manifest lookup ${res.status}`);
  }
  const digest = res.headers.get("docker-content-digest");
  if (!digest) {
    throw new Error(
      `ghcr response missing docker-content-digest header for ${opts.reference}`,
    );
  }
  return digest;
}
