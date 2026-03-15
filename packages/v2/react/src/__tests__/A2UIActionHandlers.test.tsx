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

function makeAction(name: string): A2UIUserAction {
  return {
    name,
    sourceComponentId: "btn",
    surfaceId: "surface-1",
    timestamp: new Date().toISOString(),
    context: { flightNumber: "UA123" },
  };
}

const BOOKED_OPS: A2UIOps = [
  { surfaceUpdate: { surfaceId: "surface-1", components: [] } },
];
const CANCELLED_OPS: A2UIOps = [
  { dataModelUpdate: { surfaceId: "surface-1", contents: [] } },
];
const CATCHALL_OPS: A2UIOps = [
  { beginRendering: { surfaceId: "surface-1", root: "root" } },
];
const HOOK_OPS: A2UIOps = [
  {
    surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "hook" }] },
  },
];

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

  describe("hook handlers receive declaredOps", () => {
    it("hook receives declaredOps and can use them", () => {
      const hookHandler: A2UIActionHandler = (_action, declaredOps) => {
        // Pass through declared ops
        return declaredOps;
      };

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookHandler],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("hook receives null declaredOps when no match", () => {
      let receivedDeclaredOps: unknown = "not-called";
      const hookHandler: A2UIActionHandler = (_action, declaredOps) => {
        receivedDeclaredOps = declaredOps;
        return HOOK_OPS;
      };

      defaultActionOrchestrator(makeAction("book_flight"), [hookHandler], {
        cancel_flight: CANCELLED_OPS,
      });
      expect(receivedDeclaredOps).toBeNull();
    });

    it("hook can override declared ops", () => {
      const hookHandler: A2UIActionHandler = (_action, _declaredOps) => {
        return HOOK_OPS; // Ignore declared, return own
      };

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookHandler],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(HOOK_OPS);
    });

    it("hook can ignore and return null — falls back to declared", () => {
      const hookHandler: A2UIActionHandler = () => null;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookHandler],
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
      const hookHandler: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? HOOK_OPS : null;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookHandler],
        undefined,
      );
      expect(result).toEqual(HOOK_OPS);
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
      const hookHandler: A2UIActionHandler = () => [];

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookHandler],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("hook returning undefined is skipped, falls back to declared", () => {
      const hookHandler: A2UIActionHandler = () => undefined;

      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        [hookHandler],
        { book_flight: BOOKED_OPS },
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("all hooks skip, no declared → null", () => {
      const hookHandler: A2UIActionHandler = () => null;

      const result = defaultActionOrchestrator(
        makeAction("anything"),
        [hookHandler],
        undefined,
      );
      expect(result).toBeNull();
    });
  });
});
