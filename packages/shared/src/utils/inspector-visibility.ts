export interface InspectorVisibilityOptions {
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
}: InspectorVisibilityOptions): boolean {
  return (
    isBrowser &&
    enableInspector !== false &&
    (isDevelopment || enableInspector === true)
  );
}
