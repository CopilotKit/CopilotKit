/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { v0_8 } from "@a2ui/lit";
import type { ThemedA2UISurfaceActionCallback } from "./themed-surface.js";
import { theme as viewerTheme } from "./theme/viewer-theme.js";

type A2UIProcessor = InstanceType<typeof v0_8.Data.A2uiMessageProcessor>;

type ThemedSurfaceElement = HTMLElement & {
  processor?: A2UIProcessor | null;
  surface?: v0_8.Types.Surface | null;
  surfaceId?: string | null;
  onAction?: ThemedA2UISurfaceActionCallback | null;
  theme?: v0_8.Types.Theme;
};

export interface A2UIViewerProps {
  /** ID of the root component to render */
  root: string;
  /** Component definitions - array of ComponentInstance */
  components: v0_8.Types.ComponentInstance[];
  /** Data model - nested object, e.g. { user: { name: "John" }, items: ["a", "b"] } */
  data?: Record<string, unknown>;
  /** Called when user triggers an action (button click, etc.) */
  onAction?: (action: v0_8.Types.UserAction) => void;
  /** Surface styles (primaryColor, font, logoUrl) */
  styles?: Record<string, string>;
  /** Optional className for the container */
  className?: string;
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
  const elementRef = useRef<ThemedSurfaceElement | null>(null);

  // Use React's useId for SSR-safe base ID
  const baseId = useId();

  // Generate a stable surfaceId that changes when definition changes
  // Data changes are handled reactively by the signal-based processor
  // Combine baseId with a hash of the definition for uniqueness
  const surfaceId = useMemo(() => {
    const definitionKey = `${root}-${JSON.stringify(components)}`;
    // Simple hash for the definition
    let hash = 0;
    for (let i = 0; i < definitionKey.length; i++) {
      const char = definitionKey.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${baseId}-${hash}`;
  }, [baseId, root, components]);

  // Create signal-based processor for reactive updates - new one when surfaceId changes
  const processor = useMemo(() => v0_8.Data.createSignalA2uiMessageProcessor(), [surfaceId]);

  // Build and process messages, returning the surface
  const surface = useMemo(() => {
    const messages: v0_8.Types.ServerToClientMessage[] = [
      { beginRendering: { surfaceId, root, styles: styles ?? {} } },
      { surfaceUpdate: { surfaceId, components } },
    ];

    // Add data model updates (convert nested object to ValueMap[])
    if (data && Object.keys(data).length > 0) {
      const contents = objectToValueMaps(data);
      if (contents.length > 0) {
        messages.push({ dataModelUpdate: { surfaceId, path: "/", contents } });
      }
    }

    processor.processMessages(messages);
    return processor.getSurfaces().get(surfaceId) ?? null;
  }, [processor, surfaceId, root, components, data, styles]);

  // Action handler that resolves context bindings
  const handleAction = useCallback<ThemedA2UISurfaceActionCallback>(
    (event, context) => {
      if (!onAction) return;

      const resolvedContext: Record<string, unknown> = {};
      const processorInstance = context.processor;
      const actionContext = event.detail.action?.context;

      // Resolve action context bindings
      if (Array.isArray(actionContext) && actionContext.length > 0) {
        for (const item of actionContext) {
          if (!item?.key) continue;

          const valueDescriptor = item.value;
          if (!valueDescriptor) continue;

          // Handle literal values
          if (
            typeof valueDescriptor.literalBoolean === "boolean" ||
            typeof valueDescriptor.literalNumber === "number" ||
            typeof valueDescriptor.literalString === "string"
          ) {
            resolvedContext[item.key] =
              valueDescriptor.literalBoolean ??
              valueDescriptor.literalNumber ??
              valueDescriptor.literalString;
            continue;
          }

          // Handle path-based values
          const path = valueDescriptor.path;
          if (path && processorInstance && typeof path === "string") {
            const resolvedPath = processorInstance.resolvePath(path, event.detail.dataContextPath);
            const value = processorInstance.getData(
              event.detail.sourceComponent,
              resolvedPath,
              surfaceId,
            );
            if (value !== undefined) {
              resolvedContext[item.key] = value;
            }
          }
        }
      }

      onAction({
        actionName: event.detail.action?.name ?? "",
        sourceComponentId: event.detail.sourceComponentId,
        timestamp: new Date().toISOString(),
        context: resolvedContext,
      });
    },
    [onAction, surfaceId],
  );

  // Set properties on the custom element
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.processor = processor;
    element.surfaceId = surfaceId;
    element.surface = surface;
    element.onAction = handleAction;
    element.theme = viewerTheme;

    return () => {
      if (elementRef.current === element) {
        element.onAction = null;
      }
    };
  }, [processor, surface, surfaceId, handleAction]);

  // Show placeholder if no content
  if (!surface?.componentTree) {
    return (
      <div className={className} style={{ padding: 16, color: "#666", fontFamily: "system-ui" }}>
        No content to display
      </div>
    );
  }

  return React.createElement("themed-a2ui-surface", {
    ref: elementRef,
    className,
    "data-surface-id": surfaceId,
  });
}

/**
 * Converts a nested JavaScript object to the ValueMap[] format
 * expected by A2UI's dataModelUpdate message.
 */
function objectToValueMaps(obj: Record<string, unknown>): v0_8.Types.ValueMap[] {
  return Object.entries(obj).map(([key, value]) => valueToValueMap(key, value));
}

/**
 * Converts a single key-value pair to a ValueMap.
 */
function valueToValueMap(key: string, value: unknown): v0_8.Types.ValueMap {
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
    // Convert array items with index as key
    const valueMap = value.map((item, index) => valueToValueMap(String(index), item));
    return { key, valueMap };
  }
  if (typeof value === "object") {
    // Convert nested object recursively
    const valueMap = objectToValueMaps(value as Record<string, unknown>);
    return { key, valueMap };
  }
  return { key };
}
