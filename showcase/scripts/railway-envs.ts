/**
 * railway-envs.ts — Single source of truth for Railway IDs used by all
 * TypeScript showcase tooling. Mirrors (but does not import) the IDs in
 * `showcase/bin/railway` (Ruby). When these drift, prefer this file as
 * the TS-side canonical source and reconcile bin/railway by hand.
 *
 * - PROJECT_ID is the CopilotKit Showcase Railway project.
 * - ENV_IDS maps human env names (and common synonyms) to Railway env IDs.
 * - SERVICES is the per-service map of serviceId + per-env serviceInstanceId.
 *
 * Service-instance IDs are env-scoped, so prod and staging IDs differ for
 * the same service. Use instanceIdFor(serviceName, env) to get the right one.
 */

export const PROJECT_ID = "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479";

export const PRODUCTION_ENV_ID = "b14919f4-6417-429f-848d-c6ae2201e04f";
export const STAGING_ENV_ID = "8edfef02-ea09-4a20-8689-261f21cc2849";

export type EnvName = "prod" | "staging";

// Accept common synonyms ("production", "prod", "staging") and normalize.
export const ENV_IDS: Record<string, string> = {
  prod: PRODUCTION_ENV_ID,
  production: PRODUCTION_ENV_ID,
  staging: STAGING_ENV_ID,
};

export function resolveEnv(name: string): { env: EnvName; envId: string } {
  const lower = name.trim().toLowerCase();
  if (lower === "prod" || lower === "production") {
    return { env: "prod", envId: PRODUCTION_ENV_ID };
  }
  if (lower === "staging") {
    return { env: "staging", envId: STAGING_ENV_ID };
  }
  throw new Error(
    `Unknown env "${name}". Use one of: prod, production, staging.`,
  );
}

export interface ServiceEntry {
  /** Railway service ID (env-independent). */
  serviceId: string;
  /** serviceInstance ID for the production env. */
  prodInstanceId: string;
  /** serviceInstance ID for the staging env. */
  stagingInstanceId: string;
  /**
   * True iff this service is built and pushed by `showcase_build.yml`.
   * pocketbase and webhooks are first-party GHCR images but are built
   * by their own repos' release workflows — they MUST NOT be touched
   * by the showcase build's staging redeploy step.
   */
  ciBuilt: boolean;
  /**
   * True iff `verify-railway-image-refs.ts` validates this service's
   * image refs. The historic gate filtered to `showcase-*`-prefix
   * services only (19 of 27). WS4 expands that to include `aimock`
   * (always was an override target), `pocketbase`, and `webhooks` —
   * the three first-party non-`showcase-*` services. `dashboard`,
   * `docs`, `dojo`, `harness`, and `shell` remain unvalidated for
   * this PR and are scoped to Phase 2 (their Railway image refs were
   * not part of the 27/27 prod-pinning audit).
   */
  gateValidated: boolean;
  /**
   * Optional GHCR repo name override per env. When unset for an env,
   * the verify gate expects `ghcr.io/copilotkit/<serviceName>:<tag>`
   * (or `@sha256:<digest>` in prod). When set, the gate uses
   * `ghcr.io/copilotkit/<repoName>:<tag>` for that env only.
   *
   * Real cases (2026-05-28); headings use the actual SSOT keys:
   *   aimock      — prod: "showcase-aimock"      (digest-pinned wrapper)
   *                 staging: "showcase-aimock"   (wrapper, :latest)
   *                 The `showcase-aimock` wrapper bakes showcase fixtures
   *                 into base aimock and is the permanent, canonical
   *                 image for the aimock showcase service in BOTH envs.
   *                 It is the only aimock image CI builds.
   *   pocketbase  — prod: "showcase-pocketbase"
   *                 staging: "showcase-pocketbase"
   *   webhooks    — prod: "showcase-eval-webhook"
   *                 staging: "showcase-eval-webhook"
   */
  repoNameOverride?: { prod?: string; staging?: string };
}

