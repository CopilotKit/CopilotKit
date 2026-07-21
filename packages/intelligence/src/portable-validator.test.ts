import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1,
  assertLearningContractJsonSchemaValidatorCapabilities,
  compileLearningContractJsonSchema,
  createLearningContractJsonSchemaValidator,
  learningContractSemanticsMetaSchema,
  registerLearningContractJsonSchemaValidator,
} from "./index.js";

const equalPropertiesSchema = {
  $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  type: "object",
  properties: {
    expected: { type: "string" },
    actual: { type: "string" },
  },
  required: ["expected", "actual"],
  [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD]: [["expected", "actual"]],
} as const;

describe("Learning Contract portable validator capability", () => {
  test("registers the complete versioned capability and enforces equality", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);

    expect(LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1).toMatchObject({
      id: expect.any(String),
      version: 1,
      metaSchemaUri: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
      keywords: [
        COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
        COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
      ],
    });
    expect(() =>
      assertLearningContractJsonSchemaValidatorCapabilities(ajv),
    ).not.toThrow();

    const validate = compileLearningContractJsonSchema(
      ajv,
      equalPropertiesSchema,
    );
    expect(validate({ expected: "a", actual: "a" })).toBe(true);
    expect(validate({ expected: "a", actual: "b" })).toBe(false);
  });

  test("exposes a one-step supported compile facade", () => {
    const validator = createLearningContractJsonSchemaValidator(
      new Ajv2020({ strict: false, validateFormats: false }),
    );
    const validate = validator.compile(equalPropertiesSchema);

    expect(validate({ expected: "a", actual: "b" })).toBe(false);
  });

  test("rejects a missing meta-schema independently of keyword support", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addKeyword({
      keyword: COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
      validate: () => true,
    });
    ajv.addKeyword({
      keyword: COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
      validate: () => true,
    });

    expect(() =>
      assertLearningContractJsonSchemaValidatorCapabilities(ajv),
    ).toThrowError(
      /LEARNING_CONTRACT_VALIDATOR_META_SCHEMA_MISSING.*learning-platform\/v1\/candidate-semantics/,
    );
  });

  test("rejects a missing keyword capability even when the meta-schema is installed", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addMetaSchema(learningContractSemanticsMetaSchema);
    ajv.addKeyword({
      keyword: COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
      validate: () => true,
    });

    expect(() =>
      assertLearningContractJsonSchemaValidatorCapabilities(ajv),
    ).toThrowError(
      new RegExp(
        `LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*${COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD}`,
      ),
    );
  });

  test("rejects foreign keyword implementations that only imitate the capability names", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addKeyword({
      keyword: COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
      validate: () => true,
    });
    ajv.addKeyword({
      keyword: COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
      validate: () => true,
    });
    ajv.addMetaSchema(learningContractSemanticsMetaSchema);

    expect(() =>
      assertLearningContractJsonSchemaValidatorCapabilities(ajv),
    ).toThrowError(/package-owned V1 registration/);
  });

  test("reproduces permissive Ajv silently ignoring the required equality keyword outside the supported path", () => {
    const permissiveAjv = new Ajv2020({
      strict: false,
      validateFormats: false,
    });
    permissiveAjv.addMetaSchema(learningContractSemanticsMetaSchema);
    const validate = permissiveAjv.compile(equalPropertiesSchema);

    expect(validate({ expected: "a", actual: "b" })).toBe(true);
    expect(() =>
      compileLearningContractJsonSchema(permissiveAjv, equalPropertiesSchema),
    ).toThrowError(/LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING/);
  });
});

