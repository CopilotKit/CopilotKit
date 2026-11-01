import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { Comments } from "../docs/lib/comments";
import { REFERENCE_DOCS } from "../docs/lib/files";
import { parsePythonDocstrings } from "../docs/lib/python";
import { ReferenceDoc } from "../docs/lib/reference-doc";
import { SourceFile } from "../docs/lib/source";

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

describe("comment syntax removal", () => {
  it("keeps every * that is part of the text", () => {
    const comment = [
      "/**",
      '   * Omit `accept` to allow all file types (default: `"*\\/*"`).',
      "   * **Note**: see the sample.",
      "   *",
      "   * ```tsx",
      "   * <CopilotChat",
      "   *   attachments={{",
      '   *     accept: "image/*,audio/*,application/pdf",',
      "   *     maxSize: 10 * 1024 * 1024, // 10MB",
      "   *   }}",
      "   * />",
      "   * ```",
      "   */",
    ].join("\n");

    expect(Comments.removeCommentSyntax(comment)).toBe(
      [
        'Omit `accept` to allow all file types (default: `"*/*"`).',
        "**Note**: see the sample.",
        "",
        "```tsx",
        "<CopilotChat",
        "  attachments={{",
        '    accept: "image/*,audio/*,application/pdf",',
        "    maxSize: 10 * 1024 * 1024, // 10MB",
        "  }}",
        "/>",
        "```",
      ].join("\n"),
    );
  });

  it("strips a one-line comment", () => {
    expect(Comments.removeCommentSyntax("/** The chat labels. */")).toBe(
      "The chat labels.",
    );
  });
});

describe("Python docstring parsing", () => {
  it("does not give a class without a docstring the next docstring", () => {
    const source = [
      "class Helper:",
      "    def __init__(self, tool: str):",
      "        self.tool = tool",
      "",
      "",
      "class Agent(Base):",
      '    """',
      "    The agent.",
      "",
      "    Parameters",
      "    ----------",
      "    name : str",
      "        The name of the agent.",
      '    """',
    ].join("\n");

    const parsed = parsePythonDocstrings(["Helper", "Agent"], source);

    expect(parsed.Helper).toBeUndefined();
    expect(parsed.Agent?.description).toBe("The agent.");
    expect(parsed.Agent?.parameters).toEqual([
      { name: "name", type: "str", description: "The name of the agent." },
    ]);
  });

  it("keeps a Returns block without Parameters out of the description", () => {
    const source = [
      "async def exit_run() -> bool:",
      '    """',
      "    Exits the run.",
      "",
      "    Returns",
      "    -------",
      "    bool",
      "        Always True.",
      '    """',
    ].join("\n");

    const parsed = parsePythonDocstrings(["exit_run"], source);

    expect(parsed.exit_run?.description).toBe("Exits the run.");
    expect(parsed.exit_run?.parameters).toEqual([]);
    expect(parsed.exit_run?.returns).toEqual({
      type: "bool",
      description: "Always True.",
    });
  });
});

describe("TypeScript reference generation", () => {
  function writeSource(lines: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-gen-"));
    const file = path.join(dir, "sample.ts");
    fs.writeFileSync(file, lines.join("\n"));
    return file;
  }

  it("includes the props of a generic base interface from the same file", () => {
    const file = writeSource([
      "interface Base<T> {",
      "  /** From the base. */",
      "  inherited?: T;",
      "  /** Left out by Omit. */",
      "  dropped?: string;",
      "}",
      'interface Params<T> extends Omit<Base<T>, "dropped"> {',
      "  /** Own prop. */",
      "  own?: string;",
      "}",
      "export class Thing<T> {",
      "  constructor(params?: Params<T>) {}",
      "}",
    ]);
    const source = new SourceFile(file);
    source.parse();

    const names = source
      .getArg0Interface("Thing")
      ?.properties.map((property) => property.name);

    expect(names).toEqual(["inherited", "own"]);
  });

  it("leaves out internal props and documents a commented second hook argument", async () => {
    const file = writeSource([
      "/**",
      " * The hook page.",
      " */",
      "interface Options {",
      "  /** Shown. */",
      "  shown: string;",
      "  /** @internal Hidden. */",
      "  hidden?: string;",
      "}",
      "export function useThing(",
      "  options: Options,",
      "  /** Values that run the hook again when they change. */",
      "  dependencies?: any[],",
      ") {}",
    ]);

    const page = await new ReferenceDoc({
      sourcePath: file,
      destinationPath: "unused/page.mdx",
      hook: "useThing",
    }).generatedDocsTypeScript();

    expect(page).toContain('name="shown"');
    expect(page).not.toContain('name="hidden"');
    expect(page).toContain(
      '<PropertyReference name="dependencies" type="any[]" >',
    );
    expect(page).toContain("Values that run the hook again when they change.");
  });

  it("keeps only the type of an inline object argument and gives @returns its own section", async () => {
    const file = writeSource([
      "/**",
      " * Does the thing.",
      " *",
      " * @returns The id it used.",
      " */",
      "export async function doThing(",
      "  /** The options. */",
      "  options?: {",
      "    /** An id. */",
      "    id?: string;",
      "  },",
      "): Promise<string> {",
      '  return "";',
      "}",
    ]);

    const page = await new ReferenceDoc({
      sourcePath: file,
      destinationPath: "unused/page.mdx",
      typescriptSymbols: ["doThing"],
    }).generatedDocsTypeScriptSymbols();

    expect(page).toContain('type="{ id?: string; }"');
    expect(page).toContain("### Returns\n\nThe id it used.");
    expect(page).not.toContain("@returns");
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
