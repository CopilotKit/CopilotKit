import { describe, expect, test } from "vitest";
import type {
  JsonTreeBoundsIssueV1,
  JsonTreeBoundsV1,
} from "./snapshot-evidence-bounds.js";
import {
  ATTACHMENT_METADATA_BOUNDS_V1,
  RUN_SNAPSHOT_ATTACHMENT_LIMITS_V1,
  RUN_SNAPSHOT_TERMINAL_ERROR_LIMITS_V1,
  TERMINAL_ERROR_DETAILS_BOUNDS_V1,
  isInlineAttachmentPayloadKey,
  utf8ByteLength,
  validateAttachmentMetadataV1,
  validateJsonTreeBoundsV1,
  validateTerminalErrorDetailsV1,
} from "./snapshot-evidence-bounds.js";

const UNBOUNDED_TREE: JsonTreeBoundsV1 = {
  maxSerializedBytes: Number.MAX_SAFE_INTEGER,
  maxDepth: Number.MAX_SAFE_INTEGER,
  maxNodes: Number.MAX_SAFE_INTEGER,
  maxObjectProperties: Number.MAX_SAFE_INTEGER,
  maxArrayItems: Number.MAX_SAFE_INTEGER,
  maxStringBytes: Number.MAX_SAFE_INTEGER,
  maxKeyBytes: Number.MAX_SAFE_INTEGER,
};

function bounds(overrides: Partial<JsonTreeBoundsV1>): JsonTreeBoundsV1 {
  return { ...UNBOUNDED_TREE, ...overrides };
}

function issuesFor(
  value: unknown,
  overrides: Partial<JsonTreeBoundsV1>,
): readonly JsonTreeBoundsIssueV1[] {
  return validateJsonTreeBoundsV1(value, bounds(overrides));
}

function codes(
  issues: readonly JsonTreeBoundsIssueV1[],
): readonly JsonTreeBoundsIssueV1["code"][] {
  return issues.map((issue) => issue.code);
}

describe("snapshot evidence limits", () => {
  test("publishes the exact attachment limits", () => {
    expect(RUN_SNAPSHOT_ATTACHMENT_LIMITS_V1).toEqual({
      maxEntries: 32,
      providerMaxUtf8Bytes: 64,
      resourceMaxUtf8Bytes: 1_024,
      keyMaxUtf8Bytes: 4_096,
      versionMaxUtf8Bytes: 512,
      nameMaxUtf8Bytes: 1_024,
      mediaTypeMaxUtf8Bytes: 255,
      checksumAlgorithmMaxUtf8Bytes: 64,
      checksumValueMaxUtf8Bytes: 512,
      metadataMaxUtf8Bytes: 16_384,
      metadataMaxDepth: 6,
      metadataMaxNodes: 128,
      metadataMaxObjectProperties: 32,
      metadataMaxArrayItems: 32,
      metadataMaxStringUtf8Bytes: 2_048,
      metadataMaxKeyUtf8Bytes: 128,
    });
    expect(ATTACHMENT_METADATA_BOUNDS_V1).toEqual({
      maxSerializedBytes: 16_384,
      maxDepth: 6,
      maxNodes: 128,
      maxObjectProperties: 32,
      maxArrayItems: 32,
      maxStringBytes: 2_048,
      maxKeyBytes: 128,
    });
  });

  test("publishes the exact terminal error limits", () => {
    expect(RUN_SNAPSHOT_TERMINAL_ERROR_LIMITS_V1).toEqual({
      messageMaxUtf8Bytes: 4_096,
      codeMaxUtf8Bytes: 256,
      categoryMaxUtf8Bytes: 256,
      stackMaxUtf8Bytes: 16_384,
      detailsMaxUtf8Bytes: 32_768,
      detailsMaxDepth: 8,
      detailsMaxNodes: 256,
      detailsMaxObjectProperties: 64,
      detailsMaxArrayItems: 64,
      detailsMaxStringUtf8Bytes: 4_096,
      detailsMaxKeyUtf8Bytes: 256,
    });
    expect(TERMINAL_ERROR_DETAILS_BOUNDS_V1).toEqual({
      maxSerializedBytes: 32_768,
      maxDepth: 8,
      maxNodes: 256,
      maxObjectProperties: 64,
      maxArrayItems: 64,
      maxStringBytes: 4_096,
      maxKeyBytes: 256,
    });
  });
});

describe("utf8ByteLength", () => {
  test("counts UTF-8 bytes instead of UTF-16 code units", () => {
    expect("é".repeat(32)).toHaveLength(32);
    expect(utf8ByteLength("é".repeat(32))).toBe(64);
  });
});

