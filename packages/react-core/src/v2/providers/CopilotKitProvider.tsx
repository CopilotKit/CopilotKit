"use client";

import { GENERATE_SANDBOXED_UI_DESCRIPTION } from "@copilotkit/shared";
import type React from "react";
import {
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useCopilotKit, useLicenseContext } from "../context";
import type { CopilotKitCoreReact } from "../context";
export type { CopilotKitContextValue } from "../context";
export { CopilotKitContext, useLicenseContext } from "../context";
import type { z } from "zod";
import { CopilotKitInspector } from "../components/CopilotKitInspector";
import { CopilotKitInspectorContextProvider } from "../components/CopilotKitInspectorContext";
import type { CopilotKitInspectorOpenRequest } from "../components/CopilotKitInspectorContext";
import { LicenseWarningBanner } from "../components/license-warning-banner";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../components/MCPAppsActivityRenderer";
import {
  OpenGenerativeUIActivityType,
  OpenGenerativeUIContentSchema,
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIToolRenderer,
  GenerateSandboxedUiArgsSchema,
} from "../components/OpenGenerativeUIRenderer";
import { createA2UIMessageRenderer } from "../a2ui/A2UIMessageRenderer";
import type { A2UIRecoveryRendererOptions } from "../a2ui/A2UIRecoveryStates";
import { A2UIBuiltInToolCallRenderer } from "../a2ui/A2UIToolCallRenderer";
import { A2UICatalogContext } from "../a2ui/A2UICatalogContext";
import { useGenerativeUIRoot } from "../generative-ui/use-generative-ui-root";
import type { GenerativeUIConfig } from "../generative-ui/runtime-context";
import {
  createGenerativeUIActivityRenderer,
  createGenerativeUIFunctionCallActivityRenderer,
  GenerativeUIToolCallRenderer,
} from "../generative-ui/chat";
import { GenerativeUIRuntimeContext } from "../generative-ui/runtime-context";
import { viewerTheme, filterCatalog, Catalog } from "@copilotkit/a2ui-renderer";
import type { Theme as A2UITheme } from "@copilotkit/a2ui-renderer";
import type { ReactActivityMessageRenderer } from "../types";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { SandboxFunction } from "../types/sandbox-function";
import { SandboxFunctionsContext } from "./SandboxFunctionsContext";
import {
  CopilotKitHeadlessProvider,
  useStableArrayProp,
} from "./CopilotKitHeadlessProvider";
import type {
  CopilotKitHeadlessProviderProps,
  ɵCopilotKitHeadlessProviderExtension,
  ɵCopilotKitRuntimeFeatures,
} from "./CopilotKitHeadlessProvider";
import { schemaToJsonSchema, shouldEnableInspector } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

// Adapts zod-to-json-schema's zod-specific signature to the injectable
// `zodToJsonSchema` contract of `schemaToJsonSchema`, which only invokes it
// for schemas whose `~standard.vendor` is "zod".
const zodToJsonSchemaAdapter = (
  schema: unknown,
  options?: { $refStrategy?: string },
): Record<string, unknown> => {
  const refStrategy = options?.$refStrategy;
  return zodToJsonSchema(
    schema as z.ZodType,
    refStrategy === "root" ||
      refStrategy === "relative" ||
      refStrategy === "none" ||
      refStrategy === "seen"
      ? { $refStrategy: refStrategy }
      : {},
  );
};

const DEFAULT_DESIGN_SKILL = `When generating UI with generateSandboxedUi, follow these design principles inspired by shadcn/ui:

- Use a minimal, flat aesthetic. Avoid drop shadows and gradients — rely on subtle borders (1px solid, light gray like #e5e7eb) to define surfaces.
- Neutral base palette: white backgrounds, zinc/slate gray text (#09090b for headings, #71717a for secondary text). One accent color for interactive elements.
- Use system font stacks (system-ui, -apple-system, sans-serif) at readable sizes (14px body, 600 weight for headings). Tight line-heights.
- Small, consistent border-radius (6–8px). Cards and containers use border, not shadow, for separation.
- Buttons: solid fill for primary (dark bg, white text), outline for secondary (border + transparent bg). Subtle hover state (slight opacity or background shift).
- Use CSS Grid or Flexbox for layout. Ensure the UI looks good at any width.
- Minimal transitions (150ms) for hover/focus states only. No decorative animations.
- Keep the UI focused and dense — avoid excessive padding. Use compact spacing (8–12px gaps, 10–14px padding in controls).`;

