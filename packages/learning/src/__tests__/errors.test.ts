import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installErrorCapture } from "../errors";
import { createRedactor } from "../redact";

let uninstall: (() => void) | undefined;
// Synthetic error events must not reach Vitest's unhandled-error reporter.
const handled = (event: Event) => event.preventDefault();
beforeEach(() => window.addEventListener("error", handled));
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  window.removeEventListener("error", handled);
  document.body.innerHTML = "";
});

function setup(options: { alerts?: boolean } = {}) {
  const emit = vi.fn();
  uninstall = installErrorCapture({
    emit,
    redact: createRedactor(),
    ...options,
  });
  return emit;
}

const values = (emit: ReturnType<typeof vi.fn>) =>
  emit.mock.calls.map(([name, value]) => {
    expect(name).toBe("page.error");
    return value as Record<string, unknown>;
  });

function throwUncaught(error: unknown, message = "") {
  window.dispatchEvent(
    new ErrorEvent("error", {
      error,
      message,
      filename: "https://app.example/assets/app.js?token=abc123secret",
      lineno: 12,
      colno: 4,
    }),
  );
}

function reject(reason: unknown) {
  window.dispatchEvent(
    Object.assign(new Event("unhandledrejection"), { reason }),
  );
}

describe("error capture", () => {
  it("records an uncaught error with a cleaned message and stack", () => {
    const emit = setup();
    const error = new TypeError("Cannot reach jane@example.com");
    error.stack =
      "TypeError: Cannot reach jane@example.com\n    at send (https://app.example/app.js:12:4)";
    throwUncaught(error, `Uncaught ${error.message}`);
    const [value] = values(emit);
    expect(value).toMatchObject({
      kind: "uncaught",
      name: "TypeError",
      message: "Cannot reach [email]",
      line: 12,
      column: 4,
      route: location.pathname,
    });
    expect(value!.source).not.toContain("abc123secret");
    expect(value!.stack).toContain("at send (https://app.example/app.js:12:4)");
    expect(JSON.stringify(value)).not.toContain("jane@example.com");
  });

  it("records unhandled rejections, with or without an Error reason", () => {
    const emit = setup();
    reject(new RangeError("Quota exceeded"));
    reject("plain text reason");
    reject(undefined);
    expect(values(emit)).toMatchObject([
      { kind: "rejection", name: "RangeError", message: "Quota exceeded" },
      { kind: "rejection", message: "plain text reason", reasonType: "string" },
      { kind: "rejection", reasonType: "undefined" },
    ]);
  });

  it("records a failed resource load without its credentials", () => {
    const emit = setup();
    document.body.innerHTML =
      '<img id="i" src="https://cdn.example/a.png?api_key=k-123456">';
    document.getElementById("i")!.dispatchEvent(new Event("error"));
    const [value] = values(emit);
    expect(value).toMatchObject({ kind: "resource", tag: "img" });
    expect(value!.source).toContain("https://cdn.example/a.png");
    expect(value!.source).not.toContain("k-123456");
  });

  it("records a native validation failure with the field label, not the value", () => {
    const emit = setup();
    document.body.innerHTML =
      '<form><label for="e">Work email</label><input id="e" type="email" required value="not-an-email-jane"></form>';
    document.querySelector("form")!.checkValidity();
    const [value] = values(emit);
    expect(value).toMatchObject({
      kind: "invalid",
      label: "Work email",
      failed: ["typeMismatch"],
    });
    expect(JSON.stringify(value)).not.toContain("not-an-email-jane");
  });

  it("does not record alert text unless alerts is true", async () => {
    const emit = setup();
    document.body.innerHTML =
      '<div role="alert">Jane Smith was not saved</div>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emit).not.toHaveBeenCalled();
  });

  it("records text added to an alert region when alerts is true", async () => {
    const emit = setup({ alerts: true });
    document.body.innerHTML = '<div role="alert" id="a"></div>';
    await Promise.resolve();
    document.getElementById("a")!.textContent =
      "Could not save. Contact help@example.com";
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(values(emit)).toMatchObject([
      { kind: "alert", text: "Could not save. Contact [email]" },
    ]);
  });

  it("skips alert regions and fields inside data-copilotkit-ignore", async () => {
    const emit = setup({ alerts: true });
    document.body.innerHTML =
      '<div data-copilotkit-ignore><div role="alert">Private</div><form><input required></form></div>';
    document.querySelector("form")!.checkValidity();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emit).not.toHaveBeenCalled();
  });

  it("sends a repeated error at its 1st, 10th, and 100th occurrence", () => {
    const emit = setup();
    for (let i = 0; i < 150; i++) throwUncaught(new Error("loop"));
    expect(values(emit).map((value) => value.count)).toEqual([
      undefined,
      10,
      100,
    ]);
  });

  it("sends at most 50 events in a session", () => {
    const emit = setup();
    for (let i = 0; i < 80; i++) throwUncaught(new Error(`distinct ${i}`));
    expect(emit).toHaveBeenCalledTimes(50);
  });

  it("does not stop the app's own error listeners, and removes its own on uninstall", () => {
    const emit = setup();
    const appListener = vi.fn();
    window.addEventListener("error", appListener);
    emit.mockImplementation(() => {
      throw new Error("sink failure");
    });
    throwUncaught(new Error("first"));
    expect(appListener).toHaveBeenCalledOnce();
    window.removeEventListener("error", appListener);
    uninstall!();
    uninstall = undefined;
    emit.mockReset();
    throwUncaught(new Error("after uninstall"));
    reject(new Error("after uninstall"));
    expect(emit).not.toHaveBeenCalled();
  });
});
