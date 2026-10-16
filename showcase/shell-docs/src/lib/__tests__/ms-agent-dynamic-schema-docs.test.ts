import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { getTabDefault } from "../registry";

test("Microsoft Agent Framework dynamic A2UI guide selects the matching backend", () => {
  const doc = loadDoc(
    "integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema",
  );
  expect(doc).not.toBeNull();

  const source = doc!.source;
  const tabs = source.match(
    /<Tabs groupId="([^"]+)" items=\{\[([^\]]+)\]\}[^>]*>([\s\S]*?)<\/Tabs>/,
  );
  expect(tabs).not.toBeNull();

  const groupId = tabs![1];
  const items = [...tabs![2].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const dotnet = tabs![3].match(/<Tab value="\.NET">([\s\S]*?)<\/Tab>/)?.[1];
  const python = tabs![3].match(/<Tab value="Python">([\s\S]*?)<\/Tab>/)?.[1];

  expect(getTabDefault("ms-agent-dotnet", groupId)).toBe(".NET");
  expect(getTabDefault("ms-agent-python", groupId)).toBe("Python");
  expect(items).toEqual([".NET", "Python"]);
  expect(dotnet).toBeDefined();
  expect(python).toBeDefined();

  expect(dotnet).toContain("injectA2UITool: false");
  const csharp = dotnet!.match(
    /```csharp title="agent\/DeclarativeGenUiAgent\.cs"\n([\s\S]*?)```/,
  )?.[1];
  expect(csharp).toContain('Name = "generate_a2ui"');
  expect(csharp).toContain("GetDesignToolArgumentsAsync");
  expect(dotnet).toMatch(
    /secondary model does not receive the frontend catalog/,
  );

  const resultJson = dotnet!.match(/```json\n([\s\S]*?)```/)?.[1];
  expect(resultJson).toBeDefined();
  const operations = JSON.parse(resultJson!).a2ui_operations;
  expect(operations[0].createSurface.catalogId).toBe(
    "declarative-gen-ui-catalog",
  );
  expect(operations[1].updateComponents.components).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "root", component: "Text" }),
    ]),
  );

  expect(python).toContain("injectA2UITool: true");
  expect(python).toContain("a2ui_config");
  expect(python).toContain("a2ui_recovery_exhausted");
  expect(python).toMatch(/raw `Agent`.*`AgentFrameworkAgent`/);

  const outsidePython = source.replace(python!, "");
  expect(outsidePython).not.toContain("injectA2UITool: true");
  expect(outsidePython).not.toContain("from agent_framework");
  expect(outsidePython).not.toContain("a2ui_recovery_exhausted");
});
