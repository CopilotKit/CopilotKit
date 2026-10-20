import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { Comments } from "../docs/lib/comments";
import { REFERENCE_DOCS } from "../docs/lib/files";

const repoRoot = path.resolve(__dirname, "..", "..");

// Verbatim shape of the notice #6582 added to every public v1 source file.
const V1_NOTICE = `/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useCopilotAction:
 *   V2 import and usage:
 *     import { useFrontendTool } from "@copilotkit/react-core/v2";
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */`;

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "sample.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
}

describe("v1 deprecation notice stripping", () => {
  it("keeps the real JSDoc when the notice precedes it", () => {
    const sourceFile = parse(
      [
        V1_NOTICE,
        "",
        "/**",
        " * The real page body.",
        " */",
        'import { thing } from "./thing";',
        "",
        "export const value = thing;",
      ].join("\n"),
    );

    const comment = Comments.getFirstCommentBlock(sourceFile);

    expect(comment).toBe("The real page body.");
    expect(comment).not.toContain("AI CODING AGENTS");
    expect(comment).not.toContain("V1 SDK DEPRECATED");
  });

  it("returns null when the notice is the only comment", () => {
    const sourceFile = parse(
      [V1_NOTICE, "", 'import { thing } from "./thing";'].join("\n"),
    );

    expect(Comments.getFirstCommentBlock(sourceFile)).toBeNull();
  });

  it("does not strip ordinary comments that merely mention v1", () => {
    const sourceFile = parse(
      [
        "/**",
        " * Explains why the v1 SDK is deprecated. Use v2 instead.",
        " */",
        'import { thing } from "./thing";',
      ].join("\n"),
    );

    expect(Comments.getFirstCommentBlock(sourceFile)).toBe(
      "Explains why the v1 SDK is deprecated. Use v2 instead.",
    );
  });

  it("strips the notice from function docs too", () => {
    const sourceFile = parse(
      [
        V1_NOTICE,
        "",
        "/**",
        " * Does the thing.",
        " * @param first the first argument",
        " */",
        "export function doThing(first: string) {}",
      ].join("\n"),
    );

    const fn = sourceFile.statements[0];
    const { comment, params } = Comments.getTsDocCommentsForFunction(
      fn,
      sourceFile,
    );

    expect(comment).toBe("Does the thing.");
    expect(params).toEqual({ first: "the first argument" });
  });
});

describe("REFERENCE_DOCS destinations", () => {
  // The six SDK pages were generated into `reference/sdk/` for months after the
  // committed pages moved to `reference/v1/sdk/`, so the generator refreshed a
  // directory the docs site never served (#6939). Checking that the directory
  // merely exists is not enough — a stray generation recreates it. Require a
  // tracked file in it, which only the real content directories have.
  it.each(REFERENCE_DOCS.map((doc) => doc.destinationPath))(
    "writes %s into a tracked content directory",
    (destinationPath) => {
      const parent = path.posix.dirname(destinationPath);
      const tracked = execFileSync("git", ["ls-files", "--", parent], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();

      expect(tracked).not.toBe("");
    },
  );

  it("reads every source file it is configured to document", () => {
    const missing = REFERENCE_DOCS.map((doc) => doc.sourcePath).filter(
      (sourcePath) => !fs.existsSync(path.join(repoRoot, sourcePath)),
    );

    expect(missing).toEqual([]);
  });
});
