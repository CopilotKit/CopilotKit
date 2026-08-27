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
