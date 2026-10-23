import assert from "node:assert/strict";
import { validateSource, assertImported } from "./assertions.mjs";

/** One onboarding transaction shared by row3 and continuation/restart/dedup rows.
 * The descriptor is captured before any service call can mutate it. This never
 * opens or answers pending controls: the caller owns the subsequent scenario.
 * The supplied record is updated incrementally so failed imports retain proof.
 */
export async function prepareImport(service, descriptor, record = {}) {
  const source = structuredClone(descriptor);
  record.source = source;
  const native = structuredClone(await service.inspectNative(descriptor));
  record.native = native;
  validateSource(source, native);
  record.before = structuredClone(await service.findImported(descriptor));
  assert.deepEqual(
    record.before,
    [],
    "Source already exists in Intelligence before import",
  );
  record.cli = await service.importSource(descriptor);
  assert.equal(record.cli.exitCode, 0, "Built import CLI failed");
  assert.equal(record.cli.dryRun, false, "Dry run is not an import");
  assert.ok(
    record.cli.buildIdentity && record.cli.command && record.cli.log,
    "Retain built CLI identity/command/log",
  );
  record.destinations = structuredClone(await service.findImported(descriptor));
  assert.equal(
    record.destinations.length,
    1,
    "Expected exactly one imported destination",
  );
  record.imported = structuredClone(
    await service.readImported(descriptor, record.destinations[0]),
  );
  assertImported(source, record.imported);
  return {
    source,
    native,
    imported: record.imported,
    absentBeforeImport: true,
    importEvidence: structuredClone(record.cli),
    nativeValidationEvidence: {
      originalIdentity: structuredClone(native.identity),
      completeCheckpoint: true,
    },
  };
}

/** Bind this to a concrete source fixture with a fresh namespace for each row.
 * Sources supplied by the factory must already belong to that namespace; IDs
 * are never renamed after creation to hide reuse of a connected native session.
 */
export async function prepareImportedSources({
  service,
  namespace,
  answerPending = false,
  writeArtifact,
}) {
  assert.equal(
    answerPending,
    false,
    "Source preparation must not answer controls",
  );
  assert.match(namespace, /^[a-zA-Z0-9_-]+$/);
  assert.equal(typeof writeArtifact, "function", "Artifact writer required");
  const sources = structuredClone(await service.sources({ namespace }));
  assert.ok(sources.length, "Native source set is empty");
  assert.equal(
    new Set(sources.map((source) => source.nativeIdentity.threadId)).size,
    sources.length,
    "Reused native source identity",
  );
  const prepared = [];
  for (const source of sources) {
    assert.ok(
      source.id === namespace || source.id.startsWith(`${namespace}-`),
      "Source factory did not allocate the requested namespace",
    );
    const record = {};
    const artifact = `${source.id}-prepared-import.json`;
    try {
      const result = await prepareImport(service, source, record);
      prepared.push({ ...result, evidence: [artifact] });
    } catch (error) {
      record.error = { message: error.message, code: error.code };
      throw error;
    } finally {
      await writeArtifact(artifact, record);
    }
  }
  return prepared;
}
