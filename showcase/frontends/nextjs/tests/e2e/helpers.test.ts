import { afterAll, describe, expect, it, vi } from "vitest";
import { demoPath, requireIntegration } from "./helpers";

// helpers.ts reads INTEGRATION when it loads, as it does in a Playwright run.
// Vitest runs vi.hoisted before the imports above.
vi.hoisted(() => {
  vi.stubEnv("INTEGRATION", "strands");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// Expected values come from the real manifests: strands lists agentic-chat.
// Only mastra lists background-agents, and strands has no folder for it.

describe("demoPath", () => {
  it("puts the demo under the integration from INTEGRATION", () => {
    expect(demoPath("agentic-chat")).toBe("/demos/strands/agentic-chat");
  });
});

describe("requireIntegration", () => {
  it("returns the integration that has the slug", () => {
    expect(requireIntegration("strands")).toMatchObject({
      slug: "strands",
      name: "AWS Strands (Python)",
    });
  });

  it("fails with a clear error when INTEGRATION is not set", () => {
    expect(() => requireIntegration(undefined)).toThrow(
      "INTEGRATION is not set. Set it to the integration to test",
    );
  });

  it("fails with a clear error for a slug no manifest has", () => {
    expect(() => requireIntegration("no-such-integration")).toThrow(
      'INTEGRATION="no-such-integration" is not a known integration.',
    );
  });
});
