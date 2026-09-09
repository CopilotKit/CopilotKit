import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, it, vi } from "vitest";
import {
  GIT_LOG_FORMAT,
  getChangesSummary,
  getLastReleaseTag,
  isNoiseCommit,
  parseCommitLog,
  parsePrNumber,
  withBranchMessages,
} from "./changes.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawnSync: spawnSyncMock,
}));

function mockGitHistory(): void {
  spawnSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command !== "git") throw new Error(`unexpected command: ${command}`);

    if (args[0] === "tag") {
      return { stdout: "v1.62.3\nchannels/v0.1.1\n" };
    }

    if (args[0] === "log") {
      // withBranchMessages probes `<sha>^1..<sha>^2`; a non-merge makes that
      // range invalid, which git reports as a non-zero exit.
      if (args.some((arg) => arg.includes("^1.."))) {
        return { status: 1, stdout: "" };
      }

      return {
        status: 0,
        stdout:
          "abc1234\x1ffeat(channels): shared release\x1fRelease details\n\nBREAKING CHANGE: migrate the channel config\x1e\n",
      };
    }

    throw new Error(`unexpected git arguments: ${args.join(" ")}`);
  });
}

describe("Channels release history", () => {
  it("selects the Channels tag instead of the monorepo tag", () => {
    mockGitHistory();

    expect(getLastReleaseTag("channels")).toBe("channels/v0.1.1");
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "git",
      ["tag", "--list", "channels/v*", "--sort=-v:refname"],
      expect.any(Object),
    );
  });

  it("uses the Channels tag as the release-note commit boundary", () => {
    mockGitHistory();

    expect(
      getChangesSummary("channels", { pathspecs: ["packages/channels"] }),
    ).toMatchObject({
      lastTag: "channels/v0.1.1",
      commitCount: 1,
    });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "git",
      [
        "log",
        "channels/v0.1.1..HEAD",
        "--first-parent",
        `--format=${GIT_LOG_FORMAT}`,
        "--",
        "packages/channels",
      ],
      expect.any(Object),
    );
  });

  it(
    "preserves multiline commit bodies and trailers from real git history",
    { timeout: 30_000 },
    async () => {
      const actualChildProcess = await vi.importActual("child_process");
      const spawnSync = actualChildProcess.spawnSync as typeof spawnSyncMock;
      const repository = mkdtempSync(join(tmpdir(), "copilotkit-release-"));

      const git = (args: string[]) => {
        const result = spawnSync("git", args, {
          cwd: repository,
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };

      try {
        git(["init", "--quiet"]);
        git(["config", "user.name", "Release Test"]);
        git(["config", "user.email", "release-test@example.com"]);
        git([
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          "fix(core): baseline",
        ]);
        git([
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          "feat(runtime)!: replace the transport",
          "-m",
          "The transport now streams every response.\n\nBREAKING CHANGE: configure a streaming adapter before upgrading.\nKeep existing adapters until migration is complete.\n\nCo-authored-by: Release Test <release-test@example.com>",
        ]);

        const output = git([
          "log",
          "HEAD",
          "--no-merges",
          `--format=${GIT_LOG_FORMAT}`,
        ]);

        expect(parseCommitLog(output)).toEqual([
          expect.objectContaining({
            subject: "feat(runtime)!: replace the transport",
            body: "The transport now streams every response.\n\nBREAKING CHANGE: configure a streaming adapter before upgrading.\nKeep existing adapters until migration is complete.\n\nCo-authored-by: Release Test <release-test@example.com>",
          }),
          expect.objectContaining({
            subject: "fix(core): baseline",
            body: "",
          }),
        ]);
      } finally {
        rmSync(repository, { recursive: true, force: true });
      }
    },
  );
});

