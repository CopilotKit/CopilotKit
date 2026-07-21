import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  buildLearningPlatformConformanceCorpus,
  learningPlatformConformanceSchemas,
  serializeLearningPlatformConformanceCorpus,
} from "./conformance.js";
import type { LearningPlatformConformanceSchemaName } from "./conformance.js";
import {
  COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI,
  COPILOTKIT_CANDIDATE_SEMANTICS_VOCABULARY_URI,
  COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
} from "./contracts.js";
import type { JsonObject } from "./contracts.js";
import { LEARNING_PLATFORM_ERROR_CODES } from "./errors.js";
import { learningContractJsonSchemas } from "./schema-registry.js";
import type { LearningContractJsonSchemaValidateFunction } from "./portable-validator.js";
import {
  compileLearningContractJsonSchema,
  registerLearningContractJsonSchemaValidator,
} from "./portable-validator.js";

const corpusPath = fileURLToPath(
  new URL("../conformance/learning-platform-v1.json", import.meta.url),
);
const packageJsonPath = fileURLToPath(
  new URL("../package.json", import.meta.url),
);
const installedZodPackageJsonPath = fileURLToPath(
  new URL("../node_modules/zod/package.json", import.meta.url),
);
const registrySdkGoldenPath = fileURLToPath(
  new URL("../conformance/registry-sdk-v1.json", import.meta.url),
);

const commandSchemaNames = [
  "AppendLearningRunChunkV1",
  "CommitLearningRunResultV1",
  "CreateLearningRunV1",
  "CreateRegistryRevisionV1",
  "EvaluateCandidateGatesV1",
  "PrepareLearningRunV1",
  "PrepareRegistryCandidateV1",
  "PublishCandidateV1",
  "RequestThreadSnapshotBackfillV1",
  "StartLearningContainerRunV1",
] as const;

const candidateActionCaseNames = new Set([
  "generated-add-candidate-forbids-skill-id",
  "generated-add-candidate-forbids-parent-version-id",
  "generated-remove-candidate-requires-non-empty-removal-intent",
  "remove-candidate-requires-removal-intent",
  "remove-candidate-forbids-bundle",
  "add-candidate-forbids-removal-intent",
  "add-candidate-forbids-removal-intent-sha256",
  "update-candidate-forbids-removal-intent",
  "update-candidate-forbids-removal-intent-sha256",
]);

const candidateSubjectHashCaseNames = new Set([
  "add-candidate-rejects-subject-hash-mismatch",
  "update-candidate-rejects-subject-hash-mismatch",
  "remove-candidate-rejects-subject-hash-mismatch",
]);

function createPortableSchemaValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
  return registerLearningContractJsonSchemaValidator(ajv);
}

