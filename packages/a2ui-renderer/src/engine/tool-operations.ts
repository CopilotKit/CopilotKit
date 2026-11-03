import { ɵgetA2UIOperations } from "@copilotkit/core";
import type { ɵA2UIOperation } from "@copilotkit/core";
import { A2UI_BASIC_CATALOG_ID } from "../catalog-ids";

/** The tool AG-UI uses to send a surface as a state snapshot. */
export const AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME = "AGUISendStateSnapshot";

interface A2UISnapshot {
  surfaceId: string;
  catalogId: string;
  data?: unknown;
  components: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSnapshot(payload: Record<string, unknown>) {
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : payload;
  if (
    typeof snapshot.surfaceId !== "string" ||
    !Array.isArray(snapshot.components)
  ) {
    return null;
  }
  const result: A2UISnapshot = {
    surfaceId: snapshot.surfaceId,
    catalogId:
      typeof snapshot.catalogId === "string"
        ? snapshot.catalogId
        : A2UI_BASIC_CATALOG_ID,
    data: snapshot.data,
    components: snapshot.components,
  };
  return result;
}

/**
 * Reads A2UI operations from a tool payload: its `a2ui_operations`, else a
 * surface snapshot (`{ surfaceId, components, data?, catalogId? }`, bare or
 * under `snapshot`) turned into createSurface → updateDataModel →
 * updateComponents.
 *
 * @param payload - Tool arguments or a parsed tool result, of any shape.
 * @returns The operations, or an empty list.
 */
export function operationsFromA2UISnapshot(payload: unknown) {
  if (!isRecord(payload)) return [];
  const operations = ɵgetA2UIOperations(payload);
  if (operations.length > 0) return operations;

  const snapshot = readSnapshot(payload);
  if (!snapshot) return [];
  const { surfaceId } = snapshot;
  const result: ɵA2UIOperation[] = [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: snapshot.catalogId, theme: {} },
    },
  ];
  if (snapshot.data !== undefined) {
    result.push({
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: snapshot.data },
    });
  }
  result.push({
    version: "v0.9",
    updateComponents: { surfaceId, components: snapshot.components },
  });
  return result;
}

function parseJson(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** The tool call fields that decide what an A2UI tool call renders. */
export interface A2UIToolCallLike {
  name?: string;
  status: string;
  args: unknown;
  result?: string;
}

/**
 * The operations an A2UI tool call renders: from its result when that holds
 * any, else from its arguments. A state snapshot call renders from its
 * arguments only once it is complete, so a half-streamed snapshot never
 * paints.
 */
export function getRenderedA2UIToolOperations(toolCall: A2UIToolCallLike) {
  const fromResult = toolCall.result
    ? operationsFromA2UISnapshot(parseJson(toolCall.result))
    : [];
  if (fromResult.length > 0) return fromResult;
  const isPartialSnapshot =
    toolCall.name === AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME &&
    toolCall.status !== "complete";
  if (isPartialSnapshot) return [];
  return operationsFromA2UISnapshot(toolCall.args);
}
