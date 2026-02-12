'use client';

import React, { useId, useMemo, useEffect, useRef } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import { A2UIProvider, useA2UIActions } from './A2UIProvider';
import { A2UIRenderer } from './A2UIRenderer';
import { initializeDefaultCatalog } from '../registry/defaultCatalog';
import { litTheme } from '../theme/litTheme';
import { injectStyles } from '../styles';
import type { OnActionCallback } from '../types';

/**
 * Component instance format for static A2UI definitions.
 */
export interface ComponentInstance {
  id: string;
  component: Record<string, unknown>;
}

/**
 * Action event dispatched when a user interacts with a component.
 */
export interface A2UIActionEvent {
  actionName: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface A2UIViewerProps {
  /** The root component ID */
  root: string;
  /** Array of component definitions */
  components: ComponentInstance[];
  /** Data model for the surface */
  data?: Record<string, unknown>;
  /** Callback when an action is triggered */
  onAction?: (action: A2UIActionEvent) => void;
  /** Custom theme (defaults to litTheme) */
  theme?: Types.Theme;
  /** Additional CSS class */
  className?: string;
}

// Initialize the component catalog and styles once
let initialized = false;
function ensureInitialized() {
  if (!initialized) {
    initializeDefaultCatalog();
    injectStyles(); // Inject structural CSS for litTheme utility classes
    initialized = true;
  }
}

/**
 * A2UIViewer renders an A2UI component tree from static JSON definitions.
 *
 * Use this when you have component definitions and data as props rather than
 * streaming messages from a server. For streaming use cases, use A2UIProvider
 * with A2UIRenderer and useA2UI instead.
 *
 * @example
 * ```tsx
 * const components = [
 *   { id: 'root', component: { Card: { child: 'text' } } },
 *   { id: 'text', component: { Text: { text: { path: '/message' } } } },
 * ];
 *
 * <A2UIViewer
 *   root="root"
 *   components={components}
 *   data={{ message: 'Hello World!' }}
 *   onAction={(action) => console.log('Action:', action)}
 * />
 * ```
 */
export function A2UIViewer({
  root,
  components,
  data = {},
  onAction,
  theme = litTheme,
  className,
}: A2UIViewerProps) {
  ensureInitialized();

  // Generate a stable surface ID based on the definition
  const baseId = useId();
  const surfaceId = useMemo(() => {
    const definitionKey = `${root}-${JSON.stringify(components)}`;
    let hash = 0;
    for (let i = 0; i < definitionKey.length; i++) {
      const char = definitionKey.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `surface${baseId.replace(/:/g, '-')}${hash}`;
  }, [baseId, root, components]);

  // Convert onAction callback to internal format
  const handleAction: OnActionCallback | undefined = useMemo(() => {
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

  return (
    <A2UIProvider onAction={handleAction} theme={theme}>
      <A2UIViewerInner
        surfaceId={surfaceId}
        root={root}
        components={components}
        data={data}
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
  className,
}: {
  surfaceId: string;
  root: string;
  components: ComponentInstance[];
  data: Record<string, unknown>;
  className?: string;
}) {
  const { processMessages } = useA2UIActions();
  const lastProcessedRef = useRef<string>('');

  // Process messages when props change
  useEffect(() => {
    const key = `${surfaceId}-${JSON.stringify(components)}-${JSON.stringify(data)}`;
    if (key === lastProcessedRef.current) return;
    lastProcessedRef.current = key;

    const messages: Types.ServerToClientMessage[] = [
      { beginRendering: { surfaceId, root, styles: {} } },
      { surfaceUpdate: { surfaceId, components } },
    ];

    // Add data model updates
    if (data && Object.keys(data).length > 0) {
      const contents = objectToValueMaps(data);
      if (contents.length > 0) {
        messages.push({
          dataModelUpdate: { surfaceId, path: '/', contents },
        });
      }
    }

    processMessages(messages);
  }, [processMessages, surfaceId, root, components, data]);

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
  if (typeof value === 'string') {
    return { key, valueString: value };
  }
  if (typeof value === 'number') {
    return { key, valueNumber: value };
  }
  if (typeof value === 'boolean') {
    return { key, valueBoolean: value };
  }
  if (value === null || value === undefined) {
    return { key };
  }
  if (Array.isArray(value)) {
    const valueMap = value.map((item, index) =>
      valueToValueMap(String(index), item)
    );
    return { key, valueMap };
  }
  if (typeof value === 'object') {
    const valueMap = objectToValueMaps(value as Record<string, unknown>);
    return { key, valueMap };
  }
  return { key };
}

export default A2UIViewer;
