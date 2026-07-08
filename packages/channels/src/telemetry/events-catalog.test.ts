import { describe, it, expect } from "vitest";
import catalog from "../../telemetry-events.json" with { type: "json" };
import { BOT_TELEMETRY_EVENTS } from "./bot-telemetry.js";

describe("telemetry-events.json", () => {
  it("documents exactly the emitted events", () => {
    expect(Object.keys(catalog.events).sort()).toEqual(
      [...BOT_TELEMETRY_EVENTS].sort(),
    );
  });
});
