/**
 * Dev-only escape hatch for pointing this demo at a CopilotKit runtime that
 * runs as its own process.
 *
 * By default the demo talks to its own Next route handler under
 * `src/app/api/copilotkit`, which means the app and the runtime are the same
 * process. Stopping "the runtime" therefore stops the app, and restarting it
 * makes the dev server reload the page — which re-runs the startup handshake
 * and hides any mid-session connection behaviour that was supposed to be
 * observed.
 *
 * Set `NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL` before starting `next dev` to send
 * the demo at a separate runtime process instead, e.g. the standalone Express
 * runtime in `examples/v2/runtime/express`:
 *
 *   NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL=http://localhost:4002/api/copilotkit
 *
 * Unset, the demo behaves exactly as before.
 */
export const DEMO_RUNTIME_URL =
  process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL || "/api/copilotkit";
