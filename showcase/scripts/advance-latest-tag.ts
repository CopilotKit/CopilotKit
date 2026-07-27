#!/usr/bin/env npx tsx
/**
 * advance-latest-tag.ts — Monotonic `:latest` pointer for showcase GHCR images.
 *
 * ## The hole this closes
 *
 * `Showcase: Build & Push` deliberately has NO concurrency group: every push
 * to main runs to completion so rapid-fire merges never cancel in-flight
 * builds (see the rationale block at the top of showcase_build.yml). That is
 * the right call — but it means N builds for N different commits can be
 * pushing the SAME `:latest` tag at the same time, and the registry has no
 * ordering guarantee. Last writer wins, and the last writer is whichever
 * Docker build happened to finish last — NOT the newest commit.
 *
 * Observed 2026-07-26. Three merges landed within 34 seconds:
 *
 *   run 30190815370  7b28934387  (#6162)  06:18:05 → 06:29:44
 *   run 30190823203  59f275eedc  (#6161)  06:18:21 → 06:29:44
 *   run 30190831480  db75a04837  (#6158)  06:18:39 → 06:29:13   ← NEWEST
 *
 * The newest commit finished FIRST, so the two older runs overwrote its
 * `:latest`. Per-service, the older commit (59f275eedc) beat the newer
 * (db75a04837) on every shared slot:
 *
 *   shell-dashboard   newer 06:25:33  →  older 06:25:34   (+1s)
 *   shell-dojo        newer 06:25:10  →  older 06:25:26  (+16s)
 *   shell             newer 06:27:17  →  older 06:27:28  (+11s)
 *   showcase-harness  newer 06:27:51  →  older 06:27:55   (+4s)
 *
 * All three runs reported `success`. Staging served images built from a
 * commit that predates #6158 while CI, the redeploy gate, and the deploy
 * verification all looked clean — a success that does not mean what it says.
 *
 * ## Why not just add a concurrency group
 *
 * Because `detect-changes` builds a PER-PUSH, path-filtered matrix — each run
 * builds only the services its own commits touched, so concurrent runs build
 * OVERLAPPING BUT NON-IDENTICAL service sets. In the incident above:
 *
 *   7b28934387 → ag2, agno, built-in-agent, claude-sdk-python,
 *                claude-sdk-typescript, crewai-crews, langgraph-fastapi,
 *                langgraph-python, langroid, llamaindex, mastra, pydantic-ai,
 *                shell-docs, spring-ai, strands            (15 services)
 *   db75a04837 → crewai-crews, llamaindex, shell, shell-dashboard,
 *                shell-docs, shell-dojo, showcase-harness   (7 services)
 *
 * `cancel-in-progress: true` would have cancelled the 7b28934387 run, and the
 * ~10 services only IT builds would never have shipped at all. That trades a
 * stale-image bug for a never-shipped bug. `cancel-in-progress: false` is no
 * better: GitHub keeps at most ONE pending run per group and cancels any
 * previously-pending one, so the middle commit's build is dropped outright.
 *
 * The runs are not redundant, so they must not be cancelled. Instead we make
 * the one shared, mutable resource — the `:latest` pointer — monotonic.
 *
 * ## What this does
 *
 * The build step now pushes ONLY the immutable `:<sha>` tag. This script then
 * decides whether `:latest` may advance to that image:
 *
 *   1. Read `org.opencontainers.image.revision` off the image currently
 *      tagged `:latest` — the commit it was built from.
 *   2. Ask GitHub how that commit relates to ours (`compare/<theirs>...<ours>`).
 *   3. Advance `:latest` (a registry-side retag, no pull) UNLESS ours is
 *      strictly BEHIND — i.e. `:latest` already holds a descendant of us and
 *      moving it would regress staging to older code.
 *
 * Every ambiguous case advances. A first-ever build (no `:latest`), an
 * unlabelled legacy image, a diverged history, an unreachable API — all
 * advance, because failing to advance strands staging on an old image, which
 * is the very failure we are fixing. We decline ONLY on positive proof of
 * regression.
 *
 * Ambiguity advances, but it is never SILENT: every degraded read emits a
 * `::warning` naming which failure mode it hit (absent tag, auth, throttling,
 * timeout, outage). A guard that cannot tell you it has stopped guarding is
 * worse than no guard, and throttling — the likeliest failure under exactly
 * the concurrency this exists to handle — is otherwise indistinguishable
 * from a clean first build.
 *
 * ## Digest identity (why the retag must be a carbon copy)
 *
 * Prod is digest-pinned (`ghcr.io/copilotkit/<repo>@sha256:…`, enforced by
 * verify-railway-image-refs.ts), and provenance — "which commit is actually
 * live" — is established by matching a service's running digest against
 * GHCR's per-commit tags. That only works if `:latest` and `:<sha>` name the
 * SAME manifest digest.
 *
 * `docker buildx imagetools create` does NOT unconditionally preserve the
 * digest; it can re-serialise the manifest. Measured against buildx v0.35.0
 * (`util/imagetools/create.go`, the "on single source, return original bytes"
 * branch), for a single source with no added annotations:
 *
 *   - source is an image index / manifest list → the original bytes are
 *     copied verbatim; digest PRESERVED and `--prefer-index` is ignored.
 *   - source is a bare single manifest → with `--prefer-index` (which
 *     defaults to TRUE) the manifest is WRAPPED in a newly built index and
 *     the digest CHANGES.
 *
 * Our images take the first path today: Depot attaches a provenance
 * attestation, so `:<sha>` is an OCI index even though we build the single
 * `linux/amd64` platform. But that is an accident of provenance being
 * enabled in another file — setting `provenance: false` on the build step
 * would silently move us onto the digest-changing path and break
 * provenance-by-digest for prod. Passing `--prefer-index=false` pins the
 * carbon-copy behaviour for BOTH manifest shapes, so the property stops
 * depending on a setting this script does not control.
 *
 * ## Residual race, stated plainly
 *
 * This narrows the window from the whole build (~10 min) to the gap between
 * the inspect and the retag (sub-second), but does NOT eliminate it: GHCR
 * offers no compare-and-swap on tags, so two runs that read `:latest`
 * simultaneously can still both decide to advance. Fully closing it means
 * retiring the mutable staging tag and pinning staging to digests the way
 * prod already is (verify-railway-image-refs.ts enforces
 * `ghcr.io/copilotkit/<repo>@sha256:<digest>` for prod today). That is a
 * change to the Railway image-ref SSOT contract, not a workflow change, and
 * is the recommended follow-up.
 *
 * ## Where this runs
 *
 * In the `redeploy-staging` / `redeploy-staging-starters` jobs, immediately
 * before the Railway redeploy that pulls `:latest` — NOT in the build matrix.
 *
 * The reason is proximity: deciding right before the pull keeps the
 * read→retag→pull window as narrow as it can be made without a
 * compare-and-swap primitive.
 *
 * Placement here also keeps the `npx tsx` blast radius small — but note this
 * is a matter of degree, not capability. These jobs run `setup-node` and
 * then invoke the script through an unpinned `npx tsx` with no prior
 * install, exactly as the sibling `redeploy-env.ts` step does. So the
 * unpinned fetch is not avoided by living here; it is paid twice (once per
 * redeploy job) instead of once per build slot across ~50 parallel runners.
 * Pinning tsx is a repo-wide change to how these scripts are invoked and is
 * tracked separately.
 *
 * The image list is the SAME matrix ∩ build-success intersection that decides
 * what gets redeployed, so a failed build can never move a tag.
 *
 * ## Usage
 *
 *   npx tsx showcase/scripts/advance-latest-tag.ts \
 *     --images ghcr.io/copilotkit/showcase-shell,ghcr.io/copilotkit/showcase-harness \
 *     --sha "$GITHUB_SHA" --repo copilotkit/copilotkit
 *
 * Flags (each also accepts `--flag=value`):
 *
 *   --images <ref[,ref...]>  Comma- and/or newline-separated image refs, with
 *                            no tag. An EMPTY value is a deliberate no-op.
 *   --image  <ref>           Alias for `--images`, for a single image.
 *   --sha    <commit>        The commit this run built.
 *   --repo   <owner/name>    Repo to resolve commit ancestry against.
 *
 * Env fallbacks, used only when the corresponding flag is absent:
 * `IMAGES`, `GITHUB_SHA`, `GITHUB_REPOSITORY`. `ADVANCE_LATEST_TAG_TIMEOUT_MS`
 * overrides the per-subprocess timeout (default 60000).
 *
 * ## Preconditions the CALLER must satisfy
 *
 *   - `docker buildx` (v0.16+, for `--prefer-index`) on PATH and logged in to
 *     the registry WITH WRITE ACCESS. `imagetools create` is a registry-side
 *     manifest PUT, so an anonymous session is not enough even for a public
 *     package: the job needs `permissions: packages: write` AND a
 *     `docker/login-action` step. Anonymous reads of a public package let the
 *     INSPECT succeed and then fail every retag, so a missing login surfaces
 *     as a total failure of this step rather than a partial one.
 *   - `gh` authenticated with `contents: read` on `--repo` (`GH_TOKEN`).
 *     Without it every compare fails open and the guard degrades to "always
 *     advance" — loudly, via `::warning`, but it has stopped protecting you.
 *
 * ## Exit codes
 *
 *   0  every image advanced, was already current, or was deliberately
 *      declined; or there was nothing to do.
 *   1  at least one retag FAILED. `:latest` did not move for those images, so
 *      the redeploy about to run would pull a stale tag and report a fresh,
 *      healthy deploy of code that was never shipped. Failing here is what
 *      keeps that from being a silent false green.
 *   2  usage error.
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Wall-clock ceiling for any single registry / API subprocess.
 *
 * Without this a hung registry burns the whole job budget and the run
 * concludes `cancelled` — the alert-suppressing state #6171 fixed. A bounded
 * failure that says "timeout" is strictly better than an unbounded wait.
 */