describe("Release-note commit selection", () => {
  it("extracts the PR number from a merge-commit subject", () => {
    expect(parsePrNumber("feat(angular): add registerComponent (#6773)")).toBe(
      6773,
    );
    expect(parsePrNumber("fix(core): a direct-to-main commit")).toBeNull();
  });

  it("treats test/ci/style and non-deps chore commits as noise", () => {
    expect(isNoiseCommit("test(angular): complete Core mock")).toBe(true);
    expect(isNoiseCommit("ci: retry flaky shard")).toBe(true);
    expect(isNoiseCommit("chore: sync plugin skills")).toBe(true);
    expect(isNoiseCommit("chore: release angular v0.5.0")).toBe(true);
  });

  it("keeps dependency bumps and real user-facing work", () => {
    expect(isNoiseCommit("chore(deps): bump @ag-ui/* to 0.0.59")).toBe(false);
    expect(isNoiseCommit("feat(angular): add registerComponent")).toBe(false);
    expect(isNoiseCommit("fix(angular): resolve HITL results")).toBe(false);
    expect(isNoiseCommit("perf(core): trim the hot path")).toBe(false);
  });

  it("walks first-parent and path-filters to the scope's packages", () => {
    mockGitHistory();

    getChangesSummary("channels", { pathspecs: ["packages/channels"] });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "git",
      [
        "log",
        "channels/v0.1.1..HEAD",
        "--first-parent",
        `--format=${GIT_LOG_FORMAT}`,
        "--",
        "packages/channels",
      ],
      expect.any(Object),
    );
  });

  it(
    "collapses a merged PR to one entry and drops the other scope's work",
    { timeout: 30_000 },
    async () => {
      const actualChildProcess = await vi.importActual("child_process");
      const spawnSync = actualChildProcess.spawnSync as typeof spawnSyncMock;
      const repository = mkdtempSync(join(tmpdir(), "copilotkit-firstparent-"));

      const git = (args: string[]) => {
        const result = spawnSync("git", args, {
          cwd: repository,
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };
      const write = (file: string, contents: string) => {
        mkdirSync(join(repository, dirname(file)), { recursive: true });
        writeFileSync(join(repository, file), contents);
      };

      try {
        git(["init", "--quiet", "--initial-branch=main"]);
        git(["config", "user.name", "Release Test"]);
        git(["config", "user.email", "release-test@example.com"]);

        write("packages/angular/a.ts", "base");
        git(["add", "-A"]);
        git(["commit", "--quiet", "-m", "chore: baseline"]);

        // A feature branch with two noisy intermediate commits, merged as a PR.
        git(["checkout", "--quiet", "-b", "feature"]);
        write("packages/angular/a.ts", "one");
        git(["add", "-A"]);
        git(["commit", "--quiet", "-m", "feat(angular): half of the feature"]);
        write("packages/angular/a.ts", "two");
        git(["add", "-A"]);
        git(["commit", "--quiet", "-m", "test(angular): cover the feature"]);
        git(["checkout", "--quiet", "main"]);
        git([
          "merge",
          "--quiet",
          "--no-ff",
          "feature",
          "-m",
          "feat(angular): add registerComponent (#6773)",
        ]);

        // Work in a package that belongs to a DIFFERENT release scope.
        write("packages/channels-core/b.ts", "other");
        git(["add", "-A"]);
        git(["commit", "--quiet", "-m", "feat(channels): unrelated lane"]);

        const output = git([
          "log",
          "HEAD",
          "--first-parent",
          `--format=${GIT_LOG_FORMAT}`,
          "--",
          "packages/angular",
        ]);

        const subjects = parseCommitLog(output)
          .filter((c) => !isNoiseCommit(c.subject))
          .map((c) => c.subject);

        // One entry for the whole PR — not its two branch commits — and nothing
        // from the channels scope.
        expect(subjects).toEqual([
          "feat(angular): add registerComponent (#6773)",
        ]);
        expect(parseCommitLog(output)[0].pr).toBe(6773);
      } finally {
        rmSync(repository, { recursive: true, force: true });
      }
    },
  );
});

describe("Breaking-change footers on branch commits", () => {
  it(
    "folds a merged PR's branch messages into the merge commit body",
    { timeout: 30_000 },
    async () => {
      const actualChildProcess = await vi.importActual("child_process");
      const spawnSync = actualChildProcess.spawnSync as typeof spawnSyncMock;
      const repository = mkdtempSync(join(tmpdir(), "copilotkit-branchbody-"));

      const git = (args: string[]) => {
        const result = spawnSync("git", args, {
          cwd: repository,
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };

      try {
        git(["init", "--quiet", "--initial-branch=main"]);
        git(["config", "user.name", "Release Test"]);
        git(["config", "user.email", "release-test@example.com"]);
        git(["commit", "--quiet", "--allow-empty", "-m", "chore: baseline"]);

        git(["checkout", "--quiet", "-b", "feature"]);
        git([
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          "refactor(core)!: drop the legacy registry",
          "-m",
          "BREAKING CHANGE: useLegacyRegistry is removed; use the shared one.",
        ]);
        git(["checkout", "--quiet", "main"]);
        // A merge message that says nothing about the break — the footer exists
        // only on the branch commit.
        git([
          "merge",
          "--quiet",
          "--no-ff",
          "feature",
          "-m",
          "refactor(core)!: converge the registry (#1234)",
        ]);

        const mergeSha = git(["rev-parse", "HEAD"]).trim();

        // withBranchMessages shells out with cwd: ROOT, so run it against a real
        // clone of this history rather than mocking the boundary away.
        spawnSyncMock.mockImplementation((command: string, args: string[]) =>
          spawnSync(command, args, { cwd: repository, encoding: "utf8" }),
        );

        const merge = {
          hash: mergeSha,
          subject: "refactor(core)!: converge the registry (#1234)",
          body: "",
          pr: 1234,
        };

        expect(withBranchMessages(merge).body).toContain(
          "BREAKING CHANGE: useLegacyRegistry is removed; use the shared one.",
        );

        // A non-merge commit makes `sha^1..sha^2` invalid; that must be a no-op,
        // not a throw.
        const baseline = {
          hash: git(["rev-parse", "HEAD^1"]).trim(),
          subject: "chore: baseline",
          body: "",
          pr: null,
        };
        expect(withBranchMessages(baseline)).toEqual(baseline);
      } finally {
        rmSync(repository, { recursive: true, force: true });
      }
    },
  );
});
