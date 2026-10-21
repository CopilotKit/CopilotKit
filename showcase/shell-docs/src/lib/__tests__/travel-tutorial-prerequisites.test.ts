import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stepOneSource = readFileSync(
  new URL(
    "../../content/docs/integrations/langgraph/tutorials/ai-travel-app/step-1-checkout-repo.mdx",
    import.meta.url,
  ),
  "utf8",
);

const agentLockSource = readFileSync(
  new URL("../../../../../examples/v1/travel/agent/uv.lock", import.meta.url),
  "utf8",
);

describe("AI travel tutorial prerequisites", () => {
  it("states the Python version required by the agent lockfile", () => {
    const minimumPythonVersion = agentLockSource.match(
      /^requires-python = ">=([^"]+)"$/m,
    )?.[1];

    expect(minimumPythonVersion).toBeDefined();
    expect(stepOneSource).toContain(`Python ${minimumPythonVersion}+`);
  });
});
