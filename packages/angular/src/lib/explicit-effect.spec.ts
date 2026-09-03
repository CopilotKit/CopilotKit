import { runInInjectionContext, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { test, expect, vi } from "vitest";
import { explicitEffect } from "./explicit-effect";

function setup() {
  TestBed.configureTestingModule({});
}

test("re-runs when a tracked signal changes", async () => {
  setup();
  const source = signal("a");
  const seen: string[] = [];

  TestBed.runInInjectionContext(() => {
    explicitEffect(
      () => source(),
      (value) => {
        seen.push(value);
      },
    );
  });
  TestBed.flushEffects();
  await Promise.resolve();

  source.set("b");
  TestBed.flushEffects();
  await Promise.resolve();

  expect(seen).toEqual(["a", "b"]);
});

test("ignores signals read only inside run", async () => {
  setup();
  const tracked = signal(1);
  const ignored = signal("x");
  const run = vi.fn();

  TestBed.runInInjectionContext(() => {
    explicitEffect(
      () => tracked(),
      () => {
        // Reading `ignored` here must not subscribe the effect to it.
        void ignored();
        run();
      },
    );
  });
  TestBed.flushEffects();
  await Promise.resolve();

  ignored.set("y");
  TestBed.flushEffects();
  await Promise.resolve();

  expect(run).toHaveBeenCalledTimes(1);
});

test("runs cleanup before re-running and on destroy", async () => {
  setup();
  const source = signal(0);
  const cleaned: number[] = [];

  const ref = TestBed.runInInjectionContext(() =>
    explicitEffect(
      () => source(),
      (value, onCleanup) => {
        onCleanup(() => {
          cleaned.push(value);
        });
      },
    ),
  );
  TestBed.flushEffects();
  await Promise.resolve();

  source.set(1);
  TestBed.flushEffects();
  await Promise.resolve();
  expect(cleaned).toEqual([0]);

  ref.destroy();
  expect(cleaned).toEqual([0, 1]);
});
