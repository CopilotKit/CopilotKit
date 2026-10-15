"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  A2UIProvider,
  extractCatalogComponentSchemas,
  injectStyles,
} from "@copilotkit/a2ui-renderer";
import type {
  A2UIClientEventMessage,
  Catalog,
} from "@copilotkit/a2ui-renderer";
import { validateA2UIComponents } from "@ag-ui/a2ui-toolkit";
import type {
  A2UIValidationCatalog,
  A2UIValidationError,
} from "@ag-ui/a2ui-toolkit";
import {
  extractFenceOperations,
  flattenInformationalCards,
  prepareSurfaceOperations,
} from "@copilotkit/core";
import type { A2UIOperation } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../../providers";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import {
  A2UIRecoveryFailure,
  resolveDebugExposure,
} from "../A2UIRecoveryStates";
import type { DebugExposure } from "../A2UIRecoveryStates";
import {
  A2UISurfaceOrError,
  SurfaceMessageProcessor,
  runA2UIAction,
} from "../A2UIMessageRenderer";
import type { A2UIUserAction } from "../A2UIMessageRenderer";
import { useA2UIMarkdownConfig } from "./A2UIMarkdownContext";
import {
  createComponentLabelResolver,
  sendA2UIActionAsMessage,
} from "./action-message";

let stylesInjected = false;
const FADE_STYLE_ID = "a2ui-markdown-fade";
/**
 * Components fade in as they stream: every element inserted under a markdown
 * surface runs the keyframes once on mount (React keeps keys stable per
 * component id, so already painted elements never re-animate), and the whole
 * surface fades in when it first becomes visible.
 */
const FADE_CSS = `@keyframes a2ui-fade-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
[data-a2ui-markdown-surface] .a2ui-surface{display:flex;width:100%;min-width:0}
[data-a2ui-markdown-surface] .a2ui-surface>*{flex:1 1 100%;width:100%;min-width:0}
[data-a2ui-markdown-surface] .a2ui-surface *{animation:a2ui-fade-in .28s ease-out both}
[data-a2ui-markdown-surface] [data-a2ui-visible]{animation:a2ui-fade-in .32s ease-out both}
@media (prefers-reduced-motion: reduce){[data-a2ui-markdown-surface] *{animation:none !important}}`;
function ensureStyles() {
  if (stylesInjected) return;
  injectStyles();
  if (
    typeof document !== "undefined" &&
    !document.getElementById(FADE_STYLE_ID)
  ) {
    const style = document.createElement("style");
    style.id = FADE_STYLE_ID;
    style.textContent = FADE_CSS;
    document.head.appendChild(style);
  }
  stylesInjected = true;
}

/** Read at call time so tests (and hosts) can change NODE_ENV. */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

const HIDDEN_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0,
  pointerEvents: "none",
  overflow: "hidden",
};

/** The surface never grows wider than the chat column; wide content scrolls inside. */
const SURFACE_FIT_STYLE: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  boxSizing: "border-box",
};

type ComponentRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ComponentRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** All components of the operations, de-duplicated by id (last definition wins). */
function collectComponents(operations: A2UIOperation[]): ComponentRecord[] {
  const byId = new Map<string, ComponentRecord>();
  const anonymous: ComponentRecord[] = [];
  for (const op of operations) {
    const update = op.updateComponents;
    const components = isRecord(update) ? update.components : undefined;
    if (!Array.isArray(components)) continue;
    for (const component of components) {
      if (!isRecord(component)) continue;
      if (typeof component.id === "string") byId.set(component.id, component);
      else anonymous.push(component);
    }
  }
  return [...byId.values(), ...anonymous];
}

/**
 * Components that only carry prose or arrange it. A surface made of nothing
 * else (no data, media, control or chart) should have been plain markdown.
 */
const PROSE_COMPONENTS = new Set([
  "Markdown",
  "Text",
  "Title",
  "Caption",
  "Column",
  "Box",
  "Divider",
  "Spacer",
]);

/** Whether every component of the surface is prose or a plain container. */
function isProseOnly(components: ComponentRecord[]): boolean {
  return (
    components.length > 0 &&
    components.every(
      (c) =>
        typeof c.component === "string" && PROSE_COMPONENTS.has(c.component),
    )
  );
}

/** Whether some updateComponents defines the `root` component the renderer starts from. */
function surfaceHasRoot(operations: A2UIOperation[]): boolean {
  return operations.some((op) => {
    const update = op.updateComponents;
    const components = isRecord(update) ? update.components : undefined;
    return (
      Array.isArray(components) &&
      components.some((c) => isRecord(c) && c.id === "root")
    );
  });
}

