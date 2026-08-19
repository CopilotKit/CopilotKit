export interface InspectorVisibilityOptions {
  enableInspector?: boolean;
  isBrowser: boolean;
  isDevelopment: boolean;
}

/**
 * The Inspector is a development-only browser tool. Consumers may disable it,
 * but an explicit `true` never overrides a production or server environment.
 */
export function shouldEnableInspector({
  enableInspector,
  isBrowser,
  isDevelopment,
}: InspectorVisibilityOptions): boolean {
  return isBrowser && isDevelopment && enableInspector !== false;
}
