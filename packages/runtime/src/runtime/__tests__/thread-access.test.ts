/**
 * Thread and run ownership on the default in-memory runtime, as end-to-end
 * scenarios. The full operation-by-caller matrix is in
 * `thread-access-matrix.test.ts`.
 *
 * Every request goes through the real fetch handler, router, run/stop/thread
 * handlers and the default `InMemoryAgentRunner`. Only the agent is a local
 * deterministic stub. Each test starts from an empty store, and hanging runs
 * are released after each test even when it fails.
 */
import { describe, expect, it } from "vitest";
import {
  get,
  identifyFromHeader,
  isolateThreadStore,
  listIds,
  makeHandler,
  post,
  runBody,
  runThread,
  startHangingRun,
  uniqueThreadId,
} from "./helpers/thread-access-harness";
import type { Handler } from "./helpers/thread-access-harness";

isolateThreadStore();

/** A connect replay, with the thread id masked so two replays can be compared. */
async function replay(
  handler: Handler,
  threadId: string,
  user?: string,
): Promise<{ status: number; text: string }> {
  const response = await post(
    handler,
    "/agent/secret/connect",
    user,
    runBody(threadId, "ignored"),
  );
  const text = (await response.text()).split(threadId).join("<thread>");
  return { status: response.status, text };
}

