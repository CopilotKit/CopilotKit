export interface JsonTreeBoundsV1 {
  readonly maxSerializedBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxObjectProperties: number;
  readonly maxArrayItems: number;
  readonly maxStringBytes: number;
  readonly maxKeyBytes: number;
}

export interface JsonTreeBoundsIssueV1 {
  readonly code:
    | "invalid_json"
    | "serialized_bytes"
    | "depth"
    | "nodes"
    | "object_properties"
    | "array_items"
    | "string_bytes"
    | "key_bytes"
    | "inline_payload_key";
  readonly path: readonly (string | number)[];
  readonly actual: number;
  readonly limit: number;
  readonly message: string;
}

export const ATTACHMENT_METADATA_BOUNDS_V1 = {
  maxSerializedBytes: 16_384,
  maxDepth: 6,
  maxNodes: 128,
  maxObjectProperties: 32,
  maxArrayItems: 32,
  maxStringBytes: 2_048,
  maxKeyBytes: 128,
} as const satisfies JsonTreeBoundsV1;

export const TERMINAL_ERROR_DETAILS_BOUNDS_V1 = {
  maxSerializedBytes: 32_768,
  maxDepth: 8,
  maxNodes: 256,
  maxObjectProperties: 64,
  maxArrayItems: 64,
  maxStringBytes: 4_096,
  maxKeyBytes: 256,
} as const satisfies JsonTreeBoundsV1;

export const RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1 = {
  maxSerializedBytes: 32_768,
  maxDepth: 8,
  maxNodes: 512,
  maxObjectProperties: 128,
  maxArrayItems: 256,
  maxStringBytes: 16_384,
  maxKeyBytes: 512,
} as const satisfies JsonTreeBoundsV1;

export const RETAINED_EVIDENCE_ENTRY_BOUNDS_V1 = {
  maxSerializedBytes: 65_536,
  maxDepth: 9,
  maxNodes: 1_024,
  maxObjectProperties: 256,
  maxArrayItems: 256,
  maxStringBytes: 65_536,
  maxKeyBytes: 1_024,
} as const satisfies JsonTreeBoundsV1;

export const RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1 = {
  maxSerializedBytes: 8_388_608,
  maxDepth: 11,
  maxNodes: 1_048_576,
  maxObjectProperties: 256,
  maxArrayItems: 4_096,
  maxStringBytes: 8_388_608,
  maxKeyBytes: 1_024,
} as const satisfies JsonTreeBoundsV1;

export const RUN_SNAPSHOT_ATTACHMENT_LIMITS_V1 = {
  maxEntries: 32,
  providerMaxUtf8Bytes: 64,
  resourceMaxUtf8Bytes: 1_024,
  keyMaxUtf8Bytes: 4_096,
  versionMaxUtf8Bytes: 512,
  nameMaxUtf8Bytes: 1_024,
  mediaTypeMaxUtf8Bytes: 255,
  checksumAlgorithmMaxUtf8Bytes: 64,
  checksumValueMaxUtf8Bytes: 512,
  metadataMaxUtf8Bytes: ATTACHMENT_METADATA_BOUNDS_V1.maxSerializedBytes,
  metadataMaxDepth: ATTACHMENT_METADATA_BOUNDS_V1.maxDepth,
  metadataMaxNodes: ATTACHMENT_METADATA_BOUNDS_V1.maxNodes,
  metadataMaxObjectProperties:
    ATTACHMENT_METADATA_BOUNDS_V1.maxObjectProperties,
  metadataMaxArrayItems: ATTACHMENT_METADATA_BOUNDS_V1.maxArrayItems,
  metadataMaxStringUtf8Bytes: ATTACHMENT_METADATA_BOUNDS_V1.maxStringBytes,
  metadataMaxKeyUtf8Bytes: ATTACHMENT_METADATA_BOUNDS_V1.maxKeyBytes,
} as const;

