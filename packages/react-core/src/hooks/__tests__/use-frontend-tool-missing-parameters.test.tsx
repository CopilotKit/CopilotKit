import React, { useState } from "react";
import { act, screen } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

/**
 * PE-109: `useComponent`, `useFrontendTool` and `useHumanInTheLoop` all register
 * through `core.addTool()`, and a tool with no `parameters` is advertised to the
 * model as an object schema with nothing to fill in.
 *
 * The warning lives on the core registry rather than in the hook, so it has to
 * survive `useFrontendTool`'s layout effect tearing the tool down and putting it
 * back. The harness below passes a `deps` array that changes on every render,
 * which is what a caller with dynamic tool configuration does: the effect
 * re-runs, `removeTool` then `addTool` fire again, and the warning must not.
 */
describe("useFrontendTool missing-parameters warning (PE-109)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function warnings(): string[] {
    return warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes("no parameters schema"));
  }

  const RENDERS = 5;

  function Harness({ withParameters }: { withParameters: boolean }) {
    const [count, setCount] = useState(0);
    useFrontendTool(
      {
        name: "sayHello",
        description: "Say hello",
        ...(withParameters
          ? { parameters: z.object({ name: z.string() }) }
          : {}),
      },
      // Changes every render, so the registration effect re-runs each time.
      [count],
    );
    return (
      <button data-testid="rerender" onClick={() => setCount(count + 1)}>
        {count}
      </button>
    );
  }

  async function clickThrough(): Promise<HTMLElement> {
    const button = screen.getByTestId("rerender");
    for (let i = 0; i < RENDERS; i++) {
      await act(async () => {
        button.click();
      });
    }
    expect(button.textContent).toBe(String(RENDERS));
    return button;
  }

  it("warns once even though the tool re-registers on every render", async () => {
    renderWithCopilotKit({ children: <Harness withParameters={false} /> });

    await clickThrough();

    // The re-registration really happened: the hook's duplicate-name guard
    // warns whenever it finds the tool still registered, and it did not, so
    // teardown + re-add ran each render.
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("'sayHello'");
  });

  it("stays silent when the tool declares parameters", async () => {
    renderWithCopilotKit({ children: <Harness withParameters={true} /> });

    await clickThrough();

    expect(warnings()).toHaveLength(0);
  });
});
