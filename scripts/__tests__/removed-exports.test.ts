import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  headingIdsOf,
  headingSlug,
  missingDocsSections,
  staleStubModules,
  typeFixtureProblems,
} from "../deprecations/removed-exports.mjs";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** Writes `files` into a new temporary directory and returns its path. */
function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "removed-exports-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** A type fixture against `removed.d.ts`, whose export has a message type. */
function fixture(consumer: string) {
  const root = project({
    "removed.d.ts": [
      "declare const brand: unique symbol;",
      'export declare const oldHook: { readonly [brand]: "oldHook was removed in CopilotKit 2.0. Use newHook instead." };',
      'export declare const oldPart: { readonly [brand]: "Use newPart instead." };',
    ].join("\n"),
    "consumer.ts": consumer,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [] },
      include: ["consumer.ts"],
    }),
  });
  return path.join(root, "tsconfig.json");
}

describe("the removed-export stand-ins", () => {
  it("link only to docs headings that exist", () => {
    expect(missingDocsSections()).toEqual([]);
  });

  it("are the modules that the table generates", () => {
    expect(staleStubModules()).toEqual([]);
  });
});

describe("heading ids", () => {
  it("drop punctuation the way github-slugger does", () => {
    expect(headingSlug("A2UI v0.9 renderer")).toBe("a2ui-v09-renderer");
    expect(headingSlug("Message types from @copilotkit/shared")).toBe(
      "message-types-from-copilotkitshared",
    );
    expect(headingSlug("Option 3 — Replace the renderer (escape hatch)")).toBe(
      "option-3--replace-the-renderer-escape-hatch",
    );
  });

  it("number a repeated heading, skip code blocks, and keep a custom id", () => {
    const page = [
      "## Install",
      "```bash",
      "# Not a heading",
      "```",
      "## Install",
      "### `useAgent` [#use-agent]",
    ].join("\n");

    expect([...headingIdsOf(page)]).toEqual([
      "install",
      "install-1",
      "use-agent",
    ]);
  });
});

describe("typeFixtureProblems", () => {
  it("accepts an error that has the text of its @ts-expect-error", () => {
    const config = fixture(
      [
        'import { oldHook } from "./removed";',
        "// @ts-expect-error Use newHook instead.",
        "oldHook();",
      ].join("\n"),
    );

    expect(typeFixtureProblems(config)).toEqual([]);
  });

  it("reports an error without the text of its @ts-expect-error", () => {
    const config = fixture(
      [
        'import { oldHook } from "./removed";',
        "// @ts-expect-error Use otherHook instead.",
        "oldHook();",
      ].join("\n"),
    );

    const [problem, ...rest] = typeFixtureProblems(config);
    expect(rest).toEqual([]);
    expect(problem).toContain(
      'consumer.ts:3: expected an error with "Use otherHook instead."',
    );
  });

  it("reports an error that has the text but not the removal message", () => {
    const config = fixture(
      [
        'import { oldPart } from "./removed";',
        "// @ts-expect-error Use newPart instead.",
        "oldPart();",
      ].join("\n"),
    );

    const [problem, ...rest] = typeFixtureProblems(config);
    expect(rest).toEqual([]);
    expect(problem).toContain(
      'consumer.ts:3: expected an error with "Use newPart instead."',
    );
  });

  it("reports an error that has no @ts-expect-error", () => {
    const config = fixture(
      ['import { oldHook } from "./removed";', "oldHook();"].join("\n"),
    );

    const [problem, ...rest] = typeFixtureProblems(config);
    expect(rest).toEqual([]);
    expect(problem).toContain("consumer.ts:2: unexpected error");
  });
});
