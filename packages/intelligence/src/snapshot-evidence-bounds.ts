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

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isInlineAttachmentPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("-", "").replaceAll("_", "");
  return (
    normalized === "body" ||
    normalized === "content" ||
    normalized === "data" ||
    normalized === "bytes" ||
    normalized.endsWith("bytes") ||
    normalized.includes("base64")
  );
}

export function validateJsonTreeBoundsV1(
  value: unknown,
  bounds: JsonTreeBoundsV1,
): readonly JsonTreeBoundsIssueV1[] {
  const issues: JsonTreeBoundsIssueV1[] = [];
  const serialized = JSON.stringify(value);
  if (serialized !== undefined) {
    const serializedBytes = utf8ByteLength(serialized);
    if (serializedBytes > bounds.maxSerializedBytes) {
      issues.push(
        createIssue(
          "serialized_bytes",
          [],
          serializedBytes,
          bounds.maxSerializedBytes,
        ),
      );
    }
  }

  let nodeCount = 0;
  let nodeLimitReported = false;

  function visit(
    current: unknown,
    path: readonly (string | number)[],
    depth: number,
  ) {
    nodeCount += 1;
    if (nodeCount > bounds.maxNodes && !nodeLimitReported) {
      nodeLimitReported = true;
      issues.push(createIssue("nodes", path, nodeCount, bounds.maxNodes));
    }

    if (depth > bounds.maxDepth) {
      issues.push(createIssue("depth", path, depth, bounds.maxDepth));
    }

    if (typeof current === "string") {
      const stringBytes = utf8ByteLength(current);
      if (stringBytes > bounds.maxStringBytes) {
        issues.push(
          createIssue("string_bytes", path, stringBytes, bounds.maxStringBytes),
        );
      }
      return;
    }

    if (Array.isArray(current)) {
      if (current.length > bounds.maxArrayItems) {
        issues.push(
          createIssue(
            "array_items",
            path,
            current.length,
            bounds.maxArrayItems,
          ),
        );
      }
      for (const [index, item] of current.entries()) {
        visit(item, [...path, index], depth + 1);
      }
      return;
    }

    if (current === null || typeof current !== "object") return;

    const entries = Object.entries(current);
    if (entries.length > bounds.maxObjectProperties) {
      issues.push(
        createIssue(
          "object_properties",
          path,
          entries.length,
          bounds.maxObjectProperties,
        ),
      );
    }
    for (const [key, item] of entries) {
      const keyBytes = utf8ByteLength(key);
      if (keyBytes > bounds.maxKeyBytes) {
        issues.push(
          createIssue(
            "key_bytes",
            [...path, key],
            keyBytes,
            bounds.maxKeyBytes,
          ),
        );
      }
      visit(item, [...path, key], depth + 1);
    }
  }

  visit(value, [], 1);
  return issues;
}

export function validateAttachmentMetadataV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  const issues = validateJsonTreeBoundsV1(
    value,
    ATTACHMENT_METADATA_BOUNDS_V1,
  ).map((issue) => contextualizeTreeIssue(issue, "attachment_metadata"));

  function visit(current: unknown, path: readonly (string | number)[]) {
    if (Array.isArray(current)) {
      for (const [index, item] of current.entries()) {
        visit(item, [...path, index]);
      }
      return;
    }
    if (current === null || typeof current !== "object") return;

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
      visit(item, [...path, key]);
    }
  }

  visit(value, []);
  return issues;
}

export function validateTerminalErrorDetailsV1(
  value: unknown,
): readonly JsonTreeBoundsIssueV1[] {
  return validateJsonTreeBoundsV1(value, TERMINAL_ERROR_DETAILS_BOUNDS_V1).map(
    (issue) => contextualizeTreeIssue(issue, "terminal_error_details"),
  );
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
