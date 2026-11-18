/**
 * Hosts the Inspector runs on. The Inspector reads agent state, messages and
 * request headers, so it only mounts on a page served from this machine.
 *
 * @internal Framework adapters use this list. Applications must not depend on it.
 */
export const ɵINSPECTOR_LOOPBACK_HOSTS: readonly string[] = Object.freeze([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

export interface InspectorVisibilityOptions {
  enableInspector?: boolean;
  isBrowser: boolean;
  isDevelopment: boolean;
  /**
   * The page's `location.hostname`. When set, the Inspector is enabled only on
   * a loopback host (see {@link ɵINSPECTOR_LOOPBACK_HOSTS}), so a development
   * build served on a LAN or tunnel address does not expose it.
   */
  hostname?: string;
}

/**
 * The Inspector is a development-only browser tool. Consumers may disable it,
 * but an explicit `true` never overrides a production or server environment,
 * or a page served from a non-loopback host.
 *
 * @example
 * shouldEnableInspector({
 *   enableInspector,
 *   isBrowser: true,
 *   isDevelopment: process.env.NODE_ENV === "development",
 *   hostname: window.location.hostname,
 * });
 */
export function shouldEnableInspector({
  enableInspector,
  isBrowser,
  isDevelopment,
  hostname,
}: InspectorVisibilityOptions) {
  const isAllowedHost =
    hostname === undefined || ɵINSPECTOR_LOOPBACK_HOSTS.includes(hostname);
  return (
    isBrowser && isDevelopment && enableInspector !== false && isAllowedHost
  );
}
