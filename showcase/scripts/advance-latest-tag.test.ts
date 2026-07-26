import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  advanceLatestTag,
  advanceLatestTags,
  decideLatestTagAction,
  extractRevisionLabel,
  parseCompareStatus,
  parseImageList,
} from "./advance-latest-tag";
import type { CompareStatus, GuardIo } from "./advance-latest-tag";

// ---------------------------------------------------------------------------
// Regression guard for the `:latest` tag race in
// `.github/workflows/showcase_build.yml`.
//
// The bug (2026-07-26): the workflow has no concurrency group by design, so
// three merges landing within 34 seconds produced three simultaneous builds
// all pushing the same `:latest` tags. The NEWEST commit's build finished
// FIRST, so the two OLDER builds overwrote it. Per-service, older beat newer
// by 1-16 seconds on shell-dashboard, shell-dojo, shell and showcase-harness.
// All three runs reported `success`.
//
// This suite pins BOTH halves of the fix:
//   1. the decision logic (never regress, fail open on every unknown), and
//   2. the LIVE workflow wiring — that the build step no longer pushes
//      `:latest` itself, that it stamps the revision label the guard reads,
//      and that the guard step actually runs. A correct script that is not
//      wired in fixes nothing, which is why the YAML is asserted directly
//      rather than mocked.
// ---------------------------------------------------------------------------

