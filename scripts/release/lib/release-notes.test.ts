import { describe, expect, it } from "vitest";
import type { ChangesSummary, Commit } from "./changes.js";
import {
  extractBreakingChangeNotes,
  generateRawReleaseNotes,
} from "./release-notes.js";

function summary(commits: Commit[]): ChangesSummary {
  return {
    lastTag: "v1.0.0",
    commitCount: commits.length,
    commits,
    oneline: commits.map((commit) => `- ${commit.subject}`).join("\n"),
  };
}

describe("extractBreakingChangeNotes", () => {
  it("extracts both conventional breaking footer spellings", () => {
    expect(
      extractBreakingChangeNotes({
        hash: "abc1234",
        subject: "feat(runtime)!: replace the transport",
        body: "Context.\n\nBREAKING CHANGE: configure a streaming adapter.\nKeep the old adapter during migration.\nCo-authored-by: Release Test <release-test@example.com>\n\nBREAKING-CHANGE: remove the legacy transport.",
      }),
    ).toEqual([
      "configure a streaming adapter.\nKeep the old adapter during migration.",
      "remove the legacy transport.",
    ]);
  });

  it("ignores markers embedded inside prose", () => {
    expect(
      extractBreakingChangeNotes({
        hash: "abc1234",
        subject: "fix(runtime): improve release docs",
        body: "This mentions BREAKING CHANGE: as an example.",
      }),
    ).toEqual([]);
  });
});

describe("generateRawReleaseNotes", () => {
  it("renders a breaking section for a footer without a !: subject", () => {
    const notes = generateRawReleaseNotes(
      "1.1.0",
      "monorepo",
      summary([
        {
          hash: "abc123456",
          subject: "feat(runtime): replace the transport",
          body: "BREAKING CHANGE: configure a streaming adapter.",
        },
      ]),
    );

    expect(notes).toContain("### Breaking Changes");
    expect(notes).toContain("  configure a streaming adapter.");
  });

  it("renders a breaking section for a !: subject without a footer", () => {
    const notes = generateRawReleaseNotes(
      "1.1.0",
      "monorepo",
      summary([
        {
          hash: "abc123456",
          subject: "feat(runtime)!: replace the transport",
          body: "",
        },
      ]),
    );

    expect(notes).toContain("### Breaking Changes");
    expect(notes).toContain(
      "- feat(runtime)!: replace the transport (abc1234)",
    );
  });

  it("renders parsed migration guidance for breaking commits", () => {
    const notes = generateRawReleaseNotes(
      "1.1.0",
      "monorepo",
      summary([
        {
          hash: "abc123456",
          subject: "feat(runtime)!: replace the transport",
          body: "BREAKING CHANGE: configure a streaming adapter.\nKeep the old adapter during migration.",
        },
        {
          hash: "def567890",
          subject: "fix(core): preserve tool state",
          body: "",
        },
      ]),
    );

    expect(notes).toContain("### Breaking Changes");
    expect(notes).toContain(
      "- feat(runtime)!: replace the transport (abc1234)",
    );
    expect(notes).toContain("  configure a streaming adapter.");
    expect(notes).toContain("  Keep the old adapter during migration.");
  });

  it("recognizes only the conventional !: subject position", () => {
    const notes = generateRawReleaseNotes(
      "1.1.0",
      "monorepo",
      summary([
        {
          hash: "abc123456",
          subject: "fix(core): preserve wow! messages",
          body: "",
        },
      ]),
    );

    expect(notes).not.toContain("### Breaking Changes");
  });
});
