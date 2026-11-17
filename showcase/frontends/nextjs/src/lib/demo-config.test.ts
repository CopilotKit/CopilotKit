import { describe, expect, it } from "vitest";
import { loadIntegrationDemoConfig } from "@/lib/demo-config";

// Pairs come from the real manifests: only mastra lists background-agents,
// and no integration keeps a src/integrations/mastra/demos/background-agents.ts
// (a demo that only one integration runs has nothing to vary). The files are
// real too: strands keeps src/integrations/strands/demos/gen-ui-interrupt.ts,
// because its agent pauses with an interrupt.

describe("loadIntegrationDemoConfig", () => {
  it("returns the default export of the integration's file for the demo", async () => {
    await expect(
      loadIntegrationDemoConfig("strands", "gen-ui-interrupt"),
    ).resolves.toEqual({
      mechanism: "interrupt",
      payload: "strands-reason",
      answer: "selection",
    });
  });

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

  it("rejects a demo the integration does not serve", async () => {
    await expect(
      loadIntegrationDemoConfig("strands", "background-agents"),
    ).rejects.toThrow(
      "The strands integration does not serve the background-agents demo.",
    );
  });

  it("returns undefined when the integration has no file for the demo", async () => {
    await expect(
      loadIntegrationDemoConfig("mastra", "background-agents"),
    ).resolves.toBeUndefined();
  });
});
