import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  INSPECTOR_LEARNING_LABEL,
  INSPECTOR_THREADS_LABEL,
} from "../../../../../packages/web-inspector/src/control-labels";

const here = dirname(fileURLToPath(import.meta.url));
const contentRoot = resolve(here, "../../content");

function readDoc(relativePath: string): string {
  return readFileSync(resolve(contentRoot, relativePath), "utf8");
}

test("docs click steps quote the shipped Inspector control labels", () => {
  const threadsDoc = readDoc(
    "snippets/shared/inspector/open-inspector-pane-threads.mdx",
  );
  const learningDoc = readDoc(
    "snippets/shared/inspector/open-inspector-pane-learning.mdx",
  );
  const inspectorDoc = readDoc("docs/inspector.mdx");

  expect(threadsDoc).toContain(`**${INSPECTOR_THREADS_LABEL}**`);
  expect(learningDoc).toContain(`**${INSPECTOR_LEARNING_LABEL}**`);
  expect(inspectorDoc).toContain(`**${INSPECTOR_THREADS_LABEL}**`);
  expect(inspectorDoc).toContain(`**${INSPECTOR_LEARNING_LABEL}**`);
  expect(inspectorDoc).not.toContain("Rich Threads");
  expect(inspectorDoc).not.toContain("Automatic Learning");
});
