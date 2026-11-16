import { describe, expect, it } from "vitest";
import { loadIntegrationDemoConfig } from "@/lib/demo-config";

// Pairs come from the real manifests: only mastra lists background-agents,
// and no integration keeps a src/integrations/mastra/demos/background-agents.ts
// (a demo that only one integration runs has nothing to vary).

describe("loadIntegrationDemoConfig", () => {
  it.each([
    ["an integration", "../strands", "agentic-chat"],
    ["a demo", "strands", "Agentic_Chat"],
  ])(
    "rejects %s segment that is not kebab-case",
    async (_, integration, demo) => {
      await expect(
        loadIntegrationDemoConfig(integration, demo),
      ).rejects.toThrow("must be kebab-case");
    },
  );

  it("rejects a demo the integration's manifest does not list", async () => {
    await expect(
      loadIntegrationDemoConfig("strands", "background-agents"),
    ).rejects.toThrow(
      "The strands manifest does not list the background-agents demo.",
    );
  });

  it("returns undefined when the integration has no file for the demo", async () => {
    await expect(
      loadIntegrationDemoConfig("mastra", "background-agents"),
    ).resolves.toBeUndefined();
  });
});
