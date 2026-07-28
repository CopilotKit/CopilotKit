import { describe, it, expect } from "vitest";
import catalog from "../../telemetry-events.json" with { type: "json" };
import { CHANNEL_TELEMETRY_EVENTS } from "./channel-telemetry.js";

describe("telemetry-events.json", () => {
  it("documents exactly the emitted events", () => {
    expect(Object.keys(catalog.events).sort()).toEqual(
      [...CHANNEL_TELEMETRY_EVENTS].sort(),
    );
  });
});
