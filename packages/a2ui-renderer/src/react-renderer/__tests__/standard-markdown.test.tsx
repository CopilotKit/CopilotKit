import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";
import {
  standardCatalog,
  STANDARD_CATALOG_ID,
} from "../a2ui-react/catalog/standard";
import { parseBlockMarkdown } from "../a2ui-react/catalog/standard/block-markdown";
import { renderStandard } from "./standard-test-utils";

function Surface({ ops }: { ops: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(ops as Array<Record<string, unknown>>);
  }, [ops, processMessages]);
  return <A2UIRenderer surfaceId="s" />;
}

const markdownOps = (text: string) => [
  {
    version: "v0.9",
    createSurface: { surfaceId: "s", catalogId: STANDARD_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "s",
      components: [{ id: "root", component: "Markdown", text }],
    },
  },
];

describe("standard catalog: Markdown component", () => {
  it("renders through the host's markdown renderer when the provider has one", async () => {
    const Host = ({ text }: { text: string }) => (
      <div data-host-markdown>{text.toUpperCase()}</div>
    );
    const v = render(
      <A2UIProvider catalog={standardCatalog} markdownRenderer={Host}>
        <Surface ops={markdownOps("# hello")} />
      </A2UIProvider>,
    );
    const host = await v.findByText("# HELLO");
    expect(host.hasAttribute("data-host-markdown")).toBe(true);
    expect(host.closest(".a2ui-markdown")).not.toBeNull();
    expect(v.container.querySelector("h1")).toBeNull();
  });

  it("falls back to the built-in block renderer without a host renderer", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Markdown",
        text: "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```js\nx = 1\n```\n\n---",
      },
    ]);
    expect((await v.findByText("Title")).tagName).toBe("H1");
    expect(v.container.querySelector("strong")!.textContent).toBe("bold");
    expect(v.container.querySelectorAll("ul li")).toHaveLength(2);
    expect(v.container.querySelectorAll("ol li")).toHaveLength(2);
    expect(v.getByText("quoted").tagName).toBe("BLOCKQUOTE");
    expect(v.getByText("x = 1").closest("pre")).not.toBeNull();
    expect(v.container.querySelector("hr")).not.toBeNull();
  });

  it("parses blocks: joins paragraph lines, keeps fences verbatim, no stray paragraphs", () => {
    expect(
      parseBlockMarkdown("a\nb\n\n```\n# not a heading\n```\n\n\n"),
    ).toEqual([
      { kind: "paragraph", text: "a b" },
      { kind: "code", text: "# not a heading" },
    ]);
  });
});
