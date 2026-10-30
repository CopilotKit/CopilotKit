/**
 * The Thread access matrix: every operation, for every kind of caller, in
 * every access configuration, through the real runtime handler and the
 * default InMemoryAgentRunner.
 *
 * - identified: `identifyUser` is set. Every operation reaches only the
 *   caller's own threads.
 * - default (`access: "owner"`, no `identifyUser`): an anonymous thread is a
 *   capability. Whoever holds its id may read, connect, run and stop it.
 *   Listing and bulk clear are refused with 403.
 * - open (`access: "open"`, no `identifyUser`): anonymous threads are shared,
 *   including list and clear.
 * In every mode, a thread an identified user created is never reachable by an
 * anonymous caller or by another identity.
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

/**
 * A run on a thread that another identity owns reads like a missing thread:
 * the same status and body as an unknown thread on the inspect routes.
 */
function expectForeignRun(run: Response & { bodyText: string }) {
  expect(run.status).toBe(404);
  expect(JSON.parse(run.bodyText)).toEqual({ error: "Thread not found" });
}

type Outcome = "visible" | "hidden" | "refused";

/** Reads `suffix` of `threadId` as `user` and classifies the result. */
async function readOutcome(
  handler: Handler,
  threadId: string,
  suffix: "messages" | "events" | "state",
  secret: string,
  user?: string,
): Promise<Outcome> {
  const response = await get(handler, `/threads/${threadId}/${suffix}`, user);
  const text = await response.text();
  if (response.status === 403) {
    expect(JSON.parse(text).error).toBe("thread_access_not_configured");
    return "refused";
  }
  expect(response.status).toBe(200);
  if (text.includes(secret)) return "visible";
  // A hidden thread reads exactly like an unknown one.
  const unknown = await get(
    handler,
    `/threads/${uniqueThreadId("unknown")}/${suffix}`,
    user,
  );
  expect(unknown.status).toBe(200);
  expect(text).toBe(await unknown.text());
  return "hidden";
}

