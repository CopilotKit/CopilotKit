import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonObject, JsonValue } from "./contracts.js";
import {
  COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
  COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  COPILOTKIT_LEARNING_CONTRACT_SEMANTICS_VOCABULARY_URI,
  learningContractAssertionV1JsonSchema,
  learningContractEqualPropertiesV1JsonSchema,
  learningContractSemanticsMetaSchema,
} from "./contracts.js";

export type LearningContractAssertionNormalizationV1 = {
  readonly caseFold?: boolean;
  readonly unicode?: "NFC" | "NFKC";
};

type LearningContractAssertionValueTypeV1 = "number" | "string" | "date-time";

export type LearningContractAssertionV1 =
  | {
      readonly operation: "compare";
      readonly left: string;
      readonly relation: "equal" | "less-than" | "less-than-or-equal";
      readonly right: string;
      readonly valueType?: LearningContractAssertionValueTypeV1;
      readonly normalization?: LearningContractAssertionNormalizationV1;
    }
  | {
      readonly operation: "unique";
      readonly values: string;
      readonly normalization?: LearningContractAssertionNormalizationV1;
    }
  | {
      readonly operation: "strictly-increasing";
      readonly values: string;
      readonly valueType: LearningContractAssertionValueTypeV1;
    }
  | {
      readonly operation: "contiguous";
      readonly values: string;
      readonly start: number;
    }
  | {
      readonly operation: "values-in-range";
      readonly values: string;
      readonly minimum: string;
      readonly maximum: string;
      readonly minimumExclusive?: boolean;
      readonly maximumExclusive?: boolean;
      readonly valueType: LearningContractAssertionValueTypeV1;
    }
  | {
      readonly operation: "references";
      readonly values: string;
      readonly targets: string;
      readonly normalization?: LearningContractAssertionNormalizationV1;
    }
  | {
      readonly operation: "disjoint";
      readonly left: string;
      readonly right: string;
      readonly normalization?: LearningContractAssertionNormalizationV1;
    }
  | {
      readonly operation: "ordered-ranges";
      readonly ranges: string;
      readonly first: string;
      readonly last: string;
      readonly valueType: LearningContractAssertionValueTypeV1;
    }
  | {
      readonly operation: "lookup-equal";
      readonly collection: string;
      readonly key: string;
      readonly reference: string;
      readonly value: string;
      readonly expected: string;
      readonly normalization?: LearningContractAssertionNormalizationV1;
    }
  | {
      readonly operation: "lookup-references";
      readonly sources: string;
      readonly reference: string;
      readonly values: string;
      readonly collection: string;
      readonly key: string;
      readonly targets: string;
      readonly keyNormalization?: LearningContractAssertionNormalizationV1;
      readonly valueNormalization?: LearningContractAssertionNormalizationV1;
    }
  | {
      readonly operation: "count";
      readonly values: string;
      readonly where?:
        | { readonly equals: JsonValue }
        | { readonly in: readonly JsonValue[] };
      readonly exactly?: number;
      readonly minimum?: number;
      readonly maximum?: number;
      readonly normalization?: LearningContractAssertionNormalizationV1;
    };

export interface LearningContractJsonSchemaValidateFunction {
  (data: unknown): boolean | Promise<unknown>;
  readonly errors?: readonly unknown[] | null;
}

export interface LearningContractJsonSchemaObject {
  readonly [key: string]: unknown;
}

export interface LearningContractJsonSchemaKeywordDefinition {
  readonly keyword: string;
  readonly type?: "object";
  readonly schemaType?: "array";
  readonly errors?: boolean | "full";
  readonly metaSchema?: JsonObject;
  readonly validate?: (
    schema: unknown,
    data: unknown,
    parentSchema?: JsonObject,
    dataContext?: unknown,
  ) => boolean | Promise<unknown>;
}

