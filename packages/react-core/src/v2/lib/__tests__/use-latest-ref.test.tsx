import React, {
  Suspense,
  startTransition,
  useEffect,
  useLayoutEffect,
} from "react";
import type { MutableRefObject } from "react";
import { act, render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useLatestRef } from "../use-latest-ref";

const never = new Promise<never>(() => {});

function Probe({
  value,
  suspend = false,
  onRender,
  onLayoutEffect,
  onEffect,
}: {
  value: string;
  suspend?: boolean;
  onRender?: (ref: MutableRefObject<string>) => void;
  onLayoutEffect?: (seen: string) => void;
  onEffect?: (seen: string) => void;
}) {
  const ref = useLatestRef(value);
  onRender?.(ref);
  useLayoutEffect(() => {
    onLayoutEffect?.(ref.current);
  });
  useEffect(() => {
    onEffect?.(ref.current);
  });
  if (suspend) throw never;
  return null;
}

describe("useLatestRef", () => {
  it("holds the initial value from the first render", () => {
    let ref!: MutableRefObject<string>;
    render(<Probe value="a" onRender={(r) => (ref = r)} />);
    expect(ref.current).toBe("a");
  });

  it("returns the same ref object on every render", () => {
    const refs: MutableRefObject<string>[] = [];
    const { rerender } = render(
      <Probe value="a" onRender={(r) => refs.push(r)} />,
    );
    rerender(<Probe value="b" onRender={(r) => refs.push(r)} />);
    expect(refs[1]).toBe(refs[0]);
  });

  it("is up to date in layout and passive effects of the commit that changed it", () => {
    const layout: string[] = [];
    const passive: string[] = [];
    const ui = (value: string) => (
      <Probe
        value={value}
        onLayoutEffect={(seen) => layout.push(seen)}
        onEffect={(seen) => passive.push(seen)}
      />
    );
    const { rerender } = render(ui("a"));
    rerender(ui("b"));
    expect(layout).toEqual(["a", "b"]);
    expect(passive).toEqual(["a", "b"]);
  });

  it("never takes the value of a render React discards", async () => {
    let ref!: MutableRefObject<string>;
    const ui = (value: string, suspend = false) => (
      <Suspense fallback={null}>
        <Probe value={value} suspend={suspend} onRender={(r) => (ref = r)} />
      </Suspense>
    );
    const { rerender } = render(ui("committed"));

    // A transition that suspends is never committed: React keeps showing the
    // old UI, so the value from that render must not reach the ref.
    await act(async () => {
      startTransition(() => {
        rerender(ui("discarded", true));
      });
    });
    expect(ref.current).toBe("committed");
  });
});
