import React, {
  Suspense,
  StrictMode,
  startTransition,
  useLayoutEffect,
} from "react";
import { act, render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useShallowStableRef } from "../shallow-stable-ref";

const never = new Promise<never>(() => {});

function Probe({
  value,
  suspend,
  onCommit,
}: {
  value: unknown;
  suspend: boolean;
  onCommit: (stable: unknown) => void;
}) {
  const stable = useShallowStableRef(value);
  useLayoutEffect(() => {
    onCommit(stable);
  });
  if (suspend) throw never;
  return null;
}

function renderProbe(value: unknown, Wrapper = React.Fragment) {
  const commits: unknown[] = [];
  const onCommit = (stable: unknown) => commits.push(stable);
  const ui = (next: unknown, suspend = false) => (
    <Wrapper>
      <Suspense fallback={null}>
        <Probe value={next} suspend={suspend} onCommit={onCommit} />
      </Suspense>
    </Wrapper>
  );
  const result = render(ui(value));
  return { commits, rerender: result.rerender, ui };
}

describe("useShallowStableRef", () => {
  it("keeps the first committed reference across shallowly equal values", () => {
    const first = { a: 1 };
    const { commits, rerender, ui } = renderProbe(first);
    rerender(ui({ a: 1 }));
    rerender(ui({ a: 1 }));
    expect(commits).toEqual([first, first, first]);
    expect(commits.every((c) => c === first)).toBe(true);
  });

  it("switches to the new reference when the value changes, then holds it", () => {
    const first = { a: 1 };
    const second = { a: 2 };
    const { commits, rerender, ui } = renderProbe(first);
    rerender(ui(second));
    rerender(ui({ a: 2 }));
    expect(commits[1]).toBe(second);
    expect(commits[2]).toBe(second);
  });

  it("returns a fresh reference after A -> B -> A", () => {
    const first = { a: 1 };
    const third = { a: 1 };
    const { commits, rerender, ui } = renderProbe(first);
    rerender(ui({ a: 2 }));
    rerender(ui(third));
    expect(commits[2]).toBe(third);
  });

  it("keeps the reference stable under StrictMode double rendering", () => {
    const first = { a: 1 };
    const { commits, rerender, ui } = renderProbe(first, StrictMode);
    rerender(ui({ a: 1 }));
    rerender(ui({ a: 1 }));
    expect(commits.length).toBeGreaterThanOrEqual(3);
    expect(commits.every((c) => c === first)).toBe(true);
  });

  it("ignores a render that React discards", async () => {
    const first = { a: 1 };
    const { commits, rerender, ui } = renderProbe(first);

    // A transition that suspends is never committed: React keeps showing the
    // old UI, so the value from that render must not become the baseline.
    await act(async () => {
      startTransition(() => {
        rerender(ui({ a: 2 }, true));
      });
    });
    expect(commits).toEqual([first]);

    // An urgent update with a value equal to the committed one keeps the
    // committed reference.
    rerender(ui({ a: 1 }));
    expect(commits.at(-1)).toBe(first);
  });
});
