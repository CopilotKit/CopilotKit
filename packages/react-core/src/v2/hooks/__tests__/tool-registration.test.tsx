import React, {
  Suspense,
  StrictMode,
  startTransition,
  useLayoutEffect,
} from "react";
import { act, render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useDepsVersion } from "../tool-registration";

const never = new Promise<never>(() => {});

function Probe({
  deps,
  suspend,
  onCommit,
}: {
  deps: ReadonlyArray<unknown> | undefined;
  suspend: boolean;
  onCommit: (version: number) => void;
}) {
  const version = useDepsVersion(deps);
  useLayoutEffect(() => {
    onCommit(version);
  });
  if (suspend) throw never;
  return null;
}

function renderProbe(
  deps: ReadonlyArray<unknown> | undefined,
  Wrapper = React.Fragment,
) {
  const commits: number[] = [];
  const onCommit = (version: number) => commits.push(version);
  const ui = (next: ReadonlyArray<unknown> | undefined, suspend = false) => (
    <Wrapper>
      <Suspense fallback={null}>
        <Probe deps={next} suspend={suspend} onCommit={onCommit} />
      </Suspense>
    </Wrapper>
  );
  const result = render(ui(deps));
  return { commits, rerender: result.rerender, ui };
}

describe("useDepsVersion", () => {
  it("keeps the version while deps stay equal, and bumps it once per change", () => {
    const { commits, rerender, ui } = renderProbe([1, { a: "x" }]);
    rerender(ui([1, { a: "x" }]));
    rerender(ui([2, { a: "x" }]));
    rerender(ui([2, { a: "x" }]));
    rerender(ui([1, { a: "x" }]));
    expect(commits).toEqual([0, 0, 1, 1, 2]);
  });

  it("treats missing deps as an empty list", () => {
    const { commits, rerender, ui } = renderProbe(undefined);
    rerender(ui([]));
    rerender(ui(undefined));
    expect(commits).toEqual([0, 0, 0]);
  });

  it("bumps once per change under StrictMode double rendering", () => {
    const { commits, rerender, ui } = renderProbe([1], StrictMode);
    rerender(ui([1]));
    rerender(ui([2]));
    rerender(ui([2]));
    expect(commits.at(-1)).toBe(1);
    expect(commits.every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("ignores a render that React discards", async () => {
    const { commits, rerender, ui } = renderProbe([1]);

    // A transition that suspends is never committed, so its deps must not
    // become the baseline the next render compares against.
    await act(async () => {
      startTransition(() => {
        rerender(ui([2], true));
      });
    });
    expect(commits).toEqual([0]);

    // Back on the committed deps: the version must not move, or every tool
    // effect keyed on it would re-register for nothing.
    rerender(ui([1]));
    expect(commits.at(-1)).toBe(0);
  });
});
