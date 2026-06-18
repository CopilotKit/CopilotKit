import type { AngularToolCall } from "../../tools";
import {
  type A2UIOperation,
  getA2UIOperations,
  isRecord,
} from "./a2ui-surface-host";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  type RenderA2UIArgs,
} from "./a2ui-tool-types";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

type A2UISnapshot = {
  surfaceId: string;
  catalogId?: string;
  data?: unknown;
  components: unknown[];
};

function parseJsonResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function getSnapshot(payload: unknown): A2UISnapshot | undefined {
  if (!isRecord(payload)) return undefined;
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : payload;
  if (
    typeof snapshot.surfaceId !== "string" ||
    !Array.isArray(snapshot.components)
  ) {
    return undefined;
  }

  return {
    surfaceId: snapshot.surfaceId,
    catalogId:
      typeof snapshot.catalogId === "string" ? snapshot.catalogId : undefined,
    data: snapshot.data,
    components: snapshot.components,
  };
}

function operationsFromSnapshot(snapshot: A2UISnapshot): A2UIOperation[] {
  const operations: A2UIOperation[] = [
    {
      version: "v0.9",
      createSurface: {
        surfaceId: snapshot.surfaceId,
        catalogId: snapshot.catalogId ?? BASIC_CATALOG_ID,
        theme: {},
      },
    },
  ];

  if (snapshot.data !== undefined) {
    operations.push({
      version: "v0.9",
      updateDataModel: {
        surfaceId: snapshot.surfaceId,
        path: "/",
        value: snapshot.data,
      },
    });
  }

  operations.push({
    version: "v0.9",
    updateComponents: {
      surfaceId: snapshot.surfaceId,
      components: snapshot.components,
    },
  });

  return operations;
}

function getOperationsFromPayload(payload: unknown): A2UIOperation[] {
  if (!isRecord(payload)) return [];

  const operations = getA2UIOperations(payload);
  if (operations.length > 0) return operations;

  const snapshot = getSnapshot(payload);
  return snapshot ? operationsFromSnapshot(snapshot) : [];
}

function getOperationsFromResult(result: string | undefined): A2UIOperation[] {
  if (!result) return [];
  const payload = parseJsonResult(result);
  return getOperationsFromPayload(payload);
}

export function getRenderedA2UIOperations(
  toolCall: AngularToolCall<RenderA2UIArgs>,
): A2UIOperation[] {
  const resultOperations = getOperationsFromResult(toolCall.result);
  if (resultOperations.length > 0) {
    return resultOperations;
  }

  if (
    toolCall.name === AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME &&
    toolCall.status !== "complete"
  ) {
    return [];
  }

  return getOperationsFromPayload(toolCall.args);
}
