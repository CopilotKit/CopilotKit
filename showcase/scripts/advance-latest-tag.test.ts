import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  advanceLatestTag,
  advanceLatestTags,
  annotation,
  classifyProbeFailure,
  decideLatestTagAction,
  escapeAnnotationData,
  extractRevisionLabel,
  isDirectInvocation,
  parseCompareStatus,
  parseImageList,
  readFlag,
} from "./advance-latest-tag";
import type { CompareStatus, GuardIo } from "./advance-latest-tag";
import {
  allServiceSlots,
  allStarterSlots,
  allSteps,
  jobOf,
  readWorkflow,
  stepById,
  stepsOf,
} from "./__tests__/showcase-build-workflow";
import type { WorkflowStep } from "./__tests__/showcase-build-workflow";

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
// This suite pins BOTH halves of the fix. The bar it holds itself to is
// CAPABILITY, not shape: an earlier revision of this file was 37/37 green
// against a workflow that could not have run at all — the guard step had no
// registry write permission and no GHCR login, so every retag would have
// 401'd. Asserting "the step exists" proves nothing about whether it can
// succeed. So, concretely:
//
//   1. The decision logic, through the injectable IO seam.
//   2. The LIVE workflow's ability to RUN that logic — the registry-auth
//      precondition (`packages: write` + a GHCR login step), the tag the build
//      pushes, the label the guard reads back, and the ordering against the
//      Railway redeploy.
//   3. The real shell that computes which images may move, EXECUTED against
//      the real service matrix — not a restatement of its jq.
//   4. The real `docker buildx imagetools inspect` payload shape, captured
//      from live registries, so the parser is pinned to output that actually
//      exists rather than to a hand-written guess. `readLatestRevision`
//      converts every read failure to `null`, and `null` ADVANCES, so a
//      parser that silently never matches yields a permanently-blind guard
//      with a fully green suite.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, "advance-latest-tag.ts");
const IMAGETOOLS_FIXTURES = join(HERE, "__tests__", "fixtures", "imagetools");

