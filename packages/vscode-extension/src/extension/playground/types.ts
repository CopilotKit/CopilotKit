import type { HookCallSite } from "../hooks/hook-scanner";

/**
 * A single `<CopilotKit>` JSX node's location + the props parsed from it.
 * Populated by scanner.ts; consumed by the webview to reconstruct the
 * provider when the chat tab opens in Plan #2+.
 */
export interface CopilotKitProviderLocation {
  filePath: string;
  loc: { line: number; column: number; endLine: number; endColumn: number };
  props: CopilotKitProps;
  /** Which component the user imported. */
  importedName: "CopilotKit" | "CopilotKitProvider";
  /** Which package the import came from. */
  importSource: "@copilotkit/react-core" | "@copilotkit/react-core/v2";
}

/**
 * Props lifted off the user's `<CopilotKit>` JSX. Values are either JSON-safe
 * (strings, numbers, booleans, objects, arrays) or recorded as "unserializable"
 * with a source reference the bundler can resolve in Plan #2.
 */
export interface CopilotKitProps {
  [attr: string]:
    | string
    | number
    | boolean
    | null
    | CopilotKitProps
    | CopilotKitProps[]
    | UnserializableRef;
}

export interface UnserializableRef {
  __unserializable: true;
  /** Human-readable reason — e.g. "inline arrow function", "identifier reference". */
  reason: string;
  /** Source text of the expression so Plan #2's bundler can inline it. */
  source: string;
  /** Location of the expression in the source file. */
  loc: { line: number; column: number; endLine: number; endColumn: number };
}

/**
 * One entry in the provider ancestor chain. Ordered outermost-first
 * (e.g. [AuthProvider, ThemeProvider] means <AuthProvider><ThemeProvider>...
 * is the intended rendering order).
 */
export interface ProviderChainEntry {
  /** JSX tag name — `AuthProvider`, `ThemeProvider`, `MyNamespaced.Provider`. */
  tagName: string;
  /** Props serialized the same way as CopilotKitProps. */
  props: CopilotKitProps;
  /** Source location of the opening JSX element. */
  loc: { line: number; column: number; endLine: number; endColumn: number };
  filePath: string;
}

/**
 * A user component that contains one or more CopilotKit hook calls.
 * Aggregator codegen in Plan #2 renders these components inside error
 * boundaries. Plan #1 only reports them.
 */
export interface ComponentWithHooks {
  filePath: string;
  /** Exported identifier, `"default"` for the default export, or `null` if not exported. */
  exportName: string | null;
  /** Local function name inside the module (may differ from exportName). */
  componentName: string;
  /** Location of the function/arrow declaration. */
  loc: { line: number; column: number; endLine: number; endColumn: number };
  /** Every hook call site that lives inside this component. */
  hooks: HookCallSite[];
}

/**
 * Non-fatal issues the scanner surfaces to the user (multiple providers,
 * unresolvable imports, hooks outside any component, etc.). Each warning
 * surfaces as a diagnostic card in the chat tab.
 */
export interface ScanWarning {
  kind:
    | "multiple-providers"
    | "hook-outside-component"
    | "unresolvable-prop"
    | "unexported-component"
    | "scan-error";
  message: string;
  filePath?: string;
  loc?: { line: number; column: number };
}

/**
 * The full result consumed by the webview. The webview renders a tree of
 * providers and components; later plans swap chat in alongside.
 */
export interface PlaygroundScanResult {
  /** Every `<CopilotKit>` JSX node found in the workspace. If >1, the
   *  webview shows a warning banner and uses the first for the chat
   *  session (§10 of the spec). */
  providers: CopilotKitProviderLocation[];
  /** Ancestor chain of the first provider (same-file only in Plan #1). */
  ancestorChain?: ProviderChainEntry[];
  /** Every user component that contains at least one CopilotKit hook. */
  componentsWithHooks: ComponentWithHooks[];
  /** Flat list of every hook call site (reuses hook-scanner's HookCallSite). */
  hookSites: HookCallSite[];
  warnings: ScanWarning[];
}
