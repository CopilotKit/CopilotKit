"use client";

import React, { useId, useMemo, useEffect, useRef } from "react";
import type { Types } from "@a2ui/lit/0.8";
import { v0_8 } from "@a2ui/lit";
import {
  A2UIProvider,
  useA2UIActions,
} from "./react-renderer/core/A2UIProvider";
import { A2UIRenderer } from "./react-renderer/core/A2UIRenderer";
import { initializeDefaultCatalog } from "./react-renderer/registry/defaultCatalog";
import { litTheme } from "./react-renderer/theme/litTheme";
import { injectStyles } from "./react-renderer/styles";
import { theme as viewerTheme } from "./theme/viewer-theme.js";

// Re-export types that consumers may need
export interface ComponentInstance {
  id: string;
  component: Record<string, unknown>;
}

export interface A2UIActionEvent {
  actionName: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface A2UIViewerProps {
  /** ID of the root component to render */
  root: string;
  /** Component definitions - array of ComponentInstance */
  components: v0_8.Types.ComponentInstance[];
  /** Data model - nested object, e.g. { user: { name: "John" }, items: ["a", "b"] } */
  data?: Record<string, unknown>;
  /** Called when user triggers an action (button click, etc.) */
  onAction?: (action: A2UIActionEvent) => void;
  /** Surface styles (primaryColor, font, logoUrl) */
  styles?: Record<string, string>;
  /** Optional className for the container */
  className?: string;
}

// Initialize the React renderer's component catalog and styles once
let initialized = false;
function ensureInitialized() {
  if (!initialized) {
    initializeDefaultCatalog();
    injectStyles();
    initialized = true;
  }
}

/**
 * A2UIViewer renders an A2UI component tree from a JSON definition and data.
 * It re-renders cleanly when props change, discarding previous state.
 */
export function A2UIViewer({
  root,
  components,
  data,
  onAction,
  styles,
  className,
}: A2UIViewerProps): React.JSX.Element {
  ensureInitialized();

  // Use React's useId for SSR-safe base ID
  const baseId = useId();

  // Generate a stable surfaceId that changes when definition changes
  const surfaceId = useMemo(() => {
    const definitionKey = `${root}-${JSON.stringify(components)}`;
    let hash = 0;
    for (let i = 0; i < definitionKey.length; i++) {
      const char = definitionKey.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `surface${baseId.replace(/:/g, "-")}${hash}`;
  }, [baseId, root, components]);

  // Convert onAction callback to internal format
  const handleAction = useMemo(() => {
    if (!onAction) return undefined;

    return (message: Types.A2UIClientEventMessage) => {
      const userAction = message.userAction;
      if (userAction) {
        onAction({
          actionName: userAction.name,
          sourceComponentId: userAction.sourceComponentId,
          timestamp: userAction.timestamp,
          context: userAction.context ?? {},
        });
      }
    };
  }, [onAction]);

  // Show placeholder if no components provided
  if (!components || components.length === 0) {
    return (
      <div
        className={className}
        style={{ padding: 16, color: "#666", fontFamily: "system-ui" }}
      >
        No content to display
      </div>
    );
  }

  return (
    <A2UIProvider onAction={handleAction} theme={viewerTheme}>
      <A2UIViewerInner
        surfaceId={surfaceId}
        root={root}
        components={components}
        data={data ?? {}}
        styles={styles}
        className={className}
      />
    </A2UIProvider>
  );
}

/**
 * Inner component that processes messages within the provider context.
 */
function A2UIViewerInner({
  surfaceId,
  root,
  components,
  data,
  styles,
  className,
}: {
  surfaceId: string;
  root: string;
  components: v0_8.Types.ComponentInstance[];
  data: Record<string, unknown>;
  styles?: Record<string, string>;
  className?: string;
}) {
  const { processMessages } = useA2UIActions();
  const lastProcessedRef = useRef<string>("");

  // Process messages when props change
  useEffect(() => {
    const key = `${surfaceId}-${JSON.stringify(components)}-${JSON.stringify(data)}`;
    if (key === lastProcessedRef.current) return;
    lastProcessedRef.current = key;

    const messages: Types.ServerToClientMessage[] = [
      { beginRendering: { surfaceId, root, styles: styles ?? {} } },
      { surfaceUpdate: { surfaceId, components } },
    ];

    // Add data model updates
    if (data && Object.keys(data).length > 0) {
      const contents = objectToValueMaps(data);
      if (contents.length > 0) {
        messages.push({
          dataModelUpdate: { surfaceId, path: "/", contents },
        });
      }
    }

    processMessages(messages);
  }, [processMessages, surfaceId, root, components, data, styles]);

  return (
    <div className={className}>
      <A2UIRenderer surfaceId={surfaceId} />
    </div>
  );
}

/**
 * Converts a nested JavaScript object to the ValueMap[] format
 * expected by A2UI's dataModelUpdate message.
 */
function objectToValueMaps(obj: Record<string, unknown>): Types.ValueMap[] {
  return Object.entries(obj).map(([key, value]) => valueToValueMap(key, value));
}

/**
 * Converts a single key-value pair to a ValueMap.
 */
function valueToValueMap(key: string, value: unknown): Types.ValueMap {
  if (typeof value === "string") {
    return { key, valueString: value };
  }
  if (typeof value === "number") {
    return { key, valueNumber: value };
  }
  if (typeof value === "boolean") {
    return { key, valueBoolean: value };
  }
  if (value === null || value === undefined) {
    return { key };
  }
  if (Array.isArray(value)) {
    const valueMap = value.map((item, index) =>
      valueToValueMap(String(index), item),
    );
    return { key, valueMap };
  }
  if (typeof value === "object") {
    const valueMap = objectToValueMaps(value as Record<string, unknown>);
    return { key, valueMap };
  }
  return { key };
}
