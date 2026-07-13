import { describe, expect, it } from "vitest";
import { createBot, Message } from "@copilotkit/channels";
import { runStateStoreConformance } from "@copilotkit/channels/testing";

describe("@copilotkit/channels compatibility facade", () => {
  it("forwards the existing root and testing APIs", () => {
    expect(typeof createBot).toBe("function");
    expect(typeof Message).toBe("function");
    expect(typeof runStateStoreConformance).toBe("function");
  });
});
