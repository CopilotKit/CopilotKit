import { computed, inject, type ComputedRef } from "vue";
import {
  LicenseContextKey,
  createDefaultLicenseRef,
  type LicenseContextValue,
} from "./license-context";

/**
 * Vue counterpart of React's `useLicenseContext()` hook.
 *
 * Returns a `ComputedRef<LicenseContextValue>` whose `checkFeature(...)` /
 * `getLimit(...)` callbacks track the value installed by
 * `CopilotKitProvider`. Falls back to a permissive default
 * (`createLicenseContextValue(null)`) when no provider has registered the
 * context — matching React's `createContext(createLicenseContextValue(null))`
 * default and keeping component trees mountable in isolation.
 */
export function useLicenseContext(): ComputedRef<LicenseContextValue> {
  const source = inject(LicenseContextKey, createDefaultLicenseRef(), true);
  return computed(() => source.value);
}
