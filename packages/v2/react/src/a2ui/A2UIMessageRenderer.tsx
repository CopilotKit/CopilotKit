import { useCopilotKit } from "../providers";
import type { ReactActivityMessageRenderer } from "../types/react-activity-message-renderer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  A2UIProvider,
  useA2UIActions,
  A2UIRenderer,
  initializeDefaultCatalog,
  injectStyles,
  DEFAULT_SURFACE_ID,
} from "@copilotkit/a2ui-renderer";
import type { Theme, A2UIClientEventMessage } from "@copilotkit/a2ui-renderer";

// Initialize the React renderer's component catalog and styles once
let initialized = false;
function ensureInitialized() {
  if (!initialized) {
    initializeDefaultCatalog();
    injectStyles();
    initialized = true;
  }
}

export type A2UIMessageRendererOptions = {
  theme: Theme;
};

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): ReactActivityMessageRenderer<any> {
  const { theme } = options;

  return {
    activityType: "a2ui-surface",
    content: z.any(),
    render: ({ content, agent }) => {
      ensureInitialized();

      const [operations, setOperations] = useState<any[]>([]);
      const lastSignatureRef = useRef<string | null>(null);
      const { copilotkit } = useCopilotKit();

      useEffect(() => {
        if (!content || !Array.isArray(content.operations)) {
          lastSignatureRef.current = null;
          setOperations([]);
          return;
        }

        const incoming = content.operations as any[];
        const signature = stringifyOperations(incoming);

        if (signature && signature === lastSignatureRef.current) {
          return;
        }

        lastSignatureRef.current = signature;
        setOperations(incoming);
      }, [content]);

      // Group operations by surface ID
      const groupedOperations = useMemo(() => {
        const groups = new Map<string, any[]>();

        for (const operation of operations) {
          const surfaceId =
            getOperationSurfaceId(operation) ?? DEFAULT_SURFACE_ID;

          if (!groups.has(surfaceId)) {
            groups.set(surfaceId, []);
          }
          groups.get(surfaceId)!.push(operation);
        }

        return groups;
      }, [operations]);

      if (!groupedOperations.size) {
        return null;
      }

      return (
        <div className="cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-6 cpk:overflow-auto cpk:py-6">
          {Array.from(groupedOperations.entries()).map(([surfaceId, ops]) => (
            <ReactSurfaceHost
              key={surfaceId}
              surfaceId={surfaceId}
              operations={ops}
              theme={theme}
              agent={agent}
              copilotkit={copilotkit}
            />
          ))}
        </div>
      );
    },
  };
}

type ReactSurfaceHostProps = {
  surfaceId: string;
  operations: any[];
  theme: Theme;
  agent: any;
  copilotkit: any;
};

/**
 * Renders a single A2UI surface using the React renderer.
 * Wraps A2UIProvider + A2UIRenderer and bridges actions back to CopilotKit.
 */
function ReactSurfaceHost({
  surfaceId,
  operations,
  theme,
  agent,
  copilotkit,
}: ReactSurfaceHostProps) {
  // Bridge: when the React renderer dispatches an action, send it to CopilotKit
  const handleAction = useCallback(
    async (message: A2UIClientEventMessage) => {
      if (!agent) return;

      try {
        console.info("[A2UI] Action dispatched", message.userAction);

        copilotkit.setProperties({
          ...(copilotkit.properties ?? {}),
          a2uiAction: message,
        });

        await copilotkit.runAgent({ agent });
      } finally {
        if (copilotkit.properties) {
          const { a2uiAction, ...rest } = copilotkit.properties;
          copilotkit.setProperties(rest);
        }
      }
    },
    [agent, copilotkit],
  );

  return (
    <div className="cpk:flex cpk:w-full cpk:flex-none cpk:overflow-hidden cpk:rounded-lg cpk:bg-white/5 cpk:p-4">
      <A2UIProvider onAction={handleAction} theme={theme}>
        <SurfaceMessageProcessor
          surfaceId={surfaceId}
          operations={operations}
        />
        <A2UIRenderer surfaceId={surfaceId} className="cpk:flex cpk:flex-1" />
      </A2UIProvider>
    </div>
  );
}

/**
 * Processes A2UI operations into the provider's message processor.
 * Must be a child of A2UIProvider to access the actions context.
 */
function SurfaceMessageProcessor({
  surfaceId,
  operations,
}: {
  surfaceId: string;
  operations: any[];
}) {
  const { processMessages } = useA2UIActions();
  const lastProcessedRef = useRef<string>("");

  useEffect(() => {
    const key = `${surfaceId}-${JSON.stringify(operations)}`;
    if (key === lastProcessedRef.current) return;
    lastProcessedRef.current = key;

    processMessages(operations);
  }, [processMessages, surfaceId, operations]);

  return null;
}

function getOperationSurfaceId(operation: any): string | null {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  if (typeof operation.surfaceId === "string") {
    return operation.surfaceId;
  }

  return (
    operation?.beginRendering?.surfaceId ??
    operation?.surfaceUpdate?.surfaceId ??
    operation?.dataModelUpdate?.surfaceId ??
    operation?.deleteSurface?.surfaceId ??
    null
  );
}

function stringifyOperations(ops: any[]): string | null {
  try {
    return JSON.stringify(ops);
  } catch (error) {
    return null;
  }
}
