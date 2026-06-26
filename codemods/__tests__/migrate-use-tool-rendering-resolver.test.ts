import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "../migrate-use-tool-rendering-resolver";

const j = jscodeshift.withParser("tsx");

function run(source: string): string {
  const result = transform(
    { source, path: "test.tsx" },
    { jscodeshift: j, j, stats: () => {}, report: () => {} },
  );
  return result ?? source;
}

describe("migrate-use-tool-rendering-resolver codemod", () => {
  it("renames unaliased imports and call sites from the v2 entrypoint", () => {
    const input = `
import { useRenderToolCall } from "@copilotkit/react-core/v2";

function Message() {
  const renderToolCall = useRenderToolCall();
  return renderToolCall({ toolCall });
}
`;

    const output = run(input);

    expect(output).toContain("useToolRenderingResolver");
    expect(output).not.toContain("useRenderToolCall");
    expect(output).toContain(
      "const resolveToolRendering = useToolRenderingResolver();",
    );
    expect(output).toContain("return resolveToolRendering({ toolCall });");
  });

  it("keeps local aliases while renaming the imported symbol", () => {
    const input = `
import { useRenderToolCall as useRenderer } from "@copilotkit/react-core/v2";

const resolver = useRenderer();
`;

    const output = run(input);

    expect(output).toContain("useToolRenderingResolver as useRenderer");
    expect(output).toContain("const resolver = useRenderer();");
  });

  it("renames re-exports from the v2 entrypoint", () => {
    const input = `
export { useRenderToolCall } from "@copilotkit/react-core/v2";
export { useRenderToolCall as useLegacyRenderer } from "@copilotkit/react-core/v2";
`;

    const output = run(input);

    expect(output).toContain("export { useToolRenderingResolver }");
    expect(output).toContain("useToolRenderingResolver as useLegacyRenderer");
    expect(output).not.toContain("useRenderToolCall");
  });

  it("does not rename the v1 hook from the root entrypoint", () => {
    const input = `
import { useRenderToolCall } from "@copilotkit/react-core";

useRenderToolCall({
  name: "legacy_renderer",
  render: () => null,
});
`;

    expect(run(input)).toBe(input);
  });

  it("does not modify already migrated code", () => {
    const input = `
import { useToolRenderingResolver } from "@copilotkit/react-core/v2";

const resolveToolRendering = useToolRenderingResolver();
`;

    expect(run(input)).toBe(input);
  });

  it("running twice is idempotent", () => {
    const input = `
import { useRenderToolCall } from "@copilotkit/react-core/v2";

const renderToolCall = useRenderToolCall();
`;

    const first = run(input);
    const second = run(first);

    expect(second).toBe(first);
  });
});
