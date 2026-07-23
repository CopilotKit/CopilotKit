import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the starter-template container fleet
 * (`starter-<slug>`). Each starter ships a SINGLE deployable image that
 * EXPOSEs the Next.js frontend on port 3000; that frontend serves `/` and
 * `/api/copilotkit` but has NO `/api/health` route (the agent's `/health`
 * lives on the internal agent port 8123, which Railway does not expose). So
 * `/` is the only correct, reachable healthcheck for the exposed surface —
 * the same baseline the Next.js shells use, and the same `healthcheckPath`
 * the provisioner (`provision-starter-fleet.ts`) sets on the Railway
 * instance config.
 *
 * Like every driver this composes on `probeBaseline`, which enforces the
 * two minimum invariants before any feature-level extension:
 *   1. Railway deployment-SUCCESS for the resolved env (GraphQL).
 *   2. HTTP 200 on `https://<host>/`.
 *
 * Driver-specific DOM + network-call extensions (e.g. a CopilotKit
 * round-trip against `/api/copilotkit`) can compose on top of this baseline
 * once those micro-tasks land; until then this baseline is the agreed
 * completion bar, and crucially NO driver remains a fail-loud "not handled"
 * stub.
 */
export async function probeStarter(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "starter",
    healthcheckPath: "/",
  });
}