export const RUN_SNAPSHOT_TERMINAL_ERROR_LIMITS_V1 = {
  messageMaxUtf8Bytes: 4_096,
  codeMaxUtf8Bytes: 256,
  categoryMaxUtf8Bytes: 256,
  stackMaxUtf8Bytes: 16_384,
  detailsMaxUtf8Bytes: TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxSerializedBytes,
  detailsMaxDepth: TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxDepth,
  detailsMaxNodes: TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxNodes,
  detailsMaxObjectProperties:
    TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxObjectProperties,
  detailsMaxArrayItems: TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxArrayItems,
  detailsMaxStringUtf8Bytes: TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxStringBytes,
  detailsMaxKeyUtf8Bytes: TERMINAL_ERROR_DETAILS_BOUNDS_V1.maxKeyBytes,
} as const;

export const RUN_SNAPSHOT_RETAINED_EVIDENCE_LIMITS_V1 = {
  maxEntries: 4_096,
  aggregateMaxUtf8Bytes:
    RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxSerializedBytes,
  aggregateMaxDepth: RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxDepth,
  aggregateMaxNodes: RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxNodes,
  aggregateMaxObjectProperties:
    RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxObjectProperties,
  aggregateMaxArrayItems: RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxArrayItems,
  aggregateMaxStringUtf8Bytes:
    RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxStringBytes,
  aggregateMaxKeyUtf8Bytes: RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1.maxKeyBytes,
  entryMaxUtf8Bytes: RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxSerializedBytes,
  entryMaxDepth: RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxDepth,
  entryMaxNodes: RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxNodes,
  entryMaxObjectProperties:
    RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxObjectProperties,
  entryMaxArrayItems: RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxArrayItems,
  entryMaxStringUtf8Bytes: RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxStringBytes,
  entryMaxKeyUtf8Bytes: RETAINED_EVIDENCE_ENTRY_BOUNDS_V1.maxKeyBytes,
  eventIdMaxUtf8Bytes: 1_024,
  typeMaxUtf8Bytes: 256,
  payloadMaxUtf8Bytes: RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxSerializedBytes,
  payloadMaxDepth: RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxDepth,
  payloadMaxNodes: RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxNodes,
  payloadMaxObjectProperties:
    RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxObjectProperties,
  payloadMaxArrayItems: RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxArrayItems,
  payloadMaxStringUtf8Bytes: RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxStringBytes,
  payloadMaxKeyUtf8Bytes: RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1.maxKeyBytes,
} as const;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) {
      bytes += 1;
    } else if (codeUnit < 0x800) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Language-neutral V1 normalization for attachment metadata field names. */
export const INLINE_ATTACHMENT_PAYLOAD_KEY_NORMALIZATION_V1 = {
  unicodeNormalization: "NFKC",
  caseNormalization: "lowercase",
  ignoredCodePointClasses: [
    "White_Space",
    "Dash_Punctuation",
    "Connector_Punctuation",
  ],
} as const;

export const INLINE_ATTACHMENT_PAYLOAD_FORBIDDEN_NORMALIZED_KEYS_V1 = [
  "body",
  "content",
  "data",
  "bytes",
  "payload",
  "inlinebody",
  "inlinecontent",
  "inlinedata",
  "inlinepayload",
] as const;

export const INLINE_ATTACHMENT_PAYLOAD_FORBIDDEN_NORMALIZED_KEY_SUFFIXES_V1 = [
  "bytes",
] as const;

export const INLINE_ATTACHMENT_PAYLOAD_FORBIDDEN_NORMALIZED_KEY_FRAGMENTS_V1 = [
  "base64",
] as const;

const ignoredAttachmentPayloadKeyCodePoints =
  /[\p{White_Space}\p{Dash_Punctuation}\p{Connector_Punctuation}]/gu;

export function normalizeInlineAttachmentPayloadKeyV1(key: string): string {
  return key
    .normalize(
      INLINE_ATTACHMENT_PAYLOAD_KEY_NORMALIZATION_V1.unicodeNormalization,
    )
    .toLowerCase()
    .replaceAll(ignoredAttachmentPayloadKeyCodePoints, "");
}

