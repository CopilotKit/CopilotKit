import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  INLINE_ATTACHMENT_PAYLOAD_KEY_NORMALIZATION_V1,
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

const tamperAssertionsSchema = {
  $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  type: "object",
  properties: {
    expected: { type: "string" },
    actual: { type: "string" },
  },
  required: ["expected", "actual"],
  [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
    {
      operation: "compare",
      left: "/expected",
      relation: "equal",
      right: "/actual",
    },
  ],
} as const;

function deeplyNestedArray(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function compileBoundedJsonValidator() {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  registerLearningContractJsonSchemaValidator(ajv);
  return compileLearningContractJsonSchema(ajv, {
    $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
    type: "object",
    [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
      {
        operation: "bounded-json",
        values: "/value",
        serializedMaximum: 16_384,
        maximumDepth: 6,
        maximumNodes: 128,
        maximumObjectProperties: 32,
        maximumArrayItems: 32,
        maximumStringUtf8Bytes: 2_048,
        maximumKeyUtf8Bytes: 128,
      },
    ],
  });
}

function expectAccessorTamperingToFailClosed(
  target: object,
  property: string,
  replacement: unknown,
  compile: () => unknown,
): void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(target, property);
  if (originalDescriptor === undefined || !("value" in originalDescriptor)) {
    throw new Error(`Expected ${property} to be an own data property`);
  }

  let reads = 0;
  try {
    Object.defineProperty(target, property, {
      configurable: true,
      enumerable: originalDescriptor.enumerable,
      get: () => {
        reads += 1;
        return reads === 1 ? originalDescriptor.value : replacement;
      },
    });
  } catch {
    expect(
      Object.getOwnPropertyDescriptor(target, property)?.configurable,
    ).toBe(false);
    return;
  }

  expect(compile).toThrowError(
    /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned/u,
  );
}

function expectDataPropertyTamperingToFailClosed(
  target: object,
  property: string,
  replacement: unknown,
  assertCapabilities: () => unknown,
): boolean {
  const originalDescriptor = Object.getOwnPropertyDescriptor(target, property);
  if (originalDescriptor === undefined || !("value" in originalDescriptor)) {
    throw new Error(`Expected ${property} to be an own data property`);
  }

  try {
    Object.defineProperty(target, property, {
      ...originalDescriptor,
      value: replacement,
    });
  } catch {
    expect(
      Object.getOwnPropertyDescriptor(target, property)?.configurable,
    ).toBe(false);
    return false;
  }

  expect(assertCapabilities).toThrowError(
    /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned/u,
  );
  return true;
}