describe("thread ownership with an identity callback", () => {
  it("B cannot list, read, replay, continue or clear A's thread; A still can", async () => {
    const handler = makeHandler({ identifyUser: identifyFromHeader });
    const aThread = uniqueThreadId("alice");
    const bThread = uniqueThreadId("bob");

    const aRun = await runThread(handler, {
      user: "alice",
      threadId: aThread,
      secret: "ALICE_SECRET",
    });
    expect(aRun.status).toBe(200);
    expect(aRun.bodyText).toContain("RUN_FINISHED");
    const bRun = await runThread(handler, {
      user: "bob",
      threadId: bThread,
      secret: "BOB_SECRET",
    });
    expect(bRun.status).toBe(200);

    // List is scoped to the caller.
    const aList = await listIds(handler, "alice");
    expect(aList).toContain(aThread);
    expect(aList).not.toContain(bThread);
    const bList = await listIds(handler, "bob");
    expect(bList).toContain(bThread);
    expect(bList).not.toContain(aThread);

    // Reads of a foreign thread look exactly like reads of an unknown thread.
    for (const suffix of ["messages", "events", "state"]) {
      const foreign = await get(
        handler,
        `/threads/${aThread}/${suffix}`,
        "bob",
      );
      const foreignText = await foreign.text();
      expect(foreignText).not.toContain("ALICE_SECRET");
      const unknown = await get(
        handler,
        `/threads/${uniqueThreadId("nope")}/${suffix}`,
        "bob",
      );
      expect(foreign.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(foreignText).toBe(await unknown.text());
    }

    // The owner still reads their own thread.
    const own = await get(handler, `/threads/${aThread}/messages`, "alice");
    expect(own.status).toBe(200);
    expect(await own.text()).toContain("ALICE_SECRET");
    const ownState = await get(handler, `/threads/${aThread}/state`, "alice");
    expect(await ownState.json()).toEqual({
      state: { secret: "ALICE_SECRET" },
    });

    // Replay through connect: B's replay of A's thread is the replay of an
    // unknown thread; A's replay is A's history.
    const foreignReplay = await replay(handler, aThread, "bob");
    const unknownThread = uniqueThreadId("nope");
    const unknownReplay = await replay(handler, unknownThread, "bob");
    expect(foreignReplay.status).toBe(200);
    expect(foreignReplay.text).toBe(unknownReplay.text);
    expect(foreignReplay.text).not.toContain("RUN_STARTED");
    const ownReplay = await replay(handler, aThread, "alice");
    expect(ownReplay.status).toBe(200);
    expect(ownReplay.text).toContain("RUN_STARTED");
    expect(ownReplay.text).toContain("ALICE_SECRET");

    // B cannot write into A's thread.
    const hijack = await runThread(handler, {
      user: "bob",
      threadId: aThread,
      secret: "BOB_INJECTED",
    });
    expect(hijack.status).toBe(404);
    const afterHijack = await get(
      handler,
      `/threads/${aThread}/state`,
      "alice",
    );
    expect(await afterHijack.json()).toEqual({
      state: { secret: "ALICE_SECRET" },
    });

    // B's clear wipes only B's threads.
    const clear = await post(handler, "/threads/clear", "bob");
    expect(clear.status).toBe(204);
    expect(await listIds(handler, "alice")).toContain(aThread);
    expect(await listIds(handler, "bob")).not.toContain(bThread);
  });

  it("B cannot stop A's active run, by thread or by run id; A can", async () => {
    const handler = makeHandler({ identifyUser: identifyFromHeader });
    const aThread = uniqueThreadId("alice-live");
    const live = await startHangingRun(handler, {
      user: "alice",
      threadId: aThread,
      secret: "ALICE_LIVE",
    });

    for (const body of [undefined, JSON.stringify({ runId: live.runId })]) {
      const bStop = await post(
        handler,
        `/agent/hang/stop/${aThread}`,
        "bob",
        body,
      );
      expect(bStop.status).toBe(200);
      expect(await bStop.json()).toMatchObject({ stopped: false });
    }

    const aStop = await post(
      handler,
      `/agent/hang/stop/${aThread}`,
      "alice",
      JSON.stringify({ runId: live.runId }),
    );
    expect(aStop.status).toBe(200);
    expect(await aStop.json()).toMatchObject({ stopped: true });
    expect(await live.drain()).toContain("RUN_FINISHED");
  });

  it("refuses a caller the identity callback cannot identify, on every route", async () => {
    const handler = makeHandler({ identifyUser: identifyFromHeader });
    const threadId = uniqueThreadId("alice");
    await runThread(handler, {
      user: "alice",
      threadId,
      secret: "ALICE_SECRET",
    });

    const responses: Array<[string, Response]> = [
      ["list", await get(handler, "/threads")],
      ["messages", await get(handler, `/threads/${threadId}/messages`)],
      ["events", await get(handler, `/threads/${threadId}/events`)],
      ["state", await get(handler, `/threads/${threadId}/state`)],
      ["clear", await post(handler, "/threads/clear")],
      [
        "connect",
        await post(
          handler,
          "/agent/secret/connect",
          undefined,
          runBody(threadId, "x"),
        ),
      ],
      [
        "run",
        await post(
          handler,
          "/agent/secret/run",
          undefined,
          runBody(threadId, "ANON_INJECTED"),
        ),
      ],
      ["stop", await post(handler, `/agent/secret/stop/${threadId}`)],
    ];
    for (const [route, response] of responses) {
      expect(response.status, route).toBe(500);
      expect(await response.json(), route).toEqual({
        error: "Failed to identify user",
      });
    }
    // Nothing was cleared or written.
    const state = await get(handler, `/threads/${threadId}/state`, "alice");
    expect(await state.json()).toEqual({ state: { secret: "ALICE_SECRET" } });
  });
});

describe('thread access with threads: { access: "open" }', () => {
  it("restores the previous shared behavior for threads created without identity", async () => {
    const handler = makeHandler({ threads: { access: "open" } });
    const thread = uniqueThreadId("open");
    const run = await runThread(handler, {
      threadId: thread,
      secret: "OPEN_SECRET",
    });
    expect(run.status).toBe(200);

    expect(await listIds(handler)).toContain(thread);
    const messages = await get(handler, `/threads/${thread}/messages`);
    expect(messages.status).toBe(200);
    expect(await messages.text()).toContain("OPEN_SECRET");

    const live = uniqueThreadId("open-live");
    const hanging = await startHangingRun(handler, {
      threadId: live,
      secret: "OPEN_LIVE",
    });
    const stop = await post(
      handler,
      `/agent/hang/stop/${live}`,
      undefined,
      JSON.stringify({ runId: hanging.runId }),
    );
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ stopped: true });
    expect(await hanging.drain()).toContain("RUN_FINISHED");

    const clear = await post(handler, "/threads/clear");
    expect(clear.status).toBe(204);
    expect(await listIds(handler)).not.toContain(thread);
  });

  it("never exposes, continues, stops or clears threads that belong to an identified user", async () => {
    const secure = makeHandler({ identifyUser: identifyFromHeader });
    const open = makeHandler({ threads: { access: "open" } });
    const thread = uniqueThreadId("owned");
    await runThread(secure, {
      user: "alice",
      threadId: thread,
      secret: "OWNED_SECRET",
    });

    expect(await listIds(open)).not.toContain(thread);
    for (const suffix of ["messages", "events", "state"]) {
      const read = await get(open, `/threads/${thread}/${suffix}`);
      expect(read.status).toBe(200);
      expect(await read.text()).not.toContain("OWNED_SECRET");
    }
    const replayed = await replay(open, thread);
    expect(replayed.status).toBe(200);
    expect(replayed.text).not.toContain("RUN_STARTED");

    const hijack = await runThread(open, {
      threadId: thread,
      secret: "ANON_INJECTED",
    });
    expect(hijack.status).toBe(404);

    const clear = await post(open, "/threads/clear");
    expect(clear.status).toBe(204);
    expect(await listIds(secure, "alice")).toContain(thread);
    const state = await get(secure, `/threads/${thread}/state`, "alice");
    expect(await state.json()).toEqual({ state: { secret: "OWNED_SECRET" } });

    const liveThread = uniqueThreadId("owned-live");
    const live = await startHangingRun(secure, {
      user: "alice",
      threadId: liveThread,
      secret: "OWNED_LIVE",
    });
    for (const body of [undefined, JSON.stringify({ runId: live.runId })]) {
      const stop = await post(
        open,
        `/agent/hang/stop/${liveThread}`,
        undefined,
        body,
      );
      expect(stop.status).toBe(200);
      expect(await stop.json()).toMatchObject({ stopped: false });
    }
  });
});
