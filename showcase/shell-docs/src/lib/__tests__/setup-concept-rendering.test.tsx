import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FrameworkSetup } from "../setup-concept";

test("the rendered Claude TypeScript shared-state blocks keep their complete suffixes", async () => {
  const result = await FrameworkSetup({
    concept: "shared-state-setup",
    currentFramework: "claude-sdk-typescript",
  });

  expect(result).not.toBeNull();
  const markup = renderToStaticMarkup(result);

  expect(markup).toContain("toolSchemas: config.toolSchemas");
  expect(markup).toContain("executeBackendTool");
  expect(markup).toContain("resultText: JSON.stringify");
  expect(markup).toContain("state: { ...state, notes }");
});
