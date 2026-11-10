import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const source = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../content/docs/integrations/microsoft-agent-framework/quickstart.mdx",
  ),
  "utf8",
);
const server = source.match(/```python title="main.py"\n([\s\S]*?)```/)?.[1];

test("installs the Azure identity package imported by the Python server", () => {
  expect(server).toBeDefined();
  const packages = source.match(/uv add ([^\n]+)/)?.[1].trim().split(/\s+/);
  expect(packages).toBeDefined();
  if (/from azure\.identity import/.test(server!)) {
    expect(packages).toContain("azure-identity");
  }
});

test("selects an explicit AG-UI endpoint authorization mode", () => {
  const registration = server?.match(
    /add_agent_framework_fastapi_endpoint\(([\s\S]*?)\)/,
  )?.[1];
  expect(registration).toBeDefined();
  // agent-framework-ag-ui 1.8 rejects registration without one of these modes.
  expect(registration).toMatch(
    /(?:authorization_scope_resolver\s*=|snapshot_scope_resolver\s*=|single_user\s*=\s*True\b)/,
  );
});
