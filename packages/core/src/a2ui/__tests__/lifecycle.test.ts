import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  A2UI_SURFACE_CONTENT_SCHEMA,
  A2UIActivityController,
  formatA2UIDebugPayload,
  formatA2UIRetryLabel,
  getA2UIProgressPhase,
  readA2UILifecycle,
  resolveA2UIDebugExposure,
} from "../lifecycle";
import type { A2UIActivityControllerOptions } from "../lifecycle";

const staticOps = {
  a2ui_operations: [
    { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "c" } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "s",
        components: [{ id: "root", component: "Text", text: "Hi" }],
      },
    },
  ],
};
const createOnly = {
  a2ui_operations: [
    { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "c" } },
  ],
};

describe("readA2UILifecycle", () => {
  it("keeps typed fields and drops mistyped ones", () => {
    expect(
      readA2UILifecycle({
        status: "retrying",
        attempt: 2,
        maxAttempts: "3",
        errors: [{ code: "x" }],
        debugExposure: "verbose",
      }),
    ).toEqual({
      status: "retrying",
      attempt: 2,
      maxAttempts: undefined,
      progressTokens: undefined,
      error: undefined,
      errors: [{ code: "x" }],
      attempts: undefined,
      debugExposure: "verbose",
    });
  });

  it("reads unknown status and non-objects as building", () => {
    expect(readA2UILifecycle({ status: "weird" }).status).toBe("building");
    expect(readA2UILifecycle(null)).toEqual({ status: "building" });
  });
});

describe("resolveA2UIDebugExposure", () => {
  it("prefers the server value, then the option, then collapsed", () => {
    expect(
      resolveA2UIDebugExposure(
        { status: "failed", debugExposure: "verbose" },
        "hidden",
      ),
    ).toBe("verbose");
    expect(resolveA2UIDebugExposure({ status: "failed" }, "hidden")).toBe(
      "hidden",
    );
    expect(resolveA2UIDebugExposure({ status: "failed" })).toBe("collapsed");
  });
});

describe("getA2UIProgressPhase", () => {
  it.each([
    [undefined, 3],
    [0, 0],
    [49, 0],
    [50, 1],
    [199, 1],
    [200, 2],
    [399, 2],
    [400, 3],
  ])("maps %s tokens to phase %i", (tokens, phase) => {
    expect(getA2UIProgressPhase(tokens)).toBe(phase);
  });
});

describe("formatA2UIRetryLabel", () => {
  it("says building until a retry is revealed", () => {
    expect(
      formatA2UIRetryLabel({ status: "retrying", attempt: 1 }, false),
    ).toBe("Building interface");
  });

  it("shows the attempt count when known", () => {
    expect(
      formatA2UIRetryLabel(
        { status: "retrying", attempt: 2, maxAttempts: 3 },
        true,
      ),
    ).toBe("Retrying generation… (2/3 attempts)");
    expect(formatA2UIRetryLabel({ status: "retrying" }, true)).toBe(
      "Retrying generation…",
    );
  });
});

describe("formatA2UIDebugPayload", () => {
  it("pretty-prints JSON and survives circular references", () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;
    expect(formatA2UIDebugPayload(value)).toBe(
      '{\n  "a": 1,\n  "self": "[Circular]"\n}',
    );
  });
});

