import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import {
  selectedShowcaseGuideBindings,
  showcaseSourceCarrier,
} from "../selected-showcase-guide-bindings";

/** A deliberate registry alias, not a claim that quickstart is a demo source. */
const ACCEPTED_NON_CARRIER_BINDINGS = new Set(["built-in-agent:agentic-chat"]);

test("selected runnable Showcase cells resolve to an effective guide with a source path", () => {
  const bindings = selectedShowcaseGuideBindings();
  expect(bindings.length).toBeGreaterThan(0);

  const missing = bindings
    .filter((binding) => {
      const key = `${binding.framework}:${binding.cell}`;
      return (
        binding.route !== null &&
        !ACCEPTED_NON_CARRIER_BINDINGS.has(key) &&
        showcaseSourceCarrier(binding) === null
      );
    })
    .map(
      (binding) =>
        `${binding.framework}:${binding.cell} -> ${binding.contentSlugPath}`,
    );

  expect(missing).toEqual([]);

  const accepted = bindings.filter((binding) =>
    ACCEPTED_NON_CARRIER_BINDINGS.has(`${binding.framework}:${binding.cell}`),
  );
  expect(accepted).toHaveLength(1);
  expect(accepted[0]!.contentSlugPath).toBe(
    "integrations/built-in-agent/quickstart",
  );
  expect(showcaseSourceCarrier(accepted[0]!)).toBeNull();

  const renderCache = new Map<string, string>();
  const unresolvedOutput = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.framework}:${binding.contentSlugPath}`;
    const carrier = showcaseSourceCarrier(binding);
    if (
      binding.route === null ||
      ACCEPTED_NON_CARRIER_BINDINGS.has(
        `${binding.framework}:${binding.cell}`,
      ) ||
      carrier === null
    ) {
      continue;
    }

    let output = renderCache.get(key);
    if (!output) {
      const doc = loadDoc(binding.contentSlugPath);
      if (!doc) throw new Error(`Missing effective guide: ${key}`);
      output = renderPageToLlmText(
        {
          url: `${binding.framework}/${binding.contentSlugPath}`,
          title: doc.fm.title,
          description: doc.fm.description,
          filePath: doc.filePath,
          loadSlug: binding.contentSlugPath,
          framework: binding.framework,
        },
        { framework: binding.framework },
      );
      renderCache.set(key, output);
    }

    for (const marker of [
      "Missing snippet",
      "snippet skipped:",
      "setup skipped:",
      "<Snippet",
      "<FrameworkSetup",
    ]) {
      if (output.includes(marker)) {
        unresolvedOutput.add(`${key}: ${marker}`);
      }
    }
    if (carrier === "inline-demo") {
      if (!output.includes("<!-- interactive demo:")) {
        unresolvedOutput.add(`${key}: interactive demo missing`);
      }
    }
  }

  expect([...unresolvedOutput].sort()).toEqual([]);
});

test("selected command-only cells still resolve an effective guide", () => {
  const commandCells = selectedShowcaseGuideBindings().filter(
    (binding) => binding.command !== null,
  );
  expect(commandCells.length).toBeGreaterThan(0);
  expect(
    commandCells.every((binding) => binding.contentSlugPath.length > 0),
  ).toBe(true);
});