/**
 * Canonical per-service ID map. Keys are the EXACT Railway service names
 * (`showcase-*` for integrations; bare names for infra services).
 *
 * Resolved 2026-05-28 via Railway GraphQL
 * `project($id).services.edges[].serviceInstances.edges[]`.
 *
 * `dispatchName` (when set) is the EXACT `dispatch_name` value used by
 * `.github/workflows/showcase_build.yml`'s `ALL_SERVICES` matrix entry
 * for this service. The redeploy script uses it to convert the matrix
 * output (which carries dispatch_names) back into SSOT keys.
 */
export const SERVICES: Record<
  string,
  ServiceEntry & { dispatchName?: string }
> = {
  aimock: {
    serviceId: "0fa0435d-8a66-46f0-84fd-e4250b580013",
    prodInstanceId: "5801d8be-5ad9-4eff-9c9c-7be61d9a023e",
    stagingInstanceId: "9f260dfd-d9d4-43e9-98fe-49696f87fe50",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "showcase-aimock",
    // Aimock runs the `showcase-aimock` wrapper image in BOTH envs.
    // The wrapper (built from `showcase/aimock/Dockerfile`) bakes the
    // showcase fixture tree into base aimock and is the permanent,
    // canonical aimock image — it is the only aimock image CI builds.
    // Prod is digest-pinned (`@sha256:<digest>`, promote-only); staging
    // floats `:latest`. Both envs override to the same `showcase-aimock`
    // GHCR repo; there is no migration to the unwrapped `aimock` repo.
    repoNameOverride: { prod: "showcase-aimock", staging: "showcase-aimock" },
  },
  dashboard: {
    serviceId: "4d5dfd74-be61-40b2-8564-b53b7dd4c15b",
    prodInstanceId: "e68f98fa-b2ef-41cc-82f6-2ed6f9533bf3",
    stagingInstanceId: "aea7332e-17a0-4fab-921c-ed5baad2a6f2",
    ciBuilt: true,
    gateValidated: false,
    dispatchName: "shell-dashboard",
    // No repoNameOverride here: gate validation for `dashboard`/`docs`/
    // `dojo`/`shell` is OUT OF SCOPE for WS4. The current gate's
    // `showcase-*`-prefix filter naturally excluded them, and we preserve
    // that exclusion. Adding them is Phase 2 work.
  },
  docs: {
    serviceId: "7badfb8d-4228-414c-9145-b4026803714f",
    prodInstanceId: "b15564fc-f832-49b3-82df-fd36f298fe96",
    stagingInstanceId: "d5caa51d-73ee-4669-bfea-d87bf1488b02",
    ciBuilt: true,
    gateValidated: false,
    dispatchName: "shell-docs",
  },
  dojo: {
    serviceId: "7ad1ece7-2228-49cd-8a78-bddf30322907",
    prodInstanceId: "2ee4f2aa-11ec-4426-9a4a-41a1ad04f16d",
    stagingInstanceId: "1284d717-0ff5-432c-9326-fab12661df61",
    ciBuilt: true,
    gateValidated: false,
    dispatchName: "shell-dojo",
  },
  harness: {
    serviceId: "3a14bfed-0537-4d71-897b-7c593dca161d",
    prodInstanceId: "05fbcdf2-8a50-4b71-b4f6-c92c4b17e626",
    stagingInstanceId: "0811f68f-fac4-440e-a350-3a7ca5855b80",
    ciBuilt: true,
    gateValidated: false,
    dispatchName: "showcase-harness",
    // Railway service name is `harness` (not `showcase-harness`); gate
    // validation is deferred to Phase 2 alongside dashboard/docs/dojo/shell.
    // ciBuilt: true, gateValidated: false — contrast with pocketbase/webhooks
    // (ciBuilt: false, gateValidated: true).
  },
  pocketbase: {
    serviceId: "ba11e854-d695-4738-9a45-2b0776788824",
    prodInstanceId: "1ee376e2-13f2-4464-801e-d0aa0bf76532",
    stagingInstanceId: "0bc7db7b-5a43-4b33-af46-d07fb53c8610",
    // pocketbase is a first-party ghcr.io/copilotkit/ image, but its
    // GHCR repo name is `showcase-pocketbase` (NOT `pocketbase`), and
    // it is built by a separate release workflow — not showcase_build.yml.
    ciBuilt: false,
    gateValidated: true,
    repoNameOverride: {
      prod: "showcase-pocketbase",
      staging: "showcase-pocketbase",
    },
  },
  shell: {
    serviceId: "40eea0da-6071-4ea8-bdb9-39afb19225ec",
    prodInstanceId: "01614ccf-e109-4b30-b41b-7c5551c0a34c",
    stagingInstanceId: "25b7de41-188c-4f2e-ac07-538212eaeb91",
    ciBuilt: true,
    gateValidated: false,
    dispatchName: "shell",
  },
  "showcase-ag2": {
    serviceId: "4a37481b-f264-4eb7-a9cd-0a9ebb9ac05c",
    prodInstanceId: "de571c97-03fd-486b-8a54-9767a4a53f95",
    stagingInstanceId: "ecaf81b3-93a8-4862-92b6-04a016b634ed",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ag2",
  },
  "showcase-agno": {
    serviceId: "32cab80b-e329-45bd-9c73-c4e1ddc94305",
    prodInstanceId: "026d12fb-2844-42af-8f92-b47bc8a06bc8",
    stagingInstanceId: "68964ab6-75ca-4095-a64a-52cacfb684f5",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "agno",
  },
  "showcase-built-in-agent": {
    serviceId: "f4f8371a-bc46-45b2-b6d4-9c9af608bdbf",
    prodInstanceId: "40018ef7-1ed1-4979-b80c-9c2d957b6d88",
    stagingInstanceId: "b89ae7b3-01cc-4ed4-aca6-23aaa63cd59e",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "built-in-agent",
  },
  "showcase-claude-sdk-python": {
    serviceId: "b122ab65-9854-4cb2-a68e-b50ff13f7481",
    prodInstanceId: "bb18caaf-9a3e-4fdd-85ec-562fd82a3a89",
    stagingInstanceId: "1ef25aec-5fbd-40b9-8685-57c2681bd45d",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "claude-sdk-python",
  },
  "showcase-claude-sdk-typescript": {
    serviceId: "18a98727-5700-44aa-b497-b60795dbbd6a",
    prodInstanceId: "bee425e4-9661-4a88-8888-922b8cd4b61d",
    stagingInstanceId: "92305747-2f55-4122-aad4-882e989558ab",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "claude-sdk-typescript",
  },
  "showcase-crewai-crews": {
    serviceId: "0e9c284d-8d87-4fcf-9f82-6b704d7e4bd4",
    prodInstanceId: "3dab0cc3-cab1-4579-b772-947268088514",
    stagingInstanceId: "88c2a14f-435b-499e-a811-ee4f4be18fd8",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "crewai-crews",
  },
  "showcase-google-adk": {
    serviceId: "87f60507-5a3d-4b8a-9e23-2b1de85d939c",
    prodInstanceId: "7b2da5db-87d2-40ad-a3d9-b2d7a5485a22",
    stagingInstanceId: "7efe2fa0-fa78-4585-bc4c-6d39c326e6d1",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "google-adk",
  },
  "showcase-langgraph-fastapi": {
    serviceId: "06cccb5c-59f4-46b5-8adc-7113e77011a4",
    prodInstanceId: "105b7e01-acd0-48e2-9a09-541e2103e8d2",
    stagingInstanceId: "7899afe0-141b-4217-8dbb-5907813231dc",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langgraph-fastapi",
  },
  "showcase-langgraph-python": {
    serviceId: "90d03214-4569-41b0-b4c1-6438a8a7b203",
    prodInstanceId: "aec504f7-63d7-4ea6-9d50-601b00d2ae80",
    stagingInstanceId: "04d29664-a776-4670-9db3-b1d18bce1669",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langgraph-python",
  },
  "showcase-langgraph-typescript": {
    serviceId: "66246d3b-a18e-46f0-be51-5f3ff7a36e5a",
    prodInstanceId: "f53e9fdc-7c3e-4dfd-9fa8-d7241fd55bb8",
    stagingInstanceId: "481ab37f-da8a-4015-bd88-2b28d9eb261a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langgraph-typescript",
  },
  "showcase-langroid": {
    serviceId: "6dd9cb0a-66cc-46f1-972e-7cd74756157d",
    prodInstanceId: "6b5e20b5-8f8e-4ec3-9288-7a41122e42e5",
    stagingInstanceId: "a213f7d9-2117-4944-988b-05e68d819dd5",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langroid",
  },
  "showcase-llamaindex": {
    serviceId: "285386e8-492d-4cb8-b632-0a7d4607378f",
    prodInstanceId: "b778856e-9f90-4136-9415-fb2b41173f8d",
    stagingInstanceId: "17899ea7-355c-43f2-a152-28cb0b7fa864",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "llamaindex",
  },
  "showcase-mastra": {
    serviceId: "d7979eb7-2405-4aab-ad21-438f4a1b08af",
    prodInstanceId: "eaeddd9c-8b75-426f-b033-0fd935cbf6ef",
    stagingInstanceId: "eec22411-aab5-47a1-8f5b-d097e233d7f8",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "mastra",
  },
  "showcase-ms-agent-dotnet": {
    serviceId: "beeb2dd6-87a4-4599-aa07-0578f7bd6519",
    prodInstanceId: "93ca0edf-7b59-4de4-b1fd-3412bb07bc6a",
    stagingInstanceId: "9826bc58-c472-41e6-b050-29249d4b2a52",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ms-agent-dotnet",
  },
  "showcase-ms-agent-harness-dotnet": {
    serviceId: "6343d7f9-6c3f-4c8d-9a6e-79f03d2f1e37",
    prodInstanceId: "8f91ebc6-95c0-4433-b1f7-657ff49c2d59",
    stagingInstanceId: "6b0fe181-9156-4a40-9e44-90befe09833a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ms-agent-harness-dotnet",
  },
  "showcase-ms-agent-python": {
    serviceId: "655db75a-af8d-427d-a4f9-441570ae5003",
    prodInstanceId: "323ed911-4d28-45ab-8fc0-7d151828b938",
    stagingInstanceId: "741725ce-5fa1-4327-aff5-53dcc000c29c",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ms-agent-python",
  },
  "showcase-pydantic-ai": {
    serviceId: "0a106173-2282-4887-a994-0ca276a99d69",
    prodInstanceId: "192cd647-6824-4f01-937a-1da675d83805",
    stagingInstanceId: "6edf5ca5-6a56-4d28-92c3-2a3360c735db",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "pydantic-ai",
  },
  "showcase-spring-ai": {
    serviceId: "eed5d041-91be-4282-b414-beea00843401",
    prodInstanceId: "2fbf1db2-5e51-44c9-983c-3f2242d95c61",
    stagingInstanceId: "189ac76f-bd77-45c0-9c45-3853dae763cc",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "spring-ai",
  },
  "showcase-strands": {
    serviceId: "92e1cfad-ad53-403f-ab2b-5ab380832232",
    prodInstanceId: "2123c71b-9385-443c-a1c3-bcf4b1669eeb",
    stagingInstanceId: "f8a9d2ed-50ec-4f06-85d6-230baced8471",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "strands",
  },
  webhooks: {
    serviceId: "ba6acc13-7585-41fe-a5ee-585b34a58fcd",
    prodInstanceId: "d82ef5b4-3bfd-462e-9436-3d5dbca8681a",
    stagingInstanceId: "450e87e0-aba5-4aba-afaf-15f4deab03f0",
    ciBuilt: false,
    gateValidated: true,
    dispatchName: "webhooks",
    // webhooks is a first-party ghcr.io/copilotkit/ image, but its
    // GHCR repo name is `showcase-eval-webhook` (NOT `webhooks`), and
    // it is built by a separate release workflow — not showcase_build.yml.
    // The dispatch_name entry below exists so humans can redeploy/verify
    // webhooks from CI on demand; the build slot is no-op.
    repoNameOverride: {
      prod: "showcase-eval-webhook",
      staging: "showcase-eval-webhook",
    },
  },
};

