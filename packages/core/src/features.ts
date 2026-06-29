/**
 * Central registry of CopilotKit feature names.
 *
 * Feature names are the strings passed to a license context's `checkFeature`
 * (see `@copilotkit/shared`'s `LicenseContextValue`). Historically the only
 * features referenced by literal were the chat surfaces (`chat`, `sidebar`,
 * `popup`); this module makes the set explicit and typed so new surfaces —
 * such as the threads drawer — register a real, discoverable feature name
 * rather than an ad-hoc string scattered across components.
 *
 * `checkFeature` itself still accepts any `string` for backward compatibility;
 * this registry simply documents and types the names CopilotKit recognises.
 */

/**
 * The set of feature names CopilotKit recognises.
 *
 * Frozen so the array cannot be mutated at runtime. Add new surfaces here when
 * they begin gating behaviour on `checkFeature`.
 */
export const ɵCOPILOTKIT_FEATURES = Object.freeze([
  "chat",
  "sidebar",
  "popup",
  "threads",
] as const);

/**
 * Union of recognised CopilotKit feature names.
 */
export type ɵCopilotKitFeature = (typeof ɵCOPILOTKIT_FEATURES)[number];

const FEATURE_SET: ReadonlySet<string> = new Set(ɵCOPILOTKIT_FEATURES);

/**
 * Type guard: returns `true` when `name` is a recognised CopilotKit feature.
 *
 * @param name - Candidate feature name.
 * @returns Whether `name` is a registered feature.
 *
 * @example
 * ```ts
 * if (ɵisCopilotKitFeature("threads")) {
 *   // narrowed to ɵCopilotKitFeature
 * }
 * ```
 */
export function ɵisCopilotKitFeature(name: string): name is ɵCopilotKitFeature {
  return FEATURE_SET.has(name);
}
