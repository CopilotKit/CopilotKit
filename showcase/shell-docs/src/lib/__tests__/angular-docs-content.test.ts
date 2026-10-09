import { expect, test } from "vitest";
import { resolveAngularDoc } from "../angular-doc-navigation";

// React code in an Angular code sample. Prose is deliberately out of scope:
// a sentence such as "the Angular equivalent of React's X" orients a reader
// arriving from React, so Angular docs may name React, its packages, and its
// hooks when comparing. What they must not do is show React code as if it
// were the Angular API.
const REACT_CODE =
  /@copilotkit\/react|from ["']react(?:-dom)?(?:\/[\w-]+)?["']|\buse(?:Agent|Copilot\w*|RenderTool\w*|FrontendTool|HumanInTheLoop|Component|RenderActivityMessage)\s*\(|<(?:CopilotKit|CopilotChat|CopilotSidebar|CopilotPopup)\b/;

function fencedCode(markdown: string): string[] {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
}

test("detects React code in fenced samples but allows React in prose", () => {
  const markdown = [
    "This is the Angular equivalent of React's `useComponent()` in `@copilotkit/react-core/v2`.",
    "```ts",
    'import { registerComponent } from "@copilotkit/angular";',
    "```",
    "```tsx",
    'import { useAgent } from "@copilotkit/react-core/v2";',
    "```",
  ].join("\n");

  const [angularSample, reactSample] = fencedCode(markdown);

  expect(angularSample).not.toMatch(REACT_CODE);
  expect(reactSample).toMatch(REACT_CODE);
  expect(markdown.split("```")[0]).toMatch(/\bReact\b/);
});

test("resolves canonical contribution aliases through shared Angular content", () => {
  expect(
    resolveAngularDoc("claude-sdk-python", "contributing/code-contributions"),
  ).toEqual(
    expect.objectContaining({
      contentSlugPath: "(other)/contributing/code-contributions",
      source: "shared",
    }),
  );
  expect(
    resolveAngularDoc("ag2", "contributing/code-contributions/package-linking"),
  ).toEqual(
    expect.objectContaining({
      contentSlugPath:
        "(other)/contributing/code-contributions/package-linking",
      source: "shared",
    }),
  );
});
