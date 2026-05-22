/**
 * `descriptorToDefaults` — pure: ParameterDescriptor[] → sensible default arg
 * values. Used by `<ArgForm>` to seed its initial state when no fixture preset
 * is selected (M2/M4 hand-off) or when the dev clicks "Reset to defaults".
 *
 * Defaults per type (chosen to be the cheapest "valid-looking" stand-in):
 *   - string   → ""
 *   - number   → 0
 *   - boolean  → false
 *   - enum     → first value of `enumValues` (or "" if empty/missing)
 *   - array    → []                                   (empty repeater)
 *   - object   → { [child.name]: defaults(child) }    (recursive)
 *   - opaque   → null                                 (JSON editor seed)
 *
 * Why an empty object/array instead of `undefined` for non-required params?
 * The form renderer always shows a control for declared params; the agent
 * (and downstream M3 sandbox) treats missing keys as "not provided". Returning
 * `undefined` here would force every consumer to filter, and null/"" round-trip
 * through JSON, so empty defaults are the simpler contract.
 *
 * Spec: .chalk/plans/web-inspector-v1.md §7.1 + .chalk/plans/web-inspector-execution.md §4 (Agent C).
 */
import type { ParameterDescriptor } from "../../shared/types.js";

/** Produce a default args object from a top-level parameter list. */
export function descriptorToDefaults(
  params: ParameterDescriptor[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const param of params) {
    out[param.name] = defaultForDescriptor(param);
  }
  return out;
}

/**
 * Default for a single descriptor. Exported so the array-repeater can request
 * a fresh item value when the user clicks "Add item".
 */
export function defaultForDescriptor(param: ParameterDescriptor): unknown {
  switch (param.type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "enum": {
      const values = param.enumValues;
      return values && values.length > 0 ? values[0] : "";
    }
    case "array":
      return [];
    case "object": {
      const properties = param.properties ?? [];
      return descriptorToDefaults(properties);
    }
    case "opaque":
      return null;
    default: {
      // Exhaustiveness guard — if a new ParameterDescriptor variant is added,
      // this branch surfaces it at typecheck time. At runtime we fall back to
      // null so the form still renders (the JSON editor handles unknown).
      const _exhaustive: never = param.type;
      void _exhaustive;
      return null;
    }
  }
}
