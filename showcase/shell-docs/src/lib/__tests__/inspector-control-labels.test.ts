import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

// The shipped Inspector control labels. These are the approved
// customer-facing names, and the docs click steps must quote them
// verbatim or a reader cannot find the control on screen.
const INSPECTOR_THREADS_LABEL = "Rich Threads";
const INSPECTOR_LEARNING_LABEL = "Automatic Learning";

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
});
