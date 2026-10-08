import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DemoSource } from "../demo-source";

test("JSON Render source tabs include the copyable frontend files", () => {
  for (const integration of [
    "google-adk",
    "strands-typescript",
    "langgraph-python",
  ]) {
    const html = renderToStaticMarkup(
      <DemoSource
        integration={integration}
        demo="declarative-json-render"
        onlyHighlighted={false}
      />,
    );

    for (const filename of [
      "chat.tsx",
      "json-render-renderer.tsx",
      "catalog.ts",
      "registry.tsx",
    ]) {
      expect(html).toContain(
        `title="src/app/demos/declarative-json-render/${filename}"`,
      );
    }
  }
});
