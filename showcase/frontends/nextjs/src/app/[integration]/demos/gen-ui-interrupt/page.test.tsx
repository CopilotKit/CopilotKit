import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import GenUiInterruptDemo from "./page";

vi.mock("./chat", () => ({
  GenUiInterruptChat: ({
    integration,
    interruptPattern,
  }: {
    integration: string;
    interruptPattern: "native" | "promise-based";
  }) => (
    <div
      data-integration={integration}
      data-interrupt-pattern={interruptPattern}
      data-hook={
        interruptPattern === "promise-based"
          ? "useHumanInTheLoop"
          : "useInterrupt"
      }
    />
  ),
}));

async function render(integration: string): Promise<string> {
  const element = await GenUiInterruptDemo({
    params: Promise.resolve({ integration }),
  });
  return renderToStaticMarkup(element);
}

describe("gen-ui-interrupt page interrupt_pattern routing", () => {
  it("gives promise-based slugs useHumanInTheLoop", async () => {
    const html = await render("google-adk");
    expect(html).toContain('data-integration="google-adk"');
    expect(html).toContain('data-interrupt-pattern="promise-based"');
    expect(html).toContain('data-hook="useHumanInTheLoop"');
  });

  it("gives native slugs useInterrupt", async () => {
    const html = await render("langgraph-python");
    expect(html).toContain('data-integration="langgraph-python"');
    expect(html).toContain('data-interrupt-pattern="native"');
    expect(html).toContain('data-hook="useInterrupt"');
  });

  it("gives slugs with no interrupt_pattern useInterrupt", async () => {
    const html = await render("built-in-agent");
    expect(html).toContain('data-interrupt-pattern="native"');
    expect(html).toContain('data-hook="useInterrupt"');
  });
});
