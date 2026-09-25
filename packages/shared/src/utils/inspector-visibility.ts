export interface InspectorVisibilityOptions {
  /** Explicit local-preview exception; callers must verify the browser hostname. */
  allowLocalProductionPreview?: boolean;
  enableInspector?: boolean;
  isBrowser: boolean;
  isDevelopment: boolean;
}

/**
 * The Inspector is on by default in development. A consumer may explicitly
 * enable it for a local production preview; the provider also checks localhost.
 */
export function shouldEnableInspector({
  enableInspector,
  isBrowser,
  isDevelopment,
  allowLocalProductionPreview = false,
}: InspectorVisibilityOptions): boolean {
  return (
    isBrowser &&
    enableInspector !== false &&
    (isDevelopment || (enableInspector === true && allowLocalProductionPreview))
  );
}
