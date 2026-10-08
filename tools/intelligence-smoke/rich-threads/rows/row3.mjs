import assert from "node:assert/strict";
import {
  categories,
  validateSource,
  assertImported,
  assertReplay,
  assertAnswered,
} from "../import/assertions.mjs";

export const row = {
  id: 3,
  title: "Import and replay native-only rich conversations",
  async run(context) {
    const service = context.services.importReplay;
    if (!service)
      return {
        status: "blocked",
        checks: [],
        limitations: ["No native import/replay fixture configured"],
      };
    const sources = await service.sources();
    assert.ok(sources.length, "At least one native-only source is required");
    assert.equal(
      new Set(sources.map((s) => s.id)).size,
      sources.length,
      "Duplicate source IDs",
    );
    const checks = [];
    const limitations = [];
    const covered = new Set();
    for (const source of sources) {
      const evidence = `${source.id}-import-replay.json`;
      const record = {
        source,
        baseline: context.baseline,
        framework: context.framework,
      };
      try {
        record.native = await service.inspectNative(source);
        validateSource(source, record.native);
        record.before = await service.findImported(source);
        assert.deepEqual(
          record.before,
          [],
          "Source already exists in Intelligence before import",
        );
        record.cli = await service.importSource(source);
        assert.equal(record.cli.exitCode, 0, "Built import CLI failed");
        assert.equal(record.cli.dryRun, false, "Dry run is not an import");
        assert.ok(
          record.cli.buildIdentity && record.cli.command && record.cli.log,
          "Retain built CLI identity/command/log",
        );
        record.destinations = await service.findImported(source);
        assert.equal(
          record.destinations.length,
          1,
          "Expected exactly one imported destination",
        );
        record.imported = await service.readImported(
          source,
          record.destinations[0],
        );
        assertImported(source, record.imported);
        record.replay = await service.replay(source, record.imported);
        assertReplay(source, record.imported, record.replay);
        record.answers = [];
        // Sources with multiple pending interactions need explicit serial expectations.
        assert.ok(
          source.expected.pending.length <= 1,
          "Use separate source histories for independent pending controls",
        );
        for (const pending of source.expected.pending) {
          const answered = await service.answer(
            source,
            record.imported,
            pending,
          );
          record.answers.push(answered);
          assertAnswered(source, record.imported, pending, answered);
        }
        for (const category of source.coverage) {
          assert.ok(
            categories.includes(category),
            `Unknown category ${category}`,
          );
          covered.add(category);
        }
        checks.push({
          name: source.id,
          status: "passed",
          evidence: [evidence],
          detail:
            "Native source, CLI import, replay and applicable responses matched",
        });
      } catch (error) {
        record.error = error.message;
        throw error;
      } finally {
        await context.writeArtifact(evidence, record);
      }
    }
    for (const category of categories) {
      if (covered.has(category)) continue;
      const limitation = context.fixture.importLimitations?.[category];
      if (
        limitation?.kind === "source-limitation" &&
        limitation.detail &&
        limitation.evidence?.length
      ) {
        checks.push({
          name: category,
          status: "not-applicable",
          detail: limitation.detail,
          evidence: limitation.evidence,
        });
        limitations.push(`${category}: ${limitation.detail}`);
      } else {
        checks.push({
          name: category,
          status: "unvalidated",
          detail: "Applicable category not exercised",
          evidence: [],
        });
      }
    }
    return {
      status: checks.some((c) => c.status === "unvalidated")
        ? "unvalidated"
        : "passed",
      checks,
      limitations,
    };
  },
};
