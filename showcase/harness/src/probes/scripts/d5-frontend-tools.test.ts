import { describe, it, expect } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildPillAssertion,
  FRONTEND_TOOL_PILLS,
} from "./d5-frontend-tools.js";

function makePage(value: unknown): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return value as R;
    },
  };
}

describe("d5-frontend-tools script", () => {
  it("registers the existing frontend-tools fixture", () => {
    const script = getD5Script("frontend-tools")!;
    expect(script.featureTypes).toEqual(["frontend-tools"]);
    expect(script.fixtureFile).toBe("frontend-tools.json");
  });
  it("uses the complete public theme-button program with grounded assertions", () => {
    const script = getD5Script("frontend-tools")!;
    const turns = buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "frontend-tools",
      baseUrl: "https://example.test",
    });
    expect(script.canonical?.requiredActionIds).toEqual([
      "sunset",
      "forest",
      "cosmic",
    ]);
    expect(turns.map((turn) => turn.action?.label)).toEqual([
      "Sunset theme",
      "Forest theme",
      "Cosmic theme",
    ]);
    expect(turns.map((turn) => turn.input)).toEqual([
      "Make the background a sunset gradient.",
      "Switch to a deep green forest gradient.",
      "Make it a navy → magenta cosmic gradient.",
    ]);
    expect(
      turns.every(
        (turn) =>
          turn.assertionId === "frontend-tools-gradients-v1" && turn.assertions,
      ),
    ).toBe(true);
  });
  const rendered = {
    count: 1,
    visible: true,
    value: FRONTEND_TOOL_PILLS[0].gradient,
    rendered: "normalized-gradient",
    expected: "normalized-gradient",
    labels: FRONTEND_TOOL_PILLS.map((action) => action.label),
  };
  it("accepts the expected visible rendered background", async () => {
    const baseline = { current: "#4f46e5" };
    await expect(
      buildPillAssertion("sunset", baseline)(makePage(rendered)),
    ).resolves.toBeUndefined();
    expect(baseline.current).toBe(rendered.value);
  });
  it.each([
    ["attribute-only claim", { ...rendered, rendered: "none" }],
    ["hidden background", { ...rendered, visible: false }],
    ["wrong gradient", { ...rendered, value: FRONTEND_TOOL_PILLS[1].gradient }],
    ["duplicate surface", { ...rendered, count: 2 }],
    ["incomplete button inventory", { ...rendered, labels: ["Sunset theme"] }],
    [
      "extra button",
      { ...rendered, labels: [...rendered.labels, "Unknown theme"] },
    ],
  ])("rejects %s", async (_name, observed) => {
    await expect(
      buildPillAssertion("sunset", { current: "#4f46e5" })(makePage(observed)),
    ).rejects.toThrow(/rendered gradient differ/);
  });
});
