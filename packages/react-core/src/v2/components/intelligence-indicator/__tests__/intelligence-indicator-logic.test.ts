import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/client";
import {
  getIntelligenceTurnAnchors,
  initialIndicatorPhase,
  INTELLIGENCE_TURN_HEAD,
  resolveGracePhase,
} from "../IntelligenceIndicator";

/**
 * Pure logic for the intelligence indicator — the decisions that the live
 * grace-window timer merely *delays*. Testing them directly keeps the suite
 * deterministic with zero timers (no `setTimeout`, no fake clock): the timing
 * is a trusted platform debounce, the logic is what we assert.
 */

// ── Message builders ────────────────────────────────────────────────────

const BASH = "copilotkit_knowledge_base_shell";

const assistant = (id: string, toolNames: string[] = []): Message =>
  ({
    id,
    role: "assistant",
    content: "",
    toolCalls: toolNames.map((name, i) => ({
      id: `${id}-tc${i}`,
      type: "function",
      function: { name, arguments: "{}" },
    })),
  }) as unknown as Message;

const user = (id: string): Message =>
  ({ id, role: "user", content: "hi" }) as unknown as Message;

// ── initialIndicatorPhase ─────────────────────────────────────────────────

describe("initialIndicatorPhase", () => {
  it("mounts straight into finished when the turn is already complete", () => {
    expect(initialIndicatorPhase(true)).toBe("finished");
  });

  it("mounts hidden while the turn is still in flight", () => {
    expect(initialIndicatorPhase(false)).toBe("hidden");
  });
});

// ── resolveGracePhase ─────────────────────────────────────────────────────

describe("resolveGracePhase", () => {
  it("resolves to finished when the turn completed within the grace window (replay-flash suppression)", () => {
    // turnComplete wins even if a matching call still looks pending — this is
    // exactly the "tool result landed in the same burst" case, which must NOT
    // flash a spinner.
    expect(resolveGracePhase(true, true)).toBe("finished");
    expect(resolveGracePhase(true, false)).toBe("finished");
  });

  it("resolves to spinner for a still-pending matching tool call", () => {
    expect(resolveGracePhase(false, true)).toBe("spinner");
  });

  it("stays hidden when nothing is pending yet and the turn is not complete", () => {
    expect(resolveGracePhase(false, false)).toBe("hidden");
  });
});

// ── getIntelligenceTurnAnchors ────────────────────────────────────────────

describe("getIntelligenceTurnAnchors", () => {
  it("returns no anchors when no message uses a matching tool", () => {
    const anchors = getIntelligenceTurnAnchors([
      user("u1"),
      assistant("a1", ["some_other_tool"]),
      assistant("a2"),
    ]);
    expect(anchors.size).toBe(0);
  });

  it("anchors the FIRST bash-using message of a turn, not later ones", () => {
    const anchors = getIntelligenceTurnAnchors([
      assistant("a1", [BASH]),
      assistant("a2", [BASH]),
    ]);
    expect([...anchors.keys()]).toEqual(["a1"]);
    expect(anchors.get("a1")).toBe(INTELLIGENCE_TURN_HEAD);
  });

  it("uses INTELLIGENCE_TURN_HEAD for a turn with no opening user message", () => {
    const anchors = getIntelligenceTurnAnchors([assistant("a0", [BASH])]);
    expect(anchors.get("a0")).toBe(INTELLIGENCE_TURN_HEAD);
  });

  it("keys each turn by its opening user message and keeps one anchor per turn", () => {
    const anchors = getIntelligenceTurnAnchors([
      user("u1"),
      assistant("a1", [BASH]),
      user("u2"),
      assistant("a2", [BASH]),
      assistant("a3", [BASH]),
    ]);
    expect(anchors.get("a1")).toBe("u1");
    expect(anchors.get("a2")).toBe("u2");
    expect(anchors.has("a3")).toBe(false);
    expect(anchors.size).toBe(2);
  });

  it("matches the namespaced mcp__ tool name", () => {
    const anchors = getIntelligenceTurnAnchors([
      assistant("a1", [`mcp__intelligence__${BASH}`]),
    ]);
    expect(anchors.get("a1")).toBe(INTELLIGENCE_TURN_HEAD);
  });

  it("ignores tool calls on non-assistant messages", () => {
    const toolMsg = {
      id: "t1",
      role: "tool",
      toolCallId: "x",
      content: "result",
    } as unknown as Message;
    expect(getIntelligenceTurnAnchors([toolMsg]).size).toBe(0);
  });
});
