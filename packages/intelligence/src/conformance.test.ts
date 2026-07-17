import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  buildLearningPlatformConformanceCorpus,
  learningPlatformConformanceSchemas,
  serializeLearningPlatformConformanceCorpus,
} from "./conformance.js";

const corpusPath = fileURLToPath(
  new URL("../conformance/learning-platform-v1.json", import.meta.url),
);
const packageJsonPath = fileURLToPath(
  new URL("../package.json", import.meta.url),
);
const registrySdkGoldenPath = fileURLToPath(
  new URL("../conformance/registry-sdk-v1.json", import.meta.url),
);

const commandSchemaNames = [
  "CommitLearningRunResultV1",
  "CreateRegistryRevisionV1",
  "EvaluateCandidateGatesV1",
  "PrepareLearningRunV1",
  "PrepareRegistryCandidateV1",
  "PublishCandidateV1",
  "RequestThreadSnapshotBackfillV1",
  "StartLearningContainerRunV1",
] as const;

const dtoSchemaNames = [
  "BlobLocatorV1",
  "CandidateGateResultV1",
  "EvidenceLocatorV1",
  "EvidenceRefV1",
  "FrozenAvailableSkillV1",
  "GeneratedInsightV1",
  "GeneratedSkillCandidateV1",
  "InsightAnnotationV1",
  "InsightArchiveEventV1",
  "InsightFeedbackV1",
  "InsightV1",
  "LearningChunkV1",
  "LearningContainerV1",
  "LearningRunV1",
  "LearningWorkflowInputV1",
  "LearningWorkflowOutputV1",
  "NormalizedMessageV1",
  "NormalizedToolCallV1",
  "NormalizedToolResultV1",
  "RunSnapshotV1",
  "SelectedHumanAnnotationV1",
  "SkillArtifactFileV1",
  "SkillArtifactManifestV1",
  "SkillBundleV1",
  "SkillCandidateV1",
  "SkillSetProjectionEntryV1",
  "SkillSetProjectionV1",
  "SnapshotIdentityV1",
  "SourceEventManifestEntryV1",
  "ThreadAssignmentPatchV1",
  "ThreadAssignmentV1",
  "WorkflowThreadV1",
] as const;

describe("Learning Platform V1 language-neutral conformance corpus", () => {
  test("publishes every canonical DTO, all command envelopes, and the stable error envelope", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const expectedNames = [
      ...dtoSchemaNames,
      ...commandSchemaNames,
      "LearningPlatformErrorResponseV1",
    ].sort();

    expect(corpus.schemaVersion).toBe(1);
    expect(Object.keys(corpus.schemas).sort()).toEqual(expectedNames);
    expect(Object.keys(learningPlatformConformanceSchemas).sort()).toEqual(
      expectedNames,
    );

    for (const schemaName of expectedNames) {
      expect(
        corpus.cases.some(
          (entry) => entry.schema === schemaName && entry.valid,
        ),
        `${schemaName} needs a valid case`,
      ).toBe(true);
      expect(
        corpus.cases.some(
          (entry) => entry.schema === schemaName && !entry.valid,
        ),
        `${schemaName} needs an invalid case`,
      ).toBe(true);
    }
  });

  test("checks every named case against its canonical Zod schema", () => {
    const corpus = buildLearningPlatformConformanceCorpus();

    for (const entry of corpus.cases) {
      const result = learningPlatformConformanceSchemas[entry.schema].safeParse(
        entry.value,
      );
      expect(result.success, entry.name).toBe(entry.valid);
    }
  });

  test("covers cross-language assignment, identity, removal, command, and error semantics", () => {
    const names = buildLearningPlatformConformanceCorpus().cases.map(
      ({ name }) => name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "thread-assignment-null-is-explicit",
        "thread-assignment-missing-is-not-defaulted",
        "unknown-fields-are-forward-compatible",
        "invalid-uuid",
        "invalid-sha256",
        "invalid-assignment-revision",
        "remove-candidate-requires-removal-intent",
        "remove-candidate-forbids-bundle",
        ...commandSchemaNames.map((name) => `command-${name}-valid`),
        "stable-error-valid",
        "stable-error-unknown-code",
      ]),
    );
  });

  test("matches the committed stable-key-ordered JSON bytes", () => {
    const first = serializeLearningPlatformConformanceCorpus();
    const second = serializeLearningPlatformConformanceCorpus();

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(readFileSync(corpusPath, "utf8")).toBe(first);
  });

  test("publishes the corpus through a stable package subpath", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      exports: Record<string, unknown>;
      files: string[];
    };

    expect(packageJson.files).toContain("conformance");
    expect(packageJson.exports).toHaveProperty(
      "./conformance/learning-platform-v1.json",
      "./conformance/learning-platform-v1.json",
    );
    expect(packageJson.exports).toHaveProperty(
      "./conformance/registry-sdk-v1.json",
      "./conformance/registry-sdk-v1.json",
    );
  });

  test("keeps the registry SDK golden success and errors canonical", () => {
    const golden = JSON.parse(readFileSync(registrySdkGoldenPath, "utf8")) as {
      schemaVersion: number;
      sourceCorpus: string;
      projection: unknown;
      errors: Record<string, { body: unknown }>;
    };

    expect(golden.schemaVersion).toBe(1);
    expect(golden.sourceCorpus).toBe("learning-platform-v1.json");
    expect(
      learningPlatformConformanceSchemas.SkillSetProjectionV1.safeParse(
        golden.projection,
      ).success,
    ).toBe(true);
    expect(
      learningPlatformConformanceSchemas.LearningPlatformErrorResponseV1.safeParse(
        golden.errors.canonicalConflict?.body,
      ).success,
    ).toBe(true);
    expect(
      learningPlatformConformanceSchemas.LearningPlatformErrorResponseV1.safeParse(
        golden.errors.canonicalDenial?.body,
      ).success,
    ).toBe(true);
    expect(
      learningPlatformConformanceSchemas.LearningPlatformErrorResponseV1.safeParse(
        golden.errors.unknownCode?.body,
      ).success,
    ).toBe(false);
  });
});
