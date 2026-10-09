/**
 * Guards the Slack field names in `native.ts` against Slack's own published
 * vocabulary in `@slack/types`.
 *
 * Why this exists: Slack accepts a message whole or not at all. One key it does
 * not recognise refuses the entire `chat.postMessage` call with
 * `invalid_blocks: invalid field at /blocks/N/...`, and the Channels delivery
 * that carried it ends there. Nothing is thrown at the developer who authored
 * the payload and nothing arrives in the channel. So a single character wrong
 * in a prop name is not a typo with a small blast radius — it silently deletes
 * every message that uses the component.
 *
 * That is exactly what `decimal_allowed` did (Slack's name is
 * `is_decimal_allowed`). It shipped in 0.9.0 and was found by accident. This
 * test is the thing that would have caught it: every field name the Slack prop
 * types declare must either appear in Slack's own Block Kit type declarations,
 * or be listed below with the reason it cannot.
 *
 * The comparison reads declarations with the TypeScript parser rather than by
 * matching text, so it follows the shape of the files instead of their
 * formatting.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Props that exist for the JSX surface and are never serialised into Slack
 * JSON. The codec consumes them; Slack never sees them.
 */
const SDK_ONLY_PROPS = new Set(["children", "onClick", "onSelect", "onSubmit"]);

/**
 * The honest limit of this check. `@slack/types` is Slack's own package but it
 * is not complete, so a name missing from it is not proof the name is wrong —
 * only that this test cannot judge it. Every entry here is a field this test
 * therefore does NOT cover, with the reason. Adding a name here is a deliberate
 * act: it removes that name from the guard.
 */
const NOT_COVERED_BY_SLACK_TYPES: ReadonlyMap<string, string> = new Map([
  [
    "blocks",
    "the `container` block's child slot; `@slack/types` declares no container block",
  ],
  [
    "offset",
    "documented on `rich_text_list` in Slack's Block Kit reference, but absent from `@slack/types`' `RichTextList`",
  ],
  [
    "slack_icon",
    "accepted on the `card` block; `@slack/types`' `CardBlock` does not declare it",
  ],
  [
    "subtext",
    "accepted on the `card` block; `@slack/types`' `CardBlock` does not declare it",
  ],
  // `data_visualization` has no counterpart in `@slack/types` at all, so its
  // whole payload vocabulary is outside this comparison.
  [
    "chart",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "segments",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "series",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "axis_config",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "categories",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "x_label",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "y_label",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
  [
    "data",
    "part of `data_visualization`, a block `@slack/types` does not know",
  ],
]);

/**
 * A comparison against an empty vocabulary passes every name, so the test would
 * go green precisely when it stopped working. These floors are well under the
 * present counts and only catch a comparison that has collapsed.
 */
const MIN_SLACK_FIELD_NAMES = 100;
const MIN_FIELDS_COMPARED = 30;

/** Every property name declared by any interface in a `.d.ts` source. */
function declaredPropertyNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return names;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

/** Slack's Block Kit vocabulary, read from the installed `@slack/types`. */
function slackBlockKitFieldNames(): Set<string> {
  const require = createRequire(import.meta.url);
  const blockKitDir = join(
    dirname(require.resolve("@slack/types/package.json")),
    "dist",
    "block-kit",
  );
  const declarations = readdirSync(blockKitDir).filter((file) =>
    file.endsWith(".d.ts"),
  );

  const names = new Set<string>();
  for (const file of declarations) {
    for (const name of declaredPropertyNames(parse(join(blockKitDir, file)))) {
      names.add(name);
    }
  }
  return names;
}

/** Every field name our Slack prop interfaces declare. */
function declaredSlackPropNames(): Set<string> {
  return declaredPropertyNames(parse(join(here, "..", "native.ts")));
}

describe("Slack native prop names match Slack's own vocabulary", () => {
  const slackNames = slackBlockKitFieldNames();
  const ourNames = declaredSlackPropNames();

  it("reads a real vocabulary out of @slack/types", () => {
    expect(slackNames.size).toBeGreaterThanOrEqual(MIN_SLACK_FIELD_NAMES);
    // A spot check that the reader found actual Block Kit fields and not, say,
    // a directory of empty modules.
    expect(slackNames).toContain("is_decimal_allowed");
    expect(slackNames).toContain("dispatch_action");
    expect(slackNames).toContain("accessory");
  });

  it("reads the prop names out of native.ts", () => {
    expect(ourNames).toContain("is_decimal_allowed");
    expect(ourNames).toContain("block_id");
  });

  it("declares no field name Slack does not know", () => {
    const unknown = [...ourNames]
      .filter((name) => !SDK_ONLY_PROPS.has(name))
      .filter((name) => !slackNames.has(name))
      .filter((name) => !NOT_COVERED_BY_SLACK_TYPES.has(name))
      .sort();

    expect(unknown, unknownFieldMessage(unknown)).toEqual([]);
  });

  it("actually compares a meaningful number of names", () => {
    const compared = [...ourNames].filter(
      (name) =>
        !SDK_ONLY_PROPS.has(name) &&
        !NOT_COVERED_BY_SLACK_TYPES.has(name) &&
        slackNames.has(name),
    );

    expect(compared.length).toBeGreaterThanOrEqual(MIN_FIELDS_COMPARED);
  });

  it("keeps the uncovered list honest", () => {
    // A name listed as uncovered that Slack turns out to declare is no longer
    // an exemption, and leaving it here would hide a future rename of it.
    const nowKnown = [...NOT_COVERED_BY_SLACK_TYPES.keys()]
      .filter((name) => slackNames.has(name))
      .sort();

    expect(
      nowKnown,
      `@slack/types now declares ${nowKnown.join(", ")} — remove ${
        nowKnown.length === 1 ? "it" : "them"
      } from NOT_COVERED_BY_SLACK_TYPES so the guard covers ${
        nowKnown.length === 1 ? "it" : "them"
      }.`,
    ).toEqual([]);

    // An exemption for a name we no longer declare is dead weight that would
    // silently pre-approve the name if it ever came back.
    const unused = [...NOT_COVERED_BY_SLACK_TYPES.keys()]
      .filter((name) => !ourNames.has(name))
      .sort();

    expect(
      unused,
      `NOT_COVERED_BY_SLACK_TYPES lists ${unused.join(
        ", ",
      )}, which native.ts no longer declares — drop the entr${
        unused.length === 1 ? "y" : "ies"
      }.`,
    ).toEqual([]);
  });
});

function unknownFieldMessage(unknown: readonly string[]): string {
  if (unknown.length === 0) return "";
  return (
    `native.ts declares ${unknown
      .map((name) => `\`${name}\``)
      .join(", ")}, which @slack/types does not. Slack refuses a whole ` +
    "message for one unrecognised key, so a wrong name here deletes every " +
    "message using the component. Either correct the name to Slack's, or — " +
    "if Slack really does accept it and @slack/types is simply behind — add " +
    "it to NOT_COVERED_BY_SLACK_TYPES with the reason."
  );
}
