import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import matter from "gray-matter";
import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { inlineSnippets, stripLeadingImports } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const install =
  "npm install --save-exact @copilotkit/channels@0.11.0 @copilotkit/runtime@1.73.3";
const pages = [
  "docs/frontends/slack",
  "docs/frontends/teams",
  "docs/channels/deploy-and-operate",
  "reference/channels/index",
  "reference/channels/sdk/direct-adapters",
];

describe("Channels installation instructions", () => {
  it.each(pages)(
    "renders the shared tested command in Markdown for %s",
    (page) => {
      const filePath = resolve(`src/content/${page}.mdx`);
      const markdown = renderPageToLlmText({
        filePath,
        url: page,
        loadSlug: page.startsWith("reference/")
          ? page.replace("reference/", "__reference__/")
          : page.replace(/^docs\//, ""),
        title: page,
      });
      expect(markdown).toContain(install);
      expect(markdown).not.toContain("<ChannelsInstall");
    },
  );

  it("renders the shared install snippet as HTML", async () => {
    const source = readFileSync(
      resolve("src/content/reference/channels/sdk/direct-adapters.mdx"),
      "utf8",
    );
    const expanded = stripLeadingImports(
      inlineSnippets(matter(source).content),
    );
    const command = expanded.match(/```(?:sh|bash)[^\n]*\n([\s\S]*?)```/)?.[1];
    expect(command).toContain(install);
    const { content } = await compileMDX({
      source: `\`\`\`sh\n${command}\`\`\``,
    });
    expect(renderToStaticMarkup(content)).toContain(install);
  });
});
