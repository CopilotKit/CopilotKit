import { describe, it, expect } from "vitest";
import {
  defaultActionOrchestrator,
  resolveDeclaredOps,
} from "../a2ui/A2UIMessageRenderer";
import type {
  A2UIUserAction,
  A2UIActionHandler,
  A2UIOps,
} from "../a2ui/A2UIMessageRenderer";

function makeAction(
  name: string,
  overrides: Partial<A2UIUserAction> = {},
): A2UIUserAction {
  return {
    name,
    sourceComponentId: "btn",
    surfaceId: "surface-1",
    timestamp: new Date().toISOString(),
    context: { flightNumber: "UA123" },
    ...overrides,
  };
}

const BOOKED_OPS: A2UIOps = [
  { version: "v0.9", updateComponents: { surfaceId: "surface-1", components: [
    { id: "root", component: "Card", child: "msg" },
    { id: "msg", component: "Text", text: "Booked!", variant: "h2" },
  ] } },
];
const CANCELLED_OPS: A2UIOps = [
  { version: "v0.9", updateComponents: { surfaceId: "surface-1", components: [
    { id: "root", component: "Text", text: "Cancelled", variant: "body" },
  ] } },
];
const CATCHALL_OPS: A2UIOps = [
  { version: "v0.9", updateComponents: { surfaceId: "surface-1", components: [
    { id: "root", component: "Text", text: "Action received", variant: "body" },
  ] } },
];
const HOOK_OPS: A2UIOps = [
  { version: "v0.9", updateComponents: { surfaceId: "surface-1", components: [
    { id: "root", component: "Text", text: "Hook handled", variant: "body" },
  ] } },
];

// ---------------------------------------------------------------
// resolveDeclaredOps
// ---------------------------------------------------------------

