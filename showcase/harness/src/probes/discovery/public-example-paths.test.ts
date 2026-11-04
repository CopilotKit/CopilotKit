import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const TRAVEL_TUTORIAL_DIR = path.join(
  REPO_ROOT,
  "showcase/shell-docs/src/content/docs/integrations/langgraph/tutorials/ai-travel-app",
);

test("the travel tutorial teaches the canonical 2.0 example", () => {
  const tutorial = [
    "index.mdx",
    "next-steps.mdx",
    "step-1-checkout-repo.mdx",
    "step-2-langgraph-agent.mdx",
    "step-3-setup-copilotkit.mdx",
    "step-4-integrate-the-agent.mdx",
    "step-5-stream-progress.mdx",
    "step-6-human-in-the-loop.mdx",
  ]
    .map((file) => readFileSync(path.join(TRAVEL_TUTORIAL_DIR, file), "utf8"))
    .join("\n");

  expect(tutorial).toContain("examples/v1/travel");
  expect(tutorial).toContain('from "@copilotkit/react-core"');
  expect(tutorial).toContain('from "@copilotkit/runtime"');

  for (const staleReference of [
    "coagents-travel-tutorial-start",
    "examples/coagents-travel",
    "/reference/v1/",
    "useCoAgent",
    "useCoAgentStateRender",
    "useCopilotAction",
    "@copilotkit/react-ui",
    "@copilotkit/react-core/v2",
    "@copilotkit/runtime/v2",
  ]) {
    expect(tutorial, staleReference).not.toContain(staleReference);
  }
});
