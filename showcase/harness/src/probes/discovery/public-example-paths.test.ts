import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const TRAVEL_TUTORIAL_DIR = path.join(
  REPO_ROOT,
  "showcase/shell-docs/src/content/docs/integrations/langgraph/tutorials/ai-travel-app",
);

const PUBLIC_EXAMPLES = [
  {
    legacyPath: "examples/v1/chat-with-your-data",
    canonicalPath: "examples/showcases/chat-with-your-data",
    packageName: "@copilotkit-examples/chat-with-your-data",
  },
  {
    legacyPath: "examples/v1/form-filling",
    canonicalPath: "examples/showcases/form-filling",
    packageName: "@copilotkit-examples/form-filling",
  },
  {
    legacyPath: "examples/v1/research-canvas",
    canonicalPath: "examples/canvas/research-canvas",
    packageName: "@copilotkit-examples/research-canvas",
  },
  {
    legacyPath: "examples/v1/state-machine",
    canonicalPath: "examples/showcases/state-machine",
    packageName: "@copilotkit-examples/state-machine",
  },
  {
    legacyPath: "examples/v1/travel",
    canonicalPath: "examples/showcases/travel",
    packageName: "@copilotkit-examples/travel",
  },
] as const;

test("public v2 examples live in the canonical example categories", () => {
  for (const example of PUBLIC_EXAMPLES) {
    const canonicalPackage = path.join(
      REPO_ROOT,
      example.canonicalPath,
      "package.json",
    );

    expect(existsSync(canonicalPackage), example.canonicalPath).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, example.legacyPath))).toBe(false);
    expect(JSON.parse(readFileSync(canonicalPackage, "utf8"))).toMatchObject({
      name: example.packageName,
    });
  }
});

test("the travel tutorial teaches the canonical v2 example", () => {
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

  expect(tutorial).toContain("examples/showcases/travel");
  expect(tutorial).toContain("@copilotkit/react-core/v2");
  expect(tutorial).toContain("@copilotkit/runtime/v2");

  for (const staleReference of [
    "coagents-travel-tutorial-start",
    "examples/coagents-travel",
    "/reference/v1/",
    "useCoAgent",
    "useCoAgentStateRender",
    "useCopilotAction",
    "@copilotkit/react-ui",
  ]) {
    expect(tutorial, staleReference).not.toContain(staleReference);
  }
});
