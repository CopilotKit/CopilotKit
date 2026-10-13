import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { docsComponents } from "@/lib/mdx-registry";

test("Angular Strands sub-agent Code tab shows Angular source and shared backend", () => {
  const InlineDemo = docsComponents.InlineDemo;
  const angular = renderToStaticMarkup(
    <InlineDemo
      integration="strands-typescript"
      demo="subagents"
      frontend="angular"
    />,
  );
  const react = renderToStaticMarkup(
    <InlineDemo integration="strands-typescript" demo="subagents" />,
  );

  expect(angular).toContain("agent-state-feature.component.ts");
  expect(angular).toContain("agent-state-cards.ts");
  expect(angular).toContain("subagent-renderer-config.ts");
  expect(angular).toContain("src/agent/agent.ts");
  expect(angular).not.toContain("delegation-log.tsx");
  expect(angular).not.toContain("src/app/demos/subagents/page.tsx");

  expect(react).toContain("delegation-log.tsx");
  expect(react).toContain("src/app/demos/subagents/page.tsx");
});
