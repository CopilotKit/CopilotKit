import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { HighlightedDynamicCodeBlock } from "../highlighted-dynamic-codeblock";
import { VueDocExample } from "../vue-doc-example";

describe("VueDocExample", () => {
  it("renders canonical source through the shared code-block primitive", () => {
    const element = VueDocExample({
      file: "quickstart/App.vue",
      region: "provider-chat-app",
    }) as ReactElement<{
      lang: string;
      code: string;
    }>;

    expect(element.type).toBe(HighlightedDynamicCodeBlock);
    expect(element.props.lang).toBe("vue");
    expect(element.props.code).toContain("<CopilotChat");
  });

  it("renders an explicit diagnostic for unresolved references", () => {
    const element = VueDocExample({ file: "missing.vue" }) as ReactElement<{
      role: string;
      children: string;
    }>;

    expect(element.props.role).toBe("alert");
    expect(element.props.children).toContain("VueDocExample error");
  });
});
