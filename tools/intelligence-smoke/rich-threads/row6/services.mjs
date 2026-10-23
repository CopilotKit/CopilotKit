import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createNativeReader } from "./native.mjs";
import {
  createDestinationReader,
  createTranscriptReader,
} from "./destination.mjs";
import { createBuiltImporter } from "./importer.mjs";

/** Concrete readers/importer; row3 supplies real native source sets, row4 browser continuation. */
export async function createServices({
  framework,
  scope,
  environment,
  browser,
  intelligence,
  capture,
  outputDir,
  signal,
}) {
  assert.equal(scope.framework, framework, "Framework scope mismatch");
  assert.equal(
    scope.owner,
    environment.receipt.owner,
    "Environment ownership mismatch",
  );
  assert(
    environment.receipt.cleanScope,
    "Verified clean environment receipt required",
  );
  assert(
    intelligence.pool,
    "Common Intelligence reader must expose its scoped PostgreSQL pool",
  );
  assert(
    environment.row3?.prepareSources,
    "PNI-598 prepareSources concrete driver is required",
  );
  assert(
    environment.row4?.continueImported,
    "PNI-599 connected continuation driver is required",
  );
  const directory = join(outputDir, "row6-driver");
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const sourceSet = await environment.row3.prepareSources({
    framework,
    scope,
    environment,
    browser,
    intelligence,
    capture,
    outputDir: directory,
    signal,
    purpose: "row6",
  });
  const { sources, stores, importEnv, agentMap, coverage } = sourceSet;
  assert(Array.isArray(sources) && sources.length, "Row3 returned no sources");
  const selected = sources.filter((source) => source.role === "selected");
  const collisions = sources.filter(
    (source) => source.role === "connected-collision",
  );
  assert(
    selected.length && collisions.length,
    "Row6 needs native-only histories AND a real connected collision control",
  );
  for (const source of sources) {
    assert(
      source.importSourceId &&
        source.nativeIdentity.threadId &&
        source.provenance.description,
      "Complete source descriptor required",
    );
    assert(
      source.provenance.durable && source.provenance.completeCheckpoint,
      "Source must retain a complete durable native checkpoint",
    );
    assert.equal(
      source.provenance.nativeOnly,
      source.role === "selected",
      "Native-only provenance disagrees with source role",
    );
  }
  const snapshotDestination = createDestinationReader({
    pool: intelligence.pool,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    readThread: createTranscriptReader({
      apiUrl: scope.apiUrl,
      apiKey: scope.credentials.apiKey,
      signal,
    }),
  });
  const continuationSources = selected.filter(
    (source) => source.continuationPlan?.mode === "followup",
  );
  assert(
    continuationSources.length,
    "PNI-598 rich source set lacks a PNI-599 normal follow-up plan",
  );
  return {
    fixture: {
      sourceIds: selected.map((source) => source.importSourceId),
      nativeThreadIds: Object.fromEntries(
        selected.map((source) => [
          source.importSourceId,
          source.nativeIdentity.threadId,
        ]),
      ),
      collisionSourceIds: collisions.map((source) => source.importSourceId),
      continuationSourceIds: continuationSources.map(
        (source) => source.importSourceId,
      ),
      importSafetyCoverage: coverage,
      provenance: {
        sources: sources.map(
          ({ importSourceId, nativeIdentity, provenance }) => ({
            importSourceId,
            nativeIdentity,
            provenance,
          }),
        ),
        referenceExposure:
          "Author has read the temporary reference; subsequent execution is independent but not blind",
        purpose: environment.receipt.purpose,
      },
    },
    services: {
      importSafety: {
        snapshotSource: createNativeReader({
          sources,
          stores,
          owner: scope.owner,
        }),
        snapshotDestination,
        import: createBuiltImporter({
          pool: intelligence.pool,
          scope,
          cli: environment.artifacts.cli,
          framework,
          sources,
          importEnv,
          agentMap,
          outputDir: directory,
          signal,
        }),
        async continueImported() {
          const before = await snapshotDestination();
          for (const source of continuationSources) {
            const destinations = before.threads.filter(
              (thread) => thread.sourceId === source.importSourceId,
            );
            assert.equal(
              destinations.length,
              1,
              "Continuation requires the one actually imported destination",
            );
            await environment.row4.continueImported({
              source,
              destination: destinations[0],
              framework,
              scope,
              environment,
              browser,
              intelligence,
              capture,
              outputDir: directory,
              signal,
            });
          }
        },
      },
    },
  };
}
