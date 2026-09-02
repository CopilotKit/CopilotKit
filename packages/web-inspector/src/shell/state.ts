import type { PersistedState } from "../shared/persistence/inspector-state.js";
import type {
  ContextKey,
  ContextState,
  DockMode,
  InspectorColorScheme,
} from "./contracts.js";

export const EDGE_MARGIN = 16;
export const INSPECTOR_STORAGE_KEY = "cpk:inspector:state";
export const DEFAULT_WINDOW_SIZE = { width: 960, height: 740 } as const;

export function createContextState(
  launcherSize: number,
): Record<ContextKey, ContextState> {
  return {
    button: {
      position: { x: EDGE_MARGIN, y: EDGE_MARGIN },
      size: { width: launcherSize, height: launcherSize },
      anchor: { horizontal: "right", vertical: "top" },
      anchorOffset: { x: EDGE_MARGIN, y: EDGE_MARGIN },
    },
    window: {
      position: { x: EDGE_MARGIN, y: EDGE_MARGIN },
      size: { ...DEFAULT_WINDOW_SIZE },
      anchor: { horizontal: "right", vertical: "top" },
      anchorOffset: { x: EDGE_MARGIN, y: EDGE_MARGIN },
    },
  };
}

export type PersistedShellStateInput = {
  contextState: Record<ContextKey, ContextState>;
  hasCustomPosition: Record<ContextKey, boolean>;
  isOpen: boolean;
  dockMode: DockMode;
  selectedMenu: string;
  pendingPersistedMenu: string | null;
  briefingRestoreMenu: string | null;
  selectedContext: string;
  hasOpenedInspector: boolean;
  sidebarCollapsed: boolean;
  hasExplicitColorScheme: boolean;
  colorScheme: InspectorColorScheme;
};

export function buildPersistedShellState(
  input: PersistedShellStateInput,
): PersistedState {
  return {
    button: {
      anchor: input.contextState.button.anchor,
      anchorOffset: input.contextState.button.anchorOffset,
      hasCustomPosition: input.hasCustomPosition.button,
    },
    window: {
      anchor: input.contextState.window.anchor,
      anchorOffset: input.contextState.window.anchorOffset,
      size: {
        width: Math.round(input.contextState.window.size.width),
        height: Math.round(input.contextState.window.size.height),
      },
      hasCustomPosition: input.hasCustomPosition.window,
    },
    isOpen: input.isOpen,
    dockMode: input.dockMode,
    selectedMenu:
      input.pendingPersistedMenu ??
      (input.briefingRestoreMenu && input.selectedMenu === "home"
        ? input.briefingRestoreMenu
        : input.selectedMenu),
    selectedContext: input.selectedContext,
    hasOpenedInspector: input.hasOpenedInspector,
    sidebarCollapsed: input.sidebarCollapsed,
    colorSchemePreference: input.hasExplicitColorScheme
      ? input.colorScheme
      : undefined,
  };
}
