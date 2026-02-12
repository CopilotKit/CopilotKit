import { useCopilotKit, type ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { v0_8 } from "@a2ui/lit";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { A2UIProvider, useA2UIActions } from "./react-renderer/core/A2UIProvider";
import { A2UIRenderer } from "./react-renderer/core/A2UIRenderer";
import { initializeDefaultCatalog } from "./react-renderer/registry/defaultCatalog";
import { injectStyles } from "./react-renderer/styles";
import type { Types } from "@a2ui/lit/0.8";

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
  theme: v0_8.Types.Theme;
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
            getOperationSurfaceId(operation) ?? v0_8.Data.A2uiMessageProcessor.DEFAULT_SURFACE_ID;

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
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto py-6">
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
  theme: v0_8.Types.Theme;
  agent: any;
  copilotkit: any;
};

/**
 * Renders a single A2UI surface using the React renderer.
 * Wraps A2UIProvider + A2UIRenderer and bridges actions back to CopilotKit.
 */
function ReactSurfaceHost({ surfaceId, operations, theme, agent, copilotkit }: ReactSurfaceHostProps) {
  // Bridge: when the React renderer dispatches an action, send it to CopilotKit
  const handleAction = useCallback(
    async (message: Types.A2UIClientEventMessage) => {
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
    <div className="flex w-full flex-none overflow-hidden rounded-lg bg-white/5 p-4">
      <A2UIProvider onAction={handleAction} theme={theme}>
        <SurfaceMessageProcessor surfaceId={surfaceId} operations={operations} />
        <A2UIRenderer surfaceId={surfaceId} className="flex flex-1" />
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