describe("resolveDeclaredOps", () => {
  it("returns exact match", () => {
    expect(
      resolveDeclaredOps(makeAction("book_flight"), {
        book_flight: BOOKED_OPS,
      }),
    ).toEqual(BOOKED_OPS);
  });

  it("returns catch-all when no exact match", () => {
    expect(
      resolveDeclaredOps(makeAction("unknown"), { "*": CATCHALL_OPS }),
    ).toEqual(CATCHALL_OPS);
  });

  it("exact match takes priority over catch-all", () => {
    expect(
      resolveDeclaredOps(makeAction("book_flight"), {
        book_flight: BOOKED_OPS,
        "*": CATCHALL_OPS,
      }),
    ).toEqual(BOOKED_OPS);
  });

  it("returns null when no match and no catch-all", () => {
    expect(
      resolveDeclaredOps(makeAction("unknown"), {
        book_flight: BOOKED_OPS,
      }),
    ).toBeNull();
  });

  it("returns null when declaredHandlers is undefined", () => {
    expect(resolveDeclaredOps(makeAction("anything"), undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------
// defaultActionOrchestrator
// ---------------------------------------------------------------

describe("defaultActionOrchestrator", () => {
  describe("pre-declared handlers only (no hooks)", () => {
    it("uses exact match", () => {
      const result = defaultActionOrchestrator(makeAction("book_flight"), [], {
        book_flight: BOOKED_OPS,
      });
      expect(result).toEqual(BOOKED_OPS);
    });

    it("uses catch-all when no exact match", () => {
      const result = defaultActionOrchestrator(makeAction("unknown"), [], {
        "*": CATCHALL_OPS,
      });
      expect(result).toEqual(CATCHALL_OPS);
    });

    it("exact match over catch-all", () => {
      const result = defaultActionOrchestrator(makeAction("book_flight"), [], {
        book_flight: BOOKED_OPS,
        "*": CATCHALL_OPS,
      });
      expect(result).toEqual(BOOKED_OPS);
    });

    it("catch-all for unmatched action alongside other exact matches", () => {
      const result = defaultActionOrchestrator(makeAction("other"), [], {
        book_flight: BOOKED_OPS,
        cancel_flight: CANCELLED_OPS,
        "*": CATCHALL_OPS,
      });
      expect(result).toEqual(CATCHALL_OPS);
    });

    it("returns null when no match and no catch-all", () => {
      const result = defaultActionOrchestrator(makeAction("unknown"), [], {
        book_flight: BOOKED_OPS,
      });
      expect(result).toBeNull();
    });

    it("multiple exact matches — correct one fires", () => {
      const declared = {
        book_flight: BOOKED_OPS,
        cancel_flight: CANCELLED_OPS,
      };
      expect(
        defaultActionOrchestrator(makeAction("book_flight"), [], declared),
      ).toEqual(BOOKED_OPS);
      expect(
        defaultActionOrchestrator(makeAction("cancel_flight"), [], declared),
      ).toEqual(CANCELLED_OPS);
    });
  });

  describe("hook handlers", () => {
    it("hook receives action and declaredOps", () => {
      let receivedAction: A2UIUserAction | null = null;
      let receivedDeclaredOps: unknown = "not-called";

      const hook: A2UIActionHandler = (action, declaredOps) => {
        receivedAction = action;
        receivedDeclaredOps = declaredOps;
        return HOOK_OPS;
      };

      const action = makeAction("book_flight");
      defaultActionOrchestrator(action, [hook], {
        book_flight: BOOKED_OPS,
      });

      expect(receivedAction).toBe(action);
      expect(receivedDeclaredOps).toEqual(BOOKED_OPS);
    });

    it("hook receives null declaredOps when no match", () => {
      let receivedDeclaredOps: unknown = "not-called";
      const hook: A2UIActionHandler = (_action, declaredOps) => {
        receivedDeclaredOps = declaredOps;
        return HOOK_OPS;
      };

      defaultActionOrchestrator(makeAction("book_flight"), [hook], {
        cancel_flight: CANCELLED_OPS,
      });
      expect(receivedDeclaredOps).toBeNull();
    });

    it("hook can pass through declaredOps", () => {
      const hook: A2UIActionHandler = (_action, declaredOps) => declaredOps;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hook],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("hook can override declaredOps", () => {
      const hook: A2UIActionHandler = () => HOOK_OPS;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hook],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(HOOK_OPS);
    });

    it("hook returning null falls back to declaredOps", () => {
      const hook: A2UIActionHandler = () => null;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hook],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("first matching hook wins over later hooks", () => {
      const hookA: A2UIActionHandler = () => BOOKED_OPS;
      const hookB: A2UIActionHandler = () => HOOK_OPS;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookA, hookB],
        undefined,
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("hook fires without pre-declared handlers", () => {
      const hook: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? HOOK_OPS : null;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hook],
        undefined,
      );
      expect(result).toEqual(HOOK_OPS);
    });

    it("hook can filter by action name", () => {
      const hook: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? HOOK_OPS : null;

      expect(
        defaultActionOrchestrator(makeAction("book_flight"), [hook], undefined),
      ).toEqual(HOOK_OPS);
      expect(
        defaultActionOrchestrator(makeAction("other"), [hook], undefined),
      ).toBeNull();
    });

    it("hook can filter by surfaceId", () => {
      const hook: A2UIActionHandler = (action) =>
        action.surfaceId === "surface-1" ? HOOK_OPS : null;

      expect(
        defaultActionOrchestrator(makeAction("any"), [hook], undefined),
      ).toEqual(HOOK_OPS);
      expect(
        defaultActionOrchestrator(
          makeAction("any", { surfaceId: "other-surface" }),
          [hook],
          undefined,
        ),
      ).toBeNull();
    });

    it("hook can filter by context value", () => {
      const hook: A2UIActionHandler = (action) =>
        action.context?.flightNumber === "UA123" ? HOOK_OPS : null;

      expect(
        defaultActionOrchestrator(makeAction("any"), [hook], undefined),
      ).toEqual(HOOK_OPS);
      expect(
        defaultActionOrchestrator(
          makeAction("any", { context: { flightNumber: "OTHER" } }),
          [hook],
          undefined,
        ),
      ).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("no handlers and no declared → null", () => {
      expect(
        defaultActionOrchestrator(makeAction("anything"), [], undefined),
      ).toBeNull();
    });

    it("empty declared map and no hooks → null", () => {
      expect(
        defaultActionOrchestrator(makeAction("anything"), [], {}),
      ).toBeNull();
    });

    it("hook returning empty array is skipped, falls back to declared", () => {
      const hook: A2UIActionHandler = () => [];

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hook],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("hook returning undefined is skipped, falls back to declared", () => {
      const hook: A2UIActionHandler = () => undefined;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hook],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("all hooks skip, no declared → null", () => {
      const hook: A2UIActionHandler = () => null;

      const result = defaultActionOrchestrator(
        makeAction("anything"),
        [hook],
        undefined,
      );
      expect(result).toBeNull();
    });
  });
});
