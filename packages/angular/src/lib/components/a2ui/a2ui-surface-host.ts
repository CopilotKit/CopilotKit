import type { AbstractAgent } from "@ag-ui/client";
import type { A2UISurfaceError } from "./native-catalog";

export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export type A2UIOperation = Record<string, unknown>;

type CopilotKitActionBridge = {
  core: {
    properties: Record<string, unknown>;
    setProperties(properties: Record<string, unknown>): void;
    runAgent(options: { agent: AbstractAgent }): Promise<unknown>;
  };
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getA2UIOperations(content: unknown): A2UIOperation[] {
  if (!isRecord(content)) return [];

  const operations = content[A2UI_OPERATIONS_KEY] ?? content.operations;
  if (!Array.isArray(operations)) return [];
  return operations.filter(isRecord);
}

/** Whether operations can paint visible static or data-bound content. */
export function surfaceHasRenderableContent(
  operations: readonly A2UIOperation[],
): boolean {
  const componentOperations = operations.filter((operation) =>
    isRecord(operation["updateComponents"]),
  );
  if (componentOperations.length === 0) return false;
  const requiresData = JSON.stringify(componentOperations).includes('"path"');
  if (!requiresData) return true;
  return operations.some((operation) => {
    const update = operation["updateDataModel"];
    if (!isRecord(update) || !isRecord(update["value"])) return false;
    return Object.values(update["value"]).some((value) =>
      Array.isArray(value)
        ? value.length > 0
        : value !== null && value !== undefined && value !== "",
    );
  });
}

export function logA2UIRenderError(error: A2UISurfaceError): void {
  console.warn("[A2UI Angular] render error:", error);
}

export async function bridgeA2UIAction(
  copilotKit: CopilotKitActionBridge | null | undefined,
  agent: AbstractAgent | undefined,
  detail: unknown,
): Promise<void> {
  if (!copilotKit || !agent) return;

  try {
    copilotKit.core.setProperties({
      ...copilotKit.core.properties,
      a2uiAction: detail,
    });
    await copilotKit.core.runAgent({ agent });
  } finally {
    const { a2uiAction: _a2uiAction, ...rest } = copilotKit.core.properties;
    copilotKit.core.setProperties(rest);
  }
}
