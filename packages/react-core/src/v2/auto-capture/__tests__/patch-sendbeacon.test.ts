import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoCaptureBridge } from "../bridge";
import {
  createPatchedSendBeacon,
  patchSendBeacon,
  restoreSendBeacon,
} from "../patch-sendbeacon";
import type { RawExchange } from "../types";

type SendBeacon = (url: string | URL, data?: BodyInit | null) => boolean;

const makeBridge = (): { bridge: AutoCaptureBridge; calls: RawExchange[] } => {
  const calls: RawExchange[] = [];
  const bridge: AutoCaptureBridge = {
    enabled: true,
    dispatch: (raw) => calls.push(raw),
  };
  return { bridge, calls };
};

let originalNavigatorSendBeacon: SendBeacon | undefined;
let fakeSendBeacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom doesn't ship `navigator.sendBeacon`. Install a controllable fake so
  // patchSendBeacon has something to wrap; restoring this between tests keeps
  // any prior leak from interfering.
  originalNavigatorSendBeacon = (
    navigator as Navigator & {
      sendBeacon?: SendBeacon;
    }
  ).sendBeacon;
  fakeSendBeacon = vi.fn((): boolean => true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: fakeSendBeacon,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  restoreSendBeacon();
  if (originalNavigatorSendBeacon === undefined) {
    // Remove the property entirely if it didn't exist before this test.
    // Cast to a shape where the property is optional so `delete` is well-typed.
    delete (navigator as { sendBeacon?: SendBeacon }).sendBeacon;
  } else {
    Object.defineProperty(navigator, "sendBeacon", {
      value: originalNavigatorSendBeacon,
      writable: true,
      configurable: true,
    });
  }
});

describe("createPatchedSendBeacon", () => {
  it("dispatches a capture and still calls through to the original", () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn((): boolean => true);
    const patched = createPatchedSendBeacon(original as SendBeacon, bridge);

    const queued = patched.call(
      navigator,
      "/api/telemetry",
      JSON.stringify({ event: "click", id: 1 }),
    );

    expect(queued).toBe(true);
    expect(original).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${window.location.origin}/api/telemetry`,
      requestBody: { event: "click", id: 1 },
      status: 0,
      durationMs: 0,
    });
    expect(calls[0]!.responseBody).toBeUndefined();
  });

  it("returns the original boolean (e.g. false = queue rejected)", () => {
    const { bridge } = makeBridge();
    const original = vi.fn((): boolean => false);
    const patched = createPatchedSendBeacon(original as SendBeacon, bridge);

    expect(patched.call(navigator, "/api/x")).toBe(false);
  });

  it("does not dispatch when the bridge is disabled", () => {
    const { bridge, calls } = makeBridge();
    bridge.enabled = false;
    const original = vi.fn((): boolean => true);
    const patched = createPatchedSendBeacon(original as SendBeacon, bridge);

    patched.call(navigator, "/api/x");

    expect(original).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("decodes a FormData payload into a plain object", () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn((): boolean => true);
    const patched = createPatchedSendBeacon(original as SendBeacon, bridge);

    const form = new FormData();
    form.append("title", "hello");
    form.append("file", new Blob(["x"]), "x.txt");
    patched.call(navigator, "/api/upload", form);

    expect(calls[0]!.requestBody).toEqual({ title: "hello", file: "[file]" });
  });

  it("treats binary BodyInit (Blob) as undefined requestBody", () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn((): boolean => true);
    const patched = createPatchedSendBeacon(original as SendBeacon, bridge);

    patched.call(navigator, "/api/bin", new Blob([new Uint8Array([1, 2, 3])]));

    expect(calls[0]!.requestBody).toBeUndefined();
  });

  it("never throws into the caller even when dispatch throws", () => {
    const original = vi.fn((): boolean => true);
    const bridge: AutoCaptureBridge = {
      enabled: true,
      dispatch: () => {
        throw new Error("boom");
      },
    };
    const patched = createPatchedSendBeacon(original as SendBeacon, bridge);

    expect(() => patched.call(navigator, "/api/x")).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
  });
});

describe("patchSendBeacon install / restore", () => {
  it("installs the patch and restores the original exactly", () => {
    const { bridge } = makeBridge();
    const before = navigator.sendBeacon;

    patchSendBeacon(bridge);
    expect(navigator.sendBeacon).not.toBe(before);

    restoreSendBeacon();
    expect(navigator.sendBeacon).toBe(before);
  });

  it("is idempotent — a second install does not double-wrap", () => {
    const { bridge } = makeBridge();
    patchSendBeacon(bridge);
    const afterFirst = navigator.sendBeacon;

    patchSendBeacon(bridge);
    expect(navigator.sendBeacon).toBe(afterFirst);

    restoreSendBeacon();
  });
});