const WORKFLOW_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "workflows",
  "showcase_build.yml",
);

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface WorkflowDoc {
  concurrency?: unknown;
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

function readWorkflow(): WorkflowDoc {
  return parseYaml(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowDoc;
}

function stepsOf(jobId: string): WorkflowStep[] {
  const doc = readWorkflow();
  const job = doc.jobs[jobId];
  if (!job) throw new Error(`Job '${jobId}' not found in ${WORKFLOW_PATH}`);
  if (!Array.isArray(job.steps)) {
    throw new Error(`Job '${jobId}' has no steps`);
  }
  return job.steps;
}

/** The single step in `jobId` that invokes depot/build-push-action. */
function buildPushStep(jobId: string): WorkflowStep {
  const matches = stepsOf(jobId).filter((s) =>
    (s.uses ?? "").startsWith("depot/build-push-action@"),
  );
  expect(
    matches,
    `expected exactly one depot/build-push-action step in '${jobId}'`,
  ).toHaveLength(1);
  return matches[0];
}

/** The step in `jobId` that runs the advance-latest-tag guard. */
function guardStep(jobId: string): WorkflowStep {
  const matches = stepsOf(jobId).filter((s) =>
    (s.run ?? "").includes("advance-latest-tag.ts"),
  );
  expect(
    matches,
    `expected exactly one advance-latest-tag.ts step in '${jobId}'`,
  ).toHaveLength(1);
  return matches[0];
}

function tagsOf(step: WorkflowStep): string[] {
  const raw = step.with?.tags;
  expect(typeof raw, "build-push step must declare `tags`").toBe("string");
  return String(raw)
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

// ---------------------------------------------------------------------------
// The safety property, stated directly.
// ---------------------------------------------------------------------------

describe("decideLatestTagAction", () => {
  const SHA = "db75a04837fc488c67fdcd2f25f7bb682e9471a8";
  const OLDER = "59f275eedcc56a7d59c10e59dd146444044246ed";

  it("RED (the production incident): declines when :latest holds a DESCENDANT", () => {
    // This is exactly run 30190823203 (older commit 59f275eedc) arriving at
    // the registry 1-16s AFTER run 30190831480 (newer db75a04837) had already
    // published. Pre-fix, the push was unconditional and staging regressed.
    const decision = decideLatestTagAction({
      sha: OLDER,
      currentRevision: SHA,
      compareStatus: "behind",
    });
    expect(decision.action).toBe("decline-regression");
    expect(decision.reason).toContain("REGRESSION BLOCKED");
    // The reason must name both commits so the log is diagnosable.
    expect(decision.reason).toContain(SHA);
    expect(decision.reason).toContain(OLDER);
  });

  it("GREEN: the newer commit still advances over an older :latest", () => {
    const decision = decideLatestTagAction({
      sha: SHA,
      currentRevision: OLDER,
      compareStatus: "ahead",
    });
    expect(decision.action).toBe("advance");
  });

  it("is a no-op when :latest already points at this commit", () => {
    const decision = decideLatestTagAction({
      sha: SHA,
      currentRevision: SHA,
      compareStatus: null,
    });
    expect(decision.action).toBe("already-current");
  });

  // Every unknown must ADVANCE. A guard that fails closed would strand
  // staging on an old image — the exact failure it exists to prevent.
  it.each<[string, string | null, CompareStatus | null]>([
    ["no :latest tag yet (first build)", null, null],
    ["unlabelled legacy image", null, "ahead"],
    ["compare API unreachable", OLDER, null],
    ["diverged history", OLDER, "diverged"],
    ["identical trees under different shas", OLDER, "identical"],
  ])(
    "fails OPEN — advances on %s",
    (_label, currentRevision, compareStatus) => {
      const decision = decideLatestTagAction({
        sha: SHA,
        currentRevision,
        compareStatus,
      });
      expect(decision.action).toBe("advance");
    },
  );

  it("declines ONLY on 'behind' — no other status blocks the advance", () => {
    const statuses: CompareStatus[] = [
      "identical",
      "ahead",
      "behind",
      "diverged",
    ];
    const declined = statuses.filter(
      (s) =>
        decideLatestTagAction({
          sha: SHA,
          currentRevision: OLDER,
          compareStatus: s,
        }).action === "decline-regression",
    );
    expect(declined).toEqual(["behind"]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end through the injectable IO seam: prove the retag is SUPPRESSED
// on a regression and PERFORMED otherwise.
// ---------------------------------------------------------------------------

describe("advanceLatestTag", () => {
  const IMAGE = "ghcr.io/copilotkit/showcase-shell-dashboard";
  const NEWER = "db75a04837fc488c67fdcd2f25f7bb682e9471a8";
  const OLDER = "59f275eedcc56a7d59c10e59dd146444044246ed";

  function fakeIo(overrides: Partial<GuardIo> = {}) {
    const retags: Array<{ image: string; sha: string }> = [];
    const logs: string[] = [];
    const io: GuardIo = {
      readLatestRevision: () => null,
      compare: () => null,
      retagLatest: (image, sha) => void retags.push({ image, sha }),
      log: (m) => void logs.push(m),
      ...overrides,
    };
    return { io, retags, logs };
  }

  it("does NOT retag when an older build races in behind a newer one", () => {
    const { io, retags, logs } = fakeIo({
      readLatestRevision: () => NEWER,
      compare: () => "behind",
    });
    const decision = advanceLatestTag(
      { image: IMAGE, sha: OLDER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(decision.action).toBe("decline-regression");
    expect(retags).toEqual([]); // ← the whole point
    // Surfaced as a warning annotation, not an error: standing down is correct.
    expect(logs.join("\n")).toContain("::warning");
  });

  it("retags when this run is the newest", () => {
    const { io, retags } = fakeIo({
      readLatestRevision: () => OLDER,
      compare: () => "ahead",
    });
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(retags).toEqual([{ image: IMAGE, sha: NEWER }]);
  });

  it("retags on a first-ever build with no :latest", () => {
    const { io, retags } = fakeIo({ readLatestRevision: () => null });
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(retags).toEqual([{ image: IMAGE, sha: NEWER }]);
  });

  it("skips the compare call entirely when :latest is already this commit", () => {
    let compareCalls = 0;
    const { io, retags } = fakeIo({
      readLatestRevision: () => NEWER,
      compare: () => {
        compareCalls += 1;
        return "identical";
      },
    });
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(compareCalls).toBe(0);
    expect(retags).toEqual([]);
  });

  it("compares in the right direction (<current>...<ours>)", () => {
    const seen: Array<[string, string, string]> = [];
    const { io } = fakeIo({
      readLatestRevision: () => OLDER,
      compare: (repo, base, head) => {
        seen.push([repo, base, head]);
        return "ahead";
      },
    });
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    // base = what :latest holds, head = what we built. `behind` therefore
    // means "ours is behind :latest" — inverting these would invert the guard.
    expect(seen).toEqual([["copilotkit/copilotkit", OLDER, NEWER]]);
  });
});

describe("extractRevisionLabel", () => {
  const SHA = "db75a04837fc488c67fdcd2f25f7bb682e9471a8";

  it("reads the label from a single-platform inspect payload", () => {
    const json = JSON.stringify({
      config: { Labels: { "org.opencontainers.image.revision": SHA } },
    });
    expect(extractRevisionLabel(json)).toBe(SHA);
  });

  it("reads the label from a platform-keyed (multi-arch) payload", () => {
    const json = JSON.stringify({
      "linux/amd64": {
        config: { Labels: { "org.opencontainers.image.revision": SHA } },
      },
    });
    expect(extractRevisionLabel(json)).toBe(SHA);
  });

  it("returns null when the label is absent, blank, or the JSON is junk", () => {
    expect(
      extractRevisionLabel(JSON.stringify({ config: { Labels: {} } })),
    ).toBeNull();
    expect(
      extractRevisionLabel(
        JSON.stringify({
          config: { Labels: { "org.opencontainers.image.revision": "  " } },
        }),
      ),
    ).toBeNull();
    expect(extractRevisionLabel("not json")).toBeNull();
  });
});

describe("parseCompareStatus", () => {
  it("accepts the four documented statuses and rejects anything else", () => {
    expect(parseCompareStatus("behind\n")).toBe("behind");
    expect(parseCompareStatus(" ahead ")).toBe("ahead");
    expect(parseCompareStatus("identical")).toBe("identical");
    expect(parseCompareStatus("diverged")).toBe("diverged");
    expect(parseCompareStatus("")).toBeNull();
    expect(parseCompareStatus("Not Found")).toBeNull();
  });
});

describe("parseImageList", () => {
  it("splits on commas and newlines and drops blanks", () => {
    expect(parseImageList("a,b\nc, ,\n d ")).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseImageList("")).toEqual([]);
    expect(parseImageList("  ,\n ")).toEqual([]);
  });
});

describe("advanceLatestTags (fleet)", () => {
  const SHA = "db75a04837fc488c67fdcd2f25f7bb682e9471a8";

  it("attempts every image even when one throws, and reports the failures", () => {
    // One broken repo must not mask the rest of the fleet.
    const attempted: string[] = [];
    const io: GuardIo = {
      readLatestRevision: (image) => {
        attempted.push(image);
        return null;
      },
      compare: () => null,
      retagLatest: (image) => {
        if (image === "b") throw new Error("denied");
      },
      log: () => {},
    };
    const { failures } = advanceLatestTags(
      { images: ["a", "b", "c"], sha: SHA, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(attempted).toEqual(["a", "b", "c"]);
    expect(failures.map((f) => f.image)).toEqual(["b"]);
  });

  it("reports no failures when every image advances", () => {
    const io: GuardIo = {
      readLatestRevision: () => null,
      compare: () => null,
      retagLatest: () => {},
      log: () => {},
    };
    const { failures } = advanceLatestTags(
      { images: ["a", "b"], sha: SHA, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LIVE workflow wiring. These read the real YAML, so they fail if someone
// re-adds `:latest` to the push step or drops the guard.
// ---------------------------------------------------------------------------

describe.each([
  ["build", "matrix.service.image"],
  ["build-starters", "matrix.starter.image"],
])("showcase_build.yml — %s job", (jobId, imageExpr) => {
  it("does NOT push :latest from the build step", () => {
    // The regression: an unconditional `:latest` in this list is what let an
    // older concurrent build overwrite a newer one.
    for (const tag of tagsOf(buildPushStep(jobId))) {
      expect(tag.endsWith(":latest"), `build step must not push '${tag}'`).toBe(
        false,
      );
    }
  });

  it("pushes the immutable per-commit tag", () => {
    const tags = tagsOf(buildPushStep(jobId));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain("${{ github.sha }}");
    expect(tags[0]).toContain(`\${{ ${imageExpr} }}`);
  });

  it("stamps the revision label the guard reads back", () => {
    // Without this label the guard cannot identify the commit behind
    // `:latest`, fails open, and the race silently returns.
    const labels = String(buildPushStep(jobId).with?.labels ?? "");
    expect(labels).toContain("org.opencontainers.image.revision=");
    expect(labels).toContain("${{ github.sha }}");
  });
});

// The guard lives in the redeploy jobs, not the build matrix: those already
// have Node, and running there puts the decision immediately before the
// Railway pull that actually consumes `:latest`.
describe.each([
  ["redeploy-staging", "Redeploy changed services in staging"],
  ["redeploy-staging-starters", "Redeploy changed starters in staging"],
])("showcase_build.yml — %s job", (jobId, redeployStepName) => {
  it("runs the guard with the image list, sha, repo and a token", () => {
    const step = guardStep(jobId);
    expect(step.env?.IMAGES).toBe("${{ steps.changed.outputs.images }}");
    expect(step.env?.GITHUB_SHA).toBe("${{ github.sha }}");
    expect(step.env?.GITHUB_REPOSITORY).toBe("${{ github.repository }}");
    // gh api needs a token; without it compare() fails open and the guard
    // degrades to the old unconditional behaviour.
    expect(step.env?.GH_TOKEN).toBeTruthy();
  });

  it("advances :latest BEFORE the Railway redeploy pulls it", () => {
    // Ordering is the entire safety argument. Redeploying first would pull
    // the old `:latest` and report a fresh, healthy deploy of stale code.
    const steps = stepsOf(jobId);
    const guardIdx = steps.findIndex((s) =>
      (s.run ?? "").includes("advance-latest-tag.ts"),
    );
    const redeployIdx = steps.findIndex((s) => s.name === redeployStepName);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(redeployIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(redeployIdx);
  });

  it("only advances images that actually built (same intersection as redeploy)", () => {
    // `steps.changed.outputs.images` is derived from the SAME matrix ∩
    // build-success intersection as `…outputs.services`. Sourcing the tag
    // move from anything wider would let a FAILED build move `:latest`.
    const compute = stepsOf(jobId).find((s) => s.id === "changed");
    expect(compute, `job '${jobId}' must have a 'changed' step`).toBeDefined();
    expect(compute?.run ?? "").toContain('images=$images" >> "$GITHUB_OUTPUT');
  });

  it("skips cleanly when nothing built", () => {
    expect(guardStep(jobId).if).toBe("steps.changed.outputs.images != ''");
  });
});

describe("showcase_build.yml — concurrency", () => {
  it("still has NO concurrency group", () => {
    // Deliberate. `detect-changes` builds a per-push, path-filtered matrix,
    // so concurrent runs build overlapping but NON-IDENTICAL service sets —
    // in the 2026-07-26 incident, run 30190815370 was the only one building
    // ag2/agno/langroid/spring-ai/strands and 10 others. Cancelling it would
    // mean those services never ship. The race is fixed at the tag, not by
    // serializing the fleet.
    expect(readWorkflow().concurrency).toBeUndefined();
  });
});
