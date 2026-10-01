import { describe, it, expect } from "vitest";
import { ContentPartSchema } from "@ag-ui/core/schemas";
import { isContentPart } from "../tool-result-content";

const data = { type: "data", value: "iVBORw0KGgo=", mimeType: "image/png" };

const CASES: Array<[string, unknown]> = [
  ["text", { type: "text", text: "hi" }],
  [
    "text with id and metadata",
    { type: "text", text: "hi", id: "p1", metadata: {} },
  ],
  ["text with extra keys", { type: "text", text: "hi", extra: 1 }],
  ["text without text", { type: "text" }],
  ["text with a number", { type: "text", text: 1 }],
  ["text with a number id", { type: "text", text: "hi", id: 1 }],
  ["text with null metadata", { type: "text", text: "hi", metadata: null }],
  ["image from data", { type: "image", source: data }],
  ["audio from data", { type: "audio", source: data }],
  ["video from data", { type: "video", source: data }],
  ["document from data", { type: "document", source: data }],
  [
    "data without mimeType",
    { type: "image", source: { type: "data", value: "x" } },
  ],
  [
    "data with a number value",
    { type: "image", source: { ...data, value: 1 } },
  ],
  [
    "image from url",
    { type: "image", source: { type: "url", value: "https://x/y.png" } },
  ],
  [
    "url with mimeType",
    {
      type: "image",
      source: { type: "url", value: "u", mimeType: "image/png" },
    },
  ],
  [
    "url with a number mimeType",
    { type: "image", source: { type: "url", value: "u", mimeType: 1 } },
  ],
  ["url without value", { type: "image", source: { type: "url" } }],
  [
    "image from file",
    {
      type: "image",
      source: { type: "file", value: "file-1", provider: "openai" },
    },
  ],
  [
    "file with a number provider",
    { type: "image", source: { type: "file", value: "f", provider: 1 } },
  ],
  [
    "unknown source type",
    { type: "image", source: { type: "bogus", value: "x" } },
  ],
  ["image without source", { type: "image" }],
  ["image with null source", { type: "image", source: null }],
  ["image with null metadata", { type: "image", source: data, metadata: null }],
  ["unknown part type", { type: "row", id: "1" }],
  ["no type", { text: "hi" }],
  ["string", "hi"],
  ["null", null],
  ["array", [{ type: "text", text: "hi" }]],
];

describe("isContentPart", () => {
  it.each(CASES)("agrees with ContentPartSchema: %s", (_name, value) => {
    expect(isContentPart(value)).toBe(
      ContentPartSchema.safeParse(value).success,
    );
  });

  it("accepts and rejects cases, so the table tests both sides", () => {
    const results = CASES.map(([, value]) => isContentPart(value));
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});
