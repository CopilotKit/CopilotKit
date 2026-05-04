import { describe, it, expect } from "vitest";
import { CopilotKitCore } from "../core";

describe("CopilotKitCore debug config", () => {
  it("stores debug: true", () => {
    const core = new CopilotKitCore({ debug: true });
    expect(core.debug).toBe(true);
  });

  it("stores debug object", () => {
    const core = new CopilotKitCore({
      debug: { events: true, lifecycle: false },
    });
    expect(core.debug).toEqual({ events: true, lifecycle: false });
  });

  it("debug is undefined by default", () => {
    const core = new CopilotKitCore({});
    expect(core.debug).toBeUndefined();
  });
});