describe("A2UIActivityController", () => {
  const warn = vi.fn<(message: string) => void>();
  let controller: A2UIActivityController;

  function create(options: A2UIActivityControllerOptions = {}) {
    controller = new A2UIActivityController({ warn, ...options });
    return controller;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    warn.mockReset();
  });
  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it("shows the lifecycle state while there are no operations", () => {
    create().setContent({ status: "building", progressTokens: 97 });
    expect(controller.getSnapshot()).toMatchObject({
      view: "lifecycle",
      label: "Building interface",
      progressPhase: 1,
      showDebugDetails: false,
    });
  });

  it("keeps the same snapshot object until something changes", () => {
    create();
    const content = { status: "building" };
    controller.setContent(content);
    const first = controller.getSnapshot();
    controller.setContent(content);
    expect(controller.getSnapshot()).toBe(first);
  });

  it("reveals a retry at once when attempt reaches showAfterAttempts", () => {
    create().setContent({ status: "retrying", attempt: 2, maxAttempts: 3 });
    expect(controller.getSnapshot()).toMatchObject({
      retryRevealed: true,
      label: "Retrying generation… (2/3 attempts)",
    });
  });

  it("reveals an early retry after showAfterMs", () => {
    create({ recovery: { showAfterMs: 500 } });
    controller.setContent({ status: "retrying", attempt: 1 });
    expect(controller.getSnapshot().retryRevealed).toBe(false);
    vi.advanceTimersByTime(500);
    expect(controller.getSnapshot().retryRevealed).toBe(true);
  });

  it("does not restart the retry timer when streamed snapshots arrive", () => {
    create({ recovery: { showAfterMs: 500 } });
    controller.setContent({
      status: "retrying",
      attempt: 1,
      progressTokens: 10,
    });
    vi.advanceTimersByTime(400);
    controller.setContent({
      status: "retrying",
      attempt: 1,
      progressTokens: 30,
    });
    vi.advanceTimersByTime(100);
    expect(controller.getSnapshot().retryRevealed).toBe(true);
  });

  it("shows retry validation issues only once revealed and not hidden", () => {
    create({ recovery: { debugExposure: "verbose" } });
    controller.setContent({
      status: "retrying",
      attempt: 2,
      errors: [{ code: "missing_required_prop" }],
    });
    expect(controller.getSnapshot()).toMatchObject({
      showDebugDetails: true,
      debugDetailsOpen: true,
      debugDetailsLabel: "validation issues",
    });
    expect(controller.getSnapshot().debugPayload).toContain(
      "missing_required_prop",
    );
  });

  it("shows failure details unless debugExposure is hidden", () => {
    create().setContent({ status: "failed", error: "boom" });
    expect(controller.getSnapshot()).toMatchObject({
      showDebugDetails: true,
      debugDetailsOpen: false,
      debugDetailsLabel: "developer details",
    });
    controller.setContent({
      status: "failed",
      error: "boom",
      debugExposure: "hidden",
    });
    expect(controller.getSnapshot().showDebugDetails).toBe(false);
  });

  it("holds the last pre-paint state during the hand-off, then shows the surface after paint", () => {
    create();
    controller.setContent({ status: "building", progressTokens: 120 });
    controller.setContent(staticOps);
    expect(controller.getSnapshot()).toMatchObject({
      view: "handoff",
      lifecycle: { status: "building", progressTokens: 120 },
    });
    controller.markRendered();
    expect(controller.getSnapshot().view).toBe("surface");
    vi.advanceTimersByTime(8000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not end the hand-off before the surface can paint", () => {
    create().setContent(createOnly);
    controller.markRendered();
    expect(controller.getSnapshot().view).toBe("handoff");
  });

  it("ends the hand-off after 8s without paint and warns why", () => {
    create().setContent(createOnly);
    vi.advanceTimersByTime(7999);
    expect(controller.getSnapshot().view).toBe("handoff");
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().view).toBe("surface");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(
      'A2UI surface "s" received operations and never painted',
    );
  });

  it("waits a frame before ending the hand-off", () => {
    const frames: (() => void)[] = [];
    create({ requestFrame: (callback) => frames.push(callback) });
    controller.setContent(staticOps);
    controller.markRendered();
    expect(controller.getSnapshot().view).toBe("handoff");
    frames[0]!();
    expect(controller.getSnapshot().view).toBe("surface");
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = create().subscribe(listener);
    controller.setContent({ status: "building" });
    unsubscribe();
    controller.setContent({ status: "failed" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops its timers on dispose and starts again from the next content", () => {
    create().setContent(createOnly);
    controller.dispose();
    vi.advanceTimersByTime(8000);
    expect(warn).not.toHaveBeenCalled();
    expect(controller.getSnapshot().view).toBe("lifecycle");

    controller.setContent(createOnly);
    expect(controller.getSnapshot().view).toBe("handoff");
    vi.advanceTimersByTime(8000);
    expect(controller.getSnapshot().view).toBe("surface");
  });
});

describe("A2UI_SURFACE_CONTENT_SCHEMA", () => {
  const validate = (value: unknown) =>
    A2UI_SURFACE_CONTENT_SCHEMA["~standard"].validate(value);

  it("accepts any object, including mistyped lifecycle fields", () => {
    const content = { status: "unknown", a2ui_operations: [] };
    expect(validate(content)).toEqual({ value: content });
  });

  it("rejects content that is not an object", () => {
    expect(validate("nope")).toEqual({
      issues: [{ message: "a2ui-surface content must be an object" }],
    });
  });
});
