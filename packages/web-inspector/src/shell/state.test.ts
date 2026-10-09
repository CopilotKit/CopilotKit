import { describe, expect, it } from "vitest";

import { buildPersistedShellState, createContextState } from "./state.js";

function createPersistedStateInput() {
  return {
    contextState: createContextState(48),
    hasCustomPosition: { button: false, window: true },
    isOpen: true,
    dockMode: "floating" as const,
    selectedMenu: "threads",
    pendingPersistedMenu: null,
    briefingRestoreMenu: null,
    selectedContext: "agent-1",
    hasOpenedInspector: true,
    sidebarCollapsed: false,
    hasExplicitColorScheme: true,
    colorScheme: "dark" as const,
  };
}

describe("shell state", () => {
  it("creates independent launcher and window state", () => {
    const state = createContextState(48);

    expect(state.button.size).toEqual({ width: 48, height: 48 });
    expect(state.window.size).toEqual({ width: 960, height: 740 });
    expect(state.button.anchorOffset).not.toBe(state.window.anchorOffset);
  });

  it("preserves a pending menu and explicit color preference", () => {
    const persisted = buildPersistedShellState({
      ...createPersistedStateInput(),
      pendingPersistedMenu: "learning",
    });

    expect(persisted.selectedMenu).toBe("learning");
    expect(persisted.colorSchemePreference).toBe("dark");
  });

  it("restores the pre-briefing menu without persisting a system theme", () => {
    const persisted = buildPersistedShellState({
      ...createPersistedStateInput(),
      selectedMenu: "home",
      briefingRestoreMenu: "events",
      hasExplicitColorScheme: false,
    });

    expect(persisted.selectedMenu).toBe("events");
    expect(persisted.colorSchemePreference).toBeUndefined();
  });
});
