import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import {
  GIT_LOG_FORMAT,
  getChangesSummary,
  getLastReleaseTag,
  parseCommitLog,
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
      return {
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

    expect(getChangesSummary("channels")).toMatchObject({
      lastTag: "channels/v0.1.1",
      commitCount: 1,
    });
    expect(spawnSyncMock).toHaveBeenLastCalledWith(
      "git",
      [
        "log",
        "channels/v0.1.1..HEAD",
        "--no-merges",
        `--format=${GIT_LOG_FORMAT}`,
      ],
      expect.any(Object),
    );
  });

  it("preserves multiline commit bodies and trailers from real git history", async () => {
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
      git(["commit", "--quiet", "--allow-empty", "-m", "fix(core): baseline"]);
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
  });
});