export const SUBPROCESS_TIMEOUT_MS: number = (() => {
  const raw = process.env.ADVANCE_LATEST_TAG_TIMEOUT_MS;
  if (raw === undefined) return 60_000;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 60_000;
})();

/** Cap on how much subprocess output we fold into a single annotation. */
const MAX_DETAIL_CHARS = 500;

/**
 * How the commit behind the current `:latest` relates to the commit we just
 * built, as reported by GitHub's compare API `status` field for
 * `compare/<current>...<ours>`.
 *
 * - `identical` — same commit; `:latest` already points at our image.
 * - `ahead`     — ours is ahead of `:latest`; advancing moves staging forward.
 * - `behind`    — ours is BEHIND `:latest`; advancing would REGRESS staging.
 * - `diverged`  — no linear relationship (should not happen on main).
 */
export type CompareStatus = "identical" | "ahead" | "behind" | "diverged";

export type LatestTagAction =
  /** Retag `:latest` onto the image we just built. */
  | "advance"
  /** `:latest` already IS this image, digest and all; nothing to do. */
  | "already-current"
  /** `:latest` holds a strict descendant; moving it would regress staging. */
  | "decline-regression";

export interface LatestTagDecision {
  action: LatestTagAction;
  /** Human-readable justification, surfaced in the workflow log. */
  reason: string;
}

