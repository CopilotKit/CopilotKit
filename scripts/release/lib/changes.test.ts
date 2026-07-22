import { describe, expect, it, vi } from "vitest";
import { getChangesSummary, getLastReleaseTag } from "./changes.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawnSync: spawnSyncMock,
}));

function mockGitHistory(): void {
  spawnSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command !== "git") throw new Error(`unexpected command: ${command}`);

    if (args[0] === "tag") {
      return {
        stdout: "v1.62.3\nchannels/v0.1.1\nintelligence-langgraph/v0.1.0\n",
      };
    }

    if (args[0] === "log") {
      return { stdout: "abc1234 feat(channels): shared release\n" };
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
        "--oneline",
        "--no-merges",
        "--format=%H %s",
      ],
      expect.any(Object),
    );
  });
});

describe("Intelligence LangGraph release history", () => {
  it("uses intelligence-langgraph/v* as its independent tag boundary", () => {
    mockGitHistory();

    expect(getLastReleaseTag("intelligence-langgraph")).toBe(
      "intelligence-langgraph/v0.1.0",
    );
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "git",
      ["tag", "--list", "intelligence-langgraph/v*", "--sort=-v:refname"],
      expect.any(Object),
    );
  });
});