/** The single step in `jobId` that invokes a build-push action. */
function buildPushStep(jobId: string): WorkflowStep {
  const matches = stepsOf(jobId).filter((s) =>
    /(?:^|\/)(?:depot|docker)\/build-push-action@/.test(s.uses ?? ""),
  );
  expect(
    matches,
    `expected exactly one build-push-action step in '${jobId}'`,
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

  it("is a no-op only when :latest is this commit AND the same manifest digest", () => {
    const decision = decideLatestTagAction({
      sha: SHA,
      currentRevision: SHA,
      compareStatus: null,
      latestIsSameImage: true,
    });
    expect(decision.action).toBe("already-current");
  });

  it("advances when :latest is labelled this commit but is a DIFFERENT image", () => {
    // The revision label names a COMMIT, not an image. A base-image CVE
    // refresh / cache-miss / retried build republishes `:<sha>` at a new
    // digest while `:latest` still points at the old one. Treating that as
    // "already current" strands staging on the superseded build while
    // digest-pinned prod moves on.
    const decision = decideLatestTagAction({
      sha: SHA,
      currentRevision: SHA,
      compareStatus: null,
      latestIsSameImage: false,
    });
    expect(decision.action).toBe("advance");
    expect(decision.reason).toContain("DIFFERENT manifest digest");
  });

  it("advances when the digests could not be compared at all", () => {
    // Unknown ⇒ advance, same as everywhere else: assuming the two match
    // would silently skip a retag we cannot prove is unnecessary.
    for (const latestIsSameImage of [null, undefined]) {
      const decision = decideLatestTagAction({
        sha: SHA,
        currentRevision: SHA,
        compareStatus: null,
        latestIsSameImage,
      });
      expect(decision.action).toBe("advance");
    }
  });

  // Every unknown must ADVANCE. A guard that fails closed would strand
  // staging on an old image — the exact failure it exists to prevent.
  it.each<[string, string | null, CompareStatus | null]>([
    ["no :latest tag yet (first build)", null, null],
    ["compare API unreachable", OLDER, null],
    ["diverged history", OLDER, "diverged"],
    ["identical trees under different shas", OLDER, "identical"],
    // NOT a reachable pipeline state — advanceLatestTag never calls compare()
    // when the revision is unknown, so (null, <status>) cannot arise from the
    // real flow (pinned by "never consults compare when the revision is
    // unknown" below). Kept as a defensive input-space row: the unknown
    // revision must dominate regardless of what is passed alongside it.
    [
      "unknown revision, with a compare status that cannot occur",
      null,
      "ahead",
    ],
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
  const DIGEST_A =
    "sha256:c617d4681a8f92f23150b17e7c6e2fbf10230e2893d31ab9c14ed6c8e602d656";
  const DIGEST_B =
    "sha256:df4cae8f3a96d175e2e5f992e597550000edbe78fdc2594d5cd8de1a217f504c";

  /**
   * @param digests  ref (`latest` / a sha) → manifest digest, or absent for
   *                 "could not be read".
   */
  function fakeIo(
    overrides: Partial<GuardIo> = {},
    digests: Record<string, string> = {},
  ) {
    const retags: Array<{ image: string; sha: string }> = [];
    const logs: string[] = [];
    const digestReads: Array<{ image: string; ref: string }> = [];
    const base: GuardIo = {
      readLatestRevision: () => null,
      readDigest: (_image, ref) => digests[ref] ?? null,
      compare: () => null,
      retagLatest: (image, sha) => void retags.push({ image, sha }),
      log: (m) => void logs.push(m),
      ...overrides,
    };
    // Wrap AFTER the spread so the call recorder survives an override.
    const io: GuardIo = {
      ...base,
      readDigest: (image, ref) => {
        digestReads.push({ image, ref });
        return base.readDigest(image, ref);
      },
    };
    return { io, retags, logs, digestReads };
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

  it("skips compare and retag when :latest is already this exact image", () => {
    let compareCalls = 0;
    const { io, retags, digestReads } = fakeIo(
      {
        readLatestRevision: () => NEWER,
        compare: () => {
          compareCalls += 1;
          return "identical";
        },
      },
      { latest: DIGEST_A, [NEWER]: DIGEST_A },
    );
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(compareCalls).toBe(0);
    expect(retags).toEqual([]);
    // Both sides of the identity must actually be read — comparing `:latest`
    // against itself would make the check vacuously true.
    expect(digestReads).toEqual([
      { image: IMAGE, ref: "latest" },
      { image: IMAGE, ref: NEWER },
    ]);
  });

  it("RETAGS when :latest carries our label but an older DIGEST (same commit rebuilt)", () => {
    const { io, retags } = fakeIo(
      { readLatestRevision: () => NEWER },
      { latest: DIGEST_A, [NEWER]: DIGEST_B },
    );
    const decision = advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(decision.action).toBe("advance");
    expect(retags).toEqual([{ image: IMAGE, sha: NEWER }]);
  });

  it("retags when the digest read fails on either side", () => {
    const cases: Array<Record<string, string>> = [
      {}, // neither readable
      { latest: DIGEST_A }, // `:<sha>` unreadable
      { [NEWER]: DIGEST_A }, // `:latest` unreadable
    ];
    for (const digests of cases) {
      const { io, retags } = fakeIo(
        { readLatestRevision: () => NEWER },
        digests,
      );
      advanceLatestTag(
        { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
        io,
      );
      expect(retags).toEqual([{ image: IMAGE, sha: NEWER }]);
    }
  });

  it("does NOT pay for digest reads on the common path", () => {
    // The digest probe is two extra registry round-trips per image, ~28 images
    // per run. It must fire only on the one branch where the label can lie.
    const { io, digestReads } = fakeIo({
      readLatestRevision: () => OLDER,
      compare: () => "ahead",
    });
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(digestReads).toEqual([]);
  });

  it("never consults compare when the revision is unknown", () => {
    let compareCalls = 0;
    const { io, retags } = fakeIo({
      readLatestRevision: () => null,
      compare: () => {
        compareCalls += 1;
        return "behind";
      },
    });
    advanceLatestTag(
      { image: IMAGE, sha: NEWER, repo: "copilotkit/copilotkit" },
      io,
    );
    // Were compare consulted here it would have returned "behind" and
    // suppressed a retag that must happen.
    expect(compareCalls).toBe(0);
    expect(retags).toEqual([{ image: IMAGE, sha: NEWER }]);
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

// ---------------------------------------------------------------------------
// extractRevisionLabel, pinned to REAL registry output.
//
// Both fixtures are verbatim stdout of
//   docker buildx imagetools inspect <ref> --format '{{json .Image}}'
// (buildx v0.35.0), captured 2026-07-26 and deliberately NOT reformatted — a
// re-serialising pass would reorder keys and destroy the very ordering the
// walker has to be insensitive to. They are exempted from oxfmt in
// `.oxfmtrc.json` for that reason; re-capture with the command above rather
// than hand-editing, and do not "tidy" them:
//
//   multiarch-labelled.image.json
//     ghcr.io/astral-sh/uv:latest  @sha256:df4cae8f3a96…
//     Platform-keyed (linux/amd64 + linux/arm64), label present at
//     <platform>.config.Labels["org.opencontainers.image.revision"].
//
//   single-platform-unlabelled.image.json
//     ghcr.io/copilotkit/showcase-shell:latest  @sha256:c617d4681a8f…
//     Our own image. A BARE config object (no platform keys) even though its
//     manifest is an OCI image index — and `config.Labels` is null, because
//     nothing stamped the revision label before this PR.
// ---------------------------------------------------------------------------

describe("extractRevisionLabel (against real imagetools output)", () => {
  const SHA = "db75a04837fc488c67fdcd2f25f7bb682e9471a8";

  const MULTIARCH = readFileSync(
    join(IMAGETOOLS_FIXTURES, "multiarch-labelled.image.json"),
    "utf8",
  );
  const SINGLE = readFileSync(
    join(IMAGETOOLS_FIXTURES, "single-platform-unlabelled.image.json"),
    "utf8",
  );
  /** The revision ghcr.io/astral-sh/uv:latest actually carried when captured. */
  const MULTIARCH_REVISION = "3010295ae7ff572de459987ad70db315a62ecd61";

  /**
   * The label key the workflow's build step actually stamps, read out of the
   * live YAML rather than restated here. If someone renames the label in the
   * workflow, the injection test below stops finding it and fails — which is
   * the whole point: parser and producer must agree.
   */
  function stampedLabelKey(jobId: string): string {
    const labels = String(buildPushStep(jobId).with?.labels ?? "");
    const line = labels
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /=\$\{\{\s*github\.sha\s*\}\}$/.test(l));
    expect(
      line,
      `job '${jobId}' must stamp a <label>=\${{ github.sha }} label`,
    ).toBeDefined();
    return String(line).split("=")[0];
  }

  it("the multi-arch fixture really is platform-keyed real output", () => {
    // Guards the fixture itself: a future re-capture that lands a different
    // shape must not quietly weaken the test below into a tautology.
    const parsed = JSON.parse(MULTIARCH) as Record<
      string,
      { config?: { Labels?: Record<string, string> } }
    >;
    expect(Object.keys(parsed).sort()).toEqual(["linux/amd64", "linux/arm64"]);
    for (const platform of Object.keys(parsed)) {
      expect(
        parsed[platform].config?.Labels?.["org.opencontainers.image.revision"],
      ).toBe(MULTIARCH_REVISION);
    }
  });

  it("reads the revision from a real multi-platform payload", () => {
    expect(extractRevisionLabel(MULTIARCH)).toBe(MULTIARCH_REVISION);
  });

  it("returns null when platforms disagree about the revision", () => {
    const parsed = JSON.parse(MULTIARCH) as Record<
      string,
      { config: { Labels: Record<string, string> } }
    >;
    parsed["linux/arm64"].config.Labels["org.opencontainers.image.revision"] =
      SHA;
    // Two answers is no answer — and "no answer" advances, which is safe.
    expect(extractRevisionLabel(JSON.stringify(parsed))).toBeNull();
  });

  it("our own :latest is a bare config object that carries NO revision label", () => {
    const parsed = JSON.parse(SINGLE) as {
      config?: { Labels?: unknown };
    } & Record<string, unknown>;
    // Not platform-keyed, despite the manifest being an OCI image index.
    expect(parsed.config).toBeDefined();
    expect(Object.keys(parsed)).not.toContain("linux/amd64");
    expect(parsed.config?.Labels ?? null).toBeNull();
    // So until the build step's `labels:` input ships, the guard reads null
    // for every showcase image and advances unconditionally. That is the
    // documented fail-open, not a parser bug — and it is why the label
    // assertion on the build step is load-bearing rather than cosmetic.
    expect(extractRevisionLabel(SINGLE)).toBeNull();
  });

  it.each([["build"], ["build-starters"]])(
    "finds the label %s stamps, injected at the real path in real output",
    (jobId) => {
      // The join between fixture and production: take the REAL payload for one
      // of our own images, add the label under the REAL key the REAL workflow
      // step stamps, at the path buildkit actually writes it, and require the
      // parser to find it. Nothing here is hand-shaped except the sha.
      const parsed = JSON.parse(SINGLE) as {
        config: { Labels: Record<string, string> | null };
      };
      parsed.config.Labels = { [stampedLabelKey(jobId)]: SHA };
      expect(extractRevisionLabel(JSON.stringify(parsed))).toBe(SHA);
    },
  );

  it("returns null when the label is absent, blank, or the JSON is junk", () => {
    const parsed = JSON.parse(SINGLE) as {
      config: { Labels: Record<string, string> | null };
    };
    parsed.config.Labels = { "org.opencontainers.image.revision": "  " };
    expect(extractRevisionLabel(JSON.stringify(parsed))).toBeNull();
    expect(
      extractRevisionLabel(JSON.stringify({ config: { Labels: {} } })),
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

// ---------------------------------------------------------------------------
// Failure classification. Fail-open is the behaviour; being unable to say WHY
// is the bug this closes — a throttled read that reads as "absent" is
// indistinguishable from a clean first build, and throttling is the likeliest
// failure under exactly the concurrency this guard exists to handle.
// ---------------------------------------------------------------------------

describe("classifyProbeFailure", () => {
  it("classifies a REAL subprocess timeout", () => {
    // Not a hand-built error object: provoke the actual execFileSync timeout
    // path so the `killed` / `signal` shape is whatever Node really sets.
    let thrown: unknown;
    try {
      execFileSync("sleep", ["5"], { timeout: 50, stdio: "ignore" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "expected the 50ms timeout to kill `sleep 5`").toBeDefined();
    expect(classifyProbeFailure(thrown).kind).toBe("timeout");
  });

  it.each<[string, string]>([
    // Verbatim from `docker buildx imagetools inspect ghcr.io/cli/cli:latest`.
    ["absent", "ERROR: ghcr.io/cli/cli:latest: not found"],
    ["absent", "unexpected status from HEAD request: 404 Not Found"],
    ["absent", "ghcr.io/copilotkit/x:latest: manifest unknown"],
    ["unauthorized", "unexpected status from GET request: 401 Unauthorized"],
    // What GHCR returns when the job lacks `packages: write` — i.e. the exact
    // Critical this suite previously failed to catch.
    [
      "unauthorized",
      "denied: installation not allowed to Write organization package",
    ],
    ["throttled", "toomanyrequests: retry-after 42s"],
    ["unavailable", "dial tcp 140.82.121.34:443: connect: connection refused"],
    ["unavailable", 'Get "https://ghcr.io/v2/": EOF: 503 Service Unavailable'],
    ["unknown", "the registry did something inexplicable"],
  ])("classifies %s", (kind, stderr) => {
    expect(classifyProbeFailure({ stderr }).kind).toBe(kind);
  });

  it("calls a rate-limited 403 THROTTLED, not unauthorized", () => {
    // `gh api` reports rate limiting as HTTP 403, so an auth-first classifier
    // blames credentials for what is really load — and the operator goes
    // looking for a broken token during an incident caused by concurrency.
    const failure = classifyProbeFailure({
      stderr:
        "gh: API rate limit exceeded for installation ID 12345. (HTTP 403)",
    });
    expect(failure.kind).toBe("throttled");
  });

  it("calls a 404-that-is-really-a-permission-error UNAUTHORIZED", () => {
    // Registries answer 404 to hide packages you may not read. Reading that
    // as "absent" is the silent-first-build misdiagnosis: no warning is
    // emitted, and the guard looks like it is working.
    const failure = classifyProbeFailure({
      stderr: "ghcr.io/copilotkit/showcase-shell:latest: 404 not found: denied",
    });
    expect(failure.kind).toBe("unauthorized");
  });

  it("keeps a diagnostic detail on one line and bounded", () => {
    const failure = classifyProbeFailure({
      stderr: `unauthorized\n${"x".repeat(5000)}`,
    });
    expect(failure.detail).not.toContain("\n");
    expect(failure.detail.length).toBeLessThanOrEqual(501);
  });
});

// ---------------------------------------------------------------------------
// Workflow-command encoding.
// ---------------------------------------------------------------------------

describe("escapeAnnotationData", () => {
  it("encodes the characters that terminate or forge a workflow command", () => {
    expect(escapeAnnotationData("a\nb")).toBe("a%0Ab");
    expect(escapeAnnotationData("a\r\nb")).toBe("a%0D%0Ab");
    expect(escapeAnnotationData("100%")).toBe("100%25");
  });

  it("escapes % first so an already-encoded sequence is not mangled", () => {
    // "%0A" must round-trip as literal text, not decode back into a newline.
    expect(escapeAnnotationData("%0A")).toBe("%250A");
  });

  it("makes subprocess output unable to forge a workflow command", () => {
    // Registry stderr echoes refs back at us, so it is attacker-adjacent. A
    // command must START a line; if the payload cannot introduce a newline it
    // cannot introduce a command.
    const hostile = "denied\n::error::forged\n::set-output name=x::y";
    const line = annotation("warning", "Could not read x:latest", hostile);
    expect(line).not.toContain("\n");
    expect(line.split("::").length).toBeGreaterThan(1); // has its own prefix
    expect(line.startsWith("::warning ")).toBe(true);
    // The forged commands survive only as inert escaped text.
    expect(line).toContain("%0A::error::forged");
  });

  it("escapes : and , in property values but not in the message", () => {
    const line = annotation("error", "a:b,c", "d:e,f");
    expect(line).toContain("title=a%3Ab%2Cc");
    expect(line).toContain("::d:e,f");
  });
});

// ---------------------------------------------------------------------------
// CLI argument parsing.
// ---------------------------------------------------------------------------

describe("readFlag", () => {
  it("distinguishes absent, valueless, and empty-valued flags", () => {
    expect(readFlag([], "--sha")).toEqual({ kind: "absent" });
    expect(readFlag(["--repo", "o/n"], "--sha")).toEqual({ kind: "absent" });
    expect(readFlag(["--sha"], "--sha")).toEqual({ kind: "no-value" });
    // An empty --images is the documented no-op, NOT a usage error, so it must
    // not collapse into "absent" (which falls back to $IMAGES instead).
    expect(readFlag(["--images="], "--images")).toEqual({
      kind: "value",
      value: "",
    });
  });

  it("reads both `--flag value` and `--flag=value`", () => {
    expect(readFlag(["--sha", "abc"], "--sha")).toEqual({
      kind: "value",
      value: "abc",
    });
    expect(readFlag(["--sha=abc"], "--sha")).toEqual({
      kind: "value",
      value: "abc",
    });
    expect(readFlag(["--images=a,b=c"], "--images")).toEqual({
      kind: "value",
      value: "a,b=c",
    });
  });

  it("does NOT swallow the next flag as a value", () => {
    // `--sha --repo owner/name` used to yield the literal string "--repo" as
    // the commit sha, and the guard went on to retag against `:--repo`.
    expect(readFlag(["--sha", "--repo", "o/n"], "--sha")).toEqual({
      kind: "no-value",
    });
    expect(readFlag(["--sha", "--repo", "o/n"], "--repo")).toEqual({
      kind: "value",
      value: "o/n",
    });
  });
});

// ---------------------------------------------------------------------------
// Entrypoint detection.
// ---------------------------------------------------------------------------

describe("isDirectInvocation", () => {
  const MODULE_URL = pathToFileURL(SCRIPT_PATH).href;

  it("is false when there is no entry path", () => {
    expect(isDirectInvocation(undefined, MODULE_URL)).toBe(false);
  });

  it("is true for the module's own path and false for another file", () => {
    expect(isDirectInvocation(SCRIPT_PATH, MODULE_URL)).toBe(true);
    expect(
      isDirectInvocation(join(HERE, "advance-latest-tag.test.ts"), MODULE_URL),
    ).toBe(false);
  });

  it("is true through a SYMLINK to the script", () => {
    // The real bug: Node resolves import.meta.url through symlinks but leaves
    // process.argv[1] as typed, so an unequal comparison meant `main()` never
    // ran and the process exited 0 having done nothing — a false green in the
    // most expensive possible place.
    const dir = mkdtempSync(join(tmpdir(), "cpk-symlink-"));
    try {
      const link = join(dir, "guard-link.ts");
      symlinkSync(SCRIPT_PATH, link);
      expect(isDirectInvocation(link, MODULE_URL)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("advanceLatestTags (fleet)", () => {
  const SHA = "db75a04837fc488c67fdcd2f25f7bb682e9471a8";

  function fleetIo(overrides: Partial<GuardIo> = {}) {
    const logs: string[] = [];
    const io: GuardIo = {
      readLatestRevision: () => null,
      readDigest: () => null,
      compare: () => null,
      retagLatest: () => {},
      log: (m) => void logs.push(m),
      ...overrides,
    };
    return { io, logs };
  }

  it("attempts every image even when one throws, and reports the failures", () => {
    // One broken repo must not mask the rest of the fleet.
    const attempted: string[] = [];
    const { io } = fleetIo({
      readLatestRevision: (image) => {
        attempted.push(image);
        return null;
      },
      retagLatest: (image) => {
        if (image === "b") throw new Error("denied");
      },
    });
    const { failures, advanced } = advanceLatestTags(
      { images: ["a", "b", "c"], sha: SHA, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(attempted).toEqual(["a", "b", "c"]);
    expect(failures.map((f) => f.image)).toEqual(["b"]);
    // The survivors must still be named, so an operator can tell one bad repo
    // from a fleet-wide auth outage.
    expect(advanced).toEqual(["a", "c"]);
  });

  it("raises an ::error annotation — not a warning — when an image FAILS", () => {
    // A declined advance is a warning (standing down is correct). A failed
    // retag means `:latest` did not move and the redeploy would ship stale
    // code, so it has to surface on the run itself.
    const { io, logs } = fleetIo({
      retagLatest: () => {
        throw Object.assign(new Error("Command failed"), {
          stderr:
            "denied: installation not allowed to Write organization package",
        });
      },
    });
    const { failures } = advanceLatestTags(
      { images: ["ghcr.io/copilotkit/showcase-shell"], sha: SHA, repo: "o/n" },
      io,
    );
    expect(failures).toHaveLength(1);
    const errors = logs.filter((l) => l.startsWith("::error "));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ghcr.io/copilotkit/showcase-shell");
    // Classified, so the annotation says WHAT went wrong, not just THAT it did.
    expect(errors[0]).toContain("[unauthorized]");
  });

  it("partitions a mixed fleet into advanced / unchanged / declined", () => {
    const CURRENT = "0000000000000000000000000000000000000000";
    const { io } = fleetIo({
      readLatestRevision: (image) =>
        image === "same" ? SHA : image === "newer" ? CURRENT : null,
      readDigest: () => "sha256:deadbeef",
      compare: () => "behind",
    });
    const result = advanceLatestTags(
      {
        images: ["fresh", "same", "newer"],
        sha: SHA,
        repo: "copilotkit/copilotkit",
      },
      io,
    );
    expect(result.advanced).toEqual(["fresh"]);
    expect(result.unchanged).toEqual(["same"]);
    expect(result.declined).toEqual(["newer"]);
    expect(result.failures).toEqual([]);
  });

  it("reports no failures when every image advances", () => {
    const { io } = fleetIo();
    const { failures } = advanceLatestTags(
      { images: ["a", "b"], sha: SHA, repo: "copilotkit/copilotkit" },
      io,
    );
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LIVE workflow wiring. These read the real YAML, so they fail if someone
// re-adds `:latest` to a push step or drops the guard.
// ---------------------------------------------------------------------------

describe.each([
  ["build", "matrix.service.image"],
  ["build-starters", "matrix.starter.image"],
])("showcase_build.yml — %s job", (jobId, imageExpr) => {
  it("pushes exactly one tag, the immutable per-commit one", () => {
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

describe("showcase_build.yml — nothing but the guard may write :latest", () => {
  it("no push step anywhere declares a :latest tag", () => {
    // Previously scoped to one step's `tags` input, and vacuous on an empty
    // one: `tags: ""` produced an empty list and the ban loop never ran.
    const tagged = allSteps().filter(
      ({ step }) => step.with?.tags !== undefined,
    );
    expect(
      tagged.length,
      "expected at least the showcase and starter build-push steps",
    ).toBeGreaterThanOrEqual(2);
    for (const { jobId, step } of tagged) {
      const tags = tagsOf(step);
      expect(
        tags.length,
        `job '${jobId}' declares an EMPTY tags list — the :latest ban below would be vacuous`,
      ).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(
          tag.endsWith(":latest"),
          `job '${jobId}' must not push '${tag}'`,
        ).toBe(false);
      }
    }
  });

  it("no shell step hand-rolls a :latest push, tag or retag", () => {
    // The other push surfaces: `docker push`, `docker tag`, and a second
    // `imagetools create`. Only the guard script may move the pointer.
    for (const { jobId, step } of allSteps()) {
      const run = step.run ?? "";
      if (run.includes("advance-latest-tag.ts")) continue;
      for (const pattern of [
        /docker\s+(?:image\s+)?push\b[^\n]*:latest/,
        /docker\s+tag\b[^\n]*:latest/,
        /imagetools\s+create\b[^\n]*:latest/,
      ]) {
        expect(
          pattern.test(run),
          `job '${jobId}' moves :latest outside the guard (matched ${pattern})`,
        ).toBe(false);
      }
    }
  });
});

// The guard lives in the redeploy jobs, not the build matrix: those already
// have Node, and running there puts the decision immediately before the
// Railway pull that actually consumes `:latest`.
describe.each([
  ["redeploy-staging", "Redeploy changed services in staging"],
  ["redeploy-staging-starters", "Redeploy changed starters in staging"],
])("showcase_build.yml — %s job", (jobId, redeployStepName) => {
  it("CAN authenticate the GHCR write the retag performs", () => {
    // The assertion this suite was missing. `imagetools create` is a registry
    // manifest PUT: without `packages: write` AND a docker login it 401s on
    // every image, the guard exits 1, the redeploy never runs, and — since the
    // build step no longer pushes `:latest` — the tag freezes permanently.
    // Every other test in this file passed against exactly that workflow.
    const job = jobOf(jobId);
    expect(
      job.permissions,
      `job '${jobId}' must declare explicit permissions`,
    ).toBeTypeOf("object");
    expect((job.permissions as Record<string, string>).packages).toBe("write");

    const logins = stepsOf(jobId).filter(
      (s) =>
        /(?:^|\/)docker\/login-action@/.test(s.uses ?? "") &&
        s.with?.registry === "ghcr.io",
    );
    expect(
      logins,
      `job '${jobId}' must log in to ghcr.io before the guard retags`,
    ).toHaveLength(1);
    expect(logins[0].with?.password).toBeTruthy();

    // And the login has to happen BEFORE the guard, or it buys nothing.
    const steps = stepsOf(jobId);
    expect(steps.indexOf(logins[0])).toBeLessThan(
      steps.indexOf(guardStep(jobId)),
    );
  });

  it("gives the guard the image list and a compare token", () => {
    const step = guardStep(jobId);
    expect(step.env?.IMAGES).toBe("${{ steps.changed.outputs.images }}");
    // gh api needs a token; without it compare() fails open and the guard
    // degrades to the old unconditional behaviour. GITHUB_SHA and
    // GITHUB_REPOSITORY are deliberately NOT asserted (nor declared): the
    // runner exports both as defaults and the script reads them off
    // process.env, so restating them in the workflow was shadowing, and
    // asserting the shadow pinned a redundancy rather than a capability.
    expect(step.env?.GH_TOKEN).toBeTruthy();
  });

  it("advances :latest BEFORE the Railway redeploy pulls it", () => {
    // Ordering is the entire safety argument. Redeploying first would pull
    // the old `:latest` and report a fresh, healthy deploy of stale code.
    const steps = stepsOf(jobId);
    const guardIdx = steps.indexOf(guardStep(jobId));
    const redeployIdx = steps.findIndex((s) => s.name === redeployStepName);
    expect(redeployIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(redeployIdx);
  });

  it("gates guard and redeploy on the SAME `changed` step", () => {
    // The tag set and the deploy set must come from one computation. Two
    // sources could disagree, and a `:latest` moved for something that is not
    // redeployed (or vice versa) is exactly the stale-vs-shipped skew this
    // whole change exists to prevent.
    expect(guardStep(jobId).if).toBe("steps.changed.outputs.images != ''");
    const redeploy = stepsOf(jobId).find((s) => s.name === redeployStepName);
    expect(redeploy?.if).toBe("steps.changed.outputs.services != ''");
    // Both outputs must be produced by that one step.
    const changed = stepById(jobId, "changed").run ?? "";
    expect(changed).toContain("services=");
    expect(changed).toContain("images=");
  });
});

// ---------------------------------------------------------------------------
// The intersection, EXECUTED.
//
// The previous version of this only asserted that the string `images=` appears
// in the compute step. Replacing its jq with `$m` (the whole matrix, ignoring
// the build-success set) left that assertion green while letting a FAILED
// build move `:latest`. So run the real shell against the real matrix and read
// what it actually emits.
// ---------------------------------------------------------------------------

/** Execute a job's `changed` step for real and parse its $GITHUB_OUTPUT. */
function runChangedStep(
  jobId: string,
  env: Record<string, string>,
  seedResultsDir?: (dir: string) => void,
): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "cpk-changed-"));
  try {
    const script = join(dir, "changed.sh");
    writeFileSync(script, stepById(jobId, "changed").run ?? "");
    const outFile = join(dir, "github_output");
    writeFileSync(outFile, "");
    const resultsDir = join(dir, "results");
    mkdirSync(resultsDir, { recursive: true });
    seedResultsDir?.(resultsDir);

    execFileSync("bash", [script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: {
        ...process.env,
        ...env,
        RESULTS_DIR: resultsDir,
        GITHUB_OUTPUT: outFile,
      },
    });

    const out: Record<string, string> = {};
    for (const line of readFileSync(outFile, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const csv = (v: string | undefined): string[] =>
  (v ?? "").split(",").filter((s) => s !== "");

describe("redeploy-staging — which images may actually move :latest", () => {
  const slots = allServiceSlots();
  const skipBuild = slots.filter((s) => s.skip_build === true);
  const normal = slots.filter((s) => s.skip_build !== true);

  it("the live matrix still has a skip_build slot to exclude", () => {
    // If this ever becomes empty the exclusion test below goes vacuous, and
    // we would rather be told than quietly stop testing it.
    expect(skipBuild.length).toBeGreaterThan(0);
    expect(normal.length).toBeGreaterThanOrEqual(3);
  });

  const [built, failed, alsoBuilt] = normal;
  const skipped = skipBuild[0];

  const outputs = () =>
    runChangedStep("redeploy-staging", {
      MATRIX_JSON: JSON.stringify([built, failed, alsoBuilt, skipped]),
      BUILD_RESULTS_JSON: JSON.stringify([
        { service: built.dispatch_name, status: "success" },
        { service: failed.dispatch_name, status: "failure" },
        { service: alsoBuilt.dispatch_name, status: "success" },
        // A skip_build slot's build step is skipped but the SLOT still
        // concludes success, so it lands in the success set like any other.
        { service: skipped.dispatch_name, status: "success" },
      ]),
    });

  it("a FAILED build is in neither the redeploy set nor the tag set", () => {
    const out = outputs();
    expect(csv(out.services)).not.toContain(failed.dispatch_name);
    expect(csv(out.images)).not.toContain(`ghcr.io/copilotkit/${failed.image}`);
    // …while the two that built are in both.
    expect(csv(out.services)).toEqual(
      expect.arrayContaining([built.dispatch_name, alsoBuilt.dispatch_name]),
    );
    expect(csv(out.images)).toEqual([
      `ghcr.io/copilotkit/${built.image}`,
      `ghcr.io/copilotkit/${alsoBuilt.image}`,
    ]);
  });

  it("a skip_build slot IS redeployed but must NOT have its :latest moved", () => {
    // `webhooks` is built and released by its own repo, so this run pushed no
    // `:<sha>` for it. Handing it to the guard makes `imagetools create` fail
    // with "manifest unknown", the guard exits non-zero, and the redeploy is
    // blocked for the ENTIRE fleet. It must stay in `services` though —
    // bouncing it so Railway re-pulls its out-of-band `:latest` is intended.
    const out = outputs();
    expect(csv(out.services)).toContain(skipped.dispatch_name);
    expect(csv(out.images)).not.toContain(
      `ghcr.io/copilotkit/${skipped.image}`,
    );
  });

  it("every image the guard may move maps back to a redeployed service", () => {
    const out = outputs();
    const services = new Set(csv(out.services));
    const byImage = new Map(slots.map((s) => [s.image, s.dispatch_name]));
    for (const ref of csv(out.images)) {
      expect(ref.startsWith("ghcr.io/copilotkit/")).toBe(true);
      const dispatchName = byImage.get(ref.replace("ghcr.io/copilotkit/", ""));
      expect(dispatchName, `unknown image ref ${ref}`).toBeDefined();
      expect(services.has(String(dispatchName))).toBe(true);
    }
  });
});

describe("redeploy-staging-starters — which images may actually move :latest", () => {
  const starters = allStarterSlots();
  const [built, failed, alsoBuilt] = starters;

  const outputs = () =>
    runChangedStep(
      "redeploy-staging-starters",
      {
        MATRIX_JSON: JSON.stringify([built, failed, alsoBuilt]),
        BUILD_STARTERS_RESULT: "failure",
      },
      (dir) => {
        for (const [slot, status] of [
          [built, "success"],
          [failed, "failure"],
          [alsoBuilt, "success"],
        ] as const) {
          const slotDir = join(dir, `starter-build-result-${slot.slug}`);
          mkdirSync(slotDir, { recursive: true });
          writeFileSync(
            join(slotDir, "result.json"),
            JSON.stringify({ service: slot.slug, status }),
          );
        }
      },
    );

  it("a FAILED starter build is in neither the redeploy set nor the tag set", () => {
    const out = outputs();
    expect(csv(out.services)).toEqual([built.image, alsoBuilt.image]);
    expect(csv(out.images)).toEqual([
      `ghcr.io/copilotkit/${built.image}`,
      `ghcr.io/copilotkit/${alsoBuilt.image}`,
    ]);
    expect(csv(out.images)).not.toContain(`ghcr.io/copilotkit/${failed.image}`);
  });

  it("the starter image set is exactly the redeploy set, registry-qualified", () => {
    const out = outputs();
    expect(csv(out.images)).toEqual(
      csv(out.services).map((s) => `ghcr.io/copilotkit/${s}`),
    );
  });
});

describe("showcase_build.yml — concurrency", () => {
  it("declares NO concurrency group, at the workflow level OR on any job", () => {
    // Deliberate, and load-bearing. `detect-changes` builds a per-push,
    // path-filtered matrix, so concurrent runs build overlapping but
    // NON-IDENTICAL service sets — in the 2026-07-26 incident, run
    // 30190815370 was the only one building ag2/agno/langroid/spring-ai/
    // strands and 10 others. Cancelling it would mean those services never
    // ship. The race is fixed at the tag, not by serializing the fleet.
    //
    // Checking only the top level left the hole wide open: a job-level
    // `concurrency` + `cancel-in-progress` on `build` reproduces the exact
    // harm and used to keep this test green.
    const doc = readWorkflow();
    expect(doc.concurrency).toBeUndefined();
    const jobsWithConcurrency = Object.entries(doc.jobs)
      .filter(([, job]) => job.concurrency !== undefined)
      .map(([id]) => id);
    expect(jobsWithConcurrency).toEqual([]);
  });
});
