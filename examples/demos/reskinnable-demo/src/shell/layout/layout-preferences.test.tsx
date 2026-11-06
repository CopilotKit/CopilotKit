import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  LayoutPreferencesProvider,
  useLayoutPreferences,
} from "@/shell/layout/layout-preferences";
import { LAYOUT_PREFERENCES_KEY } from "@/shell/layout/layout-preferences-storage";

function Probe() {
  const { sidebarSide, sidebarOpen, toggleSidebarSide, setSidebarOpen } =
    useLayoutPreferences();
  return (
    <div>
      <span data-testid="side">{sidebarSide}</span>
      <span data-testid="open">{String(sidebarOpen)}</span>
      <button onClick={toggleSidebarSide}>swap</button>
      <button onClick={() => setSidebarOpen(false)}>close</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <LayoutPreferencesProvider>
      <Probe />
    </LayoutPreferencesProvider>,
  );
}

function storedPreferences() {
  return JSON.parse(
    window.localStorage.getItem(LAYOUT_PREFERENCES_KEY) ?? "{}",
  );
}

describe("LayoutPreferencesProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to a left, open sidebar", () => {
    renderProbe();
    expect(screen.getByTestId("side").textContent).toBe("left");
    expect(screen.getByTestId("open").textContent).toBe("true");
  });

  it("hydrates a stored preference on mount", () => {
    window.localStorage.setItem(
      LAYOUT_PREFERENCES_KEY,
      JSON.stringify({ sidebarSide: "right", sidebarOpen: false }),
    );
    renderProbe();
    expect(screen.getByTestId("side").textContent).toBe("right");
    expect(screen.getByTestId("open").textContent).toBe("false");
  });

  it("does not write anything on a first mount with no stored value", () => {
    renderProbe();
    // Persisting the defaults immediately would be indistinguishable from a
    // deliberate user choice, so the first pass is skipped.
    expect(window.localStorage.getItem(LAYOUT_PREFERENCES_KEY)).toBeNull();
  });

  it("toggles the side and persists it", () => {
    renderProbe();
    act(() => screen.getByText("swap").click());

    expect(screen.getByTestId("side").textContent).toBe("right");
    expect(storedPreferences().sidebarSide).toBe("right");
  });

  it("persists the closed state", () => {
    renderProbe();
    act(() => screen.getByText("close").click());

    expect(screen.getByTestId("open").textContent).toBe("false");
    expect(storedPreferences().sidebarOpen).toBe(false);
  });

  /**
   * Deliberate, and load-bearing: `ChatPanelHeader` consumes this hook, so a
   * throwing hook would turn any isolated render of that component into a
   * crash. Mirrors `useChatInbox`'s defensive fallback.
   */
  it("returns inert defaults outside the provider instead of throwing", () => {
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId("side").textContent).toBe("left");
    expect(screen.getByTestId("open").textContent).toBe("true");

    // The no-op setters must not write to storage either.
    act(() => screen.getByText("swap").click());
    expect(window.localStorage.getItem(LAYOUT_PREFERENCES_KEY)).toBeNull();
  });
});
