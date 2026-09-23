import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { NoShowcaseDemoBox, UnsupportedBox } from "@/components/snippet";
import catalogData from "@/data/catalog.json";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { docsComponents } from "../mdx-registry";
import { getIntegrations } from "../registry";
import type { Integration } from "../registry";
import {
  hasShowcaseDemo,
  noShowcaseDemoMarkdown,
} from "../showcase-demo-availability";

// The error-recovery guide embeds one demo, so its Markdown and HTML can be
// compared one to one.
const GUIDE = "generative-ui/a2ui/error-recovery";
const DEMO = "a2ui-recovery";

interface CatalogCell {
  integration: string;
  integration_name?: string;
  feature: string;
  status: string;
}
const cells = (catalogData as { cells: CatalogCell[] }).cells;
const statusByKey = new Map(
  cells.map((cell) => [`${cell.integration}::${cell.feature}`, cell.status]),
);

function deployedWhere(
  predicate: (integration: Integration) => boolean,
): Integration {
  const found = getIntegrations().find(
    (integration) => integration.deployed && predicate(integration),
  );
  if (!found) throw new Error("no deployed integration matches");
  return found;
}

/** A deployed framework without the demo whose catalog cell isn't unsupported. */
const withoutDemo = deployedWhere(
  (integration) =>
    !hasShowcaseDemo(integration, DEMO) &&
    statusByKey.get(`${integration.slug}::${DEMO}`) !== "unsupported",
);
const withDemo = deployedWhere((integration) =>
  hasShowcaseDemo(integration, DEMO),
);

function inlineDemo(integration: string, demo: string): ReactElement | null {
  return docsComponents.InlineDemo({
    integration,
    demo,
  }) as ReactElement | null;
}

function guideMarkdown(framework: string): string {
  const doc = loadDoc(GUIDE);
  if (!doc) throw new Error(`missing guide ${GUIDE}`);
  return renderPageToLlmText(
    {
      url: `${framework}/${GUIDE}`,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug: GUIDE,
      framework,
    },
    { framework },
  );
}

describe("InlineDemo for a framework without that Showcase demo", () => {
  test("the HTML embed is a neutral notice, not an iframe or an unsupported box", () => {
    const element = inlineDemo(withoutDemo.slug, DEMO);
    expect(element?.type).toBe(NoShowcaseDemoBox);
    const html = renderToStaticMarkup(element!);
    expect(html).toContain("No Showcase demo for");
    expect(html).not.toContain("Not supported");
    expect(html).not.toContain("<iframe");
  });

  test("raw Markdown carries the same notice instead of a skip marker", () => {
    const markdown = guideMarkdown(withoutDemo.slug);
    const name =
      cells.find(
        (cell) =>
          cell.integration === withoutDemo.slug && cell.feature === DEMO,
      )?.integration_name ?? withoutDemo.name;
    expect(markdown).toContain(noShowcaseDemoMarkdown(name));
    expect(markdown).not.toContain("interactive demo skipped");
    expect(markdown).not.toContain("> **Not supported on");
  });

  test("a framework that ships the demo still embeds it", () => {
    const element = inlineDemo(withDemo.slug, DEMO);
    expect(element).not.toBeNull();
    expect(element?.type).not.toBe(NoShowcaseDemoBox);
    expect(element?.type).not.toBe(UnsupportedBox);
    expect(renderToStaticMarkup(element!)).toContain(`/demos/${DEMO}`);
    expect(guideMarkdown(withDemo.slug)).toContain(
      `<!-- interactive demo: ${DEMO} -->`,
    );
  });

  test("an unsupported pair keeps the unsupported box", () => {
    const unsupported = [...statusByKey.entries()].find(
      ([key, status]) =>
        status === "unsupported" &&
        getIntegrations().some(
          (integration) =>
            integration.deployed && integration.slug === key.split("::")[0],
        ),
    );
    expect(unsupported).toBeDefined();
    const [integration, demo] = unsupported![0].split("::");
    expect(inlineDemo(integration, demo)?.type).toBe(UnsupportedBox);
  });
});
