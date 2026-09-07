import type { ComponentType, ReactNode } from "react";
import type { createCatalog } from "@copilotkit/a2ui-renderer";
import type { SandboxFunction } from "@copilotkit/react-core/v2";

/**
 * The Skin contract — the single interface every skin implements. This is the
 * ONLY inbound dependency a skin has on the shell, which is what lets skins be
 * built in parallel without touching shared code.
 *
 * FROZEN after Phase 0. Changing it invalidates in-flight parallel skin work —
 * coordinate before editing.
 *
 * Re-authored for this app (NOT inherited verbatim from the standalone
 * prototype). It carries FOUR additions over the prototype's contract, each
 * closing a gap that would otherwise make a shipped banking feature
 * inexpressible — so a future reader knows these are deliberate, not drift:
 *   1. `toolLabels` — human labels for a skin's own tool-activity chips.
 *   2. `ChatHeaderAction` + `chatHeaderActions` — buttons a skin contributes
 *      to the shared chat header.
 *   3. `onSuggestionSelect` — a suggestion pill may stage an attachment and
 *      drive the composer instead of sending plain text.
 *   4. Corrected OGUI prose — OGUI surfaces render full-region on the shared
 *      canvas (the workspace packages export a full-canvas OGUI renderer), NOT
 *      inline in chat as the prototype's published-SDK-limited note claimed.
 *   5. `RuntimeProviders` + `useRuntimeProperties` — a sanctioned way for a skin
 *      to contribute its own end-user identity / runtime `properties` through
 *      the contract, so the shared API route no longer has to reach into a
 *      skin's internals (banking's) and apply one skin's identity scheme to
 *      every skin's Intelligence runs. Identity now flows through
 *      `CopilotKitProvider`'s `properties` prop (provider-owned), not a child
 *      racing `setProperties`.
 *   6. `useData` is OPTIONAL — a REST-backed skin has no shell-managed data, so
 *      it need not stub the hook; `useSkinData<T>()` returns `undefined` there.
 */