function findPropertyOwner(target: object, property: string): object {
  let current: object | null = target;
  while (current !== null) {
    if (Object.hasOwn(current, property)) return current;
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new Error(`Expected ${property} in the prototype chain`);
}

function expectPrototypeCompileTamperingToFailClosed(
  operation: () => unknown,
  expectedCapability: RegExp,
): void {
  const compileOwner = findPropertyOwner(Ajv2020.prototype, "compile");
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    compileOwner,
    "compile",
  );
  if (originalDescriptor === undefined || !("value" in originalDescriptor)) {
    throw new Error("Expected Ajv2020.prototype.compile to be a data method");
  }

  try {
    Object.defineProperty(compileOwner, "compile", {
      ...originalDescriptor,
      value: () => () => true,
    });
    expect(operation).toThrowError(expectedCapability);
  } finally {
    Object.defineProperty(compileOwner, "compile", originalDescriptor);
  }
}

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
    const validator = createLearningContractJsonSchemaValidator();
    const validate = validator.compile(equalPropertiesSchema);

    expect(validate({ expected: "a", actual: "b" })).toBe(false);
  });

  test.each([
    ["coerceTypes", new Ajv2020({ coerceTypes: true })],
    ["useDefaults", new Ajv2020({ useDefaults: true })],
  ])("rejects a caller-provided %s validator", (_option, callerValidator) => {
    expect(() =>
      Reflect.apply(createLearningContractJsonSchemaValidator, undefined, [
        callerValidator,
      ]),
    ).toThrowError(
      /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned validator instance/,
    );
  });

  test("does not coerce or inject defaults into validated input", () => {
    const validator = createLearningContractJsonSchemaValidator();
    const coercionInput = { count: "1" };
    const validateInteger = validator.compile({
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    });

    expect(validateInteger(coercionInput)).toBe(false);
    expect(coercionInput).toEqual({ count: "1" });

    const defaultInput = {};
    const validateDefault = validator.compile({
      type: "object",
      properties: { enabled: { type: "boolean", default: true } },
    });

    expect(validateDefault(defaultInput)).toBe(true);
    expect(defaultInput).toEqual({});
  });

  test.each([
    COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
    COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  ])("rejects a replaced package-owned %s implementation", (keyword) => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    ajv.removeKeyword(keyword);
    ajv.addKeyword({ keyword, validate: () => true });

    expect(() =>
      compileLearningContractJsonSchema(ajv, equalPropertiesSchema),
    ).toThrowError(
      new RegExp(
        `LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned registration for ${keyword}`,
      ),
    );
  });

  test.each([
    COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
    COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  ])(
    "rejects in-place tampering with package-owned %s semantics",
    (keyword) => {
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      registerLearningContractJsonSchemaValidator(ajv);
      const definition = ajv.getKeyword(keyword);
      if (
        definition === false ||
        definition === null ||
        typeof definition !== "object"
      ) {
        throw new Error(`Expected an object definition for ${keyword}`);
      }

      const tamperingInstalled = expectDataPropertyTamperingToFailClosed(
        definition,
        "validate",
        () => true,
        () => assertLearningContractJsonSchemaValidatorCapabilities(ajv),
      );
      const registerAgain = () =>
        registerLearningContractJsonSchemaValidator(ajv);
      if (tamperingInstalled) {
        expect(registerAgain).toThrowError(
          /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING/u,
        );
      } else {
        expect(registerAgain).not.toThrow();
      }
    },
  );

  test.each([
    [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD, equalPropertiesSchema],
    [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD, tamperAssertionsSchema],
  ])(
    "fails closed on accessor swapping of package-owned %s validation",
    (keyword, schema) => {
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      registerLearningContractJsonSchemaValidator(ajv);
      const definition = ajv.getKeyword(keyword);
      if (
        definition === false ||
        definition === null ||
        typeof definition !== "object"
      ) {
        throw new Error(`Expected an object definition for ${keyword}`);
      }

      expectAccessorTamperingToFailClosed(
        definition,
        "validate",
        () => true,
        () => compileLearningContractJsonSchema(ajv, schema),
      );
    },
  );

  test("rejects a replaced package-owned meta-schema", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    ajv.removeSchema(COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI);
    ajv.addMetaSchema({
      ...learningContractSemanticsMetaSchema,
      title: "foreign replacement",
    });

    expect(() =>
      compileLearningContractJsonSchema(ajv, equalPropertiesSchema),
    ).toThrowError(
      new RegExp(
        `LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned registration for ${COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI}`,
      ),
    );
  });

  test("rejects in-place tampering with package-owned meta-schema semantics", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validateMetaSchema = ajv.getSchema(
      COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
    );
    if (typeof validateMetaSchema !== "function") {
      throw new Error("Expected the package-owned meta-schema validator");
    }
    const metaSchema = (validateMetaSchema as { schema?: unknown }).schema;
    if (
      metaSchema === null ||
      typeof metaSchema !== "object" ||
      Array.isArray(metaSchema)
    ) {
      throw new Error("Expected package-owned meta-schema semantics");
    }
    expectDataPropertyTamperingToFailClosed(
      metaSchema,
      "$dynamicAnchor",
      "foreign replacement",
      () => compileLearningContractJsonSchema(ajv, equalPropertiesSchema),
    );
  });

  test("fails closed on accessor swapping of package-owned meta-schema semantics", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validateMetaSchema = ajv.getSchema(
      COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
    );
    if (typeof validateMetaSchema !== "function") {
      throw new Error("Expected the package-owned meta-schema validator");
    }

    expectAccessorTamperingToFailClosed(
      validateMetaSchema,
      "schema",
      { title: "foreign replacement" },
      () => compileLearningContractJsonSchema(ajv, equalPropertiesSchema),
    );
  });

  test("rejects live compile replacement after package registration", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    Object.defineProperty(ajv, "compile", {
      configurable: true,
      value: () => () => true,
    });

    expect(() =>
      compileLearningContractJsonSchema(ajv, equalPropertiesSchema),
    ).toThrowError(
      /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned validator operation compile/u,
    );
  });

  test("rejects prototype compile replacement after package registration", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    expectPrototypeCompileTamperingToFailClosed(
      () => compileLearningContractJsonSchema(ajv, equalPropertiesSchema),
      /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned validator operation compile/u,
    );
  });

  test("rejects prototype compile replacement after facade construction", () => {
    const validator = createLearningContractJsonSchemaValidator();
    expectPrototypeCompileTamperingToFailClosed(
      () => validator.compile(equalPropertiesSchema),
      /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*package-owned validator operation compile/u,
    );
  });

  test("rejects prototype compile replacement before lower-level registration", () => {
    let registration: unknown;
    expectPrototypeCompileTamperingToFailClosed(() => {
      registration = registerLearningContractJsonSchemaValidator(
        new Ajv2020({ strict: false, validateFormats: false }),
      );
    }, /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*semantic compile self-test/u);
    expect(registration).toBeUndefined();
  });

  test("rejects prototype compile replacement before facade construction", () => {
    let validator: unknown;
    expectPrototypeCompileTamperingToFailClosed(() => {
      validator = createLearningContractJsonSchemaValidator();
    }, /LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING.*semantic compile self-test/u);
    expect(validator).toBeUndefined();
  });

  test("rejects malformed equality pairs when the custom $schema is omitted", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);

    expect(() =>
      compileLearningContractJsonSchema(ajv, {
        type: "object",
        [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD]: [["left"]],
      }),
    ).toThrowError(/must NOT have fewer than 2 items/);
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