export interface LearningContractJsonSchemaValidatorAdapter {
  addKeyword(
    definition: string | LearningContractJsonSchemaKeywordDefinition,
    secondaryDefinition?: LearningContractJsonSchemaKeywordDefinition,
  ): unknown;
  addMetaSchema(
    schema: JsonObject,
    key?: string,
    validateSchema?: boolean | "log",
  ): unknown;
  compile(
    schema: LearningContractJsonSchemaObject | boolean,
  ): LearningContractJsonSchemaValidateFunction;
  getKeyword(keyword: string): unknown;
  getSchema(uri: string): unknown;
}

export const LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1 = Object.freeze(
  {
    id: COPILOTKIT_LEARNING_CONTRACT_SEMANTICS_VOCABULARY_URI,
    version: 1,
    metaSchemaUri: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
    keywords: Object.freeze([
      COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
      COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
    ]),
  },
);

export type LearningContractPortableValidatorCapabilityErrorCode =
  | "LEARNING_CONTRACT_VALIDATOR_META_SCHEMA_MISSING"
  | "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING";

export class LearningContractPortableValidatorCapabilityError extends Error {
  readonly capabilityId = LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.id;

  constructor(
    readonly code: LearningContractPortableValidatorCapabilityErrorCode,
    readonly missing: string,
  ) {
    super(
      `${code}: validator is missing ${missing} required by ${LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.id}`,
    );
    this.name = "LearningContractPortableValidatorCapabilityError";
  }
}

interface PackageValidatorRegistration {
  readonly equalPropertiesKeyword: unknown;
  readonly assertionsKeyword: unknown;
  readonly metaSchema: unknown;
}

const packageRegisteredValidators = new WeakMap<
  object,
  PackageValidatorRegistration
