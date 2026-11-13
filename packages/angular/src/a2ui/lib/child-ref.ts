import type { BehaviorNode } from "@a2ui/web_core/v0_9";
import type { A2UIChildRef } from "./types";

export interface ResolvedChildRef {
  id: string;
  basePath: string;
}

export function toChildRef(
  value: A2UIChildRef,
  basePath: string,
): ResolvedChildRef {
  return typeof value === "string"
    ? { id: value, basePath }
    : { id: value.id, basePath: value.basePath ?? basePath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The binder resolves templated child lists to `{ id, basePath }` but leaves
 * plain id arrays untouched. Normalize every child list in `value` to that
 * shape; a missing child list becomes `[]`.
 */
export function normalizeChildRefs(
  value: unknown,
  behavior: BehaviorNode,
  basePath: string,
): unknown {
  switch (behavior.type) {
    case "STRUCTURAL":
      return Array.isArray(value)
        ? value.map((item) =>
            typeof item === "string" ? toChildRef(item, basePath) : item,
          )
        : [];
    case "OBJECT": {
      if (!isRecord(value)) return value;
      const next: Record<string, unknown> = { ...value };
      for (const [key, node] of Object.entries(behavior.shape)) {
        if (key in value) {
          next[key] = normalizeChildRefs(value[key], node, basePath);
        }
      }
      return next;
    }
    case "ARRAY":
      return Array.isArray(value)
        ? value.map((item) =>
            normalizeChildRefs(item, behavior.element, basePath),
          )
        : value;
    default:
      return value;
  }
}
