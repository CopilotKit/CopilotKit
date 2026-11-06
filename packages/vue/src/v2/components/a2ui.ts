import * as z from "zod";
import {
  ɵA2UI_DEFAULT_SURFACE_ID,
  ɵA2UI_SURFACE_ACTIVITY_TYPE,
  ɵgetA2UIOperationSurfaceId,
} from "@copilotkit/core";
import type { ɵA2UIOperation } from "@copilotkit/core";

export type A2UIOperation = ɵA2UIOperation;

export const A2UISurfaceActivityType = ɵA2UI_SURFACE_ACTIVITY_TYPE;

export const A2UIActivityContentSchema = z.object({
  operations: z.array(z.record(z.string(), z.unknown())),
});

/**
 * The surface an operation addresses: the id nested in the operation wins
 * over a top-level `surfaceId` (OSS-1048); "default" when it names none.
 */
export function getOperationSurfaceId(operation: A2UIOperation) {
  return ɵgetA2UIOperationSurfaceId(operation) ?? ɵA2UI_DEFAULT_SURFACE_ID;
}