export function isInlineAttachmentPayloadKey(key: string): boolean {
  const normalized = normalizeInlineAttachmentPayloadKeyV1(key);
  return (
    INLINE_ATTACHMENT_PAYLOAD_FORBIDDEN_NORMALIZED_KEYS_V1.some(
      (forbidden) => normalized === forbidden,
    ) ||
    INLINE_ATTACHMENT_PAYLOAD_FORBIDDEN_NORMALIZED_KEY_SUFFIXES_V1.some(
      (suffix) => normalized.endsWith(suffix),
    ) ||
    INLINE_ATTACHMENT_PAYLOAD_FORBIDDEN_NORMALIZED_KEY_FRAGMENTS_V1.some(
      (fragment) => normalized.includes(fragment),
    )
  );
}

export function validateJsonTreeBoundsV1(
  value: unknown,
  bounds: JsonTreeBoundsV1,
): readonly JsonTreeBoundsIssueV1[] {
  try {
    return validateJsonTreeBoundsUnchecked(value, bounds);
  } catch {
    return [createInvalidJsonIssue([])];
  }
}

interface JsonPathNode {
  readonly parent: JsonPathNode | undefined;
  readonly segment: string | number;
}

interface JsonValueFrame {
  readonly kind: "value";
  readonly value: unknown;
  readonly path: JsonPathNode | undefined;
  readonly depth: number;
}

interface JsonExitFrame {
  readonly kind: "exit";
  readonly value: object;
}

type JsonTraversalFrame = JsonValueFrame | JsonExitFrame;

