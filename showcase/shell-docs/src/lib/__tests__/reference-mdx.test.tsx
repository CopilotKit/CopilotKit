import { readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { MDXRemote } from "next-mdx-remote/rsc";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import { applySnippetData, SNIPPETS_DIR } from "../docs-render";
import {
  prepareReferenceSource,
  referenceMdxComponents,
  referenceMdxOptions,
  referenceSnippetSlug,
} from "../reference-mdx";

const channelsDir = path.join(SNIPPETS_DIR, "shared/channels");
const pair = JSON.parse(
  readFileSync(path.join(channelsDir, "sdk-pair.json"), "utf8"),
) as { channels: string; runtime: string };

async function renderReference(contentSlug: string): Promise<string> {
  const raw = readFileSync(
    new URL(`../../content/reference/${contentSlug}.mdx`, import.meta.url),
    "utf8",
  );
  const source = prepareReferenceSource(matter(raw).content, contentSlug);
  const element = await MDXRemote({
    source,
    components: referenceMdxComponents,
    options: referenceMdxOptions,
  });
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

describe("reference pages with shared snippets", () => {
  it("uses the docs component registry and the docs slug form", () => {
    for (const name of ["Tabs", "Steps", "Snippet", "FrameworkSetup"]) {
      expect(referenceMdxComponents, name).toHaveProperty(name);
    }
    expect(referenceSnippetSlug("channels/index")).toBe(
      "reference/channels/index",
    );
  });

  it.each(["channels/index", "channels/sdk/direct-adapters"])(
    "renders the shared Channels install on %s",
    async (contentSlug) => {
      const markup = await renderReference(contentSlug);
      const rendered = text(markup);

      expect(rendered).toContain(
        `npm install --save-exact @copilotkit/channels@${pair.channels} @copilotkit/runtime@${pair.runtime}`,
      );
      expect(rendered).toContain("These two versions are the tested pair.");
      expect(markup).not.toContain("ChannelsSdkInstall");
      expect(markup).not.toContain("{{");
    },
  );
});

describe("snippet data", () => {
  const snippetPath = path.join(channelsDir, "install-sdk-pair.mdx");

  it("leaves snippets without a data file unchanged", () => {
    expect(applySnippetData("{{channels}}", snippetPath)).toBe("{{channels}}");
  });

  it("rejects a key the data file does not define", () => {
    expect(() =>
      applySnippetData(
        "---\ndata: sdk-pair.json\n---\n{{unknown}}",
        snippetPath,
      ),
    ).toThrow(/"unknown" is missing from sdk-pair\.json/);
  });

  it("rejects a data file that does not exist or leaves the snippets tree", () => {
    for (const file of ["missing.json", "../../../../package.json"]) {
      expect(() =>
        applySnippetData(`---\ndata: ${file}\n---\n{{channels}}`, snippetPath),
      ).toThrow(/snippet data file not found/);
    }
  });
});