export function instanceIdFor(serviceName: string, env: EnvName): string {
  const entry = SERVICES[serviceName];
  if (!entry) {
    throw new Error(
      `Unknown showcase service "${serviceName}". Add it to SERVICES in showcase/scripts/railway-envs.ts.`,
    );
  }
  return env === "prod" ? entry.prodInstanceId : entry.stagingInstanceId;
}

export function listServiceNames(): string[] {
  return Object.keys(SERVICES).sort();
}

/**
 * The subset of SERVICES that `showcase_build.yml` actually builds and
 * pushes. Excludes `pocketbase` and `webhooks` (released by their own
 * repos). Default target set for `redeploy-env.ts <env>` when no
 * explicit `--services` list is provided.
 */
export const CI_BUILT_SERVICES: ReadonlySet<string> = new Set(
  Object.entries(SERVICES)
    .filter(([, entry]) => entry.ciBuilt)
    .map(([name]) => name),
);

/**
 * Resolve the expected GHCR repo name for a (serviceName, env) pair.
 * Exported so callers (verify-railway-image-refs.ts) and unit tests can
 * exercise override resolution directly.
 */
export function repoNameFor(serviceName: string, env: EnvName): string {
  const entry = SERVICES[serviceName];
  if (!entry) return serviceName;
  const override = entry.repoNameOverride?.[env];
  return override ?? serviceName;
}