// Provider props interface
/** The MCP Apps renderer with `mcpApps.allowSameOriginFallback` applied. */
const SameOriginMCPAppsActivityRenderer: typeof MCPAppsActivityRenderer = (
  props,
) => <MCPAppsActivityRenderer {...props} allowSameOriginFallback />;

// Built-in frontend tool for generateSandboxedUi — registered only when the
// runtime has openGenerativeUI enabled. Module-level so its identity is stable.
const OPEN_GENERATIVE_UI_TOOLS: ReactFrontendTool[] = [
  {
    name: "generateSandboxedUi",
    description: GENERATE_SANDBOXED_UI_DESCRIPTION,
    parameters: GenerateSandboxedUiArgsSchema,
    handler: async () => "UI generated",
    // This acknowledgement has no side effects and is safe to reconstruct.
    reconnectBehavior: "resume-pending",
    followUp: true,
    render: OpenGenerativeUIToolRenderer,
  },
];

// Forwarded as a per-run signal when the provider has an A2UI catalog so the
// runtime can turn A2UI on (and inject the render tool) without a separate
// `a2ui.injectA2UITool` flag on the runtime. Module-level for a stable identity.
const A2UI_CATALOG_PROPERTIES: Readonly<Record<string, unknown>> =
  Object.freeze({ a2uiCatalogAvailable: true });

export interface CopilotKitProviderProps extends Omit<
  CopilotKitHeadlessProviderProps,
  "ɵextend"
