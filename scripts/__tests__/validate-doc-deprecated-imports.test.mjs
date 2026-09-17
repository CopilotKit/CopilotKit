import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ALLOWLIST,
  codeBlocks,
  deprecatedExportIndex,
  importPairs,
  packageEntrypoints,
  repoRoot,
  scanDocs,
} from "../validate-doc-deprecated-imports.mjs";

// Built once: the TypeScript program behind it is the expensive part.
const { index, unresolved, unloaded } = deprecatedExportIndex();

test("code blocks are read without depending on the document parsing", () => {
  // A fragment inside JSX, an info string with attributes, and a longer fence
  // marker all have to survive — most documented code is not a whole file.
  const blocks = codeBlocks(
    [
      "text",
      '```ts title="app/page.tsx" doctest="x"',
      'import { A } from "pkg";',
      "```",
      "  <Tab>",
      "  ```tsx",
      '  import { B } from "pkg";',
      "  ```",
      "````md",
      "```ts",
      "````",
    ].join("\n"),
  );
  assert.deepEqual(
    blocks.map((b) => b.lang),
    ["ts", "tsx", "md"],
  );
  assert.equal(blocks[0].line, 2);
  assert.match(blocks[1].code, /import \{ B \}/);
});

test("import specifiers are read out of partial and aliased forms", () => {
  const pairs = importPairs(
    [
      'import { LangGraphHttpAgent } from "@copilotkit/runtime";',
      'import type { CopilotKitProps } from "@copilotkit/react-core";',
      'import { CopilotRuntime as RT } from "@copilotkit/runtime";',
      "import {",
      "  CopilotKit,",
      "  type ChatSuggestions,",
      '} from "@copilotkit/react-core";',
      'import React from "react";',
      'import * as All from "@copilotkit/runtime";',
      'const { OpenAIAdapter } = require("@copilotkit/runtime");',
    ].join("\n"),
  );
  assert.deepEqual(pairs, [
    { module: "@copilotkit/runtime", name: "LangGraphHttpAgent" },
    { module: "@copilotkit/react-core", name: "CopilotKitProps" },
    // An alias is recorded under the name the MODULE exports, not the local one.
    { module: "@copilotkit/runtime", name: "CopilotRuntime" },
    { module: "@copilotkit/react-core", name: "CopilotKit" },
    { module: "@copilotkit/react-core", name: "ChatSuggestions" },
    { module: "@copilotkit/runtime", name: "OpenAIAdapter" },
  ]);
});

test("the deprecated set is derived from every package entrypoint", () => {
  // The one failure mode that would make this check quietly useless is the
  // index shrinking without anyone noticing, so an entrypoint that cannot be
  // resolved or loaded is a failure rather than a skip.
  assert.deepEqual(unresolved, []);
  assert.deepEqual(unloaded, []);
  const { resolved } = packageEntrypoints();
  assert.ok(resolved.length >= 60, `only ${resolved.length} entrypoints`);
});

test("the deprecated set is keyed on the tag, not on its message text", () => {
  // PE-114 rewrote the @deprecated message wording. Keying on the text would
  // have gone blind the day it landed, so assert membership for a symbol whose
  // message changed and non-membership for a live v2 symbol in the same module.
  assert.ok(index.get("@copilotkit/runtime").has("LangGraphHttpAgent"));
  assert.ok(index.get("@copilotkit/react-core").has("useCopilotAction"));
  // Not `?.has(...)`: an absent module would make a negative assertion pass
  // for the wrong reason. `@copilotkit/runtime/v2` IS in the index (its
  // `createCopilotEndpoint*` helpers are deprecated), so asserting that its
  // live `CopilotRuntime` is absent is a real statement about the tag.
  assert.ok(index.has("@copilotkit/runtime/v2"));
  assert.ok(!index.get("@copilotkit/runtime/v2").has("CopilotRuntime"));
  assert.ok(index.get("@copilotkit/runtime/v2").has("createCopilotEndpoint"));
  // react-core's v2 entry has no deprecated export at all, which is itself the
  // assertion — v1 is deprecated wholesale, v2 is not.
  assert.equal(index.get("@copilotkit/react-core/v2"), undefined);

  // No message text is read anywhere in the checker.
  const source = readFileSync(
    path.join(repoRoot, "scripts/validate-doc-deprecated-imports.mjs"),
    "utf8",
  );
  assert.ok(
    !/Use v2 instead|No 1:1 v2 replacement/.test(source),
    "the checker must not match on @deprecated message wording",
  );
});

test("the v1 export map keeps naming deprecated symbols without failing", () => {
  // It names them in inline code spans and table cells rather than in a fenced
  // code block, so the scan never sees it. Pinned because the page is
  // generated: if it ever grows a real fence, this flips and someone decides
  // deliberately rather than discovering it in CI.
  const exportMap =
    "showcase/shell-docs/src/content/reference/v1/export-map.mdx";
  assert.ok(existsSync(path.join(repoRoot, exportMap)));
  assert.match(
    readFileSync(path.join(repoRoot, exportMap), "utf8"),
    /LangGraphHttpAgent/,
  );
  const hits = scanDocs(index);
  // Guard against a vacuous pass: the scan must really be finding things
  // elsewhere for "nothing on this page" to mean anything.
  assert.ok(hits.length > 50, `scan found only ${hits.length} hits`);
  assert.deepEqual(
    hits.filter((hit) => hit.file === exportMap),
    [],
  );
});

test("allowlist entries are well formed, unique and per symbol", () => {
  const seen = new Set();
  for (const entry of ALLOWLIST) {
    assert.equal(typeof entry.ticket, "string");
    assert.ok(entry.ticket.includes("PE-"), `${entry.subject} needs a ticket`);
    assert.equal(entry.rule, "deprecated-import");
    // A (module, name) pair, never a bare name or a whole directory.
    assert.match(entry.subject, /^@copilotkit\/[\w/-]+:[A-Za-z_$][\w$]*$/);
    assert.ok(
      entry.file.startsWith("showcase/shell-docs/src/content/") &&
        entry.file.endsWith(".mdx"),
      `${entry.file} must be a content page, not a directory`,
    );
    const key = `${entry.file}|${entry.subject}`;
    assert.ok(!seen.has(key), `duplicate allowlist entry ${key}`);
    seen.add(key);
  }
});
