/**
 * Canonical list of CopilotKit hooks the scanner recognizes.
 *
 * Ported from
 * .chalk/references/vscode-extension/src/extension/hooks/hook-registry.ts —
 * trimmed to the subset Studio cares about today plus a few `category: data`
 * entries kept so the registry can be extended without churn.
 *
 * Why this lives in the launcher (not `shared/types.ts`):
 *   - `HookName` in shared types is the *wire-protocol* surface: which
 *     literal strings can appear on a `ToolDescriptor.hook` field as the
 *     launcher serializes registry events to the SPA.
 *   - This file is the *implementation* surface: import sources, render-prop
 *     kinds, and `identityField` metadata that drive the AST walk. The SPA
 *     doesn't need any of it.
 *
 * Adding a hook here without adding it to `HookName` would be a runtime-only
 * detection that the SPA can't represent — keep the two in sync. The
 * `HookCategory` helper below filters render-bearing hooks for the v1 UI.
 */
import type { HookName } from "../shared/types.js";

export type HookCategory = "render" | "data";

export type RenderPropsKind =
  | "action"
  | "render-tool"
  | "coagent-state"
  | "interrupt"
  | "human-in-the-loop"
  | "custom-messages"
  | "activity-message";

export type HookImportSource =
  | "@copilotkit/react-core"
  | "@copilotkit/react-core/v2";

export interface HookDef {
  /** Canonical hook name as exported from the import source. */
  name: HookName;
  /** Whether this hook contributes a render prop (render) or just data (data). */
  category: HookCategory;
  /**
   * For render-prop hooks, the shape of the render callback. Lets downstream
   * agents (M3 sandbox, M4 form) pick the right shim per hook variant
   * without re-deriving it from the hook name.
   */
  renderProps: RenderPropsKind | null;
  /** Which `@copilotkit/*` package this hook is exported from. */
  importSource: HookImportSource;
}

/**
 * Hooks we statically detect today. **Order matters only for stable iteration
 * during the AST walk** — the lookup map below is the authoritative source.
 *
 * Note: M1 ships **all five** render-bearing hooks defined in `HookName`. The
 * SPA still filters on `category === 'render'` so v1 stays focused on
 * render-bearing components per the plan; non-render entries (none today) are
 * here so M2+ work can extend without churning this file.
 */
export const HOOK_REGISTRY: ReadonlyArray<HookDef> = [
  // v1
  {
    name: "useCopilotAction",
    category: "render",
    renderProps: "action",
    importSource: "@copilotkit/react-core",
  },
  // v2 render-tool family
  {
    name: "useRenderTool",
    category: "render",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useRenderToolCall",
    category: "render",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useDefaultRenderTool",
    category: "render",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    // useFrontendTool is render-less per the plan but lives in the same
    // registry so M2+ can light up handler/data tooling without revising
    // this file. The v1 UI filters on `category === 'render'` and won't
    // surface this entry.
    name: "useFrontendTool",
    category: "render",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
];

const HOOK_MAP = new Map<string, HookDef>(
  HOOK_REGISTRY.map((h) => [h.name, h]),
);

/** Lookup a hook's full definition by canonical name. */
export function getHookDef(name: string): HookDef | undefined {
  return HOOK_MAP.get(name);
}

/** Returns true when `name` is one of the CopilotKit hooks we detect. */
export function isCopilotKitHook(name: string): name is HookName {
  return HOOK_MAP.has(name);
}

/**
 * All import sources we care about. Used by the prefilter and by the
 * `localToCanonical` resolution in the scanner.
 */
export const HOOK_IMPORT_SOURCES: ReadonlySet<HookImportSource> = new Set(
  HOOK_REGISTRY.map((h) => h.importSource),
);
