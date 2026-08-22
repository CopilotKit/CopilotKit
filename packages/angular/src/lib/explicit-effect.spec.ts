import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { test, expect, vi } from "vitest";
import { explicitEffect } from "./explicit-effect";

test("re-runs when a signal read in the deps function changes", () => {
  const threadId = signal("t1");
  const run = vi.fn();

  TestBed.runInInjectionContext(() => {
    explicitEffect(() => threadId(), run);
  });
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toBe("t1");

  threadId.set("t2");
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0]).toBe("t2");
});

test("does not re-run when a signal read only in the body changes", () => {
  const tracked = signal("a");
  const untrackedSignal = signal("x");
  const seen: string[] = [];

  TestBed.runInInjectionContext(() => {
    explicitEffect(
      () => tracked(),
      (value) => {
        seen.push(`${value}:${untrackedSignal()}`);
      },
    );
  });
  TestBed.flushEffects();

  expect(seen).toEqual(["a:x"]);

  untrackedSignal.set("y");
  TestBed.flushEffects();

  expect(seen).toEqual(["a:x"]);

  tracked.set("b");
  TestBed.flushEffects();

  expect(seen).toEqual(["a:x", "b:y"]);
});

test("passes an object of deps through to the body", () => {
  const threadId = signal("t1");
  const agentId = signal("a1");
  const run = vi.fn();

  TestBed.runInInjectionContext(() => {
    explicitEffect(() => ({ threadId: threadId(), agentId: agentId() }), run);
  });
  TestBed.flushEffects();

  expect(run.mock.calls[0][0]).toEqual({ threadId: "t1", agentId: "a1" });

  agentId.set("a2");
  TestBed.flushEffects();

  expect(run.mock.calls[1][0]).toEqual({ threadId: "t1", agentId: "a2" });
});

test("runs the registered cleanup before the next run", () => {
  const threadId = signal("t1");
  const cleanup = vi.fn();

  TestBed.runInInjectionContext(() => {
    explicitEffect(
      () => threadId(),
      (_value, onCleanup) => {
        onCleanup(cleanup);
      },
    );
  });
  TestBed.flushEffects();

  expect(cleanup).not.toHaveBeenCalled();

  threadId.set("t2");
  TestBed.flushEffects();

  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("runs the registered cleanup on destroy", () => {
  const cleanup = vi.fn();
  const parent = TestBed.inject(EnvironmentInjector);
  const injector = createEnvironmentInjector([], parent);

  runInInjectionContext(injector, () => {
    explicitEffect(
      () => signal("t1")(),
      (_value, onCleanup) => {
        onCleanup(cleanup);
      },
    );
  });
  TestBed.flushEffects();

  expect(cleanup).not.toHaveBeenCalled();

  injector.destroy();

  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("destroying the returned ref stops further runs", () => {
  const threadId = signal("t1");
  const run = vi.fn();

  const ref = TestBed.runInInjectionContext(() =>
    explicitEffect(() => threadId(), run),
  );
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(1);

  ref.destroy();
  threadId.set("t2");
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(1);
});

test("accepts an injector so it can be created outside an injection context", () => {
  const threadId = signal("t1");
  const run = vi.fn();
  const parent = TestBed.inject(EnvironmentInjector);
  const injector = createEnvironmentInjector([], parent);

  explicitEffect(() => threadId(), run, { injector });
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(1);

  threadId.set("t2");
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(2);
});

test("a signal written in the body does not make the effect re-trigger itself", () => {
  const source = signal(1);
  const derived = signal(0);
  const run = vi.fn((value: number) => {
    derived.set(derived() + value);
  });

  TestBed.runInInjectionContext(() => {
    explicitEffect(() => source(), run);
  });
  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(1);
  expect(derived()).toBe(1);

  TestBed.flushEffects();

  expect(run).toHaveBeenCalledTimes(1);
});
