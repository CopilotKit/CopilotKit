import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function readPublicAsset(relativePath: string) {
  return readFileSync(
    new URL(`../../../public/${relativePath}`, import.meta.url),
  );
}

describe("public image assets", () => {
  it("serves agentic protocol diagrams as real PNG files", () => {
    for (const assetPath of [
      "images/agui-ecosystem-light.png",
      "images/agui-ecosystem-dark.png",
      "images/any-agentic-backend-light.png",
      "images/any-agentic-backend-dark.png",
      "images/mcp-and-a2a-through-agui-light.png",
      "images/mcp-and-a2a-through-agui-dark.png",
    ]) {
      const bytes = readPublicAsset(assetPath);

      expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);
      expect(bytes.toString("utf8", 0, 32)).not.toContain(
        "version https://git-lfs",
      );
    }
  });

  it("serves the slack early-access gate previews as real PNG files", () => {
    for (const assetPath of [
      "images/slack-bot-generative-ui-light.png",
      "images/slack-bot-generative-ui-dark.png",
    ]) {
      const bytes = readPublicAsset(assetPath);

      expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);
      expect(bytes.toString("utf8", 0, 32)).not.toContain(
        "version https://git-lfs",
      );
    }
  });
});