describe(`${COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD} bounded assertions`, () => {
  const assertionsSchema = {
    $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
    type: "object",
    properties: {
      after: { type: "integer" },
      through: { type: "integer" },
      ids: { type: "array", items: { type: "string" } },
      positions: { type: "array", items: { type: "integer" } },
      refs: { type: "array", items: { type: "string" } },
      revoked: { type: "array", items: { type: "string" } },
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            first: { type: "integer" },
            last: { type: "integer" },
          },
          required: ["first", "last"],
        },
      },
      terminalId: { type: "string" },
      terminalType: { type: "string" },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string" },
          },
          required: ["id", "type"],
        },
      },
    },
    required: [
      "after",
      "through",
      "ids",
      "positions",
      "refs",
      "revoked",
      "entries",
      "terminalId",
      "terminalType",
      "events",
    ],
    [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
      {
        operation: "compare",
        left: "/after",
        relation: "less-than-or-equal",
        right: "/through",
        valueType: "number",
      },
      {
        operation: "unique",
        values: "/ids/*",
        normalization: { caseFold: true },
      },
      {
        operation: "strictly-increasing",
        values: "/positions/*",
        valueType: "number",
      },
      {
        operation: "contiguous",
        values: "/positions/*",
        start: 0,
      },
      {
        operation: "references",
        values: "/refs/*",
        targets: "/ids/*",
        normalization: { caseFold: true },
      },
      {
        operation: "disjoint",
        left: "/ids/*",
        right: "/revoked/*",
        normalization: { caseFold: true },
      },
      {
        operation: "ordered-ranges",
        ranges: "/entries/*",
        first: "/first",
        last: "/last",
        valueType: "number",
      },
      {
        operation: "lookup-equal",
        collection: "/events/*",
        key: "/id",
        reference: "/terminalId",
        value: "/type",
        expected: "/terminalType",
      },
      {
        operation: "count",
        values: "/events/*/type",
        where: { in: ["RUN_FINISHED", "RUN_ERROR"] },
        maximum: 1,
      },
    ],
  } as const;

  const validValue = {
    after: 0,
    through: 2,
    ids: ["A", "B"],
    positions: [0, 1],
    refs: ["a"],
    revoked: ["C"],
    entries: [
      { first: 1, last: 1 },
      { first: 2, last: 3 },
    ],
    terminalId: "event-1",
    terminalType: "RUN_FINISHED",
    events: [{ id: "event-1", type: "RUN_FINISHED" }],
  } as const;

  test("enforces reusable cross-property and cross-array operations", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validate = compileLearningContractJsonSchema(ajv, assertionsSchema);

    expect(validate(validValue)).toBe(true);
    expect(validate({ ...validValue, after: 3 })).toBe(false);
    expect(validate({ ...validValue, ids: ["A", "a"] })).toBe(false);
    expect(validate({ ...validValue, positions: [0, 2] })).toBe(false);
    expect(validate({ ...validValue, refs: ["missing"] })).toBe(false);
    expect(validate({ ...validValue, revoked: ["a"] })).toBe(false);
    expect(
      validate({
        ...validValue,
        entries: [
          { first: 2, last: 3 },
          { first: 3, last: 4 },
        ],
      }),
    ).toBe(false);
    expect(validate({ ...validValue, terminalType: "RUN_ERROR" })).toBe(false);
    expect(
      validate({
        ...validValue,
        events: [
          { id: "event-1", type: "RUN_FINISHED" },
          { id: "event-2", type: "RUN_ERROR" },
        ],
      }),
    ).toBe(false);
  });

  test("supports selection ranges, exact counts, and Unicode-normalized identity", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const schema = {
      $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
      type: "object",
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "values-in-range",
          values: "/values/*",
          minimum: "/minimum",
          maximum: "/maximum",
          minimumExclusive: true,
          valueType: "number",
        },
        {
          operation: "unique",
          values: "/paths/*",
          normalization: { unicode: "NFC" },
        },
        {
          operation: "count",
          values: "/paths/*",
          where: { equals: "SKILL.md" },
          exactly: 1,
        },
      ],
    } as const;
    const validate = compileLearningContractJsonSchema(ajv, schema);

    expect(
      validate({
        minimum: 0,
        maximum: 2,
        values: [1, 2],
        paths: ["SKILL.md", "café.md"],
      }),
    ).toBe(true);
    expect(
      validate({
        minimum: 0,
        maximum: 2,
        values: [0, 1],
        paths: ["SKILL.md"],
      }),
    ).toBe(false);
    expect(
      validate({
        minimum: 0,
        maximum: 2,
        values: [1],
        paths: ["SKILL.md", "café.md", "café.md"],
      }),
    ).toBe(false);
    expect(
      validate({
        minimum: 0,
        maximum: 2,
        values: [1],
        paths: ["nested/SKILL.md"],
      }),
    ).toBe(false);
  });

  test("scopes evidence references to the selected lookup target", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const schema = {
      $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
      type: "object",
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "lookup-references",
          sources: "/annotations/*",
          reference: "/targetId",
          values: "/messageIds/*",
          collection: "/threads/*",
          key: "/snapshotId",
          targets: "/messages/*/messageId",
          keyNormalization: { caseFold: true },
        },
      ],
    } as const;

    const validate = compileLearningContractJsonSchema(ajv, schema);
    const value = {
      annotations: [{ targetId: "SNAPSHOT-A", messageIds: ["message-a"] }],
      threads: [
        {
          snapshotId: "snapshot-a",
          messages: [{ messageId: "message-a" }],
        },
        {
          snapshotId: "snapshot-b",
          messages: [{ messageId: "message-b" }],
        },
      ],
    };

    expect(validate(value)).toBe(true);
    expect(
      validate({
        ...value,
        annotations: [{ targetId: "snapshot-a", messageIds: ["message-b"] }],
      }),
    ).toBe(false);
  });

  test("refuses assertion operations outside the bounded V1 language at schema compilation", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);

    expect(() =>
      compileLearningContractJsonSchema(ajv, {
        $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
        type: "object",
        [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
          { operation: "execute-code", source: "return true" },
        ],
      }),
    ).toThrowError(/schema is invalid: data\/x-copilotkit-assertions/u);
  });
});
