import type { InjectionKey, Ref } from "vue";
import { ref } from "vue";
import {
  createLicenseContextValue,
  type LicenseContextValue,
} from "@copilotkit/shared";

export type { LicenseContextValue };
export { createLicenseContextValue };

export const LicenseContextKey: InjectionKey<Ref<LicenseContextValue>> =
  Symbol("LicenseContext");

export function createDefaultLicenseRef(): Ref<LicenseContextValue> {
  return ref(createLicenseContextValue(null));
}
