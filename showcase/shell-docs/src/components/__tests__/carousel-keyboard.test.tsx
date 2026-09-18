// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Carousel } from "../ui/carousel";
const { prev, next, api } = vi.hoisted(() => {
  const prev = vi.fn();
  const next = vi.fn();
  return {
    prev,
    next,
    api: {
      scrollPrev: prev,
      scrollNext: next,
      canScrollPrev: () => true,
      canScrollNext: () => true,
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});
vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), api] }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("carousel keyboard orientation", () => {
  it.each([
    ["horizontal", "ArrowLeft", "ArrowRight", "ArrowDown"],
    ["vertical", "ArrowUp", "ArrowDown", "ArrowRight"],
  ] as const)("uses %s keys", (orientation, previousKey, nextKey, otherKey) => {
    render(
      <Carousel orientation={orientation}>
        <button>Feature</button>
      </Carousel>,
    );
    const region = screen.getByRole("region");
    fireEvent.keyDown(region, { key: previousKey });
    fireEvent.keyDown(region, { key: nextKey });
    fireEvent.keyDown(region, { key: otherKey });
    expect(prev).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