/**
 * Pure decision function — the whole safety property lives here, and it is
 * what the unit tests pin.
 *
 * `currentRevision` is the commit behind the existing `:latest`, or null when
 * it could not be determined (no such tag, no revision label, registry error).
 * `compareStatus` is null when the comparison could not be performed.
 * `latestIsSameImage` is consulted ONLY when `currentRevision === sha`.
 *
 * The invariant: return `decline-regression` if and only if we have POSITIVE
 * proof that `:latest` already points at a descendant of `sha`. Every other
 * state advances, because a stuck `:latest` is itself the failure mode we are
 * fixing — an unknown must never strand staging on old code.
 */
export function decideLatestTagAction(args: {
  sha: string;
  currentRevision: string | null;
  compareStatus: CompareStatus | null;
  /**
   * Whether `:latest` and `:<sha>` resolve to the SAME manifest digest, or
   * null when that could not be established.
   *
   * The revision label identifies a COMMIT, not an image. The same commit can
   * be rebuilt — a base-image CVE refresh, a cache-miss rebuild, a retried
   * build — producing a new digest under the same `:<sha>` tag while
   * `:latest` still points at the old one. Keying "nothing to do" on the
   * label alone silently no-ops that rebuild and leaves staging and
   * digest-pinned prod on different digests for the same commit.
   */
  latestIsSameImage?: boolean | null;
}): LatestTagDecision {
  const { sha, currentRevision, compareStatus } = args;
  const latestIsSameImage = args.latestIsSameImage ?? null;

  if (currentRevision === null) {
    return {
      action: "advance",
      reason:
        "`:latest` has no resolvable commit revision (first build, unlabelled legacy image, or registry read failure) — advancing.",
    };
  }

  if (currentRevision === sha) {
    if (latestIsSameImage === true) {
      return {
        action: "already-current",
        reason: `\`:latest\` already points at ${sha} and carries the same manifest digest as \`:${sha}\` — nothing to do.`,
      };
    }
    return {
      action: "advance",
      reason:
        latestIsSameImage === false
          ? `\`:latest\` is labelled ${sha} but holds a DIFFERENT manifest digest than \`:${sha}\` — the same commit was rebuilt and \`:latest\` still points at the older image. Advancing so staging and digest-pinned prod agree.`
          : `\`:latest\` is labelled ${sha} but its digest could not be compared with \`:${sha}\` — advancing rather than assuming the two match.`,
    };
  }

  if (compareStatus === null) {
    return {
      action: "advance",
      reason: `Could not compare ${currentRevision} with ${sha} (see the warning above for why) — advancing rather than stranding staging on an older image.`,
    };
  }

  if (compareStatus === "behind") {
    return {
      action: "decline-regression",
      reason:
        `REGRESSION BLOCKED: \`:latest\` points at ${currentRevision}, which is a DESCENDANT of the commit this run built (${sha}). ` +
        `A newer build already shipped this image; overwriting it would roll staging BACK. Declining to move \`:latest\`. ` +
        `The immutable \`:${sha}\` tag was still pushed and remains available.`,
    };
  }

  if (compareStatus === "identical") {
    // Reachable when the two revision strings denote the SAME commit without
    // being byte-equal — e.g. a legacy image labelled with an abbreviated sha
    // compared against our full 40-character one. Advancing is a cheap no-op
    // that also repairs a `:latest` whose digest has drifted from `:<sha>`.
    return {
      action: "advance",
      reason: `\`:latest\` (${currentRevision}) is identical to ${sha} — advancing.`,
    };
  }

  return {
    action: "advance",
    reason: `\`:latest\` (${currentRevision}) is ${compareStatus} relative to ${sha} — advancing.`,
  };
}

