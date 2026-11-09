import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ShellFrame } from "@/shell/layout/shell-frame";
import { LayoutPreferencesProvider } from "@/shell/layout/layout-preferences";
import { LAYOUT_PREFERENCES_KEY } from "@/shell/layout/layout-preferences-storage";

/** jsdom has no layout engine, so matchMedia must be stubbed per test. */
function stubViewport({ desktop }: { desktop: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: desktop,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function renderFrame() {
  return render(
    <LayoutPreferencesProvider>
      <ShellFrame
        activeSkinId="banking"
        chat={<div>chat here</div>}
        app={<div>app here</div>}
      />
    </LayoutPreferencesProvider>,
  );
}

function panelOrder() {
  return Array.from(
    screen
      .getByTestId("shell-frame")
      .querySelectorAll("[data-testid$='-panel']"),
  ).map((node) => node.getAttribute("data-testid"));
}

describe("ShellFrame", () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubViewport({ desktop: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the chat, the app, and the selector together", () => {
    renderFrame();
    expect(screen.getByText("chat here")).toBeDefined();
    expect(screen.getByText("app here")).toBeDefined();
    expect(screen.getByTestId("skin-selector")).toBeDefined();
  });

  it("puts the sidebar before the app when docked left", () => {
    renderFrame();
    expect(panelOrder()).toEqual(["sidebar-panel", "app-panel"]);
  });

  it("puts the app before the sidebar when docked right", () => {
    window.localStorage.setItem(
      LAYOUT_PREFERENCES_KEY,
      JSON.stringify({ sidebarSide: "right", sidebarOpen: true }),
    );
    renderFrame();
    expect(panelOrder()).toEqual(["app-panel", "sidebar-panel"]);
  });

  it("hides the selector with the chat when collapsed, and offers a launcher", () => {
    window.localStorage.setItem(
      LAYOUT_PREFERENCES_KEY,
      JSON.stringify({ sidebarSide: "left", sidebarOpen: false }),
    );
    renderFrame();

    // The selector and the chat are ONE logical sidebar: collapsing takes both.
    expect(screen.queryByTestId("skin-selector")).toBeNull();
    expect(screen.queryByText("chat here")).toBeNull();
    expect(screen.getByText("app here")).toBeDefined();
    expect(screen.getByTestId("sidebar-launcher")).toBeDefined();
  });

  it("restores the sidebar from the launcher", () => {
    window.localStorage.setItem(
      LAYOUT_PREFERENCES_KEY,
      JSON.stringify({ sidebarSide: "left", sidebarOpen: false }),
    );
    renderFrame();

    act(() => screen.getByTestId("sidebar-launcher").click());

    expect(screen.getByTestId("skin-selector")).toBeDefined();
    expect(screen.getByText("chat here")).toBeDefined();
  });

  it("drops the panel group below the desktop breakpoint", () => {
    stubViewport({ desktop: false });
    renderFrame();

    // The px floors sum to 1160px, so the constraints are unsatisfiable here —
    // no Group is rendered at all and the app takes the viewport.
    expect(
      screen.getByTestId("shell-frame").querySelector("[data-group]"),
    ).toBeNull();
    expect(screen.getByText("app here")).toBeDefined();
  });
});
