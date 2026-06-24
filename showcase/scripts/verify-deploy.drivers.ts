import type { ProbeDriver } from "./railway-envs";
import type { ProbeTarget } from "./verify-deploy";

export type ProbeOutcome = { ok: true } | { ok: false; error: string };

export type ProbeRunner = (target: ProbeTarget) => Promise<ProbeOutcome>;

/**
 * Per-driver verifier registry. Each entry MUST:
 *   1. Hit the URL with a reasonable timeout (default 30s).
 *   2. Assert a feature-level property — DOM string for shells, fixture
 *      replay for aimock, admin login for pocketbase, etc.
 *   3. Return { ok: false, error } on ANY divergence, never throw across
 *      the boundary (runVerify catches throws but the driver is the right
 *      place to phrase errors).
 *
 * Individual driver implementations live in verify-deploy.drivers.<name>.ts
 * and are imported here; this file only does the dispatch. The exhaustive
 * `never` check at the bottom of the switch guarantees that adding a new
 * ProbeDriver literal to railway-envs.ts triggers a compile error here
 * until the new driver is wired up.
 */
export async function runDriver(target: ProbeTarget): Promise<ProbeOutcome> {
  try {
    switch (target.driver) {
      case "shell":
        return (await import("./verify-deploy.drivers.shell")).probeShell(
          target,
        );
      case "docs":
        return (await import("./verify-deploy.drivers.docs")).probeDocs(target);
      case "dashboard":
        return (
          await import("./verify-deploy.drivers.dashboard")
        ).probeDashboard(target);
      case "dojo":
        return (await import("./verify-deploy.drivers.dojo")).probeDojo(target);
      case "harness":
        return (await import("./verify-deploy.drivers.harness")).probeHarness(
          target,
        );
      case "eval":
        return (await import("./verify-deploy.drivers.eval")).probeEval(target);
      case "aimock":
        return (await import("./verify-deploy.drivers.aimock")).probeAimock(
          target,
        );
      case "pocketbase":
        return (
          await import("./verify-deploy.drivers.pocketbase")
        ).probePocketbase(target);
      case "webhooks":
        return (await import("./verify-deploy.drivers.webhooks")).probeWebhooks(
          target,
        );
      case "agent":
        return (await import("./verify-deploy.drivers.agent")).probeAgent(
          target,
        );
      case "starter":
        // The starter-template fleet (`starter-<slug>`) is verified by the
        // verify-deploy baseline driver (deployment-SUCCESS + HTTP 200 on
        // `/`), exactly like the Next.js shells — the starters EXPOSE only
        // their Next.js frontend (serving `/` + `/api/copilotkit`, NO
        // `/api/health`), so `/` is the only correct healthcheck. Starters
        // are always-on + staging-probed, so resolve-verify-matrix routes
        // them here like every other managed showcase service.
        return (await import("./verify-deploy.drivers.starter")).probeStarter(
          target,
        );
      default: {
        const exhaustive: never = target.driver;
        return { ok: false, error: `unknown driver: ${String(exhaustive)}` };
      }
    }
  } catch (e: unknown) {
    // A missing/broken driver module (e.g. `Cannot find module ...`)
    // or any other throw inside dynamic import must NOT escape — the
    // doc-comment contract is "drivers never throw across the
    // boundary". Wrap with the driver label so the diagnostic is
    // actionable in a multi-service run.
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `runDriver(${target.driver}): ${msg}` };
  }
}

/**
 * Exported for tests that want to spy on driver dispatch without doing
 * real network work. Each driver module is a tiny pure-fetch boundary.
 */
export type { ProbeDriver };