async function connectOutcome(
  handler: Handler,
  threadId: string,
  secret: string,
  user?: string,
): Promise<Outcome> {
  const response = await post(
    handler,
    "/agent/secret/connect",
    user,
    runBody(threadId, "connect"),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  if (text.includes(secret)) return "visible";
  // A hidden thread replays nothing, like an unknown one.
  expect(text).not.toContain("RUN_STARTED");
  return "hidden";
}

/** Checks every read path of `threadId` for `user` against one outcome. */
async function expectReads(
  handler: Handler,
  threadId: string,
  secret: string,
  user: string | undefined,
  expected: { reads: Outcome; connect: Outcome },
) {
  for (const suffix of ["messages", "events", "state"] as const) {
    expect(
      await readOutcome(handler, threadId, suffix, secret, user),
      `${suffix} as ${user ?? "anonymous"}`,
    ).toBe(expected.reads);
  }
  expect(
    await connectOutcome(handler, threadId, secret, user),
    `connect as ${user ?? "anonymous"}`,
  ).toBe(expected.connect);
}

async function expectStopOutcomes(
  handler: Handler,
  opts: { owner?: string; other?: string; otherIsSame?: boolean },
) {
  const threadId = uniqueThreadId("stop");
  const live = await startHangingRun(handler, {
    user: opts.owner,
    threadId,
    secret: "LIVE",
  });
  const stop = async (user: string | undefined, runId?: string) => {
    const response = await post(
      handler,
      `/agent/hang/stop/${threadId}`,
      user,
      runId === undefined ? undefined : JSON.stringify({ runId }),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { stopped: boolean }).stopped;
  };
  if (!opts.otherIsSame) {
    expect(await stop(opts.other, live.runId)).toBe(false);
    expect(await stop(opts.other)).toBe(false);
  }
  expect(await stop(opts.owner, "not-the-active-run")).toBe(false);
  expect(await stop(opts.owner, live.runId)).toBe(true);
  expect(await live.drain()).toContain("RUN_FINISHED");
}

describe("identified mode (identifyUser set)", () => {
  const handler = () => makeHandler({ identifyUser: identifyFromHeader });

  it("the owner reaches every operation on their thread", async () => {
    const h = handler();
    const threadId = uniqueThreadId("alice");
    const run = await runThread(h, {
      user: "alice",
      threadId,
      secret: "ALICE_SECRET",
    });
    expect(run.status).toBe(200);
    expect(await listIds(h, "alice")).toContain(threadId);
    await expectReads(h, threadId, "ALICE_SECRET", "alice", {
      reads: "visible",
      connect: "visible",
    });
    const again = await runThread(h, {
      user: "alice",
      threadId,
      secret: "ALICE_AGAIN",
    });
    expect(again.status).toBe(200);
    expect((await post(h, "/threads/clear", "alice")).status).toBe(204);
    expect(await listIds(h, "alice")).not.toContain(threadId);
  });

  it("another identity reaches no operation on the thread", async () => {
    const h = handler();
    const threadId = uniqueThreadId("alice");
    await runThread(h, { user: "alice", threadId, secret: "ALICE_SECRET" });

    expect(await listIds(h, "bob")).not.toContain(threadId);
    await expectReads(h, threadId, "ALICE_SECRET", "bob", {
      reads: "hidden",
      connect: "hidden",
    });
    const hijack = await runThread(h, {
      user: "bob",
      threadId,
      secret: "BOB_INJECTED",
    });
    expectForeignRun(hijack);
    expect((await post(h, "/threads/clear", "bob")).status).toBe(204);
    expect(await listIds(h, "alice")).toContain(threadId);
    const state = await get(h, `/threads/${threadId}/state`, "alice");
    expect(await state.json()).toEqual({ state: { secret: "ALICE_SECRET" } });
  });

  it("another identity cannot stop the owner's run, by thread or by run id", async () => {
    await expectStopOutcomes(handler(), { owner: "alice", other: "bob" });
  });

  it("an identified user cannot reach an anonymous thread", async () => {
    const open = makeHandler({ threads: { access: "open" } });
    const threadId = uniqueThreadId("anon");
    await runThread(open, { threadId, secret: "ANON_SECRET" });

    const h = handler();
    expect(await listIds(h, "alice")).not.toContain(threadId);
    await expectReads(h, threadId, "ANON_SECRET", "alice", {
      reads: "hidden",
      connect: "hidden",
    });
    const takeover = await runThread(h, {
      user: "alice",
      threadId,
      secret: "ALICE",
    });
    expectForeignRun(takeover);
  });
});

describe("default mode (no identifyUser, access owner)", () => {
  it("an anonymous thread works as a capability: read, connect, run and stop by id", async () => {
    const h = makeHandler();
    const threadId = uniqueThreadId("anon");
    const run = await runThread(h, { threadId, secret: "ANON_SECRET" });
    expect(run.status).toBe(200);

    await expectReads(h, threadId, "ANON_SECRET", undefined, {
      reads: "visible",
      connect: "visible",
    });
    const again = await runThread(h, { threadId, secret: "ANON_AGAIN" });
    expect(again.status).toBe(200);
    await expectStopOutcomes(h, { otherIsSame: true });
  });

  it("a second caller's run leaves the stored history and the replay intact", async () => {
    const h = makeHandler();
    const threadId = uniqueThreadId("anon");
    const send = (id: string, content: string) =>
      post(
        h,
        "/agent/secret/run",
        undefined,
        JSON.stringify({
          ...JSON.parse(runBody(threadId, content)),
          messages: [{ id, role: "user", content }],
        }),
      ).then((response) => response.text());
    await send("first-caller-message", "FIRST_CALLER");
    await send("second-caller-message", "SECOND_CALLER");

    const stored = await (await get(h, `/threads/${threadId}/messages`)).json();
    expect(
      (stored as { messages: { content: string }[] }).messages.map(
        (message) => message.content,
      ),
    ).toEqual(["FIRST_CALLER", "SECOND_CALLER"]);

    const replay = await post(
      h,
      "/agent/secret/connect",
      undefined,
      runBody(threadId, "connect"),
    );
    const replayed = await replay.text();
    expect(replayed).toContain("FIRST_CALLER");
    expect(replayed).toContain("SECOND_CALLER");
  });

  it("refuses list and clear with an error that names the configuration", async () => {
    const h = makeHandler();
    const threadId = uniqueThreadId("anon");
    await runThread(h, { threadId, secret: "ANON_SECRET" });

    for (const response of [
      await get(h, "/threads"),
      await post(h, "/threads/clear"),
    ]) {
      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        error: string;
        message: string;
      };
      expect(body.error).toBe("thread_access_not_configured");
      expect(body.message).toContain("identifyUser");
      expect(body.message).toContain('threads: { access: "open" }');
    }
    // The refused clear removed nothing.
    await expectReads(h, threadId, "ANON_SECRET", undefined, {
      reads: "visible",
      connect: "visible",
    });
  });

  it("never reaches a thread that an identified user owns", async () => {
    const secure = makeHandler({ identifyUser: identifyFromHeader });
    const threadId = uniqueThreadId("owned");
    await runThread(secure, {
      user: "alice",
      threadId,
      secret: "OWNED_SECRET",
    });

    const h = makeHandler();
    await expectReads(h, threadId, "OWNED_SECRET", undefined, {
      reads: "hidden",
      connect: "hidden",
    });
    const takeover = await runThread(h, { threadId, secret: "ANON" });
    expectForeignRun(takeover);
    // The header is ignored without identifyUser: it does not act as alice.
    await expectReads(h, threadId, "OWNED_SECRET", "alice", {
      reads: "hidden",
      connect: "hidden",
    });
  });

  it("cannot stop a run on a thread that an identified user owns", async () => {
    const secure = makeHandler({ identifyUser: identifyFromHeader });
    const threadId = uniqueThreadId("owned-live");
    const live = await startHangingRun(secure, {
      user: "alice",
      threadId,
      secret: "OWNED_LIVE",
    });
    const h = makeHandler();
    for (const body of [undefined, JSON.stringify({ runId: live.runId })]) {
      const stop = await post(
        h,
        `/agent/hang/stop/${threadId}`,
        undefined,
        body,
      );
      expect(stop.status).toBe(200);
      expect(await stop.json()).toMatchObject({ stopped: false });
    }
    const own = await post(secure, `/agent/hang/stop/${threadId}`, "alice");
    expect(await own.json()).toMatchObject({ stopped: true });
    await live.drain();
  });
});

