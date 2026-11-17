import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";

// React providers construct the Core during render. Frameworks that prerender
// (Next.js with `cacheComponents`) fail the build when render reads the clock
// or a random value, so constructing a Core must read neither.
describe("CopilotKitCore construction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["without learning", {}],
    ["with learning", { learning: {} }],
  ])("reads no clock or random value %s", (_label, extra) => {
    const now = vi.spyOn(Date, "now");
    const random = vi.spyOn(Math, "random");
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const core = new CopilotKitCore({
      runtimeUrl: "/api/copilotkit",
      deferInitialConnection: true,
      ...extra,
    });

    expect(core).toBeInstanceOf(CopilotKitCore);
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  });
});
