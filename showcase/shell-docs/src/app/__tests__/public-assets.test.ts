import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function readPublicAsset(relativePath: string) {
  return readFileSync(
    new URL(`../../../public/${relativePath}`, import.meta.url),
  );
}

describe("public image assets", () => {
  it("serves the official CopilotKit lockups for light and dark surfaces", () => {
    for (const assetPath of [
      "brand/copilot-kit-logo.svg",
      "brand/copilot-kit-logo-white.svg",
    ]) {
      const assetUrl = new URL(`../../../public/${assetPath}`, import.meta.url);

      expect(existsSync(assetUrl)).toBe(true);
      const svg = readPublicAsset(assetPath).toString("utf8");
      expect(svg).toMatch(/^<svg\b/);
      expect(svg).not.toContain("version https://git-lfs");
    }
  });

  it("keeps official brand and font assets byte-for-byte intact", () => {
    const approvedAssets = [
      {
        url: new URL(
          "../../../public/brand/copilot-kit-logo.svg",
          import.meta.url,
        ),
        sha256:
          "10c296cc0c00a1691a25da9dba81bb1afe3d713d309c321300567e0480858984",
      },
      {
        url: new URL(
          "../../../public/brand/copilot-kit-logo-white.svg",
          import.meta.url,
        ),
        sha256:
          "6f9a6a7ffd08f4bedf73916354ee025f1db4fa21e0a27d99023048a7bb62dc09",
      },
      {
        url: new URL(
          "../fonts/PlusJakartaSans-VariableFont_wght.woff2",
          import.meta.url,
        ),
        sha256:
          "aa8d3d5e35a3de9351bdf591d73d98097066d7e4ce091fafe722920bf05e285f",
      },
      {
        url: new URL(
          "../fonts/SplineSansMono-VariableFont_wght.woff2",
          import.meta.url,
        ),
        sha256:
          "cd17af47018bdbfc83b2806a009faaefc4def88e08734111b6398ca2b3544568",
      },
    ];

    for (const { url, sha256 } of approvedAssets) {
      const digest = createHash("sha256")
        .update(readFileSync(url))
        .digest("hex");

      expect(digest, url.pathname).toBe(sha256);
    }
  });

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