/** A nav entry that drives the skin's layout navigation and route resolution. */
export interface NavRoute {
  /** URL segment after the skin, e.g. "" (index), "cards", "team". */
  segment: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/** A static suggestion pill (registered via useConfigureSuggestions, available:"always"). */
export interface Suggestion {
  title: string;
  message: string;
}

/** An action button a skin contributes to the shared chat header. */
export interface ChatHeaderAction {
  /** Icon component, e.g. a lucide-react icon. */
  icon: ComponentType<{ className?: string }>;
  /** Accessible label / tooltip. */
  label: string;
  onClick: () => void;
}

/** An a2ui catalog as produced by createCatalog() from @copilotkit/a2ui-renderer. */
export type A2uiCatalog = ReturnType<typeof createCatalog>;

/** The single contract every skin implements. */
export interface Skin {
  /** Stable id — MUST equal the route segment AND the agentId. */
  id: string;
  identity: {
    brand: string;
    tagline: string;
    logo: ComponentType<{ className?: string }>;
    /**
     * OPTIONAL emoji browser-tab icon (e.g. "✈️"). The shell renders it into a
     * `<link rel="icon">` per skin (see FaviconSync in /[skin]/layout.tsx), so
     * `/airline` shows ✈️ and `/banking` shows 🏦. Omit to keep the app's static
     * favicon.ico.
     */
    favicon?: string;
    /** Chat header title. Defaults to `brand` when omitted. */
    assistantName?: string;
    /** Chat welcome message. Defaults to `tagline` when omitted. */
    greeting?: string;
  };
  /** CSS class applied to the theme root that scopes this skin's design tokens. */
  themeClass: string;
  /** The app-shell chrome (nav/header) for this skin. */
  Layout: ComponentType<{ children: ReactNode }>;
  /**
   * Nav entries the layout renders as its visible navigation. NOT the validator
   * for which segments are valid — `resolvePage` is the single source of truth
   * for that (it may accept segments nav does not list; e.g. banking's
   * `resolvePage` accepts "cards" as an index alias that its `nav` omits).
   */
  nav: NavRoute[];
  /** Map the URL segments (after /[skin]) to a page component, or null → 404. */
  resolvePage: (segments: string[]) => ComponentType | null;
  /** Registers frontend tools / HITL / gen-UI components + agent-context readables. Renders null. */
  Tools: ComponentType;
  /** OPTIONAL escape hatch: skin-specific provider stack (e.g. banking recording). */
  Providers?: ComponentType<{ children: ReactNode }>;
  /**
   * OPTIONAL: renders this skin's a2ui report surface full-region on the shared
   * canvas. The shell owns the canvas region, OGUI rendering, and surface-kind
   * detection; a skin supplies this to render its own catalog-bound a2ui
   * surface (it typically wraps its data provider + <A2UIProvider catalog>).
   * The shell handles the OGUI surface kind generically, so a skin does NOT
   * supply an OGUI renderer here — this is only its own a2ui report surface.
   * Omit if the skin has no a2ui report canvas; every shipped skin has one, so
   * the canvas's "no surface for this kind" branch is currently unexercised.
   */
  CanvasSurface?: ComponentType;
  catalog: A2uiCatalog;
  suggestions: Suggestion[];
  /** OGUI design brief — injected as agent context to style generated UIs. */
  designSkill: string;
  /**
   * OPTIONAL: functions exposed inside OGUI sandboxed iframes for this skin
   * (app-specific — e.g. banking's spend-data getters). OGUI surfaces render
   * full-region on the shared canvas: the shell owns that canvas region and the
   * surface-kind detection, and renders the OGUI surface generically with the
   * workspace `OpenGenerativeUIActivityRenderer`. A skin therefore does not
   * supply an OGUI renderer — it only contributes these sandbox functions.
   */
  sandboxFunctions?: SandboxFunction[];
  /**
   * OPTIONAL: human-readable labels for tool-activity chips, keyed by tool
   * name. The shell filters protocol-internal tools itself; this map only
   * prettifies a skin's OWN tools. Unlisted tools fall back to a prettified
   * version of the raw tool name.
   */
  toolLabels?: Record<string, string>;
  /**
   * OPTIONAL: buttons this skin contributes to the shared chat header, drawn
   * before the shell's own controls (inbox toggle, new conversation, close).
   */
  chatHeaderActions?: ChatHeaderAction[];
  /**
   * OPTIONAL: intercept a suggestion click. The shell calls this BEFORE its own
   * default "send the suggestion's message" behavior. Return `true` if the skin
   * fully handled the click (the shell then does nothing further); return false
   * or omit to take the default path.
   */
  onSuggestionSelect?: (suggestion: Suggestion, index: number) => boolean;
  /**
   * OPTIONAL provider stack mounted by the shell ABOVE `CopilotKitProvider`
   * (unlike `Providers`, which mounts below it). This is the sanctioned place
   * for a skin to establish any context its `useRuntimeProperties` hook must
   * read — because `properties` is a prop of `CopilotKitProvider`, its source
   * has to live above the provider so the provider OWNS the identity from its
   * very first commit (no child racing it in via `setProperties`). Banking uses
   * this to hoist its auth context.
   *
   * This is SEPARABLE from `useRuntimeProperties` and airline is the worked
   * example: it supplies `useRuntimeProperties` (and a server `identifyUser`) and
   * omits THIS, because it has one account holder and no switcher, so its hook
   * reads no context and returns a frozen module constant. Mount this only when
   * the hook actually has context to read.
   */
  RuntimeProviders?: ComponentType<{ children: ReactNode }>;
  /**
   * OPTIONAL: contributes this skin's runtime `properties`. The shell calls this
   * hook (inside `RuntimeProviders`, above `CopilotKitProvider`) and threads the
   * result straight into `CopilotKitProvider`'s `properties` prop, so the
   * provider is the single owner of the property bag. This is how a skin scopes
   * its Intelligence runs/durable memory per end-user WITHOUT the shell reaching
   * into skin internals. Return a stable/memoized object; re-scoping on a value
   * change (e.g. banking's member switch) flows through the prop automatically.
   * Omit if the skin contributes no runtime identity (the shell passes none, and
   * the runtime falls back to a generic identity — see agent-registry.ts).
   */
  useRuntimeProperties?: () => Record<string, unknown> | undefined;
  /**
   * OPTIONAL seed-backed data hook consumed by the skin's own components via
   * `useSkinData<T>()`. This is the IN-MEMORY substrate, and it is the minority
   * path: most skins omit it, being REST-backed and reading their own ledger
   * through their own context (banking `useCreditCards` + `useAuthContext`, the
   * rest a `use<Id>Ledger()`), so `useSkinData<T>()` returns `undefined` there.
   * Derive who takes it rather than trusting this comment — from the app root:
   *
   *     grep -l 'useData:' src/skins/-/skin.tsx   # with - as the glob star
   *
   * (Written with `-` on purpose: a literal glob star followed by a slash closes
   * this block comment and the rest of the file becomes a syntax error.)
   *
   * The shell runs the hook whenever a skin supplies one, so the field is live
   * rather than vestigial, and it has a worked example: read that implementor
   * first, then `.claude/skills/reskin/templates.md` § `data/use-data.ts`, which
   * explains when you probably want REST instead.
   */
  useData?: () => unknown;
}

// NOTE: A skin's AGENT is intentionally NOT part of this client contract.
// Agents pull in the server-only @copilotkit/runtime, which must never be
// bundled client-side. Each skin still co-locates its agent in a server-safe
// `agent.ts` (no "use client"), registered in `src/shell/agent-registry.ts`
// and keyed by the SAME id as the skin (id === agentId).