describe('open mode (no identifyUser, access "open")', () => {
  it("shares anonymous threads, list and clear included", async () => {
    const h = makeHandler({ threads: { access: "open" } });
    const threadId = uniqueThreadId("open");
    await runThread(h, { threadId, secret: "OPEN_SECRET" });

    expect(await listIds(h)).toContain(threadId);
    await expectReads(h, threadId, "OPEN_SECRET", undefined, {
      reads: "visible",
      connect: "visible",
    });
    await expectStopOutcomes(h, { otherIsSame: true });
    expect((await post(h, "/threads/clear")).status).toBe(204);
    expect(await listIds(h)).not.toContain(threadId);
  });

  it("never lists, reads, replays, continues, stops or clears an identified user's thread", async () => {
    const secure = makeHandler({ identifyUser: identifyFromHeader });
    const open = makeHandler({ threads: { access: "open" } });
    const threadId = uniqueThreadId("owned");
    await runThread(secure, {
      user: "alice",
      threadId,
      secret: "OWNED_SECRET",
    });

    expect(await listIds(open)).not.toContain(threadId);
    await expectReads(open, threadId, "OWNED_SECRET", undefined, {
      reads: "hidden",
      connect: "hidden",
    });
    const takeover = await runThread(open, { threadId, secret: "ANON" });
    expectForeignRun(takeover);
    expect((await post(open, "/threads/clear")).status).toBe(204);
    expect(await listIds(secure, "alice")).toContain(threadId);

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
      expect(await stop.json()).toMatchObject({ stopped: false });
    }
    await post(secure, `/agent/hang/stop/${liveThread}`, "alice");
    await live.drain();
  });
});

describe("/info", () => {
  async function threadEndpoints(h: Handler) {
    const response = await get(h, "/info");
    expect(response.status).toBe(200);
    return (
      (await response.json()) as {
        threadEndpoints: { list: boolean; inspect: boolean };
      }
    ).threadEndpoints;
  }

  it("advertises inspect but not list in default mode", async () => {
    expect(await threadEndpoints(makeHandler())).toMatchObject({
      list: false,
      inspect: true,
    });
  });

  it("advertises list and inspect with identifyUser alone", async () => {
    expect(
      await threadEndpoints(makeHandler({ identifyUser: identifyFromHeader })),
    ).toMatchObject({ list: true, inspect: true });
  });

  it('advertises list and inspect with access "open"', async () => {
    expect(
      await threadEndpoints(makeHandler({ threads: { access: "open" } })),
    ).toMatchObject({ list: true, inspect: true });
  });
});