function containsPortableSemanticKeyword(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsPortableSemanticKeyword);
  }
  if (value === null || typeof value !== "object") return false;
  if (
    Object.hasOwn(value, COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD) ||
    Object.hasOwn(value, COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD)
  ) {
    return true;
  }
  return Object.values(value).some(containsPortableSemanticKeyword);
}

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
  "LearningRunExecutionResultV1",
  "LearningRunJobV1",
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

  test("checks every named case against the supported portable validator", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const ajv = createPortableSchemaValidator();
    const validators = new Map<
      LearningPlatformConformanceSchemaName,
      LearningContractJsonSchemaValidateFunction
    >();
    const mismatches: string[] = [];

    for (const entry of corpus.cases) {
      const validate =
        validators.get(entry.schema) ??
        compileLearningContractJsonSchema(
          ajv,
          corpus.schemas[entry.schema] as JsonObject,
        );
      validators.set(entry.schema, validate);
      const canonicalResult = learningPlatformConformanceSchemas[
        entry.schema
      ].safeParse(entry.value).success;
      const portableResult = validate(entry.value) === true;
      if (
        portableResult !== canonicalResult ||
        canonicalResult !== entry.valid
      ) {
        mismatches.push(
          `${entry.name}: portable=${portableResult} canonical=${canonicalResult} expected=${entry.valid}`,
        );
      }
    }

    expect(mismatches, `mismatchCount: ${mismatches.length}`).toEqual([]);
  });

  test("keeps exported and corpus JSON Schemas identical", () => {
    const corpus = buildLearningPlatformConformanceCorpus();

    expect(Object.keys(learningContractJsonSchemas).sort()).toEqual(
      Object.keys(corpus.schemas).sort(),
    );
    for (const [name, schema] of Object.entries(learningContractJsonSchemas)) {
      expect(
        corpus.schemas[name as LearningPlatformConformanceSchemaName],
      ).toEqual(schema);
    }
  });

  test("declares the custom capability only for schemas that use portable semantic keywords", () => {
    const corpus = buildLearningPlatformConformanceCorpus();

    for (const [name, schema] of Object.entries(corpus.schemas)) {
      const expectedMetaSchema = containsPortableSemanticKeyword(schema)
        ? COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI
        : "https://json-schema.org/draft/2020-12/schema";
      expect((schema as { $schema?: string }).$schema, name).toBe(
        expectedMetaSchema,
      );
    }
  });

  test("enforces candidate action invariants through emitted JSON Schema", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const ajv = createPortableSchemaValidator();
    const validators = new Map<
      LearningPlatformConformanceSchemaName,
      LearningContractJsonSchemaValidateFunction
    >();
    const actionCases = corpus.cases.filter(({ name }) =>
      candidateActionCaseNames.has(name),
    );

    expect(actionCases).toHaveLength(candidateActionCaseNames.size);
    for (const entry of actionCases) {
      const validate =
        validators.get(entry.schema) ??
        compileLearningContractJsonSchema(
          ajv,
          corpus.schemas[entry.schema] as JsonObject,
        );
      validators.set(entry.schema, validate);

      expect(
        validate(entry.value),
        `${entry.name}: ${JSON.stringify(validate.errors)}`,
      ).toBe(entry.valid);
    }
  });

  test("enforces candidate subject-hash equality through emitted JSON Schema semantics", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const ajv = createPortableSchemaValidator();
    const validate = compileLearningContractJsonSchema(
      ajv,
      corpus.schemas.SkillCandidateV1 as JsonObject,
    );
    const mismatchCases = corpus.cases.filter(({ name }) =>
      candidateSubjectHashCaseNames.has(name),
    );

    expect(mismatchCases).toHaveLength(candidateSubjectHashCaseNames.size);
    for (const entry of mismatchCases) {
      expect(
        validate(entry.value),
        `${entry.name}: ${JSON.stringify(validate.errors)}`,
      ).toBe(entry.valid);
    }
  });

  test("gates permissive validation on the required portable capability", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const schema = corpus.schemas.SkillCandidateV1 as object & {
      $schema?: string;
    };
    const metaSchema = corpus.metaSchemas[
      COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI
    ] as { $vocabulary?: Record<string, boolean> };

    expect(schema.$schema).toBe(COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI);
    expect(
      metaSchema.$vocabulary?.[COPILOTKIT_CANDIDATE_SEMANTICS_VOCABULARY_URI],
    ).toBe(true);
    expect(() =>
      new Ajv2020({ validateFormats: false }).compile(schema),
    ).toThrow(
      `no schema with key or ref "${COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI}"`,
    );

    const unsupportedVocabulary = new Ajv2020({ validateFormats: false });
    unsupportedVocabulary.addMetaSchema(metaSchema);
    expect(() => unsupportedVocabulary.compile(schema)).toThrow(
      `strict mode: unknown keyword: "${COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD}"`,
    );

    const permissiveVocabulary = new Ajv2020({
      strict: false,
      validateFormats: false,
    });
    permissiveVocabulary.addMetaSchema(metaSchema);
    const permissiveValidate = permissiveVocabulary.compile(schema);
    const mismatchCase = corpus.cases.find(
      ({ name }) => name === "add-candidate-rejects-subject-hash-mismatch",
    );

    expect(mismatchCase).toBeDefined();
    expect(permissiveValidate(mismatchCase?.value)).toBe(true);
    expect(() =>
      compileLearningContractJsonSchema(permissiveVocabulary, schema),
    ).toThrowError(/LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING/);
  });

  test("publishes null as the canonical frozen available skill description", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const frozenSkillCase = corpus.cases.find(
      ({ name }) => name === "schema-FrozenAvailableSkillV1-valid",
    );

    expect(frozenSkillCase?.value).toMatchObject({ description: null });
    expect(
      learningPlatformConformanceSchemas.FrozenAvailableSkillV1.safeParse(
        frozenSkillCase?.value,
      ).success,
    ).toBe(true);
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
        "invalid-nil-uuid",
        "invalid-sha256",
        "invalid-assignment-revision",
        "learning-run-rejects-inverted-selection-interval",
        "learning-run-rejects-snapshot-outside-selection-interval",
        "learning-run-rejects-duplicate-snapshot-identities",
        "learning-run-rejects-unordered-snapshot-identities",
        "learning-chunk-rejects-inverted-snapshot-range",
        "workflow-input-rejects-duplicate-thread-ids",
        "workflow-input-rejects-duplicate-snapshot-ids",
        "workflow-input-rejects-duplicate-skill-aliases",
        "workflow-input-rejects-annotation-outside-frozen-input",
        "workflow-input-rejects-annotation-message-outside-target-snapshot",
        "workflow-input-rejects-annotation-event-outside-target-snapshot",
        "workflow-output-rejects-duplicate-insight-aliases",
        "workflow-output-rejects-duplicate-candidate-aliases",
        "workflow-output-rejects-dangling-insight-aliases",
        "artifact-manifest-accepts-safe-nfc-distinct-paths",
        "artifact-manifest-rejects-traversal-path",
        "artifact-manifest-rejects-absolute-path",
        "artifact-manifest-rejects-backslash-path",
        "artifact-manifest-rejects-case-path-collision",
        "artifact-manifest-rejects-nfc-path-collision",
        "artifact-manifest-rejects-missing-skill-md",
        "artifact-manifest-rejects-root-prefixed-skill-md",
        "skill-bundle-rejects-locator-hash-mismatch",
        "skill-bundle-rejects-locator-length-mismatch",
        "projection-entry-rejects-missing-manifest",
        "projection-entry-rejects-locator-hash-mismatch",
        "projection-entry-rejects-locator-length-mismatch",
        "projection-entry-rejects-manifest-bundle-hash-mismatch",
        "projection-entry-rejects-manifest-hash-mismatch",
        "projection-entry-rejects-manifest-length-mismatch",
        "projection-revoked-rejects-entries",
        "projection-rejects-position-above-cache-bound",
        "projection-rejects-unsafe-integer-position",
        "projection-rejects-duplicate-positions",
        "projection-rejects-position-gaps",
        "projection-rejects-out-of-order-positions",
        "projection-rejects-duplicate-skill-ids",
        "generated-add-candidate-forbids-skill-id",
        "generated-add-candidate-forbids-parent-version-id",
        "generated-remove-candidate-requires-non-empty-removal-intent",
        "generated-bundle-accepts-safe-relative-paths",
        "generated-bundle-rejects-invalid-root",
        "generated-bundle-rejects-traversal-path",
        "generated-bundle-rejects-absolute-path",
        "generated-bundle-rejects-backslash-path",
        "generated-bundle-rejects-normalized-path-collision",
        "generated-bundle-rejects-missing-skill-md",
        "generated-bundle-rejects-root-prefixed-skill-md",
        "generated-bundle-rejects-empty-file-content",
        "generated-bundle-rejects-base64-missing-padding",
        "generated-bundle-rejects-base64-malformed-padding",
        "generated-bundle-rejects-base64-excess-padding",
        "generated-bundle-rejects-base64-interior-padding",
        "generated-bundle-rejects-base64-url-safe-alphabet",
        "generated-bundle-rejects-base64-whitespace",
        "generated-bundle-rejects-base64-invalid-alphabet",
        "generated-bundle-rejects-base64-non-zero-one-byte-pad-bits",
        "generated-bundle-rejects-base64-non-zero-two-byte-pad-bits",
        "create-learning-run-rejects-inverted-selection-interval",
        "learning-run-job-rejects-negative-fence-generation",
        "learning-run-execution-result-rejects-invalid-output-hash",
        "learning-run-execution-result-accepts-multiple-chunks",
        "learning-run-execution-result-rejects-mixed-run-and-attempt-ids",
        "append-learning-run-chunk-rejects-mismatched-chunk-identity",
        "remove-candidate-requires-removal-intent",
        "remove-candidate-forbids-bundle",
        "add-candidate-forbids-removal-intent",
        "add-candidate-forbids-removal-intent-sha256",
        "update-candidate-forbids-removal-intent",
        "update-candidate-forbids-removal-intent-sha256",
        "add-candidate-rejects-subject-hash-mismatch",
        "update-candidate-rejects-subject-hash-mismatch",
        "remove-candidate-rejects-subject-hash-mismatch",
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

  test("uses the exact published Zod version that generated the committed schemas", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies: { zod: string };
    };
    const installedZodPackageJson = JSON.parse(
      readFileSync(installedZodPackageJsonPath, "utf8"),
    ) as { version: string };

    expect(packageJson.dependencies.zod).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(installedZodPackageJson.version).toBe(packageJson.dependencies.zod);
  });

  test("publishes every stable producer error code in the error-envelope schema", () => {
    const corpus = buildLearningPlatformConformanceCorpus();
    const errorSchema = corpus.schemas.LearningPlatformErrorResponseV1 as {
      properties: { error: { properties: { code: { enum: string[] } } } };
    };

    expect(errorSchema.properties.error.properties.code.enum).toEqual(
      LEARNING_PLATFORM_ERROR_CODES,
    );
    expect(errorSchema.properties.error.properties.code.enum).toContain(
      "LEARNING_RUN_NOT_FOUND",
    );
    expect(errorSchema.properties.error.properties.code.enum).toContain(
      "LEARNING_CANDIDATE_REVISION_CONFLICT",
    );
    expect(errorSchema.properties.error.properties.code.enum).toContain(
      "LEARNING_BLOB_INTEGRITY_MISMATCH",
    );
    expect(errorSchema.properties.error.properties.code.enum).not.toContain(
      "LEARNING_CANDIDATE_STALE_PARENT",
    );
  });

  test("isolates returned cases from later builds and canonical serialization", () => {
    const canonicalSerialization = serializeLearningPlatformConformanceCorpus();
    const first = buildLearningPlatformConformanceCorpus();
    const mutableCase = first.cases.find(
      ({ name }) => name === "schema-NormalizedMessageV1-valid",
    );

    if (!mutableCase) {
      throw new Error("Expected canonical NormalizedMessageV1 case");
    }

    const mutableValue = mutableCase.value as {
      toolCalls: Array<{ name: string }>;
    };
    mutableValue.toolCalls[0]!.name = "mutated-search";

    const second = buildLearningPlatformConformanceCorpus();
    const rebuiltCase = second.cases.find(
      ({ name }) => name === "schema-NormalizedMessageV1-valid",
    );

    expect(rebuiltCase?.value).toMatchObject({
      toolCalls: [{ name: "search" }],
    });
    expect(serializeLearningPlatformConformanceCorpus()).toBe(
      canonicalSerialization,
    );
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
    const goldenEntry = (
      golden.projection as {
        entries: Array<{
          manifest: unknown;
          bundleLocator: unknown;
        }>;
      }
    ).entries[0]!;
    expect(
      learningPlatformConformanceSchemas.SkillBundleV1.safeParse({
        schemaVersion: 1,
        manifest: goldenEntry.manifest,
        locator: goldenEntry.bundleLocator,
      }).success,
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

  test("keeps canonical bundle fixtures bound to one hash and length", () => {
    const cases = buildLearningPlatformConformanceCorpus().cases;
    const bundle = cases.find(
      ({ name }) => name === "schema-SkillBundleV1-valid",
    )?.value as {
      manifest: { bundleSha256: string; bundleByteLength: number };
      locator: { applicationSha256: string; byteLength: number };
    };
    const entry = cases.find(
      ({ name }) => name === "schema-SkillSetProjectionEntryV1-valid",
    )?.value as {
      bundleSha256: string;
      bundleByteLength: number;
      manifest: {
        bundleSha256: string;
        manifestSha256: string;
        bundleByteLength: number;
      };
      manifestSha256: string;
      bundleLocator: { applicationSha256: string; byteLength: number };
    };

    expect(bundle.manifest.bundleSha256).toBe(bundle.locator.applicationSha256);
    expect(bundle.manifest.bundleByteLength).toBe(bundle.locator.byteLength);
    expect(entry.bundleSha256).toBe(entry.bundleLocator.applicationSha256);
    expect(entry.bundleByteLength).toBe(entry.bundleLocator.byteLength);
    expect(entry.manifest.bundleSha256).toBe(entry.bundleSha256);
    expect(entry.manifest.manifestSha256).toBe(entry.manifestSha256);
    expect(entry.manifest.bundleByteLength).toBe(entry.bundleByteLength);
  });
});
