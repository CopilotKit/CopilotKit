import { describe, expect, it } from "vitest";

import { getD5Script } from "../helpers/d5-registry.js";
import {
  THREAD_ROUNDTRIP_PROMPT,
  buildTurns,
  validateThreadRoundtrip,
} from "./d5-threadid-frontend-tool-roundtrip.js";

describe("d5 thread-id frontend-tool round trip", () => {
  it("registers a dedicated deterministic fixture-backed probe", () => {
    const script = getD5Script("threadid-frontend-tool-roundtrip");

    expect(script?.featureTypes).toEqual(["threadid-frontend-tool-roundtrip"]);
    expect(script?.fixtureFile).toBe("threadid-frontend-tool-roundtrip.json");
    expect(
      buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "threadid-frontend-tool-roundtrip",
        baseUrl: "https://example.test",
      })[0]?.input,
    ).toBe(THREAD_ROUNDTRIP_PROMPT);
  });

  it("requires the label, browser handler result, and agent follow-up", () => {
    expect(
      validateThreadRoundtrip({
        cardText: "testFrontendToolCalling label: X result: handled X",
        pageText: "Frontend tool finished for X.",
      }),
    ).toBeUndefined();
    expect(
      validateThreadRoundtrip({
        cardText: "testFrontendToolCalling label: X result: pending",
        pageText: "Calling frontend tool.",
      }),
    ).toMatch(/handler result/);
  });
});
