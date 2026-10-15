import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { getTabDefault } from "../registry";

test("Microsoft Agent Framework dynamic A2UI guide selects the matching backend", () => {
  const doc = loadDoc(
    "integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema",
  );
  expect(doc).not.toBeNull();

  const source = doc!.source;
  const groupId = "language_microsoft-agent-framework_agent";
  const dotnet = source.match(/<Tab value="\.NET">([\s\S]*?)<\/Tab>/)?.[1];
  const python = source.match(/<Tab value="Python">([\s\S]*?)<\/Tab>/)?.[1];

  expect(getTabDefault("ms-agent-dotnet", groupId)).toBe(".NET");
  expect(getTabDefault("ms-agent-python", groupId)).toBe("Python");
  expect(dotnet).toBeDefined();
  expect(python).toBeDefined();

  expect(dotnet).toContain("injectA2UITool: false");
  expect(dotnet).toContain("DeclarativeGenUiAgent.cs");
  expect(dotnet).toContain('"a2ui_operations"');
  expect(dotnet).toContain('"catalogId"');
  expect(dotnet).toContain("createSurface.catalogId");
  expect(dotnet).not.toContain("injectA2UITool: true");
  expect(dotnet).not.toContain("from agent_framework");

  expect(python).toContain("injectA2UITool: true");
  expect(python).toContain("a2ui_config");
  expect(python).toContain("a2ui_recovery_exhausted");
  expect(python).toContain("Pass a raw `Agent` to this endpoint");
});
