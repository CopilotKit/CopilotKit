import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runImporter } from "./command.mjs";

/** Run the built CLI unchanged, then read authoritative per-source database outcomes. */
export function createBuiltImporter({
  pool,
  scope,
  cli,
  framework,
  sources,
  importEnv,
  agentMap,
  outputDir,
  signal,
}) {
  assert(
    cli && scope.credentials.apiKey && sources.length,
    "Built CLI and owned source configuration required",
  );
  assert(
    scope.organizationId && Number.isInteger(scope.projectId),
    "Explicit tenant/project required",
  );
  let attempt = 0;
  return async () => {
    signal?.throwIfAborted();
    attempt += 1;
    const step = `row6-import-${attempt}`;
    const mappingPath = join(outputDir, "row6-agent-map.json");
    await writeFile(mappingPath, JSON.stringify(agentMap), { mode: 0o600 });
    const buildIdentity = createHash("sha256")
      .update(await readFile(cli))
      .digest("hex");
    const args = [
      cli,
      "import",
      "--source",
      framework,
      "--api-url",
      scope.apiUrl,
      "--agent-map",
      mappingPath,
      "--yes",
    ];
    const before = (
      await pool.query(
        "SELECT COALESCE(MAX(id),0) AS id FROM cpki.thread_imports WHERE organization_id=$1 AND project_id=$2",
        [scope.organizationId, scope.projectId],
      )
    ).rows[0].id;
    let commandError;
    const record = {
      attempt,
      buildIdentity,
      command: [process.execPath, ...args],
      log: `${step}.log`,
    };
    try {
      try {
        await runImporter(process.execPath, args, {
          log: join(outputDir, `${step}.log`),
          signal,
          secrets: [
            scope.credentials.apiKey,
            scope.databaseUrl,
            ...Object.values(importEnv),
          ],
          env: {
            ...process.env,
            ...importEnv,
            CPK_INTELLIGENCE_API_KEY: scope.credentials.apiKey,
          },
          timeoutMs: 120_000,
        });
      } catch (error) {
        // CLI exits nonzero for a mixed store's expected connected-ID collision.
        // Only that concrete per-item outcome can explain an exit 1 below.
        commandError = error;
      }
      signal?.throwIfAborted();
      const batches = (
        await pool.query(
          "SELECT * FROM cpki.thread_imports WHERE organization_id=$1 AND project_id=$2 AND id>$3 ORDER BY id",
          [scope.organizationId, scope.projectId, before],
        )
      ).rows;
      record.batches = batches;
      record.commandError = commandError?.message;
      let results;
      assert.equal(
        batches.length,
        1,
        "Expected exactly one new import batch; absent or concurrent importer detected",
      );
      assert.equal(batches[0].source, framework, "Unexpected importer source");
      assert(
        ["completed", "partial"].includes(batches[0].status),
        "Import batch did not finish",
      );
      const items = (
        await pool.query(
          "SELECT * FROM cpki.thread_import_items WHERE organization_id=$1 AND project_id=$2 AND import_batch_id=$3 ORDER BY id",
          [scope.organizationId, scope.projectId, batches[0].id],
        )
      ).rows;
      record.items = items;
      assert.equal(
        items.length,
        sources.length,
        "Importer omitted or added sources",
      );
      const destinations = (
        await pool.query(
          "SELECT * FROM cpki.threads WHERE organization_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY id",
          [scope.organizationId, scope.projectId],
        )
      ).rows;
      results = items.map((item) => {
        const source = sources.find(
          (entry) => entry.importSourceId === item.source_thread_id,
        );
        assert(source, `Unexpected imported source: ${item.source_thread_id}`);
        const conflict =
          item.outcome === "failed" &&
          /^IMPORT_NATIVE_ID_CONFLICT(?:$|:)/.test(item.reason ?? "");
        assert(
          !conflict || source.role === "connected-collision",
          "Selected native-only source collided with existing history",
        );
        const destination = destinations.find(
          (thread) =>
            thread.import_metadata?.source_thread_id === item.source_thread_id,
        );
        return {
          sourceId: item.source_thread_id,
          status: conflict ? "conflict" : item.outcome,
          reason: conflict ? "IMPORT_NATIVE_ID_CONFLICT" : item.reason,
          destinationId: destination?.thread_id,
          raw: item,
        };
      });
      if (commandError) {
        assert(
          commandError.exitCode === 1 &&
            results.some((item) => item.status === "conflict") &&
            results.every((item) =>
              ["imported", "skipped", "conflict"].includes(item.status),
            ),
          commandError.message,
        );
      }
      // Identity includes the executable and stable invocation, not attempt/batch IDs.
      return {
        pathIdentity: JSON.stringify({
          buildIdentity,
          command: [process.execPath, ...args],
        }),
        results,
        evidence: [`${step}.log`, `${step}-receipt.json`],
      };
    } catch (error) {
      record.failure = { name: error.name, message: error.message };
      throw error;
    } finally {
      await writeFile(
        join(outputDir, `${step}-receipt.json`),
        JSON.stringify(record, null, 2),
        { mode: 0o600 },
      );
    }
  };
}
