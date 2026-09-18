import { describe, expect, it, vi } from "vitest";
import { SkillInvocationScope } from "../invocation.js";
import { SkillDeliveryError } from "@copilotkit/intelligence-delivery-core";
import type { SkillRegistry } from "@copilotkit/intelligence-delivery-core";
import type { VerifiedSnapshot } from "@copilotkit/intelligence-delivery-core";

function setup() {
  const acquireSnapshot = vi.fn(
    async () => Object.freeze({ revision: "r1" }) as VerifiedSnapshot,
  );
  const scope = new SkillInvocationScope({
    acquireSnapshot,
  } as unknown as SkillRegistry);
  return { scope, acquireSnapshot };
}
function target(invoke: (...args: any[]) => any) {
  return { invoke, stream: invoke, streamEvents: invoke };
}

describe("private invocation scope", () => {
  it("fails closed without an invocation or with an unsupported target", () => {
    const { scope } = setup();
    expect(() => scope.snapshot()).toThrow(SkillDeliveryError);
    expect(() => scope.wrapAgent({ invoke() {} })).toThrow(SkillDeliveryError);
    expect(() => scope.wrapAgent("invalid" as unknown as object)).toThrow(
      SkillDeliveryError,
    );
  });

  it("acquires lazily once and retains the identical promise", async () => {
    const { scope, acquireSnapshot } = setup();
    const agent = scope.wrapAgent(
      target(async () => {
        expect(acquireSnapshot).toHaveBeenCalledTimes(1);
        const first = scope.snapshot();
        expect(scope.snapshot()).toBe(first);
        await first;
        expect(scope.snapshot()).toBe(first);
        return first;
      }),
    );
    expect((await agent.invoke()).revision).toBe("r1");
    expect(acquireSnapshot).toHaveBeenCalledTimes(1);
  });

  it("retains a rejection for the invocation and retries in the next invocation", async () => {
    const { scope, acquireSnapshot } = setup();
    const denial = new SkillDeliveryError("REVISION_REVOKED", false);
    acquireSnapshot.mockRejectedValueOnce(denial);
    const agent = scope.wrapAgent(
      target(async () => {
        const first = scope.snapshot();
        await first.catch(() => undefined);
        expect(scope.snapshot()).toBe(first);
        return first;
      }),
    );
    await expect(agent.invoke()).rejects.toBe(denial);
    await expect(agent.invoke()).resolves.toMatchObject({ revision: "r1" });
    expect(acquireSnapshot).toHaveBeenCalledTimes(2);
  });

  it("isolates overlapping and nested external invocations", async () => {
    const { scope, acquireSnapshot } = setup();
    const agent = scope.wrapAgent(
      target(async (nested = false) => {
        const pin = scope.snapshot();
        await Promise.resolve();
        if (nested) await agent.invoke();
        expect(scope.snapshot()).toBe(pin);
        return pin;
      }),
    );
    await Promise.all([agent.invoke(true), agent.invoke()]);
    expect(acquireSnapshot).toHaveBeenCalledTimes(3);
  });

  it("preflights all entries before delegating and preserves native stream surfaces", async () => {
    const { scope, acquireSnapshot } = setup();
    const denial = new SkillDeliveryError("REVISION_REVOKED", false);
    const invoke = vi.fn(async () => "result");
    const stream = vi.fn(async () => new ReadableStream());
    const streamEvents = vi.fn(
      () =>
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
    );
    const agent = scope.wrapAgent({ invoke, stream, streamEvents });
    for (const entry of ["invoke", "stream", "streamEvents"] as const) {
      acquireSnapshot.mockRejectedValueOnce(denial);
      const result = agent[entry]();
      if (result instanceof ReadableStream) {
        await expect(result.getReader().read()).rejects.toBe(denial);
      } else await expect(result).rejects.toBe(denial);
      expect({ invoke, stream, streamEvents }[entry]).not.toHaveBeenCalled();
    }
    const input = {};
    const config = {};
    const options = {};
    const events = agent.streamEvents(input, config, options);
    expect(events).toBeInstanceOf(ReadableStream);
    await events.getReader().read();
    expect(streamEvents).toHaveBeenCalledWith(input, config, options);
    const v3 = { output: Promise.resolve("done"), abort() {} };
    const v3Agent = scope.wrapAgent(target(() => Promise.resolve(v3)));
    expect(await v3Agent.streamEvents({}, { version: "v3" })).toBe(v3);
  });

  it("aborts only one caller's wait and never delegates after cancellation", async () => {
    const { scope, acquireSnapshot } = setup();
    let release!: (snapshot: VerifiedSnapshot) => void;
    const shared = new Promise<VerifiedSnapshot>((resolve) => {
      release = resolve;
    });
    acquireSnapshot.mockReturnValue(shared);
    const invoke = vi.fn(async () => scope.snapshot());
    const agent = scope.wrapAgent(target(invoke));
    const controller = new AbortController();
    const cancelled = agent.invoke({}, { signal: controller.signal });
    const surviving = agent.invoke();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
    release({ revision: "r1" } as VerifiedSnapshot);
    await expect(surviving).resolves.toMatchObject({ revision: "r1" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation defaults configured through the wrapper", async () => {
    const { scope, acquireSnapshot } = setup();
    let release!: (value: VerifiedSnapshot) => void;
    acquireSnapshot.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const invoke = vi.fn(async () => scope.snapshot());
    const make = (): ReturnType<typeof target> & {
      withConfig: (config: object) => ReturnType<typeof make>;
    } => ({ ...target(invoke), withConfig: () => make() });
    const agent = scope.wrapAgent(make());
    const controller = new AbortController();
    const configured = agent
      .withConfig({ signal: controller.signal })
      .withConfig({ tags: ["test"] });
    const stopped = configured.invoke();
    const surviving = agent.invoke();
    controller.abort();
    const outcome = await Promise.race([
      stopped.catch((e: unknown) => e),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 20)),
    ]);
    expect(outcome).toMatchObject({ name: "AbortError" });
    release({ revision: "r1" } as VerifiedSnapshot);
    await surviving;
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("forwards configured cancellation to native graph execution after preflight", async () => {
    const { scope } = setup();
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const graph = target(
      (_input: unknown, config?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          config?.signal?.addEventListener(
            "abort",
            () => reject(config.signal!.reason),
            { once: true },
          );
          started();
        }),
    );
    const make = (): ReturnType<typeof target> & {
      graph: typeof graph;
      withConfig: (config: object) => ReturnType<typeof make>;
    } => ({ ...target(() => undefined), graph, withConfig: () => make() });
    const controller = new AbortController();
    const agent = scope
      .wrapAgent(make())
      .withConfig({ signal: controller.signal });
    const result = agent.graph.invoke({});
    await running;
    controller.abort();
    const outcome = await Promise.race([
      result.catch((e: unknown) => e),
      new Promise((resolve) => setTimeout(() => resolve("still running"), 20)),
    ]);
    expect(outcome).toMatchObject({ name: "AbortError" });
  });

  it("does not drain legacy event streams ahead of the consumer", async () => {
    const { scope } = setup();
    let reads = 0;
    const agent = scope.wrapAgent(
      target(
        () =>
          new ReadableStream(
            {
              pull(controller) {
                controller.enqueue(++reads);
                if (reads === 5) controller.close();
              },
            },
            { highWaterMark: 0 },
          ),
      ),
    );
    const events = agent.streamEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(1);
    await events.cancel();
  });

  it("supports legacy reader cancellation before and after delegation", async () => {
    const { scope, acquireSnapshot } = setup();
    let release!: (snapshot: VerifiedSnapshot) => void;
    acquireSnapshot.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const cancelled = vi.fn();
    const events = vi.fn(
      () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue("chunk");
          },
          cancel: cancelled,
        }),
    );
    const agent = scope.wrapAgent({ ...target(events), streamEvents: events });
    const pending = agent.streamEvents();
    await pending.cancel("before delegation");
    release({ revision: "r1" } as VerifiedSnapshot);
    await Promise.resolve();
    expect(events).not.toHaveBeenCalled();
    const running = agent.streamEvents();
    const reader = running.getReader();
    await expect(reader.read()).resolves.toMatchObject({ value: "chunk" });
    await reader.cancel("after delegation");
    expect(cancelled).toHaveBeenCalledWith("after delegation");
  });

  it("keeps eager stream producers scoped after the creation call returns", async () => {
    const { scope, acquireSnapshot } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = target(
      () =>
        new ReadableStream({
          async start(controller) {
            const first = scope.snapshot();
            await gate;
            expect(scope.snapshot()).toBe(first);
            controller.enqueue((await first).revision);
            controller.close();
          },
        }),
    );
    const stream = await scope.wrapAgent(native).stream();
    expect(() => scope.snapshot()).toThrow(SkillDeliveryError);
    release();
    const reader = stream.getReader();
    await expect(reader.read()).resolves.toEqual({ done: false, value: "r1" });
    expect(acquireSnapshot).toHaveBeenCalledTimes(1);
  });

  it("preserves private receivers, setters, identity, and wrapped withConfig/graph", async () => {
    const { scope, acquireSnapshot } = setup();
    class Agent {
      #value = "initial";
      get value() {
        return this.#value;
      }
      set value(value: string) {
        this.#value = value;
      }
      getState() {
        return this.#value;
      }
      invoke() {
        return scope.snapshot();
      }
      stream() {
        return this.invoke();
      }
      streamEvents() {
        return this.invoke();
      }
      withConfig() {
        return new Agent();
      }
      get graph() {
        return graph;
      }
      batch() {
        return this.invoke();
      }
    }
    const graph = new Agent();
    const raw = new Agent();
    const agent = scope.wrapAgent(raw);
    expect(agent).toBeInstanceOf(Agent);
    expect(scope.wrapAgent(raw)).toBe(agent);
    expect(scope.wrapAgent(agent)).toBe(agent);
    agent.value = "changed";
    expect(agent.value).toBe("changed");
    const detached = agent.getState;
    expect(detached()).toBe("changed");
    expect(agent.graph).toBe(agent.graph);
    await agent.graph.invoke();
    await agent.withConfig().invoke();
    await agent.graph.withConfig().invoke();
    expect(acquireSnapshot).toHaveBeenCalledTimes(3);
    expect(() => agent.graph.batch()).toThrow(SkillDeliveryError);
  });
});
