/**
 * THE THREE ROSTER PRODUCERS MUST AGREE.
 *
 * `LOCAL_SERVICES_JSON` is the discovery roster the fleet control-plane reads,
 * and three different things produce it:
 *
 *  1. `showcase/docker-compose.local.yml` — the persistent stack's literal
 *     roster line, with `${LOCAL_SERVICE_URL_<SLUG>}` interpolated from the
 *     environment (which `_common.sh` populates from
 *     `showcase/local-services.generated.env`).
 *  2. `apply_isolation()` in `showcase/scripts/cli/_common.sh` — rewrites that
 *     line to a single-entry roster for an `--isolate` run.
 *  3. `buildLocalServicesJson` in `control-plane-run.ts` — synthesises the
 *     roster on the host-CLI path when nothing supplied one.
 *
 * If they disagree for the same slug, `showcase test <slug> --d6` behaves
 * differently depending on which produced the roster, and the difference is
 * invisible: a wrong demo origin reads as a failing cell, a wrong agent origin
 * reads as a failing agent. This file asserts the SHAPE all three must emit —
 * both axes, per record — and that the driver-input mapper downstream maps each
 * axis to the right driver field.
 *
 * The bash/python producers are asserted by reading their source text, because
 * they are not callable from vitest. That is weaker than executing them, but it
 * is what catches the failure that actually happened: a producer that emits only
 * ONE of the two URLs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { railwayServicesSource } from "../probes/discovery/railway-services.js";
import type { DiscoveryContext } from "../probes/types.js";

const SHOWCASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const COMPOSE_FILE = path.join(SHOWCASE_DIR, "docker-compose.local.yml");
const COMMON_SH = path.join(SHOWCASE_DIR, "scripts", "cli", "_common.sh");

const composeText = fs.readFileSync(COMPOSE_FILE, "utf8");
const commonShText = fs.readFileSync(COMMON_SH, "utf8");

describe("producer 1: the compose file's roster line", () => {
  const rosterLine = composeText
    .split("\n")
    .find((l) => l.includes("LOCAL_SERVICES_JSON=["));

  it("exists", () => {
    expect(rosterLine).toBeDefined();
  });

  it("interpolates the demo origin from LOCAL_SERVICE_URL_<SLUG>", () => {
    // This is the bridge from the manifest's `demo_frontend`. Hardcoding the
    // demo origin here would make the compose path ignore a migration.
    expect(rosterLine).toContain(
      '"publicUrl":"${LOCAL_SERVICE_URL_LANGGRAPH_PYTHON:-http://langgraph-python:10000}"',
    );
  });

  it("carries a SEPARATE, non-interpolated agent origin", () => {
    // The agent does not move on migration, so this is a constant — but it must
    // be PRESENT, or the driver would dial the agent at the demo origin.
    expect(rosterLine).toContain(
      '"agentBaseUrl":"http://langgraph-python:10000"',
    );
  });

  it("keeps the two axes as distinct keys, not one value reused", () => {
    const publicUrlIdx = rosterLine!.indexOf('"publicUrl"');
    const agentIdx = rosterLine!.indexOf('"agentBaseUrl"');
    expect(publicUrlIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeGreaterThan(publicUrlIdx);
  });

  it("no longer tells operators to hand-set the migration knob in .env", () => {
    // The whole point of the tracked field: the migration procedure is "edit
    // the manifest, run the emitter", not "set an env var".
    expect(composeText).toContain("emit-local-services-env.ts");
    expect(composeText).toContain("demo_frontend");
  });
});

describe("producer 2: apply_isolation's rewritten roster", () => {
  it("emits both axes in its single-entry roster", () => {
    expect(commonShText).toContain("'publicUrl': PUBLIC_URL,");
    expect(commonShText).toContain("'agentBaseUrl': f'http://{SLUG}:10000',");
  });

  it("still resolves the demo origin from LOCAL_SERVICE_URL_<SLUG>", () => {
    expect(commonShText).toContain('_slug_env_key="LOCAL_SERVICE_URL_');
  });

  it("cross-validates the manifest against showcase/.env before rewriting", () => {
    // `--isolate` reads the env var itself (compose interpolation cannot reach
    // it there), so the disagreement check must run on this path too.
    expect(commonShText).toContain("assert_unified_frontend_sources_agree");
    expect(commonShText).toContain("UNIFIED_FRONTEND_SOURCE_DISAGREEMENT");
  });

  it("exports the generated bridge rather than writing showcase/.env", () => {
    expect(commonShText).toContain("local-services.generated.env");
    // Nothing may WRITE the hand-maintained secrets file.
    expect(commonShText).not.toMatch(/>\s*"\$ENV_FILE"/);
    expect(commonShText).not.toMatch(/>>\s*"\$ENV_FILE"/);
  });
});

/**
 * Producer 3 (`buildLocalServicesJson`) is asserted in
 * `control-plane-run.test.ts`, which can call it directly. Here we check the
 * DOWNSTREAM half: whatever a producer emits, the discovery source must carry
 * both axes into the driver input, mapping each to the field the d6 driver reads
 * for that axis.
 */
describe("downstream: a two-axis roster reaches the driver as two axes", () => {
  // The discovery source reads the roster off `ctx.env`, not `process.env`, so
  // the local-injection seam is driven by handing it an env record.
  function ctxWithRoster(roster: unknown): DiscoveryContext {
    return {
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      env: { LOCAL_SERVICES_JSON: JSON.stringify(roster) },
      fetchImpl: globalThis.fetch,
    } as unknown as DiscoveryContext;
  }

  async function enumerateLocal(roster: unknown) {
    return await railwayServicesSource.enumerate(ctxWithRoster(roster), {
      namePrefix: "showcase-",
      nameExcludes: [],
    });
  }

  it("forwards agentBaseUrl when the roster supplies it (migrated slug)", async () => {
    const services = await enumerateLocal([
      {
        name: "showcase-mastra",
        publicUrl: "http://frontend-nextjs:3000/mastra",
        agentBaseUrl: "http://mastra:10000",
        demos: ["agentic-chat"],
      },
    ]);
    expect(services).toHaveLength(1);
    expect(services[0].publicUrl).toBe("http://frontend-nextjs:3000/mastra");
    expect(services[0].agentBaseUrl).toBe("http://mastra:10000");
  });

  it("leaves agentBaseUrl absent when the roster omits it (unmigrated / Railway)", async () => {
    const services = await enumerateLocal([
      {
        name: "showcase-agno",
        publicUrl: "http://agno:10000",
        demos: ["agentic-chat"],
      },
    ]);
    expect(services[0].agentBaseUrl).toBeUndefined();
  });

  it("rejects a non-URL agentBaseUrl loudly rather than dropping it", async () => {
    await expect(
      enumerateLocal([
        {
          name: "showcase-agno",
          publicUrl: "http://agno:10000",
          agentBaseUrl: "not-a-url",
        },
      ]),
    ).rejects.toThrow();
  });
});