describe("validateJsonTreeBoundsV1", () => {
  test("counts a scalar root as depth one and node one", () => {
    expect(
      validateJsonTreeBoundsV1(null, {
        ...UNBOUNDED_TREE,
        maxDepth: 1,
        maxNodes: 1,
      }),
    ).toEqual([]);
  });

  test("accepts serialized bytes at the limit and rejects one byte over", () => {
    expect(codes(issuesFor("xx", { maxSerializedBytes: 4 }))).not.toContain(
      "serialized_bytes",
    );
    expect(codes(issuesFor("xxx", { maxSerializedBytes: 4 }))).toContain(
      "serialized_bytes",
    );
  });

  test("accepts depth at the limit and rejects one level over", () => {
    expect(codes(issuesFor([[null]], { maxDepth: 3 }))).not.toContain("depth");
    expect(codes(issuesFor([[[null]]], { maxDepth: 3 }))).toContain("depth");
  });

  test("accepts total nodes at the limit and reports overflow once", () => {
    expect(codes(issuesFor([null, null], { maxNodes: 3 }))).not.toContain(
      "nodes",
    );
    expect(codes(issuesFor([null, null, null], { maxNodes: 3 }))).toEqual([
      "nodes",
    ]);
  });

  test("accepts object properties at the limit and rejects one over", () => {
    expect(
      codes(issuesFor({ a: null, b: null }, { maxObjectProperties: 2 })),
    ).not.toContain("object_properties");
    expect(
      codes(
        issuesFor({ a: null, b: null, c: null }, { maxObjectProperties: 2 }),
      ),
    ).toContain("object_properties");
  });

  test("accepts array items at the limit and rejects one over", () => {
    expect(codes(issuesFor([null, null], { maxArrayItems: 2 }))).not.toContain(
      "array_items",
    );
    expect(
      codes(issuesFor([null, null, null], { maxArrayItems: 2 })),
    ).toContain("array_items");
  });

  test("accepts string bytes at the limit and rejects one byte over", () => {
    expect(
      codes(issuesFor("é".repeat(2), { maxStringBytes: 4 })),
    ).not.toContain("string_bytes");
    expect(
      codes(issuesFor(`${"é".repeat(2)}a`, { maxStringBytes: 4 })),
    ).toContain("string_bytes");
  });

  test("accepts key bytes at the limit and rejects one byte over", () => {
    expect(codes(issuesFor({ éé: null }, { maxKeyBytes: 4 }))).not.toContain(
      "key_bytes",
    );
    expect(codes(issuesFor({ ééa: null }, { maxKeyBytes: 4 }))).toContain(
      "key_bytes",
    );
  });

  test("returns every independent issue while reporting node overflow once", () => {
    const issues = issuesFor(
      { oversizedKey: ["oversized", "also oversized"] },
      {
        maxSerializedBytes: 1,
        maxDepth: 1,
        maxNodes: 1,
        maxObjectProperties: 0,
        maxArrayItems: 1,
        maxStringBytes: 1,
        maxKeyBytes: 1,
      },
    );

    expect(new Set(codes(issues))).toEqual(
      new Set([
        "serialized_bytes",
        "object_properties",
        "key_bytes",
        "nodes",
        "depth",
        "array_items",
        "string_bytes",
      ]),
    );
    expect(codes(issues).filter((code) => code === "nodes")).toHaveLength(1);
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
  });
});

describe("attachment metadata payload rejection", () => {
  test.each([
    "body",
    "CONTENT",
    "Data",
    "bytes",
    "dataBase64",
    "payload_bytes",
    "response-bytes",
    "Mixed_Case_Base64_Value",
  ])("recognizes inline payload alias %s", (key) => {
    expect(isInlineAttachmentPayloadKey(key)).toBe(true);
  });

  test.each(["database", "byteLength", "contentType", "payloadRef"])(
    "does not reject non-payload key %s",
    (key) => {
      expect(isInlineAttachmentPayloadKey(key)).toBe(false);
    },
  );

  test.each([
    ["dataBase64", { envelope: { dataBase64: "AA==" } }],
    ["payload_bytes", { envelope: [{ payload_bytes: "AA==" }] }],
    ["response-bytes", { envelope: { nested: { "response-bytes": "AA==" } } }],
    ["mixed case", { envelope: { Mixed_Case_Base64_Value: "AA==" } }],
  ])("rejects recursive normalized %s aliases", (_name, metadata) => {
    expect(codes(validateAttachmentMetadataV1(metadata))).toContain(
      "inline_payload_key",
    );
  });

  test("applies attachment metadata tree bounds", () => {
    const issues = validateAttachmentMetadataV1("x".repeat(2_049));
    expect(codes(issues)).toContain("string_bytes");
    expect(issues.find((issue) => issue.code === "string_bytes")?.message).toBe(
      "Attachment metadata string exceeds 2048 UTF-8 bytes.",
    );
  });

  test("does not apply attachment-only payload aliases to terminal details", () => {
    expect(
      codes(validateTerminalErrorDetailsV1({ dataBase64: "AA==" })),
    ).not.toContain("inline_payload_key");
  });

  test("applies terminal details tree bounds", () => {
    const issues = validateTerminalErrorDetailsV1("x".repeat(4_097));
    expect(codes(issues)).toContain("string_bytes");
    expect(issues.find((issue) => issue.code === "string_bytes")?.message).toBe(
      "Terminal error detail string exceeds 4096 UTF-8 bytes.",
    );
  });
});
