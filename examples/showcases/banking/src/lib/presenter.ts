/**
 * Presenter/booth-only demo reset. Unset (default) hides the sidebar reset
 * button AND disables the POST /api/v1/dev/reset endpoint. Set
 * PRESENTER_RESET_ENABLED=true for FDE/sales/conference/booth deployments so a
 * presenter can reset demo state from the UI. A per-deploy server-side env gate
 * (non-NEXT_PUBLIC_), threaded to the client as a prop in layout.tsx.
 */
export function presenterResetEnabled(): boolean {
  return process.env.PRESENTER_RESET_ENABLED === "true";
}
