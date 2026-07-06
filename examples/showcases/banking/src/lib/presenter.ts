/**
 * Presenter/booth-only demo reset. Unset (default) hides the sidebar reset
 * button AND disables the POST /api/v1/dev/reset endpoint. Set
 * PRESENTER_RESET_ENABLED=true for FDE/sales/conference/booth deployments so a
 * presenter can reset demo state from the UI. Mirrors src/lib/glass-engine.ts.
 */
export function presenterResetEnabled(): boolean {
  return process.env.PRESENTER_RESET_ENABLED === "true";
}
