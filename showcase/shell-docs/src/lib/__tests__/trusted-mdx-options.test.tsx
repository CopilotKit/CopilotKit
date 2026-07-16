import { renderToStaticMarkup } from "react-dom/server";
import { MDXRemote } from "next-mdx-remote/rsc";
import { describe, expect, it } from "vitest";
import { createTrustedMdxRemoteOptions } from "../trusted-mdx-options";

describe("createTrustedMdxRemoteOptions", () => {
  it("preserves trusted MDX expression props for IframeSwitcher snippets", async () => {
    const element = await MDXRemote({
      source: `
<IframeSwitcher
  exampleUrl={\`https://feature-viewer.copilotkit.ai/\${props.framework || "langgraph"}/generative-ui/tool-rendering\`}
  codeUrl={\`https://github.com/CopilotKit/CopilotKit/tree/main/examples/\${props.framework || "langgraph"}\`}
/>
`,
      components: {
        IframeSwitcher: ({
          exampleUrl,
          codeUrl,
        }: {
          exampleUrl?: string;
          codeUrl?: string;
        }) => <div data-example-url={exampleUrl} data-code-url={codeUrl} />,
      },
      options: createTrustedMdxRemoteOptions({
        mdxOptions: {},
      }),
    });

    const html = renderToStaticMarkup(element);

    expect(html).toContain(
      'data-example-url="https://feature-viewer.copilotkit.ai/langgraph/generative-ui/tool-rendering"',
    );
    expect(html).toContain(
      'data-code-url="https://github.com/CopilotKit/CopilotKit/tree/main/examples/langgraph"',
    );
  });

  it("keeps dangerous expression filtering enabled", () => {
    expect(createTrustedMdxRemoteOptions({ mdxOptions: {} })).toMatchObject({
      blockJS: false,
      blockDangerousJS: true,
    });
  });
});