function validateJsonTreeBoundsUnchecked(
  value: unknown,
  bounds: JsonTreeBoundsV1,
): readonly JsonTreeBoundsIssueV1[] {
  const issues: JsonTreeBoundsIssueV1[] = [];
  let nodeCount = 0;
  let nodeLimitReported = false;
  let depthLimitReported = false;
  let serializedBytes = 0;
  const ancestors = new WeakSet<object>();
  const stack: JsonTraversalFrame[] = [
    { kind: "value", value, path: undefined, depth: 1 },
  ];

  function addSerializedBytes(bytes: number): void {
    serializedBytes += bytes;
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }

    const { value: current, path, depth } = frame;
    nodeCount += 1;
    if (nodeCount > bounds.maxNodes && !nodeLimitReported) {
      nodeLimitReported = true;
      issues.push(
        createIssue("nodes", materializePath(path), nodeCount, bounds.maxNodes),
      );
    }

    if (depth > bounds.maxDepth && !depthLimitReported) {
      depthLimitReported = true;
      issues.push(
        createIssue("depth", materializePath(path), depth, bounds.maxDepth),
      );
    }

    if (typeof current === "string") {
      const stringBytes = utf8ByteLength(current);
      addSerializedBytes(jsonStringByteLength(current));
      if (stringBytes > bounds.maxStringBytes) {
        issues.push(
          createIssue(
            "string_bytes",
            materializePath(path),
            stringBytes,
            bounds.maxStringBytes,
          ),
        );
      }
      continue;
    }

    if (current === null) {
      addSerializedBytes(4);
      continue;
    }
    if (typeof current === "boolean") {
      addSerializedBytes(current ? 4 : 5);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        issues.push(createInvalidJsonIssue(materializePath(path)));
      } else {
        addSerializedBytes(String(Object.is(current, -0) ? 0 : current).length);
      }
      continue;
    }
    if (typeof current !== "object") {
      issues.push(createInvalidJsonIssue(materializePath(path)));
      continue;
    }
    if (ancestors.has(current)) {
      issues.push(createInvalidJsonIssue(materializePath(path)));
      continue;
    }

    const mayDescendIntoContainers =
      depth <= bounds.maxDepth && nodeCount <= bounds.maxNodes;

    if (Array.isArray(current)) {
      if (current.length > bounds.maxArrayItems) {
        issues.push(
          createIssue(
            "array_items",
            materializePath(path),
            current.length,
            bounds.maxArrayItems,
          ),
        );
      }
      const ownKeys = Reflect.ownKeys(current);
      if (
        ownKeys.some((key) => typeof key !== "string") ||
        ownKeys.length !== current.length + 1 ||
        !Object.hasOwn(current, "length")
      ) {
        issues.push(createInvalidJsonIssue(materializePath(path)));
        continue;
      }
      let arrayIsJson = true;
      for (let index = 0; index < current.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          arrayIsJson = false;
          break;
        }
      }
      if (!arrayIsJson) {
        issues.push(createInvalidJsonIssue(materializePath(path)));
        continue;
      }

      addSerializedBytes(2 + Math.max(0, current.length - 1));
      ancestors.add(current);
      stack.push({ kind: "exit", value: current });
      const visitedItems = Math.min(current.length, bounds.maxArrayItems + 1);
      for (let index = visitedItems - 1; index >= 0; index -= 1) {
        const item = current[index];
        if (
          !mayDescendIntoContainers &&
          item !== null &&
          typeof item === "object"
        ) {
          continue;
        }
        stack.push({
          kind: "value",
          value: item,
          path: { parent: path, segment: index },
          depth: depth + 1,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push(createInvalidJsonIssue(materializePath(path)));
      continue;
    }

    const ownKeys = Reflect.ownKeys(current);
    const keys = Object.keys(current);
    if (
      ownKeys.some((key) => typeof key !== "string") ||
      ownKeys.length !== keys.length
    ) {
      issues.push(createInvalidJsonIssue(materializePath(path)));
      continue;
    }
    if (keys.length > bounds.maxObjectProperties) {
      issues.push(
        createIssue(
          "object_properties",
          materializePath(path),
          keys.length,
          bounds.maxObjectProperties,
        ),
      );
    }

    addSerializedBytes(2 + Math.max(0, keys.length - 1) + keys.length);
    ancestors.add(current);
    stack.push({ kind: "exit", value: current });
    const visitedKeys = keys.slice(0, bounds.maxObjectProperties + 1);
    for (let index = visitedKeys.length - 1; index >= 0; index -= 1) {
      const key = visitedKeys[index];
      if (key === undefined) continue;
      const childPath: JsonPathNode = { parent: path, segment: key };
      if (key === "__proto__") {
        issues.push(createInvalidJsonIssue(materializePath(childPath)));
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        issues.push(createInvalidJsonIssue(materializePath(childPath)));
        continue;
      }
      const keyBytes = utf8ByteLength(key);
      addSerializedBytes(jsonStringByteLength(key));
      if (keyBytes > bounds.maxKeyBytes) {
        issues.push(
          createIssue(
            "key_bytes",
            materializePath(childPath),
            keyBytes,
            bounds.maxKeyBytes,
          ),
        );
      }
      if (
        !mayDescendIntoContainers &&
        descriptor.value !== null &&
        typeof descriptor.value === "object"
      ) {
        continue;
      }
      stack.push({
        kind: "value",
        value: descriptor.value,
        path: childPath,
        depth: depth + 1,
      });
    }
  }

  if (serializedBytes > bounds.maxSerializedBytes) {
    issues.unshift(
      createIssue(
        "serialized_bytes",
        [],
        serializedBytes,
        bounds.maxSerializedBytes,
      ),
    );
  }
  return issues;
}

function materializePath(path: JsonPathNode | undefined): (string | number)[] {
  const result: (string | number)[] = [];
  for (let current = path; current !== undefined; current = current.parent) {
    result.push(current.segment);
  }
  result.reverse();
  return result;
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      bytes += 2;
    } else if (
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      bytes += 2;
    } else if (codeUnit < 0x20) {
      bytes += 6;
    } else if (codeUnit < 0x80) {
      bytes += 1;
    } else if (codeUnit < 0x800) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function createInvalidJsonIssue(
  path: readonly (string | number)[],
): JsonTreeBoundsIssueV1 {
  return {
    code: "invalid_json",
    path,
    actual: 1,
    limit: 0,
    message: "Expected an acyclic JSON value with data-only properties.",
  };
}

