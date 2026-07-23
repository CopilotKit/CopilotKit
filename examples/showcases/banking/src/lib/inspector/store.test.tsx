import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorStoreProvider, useInspector } from "./store";
import type { TimelineCard } from "./event-cards";

const sample: TimelineCard = {
  kind: "lifecycle",
  title: "Run started",
  summary: "x",
  raw: {},
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <InspectorStoreProvider>{children}</InspectorStoreProvider>;
}

describe("useInspector", () => {
  it("pushCard appends a card with a unique id", () => {
    const { result } = renderHook(() => useInspector(), { wrapper });
    act(() => result.current.pushCard(sample));
    act(() => result.current.pushCard(sample));
    expect(result.current.cards).toHaveLength(2);
    expect(result.current.cards[0].id).not.toBe(result.current.cards[1].id);
  });

  it("clear empties the list", () => {
    const { result } = renderHook(() => useInspector(), { wrapper });
    act(() => result.current.pushCard(sample));
    act(() => result.current.clear());
    expect(result.current.cards).toHaveLength(0);
  });

  it("caps the buffer at 200 cards", () => {
    const { result } = renderHook(() => useInspector(), { wrapper });
    act(() => {
      for (let i = 0; i < 250; i++) result.current.pushCard(sample);
    });
    expect(result.current.cards).toHaveLength(200);
  });
});
