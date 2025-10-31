import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RenderLeafProps } from "slate-react";
import { makeRenderLeafFunction } from "./render-leaf";

const baseAttributes = { "data-slate-leaf": true } as RenderLeafProps["attributes"];

function createProps(
  overrides: Partial<RenderLeafProps["leaf"]>,
  children: React.ReactNode = "text",
): RenderLeafProps {
  return {
    attributes: baseAttributes,
    children,
    leaf: {
      text: "text",
      ...overrides,
    },
    // `text` prop is deprecated but still part of the type; keep for compatibility.
    text: {
      text: "text",
      ...overrides,
    },
  } as RenderLeafProps;
}

describe("makeRenderLeafFunction", () => {
  it("wraps bold and italic marks", () => {
    const renderLeaf = makeRenderLeafFunction();
    const element = renderLeaf(createProps({ bold: true, italic: true }));
    const html = renderToStaticMarkup(element);
    expect(html).toContain("<span data-slate-leaf=\"true\"><em><strong>text</strong></em></span>");
  });

  it("renders plain text when no marks are set", () => {
    const renderLeaf = makeRenderLeafFunction();
    const element = renderLeaf(createProps({}));
    const html = renderToStaticMarkup(element);
    expect(html).toBe('<span data-slate-leaf="true">text</span>');
  });
});
