import { afterEach, describe, expect, it } from "vitest";
import { deferred } from "../../../testing/deferred.js";
import type {
  ThreadDebuggerMessage,
  ThreadDebuggerProvider,
} from "../../../shared/thread-debugger/types.js";
import { CpkThreadInspector } from "./thread-inspector.js";

if (!customElements.get("cpk-thread-inspector")) {
  customElements.define("cpk-thread-inspector", CpkThreadInspector);
}

describe("CpkThreadInspector provider lifecycle", () => {
  afterEach(() => document.body.replaceChildren());

  it("aborts stale message work when the selected thread changes", async () => {
    const first = deferred<ThreadDebuggerMessage[]>();
    let firstSignal: AbortSignal | undefined;
    const provider: ThreadDebuggerProvider = {
      getMessages: (threadId, { signal }) => {
        if (threadId === "first") {
          firstSignal = signal;
          return first.promise;
        }
        return Promise.resolve([]);
      },
    };
    const element = new CpkThreadInspector();
    element.provider = provider;
    element.threadId = "first";
    document.body.append(element);
    await element.updateComplete;

    element.threadId = "second";
    await element.updateComplete;

    expect(firstSignal?.aborted).toBe(true);
  });
});

describe("CpkThreadInspector Try from here", () => {
  afterEach(() => document.body.replaceChildren());

  it("renders in the Messages toolbar and dispatches the selected thread", async () => {
    const element = new CpkThreadInspector();
    element.threadId = "thread-1";
    element.tryFromHereAvailable = true;
    document.body.append(element);
    await element.updateComplete;
    const button = element.shadowRoot?.querySelector<HTMLButtonElement>(
      ".cpk-td__try-from-here",
    );
    if (!button) throw new Error("Try from here was not rendered");
    const selected = new Promise<Event>((resolve) => {
      element.addEventListener("tryFromHere", resolve);
    });

    expect(button.closest(".cpk-td__timeline-toolbar")).not.toBeNull();
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    button.click();

    const event = await selected;
    expect(event).toBeInstanceOf(CustomEvent);
    if (!(event instanceof CustomEvent)) {
      throw new Error("Try from here did not dispatch a CustomEvent");
    }
    expect(event.detail).toBe("thread-1");
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("shows the busy state without dispatching", async () => {
    const element = new CpkThreadInspector();
    element.threadId = "thread-1";
    element.tryFromHereAvailable = true;
    element.tryFromHereBusy = true;
    document.body.append(element);
    await element.updateComplete;
    const button = element.shadowRoot?.querySelector<HTMLButtonElement>(
      ".cpk-td__try-from-here",
    );
    if (!button) throw new Error("Try from here was not rendered");
    let selections = 0;
    element.addEventListener("tryFromHere", () => selections++);

    button.click();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Loading…");
    expect(button.getAttribute("aria-label")).toBe("Loading thread");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(selections).toBe(0);
  });

  it("announces a settled failure", async () => {
    const element = new CpkThreadInspector();
    element.threadId = "thread-1";
    element.tryFromHereAvailable = true;
    element.tryFromHereError = "Failed to load thread.";
    document.body.append(element);
    await element.updateComplete;

    expect(
      element.shadowRoot?.querySelector('[role="alert"]')?.textContent,
    ).toBe("Failed to load thread.");
  });
});
