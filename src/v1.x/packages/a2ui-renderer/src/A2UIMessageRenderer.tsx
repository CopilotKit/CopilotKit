import { useCopilotKit, type ReactActivityMessageRenderer } from "@copilotkitnext/react";
import { v0_8 } from "@a2ui/lit";
import type {
  ThemedA2UISurfaceActionCallback,
  ThemedA2UISurfaceContext,
} from "./themed-surface.js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DetailedHTMLProps,
  type HTMLAttributes,
} from "react";
import { z } from "zod";

type A2UIProcessor = InstanceType<typeof v0_8.Data.A2uiMessageProcessor>;

type ThemedSurfaceElement = HTMLElement & {
  processor?: A2UIProcessor | null;
  surface?: v0_8.Types.Surface | null;
  surfaceId?: string | null;
  onAction?: ThemedA2UISurfaceActionCallback | null;
  theme?: v0_8.Types.Theme;
};

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
      const [operations, setOperations] = useState<any[]>([]);
      const lastSignatureRef = useRef<string | null>(null);
      const processorsRef = useRef(new Map<string, A2UIProcessor>());
      const { copilotkit } = useCopilotKit();
      const actionLogger = useCallback<ThemedA2UISurfaceActionCallback>(
        async (event: v0_8.Events.StateEvent<"a2ui.action">, context: ThemedA2UISurfaceContext) => {
          if (!agent) {
            return;
          }

          const resolvedContext: Record<string, unknown> = {};
          const processorInstance = context.processor;
          const surfaceKey = context.surfaceId ?? v0_8.Data.A2uiMessageProcessor.DEFAULT_SURFACE_ID;
          const actionContext = event.detail.action?.context;

          if (Array.isArray(actionContext) && actionContext.length > 0) {
            for (const item of actionContext) {
              if (!item?.key) {
                continue;
              }

              const valueDescriptor = item.value;
              if (!valueDescriptor) {
                continue;
              }

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

              const path = valueDescriptor.path;
              if (path && processorInstance && typeof path === "string") {
                const resolvedPath = processorInstance.resolvePath(
                  path,
                  event.detail.dataContextPath,
                );
                const value = processorInstance.getData(
                  event.detail.sourceComponent,
                  resolvedPath,
                  surfaceKey,
                );
                if (value !== undefined) {
                  resolvedContext[item.key] = value;
                }
              }
            }
          }

          const userAction: v0_8.Types.A2UIClientEventMessage = {
            userAction: {
              name: event.detail.action.name ?? "",
              surfaceId: context.surfaceId ?? surfaceKey,
              sourceComponentId: event.detail.sourceComponentId,
              timestamp: new Date().toISOString(),
              context: {
                ...resolvedContext,
                surfaceId: context.surfaceId ?? surfaceKey,
              },
            },
          };

          try {
            console.info("[A2UI] Action dispatched", userAction.userAction);

            copilotkit.setProperties({
              ...(copilotkit.properties ?? {}),
              a2uiAction: userAction,
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

      useEffect(() => {
        if (!content || !Array.isArray(content.operations)) {
          processorsRef.current.forEach((processor) => processor.clearSurfaces());
          processorsRef.current.clear();
          lastSignatureRef.current = null;
          setOperations([]);
          return;
        }

        const processors = processorsRef.current;
        const incoming = content.operations as any[];
        const signature = stringifyOperations(incoming);

        if (signature && signature === lastSignatureRef.current) {
          return;
        }

        const groupedOperations = new Map<string, any[]>();

        for (const operation of incoming) {
          const surfaceId =
            getOperationSurfaceId(operation) ?? v0_8.Data.A2uiMessageProcessor.DEFAULT_SURFACE_ID;

          if (!groupedOperations.has(surfaceId)) {
            groupedOperations.set(surfaceId, []);
          }
          groupedOperations.get(surfaceId)!.push(operation);
        }

        groupedOperations.forEach((operationsForSurfaceId, surfaceId) => {
          let processor = processors.get(surfaceId);
          if (!processor) {
            processor = new v0_8.Data.A2uiMessageProcessor();
            processors.set(surfaceId, processor);
          }

          try {
            processor.processMessages(operationsForSurfaceId);
          } catch (error) {
            processors.delete(surfaceId);
          }
        });

        const emptyProcessors: string[] = [];
        processors.forEach((processor, surfaceId) => {
          if (processor.getSurfaces().size === 0) {
            emptyProcessors.push(surfaceId);
          }
        });
        if (emptyProcessors.length > 0) {
          for (const surfaceId of emptyProcessors) {
            processors.delete(surfaceId);
          }
        }

        lastSignatureRef.current = signature;
        setOperations(incoming);
      }, [content]);

      const surfaceEntries = useMemo(() => {
        const entries: Array<{
          id: string;
          surface: v0_8.Types.Surface;
          processor: A2UIProcessor;
        }> = [];

        processorsRef.current.forEach((processor) => {
          processor.getSurfaces().forEach((surface, surfaceId) => {
            const typedSurface = surface as v0_8.Types.Surface | undefined;
            if (typedSurface?.componentTree) {
              entries.push({ id: surfaceId, surface: typedSurface, processor });
            }
          });
        });

        return entries;
      }, [operations]);

      if (!surfaceEntries.length) {
        return null;
      }

      return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto py-6">
          {surfaceEntries.map(({ id, surface, processor }) => (
            <SurfaceHost
              key={id}
              actionLogger={actionLogger}
              processor={processor}
              surface={surface}
              surfaceId={id}
              theme={theme}
            />
          ))}
        </div>
      );
    },
  };
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

type SurfaceHostProps = {
  actionLogger: ThemedA2UISurfaceActionCallback;
  processor: A2UIProcessor;
  surface: v0_8.Types.Surface;
  surfaceId: string;
  theme: v0_8.Types.Theme;
  key?: string;
};

function SurfaceHost({ actionLogger, processor, surface, surfaceId, theme }: SurfaceHostProps) {
  const elementRef = useRef<ThemedSurfaceElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    element.processor = processor;
    element.surfaceId = surfaceId;
    element.surface = surface;
    element.onAction = actionLogger;
    element.theme = theme;

    return () => {
      if (elementRef.current === element) {
        element.onAction = null;
      }
    };
  }, [processor, surface, surfaceId, actionLogger, theme]);

  return (
    <div className="flex w-full flex-none overflow-hidden rounded-lg bg-white/5 p-4">
      {React.createElement("themed-a2ui-surface", {
        ref: elementRef,
        className: "flex flex-1",
        style: { height: "100%", overflow: "hidden" },
        "data-surface-id": surfaceId,
      })}
    </div>
  );
}

// JSX type augmentation for themed-a2ui-surface element
// Note: This augmentation should be handled by the consumer project
// For now, we'll use a workaround with any
