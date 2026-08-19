import { describe, expect, it } from "vitest";
import {
  extractBreakingChangeNotes,
  generateRawReleaseNotes,
} from "./release-notes.js";
import type { ChangesSummary } from "./changes.js";

const summary = (commits: ChangesSummary["commits"]): ChangesSummary => ({
  lastTag: "v1.0.0",
  commitCount: commits.length,
  commits,
  oneline: commits.map((c) => `- ${c.subject}`).join("\n"),
});

describe("extractBreakingChangeNotes", () => {
  it("extracts the BREAKING CHANGE footer paragraph", () => {
    const notes = extractBreakingChangeNotes({
      hash: "abc1234",
      subject: "refactor(react-native)!: RenderToolProps args type",
      body: "Migration guidance.\n\nBREAKING CHANGE: RenderToolProps `args` becomes `Partial<T>` on the in-progress arm, so a renderer reading `args.foo` without narrowing on `status` now fails `check-types` with TS18048.\n\nCo-authored-by: someone <s@example.com>\nRefs: #6438",
    });

    expect(notes).toEqual([
      "RenderToolProps `args` becomes `Partial<T>` on the in-progress arm, so a renderer reading `args.foo` without narrowing on `status` now fails `check-types` with TS18048.",
    ]);
  });

  it("supports the BREAKING-CHANGE variant and continuation lines", () => {
    expect(
      extractBreakingChangeNotes({
        hash: "x",
        subject: "s",
        body: "BREAKING-CHANGE: same semantics\nsecond line of the note",
      }),
    ).toEqual(["same semantics\nsecond line of the note"]);
  });

  it("returns nothing when there is no footer", () => {
    expect(
      extractBreakingChangeNotes({
        hash: "x",
        subject: "fix(channels): typo",
        body: "just a fix",
      }),
    ).toEqual([]);
  });

  it("ignores the marker when it is not at the start of a line", () => {
    expect(
      extractBreakingChangeNotes({
        hash: "x",
        subject: "s",
        body: "note: BREAKING CHANGE: not a footer",
      }),
    ).toEqual([]);
  });
});

describe("generateRawReleaseNotes", () => {
  it("renders a Breaking Changes section from commit bodies", () => {
    const notes = generateRawReleaseNotes(
      "1.1.0",
      "monorepo",
      summary([
        {
          hash: "abc1234",
          subject: "refactor(react-native)!: RenderToolProps args type",
          body: "BREAKING CHANGE: RenderToolProps `args` becomes `Partial<T>` on the in-progress arm.",
        },
        {
          hash: "def5678",
          subject: "feat(channels): shared release",
          body: "Some detail",
        },
      ]),
    );

    expect(notes).toContain("### Features");
    expect(notes).toContain("- feat(channels): shared release (def5678)");
    expect(notes).toContain("### Breaking Changes");
    expect(notes).toContain(
      "- RenderToolProps `args` becomes `Partial<T>` on the in-progress arm.",
    );
  });

  it("keeps prior behavior when no commit has a breaking footer", () => {
    const notes = generateRawReleaseNotes(
      "1.1.0",
      "monorepo",
      summary([
        {
          hash: "abc1234",
          subject: "fix(channels): typo",
          body: "",
        },
      ]),
    );

    expect(notes).toContain("### Fixes");
    expect(notes).not.toContain("### Breaking Changes");
  });
});