import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import type { ComponentType, ReactNode } from "react";

import { MdxCodeBlock } from "@/components/mdx-code-block";
import { PartialLoader } from "../mdx-registry-loader";

test("the raw source completes a partially streamed highlighted tree", () => {
  const markup = renderToStaticMarkup(
    <MdxCodeBlock data-raw-code={"  const first = 1;\n  const complete = 2;"}>
      <code>{"  const first = 1;"}</code>
    </MdxCodeBlock>,
  );

  expect(markup).toContain("const complete = 2;");
  expect(markup).not.toContain("data-raw-code");
});

test("partial MDX code blocks consume the raw source attribute", async () => {
  const components: Record<string, ComponentType<Record<string, unknown>>> = {
    Callout: ({ children }) => <div>{children as ReactNode}</div>,
  };
  const result = await PartialLoader({
    relativePath: "use-client-callout.mdx",
    components,
  });

  expect(result).not.toBeNull();
  const { prelude } = await prerender(result);
  const markup = await new Response(prelude).text();
  expect(markup).toContain("use client");
  expect(markup).not.toContain("data-raw-code");
});
