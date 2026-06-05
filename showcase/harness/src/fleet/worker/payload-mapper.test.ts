import { describe, expect, it } from "vitest";
import { createD6PayloadToInput } from "./payload-mapper.js";
import type { ServiceJobPayload } from "../contracts.js";

function payload(over: Partial<ServiceJobPayload> = {}): ServiceJobPayload {
  return {
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    driverKind: "e2e_d6",
    meta: {
      runId: "frun_1",
      triggered: false,
      enqueuedAt: "2026-01-01T00:00:00Z",
    },
    ...over,
  };
}

describe("createD6PayloadToInput", () => {
  it("re-hydrates the serialized driver input verbatim", () => {
    const map = createD6PayloadToInput();
    const input = map(
      payload({
        driverInputs: {
          key: "d6-all-pills-e2e:langgraph-python",
          backendUrl: "https://lg.example.com",
          demos: ["shared-state", "human-in-the-loop"],
          shape: "package",
        },
      }),
    ) as Record<string, unknown>;

    expect(input.key).toBe("d6-all-pills-e2e:langgraph-python");
    expect(input.backendUrl).toBe("https://lg.example.com");
    expect(input.demos).toEqual(["shared-state", "human-in-the-loop"]);
    expect(input.shape).toBe("package");
  });

  it("defaults a missing key to the payload probeKey", () => {
    const map = createD6PayloadToInput();
    const input = map(
      payload({ driverInputs: { backendUrl: "https://lg.example.com" } }),
    ) as Record<string, unknown>;

    expect(input.key).toBe("d6:langgraph-python");
    expect(input.backendUrl).toBe("https://lg.example.com");
  });

  it("does not mutate the payload's driverInputs object", () => {
    const map = createD6PayloadToInput();
    const driverInputs: Record<string, unknown> = {
      backendUrl: "https://lg.example.com",
    };
    map(payload({ driverInputs }));
    expect(driverInputs).toEqual({ backendUrl: "https://lg.example.com" });
    expect("key" in driverInputs).toBe(false);
  });

  it("returns undefined when the payload carries no driver inputs", () => {
    const map = createD6PayloadToInput();
    expect(map(payload())).toBeUndefined();
    expect(map(payload({ driverInputs: undefined }))).toBeUndefined();
  });
});