>();

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function selectJsonPointerValues(root: unknown, pointer: string): unknown[] {
  if (pointer === "") return [root];
  if (!pointer.startsWith("/")) return [];

  const segments = pointer.slice(1).split("/").map(decodeJsonPointerSegment);
  let values: unknown[] = [root];
  for (const segment of segments) {
    const nextValues: unknown[] = [];
    for (const value of values) {
      if (segment === "*") {
        if (Array.isArray(value)) {
          nextValues.push(...value);
        } else if (isJsonObject(value)) {
          nextValues.push(...Object.values(value));
        }
        continue;
      }

      if (Array.isArray(value) && /^\d+$/u.test(segment)) {
        const indexedValue = value[Number(segment)];
        if (indexedValue !== undefined) nextValues.push(indexedValue);
      } else if (isJsonObject(value) && Object.hasOwn(value, segment)) {
        nextValues.push(value[segment]);
      }
    }
    values = nextValues;
  }
  return values;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAssertionValue(
  value: unknown,
  normalization?: LearningContractAssertionNormalizationV1,
): unknown {
  if (typeof value !== "string" || normalization === undefined) return value;
  const unicodeNormalized = normalization.unicode
    ? value.normalize(normalization.unicode)
    : value;
  return normalization.caseFold
    ? unicodeNormalized.toLocaleLowerCase("en-US")
    : unicodeNormalized;
}

function assertionValueKey(
  value: unknown,
  normalization?: LearningContractAssertionNormalizationV1,
): string {
  const normalized = normalizeAssertionValue(value, normalization);
  return `${typeof normalized}:${JSON.stringify(normalized)}`;
}

function comparableValue(
  value: unknown,
  valueType: LearningContractAssertionValueTypeV1 | undefined,
): number | string | undefined {
  if (valueType === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }
  if (valueType === "date-time") {
    if (typeof value !== "string") return undefined;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  if (valueType === "string") {
    return typeof value === "string" ? value : undefined;
  }
  return typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

function compareAssertionValues(
  left: unknown,
  right: unknown,
  relation: "equal" | "less-than" | "less-than-or-equal",
  valueType?: LearningContractAssertionValueTypeV1,
  normalization?: LearningContractAssertionNormalizationV1,
): boolean {
  if (relation === "equal") {
    return (
      assertionValueKey(left, normalization) ===
      assertionValueKey(right, normalization)
    );
  }

  const comparableLeft = comparableValue(left, valueType);
  const comparableRight = comparableValue(right, valueType);
  if (comparableLeft === undefined || comparableRight === undefined) {
    return false;
  }
  return relation === "less-than"
    ? comparableLeft < comparableRight
    : comparableLeft <= comparableRight;
}

function hasExactlyOneValue(values: readonly unknown[]): values is [unknown] {
  return values.length === 1;
}

function validateCompareAssertion(
  assertion: Extract<LearningContractAssertionV1, { operation: "compare" }>,
  data: unknown,
): boolean {
  const left = selectJsonPointerValues(data, assertion.left);
  const right = selectJsonPointerValues(data, assertion.right);
  return (
    hasExactlyOneValue(left) &&
    hasExactlyOneValue(right) &&
    compareAssertionValues(
      left[0],
      right[0],
      assertion.relation,
      assertion.valueType,
      assertion.normalization,
    )
  );
}

function validateUniqueAssertion(
  assertion: Extract<LearningContractAssertionV1, { operation: "unique" }>,
  data: unknown,
): boolean {
  const keys = selectJsonPointerValues(data, assertion.values).map((value) =>
    assertionValueKey(value, assertion.normalization),
  );
  return new Set(keys).size === keys.length;
}

function validateStrictlyIncreasingAssertion(
  assertion: Extract<
    LearningContractAssertionV1,
    { operation: "strictly-increasing" }
  >,
  data: unknown,
): boolean {
  const values = selectJsonPointerValues(data, assertion.values).map((value) =>
    comparableValue(value, assertion.valueType),
  );
  return values.every(
    (value, index) =>
      value !== undefined &&
      (index === 0 ||
        (values[index - 1] !== undefined && value > values[index - 1]!)),
  );
}

function validateContiguousAssertion(
  assertion: Extract<LearningContractAssertionV1, { operation: "contiguous" }>,
  data: unknown,
): boolean {
  return selectJsonPointerValues(data, assertion.values).every(
    (value, index) => value === assertion.start + index,
  );
}

function validateValuesInRangeAssertion(
  assertion: Extract<
    LearningContractAssertionV1,
    { operation: "values-in-range" }
  >,
  data: unknown,
): boolean {
  const minimumValues = selectJsonPointerValues(data, assertion.minimum);
  const maximumValues = selectJsonPointerValues(data, assertion.maximum);
  if (
    !hasExactlyOneValue(minimumValues) ||
    !hasExactlyOneValue(maximumValues)
  ) {
    return false;
  }
  const minimum = comparableValue(minimumValues[0], assertion.valueType);
  const maximum = comparableValue(maximumValues[0], assertion.valueType);
  if (minimum === undefined || maximum === undefined || minimum > maximum) {
    return false;
  }
  return selectJsonPointerValues(data, assertion.values).every((value) => {
    const comparable = comparableValue(value, assertion.valueType);
    if (comparable === undefined) return false;
    const aboveMinimum = assertion.minimumExclusive
      ? comparable > minimum
      : comparable >= minimum;
    const belowMaximum = assertion.maximumExclusive
      ? comparable < maximum
      : comparable <= maximum;
    return aboveMinimum && belowMaximum;
  });
}

function validateReferencesAssertion(
  assertion: Extract<LearningContractAssertionV1, { operation: "references" }>,
  data: unknown,
): boolean {
  const targetKeys = new Set(
    selectJsonPointerValues(data, assertion.targets).map((value) =>
      assertionValueKey(value, assertion.normalization),
    ),
  );
  return selectJsonPointerValues(data, assertion.values).every((value) =>
    targetKeys.has(assertionValueKey(value, assertion.normalization)),
  );
}

function validateDisjointAssertion(
  assertion: Extract<LearningContractAssertionV1, { operation: "disjoint" }>,
  data: unknown,
): boolean {
  const rightKeys = new Set(
    selectJsonPointerValues(data, assertion.right).map((value) =>
      assertionValueKey(value, assertion.normalization),
    ),
  );
  return selectJsonPointerValues(data, assertion.left).every(
    (value) =>
      !rightKeys.has(assertionValueKey(value, assertion.normalization)),
  );
}

function validateOrderedRangesAssertion(
  assertion: Extract<
    LearningContractAssertionV1,
    { operation: "ordered-ranges" }
  >,
  data: unknown,
): boolean {
  let previousLast: number | string | undefined;
  for (const range of selectJsonPointerValues(data, assertion.ranges)) {
    const firstValues = selectJsonPointerValues(range, assertion.first);
    const lastValues = selectJsonPointerValues(range, assertion.last);
    if (!hasExactlyOneValue(firstValues) || !hasExactlyOneValue(lastValues)) {
      return false;
    }
    const first = comparableValue(firstValues[0], assertion.valueType);
    const last = comparableValue(lastValues[0], assertion.valueType);
    if (
      first === undefined ||
      last === undefined ||
      first > last ||
      (previousLast !== undefined && first <= previousLast)
    ) {
      return false;
    }
    previousLast = last;
  }
  return true;
}

function validateLookupEqualAssertion(
  assertion: Extract<
    LearningContractAssertionV1,
    { operation: "lookup-equal" }
  >,
  data: unknown,
): boolean {
  const references = selectJsonPointerValues(data, assertion.reference);
  const expectedValues = selectJsonPointerValues(data, assertion.expected);
  if (!hasExactlyOneValue(references) || !hasExactlyOneValue(expectedValues)) {
    return false;
  }
  const referenceKey = assertionValueKey(
    references[0],
    assertion.normalization,
  );
  const matches = selectJsonPointerValues(data, assertion.collection).filter(
    (entry) => {
      const keys = selectJsonPointerValues(entry, assertion.key);
      return (
        hasExactlyOneValue(keys) &&
        assertionValueKey(keys[0], assertion.normalization) === referenceKey
      );
    },
  );
  if (!hasExactlyOneValue(matches)) return false;
  const values = selectJsonPointerValues(matches[0], assertion.value);
  return (
    hasExactlyOneValue(values) &&
    compareAssertionValues(
      values[0],
      expectedValues[0],
      "equal",
      undefined,
      assertion.normalization,
    )
  );
}

function validateLookupReferencesAssertion(
  assertion: Extract<
    LearningContractAssertionV1,
    { operation: "lookup-references" }
  >,
  data: unknown,
): boolean {
  const collection = selectJsonPointerValues(data, assertion.collection);
  return selectJsonPointerValues(data, assertion.sources).every((source) => {
    const references = selectJsonPointerValues(source, assertion.reference);
    if (!hasExactlyOneValue(references)) return false;
    const referenceKey = assertionValueKey(
      references[0],
      assertion.keyNormalization,
    );
    const matches = collection.filter((entry) => {
      const keys = selectJsonPointerValues(entry, assertion.key);
      return (
        hasExactlyOneValue(keys) &&
        assertionValueKey(keys[0], assertion.keyNormalization) === referenceKey
      );
    });
    if (!hasExactlyOneValue(matches)) return false;

    const targetKeys = new Set(
      selectJsonPointerValues(matches[0], assertion.targets).map((value) =>
        assertionValueKey(value, assertion.valueNormalization),
      ),
    );
    return selectJsonPointerValues(source, assertion.values).every((value) =>
      targetKeys.has(assertionValueKey(value, assertion.valueNormalization)),
    );
  });
}

function countWhereMatches(
  value: unknown,
  assertion: Extract<LearningContractAssertionV1, { operation: "count" }>,
): boolean {
  if (assertion.where === undefined) return true;
  const valueKey = assertionValueKey(value, assertion.normalization);
  if ("equals" in assertion.where) {
    return (
      valueKey ===
      assertionValueKey(assertion.where.equals, assertion.normalization)
    );
  }
  return assertion.where.in.some(
    (candidate) =>
      valueKey === assertionValueKey(candidate, assertion.normalization),
  );
}

function validateCountAssertion(
  assertion: Extract<LearningContractAssertionV1, { operation: "count" }>,
  data: unknown,
): boolean {
  const count = selectJsonPointerValues(data, assertion.values).filter(
    (value) => countWhereMatches(value, assertion),
  ).length;
  if (assertion.exactly !== undefined && count !== assertion.exactly) {
    return false;
  }
  if (assertion.minimum !== undefined && count < assertion.minimum) {
    return false;
  }
  return assertion.maximum === undefined || count <= assertion.maximum;
}

function validateLearningContractAssertion(
  assertion: LearningContractAssertionV1,
  data: unknown,
): boolean {
  switch (assertion.operation) {
    case "compare":
      return validateCompareAssertion(assertion, data);
    case "unique":
      return validateUniqueAssertion(assertion, data);
    case "strictly-increasing":
      return validateStrictlyIncreasingAssertion(assertion, data);
    case "contiguous":
      return validateContiguousAssertion(assertion, data);
    case "values-in-range":
      return validateValuesInRangeAssertion(assertion, data);
    case "references":
      return validateReferencesAssertion(assertion, data);
    case "disjoint":
      return validateDisjointAssertion(assertion, data);
    case "ordered-ranges":
      return validateOrderedRangesAssertion(assertion, data);
    case "lookup-equal":
      return validateLookupEqualAssertion(assertion, data);
    case "lookup-references":
      return validateLookupReferencesAssertion(assertion, data);
    case "count":
      return validateCountAssertion(assertion, data);
  }
}

function validateEqualProperties(
  pairs: readonly (readonly [string, string])[],
  value: Record<string, unknown>,
): boolean {
  return pairs.every(([left, right]) => value[left] === value[right]);
}

function validateAssertions(
  assertions: readonly LearningContractAssertionV1[],
  value: Record<string, unknown>,
): boolean {
  return assertions.every((assertion) =>
    validateLearningContractAssertion(assertion, value),
  );
}

/**
 * Installs the exact V1 custom semantics and meta-schema on an Ajv-compatible
 * Draft 2020-12 validator. Existing untrusted keyword implementations are
 * refused rather than silently treated as the required capability.
 */
export function registerLearningContractJsonSchemaValidator<
  TValidator extends LearningContractJsonSchemaValidatorAdapter,
>(validator: TValidator): TValidator {
  if (packageRegisteredValidators.has(validator)) {
    assertLearningContractJsonSchemaValidatorCapabilities(validator);
    return validator;
  }

  for (const keyword of LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.keywords) {
    if (validator.getKeyword(keyword) !== false) {
      throw new LearningContractPortableValidatorCapabilityError(
        "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
        `package-owned registration for ${keyword}`,
      );
    }
  }
  if (
    validator.getSchema(
      LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.metaSchemaUri,
    ) !== undefined
  ) {
    throw new LearningContractPortableValidatorCapabilityError(
      "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
      `package-owned registration for ${LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.metaSchemaUri}`,
    );
  }

  validator.addKeyword({
    keyword: COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
    schemaType: "array",
    type: "object",
    errors: false,
    metaSchema: learningContractEqualPropertiesV1JsonSchema,
    validate: (pairs: unknown, value: unknown) =>
      Array.isArray(pairs) &&
      isJsonObject(value) &&
      validateEqualProperties(
        pairs as readonly (readonly [string, string])[],
        value,
      ),
  });
  validator.addKeyword({
    keyword: COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
    schemaType: "array",
    type: "object",
    errors: false,
    metaSchema: learningContractAssertionV1JsonSchema,
    validate: (assertions: unknown, value: unknown) =>
      Array.isArray(assertions) &&
      isJsonObject(value) &&
      validateAssertions(
        assertions as readonly LearningContractAssertionV1[],
        value,
      ),
  });
  validator.addMetaSchema(learningContractSemanticsMetaSchema);

  const equalPropertiesKeyword = validator.getKeyword(
    COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
  );
  const assertionsKeyword = validator.getKeyword(
    COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
  );
  const metaSchema = validator.getSchema(
    COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  );
  if (
    equalPropertiesKeyword === false ||
    assertionsKeyword === false ||
    metaSchema === undefined
  ) {
    throw new LearningContractPortableValidatorCapabilityError(
      "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
      "complete package-owned V1 registration",
    );
  }
  packageRegisteredValidators.set(validator, {
    equalPropertiesKeyword,
    assertionsKeyword,
    metaSchema,
  });
  return validator;
}

/** Refuses use unless the complete package-owned V1 capability is installed. */
export function assertLearningContractJsonSchemaValidatorCapabilities(
  validator: LearningContractJsonSchemaValidatorAdapter,
): void {
  const metaSchema = validator.getSchema(
    LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.metaSchemaUri,
  );
  if (metaSchema === undefined) {
    throw new LearningContractPortableValidatorCapabilityError(
      "LEARNING_CONTRACT_VALIDATOR_META_SCHEMA_MISSING",
      LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.metaSchemaUri,
    );
  }
  const keywordDefinitions =
    LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.keywords.map(
      (keyword) => [keyword, validator.getKeyword(keyword)] as const,
    );
  for (const [keyword, definition] of keywordDefinitions) {
    if (definition === false) {
      throw new LearningContractPortableValidatorCapabilityError(
        "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
        keyword,
      );
    }
  }
  const registration = packageRegisteredValidators.get(validator);
  if (registration === undefined) {
    throw new LearningContractPortableValidatorCapabilityError(
      "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
      "package-owned V1 registration",
    );
  }
  if (metaSchema !== registration.metaSchema) {
    throw new LearningContractPortableValidatorCapabilityError(
      "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
      `package-owned registration for ${LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1.metaSchemaUri}`,
    );
  }
  const expectedKeywordDefinitions = new Map([
    [
      COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
      registration.equalPropertiesKeyword,
    ],
    [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD, registration.assertionsKeyword],
  ]);
  for (const [keyword, definition] of keywordDefinitions) {
    if (definition !== expectedKeywordDefinitions.get(keyword)) {
      throw new LearningContractPortableValidatorCapabilityError(
        "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
        `package-owned registration for ${keyword}`,
      );
    }
  }
}

/** Capability-gated schema compilation; validation cannot begin on mismatch. */
export function compileLearningContractJsonSchema(
  validator: LearningContractJsonSchemaValidatorAdapter,
  schema: LearningContractJsonSchemaObject | boolean,
): LearningContractJsonSchemaValidateFunction {
  assertLearningContractJsonSchemaValidatorCapabilities(validator);
  return validator.compile(schema);
}

export interface LearningContractJsonSchemaValidator {
  compile(
    schema: LearningContractJsonSchemaObject | boolean,
  ): LearningContractJsonSchemaValidateFunction;
}

/** Supported one-step entry point for package-owned registration and compile. */
export function createLearningContractJsonSchemaValidator(): LearningContractJsonSchemaValidator;
export function createLearningContractJsonSchemaValidator(
  ...unexpectedValidators: readonly unknown[]
): LearningContractJsonSchemaValidator {
  if (unexpectedValidators.length > 0) {
    throw new LearningContractPortableValidatorCapabilityError(
      "LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING",
      "package-owned validator instance",
    );
  }
  const validator = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  registerLearningContractJsonSchemaValidator(validator);
  return Object.freeze({
    compile: (schema: LearningContractJsonSchemaObject | boolean) =>
      compileLearningContractJsonSchema(validator, schema),
  });
}
