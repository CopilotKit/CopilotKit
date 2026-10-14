import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_ROOT_ID,
  generativeUISurfaceMessageId,
} from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";

export interface GenerativeUISurfaceWriter {
  setRoot(node: Omit<A2UIComponentNode, "id">): void;
  upsert(...nodes: A2UIComponentNode[]): void;
  updateData(path: string, value: unknown): void;
  close(): void;
}

/**
 * Experimental. Programmatic façade for custom agents and workflows: emits the
 * same `generative-ui-surface` activity events as `render_ui`, one per call.
 * Does not validate against the browser manifest; the client still validates
 * every operation before applying it.
 */
export function createSurfaceWriter(emit: (event: BaseEvent) => void) {
  return {
    openSurface({
      target,
      surfaceId,
      catalog,
    }: {
      target: string;
      surfaceId: string;
      catalog: string;
    }): GenerativeUISurfaceWriter {
      const messageId = generativeUISurfaceMessageId(surfaceId);
      const patch = (ops: unknown[]) =>
        emit({
          type: EventType.ACTIVITY_DELTA,
          messageId,
          activityType: GENERATIVE_UI_ACTIVITY_TYPE,
          patch: ops,
        } as BaseEvent);
      const append = (op: A2UIOperation) =>
        patch([{ op: "add", path: "/operations/-", value: op }]);
      const content: GenerativeUISurfaceContent = {
        surfaceId,
        target,
        catalogId: catalog,
        operations: [
          { version: "v0.9", createSurface: { surfaceId, catalogId: catalog } },
        ],
        status: "streaming",
        rejected: [],
      };
      emit({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId,
        activityType: GENERATIVE_UI_ACTIVITY_TYPE,
        content,
        replace: true,
      } as BaseEvent);
      return {
        setRoot: (node) =>
          append({
            version: "v0.9",
            updateComponents: {
              surfaceId,
              components: [
                { ...node, id: GENERATIVE_UI_ROOT_ID } as A2UIComponentNode,
              ],
            },
          }),
        upsert: (...nodes) =>
          append({
            version: "v0.9",
            updateComponents: { surfaceId, components: nodes },
          }),
        updateData: (path, value) =>
          append({
            version: "v0.9",
            updateDataModel: { surfaceId, path, value },
          }),
        close: () =>
          patch([{ op: "replace", path: "/status", value: "ready" }]),
      };
    },
  };
}
