import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function loadRequiredDoc(slug: string) {
  const doc = loadDoc(slug);
  if (!doc) throw new Error(`${slug} is missing`);
  return doc;
}

function renderDoc(slug: string): string {
  const doc = loadRequiredDoc(slug);
  return renderPageToLlmText({
    url: slug,
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: slug,
  });
}

test("guides people and agents to a persistent Intelligence thread", () => {
  const source = loadRequiredDoc("intelligence/quickstart").source;
  const agentPrompt = source.indexOf("<RichThreadsSetupPrompt />");
  const manualSteps = source.indexOf("<Steps>");

  expect(agentPrompt).toBeGreaterThan(-1);
  expect(manualSteps).toBeGreaterThan(agentPrompt);
  expect(source).toContain("persist conversations reliably in production");
  expect(source).toContain("improve your agents over time");
  expect(source).toContain("AI analytics");
  expect(source).toContain("npx copilotkit@latest project select");
  expect(source).toContain("new CopilotKitIntelligence");
  expect(source).toContain("identifyUser");
  expect(source).toContain("export const DELETE = handler");
  expect(source).toContain("Intelligence connected");
  expect(source).toContain("Open **Threads** in Inspector");
  expect(source).toContain("**Messages** contains the message");
  expect(source).toContain('frontend="vue"');
  expect(source).toContain("@copilotkit/vue/v2");
  expect(source).toContain('frontend="angular"');
  expect(source).toContain("provideCopilotKit");
  expect(source).toContain('frontend="react-native"');
  expect(source).toContain("@copilotkit/react-native/headless");
  expect(source).toContain(
    "React Native does not include the browser Inspector",
  );
  expect(source).not.toContain(
    "Access to create or select an Intelligence project",
  );
  expect(source).toContain("/auth#thread-authorization");
  expect(source).toContain("threads/events");
  expect(source).not.toContain("curl -s");
});

test("expands the setup prompt for coding agents", () => {
  const output = renderDoc("intelligence/quickstart");

  expect(output).toContain("Copy this prompt into your coding agent");
  expect(output).toContain("finish setting up Rich Threads in this repository");
  expect(output).not.toContain("<RichThreadsSetupPrompt />");
});

test("links the Intelligence landing page to the quickstart", () => {
  const overview = renderDoc("intelligence/overview");

  expect(overview).toContain(
    "[CopilotKit Intelligence quickstart](/intelligence/quickstart)",
  );
});

test("forwards thread mutation methods in linked framework examples", () => {
  const source = loadRequiredDoc("runtime-server-adapter").source;
  const nextSection = source.slice(
    source.indexOf("## Next.js App Router"),
    source.indexOf("## React Router (Framework Mode)"),
  );
  const tanstackSection = source.slice(
    source.indexOf("## TanStack Start"),
    source.indexOf("## Hono"),
  );

  expect(nextSection).toContain("handler as PATCH");
  expect(nextSection).toContain("handler as DELETE");
  expect(tanstackSection).toContain("PATCH: ({ request }) => handler(request)");
  expect(tanstackSection).toContain(
    "DELETE: ({ request }) => handler(request)",
  );
});
