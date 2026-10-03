import { describe, it, expect, vi } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildA2uiFixedAssertion,
  preNavigateRoute,
  A2UI_FIXED_PILL_PROMPT,
} from "./d5-gen-ui-a2ui-fixed.js";

describe("d5-gen-ui-a2ui-fixed script", () => {
  it("registers under featureType 'gen-ui-a2ui-fixed'", () => {
    const script = getD5Script("gen-ui-a2ui-fixed");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-a2ui-fixed.json");
  });

  it("preNavigateRoute resolves /demos/a2ui-fixed-schema", () => {
    expect(preNavigateRoute("gen-ui-a2ui-fixed")).toBe(
      "/demos/a2ui-fixed-schema",
    );
  });

  it("buildTurns sends the SFO/JFK pill prompt with extended timeout", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-a2ui-fixed",
      baseUrl: "https://x.test",
    };
    const turn = buildTurns(ctx)[0]!;
    expect(turn.input).toBe(A2UI_FIXED_PILL_PROMPT);
    expect(turn.responseTimeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(turn.completeOnMount).toEqual({
      testIds: ["a2ui-fixed-card"],
    });
  });

  it("assertion succeeds when waitForSelector resolves for the testid", async () => {
    const waitForSelector = vi.fn().mockResolvedValue(undefined);
    const page: Page = {
      waitForSelector: waitForSelector as Page["waitForSelector"],
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        innerText: async () =>
          "Flight Details\nSFO\nJFK\nUNITED\n$289\nBook flight",
      }),
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return {
          airports: ["SFO", "JFK"],
          airline: ["UNITED"],
          price: ["$289"],
        } as R;
      },
    };
    const assertion = buildA2uiFixedAssertion({ timeoutMs: 100 });
    await expect(assertion(page)).resolves.toBeUndefined();
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="a2ui-fixed-card"]',
      expect.objectContaining({ state: "visible" }),
    );
  });

  it("assertion fails when waitForSelector throws (testid never mounts)", async () => {
    const page: Page = {
      async waitForSelector() {
        throw new Error("timeout");
      },
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    const assertion = buildA2uiFixedAssertion({ timeoutMs: 100 });
    await expect(assertion(page)).rejects.toThrow(/a2ui-fixed-card.*mount/);
  });
});

it("keeps the canonical pill identical across three backends and marks Book flight incomplete", () => {
  const turns = ["langgraph-python", "mastra", "strands"].map(
    (integrationSlug) =>
      buildTurns({
        integrationSlug,
        featureType: "gen-ui-a2ui-fixed",
        baseUrl: "http://localhost",
      }),
  );
  for (const turn of turns)
    expect(turn[0]?.action).toEqual({
      id: "find-flight",
      kind: "pill-dispatch",
      label: "Find SFO → JFK",
      prompt: A2UI_FIXED_PILL_PROMPT,
    });
  const canonical = getD5Script("gen-ui-a2ui-fixed")?.canonical;
  expect(canonical?.requiredActionIds).toEqual(["find-flight", "book-flight"]);
  expect(canonical?.incompleteReason).toMatch(/Book flight/);
});

it.each(["SFO JFK United $290", "JFK SFO United $289", "SFO JFK Delta $289"])(
  "rejects visible incorrect flight values: %s",
  async (text) => {
    const page = {
      waitForSelector: async () => undefined,
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        innerText: async () => text,
      }),
      evaluate: async () => ({
        airports: text.startsWith("JFK") ? ["JFK", "SFO"] : ["SFO", "JFK"],
        airline: [text.includes("Delta") ? "Delta" : "United"],
        price: [text.includes("$290") ? "$290" : "$289"],
      }),
    } as unknown as Page;
    await expect(
      buildA2uiFixedAssertion({ timeoutMs: 20 })(page),
    ).rejects.toThrow(/flight values/);
  },
);

it("honest-proof rejects a title echo of canonical values when actual flight value nodes differ", async () => {
  const values = {
    airports: ["BOS", "SEA"],
    airline: ["DELTA"],
    price: ["$999"],
  };
  const page = {
    waitForSelector: async () => undefined,
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      innerText: async () => "SFO JFK United $289\nBOS SEA DELTA $999",
    }),
    evaluate: async () => values,
  } as unknown as Page;
  await expect(
    buildA2uiFixedAssertion({ timeoutMs: 20 })(page),
  ).rejects.toThrow(/flight values/);
});