> {
  /**
   * Configuration for OpenGenerativeUI — sandboxed UI generated by the LLM.
   *
   * @example
   * ```tsx
   * <CopilotKit
   *   runtimeUrl="/api/copilotkit"
   *   openGenerativeUI={{
   *     sandboxFunctions: [{ name: "addToCart", description: "…", parameters: schema, handler: fn }],
   *   }}
   * >
   * ```
   */
  openGenerativeUI?: {
    /**
     * Functions made available inside sandboxed iframes.
     * Each function is described to the LLM via agent context and exposed
     * via websandbox's `localApi`.
     *
     * Inside the iframe, call them with:
     * ```js
     * await Websandbox.connection.remote.<functionName>(args)
     * ```
     */
    sandboxFunctions?: SandboxFunction[];
    /**
     * Design guidelines injected as agent context for the `generateSandboxedUi` tool.
     * Override this to control the visual style of generated UIs.
     *
     * A sensible default is provided if omitted.
     */
    designSkill?: string;
  };
  /**
   * @deprecated This prop no longer controls the Inspector. Use
   * `enableInspector` instead.
   */
  showDevConsole?: boolean | "auto";
  /**
   * Disable the CopilotKit Inspector in development.
   * The Inspector is enabled by default in development browser builds on
   * localhost/loopback. It is always disabled on remote hosts, in production,
   * and during server rendering. Temporary Inspector hides also hide its
   * message shortcuts.
   * An explicit value takes priority over CopilotChat's inspectorTools prop.
   */
  enableInspector?: boolean;
  /**
   * Configuration for the A2UI (Agent-to-UI) renderer.
   * The built-in A2UI renderer is activated automatically when the runtime reports
   * that `a2ui` is configured in `CopilotRuntime`. This prop is optional and only
   * needed if you want to override the default theme.
   *
   * @example
   * ```tsx
   * <CopilotKit runtimeUrl="/api/copilotkit" a2ui={{ theme: myCustomTheme }}>
   *   {children}
   * </CopilotKit>
   * ```
   */
  a2ui?: {
    /**
     * Override the default A2UI viewer theme.
     * When omitted, the built-in `viewerTheme` from `@copilotkit/a2ui-renderer` is used.
     */
    theme?: A2UITheme;
    /**
     * Optional component catalog to pass to the A2UI renderer.
     * When omitted, the default basicCatalog is used.
     */
    catalog?: any;
    /**
     * Optional custom loading component shown while an A2UI surface is generating.
     * When omitted, a default animated skeleton is shown.
     */
    loadingComponent?: React.ComponentType;
    /**
     * When true (the default), the full component schemas from the catalog are
     * sent as agent context so the agent knows what components and props are
     * available. The A2UI middleware can overwrite this with a server-side
     * schema if configured.
     *
     * When false, the agent context still describes the catalog, but only by its
     * catalog ID and the names of its custom components, without their JSON
     * schemas. The component schema entry and the A2UI generation and design
     * guidelines are not sent. With the CopilotKit LangGraph middleware's
     * injected A2UI tool, the A2UI subagent then gets the component names only;
     * a host can still give it a composition guide through the middleware's
     * guidelines (`a2uiParams.guidelines.compositionGuide` in TypeScript,
     * `a2ui_params["guidelines"]["composition_guide"]` in Python).
     */
    includeSchema?: boolean;
    /**
     * Options for the A2UI error-recovery status UI (OSS-162): how long before
     * the transient "Retrying…" hint appears, after how many attempts, and how
     * much retry/debug detail to surface. When omitted, sane defaults apply.
     */
    recovery?: A2UIRecoveryRendererOptions;
  };
  /**
   * Experimental. Native generative UI: `generativeUI={{ ui }}`, where `ui`
   * comes from `createGenerativeUI`. The agent renders your React components
   * into chat or into `<GenerativeUISurface id>` mounts. Props that match
   * the declared state and events that match the declared functions are
   * bound by the library, and the model does not see them.
   */
  generativeUI?: GenerativeUIConfig;
  /**
   * Configuration for the built-in MCP Apps renderer.
   *
   * @example
   * ```tsx
   * <CopilotKit runtimeUrl="/api/copilotkit" mcpApps={{ allowSameOriginFallback: true }}>
   *   {children}
   * </CopilotKit>
   * ```
   */
  mcpApps?: {
    /**
     * Restore `allow-same-origin` on the MCP App sandbox. Default `false`.
     *
     * **Unsafe.** The widget then runs with your page's origin: it can read
     * your cookies, storage and DOM, and call your APIs as the signed-in user.
     * Only set it for widgets you wrote and trust that need `localStorage`,
     * `IndexedDB` or cookies. By default widgets get an opaque origin.
     */
    allowSameOriginFallback?: boolean;
  };
}

/**
 * Provide a shared core instance and synchronize runtime, tool, and UI
 * configuration. Wraps `CopilotKitHeadlessProvider` and adds the built-in
 * renderers (MCP Apps, Open Generative UI, A2UI, native generative UI), the
 * Inspector and the license banner.
 */
