import * as path from "node:path";
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { findCopilotKitNodes } from "../find-copilotkit";
import { serializeJsxProps } from "../serialize-props";

const fx = (name: string) => path.join(__dirname, "fixtures", name);
const read = (name: string) => fs.readFileSync(fx(name), "utf-8");

describe("serializeJsxProps", () => {
  it("serializes string literals and nested object literals", () => {
    const src = read("inline-function-prop.tsx");
    const [node] = findCopilotKitNodes(fx("inline-function-prop.tsx"), src);
    const props = serializeJsxProps(node.openingElement, src);
    expect(props.runtimeUrl).toBe("/api/copilotkit");
    expect(props.properties).toEqual({ tenant: "acme", nested: { x: 1 } });
    expect(props.headers).toEqual({ "x-user": "alice" });
  });

  it("marks inline functions as unserializable with source preserved", () => {
    const src = read("inline-function-prop.tsx");
    const [node] = findCopilotKitNodes(fx("inline-function-prop.tsx"), src);
    const props = serializeJsxProps(node.openingElement, src);
    expect(props.onError).toMatchObject({
      __unserializable: true,
      reason: expect.stringContaining("function"),
    });
    expect(
      (props.onError as { source: string }).source,
    ).toContain("console.error");
  });

  it("marks identifier references as unserializable", () => {
    const src = read("inline-function-prop.tsx");
    const [node] = findCopilotKitNodes(fx("inline-function-prop.tsx"), src);
    const props = serializeJsxProps(node.openingElement, src);
    expect(props.publicApiKey).toMatchObject({
      __unserializable: true,
      reason: expect.stringContaining("identifier"),
      source: "api.key",
    });
  });
});