describe("Learning Contract assertion pointer grammar", () => {
  test.each([
    [
      "compare.left",
      { operation: "compare", left: "/a~2b", relation: "equal", right: "/ok" },
    ],
    [
      "compare.right",
      { operation: "compare", left: "/ok", relation: "equal", right: "/a~2b" },
    ],
    ["unique.values", { operation: "unique", values: "/a~2b" }],
    [
      "strictly-increasing.values",
      {
        operation: "strictly-increasing",
        values: "/a~2b",
        valueType: "number",
      },
    ],
    [
      "contiguous.values",
      { operation: "contiguous", values: "/a~2b", start: 0 },
    ],
    [
      "values-in-range.values",
      {
        operation: "values-in-range",
        values: "/a~2b",
        minimum: "/min",
        maximum: "/max",
        valueType: "number",
      },
    ],
    [
      "values-in-range.minimum",
      {
        operation: "values-in-range",
        values: "/values",
        minimum: "/a~2b",
        maximum: "/max",
        valueType: "number",
      },
    ],
    [
      "values-in-range.maximum",
      {
        operation: "values-in-range",
        values: "/values",
        minimum: "/min",
        maximum: "/a~2b",
        valueType: "number",
      },
    ],
    [
      "references.values",
      { operation: "references", values: "/a~2b", targets: "/targets" },
    ],
    [
      "references.targets",
      { operation: "references", values: "/values", targets: "/a~2b" },
    ],
    [
      "disjoint.left",
      { operation: "disjoint", left: "/a~2b", right: "/right" },
    ],
    [
      "disjoint.right",
      { operation: "disjoint", left: "/left", right: "/a~2b" },
    ],
    [
      "ordered-ranges.ranges",
      {
        operation: "ordered-ranges",
        ranges: "/a~2b",
        first: "/first",
        last: "/last",
        valueType: "number",
      },
    ],
    [
      "ordered-ranges.first",
      {
        operation: "ordered-ranges",
        ranges: "/ranges",
        first: "/a~2b",
        last: "/last",
        valueType: "number",
      },
    ],
    [
      "ordered-ranges.last",
      {
        operation: "ordered-ranges",
        ranges: "/ranges",
        first: "/first",
        last: "/a~2b",
        valueType: "number",
      },
    ],
    [
      "lookup-equal.collection",
      {
        operation: "lookup-equal",
        collection: "/a~2b",
        key: "/key",
        reference: "/reference",
        value: "/value",
        expected: "/expected",
      },
    ],
    [
      "lookup-equal.key",
      {
        operation: "lookup-equal",
        collection: "/collection",
        key: "/a~2b",
        reference: "/reference",
        value: "/value",
        expected: "/expected",
      },
    ],
    [
      "lookup-equal.reference",
      {
        operation: "lookup-equal",
        collection: "/collection",
        key: "/key",
        reference: "/a~2b",
        value: "/value",
        expected: "/expected",
      },
    ],
    [
      "lookup-equal.value",
      {
        operation: "lookup-equal",
        collection: "/collection",
        key: "/key",
        reference: "/reference",
        value: "/a~2b",
        expected: "/expected",
      },
    ],
    [
      "lookup-equal.expected",
      {
        operation: "lookup-equal",
        collection: "/collection",
        key: "/key",
        reference: "/reference",
        value: "/value",
        expected: "/a~2b",
      },
    ],
    [
      "lookup-references.sources",
      {
        operation: "lookup-references",
        sources: "/a~2b",
        reference: "/reference",
        values: "/values",
        collection: "/collection",
        key: "/key",
        targets: "/targets",
      },
    ],
    [
      "lookup-references.reference",
      {
        operation: "lookup-references",
        sources: "/sources",
        reference: "/a~2b",
        values: "/values",
        collection: "/collection",
        key: "/key",
        targets: "/targets",
      },
    ],
    [
      "lookup-references.values",
      {
        operation: "lookup-references",
        sources: "/sources",
        reference: "/reference",
        values: "/a~2b",
        collection: "/collection",
        key: "/key",
        targets: "/targets",
      },
    ],
    [
      "lookup-references.collection",
      {
        operation: "lookup-references",
        sources: "/sources",
        reference: "/reference",
        values: "/values",
        collection: "/a~2b",
        key: "/key",
        targets: "/targets",
      },
    ],
    [
      "lookup-references.key",
      {
        operation: "lookup-references",
        sources: "/sources",
        reference: "/reference",
        values: "/values",
        collection: "/collection",
        key: "/a~2b",
        targets: "/targets",
      },
    ],
    [
      "lookup-references.targets",
      {
        operation: "lookup-references",
        sources: "/sources",
        reference: "/reference",
        values: "/values",
        collection: "/collection",
        key: "/key",
        targets: "/a~2b",
      },
    ],
    ["count.values", { operation: "count", values: "/a~2b", exactly: 1 }],
    [
      "utf8-byte-length.values",
      { operation: "utf8-byte-length", values: "/a~2b", maximum: 1 },
    ],
    [
      "bounded-json.values",
      {
        operation: "bounded-json",
        values: "/a~2b",
        serializedMaximum: 1,
        maximumDepth: 1,
        maximumNodes: 1,
        maximumObjectProperties: 1,
        maximumArrayItems: 1,
        maximumStringUtf8Bytes: 1,
        maximumKeyUtf8Bytes: 1,
      },
    ],
  ])("rejects invalid RFC 6901 escapes in %s", (_field, assertion) => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);

    expect(() =>
      compileLearningContractJsonSchema(ajv, {
        type: "object",
        [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [assertion],
      }),
    ).toThrowError(/must match pattern/);
  });

  test.each(["", "/a~0b/~1/*", "/empty//segment"])(
    "accepts the extended RFC 6901 pointer %s",
    (pointer) => {
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      registerLearningContractJsonSchemaValidator(ajv);

      expect(() =>
        compileLearningContractJsonSchema(ajv, {
          type: "object",
          [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
            { operation: "unique", values: pointer },
          ],
        }),
      ).not.toThrow();
    },
  );

  test("does not treat a leading-zero array token as an array index", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validate = compileLearningContractJsonSchema(ajv, {
      type: "object",
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "compare",
          left: "/values/01",
          relation: "equal",
          right: "/values/1",
        },
      ],
    });

    expect(validate({ values: ["zero", "one"] })).toBe(false);
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

  test("supports all-equal values with optional normalization", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validate = compileLearningContractJsonSchema(ajv, {
      type: "object",
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "all-equal",
          values: "/ids/*",
          normalization: { caseFold: true },
        },
      ],
    });

    expect(validate({ ids: ["RUN", "run"] })).toBe(true);
    expect(validate({ ids: ["run", "other"] })).toBe(false);
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

  test("enforces portable UTF-8 byte lengths at exact boundaries", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validate = compileLearningContractJsonSchema(ajv, {
      $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
      type: "object",
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "utf8-byte-length",
          values: "/attachments/*/provider",
          maximum: 64,
        },
      ],
    });

    expect(validate({ attachments: [{ provider: "é".repeat(32) }] })).toBe(
      true,
    );
    expect(validate({ attachments: [{ provider: "é".repeat(33) }] })).toBe(
      false,
    );
    expect(validate({})).toBe(true);
    expect(validate({ attachments: [{ provider: 64 }] })).toBe(false);
  });

  test("enforces recursive bounded JSON through registered Ajv", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    const validate = compileLearningContractJsonSchema(ajv, {
      $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
      type: "object",
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "bounded-json",
          values: "/attachments/*/metadata",
          serializedMaximum: 16_384,
          maximumDepth: 6,
          maximumNodes: 128,
          maximumObjectProperties: 32,
          maximumArrayItems: 32,
          maximumStringUtf8Bytes: 2_048,
          maximumKeyUtf8Bytes: 128,
          keyNormalization: INLINE_ATTACHMENT_PAYLOAD_KEY_NORMALIZATION_V1,
          forbiddenNormalizedKeys: [
            "body",
            "content",
            "data",
            "bytes",
            "payload",
            "inlinebody",
          ],
          forbiddenNormalizedKeySuffixes: ["bytes"],
          forbiddenNormalizedKeyFragments: ["base64"],
        },
      ],
    });

    expect(
      validate({ attachments: [{ metadata: { source: "gateway" } }] }),
    ).toBe(true);
    expect(validate({})).toBe(true);
    expect(
      validate({
        attachments: [{ metadata: { nested: { dataBase64: "x" } } }],
      }),
    ).toBe(false);
    expect(
      validate({
        attachments: [
          {
            metadata: {
              payload: "x",
              "base 64": "x",
              ｄａｔａ: "x",
              "INLINE BODY": "x",
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      validate({
        attachments: [
          {
            metadata: {
              payloadRef: "object-1",
              contentType: "text/plain",
              byteLength: 1,
              database: "primary",
            },
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        attachments: [
          {
            metadata: {
              values: Array.from({ length: 33 }, (_, index) => index),
            },
          },
        ],
      }),
    ).toBe(false);
    expect(validate({ attachments: [{ metadata: "not-an-object" }] })).toBe(
      false,
    );
  });

  test.each([
    ["deeply nested input", { nested: deeplyNestedArray(20_000) }],
    [
      "cyclic input",
      (() => {
        const value: { self?: unknown } = {};
        value.self = value;
        return value;
      })(),
    ],
    ["BigInt input", { value: 1n }],
    ["own __proto__ key", JSON.parse('{"__proto__":{"polluted":true}}')],
  ])("bounded-json fails closed without throwing for %s", (_name, value) => {
    const validate = compileBoundedJsonValidator();
    const input = { value };

    expect(() => validate(input)).not.toThrow();
    expect(validate(input)).toBe(false);
  });

  test.each([
    {
      name: "negative UTF-8 maximum",
      assertion: {
        operation: "utf8-byte-length",
        values: "/value",
        maximum: -1,
      },
    },
    {
      name: "missing UTF-8 maximum",
      assertion: {
        operation: "utf8-byte-length",
        values: "/value",
      },
    },
    {
      name: "negative bounded-JSON maximum",
      assertion: {
        operation: "bounded-json",
        values: "/value",
        serializedMaximum: -1,
        maximumDepth: 1,
        maximumNodes: 1,
        maximumObjectProperties: 1,
        maximumArrayItems: 1,
        maximumStringUtf8Bytes: 1,
        maximumKeyUtf8Bytes: 1,
      },
    },
    {
      name: "missing bounded-JSON maximum",
      assertion: {
        operation: "bounded-json",
        values: "/value",
        serializedMaximum: 1,
        maximumDepth: 1,
        maximumNodes: 1,
        maximumObjectProperties: 1,
        maximumArrayItems: 1,
        maximumStringUtf8Bytes: 1,
      },
    },
  ])("rejects $name", ({ assertion }) => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    registerLearningContractJsonSchemaValidator(ajv);
    expect(() =>
      compileLearningContractJsonSchema(ajv, {
        $schema: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
        type: "object",
        [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [assertion],
      }),
    ).toThrowError(/schema is invalid: data\/x-copilotkit-assertions/u);
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
