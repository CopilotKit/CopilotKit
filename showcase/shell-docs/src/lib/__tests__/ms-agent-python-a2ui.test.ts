import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const source = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx",
  ),
  "utf8",
);
const python = [...source.matchAll(/```python[^\n]*\n([\s\S]*?)```/g)]
  .map((match) => match[1].replace(/^\s*#.*$/gm, ""))
  .join("\n");

// The adapter's auto-injection path needs an optional dependency and an
// independent backend opt-in; the runtime flag alone does not enable it.
test("installs A2UI support in the backend environment", () => {
  const shell = [...source.matchAll(/```bash[^\n]*\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join("\n");
  expect(shell).toMatch(/uv add ['"]agent-framework-ag-ui\[a2ui\]['"]/);
  expect(shell).toMatch(/pip install ['"]agent-framework-ag-ui\[a2ui\]['"]/);
});

test("applies backend A2UI policy to a raw agent at endpoint registration", () => {
  expect(python).toMatch(/base_agent\s*=\s*Agent\(/);
  expect(python).not.toMatch(/\bAgentFrameworkAgent\(/);
  expect(python).toMatch(
    /add_agent_framework_fastapi_endpoint\([\s\S]*?agent=base_agent/,
  );
  expect(python).toMatch(/a2ui_config=\{[\s\S]*?"inject_a2ui_tool": True/);
  expect(python).toMatch(/single_user=True|authorization_scope_resolver=/);
});
