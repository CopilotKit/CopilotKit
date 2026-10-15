import { describe, it, expect } from "vitest";
import { readCopilotKitUIEnvelope } from "../a2ui-envelope";

describe("readCopilotKitUIEnvelope", () => {
  const envelope = {
    method: "a2ui",
    version: "v0.9",
    format: 1,
    mode: "markdown",
    catalog: { id: "https://copilotkit.ai/a2ui/catalogs/standard/v1" },
    instructions: "Write fences.",
    contextSent: true,
  };

  it("reads the envelope from forwardedProps.copilotkit.ui", () => {
    expect(
      readCopilotKitUIEnvelope({ copilotkit: { ui: envelope }, other: 1 }),
    ).toEqual(envelope);
  });

  it("returns undefined when the envelope is absent or malformed", () => {
    expect(readCopilotKitUIEnvelope(undefined)).toBeUndefined();
    expect(readCopilotKitUIEnvelope({})).toBeUndefined();
    expect(readCopilotKitUIEnvelope({ copilotkit: {} })).toBeUndefined();
    expect(
      readCopilotKitUIEnvelope({ copilotkit: { ui: { method: "other" } } }),
    ).toBeUndefined();
    expect(
      readCopilotKitUIEnvelope({
        copilotkit: { ui: { ...envelope, mode: "fence" } },
      }),
    ).toBeUndefined();
  });
});
