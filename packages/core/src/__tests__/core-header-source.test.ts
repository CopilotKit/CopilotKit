import { describe, expect, it, vi } from "vitest";
import {
  CopilotKitHeaderResolutionError,
  HeaderSourceResolver,
  isHeaderResolutionError,
  ɵwithHeaderDefaults,
} from "../core/header-source";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";

const noop = () => {};

describe("HeaderSourceResolver", () => {
  it("returns a record synchronously, normalized", () => {
    const r = new HeaderSourceResolver(noop);
    r.setSource({ A: "1", B: null, C: undefined });
    const out = r.resolve();
    expect(out).toEqual({ A: "1" });
    expect(out instanceof Promise).toBe(false);
  });

  it("calls a sync builder on every resolve and returns synchronously", () => {
    let token = "t1";
    const r = new HeaderSourceResolver(noop);
    r.setSource(() => ({ Authorization: token }));
    expect(r.resolve()).toEqual({ Authorization: "t1" });
    token = "t2";
    expect(r.resolve()).toEqual({ Authorization: "t2" });
    expect(r.headers).toEqual({ Authorization: "t2" });
  });

  it("shares one in-flight call between concurrent async resolves", async () => {
    const builder = vi.fn(async () => ({ Authorization: "a" }));
    const r = new HeaderSourceResolver(noop);
    r.setSource(builder);
    const [a, b, c] = await Promise.all([
      r.resolve(),
      r.resolve(),
      r.resolve(),
    ]);
    expect(builder).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ Authorization: "a" });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("does not reuse an in-flight call after the source changes", async () => {
    let release!: (v: Record<string, string>) => void;
    const slow = () =>
      new Promise<Record<string, string>>((res) => (release = res));
    const r = new HeaderSourceResolver(noop);
    r.setSource(slow);
    const stale = r.resolve();
    r.setSource(async () => ({ Authorization: "new-user" }));
    const fresh = await r.resolve();
    release({ Authorization: "old-user" });
    await stale;
    expect(fresh).toEqual({ Authorization: "new-user" });
    // A result from the previous generation never overwrites the snapshot.
    expect(r.headers).toEqual({ Authorization: "new-user" });
  });

  it("keeps the same snapshot object when a builder resolves to an equal value twice", () => {
    let token = "t1";
    const r = new HeaderSourceResolver(noop);
    r.setSource(() => ({ Authorization: token }));
    const first = r.resolve();
    const second = r.resolve();
    expect(second).toBe(first);
    expect(r.headers).toBe(first);

    token = "t2";
    const third = r.resolve();
    expect(third).not.toBe(first);
    expect(third).toEqual({ Authorization: "t2" });
    expect(r.headers).toBe(third);
  });

  it("keeps snapshot identity across an async resolve that returns an equal value", async () => {
    let token = "t1";
    const r = new HeaderSourceResolver(noop);
    r.setSource(async () => ({ Authorization: token }));
    const first = await r.resolve();
    const second = await r.resolve();
    expect(second).toBe(first);

    token = "t2";
    const third = await r.resolve();
    expect(third).not.toBe(first);
  });

  it("setSource with the same function identity is a no-op", () => {
    const r = new HeaderSourceResolver(noop);
    const fn = () => ({ A: "1" });
    expect(r.setSource(fn)).toBe(true);
    const gen = r.generation;
    expect(r.setSource(fn)).toBe(false);
    expect(r.generation).toBe(gen);
  });

  it("setting an equal record is a no-op (same object, or an equal different object)", () => {
    const r = new HeaderSourceResolver(noop);
    const rec = { A: "1" };
    expect(r.setSource(rec)).toBe(true);
    const gen = r.generation;

    // Same object reference.
    expect(r.setSource(rec)).toBe(false);
    expect(r.generation).toBe(gen);

    // A different object, equal values.
    expect(r.setSource({ A: "1" })).toBe(false);
    expect(r.generation).toBe(gen);
  });

  it("a record with a changed value counts as a change", () => {
    const r = new HeaderSourceResolver(noop);
    r.setSource({ A: "1" });
    const gen = r.generation;
    expect(r.setSource({ A: "2" })).toBe(true);
    expect(r.generation).toBe(gen + 1);
  });

  it("a record with a removed key counts as a change (never looks equal)", () => {
    const r = new HeaderSourceResolver(noop);
    r.setSource({ A: "1", B: "2" });
    const gen = r.generation;
    expect(r.setSource({ A: "1" })).toBe(true);
    expect(r.generation).toBe(gen + 1);
    expect(r.headers).toEqual({ A: "1" });
  });

  it("record -> builder -> equal record: each switch counts as a change", () => {
    const r = new HeaderSourceResolver(noop);
    expect(r.setSource({ A: "1" })).toBe(true);
    const gen1 = r.generation;

    // Builder replacing a record is always a change, even though the
    // builder hasn't run yet (snapshot resets to `{}`).
    expect(r.setSource(() => ({ A: "1" }))).toBe(true);
    expect(r.generation).toBe(gen1 + 1);

    // A record replacing a builder is always a change too, even if its
    // values equal what the builder last resolved to.
    r.resolve();
    expect(r.setSource({ A: "1" })).toBe(true);
    expect(r.generation).toBe(gen1 + 2);
  });

  it("reports one failure per shared async call and never leaks header values", async () => {
    const onFailure = vi.fn();
    const r = new HeaderSourceResolver(onFailure);
    r.setSource(async () => {
      throw new Error("clerk down");
    });
    const results = await Promise.allSettled([r.resolve(), r.resolve()]);
    expect(results.every((x) => x.status === "rejected")).toBe(true);
    expect(onFailure).toHaveBeenCalledTimes(1);
    const err = onFailure.mock.calls[0]![0];
    expect(err).toBeInstanceOf(CopilotKitHeaderResolutionError);
    expect((err as Error).cause).toEqual(new Error("clerk down"));
  });

  it("rejects a builder that returns a non-object", async () => {
    const onFailure = vi.fn();
    const r = new HeaderSourceResolver(onFailure);
    for (const bad of [undefined, "Bearer x", ["a", "b"], null]) {
      r.setSource((() => bad) as never);
      expect(() => r.resolve()).toThrow(CopilotKitHeaderResolutionError);
    }
    expect(onFailure).toHaveBeenCalledTimes(4);
    // The message must not echo the returned value.
    expect(String(onFailure.mock.calls[1]![0].message)).not.toContain("Bearer");
  });

  it("isHeaderResolutionError walks the cause chain", () => {
    const inner = new CopilotKitHeaderResolutionError(new Error("x"));
    expect(isHeaderResolutionError(new Error("wrap", { cause: inner }))).toBe(
      true,
    );
    expect(isHeaderResolutionError(new Error("plain"))).toBe(false);
  });
});

