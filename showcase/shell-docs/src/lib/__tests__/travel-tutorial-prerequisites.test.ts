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
  new URL(
    "../../../../../examples/showcases/travel/agent/uv.lock",
    import.meta.url,
  ),
  "utf8",
);

describe("AI travel tutorial prerequisites", () => {
  it("states the Python version required by the agent lockfile before installation", () => {
    const minimumPythonVersion = agentLockSource.match(
      /^requires-python = ">=([^"]+)"$/m,
    )?.[1];
    const prerequisitesIndex = stepOneSource.indexOf("### Check prerequisites");
    const installIndex = stepOneSource.indexOf("pnpm install:agent");

    expect(minimumPythonVersion).toBeDefined();
    expect(prerequisitesIndex).toBeGreaterThan(-1);
    expect(prerequisitesIndex).toBeLessThan(installIndex);
    expect(stepOneSource).toContain(`Python ${minimumPythonVersion}+`);
  });

  it("links to the uv installation guide before requiring uv", () => {
    const uvGuideIndex = stepOneSource.indexOf(
      "https://docs.astral.sh/uv/getting-started/installation/",
    );
    const installIndex = stepOneSource.indexOf("pnpm install:agent");

    expect(uvGuideIndex).toBeGreaterThan(-1);
    expect(uvGuideIndex).toBeLessThan(installIndex);
  });
});
