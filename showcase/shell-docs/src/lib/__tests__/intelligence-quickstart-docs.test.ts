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
  expect(source).toContain(
    "You want AG-UI Streams, User Memory, Automatic Learning, Channels, and Product Analytics",
  );
  expect(source).toContain("Intelligence adds that layer");
  expect(source).toContain("npx copilotkit@latest project select");
  expect(source).toContain("new CopilotKitIntelligence");
  expect(source).toContain("identifyUser");
  expect(source).toContain('mode: "single-route"');
  expect(source).toContain("/runtime-server-adapter");
  expect(source).not.toContain("next.config.ts");
  expect(source).not.toContain("app/api/copilotkit/route.ts");
  expect(source).toContain("useSingleEndpoint");
  expect(source).toContain("Intelligence connected");
  expect(source).toContain("Open **Rich Threads** in Inspector");
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
  expect(output).toContain("--intent add-rich-threads");
  expect(output).not.toContain("<RichThreadsSetupPrompt />");
});

test("links the Intelligence landing page to the quickstart", () => {
  const overview = renderDoc("intelligence/overview");

  expect(overview).toContain("[quickstart](/intelligence/quickstart)");
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

// Coding agents consume flattened Markdown rather than interactive tabs. Keep
// every native setup available, including imports inside its code fences.
test("expands all runtime setup snippets for coding agents", () => {
  const output = renderDoc("intelligence/quickstart");

  expect(output).toContain("from copilotkit_runtime import HttpAgent");
  expect(output).toContain("copilotkit.HTTPAgent");
  expect(output).toContain("require 'copilotkit/runtime'");
  expect(output).toContain("using CopilotKit.Intelligence;");
  expect(output).toContain("Authorization");
  expect(output).not.toMatch(/<(Python|Go|Ruby|Dotnet)Runtime\s*\/>/);
});

// The quickstart, the runtime endpoints page, and the CLI onboarding prompt
// must show the same multi-route mount (PE-476).
test("mounts the TypeScript runtime as the multi-route subtree", () => {
  const source = loadRequiredDoc("intelligence/quickstart").source;

  expect(source).toContain("app/api/copilotkit/[[...slug]]/route.ts");
  for (const verb of ["GET", "POST", "PATCH", "DELETE"]) {
    expect(source).toContain(`export const ${verb} = handler;`);
  }
  expect(source).toContain("useSingleEndpoint={false}");
});

// TypeScript is the default runtime tab, so the shared frontend examples must
// work as copied against a TypeScript runtime. The native runtimes' local token
// stays a commented opt-in.
test("frontend examples default to a TypeScript runtime", () => {
  const source = loadRequiredDoc("intelligence/quickstart").source;
  const step = source.slice(
    source.indexOf("### Connect your frontend"),
    source.indexOf("### Confirm the connection"),
  );
  const reactBlock = step.slice(
    step.indexOf('<FrontendOnly frontend="react">'),
    step.indexOf('<FrontendOnly frontend="angular">'),
  );

  expect(reactBlock).toMatch(/^\s*runtimeUrl="\/api\/copilotkit"$/m);
  for (const line of step.split("\n")) {
    if (
      line.includes("Bearer <APP_AUTH_TOKEN>") &&
      /^\s*(headers|:headers)\b/.test(line)
    ) {
      throw new Error(
        `uncommented native-runtime token in a frontend example: ${line.trim()}`,
      );
    }
  }
});
