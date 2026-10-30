import { HttpAgent, type RunAgentResult } from "@ag-ui/client";
import { expect, it, vi } from "vitest";
import { MCPAppsRequestQueue } from "../request-queue";
const ok: RunAgentResult = { result: {}, newMessages: [] };
function deferred() {
  let resolve!: (value: RunAgentResult) => void;
  const promise = new Promise<RunAgentResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it.each(["thread switch", "owner cancellation"])(
  "drops waiting isolated reads on %s",
  async (mode) => {
    const queue = new MCPAppsRequestQueue();
    const agent = new HttpAgent({
      url: "https://runtime.example",
      threadId: "original",
    });
    agent.isRunning = true;
    const first = deferred();
    const active = queue.enqueueIsolatedResourceRead(
      agent,
      () => first.promise,
    );
    const owner = {};
    const second = vi.fn(async () => ok);
    const waiting = queue.enqueueIsolatedResourceRead(agent, second, {
      owner,
      dropAfterThreadSwitch: true,
    });
    const rejected = expect(waiting).rejects.toThrow(
      mode === "thread switch" ? "moved from thread" : "cancelled",
    );
    if (mode === "thread switch") agent.threadId = "other";
    else queue.cancelOwner(owner);
    first.resolve(ok);
    await active;
    await rejected;
    expect(second).not.toHaveBeenCalled();
  },
);
it("releases an active isolated read wait on teardown without blocking other owners", async () => {
  const queue = new MCPAppsRequestQueue();
  const agent = new HttpAgent({ url: "https://runtime.example" });
  agent.isRunning = true;
  const first = deferred(),
    owner = {};
  const active = queue.enqueueIsolatedResourceRead(agent, () => first.promise, {
    owner,
    cancelRunningWait: true,
  });
  const rejected = expect(active).rejects.toThrow("cancelled");
  const second = queue.enqueueIsolatedResourceRead(agent, async () => ok);
  queue.cancelOwner(owner);
  await rejected;
  await expect(second).resolves.toEqual(ok);
  first.resolve(ok);
});