/** The data model the updateDataModel operations build, or undefined when there are none. */
function mergedDataModel(
  operations: A2UIOperation[],
): Record<string, unknown> | undefined {
  let data: Record<string, unknown> | undefined;
  for (const op of operations) {
    const update = op.updateDataModel;
    if (!isRecord(update) || !("value" in update)) continue;
    const path = typeof update.path === "string" ? update.path : "/";
    const segments = path.split("/").filter(Boolean);
    data ??= {};
    if (segments.length === 0) {
      if (isRecord(update.value)) data = { ...data, ...update.value };
      continue;
    }
    let cursor: Record<string, unknown> = data;
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      cursor[segment] = isRecord(next) ? { ...next } : {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]!] = update.value;
  }
  return data;
}

/** The catalog in the shape `validateA2UIComponents` expects. */
function toValidationCatalog(catalog: Catalog<any>): A2UIValidationCatalog {
  const { components } = extractCatalogComponentSchemas(catalog);
  const out: A2UIValidationCatalog["components"] = {};
  for (const [name, schema] of Object.entries(components)) {
    const allOf = (schema as { allOf?: unknown[] }).allOf;
    const own = (Array.isArray(allOf) ? allOf[1] : schema) as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;
    out[name] = {
      properties: own?.properties ?? {},
      required: own?.required ?? [],
    };
  }
  return { components: out };
}

export type A2UIMarkdownSurfaceProps = {
  /** Raw fence body (JSONL, possibly incomplete). */
  fenceText: string;
  /** Whether the closing fence has arrived. */
  closed: boolean;
  /** Used when the operations carry no surfaceId: `<messageId>-<fenceIndex>`. */
  fallbackSurfaceId: string;
  /** Extra operations contributed by later fences with the same surfaceId. */
  extraOperations?: A2UIOperation[];
  /** Render nothing (a later fence whose surfaceId belongs to an earlier one). */
  hidden?: boolean;
};

/**
 * Renders one ```a2ui fence as a live A2UI surface.
 *
 * Every complete component is processed as soon as it has streamed. The
 * building skeleton (or the host's loading component) shows until the `root`
 * component exists; from then on the surface paints, even when path-bound
 * inputs have no data yet (they render empty). A fence that stops mid-stream
 * keeps whatever painted. The failure card appears only for a closed fence
 * that never produced a root.
 *
 * At fence close the components are validated against the catalog; problems
 * are logged in development and listed in the failure card's details, but a
 * surface with a root still paints (the renderer isolates bad components).
 */
