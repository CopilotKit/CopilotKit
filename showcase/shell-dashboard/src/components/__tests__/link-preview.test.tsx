import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import {
  LinkPreview,
  HOVER_DELAY_MS,
  DISMISS_DELAY_MS,
  LOAD_TIMEOUT_MS,
} from "../link-preview";

function flushTimers() {
  act(() => {
    vi.runAllTimers();
  });
}

function advanceBy(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("LinkPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    if (!document.getElementById("link-preview-root")) {
      const el = document.createElement("div");
      el.id = "link-preview-root";
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    const root = document.getElementById("link-preview-root");
    if (root) root.innerHTML = "";
  });

  it("renders children (the link) immediately without a popup", () => {
    const { getByText, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <a href="https://example.com">Demo ↗</a>
      </LinkPreview>,
    );
    expect(getByText("Demo ↗")).toBeInTheDocument();
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();
  });

  it("shows popup after hover delay", () => {
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS - 1);
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();
    advanceBy(1);
    expect(queryByTestId("link-preview-popup")).toBeInTheDocument();
  });

  it("does not show popup if mouse leaves before hover delay", () => {
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    const wrapper = getByTestId("trigger").parentElement!;
    fireEvent.mouseEnter(wrapper);
    advanceBy(HOVER_DELAY_MS - 100);
    fireEvent.mouseLeave(wrapper);
    flushTimers();
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();
  });

  it("dismisses popup after dismiss delay when mouse leaves both link and popup", () => {
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    expect(queryByTestId("link-preview-popup")).toBeInTheDocument();
    fireEvent.mouseLeave(getByTestId("trigger").parentElement!);
    advanceBy(DISMISS_DELAY_MS - 1);
    expect(queryByTestId("link-preview-popup")).toBeInTheDocument();
    advanceBy(1);
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();
  });

  it("keeps popup open when mouse moves from link into popup (bridge gap)", () => {
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const popup = queryByTestId("link-preview-popup")!;
    expect(popup).toBeInTheDocument();
    fireEvent.mouseLeave(getByTestId("trigger").parentElement!);
    advanceBy(DISMISS_DELAY_MS / 2);
    fireEvent.mouseEnter(popup);
    flushTimers();
    expect(queryByTestId("link-preview-popup")).toBeInTheDocument();
  });

  it("contains an iframe with the correct src", () => {
    const { getByTestId } = render(
      <LinkPreview href="https://example.com/preview">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const iframe = getByTestId("link-preview-popup").querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute("src")).toBe("https://example.com/preview");
    expect(iframe!.style.pointerEvents).toBe("none");
  });

  it("has a transparent click overlay that opens URL in new tab", () => {
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const { getByTestId } = render(
      <LinkPreview href="https://example.com/preview">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const overlay = getByTestId("link-preview-overlay");
    fireEvent.click(overlay);
    expect(windowOpen).toHaveBeenCalledWith(
      "https://example.com/preview",
      "_blank",
      "noopener,noreferrer",
    );
    windowOpen.mockRestore();
  });

  it("dismisses popup on overlay click", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com/preview">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    fireEvent.click(getByTestId("link-preview-overlay"));
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();
    vi.mocked(window.open).mockRestore();
  });

  it("renders popup in a portal (link-preview-root)", () => {
    const { getByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const portalRoot = document.getElementById("link-preview-root");
    expect(
      portalRoot!.querySelector("[data-testid='link-preview-popup']"),
    ).toBeTruthy();
  });

  it("applies position-flip class when near viewport bottom", () => {
    const { getByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    const wrapper = getByTestId("trigger").parentElement!;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      top: 600,
      bottom: 620,
      left: 100,
      right: 200,
      width: 100,
      height: 20,
      x: 100,
      y: 600,
      toJSON: () => {},
    });
    Object.defineProperty(window, "innerHeight", {
      value: 700,
      writable: true,
    });
    fireEvent.mouseEnter(wrapper);
    advanceBy(HOVER_DELAY_MS);
    const popup = getByTestId("link-preview-popup");
    expect(popup.getAttribute("data-position")).toBe("above");
  });

  it("does not show popup on touch devices (hover: none)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo ↗</span>
      </LinkPreview>,
    );
    const wrapper = getByTestId("trigger").parentElement!;
    fireEvent.mouseEnter(wrapper);
    advanceBy(HOVER_DELAY_MS + 100);
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();
  });
});