/** Narrow an arbitrary string to a CompareStatus, or null if unrecognised. */
export function parseCompareStatus(raw: string): CompareStatus | null {
  const v = raw.trim();
  return v === "identical" ||
    v === "ahead" ||
    v === "behind" ||
    v === "diverged"
    ? v
    : null;
}

// ---------------------------------------------------------------------------
// GitHub Actions workflow-command encoding.
// ---------------------------------------------------------------------------

/**
 * Escape a workflow-command MESSAGE body.
 *
 * Registry stderr is multi-line and attacker-adjacent (it echoes refs back at
 * us). Unescaped, a newline ends the annotation early — the actual reason
 * gets truncated out of the very annotation that exists to report it — and a
 * newline followed by `::` would let subprocess output forge a workflow
 * command. Encoding the newline is what makes an embedded `::` inert: a
 * command must begin a line, and after this there are no more lines.
 */
export function escapeAnnotationData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escape a workflow-command PROPERTY value (e.g. `title=`). */
export function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** Build a correctly-escaped `::<level> title=…::<message>` annotation. */
export function annotation(
  level: "warning" | "error" | "notice",
  title: string,
  message: string,
): string {
  return `::${level} title=${escapeAnnotationProperty(title)}::${escapeAnnotationData(message)}`;
}

// ---------------------------------------------------------------------------
// Failure classification. Fail-open stays the behaviour; being unable to SAY
// why does not.
// ---------------------------------------------------------------------------

export type ProbeFailureKind =
  /** The tag genuinely does not exist — a real first build. */
  | "absent"
  /** Credentials missing, expired, or lacking the required scope. */
  | "unauthorized"
  /** Registry or API rate limit. */
  | "throttled"
  /** We killed the subprocess at SUBPROCESS_TIMEOUT_MS. */
  | "timeout"
  /** Network or registry outage. */
  | "unavailable"
  /** Anything we could not place. */
  | "unknown";