export function A2UIMarkdownSurface({
  fenceText,
  closed,
  fallbackSurfaceId,
  extraOperations,
  hidden,
}: A2UIMarkdownSurfaceProps) {
  const config = useA2UIMarkdownConfig();
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const agentId = chatConfig?.agentId ?? DEFAULT_AGENT_ID;
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);

  const parsed = useMemo(() => extractFenceOperations(fenceText), [fenceText]);
  const catalogId = config?.catalogId ?? "";
  const prepared = useMemo(() => {
    const surface = prepareSurfaceOperations({
      operations: [...parsed.operations, ...(extraOperations ?? [])],
      fallbackSurfaceId,
      catalogId,
    });
    // Only interactive panels keep a box; other Cards render as sections.
    return {
      ...surface,
      operations: flattenInformationalCards(surface.operations),
    };
  }, [parsed.operations, extraOperations, fallbackSurfaceId, catalogId]);
  const hasRoot = surfaceHasRoot(prepared.operations);
  const proseOnly = useMemo(
    () =>
      closed && hasRoot && isProseOnly(collectComponents(prepared.operations)),
    [closed, hasRoot, prepared.operations],
  );

  useEffect(() => {
    if (!proseOnly || hidden || !isDevelopment()) return;
    console.warn(
      `[A2UI] surface contains only prose; prefer plain markdown (surface "${prepared.surfaceId}")`,
    );
  }, [proseOnly, hidden, prepared.surfaceId]);

  // Child effects run first, so the operations are processed before this
  // reveals the surface. SurfaceMessageProcessor's onReady may also fire, but
  // it waits for data on path-bound surfaces, which markdown mode does not.
  useEffect(() => {
    if (hasRoot) setReady(true);
  }, [hasRoot]);

  const catalog = config?.catalog;
  const validationCatalog = useMemo(
    () => (catalog ? toValidationCatalog(catalog) : undefined),
    [catalog],
  );
  const validationErrors = useMemo<A2UIValidationError[]>(() => {
    if (!closed || !validationCatalog) return [];
    const result = validateA2UIComponents({
      components: collectComponents(prepared.operations),
      data: mergedDataModel(prepared.operations),
      catalog: validationCatalog,
      validateBindings: false,
    });
    return result.valid ? [] : result.errors;
  }, [closed, validationCatalog, prepared.operations]);

  useEffect(() => {
    if (validationErrors.length === 0 || !isDevelopment()) return;
    console.warn(
      `[A2UI] The a2ui block for surface "${prepared.surfaceId}" failed validation:\n` +
        validationErrors.map((e) => `- ${e.path}: ${e.message}`).join("\n"),
    );
  }, [validationErrors, prepared.surfaceId]);

  const resolveLabel = useMemo(
    () => createComponentLabelResolver(prepared.operations),
    [prepared.operations],
  );

  const handleAction = useCallback(
    async (message: A2UIClientEventMessage) => {
      try {
        if (!config) return;
        const agent = copilotkit.getAgent(agentId);
        if (!agent) return;
        if (agent.isRunning) {
          if (isDevelopment()) {
            console.warn(
              "[A2UI] Ignored an action while the agent is running.",
            );
          }
          return;
        }
        if (config.actionMode === "legacy") {
          await runA2UIAction({
            message,
            agent,
            copilotkit,
            onAction: config.onAction,
          });
          return;
        }
        const action = message.userAction as A2UIUserAction | undefined;
        if (!action) return;
        const send = (next: A2UIUserAction) =>
          sendA2UIActionAsMessage({
            action: next,
            agent,
            copilotkit,
            resolveLabel,
          });
        let final = action;
        if (config.onAction) {
          // Same contract as tool mode: null suppresses, a returned action
          // replaces, void sends the original.
          const result = await config.onAction(action, (forwarded) =>
            send(forwarded ?? action),
          );
          if (result === null) return;
          if (result) final = result;
        }
        await send(final);
      } catch (err) {
        console.error("[A2UI] action failed", err);
      }
    },
    [config, copilotkit, agentId, resolveLabel],
  );

  if (!config || hidden) return null;

  if (closed && !hasRoot) {
    const error =
      parsed.invalidLines.length > 0 || parsed.partialObject !== null
        ? "The a2ui block contained invalid JSON."
        : "The a2ui block did not contain a renderable surface.";
    const defaultExposure: DebugExposure = isDevelopment()
      ? "collapsed"
      : "hidden";
    return (
      <A2UIRecoveryFailure
        content={{ status: "failed", error }}
        debugExposure={resolveDebugExposure(
          undefined,
          config.recovery?.debugExposure ?? defaultExposure,
        )}
        details={{
          error,
          ...(validationErrors.length > 0
            ? { validationErrors: validationErrors.map((e) => e.message) }
            : {}),
          raw: fenceText,
        }}
      />
    );
  }

  ensureStyles();
  const Loading = config.loadingComponent;
  const showSurface = ready && hasRoot;

  return (
    <div
      className={
        showSurface
          ? "cpk:relative cpk:my-4 cpk:flex cpk:w-full cpk:flex-col"
          : "cpk:relative cpk:flex cpk:w-full cpk:flex-col"
      }
      data-a2ui-markdown-surface={prepared.surfaceId}
      data-a2ui-prose-only={proseOnly ? "" : undefined}
      style={SURFACE_FIT_STYLE}
    >
      {/* No built-in placeholder: the prose keeps streaming above and the
          surface appears as soon as its root component is complete. Apps can
          opt into a loader through `a2ui.loadingComponent`. */}
      {!showSurface && Loading ? <Loading /> : null}
      {prepared.operations.length > 0 && (
        <div
          aria-hidden={!showSurface}
          data-a2ui-visible={showSurface ? "" : undefined}
          className="cpk:flex cpk:w-full cpk:flex-col"
          style={showSurface ? SURFACE_FIT_STYLE : HIDDEN_STYLE}
        >
          <A2UIProvider
            key={prepared.surfaceId}
            onAction={handleAction}
            theme={config.theme}
            catalog={config.catalog}
          >
            <SurfaceMessageProcessor
              surfaceId={prepared.surfaceId}
              operations={prepared.operations}
              onReady={markReady}
            />
            <A2UISurfaceOrError surfaceId={prepared.surfaceId} />
          </A2UIProvider>
        </div>
      )}
    </div>
  );
}