export const CopilotKitProvider: React.FC<CopilotKitProviderProps> = ({
  children,
  openGenerativeUI,
  showDevConsole: _showDevConsole,
  enableInspector,
  a2ui,
  generativeUI,
  mcpApps,
  ...headlessProps
}) => {
  // Bumped by onCatalogComponentsChanged so the filtered catalog re-derives
  // when a component is enabled/disabled after mount.
  const [catalogToggleVersion, setCatalogToggleVersion] = useState(0);
  const onCatalogComponentsChanged = useCallback(() => {
    setCatalogToggleVersion((v) => v + 1);
  }, []);
  // A boolean, so an inline `openGenerativeUI` object does not re-create the
  // built-ins on every render.
  const openGenerativeUIProvided = !!openGenerativeUI;
  // A catalog passed to the provider is enough to turn A2UI on: render the
  // surfaces locally and forward the catalog signal so the runtime injects the
  // render tool — no runtime-side `a2ui` config required.
  const a2uiCatalogProvided = !!a2ui?.catalog;
  const generativeUIActive = !!generativeUI?.ui;

  // Raw catalog provided by the caller (typed loosely to match `a2ui.catalog?: any`).
  const rawCatalog = a2ui?.catalog as Catalog<any> | undefined;

  // Derive the FILTERED catalog: only components currently enabled on core.
  // Re-derives when enablement changes (catalogToggleVersion bump from the
  // onCatalogComponentsChanged subscription below). Passed to BOTH the render
  // path (createA2UIMessageRenderer) and the advertisement path (A2UICatalogContext)
  // so a disabled component vanishes from what the model sees AND what can paint.
  //
  // `ɵextend` gets the core, so the catalog is filtered on the first call for
  // each catalog/toggle pair and reused after: one identity until the next
  // toggle. On the very first render the core does not exist yet (nothing is
  // disabled yet), so the filtered catalog correctly equals the full catalog.
  const getFilteredCatalog = useMemo(() => {
    let filtered: { catalog: Catalog<any> | undefined } | undefined;
    return (core: CopilotKitCoreReact | null) => {
      filtered ??= {
        catalog:
          // `filterCatalog` rebuilds a real `Catalog` (reads `.functions`).
          // Callers may also pass a minimal catalog-shaped object; only filter
          // genuine instances.
          rawCatalog && rawCatalog instanceof Catalog
            ? filterCatalog(rawCatalog, (name) =>
                core ? core.isCatalogComponentEnabled(name) : true,
              )
            : rawCatalog,
      };
      return filtered.catalog;
    };
    // catalogToggleVersion forces re-derivation when enablement changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCatalog, catalogToggleVersion]);

  const mcpAppsAllowSameOrigin = mcpApps?.allowSameOriginFallback === true;

  const sandboxFunctionsList = useStableArrayProp<SandboxFunction>(
    openGenerativeUI?.sandboxFunctions,
    "openGenerativeUI.sandboxFunctions must be a stable array.",
  );

  // Design skill registered as agent context for the generateSandboxedUi tool
  const designSkill = openGenerativeUI?.designSkill ?? DEFAULT_DESIGN_SKILL;

  // Sandbox functions registered as agent context so the LLM knows how to call them
  const sandboxFunctionsDescriptors = useMemo(() => {
    if (sandboxFunctionsList.length === 0) return null;
    return JSON.stringify(
      sandboxFunctionsList.map((fn) => ({
        name: fn.name,
        description: fn.description,
        parameters: schemaToJsonSchema(fn.parameters, {
          zodToJsonSchema: zodToJsonSchemaAdapter,
        }),
      })),
    );
  }, [sandboxFunctionsList]);

  const extend = useCallback(
    (
      core: CopilotKitCoreReact | null,
      runtime: ɵCopilotKitRuntimeFeatures,
    ): ɵCopilotKitHeadlessProviderExtension => {
      const openGenUIActive =
        runtime.openGenerativeUIEnabled || openGenerativeUIProvided;
      const a2uiActive = runtime.a2uiEnabled || a2uiCatalogProvided;
      const filteredCatalog = getFilteredCatalog(core);

      // Built-in activity renderers that are always included
      const renderers: ReactActivityMessageRenderer<any>[] = [
        {
          activityType: MCPAppsActivityType,
          content: MCPAppsActivityContentSchema,
          render: mcpAppsAllowSameOrigin
            ? SameOriginMCPAppsActivityRenderer
            : MCPAppsActivityRenderer,
        },
      ];

      if (openGenUIActive) {
        renderers.push({
          activityType: OpenGenerativeUIActivityType,
          content: OpenGenerativeUIContentSchema,
          render: OpenGenerativeUIActivityRenderer,
        });
      }

      if (a2uiActive) {
        // The a2ui-surface renderer owns the WHOLE generative-UI lifecycle (OSS-162):
        // building skeleton → retrying → hard-failure → painted surface, all on one
        // activity, swapped in place. `recovery` tunes the pre-paint UX (timing +
        // debug exposure); the server can override debugExposure via the middleware.
        renderers.unshift(
          createA2UIMessageRenderer({
            theme: a2ui?.theme ?? viewerTheme,
            catalog: filteredCatalog,
            loadingComponent: a2ui?.loadingComponent,
            recovery: a2ui?.recovery,
          }),
        );
      }

      if (generativeUIActive) {
        renderers.push(
          createGenerativeUIActivityRenderer(),
          createGenerativeUIFunctionCallActivityRenderer(),
        );
      }

      return {
        tools: openGenUIActive ? OPEN_GENERATIVE_UI_TOOLS : undefined,
        renderActivityMessages: renderers,
        properties: a2uiCatalogProvided ? A2UI_CATALOG_PROPERTIES : undefined,
        children: (
          <>
            {a2uiActive && <A2UIBuiltInToolCallRenderer />}
            {generativeUIActive && <GenerativeUIToolCallRenderer />}
            {a2uiActive && (
              <A2UICatalogContext
                catalog={filteredCatalog}
                includeSchema={a2ui?.includeSchema}
              />
            )}
            {openGenUIActive && (
              <OpenGenerativeUIAgentContext
                designSkill={designSkill}
                sandboxFunctionsDescriptors={sandboxFunctionsDescriptors}
              />
            )}
          </>
        ),
      };
    },
    [
      openGenerativeUIProvided,
      a2uiCatalogProvided,
      generativeUIActive,
      a2ui,
      getFilteredCatalog,
      mcpAppsAllowSameOrigin,
      designSkill,
      sandboxFunctionsDescriptors,
    ],
  );

  const resolvedPublicKey =
    headlessProps.publicApiKey ?? headlessProps.publicLicenseKey;

  return (
    <SandboxFunctionsContext.Provider value={sandboxFunctionsList}>
      <CopilotKitHeadlessProvider {...headlessProps} ɵextend={extend}>
        <CopilotKitProviderBuiltIns
          rawCatalog={rawCatalog}
          onCatalogComponentsChanged={onCatalogComponentsChanged}
          generativeUI={generativeUI}
          enableInspector={enableInspector}
          hasPublicKey={!!resolvedPublicKey}
        >
          {children}
        </CopilotKitProviderBuiltIns>
      </CopilotKitHeadlessProvider>
    </SandboxFunctionsContext.Provider>
  );
};

/** Registers the Open Generative UI design skill and sandbox functions as agent context. */
function OpenGenerativeUIAgentContext({
  designSkill,
  sandboxFunctionsDescriptors,
}: {
  designSkill: string;
  sandboxFunctionsDescriptors: string | null;
}): null {
  const { copilotkit } = useCopilotKit();

  useLayoutEffect(() => {
    const id = copilotkit.addContext({
      description:
        "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.",
      value: designSkill,
    });
    return () => {
      copilotkit.removeContext(id);
    };
  }, [copilotkit, designSkill]);

  useLayoutEffect(() => {
    if (!sandboxFunctionsDescriptors) return;

    const id = copilotkit.addContext({
      description:
        "Sandbox functions available in generated sandboxed UI code. Call via: await Websandbox.connection.remote.<functionName>(args)",
      value: sandboxFunctionsDescriptors,
    });
    return () => {
      copilotkit.removeContext(id);
    };
  }, [copilotkit, sandboxFunctionsDescriptors]);

  return null;
}

/**
 * The built-ins that need the core instance: A2UI catalog registration,
 * native generative UI, the Inspector and the license banner.
 */
function CopilotKitProviderBuiltIns({
  children,
  rawCatalog,
  onCatalogComponentsChanged,
  generativeUI,
  enableInspector,
  hasPublicKey,
}: {
  children: ReactNode;
  rawCatalog: Catalog<any> | undefined;
  onCatalogComponentsChanged: () => void;
  generativeUI: GenerativeUIConfig | undefined;
  enableInspector: boolean | undefined;
  hasPublicKey: boolean;
}) {
  const { copilotkit } = useCopilotKit();
  const licenseContextValue = useLicenseContext();

  // Keep the server render and the first client render identical. The
  // Inspector only runs in local development. Resolve its host and build
  // policy after hydration instead of branching on `window` during render.
  const [shouldRenderInspector, setShouldRenderInspector] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);

  useEffect(() => {
    setShouldRenderInspector(
      shouldEnableInspector({
        enableInspector,
        isBrowser: true,
        isDevelopment: process.env.NODE_ENV === "development",
      }) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname),
    );
  }, [enableInspector]);

  const [inspectorOpenRequest, setInspectorOpenRequest] =
    useState<CopilotKitInspectorOpenRequest | null>(null);

  const requestInspectorOpen = useCallback(
    (request: CopilotKitInspectorOpenRequest) => {
      setInspectorOpenRequest({ ...request });
    },
    [],
  );

  const inspectorContextValue = useMemo(
    () => ({
      providerEnableInspector: enableInspector,
      isInspectorEnabled: shouldRenderInspector && inspectorVisible,
      openInspector: requestInspectorOpen,
    }),
    [
      enableInspector,
      shouldRenderInspector,
      inspectorVisible,
      requestInspectorOpen,
    ],
  );

  const generativeUIRuntime = useGenerativeUIRoot(copilotkit, generativeUI);

  // Register the full A2UI catalog component list onto core so the inspector can
  // read `core.catalogComponents`, and re-derive the filtered catalog whenever
  // enablement changes. Descriptions are undefined here because the built
  // ComponentApi does not carry them (see plan A2 rationale).
  useEffect(() => {
    if (!rawCatalog) return;
    // Only register components for genuine `Catalog` instances, mirroring the
    // filtered-catalog guard in `CopilotKitProvider`. A non-`Catalog`
    // catalog-shaped object is passed through UNFILTERED there, so registering its
    // components here would make them toggleable in the inspector while
    // disabling never actually removes them from what the model sees — a silent
    // enforcement divergence. Guarding here keeps registration and filtering
    // consistent (nothing registered → nothing to toggle → nothing to filter)
    // and also avoids a mount-time throw when `.components` isn't a Map.
    if (!(rawCatalog instanceof Catalog)) return;
    const components = Array.from(rawCatalog.components.values()).map(
      (comp: { name: string; schema: unknown }) => ({
        name: comp.name,
        description: undefined as string | undefined,
        schema: comp.schema,
      }),
    );
    copilotkit.setCatalogComponents(components);
    const subscription = copilotkit.subscribe({
      onCatalogComponentsChanged: () => {
        onCatalogComponentsChanged();
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit, rawCatalog, onCatalogComponentsChanged]);

  // License warnings — driven by server-reported status. A retry in progress
  // leaves the status null, so no banner shows until it settles.
  const runtimeLicenseWarningStatus = licenseContextValue.status ?? undefined;

  return (
    <>
      <CopilotKitInspectorContextProvider value={inspectorContextValue}>
        <GenerativeUIRuntimeContext.Provider value={generativeUIRuntime}>
          {children}
        </GenerativeUIRuntimeContext.Provider>
        {shouldRenderInspector ? (
          <CopilotKitInspector
            core={copilotkit}
            openRequest={inspectorOpenRequest}
            onVisibilityChange={setInspectorVisible}
          />
        ) : null}
      </CopilotKitInspectorContextProvider>
      {runtimeLicenseWarningStatus === "none" && !hasPublicKey && (
        <LicenseWarningBanner type="no_license" />
      )}
      {runtimeLicenseWarningStatus === "expired" && (
        <LicenseWarningBanner type="expired" />
      )}
      {runtimeLicenseWarningStatus === "invalid" && (
        <LicenseWarningBanner type="invalid" />
      )}
      {runtimeLicenseWarningStatus === "expiring" && (
        <LicenseWarningBanner type="expiring" />
      )}
    </>
  );
}

// Re-export useCopilotKit from context for backward compatibility
export { useCopilotKit } from "../context";
