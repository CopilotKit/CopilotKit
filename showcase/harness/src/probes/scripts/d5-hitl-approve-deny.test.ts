import type { Page } from "../helpers/conversation-runner.js";
import { describe, it, expect, vi } from "vitest";
import { buildTurns, preNavigateRoute } from "./d5-hitl-approve-deny.js";
import {
  APPROVAL_PILLS,
  assertApprovalResult,
} from "./_pill-contracts-hitl.js";

describe("hitl-approve-deny canonical pills", () => {
  const turns = buildTurns({
    integrationSlug: "langgraph-python",
    featureType: "hitl-approve-deny",
    baseUrl: "http://localhost",
  });
  it("covers every canonical pill with exact dispatch", () => {
    expect(turns).toHaveLength(6);
    for (const turn of turns) {
      expect(turn.action?.kind).toBe("pill");
      expect(turn.action?.expectedDispatchedPrompt).toBe(turn.input);
      expect(turn.assertions).toBeTypeOf("function");
      expect(turn.skipSend).toBeUndefined();
    }
  });
  it("has unique required action identities", () => {
    expect(new Set(turns.map((t) => t.action?.id)).size).toBe(turns.length);
  });
  it("does not vary canonical actions by integration", () => {
    const other = buildTurns({
      integrationSlug: "mastra",
      featureType: "hitl-approve-deny",
      baseUrl: "http://localhost",
    });
    expect(other.map((t) => t.action)).toEqual(turns.map((t) => t.action));
  });
  it("uses canonical navigation", () =>
    expect(preNavigateRoute()).toBe("/demos/hitl-in-app"));
  it("includes all approval buttons with both decisions", () => {
    expect(turns.map((t) => t.action?.buttonName)).toEqual(
      APPROVAL_PILLS.flatMap((p) => [p.buttonName, p.buttonName]),
    );
  });
  it("rejects fixture text that claims both approval and rejection", () => {
    const text =
      "I am processing the $50 refund to Jordan Rivera on ticket #12345 now. The refund request was not approved by default.";
    for (const decision of ["approve", "deny"] as const)
      expect(() =>
        assertApprovalResult(text, APPROVAL_PILLS[0], decision),
      ).toThrow("ambiguous or wrong");
  });
  it("requires all ticket values in a branch-specific result", () => {
    expect(() =>
      assertApprovalResult(
        "Approved — processing the $50 refund to Jordan Rivera on ticket #12345.",
        APPROVAL_PILLS[0],
        "approve",
      ),
    ).not.toThrow();
    expect(() =>
      assertApprovalResult(
        "Rejected: $50 refund to Jordan Rivera on ticket #12345.",
        APPROVAL_PILLS[0],
        "deny",
      ),
    ).not.toThrow();
    expect(() =>
      assertApprovalResult(
        "Approved — processing the $50 refund.",
        APPROVAL_PILLS[0],
        "approve",
      ),
    ).toThrow("missing visible value");
  });
});

it.each([
  "Approved — processing the $500 refund to Jordan Rivera on ticket #12345.",
  "Approved — processing the $50 refund to Jordan Rivera on ticket #123450.",
  "Approved — processing the $50 charge to Jordan Rivera on ticket #12345.",
])("rejects incorrect refund relationships: %s", (text) => {
  expect(() =>
    assertApprovalResult(text, APPROVAL_PILLS[0], "approve"),
  ).toThrow();
});

it.each([
  [
    "Approved — processing the $50.01 refund to Jordan Rivera on ticket #12345.",
    0,
  ],
  [
    "Approved — processing the $50 refund to Jordan Rivera-Smith on ticket #12345.",
    0,
  ],
  [
    "Approved — processing the $50 charge. Jordan Rivera requested a refund on ticket #12345.",
    0,
  ],
  [
    "Downgrade confirmed — Priya Shah (#123460) will move to the Starter plan effective next billing cycle.",
    1,
  ],
  [
    "Downgrade confirmed — Priya Shah (#12346) will move to the Starter Plus plan effective next billing cycle.",
    1,
  ],
  [
    "Approved — charge Priya Shah (#12346) to the Starter plan effective next billing cycle.",
    1,
  ],
  ["Approved — closed ticket #12347 to the payments team for Morgan Lee.", 2],
] as const)("rejects corrupted approval values/actions: %s", (text, index) => {
  expect(() =>
    assertApprovalResult(text, APPROVAL_PILLS[index], "approve"),
  ).toThrow();
});

it.each([
  [
    "Approved — processing the $50 refund to Jordan Rivera on ticket #12345.",
    0,
    "approve",
  ],
  ["Rejected: $50 refund to Jordan Rivera on ticket #12345.", 0, "deny"],
  [
    "Downgrade confirmed — Priya Shah (#12346) will move to the Starter plan effective next billing cycle.",
    1,
    "approve",
  ],
  [
    "Rejected: downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle.",
    1,
    "deny",
  ],
  [
    "Escalated ticket #12347 to the payments team for Morgan Lee.",
    2,
    "approve",
  ],
  [
    "Not escalated ticket #12347 to the payments team for Morgan Lee.",
    2,
    "deny",
  ],
] as const)(
  "accepts an unambiguous intended action: %s",
  (text, index, decision) => {
    expect(() =>
      assertApprovalResult(text, APPROVAL_PILLS[index], decision),
    ).not.toThrow();
  },
);

it.each(["Service unavailable", ""])(
  "rejects the canonical resumed error banner regardless of wording: %s",
  async (text) => {
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        expect(selector).toBe('[data-testid="copilot-error-banner"]');
        return {
          textContent: text,
          getBoundingClientRect: () => ({ width: 100, height: 30 }),
        };
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({
      display: "block",
      visibility: "visible",
    }));
    const page: Page = {
      evaluate: async (fn, arg) => fn(arg),
      waitForSelector: async () => {
        throw new Error("unexpected selector wait");
      },
      fill: async () => {
        throw new Error("unexpected input");
      },
      press: async () => {
        throw new Error("unexpected keyboard input");
      },
    };
    try {
      const turn = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "hitl-approve-deny",
        baseUrl: "http://localhost",
      })[0]!;
      expect(turn.assertions).toBeDefined();
      await expect(
        turn.assertions!(page, { bubbleIndex: 0, text: "" }),
      ).rejects.toThrow(`HITL application error: ${text}`);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
