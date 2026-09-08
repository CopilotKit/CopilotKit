import { readAngularRuntimeConfig } from "./cell-context";

/** Return the staged integration ID, failing closed outside an integration. */
export function integrationId(): string {
  const config = readAngularRuntimeConfig();
  if (config === undefined) {
    throw new Error(
      "The Angular Showcase runtime manifest is missing or invalid.",
    );
  }
  return config.integrationId;
}