/**
 * Resolve a `showcase_build.yml` `dispatch_name` (e.g. `mastra`,
 * `shell-dashboard`, `showcase-aimock`) to the canonical SSOT key
 * (e.g. `showcase-mastra`, `dashboard`, `aimock`). Returns undefined
 * when the dispatch_name does not correspond to a CI-built service.
 */
export function serviceForDispatchName(
  dispatchName: string,
): string | undefined {
  for (const [name, entry] of Object.entries(SERVICES)) {
    if (entry.dispatchName === dispatchName) return name;
  }
  return undefined;
}

/**
 * Throw on SSOT load if any two services share the same `dispatchName`.
 * `serviceForDispatchName` iterates `Object.entries(SERVICES)` and returns
 * the first match — a silent collision would route redeploys to the wrong
 * service. We fail loud at module load instead.
 *
 * Accepts an injected map for testing; defaults to the real SERVICES map.
 */
export function assertDispatchNamesUnique(
  services: Record<string, { dispatchName?: string }> = SERVICES,
): void {
  const seen = new Map<string, string>(); // dispatchName -> first ssotKey
  const collisions: Array<{
    dispatchName: string;
    keys: [string, string];
  }> = [];
  for (const [key, entry] of Object.entries(services)) {
    const dn = entry.dispatchName;
    if (typeof dn !== "string" || dn.length === 0) continue;
    const prior = seen.get(dn);
    if (prior !== undefined) {
      collisions.push({ dispatchName: dn, keys: [prior, key] });
    } else {
      seen.set(dn, key);
    }
  }
  if (collisions.length > 0) {
    const lines = collisions
      .map(
        (c) =>
          `  - duplicate dispatchName "${c.dispatchName}" on SSOT keys: ${c.keys[0]}, ${c.keys[1]}`,
      )
      .join("\n");
    throw new Error(
      `railway-envs SSOT invariant violated:\n${lines}\n` +
        `Fix: each Railway service must have a unique dispatchName ` +
        `(or no dispatchName at all for out-of-band services).`,
    );
  }
}

// Module-load assertion: fail any importer if the SSOT drifts into a
// collision. Tests that exercise the invariant with synthetic input
// call assertDispatchNamesUnique(synthetic) directly.
assertDispatchNamesUnique();