describe("ɵwithHeaderDefaults", () => {
  it("fills only missing or empty keys, for a record and for builders", async () => {
    const d = { "X-Key": "pk" };
    expect(ɵwithHeaderDefaults({ A: "1" }, d)).toEqual({
      A: "1",
      "X-Key": "pk",
    });
    expect(ɵwithHeaderDefaults({ "X-Key": "mine" }, d)).toEqual({
      "X-Key": "mine",
    });
    const sync = ɵwithHeaderDefaults(() => ({ A: "1" }), d) as () => unknown;
    expect(sync()).toEqual({ A: "1", "X-Key": "pk" });
    const asyncSrc = ɵwithHeaderDefaults(
      async () => ({ A: "1" }),
      d,
    ) as () => Promise<unknown>;
    expect(await asyncSrc()).toEqual({ A: "1", "X-Key": "pk" });
  });

  it("returns the source unchanged when there are no defaults", () => {
    const fn = () => ({});
    expect(ɵwithHeaderDefaults(fn, {})).toBe(fn);
  });
});

describe("CopilotKitCore header source", () => {
  it("emits HEADER_RESOLUTION_FAILED once and swallows derived errors for the same failure", async () => {
    const core = new CopilotKitCore({
      headers: async () => {
        throw new Error("nope");
      },
    });
    const onError = vi.fn();
    core.subscribe({ onError });
    await expect(Promise.resolve(core.resolveHeaders())).rejects.toBeInstanceOf(
      CopilotKitHeaderResolutionError,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0].code).toBe("header_resolution_failed");
    // A run failure caused by the same error is not reported a second time.
    const derived = new Error("run failed", {
      cause: onError.mock.calls[0]![0].error,
    });
    await (core as any).emitError({
      error: derived,
      code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("a new token from a builder does not fire onHeadersChanged; setHeaders does", async () => {
    let token = "t1";
    const core = new CopilotKitCore({
      headers: () => ({ Authorization: token }),
    });
    const onHeadersChanged = vi.fn();
    core.subscribe({ onHeadersChanged });
    core.resolveHeaders();
    token = "t2";
    core.resolveHeaders();
    expect(onHeadersChanged).not.toHaveBeenCalled();
    expect(core.headers).toEqual({ Authorization: "t2" });
    const gen = core.ɵheadersGeneration;
    core.setHeaders({ Authorization: "static" });
    await vi.waitFor(() => expect(onHeadersChanged).toHaveBeenCalledTimes(1));
    expect(core.ɵheadersGeneration).toBe(gen + 1);
  });

  it("switching from a record to a builder does not re-apply or broadcast the old record's headers", () => {
    const core = new CopilotKitCore({});
    core.setHeaders({ Authorization: "old-user" });
    const onHeadersChanged = vi.fn();
    core.subscribe({ onHeadersChanged });

    core.setHeaders(() => ({ Authorization: "new-user" }));

    // The builder hasn't run yet, so the snapshot must not still hold the
    // previous source's value.
    expect(core.headers).not.toHaveProperty("Authorization", "old-user");
    expect(onHeadersChanged).toHaveBeenCalledTimes(1);
    expect(onHeadersChanged.mock.calls[0]![0].headers).not.toHaveProperty(
      "Authorization",
      "old-user",
    );
  });

  it("setHeaders with an equal record fires no onHeadersChanged; a changed record fires it once", async () => {
    const core = new CopilotKitCore({ headers: { Authorization: "Bearer a" } });
    const onHeadersChanged = vi.fn();
    core.subscribe({ onHeadersChanged });
    const gen = core.ɵheadersGeneration;

    core.setHeaders({ Authorization: "Bearer a" });
    expect(core.ɵheadersGeneration).toBe(gen);
    // Give a (buggy) notification a real chance to land before asserting
    // its absence.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onHeadersChanged).not.toHaveBeenCalled();

    core.setHeaders({ Authorization: "Bearer b" });
    expect(core.ɵheadersGeneration).toBe(gen + 1);
    await vi.waitFor(() => expect(onHeadersChanged).toHaveBeenCalledTimes(1));
  });

  it("resolveHeaders() result is typed readonly and cannot be assigned into", () => {
    const core = new CopilotKitCore({ headers: { Authorization: "a" } });
    const result = core.resolveHeaders();
    if (result instanceof Promise) throw new Error("expected a sync result");
    // @ts-expect-error the returned object is shared; copy it before modifying
    result.Authorization = "mutated";
  });
});
