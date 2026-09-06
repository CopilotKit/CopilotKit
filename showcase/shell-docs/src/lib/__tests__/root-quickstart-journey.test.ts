import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const quickstart = readFileSync(
  join(
    import.meta.dirname,
    "../../content/docs/integrations/built-in-agent/quickstart.mdx",
  ),
  "utf8",
);

test("the root quickstart starts with chat and hands off to Intelligence last", () => {
  expect(quickstart).toContain("React Router, Remix, TanStack Start, Vite");
  expect(quickstart).toContain(
    'import { CopilotKitProvider } from "@copilotkit/react-core/v2"',
  );
  expect(quickstart).not.toContain(
    'import { CopilotKit } from "@copilotkit/react-core/v2"',
  );
  expect(quickstart).not.toContain("new CopilotKitIntelligence");
  expect(quickstart).not.toContain("### Create a free account");
  expect(quickstart.indexOf("### Start chatting")).toBeLessThan(
    quickstart.indexOf("## Keep conversations between visits"),
  );
  expect(quickstart).toContain("<QuickstartIntelligenceCta />");
});
