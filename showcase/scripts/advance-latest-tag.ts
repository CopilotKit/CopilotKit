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
 * Two reasons: those jobs already have Node (the build slots do not, so a
 * per-slot invocation would mean an unpinned `npx tsx` fetch on ~50 parallel
 * runners), and deciding right before the pull keeps the window as narrow as
 * possible. The image list is the SAME matrix ∩ build-success intersection
 * that decides what gets redeployed, so a failed build can never move a tag.
 *
 * ## Usage
 *
 *   npx tsx showcase/scripts/advance-latest-tag.ts \
 *     --images ghcr.io/copilotkit/showcase-shell,ghcr.io/copilotkit/showcase-harness \
 *     --sha "$GITHUB_SHA" --repo copilotkit/copilotkit
 *
 * Requires: `docker buildx` (authenticated to the registry) and `gh` with
 * `contents: read` on the repo. Exit 0 on advance or a deliberate decline;
 * exit 1 when a retag fails, which reds the redeploy job so staging is not
 * redeployed against a tag that did not move.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  /** `:latest` already points at this exact commit; nothing to do. */
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
}): LatestTagDecision {
  const { sha, currentRevision, compareStatus } = args;

  if (currentRevision === null) {
    return {
      action: "advance",
      reason:
        "`:latest` has no resolvable commit revision (first build, unlabelled legacy image, or registry read failure) — advancing.",
    };
  }

  if (currentRevision === sha) {
    return {
      action: "already-current",
      reason: `\`:latest\` already points at ${sha} — nothing to do.`,
    };
  }

  if (compareStatus === null) {
    return {
      action: "advance",
      reason: `Could not compare ${currentRevision} with ${sha} (API unreachable) — advancing rather than stranding staging on an older image.`,
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
    // Different revision label but GitHub says the commits are identical —
    // possible when a commit is reachable under two shas (e.g. a rebuild of
    // an equivalent tree). Harmless to advance.
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

/**
 * Extract an `org.opencontainers.image.revision` value from the JSON emitted
 * by `docker buildx imagetools inspect --format '{{json .Image}}'`.
 *
 * The shape differs between single-platform images (a bare config object) and
 * multi-platform ones (an object keyed by platform), so rather than commit to
 * either we walk the whole structure for the label. Returns null when absent.
 */
export function extractRevisionLabel(inspectJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inspectJson);
  } catch {
    return null;
  }

  const LABEL = "org.opencontainers.image.revision";
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    const rec = node as Record<string, unknown>;
    const val = rec[LABEL];
    if (typeof val === "string" && val.trim() !== "") return val.trim();

    for (const child of Object.values(rec)) stack.push(child);
  }

  return null;
}

// ---------------------------------------------------------------------------
// I/O shims. Kept behind an injectable interface so the decision path above
// stays unit-testable without a registry or a network.
// ---------------------------------------------------------------------------

export interface GuardIo {
  /** Revision label of the image currently tagged `:latest`, or null. */
  readLatestRevision(image: string): string | null;
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
  });
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
    } catch {
      // No `:latest` yet, or the registry read failed. Both mean "unknown",
      // which the decision function treats as advance.
      return null;
    }
    return extractRevisionLabel(json);
  },

  compare(repo, base, head) {
    try {
      const out = run("gh", [
        "api",
        `repos/${repo}/compare/${base}...${head}`,
        "--jq",
        ".status",
      ]);
      return parseCompareStatus(out);
    } catch {
      return null;
    }
  },

  retagLatest(image, sha) {
    // Registry-side retag: copies the manifest, never pulls the image.
    // Source is the immutable `:<sha>` tag this run just pushed.
    run("docker", [
      "buildx",
      "imagetools",
      "create",
      "-t",
      `${image}:latest`,
      `${image}:${sha}`,
    ]);
  },

  log(message) {
    process.stdout.write(`${message}\n`);
  },
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
  const compareStatus =
    currentRevision !== null && currentRevision !== sha
      ? io.compare(repo, currentRevision, sha)
      : null;

  const decision = decideLatestTagAction({
    sha,
    currentRevision,
    compareStatus,
  });

  if (decision.action === "decline-regression") {
    // A GitHub Actions warning annotation, not an error: this run behaved
    // correctly by standing down. The run that SHOULD own `:latest` is the
    // newer one, and it already does.
    io.log(`::warning title=:latest not advanced::${decision.reason}`);
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

/**
 * Advance `:latest` for a whole fleet. Every image is attempted even if an
 * earlier one throws, so one broken repo cannot mask the rest; the first
 * error is rethrown afterwards so the step (and therefore the job) goes red.
 */
export function advanceLatestTags(
  args: { images: string[]; sha: string; repo: string },
  io: GuardIo = defaultIo,
): { failures: Array<{ image: string; error: unknown }> } {
  const failures: Array<{ image: string; error: unknown }> = [];
  for (const image of args.images) {
    try {
      advanceLatestTag({ image, sha: args.sha, repo: args.repo }, io);
    } catch (error) {
      // `::error::` so the annotation surfaces on the run, not just in the log.
      io.log(
        `::error title=Failed to advance :latest::${image} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      failures.push({ image, error });
    }
  }
  return { failures };
}

function main(argv: string[]): void {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const rawImages = get("--images") ?? get("--image") ?? process.env.IMAGES;
  const sha = get("--sha") ?? process.env.GITHUB_SHA;
  const repo = get("--repo") ?? process.env.GITHUB_REPOSITORY;

  if (!rawImages || !sha || !repo) {
    process.stderr.write(
      "usage: advance-latest-tag.ts --images <ref[,ref...]> --sha <commit> --repo <owner/name>\n" +
        "       (or set IMAGES / GITHUB_SHA / GITHUB_REPOSITORY)\n",
    );
    process.exit(2);
  }

  const images = parseImageList(rawImages);
  if (images.length === 0) {
    // Nothing built → nothing to advance. Not an error.
    process.stdout.write("No images to advance.\n");
    return;
  }

  const { failures } = advanceLatestTags({ images, sha, repo });
  if (failures.length > 0) {
    // Exit non-zero: `:latest` did NOT move for these images, so the redeploy
    // about to run would pull a stale tag and report a fresh, healthy deploy.
    // Failing here is what keeps that from being a silent false green.
    process.stderr.write(
      `Failed to advance :latest for ${failures.length} image(s): ${failures
        .map((f) => f.image)
        .join(", ")}\n`,
    );
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