export function validateAttachmentMetadataV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  const issues = validateJsonTreeBoundsV1(
    value,
    ATTACHMENT_METADATA_BOUNDS_V1,
  ).map((issue) => contextualizeTreeIssue(issue, "attachment_metadata"));

  if (issues.length > 0) return issues;

  const stack: { value: unknown; path: readonly (string | number)[] }[] = [
    { value, path: [] },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { value: current, path } = frame;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current[index], path: [...path, index] });
      }
      continue;
    }
    if (current === null || typeof current !== "object") continue;

    for (const [key, item] of Object.entries(current)) {
      if (isInlineAttachmentPayloadKey(key)) {
        const issue = createIssue(
          "inline_payload_key",
          [...path, key],
          utf8ByteLength(key),
          0,
        );
        issues.push({
          ...issue,
          message: `Attachment metadata field ${key} may contain inline payload data.`,
        });
      }
      stack.push({ value: item, path: [...path, key] });
    }
  }

  return issues;
}

export function validateTerminalErrorDetailsV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  return validateJsonTreeBoundsV1(value, TERMINAL_ERROR_DETAILS_BOUNDS_V1).map(
    (issue) => contextualizeTreeIssue(issue, "terminal_error_details"),
  );
}

export function validateRetainedEvidencePayloadV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  return validateJsonTreeBoundsV1(value, RETAINED_EVIDENCE_PAYLOAD_BOUNDS_V1);
}

export function validateRetainedEvidenceEntryV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  return validateJsonTreeBoundsV1(value, RETAINED_EVIDENCE_ENTRY_BOUNDS_V1);
}

export function validateRetainedEvidenceAggregateV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  return validateJsonTreeBoundsV1(value, RETAINED_EVIDENCE_AGGREGATE_BOUNDS_V1);
}

function createIssue(
  code: JsonTreeBoundsIssueV1["code"],
  path: readonly (string | number)[],
  actual: number,
  limit: number,
): JsonTreeBoundsIssueV1 {
  const subject = code.replaceAll("_", " ");
  return {
    code,
    path,
    actual,
    limit,
    message: `${subject} limit ${limit} exceeded by ${actual}.`,
  };
}

function contextualizeTreeIssue(
  issue: JsonTreeBoundsIssueV1,
  context: "attachment_metadata" | "terminal_error_details",
): JsonTreeBoundsIssueV1 {
  const attachment = context === "attachment_metadata";
  let message: string;
  switch (issue.code) {
    case "invalid_json":
      message = issue.message;
      break;
    case "serialized_bytes":
      message = attachment
        ? `Attachment metadata exceed ${issue.limit} UTF-8 bytes.`
        : `Terminal error details exceed ${issue.limit} UTF-8 bytes.`;
      break;
    case "depth":
      message = attachment
        ? `Attachment metadata exceed depth ${issue.limit}.`
        : `Terminal error details exceed depth ${issue.limit}.`;
      break;
    case "nodes":
      message = attachment
        ? `Attachment metadata exceed ${issue.limit} nodes.`
        : `Terminal error details exceed ${issue.limit} nodes.`;
      break;
    case "object_properties":
      message = attachment
        ? `Attachment metadata object exceeds ${issue.limit} properties.`
        : `Terminal error detail object exceeds ${issue.limit} properties.`;
      break;
    case "array_items":
      message = attachment
        ? `Attachment metadata array exceeds ${issue.limit} items.`
        : `Terminal error detail array exceeds ${issue.limit} items.`;
      break;
    case "string_bytes":
      message = attachment
        ? `Attachment metadata string exceeds ${issue.limit} UTF-8 bytes.`
        : `Terminal error detail string exceeds ${issue.limit} UTF-8 bytes.`;
      break;
    case "key_bytes":
      message = attachment
        ? `Attachment metadata key exceeds ${issue.limit} UTF-8 bytes.`
        : `Terminal error detail key exceeds ${issue.limit} UTF-8 bytes.`;
      break;
    case "inline_payload_key":
      message = issue.message;
      break;
  }
  return { ...issue, message };
}