export interface ProbeFailure {
  kind: ProbeFailureKind;
  /** Single-line, length-capped diagnostic text from the failed command. */
  detail: string;
}

const PROBE_FAILURE_SUMMARY: Record<ProbeFailureKind, string> = {
  absent: "the tag does not exist yet",
  unauthorized:
    "the registry/API rejected our credentials — check `packages: write` and the `docker/login-action` step (a retag is a WRITE, anonymous pulls are not enough)",
  throttled:
    "we were rate-limited — likely under exactly the concurrent-build load this guard exists to handle",
  timeout: `the command exceeded its ${SUBPROCESS_TIMEOUT_MS}ms budget`,
  unavailable: "the registry or network was unreachable",
  unknown: "the command failed for an unrecognised reason",
};

/** Human-readable one-liner for a classified failure. */
export function describeProbeFailure(failure: ProbeFailure): string {
  return `${PROBE_FAILURE_SUMMARY[failure.kind]} [${failure.kind}]: ${failure.detail}`;
}

/**
 * Best-effort diagnostic text for a failed subprocess, collapsed to one line
 * and length-capped so it survives an annotation intact.
 */
export function describeSubprocessError(error: unknown): string {
  const e = error as { stderr?: unknown; message?: unknown } | null | undefined;
  const stderr = e?.stderr;
  const stderrText =
    stderr === undefined || stderr === null ? "" : String(stderr).trim();
  const text =
    stderrText !== ""
      ? stderrText
      : error instanceof Error
        ? error.message
        : String(error);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_CHARS
    ? `${oneLine.slice(0, MAX_DETAIL_CHARS)}…`
    : oneLine;
}

/**
 * Classify a failed registry/API subprocess.
 *
 * Order matters: a loud misread is better than a quiet one, so auth and
 * throttling are matched BEFORE "not found" (registries routinely answer 404
 * to hide the existence of things you may not read).
 */
export function classifyProbeFailure(error: unknown): ProbeFailure {
  const detail = describeSubprocessError(error);
  const hay = detail.toLowerCase();
  const e = error as
    | { killed?: boolean; signal?: string | null; code?: unknown }
    | null
    | undefined;

  if (
    e?.killed === true ||
    e?.signal === "SIGTERM" ||
    e?.code === "ETIMEDOUT"
  ) {
    return { kind: "timeout", detail };
  }
  if (/429|too\s?many\s?requests|rate[\s_-]?limit|throttl/.test(hay)) {
    return { kind: "throttled", detail };
  }
  if (
    /unauthorized|authentication required|requested access to the resource is denied|\bdenied\b|forbidden|\b401\b|\b403\b|permission_denied|insufficient_scope|login/.test(
      hay,
    )
  ) {
    return { kind: "unauthorized", detail };
  }
  if (
    /manifest[\s_]unknown|name[\s_]unknown|not found|\b404\b|no such (manifest|image|tag)/.test(
      hay,
    )
  ) {
    return { kind: "absent", detail };
  }
  if (
    /timed? ?out|connection refused|no such host|temporary failure|eai_again|econnreset|network|\b50[0234]\b|dial tcp|i\/o timeout/.test(
      hay,
    )
  ) {
    return { kind: "unavailable", detail };
  }
  return { kind: "unknown", detail };
}

/**
 * Extract an `org.opencontainers.image.revision` value from the JSON emitted
 * by `docker buildx imagetools inspect --format '{{json .Image}}'`.
 *
 * The shape differs between single-platform images (a bare config object) and
 * multi-platform ones (an object keyed by platform), so rather than commit to
 * either we walk the whole structure for the label.
 *
 * We collect EVERY occurrence and only answer when they all agree. That makes
 * the result independent of traversal and key order — the previous
 * first-match-wins walk returned whichever label the payload happened to list
 * last, so the same logical multi-config image could yield different answers
 * depending on key ordering. Disagreement means we cannot say which commit
 * this image is, which is an "unknown", which advances. Returns null when the
 * label is absent, unparseable, or ambiguous.
 */
export function extractRevisionLabel(inspectJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inspectJson);
  } catch {
    return null;
  }

  const LABEL = "org.opencontainers.image.revision";
  const found = new Set<string>();

  // `JSON.parse` output is a finite tree — it cannot contain cycles — so no
  // visited-set is needed here (the previous one was dead code).
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }

    const rec = node as Record<string, unknown>;
    const val = rec[LABEL];
    if (typeof val === "string" && val.trim() !== "") found.add(val.trim());

    for (const child of Object.values(rec)) stack.push(child);
  }

  return found.size === 1 ? [...found][0] : null;
}