describe("LinkPreview load states", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    if (!document.getElementById("link-preview-root")) {
      const el = document.createElement("div");
      el.id = "link-preview-root";
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    const root = document.getElementById("link-preview-root");
    if (root) root.innerHTML = "";
  });

  it("shows loading state initially when popup appears", () => {
    const { getByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const portalRoot = document.getElementById("link-preview-root")!;
    expect(
      portalRoot.querySelector("[data-testid='link-preview-loading']"),
    ).toBeTruthy();
  });

  it("shows loaded state after iframe onLoad fires", () => {
    const { getByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const portalRoot = document.getElementById("link-preview-root")!;
    const iframe = portalRoot.querySelector("iframe")!;
    act(() => {
      fireEvent.load(iframe);
    });
    expect(
      portalRoot.querySelector("[data-testid='link-preview-loading']"),
    ).toBeNull();
    expect(iframe.style.opacity).toBe("1");
  });

  it("shows unavailable state after 8s timeout", () => {
    const { getByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo</span>
      </LinkPreview>,
    );
    fireEvent.mouseEnter(getByTestId("trigger").parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const portalRoot = document.getElementById("link-preview-root")!;
    expect(
      portalRoot.querySelector("[data-testid='link-preview-loading']"),
    ).toBeTruthy();
    advanceBy(LOAD_TIMEOUT_MS);
    expect(
      portalRoot.querySelector("[data-testid='link-preview-unavailable']"),
    ).toBeTruthy();
    expect(
      portalRoot.querySelector("[data-testid='link-preview-loading']"),
    ).toBeNull();
    expect(portalRoot.textContent).toContain("Preview unavailable");
  });

  it("resets load state when popup is dismissed and reopened", () => {
    const { getByTestId, queryByTestId } = render(
      <LinkPreview href="https://example.com">
        <span data-testid="trigger">Demo</span>
      </LinkPreview>,
    );
    const wrapper = getByTestId("trigger").parentElement!;

    // Show popup and load iframe
    fireEvent.mouseEnter(wrapper);
    advanceBy(HOVER_DELAY_MS);
    const portalRoot = document.getElementById("link-preview-root")!;
    const iframe = portalRoot.querySelector("iframe")!;
    act(() => {
      fireEvent.load(iframe);
    });
    expect(
      portalRoot.querySelector("[data-testid='link-preview-loading']"),
    ).toBeNull();

    // Dismiss popup
    fireEvent.mouseLeave(wrapper);
    advanceBy(DISMISS_DELAY_MS);
    expect(queryByTestId("link-preview-popup")).not.toBeInTheDocument();

    // Re-hover — should show loading again
    fireEvent.mouseEnter(wrapper);
    advanceBy(HOVER_DELAY_MS);
    expect(
      portalRoot.querySelector("[data-testid='link-preview-loading']"),
    ).toBeTruthy();
  });
});

describe("LinkPreview singleton behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    if (!document.getElementById("link-preview-root")) {
      const el = document.createElement("div");
      el.id = "link-preview-root";
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    const root = document.getElementById("link-preview-root");
    if (root) root.innerHTML = "";
  });

  it("only one popup visible at a time", () => {
    const { getAllByTestId } = render(
      <div>
        <LinkPreview href="https://one.com">
          <span data-testid="trigger">Link 1</span>
        </LinkPreview>
        <LinkPreview href="https://two.com">
          <span data-testid="trigger">Link 2</span>
        </LinkPreview>
      </div>,
    );
    const triggers = getAllByTestId("trigger");
    fireEvent.mouseEnter(triggers[0].parentElement!);
    advanceBy(HOVER_DELAY_MS);
    const portalRoot = document.getElementById("link-preview-root")!;
    expect(
      portalRoot.querySelectorAll("[data-testid='link-preview-popup']").length,
    ).toBe(1);
    fireEvent.mouseEnter(triggers[1].parentElement!);
    advanceBy(HOVER_DELAY_MS);
    expect(
      portalRoot.querySelectorAll("[data-testid='link-preview-popup']").length,
    ).toBe(1);
    const iframe = portalRoot.querySelector("iframe");
    expect(iframe!.getAttribute("src")).toBe("https://two.com");
  });
});
