import { describe, it, expect } from "vitest";
import { CopilotKitCore } from "../core/core";
import { ɵcreateMemoryStore } from "../memories";

describe("CopilotKitCore memory store registry", () => {
  it("registers and retrieves a store by agentId", () => {
    const core = new CopilotKitCore({});
    const store = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store);
    expect(core.getMemoryStore("agent-1")).toBe(store);
  });

  it("returns undefined for an unknown agentId", () => {
    const core = new CopilotKitCore({});
    expect(core.getMemoryStore("unknown")).toBeUndefined();
  });

  it("unregisters a store", () => {
    const core = new CopilotKitCore({});
    const store = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store);
    core.unregisterMemoryStore("agent-1");
    expect(core.getMemoryStore("agent-1")).toBeUndefined();
  });

  it("getMemoryStores() returns a stable frozen snapshot between mutations", () => {
    const core = new CopilotKitCore({});
    const store = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store);
    const snapshot1 = core.getMemoryStores();
    const snapshot2 = core.getMemoryStores();
    expect(snapshot1).toBe(snapshot2);
    expect(Object.keys(snapshot1)).toEqual(["agent-1"]);
  });
});