// ---------------------------------------------------------------------------
// I/O shims. Kept behind an injectable interface so the decision path above
// stays unit-testable without a registry or a network.
// ---------------------------------------------------------------------------

export interface GuardIo {
  /** Revision label of the image currently tagged `:latest`, or null. */
  readLatestRevision(image: string): string | null;
  /**
   * Manifest digest of `<image>:<ref>`, or null when it cannot be read.
   * Called only when the revision label says `:latest` is already our commit,
   * to tell "genuinely current" apart from "same commit, older build".
   */
  readDigest(image: string, ref: string): string | null;
  /** GitHub compare status for `<base>...<head>`, or null when unavailable. */
  compare(repo: string, base: string, head: string): CompareStatus | null;
  /** Point `:latest` at the already-pushed `:<sha>` image. */
  retagLatest(image: string, sha: string): void;
  log(message: string): void;
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: SUBPROCESS_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function stdoutLog(message: string): void {
  process.stdout.write(`${message}\n`);
}

export const defaultIo: GuardIo = {
  readLatestRevision(image) {
    let json: string;
    try {
      json = run("docker", [
        "buildx",
        "imagetools",
        "inspect",
        `${image}:latest`,
        "--format",
        "{{json .Image}}",
      ]);
    } catch (error) {
      const failure = classifyProbeFailure(error);
      if (failure.kind === "absent") {
        stdoutLog(
          `${image}:latest does not exist yet (${failure.detail}) — treating this as a first build.`,
        );
      } else {
        stdoutLog(
          annotation(
            "warning",
            `Could not read ${image}:latest`,
            `${describeProbeFailure(failure)} — the guard is FAILING OPEN and will advance \`:latest\`, so a regression could not have been detected for this image on this run.`,
          ),
        );
      }
      return null;
    }

    const revision = extractRevisionLabel(json);
    if (revision === null) {
      stdoutLog(
        `${image}:latest carries no unambiguous org.opencontainers.image.revision label — treating as unknown (advances).`,
      );
    }
    return revision;
  },

  readDigest(image, ref) {
    try {
      const out = run("docker", [
        "buildx",
        "imagetools",
        "inspect",
        `${image}:${ref}`,
        "--format",
        "{{.Manifest.Digest}}",
      ]).trim();
      return out === "" ? null : out;
    } catch (error) {
      const failure = classifyProbeFailure(error);
      stdoutLog(
        annotation(
          "warning",
          `Could not read the digest of ${image}:${ref}`,
          `${describeProbeFailure(failure)} — cannot confirm whether \`:latest\` already IS the image this run pushed, so it will be advanced regardless.`,
        ),
      );
      return null;
    }
  },

  compare(repo, base, head) {
    let out: string;
    try {
      out = run("gh", [
        "api",
        `repos/${repo}/compare/${base}...${head}`,
        "--jq",
        ".status",
      ]);
    } catch (error) {
      const failure = classifyProbeFailure(error);
      stdoutLog(
        annotation(
          "warning",
          `Could not compare ${base}...${head} in ${repo}`,
          `${describeProbeFailure(failure)} — the guard is FAILING OPEN and will advance \`:latest\` without knowing whether that regresses staging.`,
        ),
      );
      return null;
    }

    const status = parseCompareStatus(out);
    if (status === null) {
      stdoutLog(
        annotation(
          "warning",
          `Unrecognised compare status from ${repo}`,
          `GitHub returned ${JSON.stringify(out.trim())} for ${base}...${head}, which is not one of identical/ahead/behind/diverged — failing open and advancing.`,
        ),
      );
    }
    return status;
  },

  retagLatest(image, sha) {
    // Registry-side retag: copies the manifest, never pulls the image.
    // Source is the immutable `:<sha>` tag this run just pushed.
    //
    // `--prefer-index=false` keeps this a byte-for-byte carbon copy so
    // `:latest` and `:<sha>` share a DIGEST — see the "Digest identity"
    // section at the top. It is a no-op for the index-shaped manifests we
    // push today and the fix for bare single manifests, so it holds the
    // property regardless of whether provenance stays enabled.
    run("docker", [
      "buildx",
      "imagetools",
      "create",
      "--prefer-index=false",
      "-t",
      `${image}:latest`,
      `${image}:${sha}`,
    ]);
  },

  log: stdoutLog,
};

/**
 * Resolve the decision for `image` at `sha` and act on it.
 * Returns the decision so callers (and tests) can assert on it.
 */
export function advanceLatestTag(
  args: { image: string; sha: string; repo: string },
  io: GuardIo = defaultIo,
): LatestTagDecision {
  const { image, sha, repo } = args;

  const currentRevision = io.readLatestRevision(image);

  // Only when the label claims `:latest` is already our commit do we need to
  // pay for digests — that is the one branch where the label alone can lie.
  let latestIsSameImage: boolean | null = null;
  if (currentRevision === sha) {
    const latestDigest = io.readDigest(image, "latest");
    const shaDigest = io.readDigest(image, sha);
    latestIsSameImage =
      latestDigest !== null && shaDigest !== null
        ? latestDigest === shaDigest
        : null;
  }

  const compareStatus =
    currentRevision !== null && currentRevision !== sha
      ? io.compare(repo, currentRevision, sha)
      : null;

  const decision = decideLatestTagAction({
    sha,
    currentRevision,
    compareStatus,
    latestIsSameImage,
  });

  if (decision.action === "decline-regression") {
    // A GitHub Actions warning annotation, not an error: this run behaved
    // correctly by standing down. The run that SHOULD own `:latest` is the
    // newer one, and it already does.
    io.log(annotation("warning", ":latest not advanced", decision.reason));
    return decision;
  }

  io.log(decision.reason);
  if (decision.action === "advance") {
    io.retagLatest(image, sha);
    io.log(`Advanced ${image}:latest → ${sha}`);
  }
  return decision;
}

/**
 * Split a caller-supplied image list on commas and/or newlines.
 *
 * The workflow builds this from the SAME matrix ∩ build-success intersection
 * that decides which services get redeployed, so `:latest` only ever moves for
 * an image this run actually pushed.
 */
export function parseImageList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export interface FleetResult {
  /** Images whose `:latest` was moved onto `:<sha>`. */
  advanced: string[];
  /** Images already pointing at this exact image; nothing was written. */
  unchanged: string[];
  /** Images where advancing would have regressed staging. */
  declined: string[];
  /** Images whose retag threw. */
  failures: Array<{ image: string; error: unknown }>;
}

/**
 * Advance `:latest` for a whole fleet.
 *
 * Every image is attempted even if an earlier one throws, so one broken repo
 * cannot mask the rest. Errors are COLLECTED, never rethrown: the caller
 * decides what a partial failure means. `main` turns a non-empty `failures`
 * into exit 1.
 *
 * The full partition is returned — and logged by `main` — because "N images
 * failed" without naming the ones that SUCCEEDED leaves an operator unable to
 * tell a total auth outage from one bad repo, which are very different
 * incidents with very different responses.
 */
export function advanceLatestTags(
  args: { images: string[]; sha: string; repo: string },
  io: GuardIo = defaultIo,
): FleetResult {
  const result: FleetResult = {
    advanced: [],
    unchanged: [],
    declined: [],
    failures: [],
  };

  for (const image of args.images) {
    try {
      const decision = advanceLatestTag(
        { image, sha: args.sha, repo: args.repo },
        io,
      );
      if (decision.action === "advance") result.advanced.push(image);
      else if (decision.action === "already-current")
        result.unchanged.push(image);
      else result.declined.push(image);
    } catch (error) {
      // `::error::` so the annotation surfaces on the run, not just in the log.
      const failure = classifyProbeFailure(error);
      io.log(
        annotation(
          "error",
          `Failed to advance :latest for ${image}`,
          `${describeProbeFailure(failure)}`,
        ),
      );
      result.failures.push({ image, error });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  "usage: advance-latest-tag.ts --images <ref[,ref...]> --sha <commit> --repo <owner/name>\n" +
  "       --image <ref> is an alias for --images; --flag=value is also accepted.\n" +
  "       An empty --images value is a deliberate no-op, not an error.\n" +
  "       (or set IMAGES / GITHUB_SHA / GITHUB_REPOSITORY)\n";

export type FlagResult =
  /** The flag does not appear in argv at all. */
  | { kind: "absent" }
  /** The flag appears but nothing usable follows it. */
  | { kind: "no-value" }
  /** The flag appears with a value, which may legitimately be empty. */
  | { kind: "value"; value: string };

/**
 * Read `--flag value` or `--flag=value` out of argv.
 *
 * The three-way result exists because "flag omitted", "flag given without a
 * value", and "flag given an empty value" need different handling, and
 * collapsing them loses real information: an omitted `--images` should fall
 * back to `$IMAGES`, an empty one is a deliberate no-op, and a valueless one
 * is a malformed command line.
 *
 * A following token that itself looks like a flag is NOT consumed as a value:
 * `--sha --repo owner/name` previously yielded the literal string `"--repo"`
 * as the commit sha and went on to attempt a retag against `:--repo`.
 */
export function readFlag(argv: string[], flag: string): FlagResult {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--"))
        return { kind: "no-value" };
      return { kind: "value", value: next };
    }
    if (arg.startsWith(`${flag}=`)) {
      return { kind: "value", value: arg.slice(flag.length + 1) };
    }
  }
  return { kind: "absent" };
}

function main(argv: string[]): void {
  const flags = {
    "--images": readFlag(argv, "--images"),
    "--image": readFlag(argv, "--image"),
    "--sha": readFlag(argv, "--sha"),
    "--repo": readFlag(argv, "--repo"),
  };

  const valueless = Object.entries(flags)
    .filter(([, result]) => result.kind === "no-value")
    .map(([name]) => name);
  if (valueless.length > 0) {
    process.stderr.write(
      `error: ${valueless.join(", ")} given without a value\n${USAGE}`,
    );
    process.exit(2);
  }

  const valueOf = (result: FlagResult): string | undefined =>
    result.kind === "value" ? result.value : undefined;

  const rawImages =
    valueOf(flags["--images"]) ??
    valueOf(flags["--image"]) ??
    process.env.IMAGES;
  const sha = valueOf(flags["--sha"]) ?? process.env.GITHUB_SHA;
  const repo = valueOf(flags["--repo"]) ?? process.env.GITHUB_REPOSITORY;

  // `rawImages === undefined` (absent) is a usage error; `""` (explicitly
  // empty) is the documented no-op, handled below.
  if (rawImages === undefined || !sha || !repo) {
    process.stderr.write(USAGE);
    process.exit(2);
  }

  const images = parseImageList(rawImages);
  if (images.length === 0) {
    // Nothing built → nothing to advance. Not an error.
    process.stdout.write("No images to advance.\n");
    return;
  }

  const result = advanceLatestTags({ images, sha, repo });

  const summarise = (label: string, list: string[]): void => {
    if (list.length > 0) {
      process.stdout.write(`${label} (${list.length}): ${list.join(", ")}\n`);
    }
  };
  summarise("Advanced :latest", result.advanced);
  summarise("Already current", result.unchanged);
  summarise("Declined (would regress staging)", result.declined);

  if (result.failures.length > 0) {
    const failed = result.failures.map((f) => f.image);
    summarise("FAILED to advance :latest", failed);
    process.stderr.write(
      `Failed to advance :latest for ${failed.length} of ${images.length} image(s): ${failed.join(", ")}\n` +
        `Succeeded for ${result.advanced.length + result.unchanged.length + result.declined.length}: ` +
        `${[...result.advanced, ...result.unchanged, ...result.declined].join(", ") || "(none)"}\n`,
    );
    process.exit(1);
  }
}

/**
 * True when this file is being executed directly rather than imported.
 *
 * Both sides are canonicalised: Node resolves `import.meta.url` through
 * symlinks but `process.argv[1]` is whatever path the caller typed, so
 * invoking the script through a symlink made the comparison fail, `main`
 * never ran, and the process exited 0 having done nothing — a false green in
 * the exact place a false green is most expensive.
 */
export function isDirectInvocation(
  entry: string | undefined,
  moduleUrl: string,
): boolean {
  if (entry === undefined) return false;
  const canonical = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return canonical(entry) === canonical(fileURLToPath(moduleUrl));
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2));
}
