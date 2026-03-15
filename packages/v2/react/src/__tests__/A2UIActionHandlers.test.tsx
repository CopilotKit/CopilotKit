import { describe, it, expect } from "vitest";
import {
  defaultActionOrchestrator,
  buildActionHandlers,
} from "../a2ui/A2UIMessageRenderer";
import type {
  A2UIUserAction,
  A2UIActionHandler,
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

const BOOKED_OPS = [
  { surfaceUpdate: { surfaceId: "surface-1", components: [] } },
];
const CANCELLED_OPS = [
  { dataModelUpdate: { surfaceId: "surface-1", contents: [] } },
];
const CATCHALL_OPS = [
  { beginRendering: { surfaceId: "surface-1", root: "root" } },
];
const HOOK_OPS = [
  { surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "hook" }] } },
];

describe("A2UI Action Handler Resolution", () => {
  describe("pre-declared handlers", () => {
    it("exact action name match fires", () => {
      const handlers = buildActionHandlers({ book_flight: BOOKED_OPS }, []);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("catch-all fires when no exact match", () => {
      const handlers = buildActionHandlers({ "*": CATCHALL_OPS }, []);
      const result = defaultActionOrchestrator(
        makeAction("unknown_action"),
        handlers,
      );
      expect(result).toEqual(CATCHALL_OPS);
    });

    it("exact match takes priority over catch-all", () => {
      const handlers = buildActionHandlers(
        { book_flight: BOOKED_OPS, "*": CATCHALL_OPS },
        [],
      );
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("catch-all fires for non-matching action when exact matches exist for other actions", () => {
      const handlers = buildActionHandlers(
        {
          book_flight: BOOKED_OPS,
          cancel_flight: CANCELLED_OPS,
          "*": CATCHALL_OPS,
        },
        [],
      );
      const result = defaultActionOrchestrator(
        makeAction("other_action"),
        handlers,
      );
      expect(result).toEqual(CATCHALL_OPS);
    });

    it("returns null when no match and no catch-all", () => {
      const handlers = buildActionHandlers({ book_flight: BOOKED_OPS }, []);
      const result = defaultActionOrchestrator(
        makeAction("unknown_action"),
        handlers,
      );
      expect(result).toBeNull();
    });

    it("multiple exact matches — correct one fires", () => {
      const handlers = buildActionHandlers(
        { book_flight: BOOKED_OPS, cancel_flight: CANCELLED_OPS },
        [],
      );
      expect(
        defaultActionOrchestrator(makeAction("book_flight"), handlers),
      ).toEqual(BOOKED_OPS);
      expect(
        defaultActionOrchestrator(makeAction("cancel_flight"), handlers),
      ).toEqual(CANCELLED_OPS);
    });
  });

  describe("hook-registered handlers", () => {
    it("hook handler fires when no pre-declared handlers", () => {
      const hookHandler: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? HOOK_OPS : null;

      const handlers = buildActionHandlers(undefined, [hookHandler]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toEqual(HOOK_OPS);
    });

    it("first matching hook handler wins", () => {
      const hookA: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? BOOKED_OPS : null;
      const hookB: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? HOOK_OPS : null;

      const handlers = buildActionHandlers(undefined, [hookA, hookB]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("non-matching hook handlers are skipped", () => {
      const hookHandler: A2UIActionHandler = (action) =>
        action.name === "other" ? HOOK_OPS : null;

      const handlers = buildActionHandlers(undefined, [hookHandler]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toBeNull();
    });
  });

  describe("priority: pre-declared > hooks", () => {
    it("pre-declared exact match takes priority over hook handler", () => {
      const hookHandler: A2UIActionHandler = () => HOOK_OPS;

      const handlers = buildActionHandlers({ book_flight: BOOKED_OPS }, [
        hookHandler,
      ]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toEqual(BOOKED_OPS);
    });

    it("pre-declared catch-all takes priority over hook handler", () => {
      const hookHandler: A2UIActionHandler = () => HOOK_OPS;

      const handlers = buildActionHandlers({ "*": CATCHALL_OPS }, [
        hookHandler,
      ]);
      const result = defaultActionOrchestrator(
        makeAction("anything"),
        handlers,
      );
      expect(result).toEqual(CATCHALL_OPS);
    });

    it("hook handler fires when pre-declared has no match and no catch-all", () => {
      const hookHandler: A2UIActionHandler = (action) =>
        action.name === "book_flight" ? HOOK_OPS : null;

      const handlers = buildActionHandlers({ cancel_flight: CANCELLED_OPS }, [
        hookHandler,
      ]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toEqual(HOOK_OPS);
    });
  });

  describe("edge cases", () => {
    it("no handlers at all returns null", () => {
      const handlers = buildActionHandlers(undefined, []);
      const result = defaultActionOrchestrator(
        makeAction("anything"),
        handlers,
      );
      expect(result).toBeNull();
    });

    it("empty declared handlers map returns null", () => {
      const handlers = buildActionHandlers({}, []);
      const result = defaultActionOrchestrator(
        makeAction("anything"),
        handlers,
      );
      expect(result).toBeNull();
    });

    it("handler returning empty array is skipped", () => {
      const hookHandler: A2UIActionHandler = () => [];

      const handlers = buildActionHandlers(undefined, [hookHandler]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toBeNull();
    });

    it("handler returning undefined is skipped", () => {
      const hookHandler: A2UIActionHandler = () => undefined;

      const handlers = buildActionHandlers(undefined, [hookHandler]);
      const result = defaultActionOrchestrator(
        makeAction("book_flight"),
        handlers,
      );
      expect(result).toBeNull();
    });
  });
});
