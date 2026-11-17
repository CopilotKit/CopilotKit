import React from "react";
import { render } from "@testing-library/react";
import { stylesheet } from "@copilotkit/core/styles";
import { describe, expect, it } from "vitest";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";
import { CopilotKitStyles } from "../copilot-kit-styles";

const isReact19 = Number.parseInt(React.version, 10) >= 19;

/** The CopilotKit style tags: hoisted into <head> on React 19, in place on 18. */
function copilotKitStyles(): HTMLStyleElement[] {
  return [...document.querySelectorAll("style")].filter(
    (style) => style.textContent === stylesheet,
  );
}

describe("CopilotKitStyles in the browser", () => {
  it.runIf(isReact19)(
    "adds one copy of the stylesheet to document.head",
    () => {
      render(
        <>
          <CopilotKitStyles />
          <CopilotKitStyles />
        </>,
      );

      const styles = document.head.querySelectorAll(
        'style[data-href="copilotkit"]',
      );
      expect(styles).toHaveLength(1);
      expect(styles[0]!.textContent).toContain(".cpk-suggestion-pill)");
      expect(document.body.querySelectorAll("style")).toHaveLength(0);
    },
  );

  it.skipIf(isReact19)("renders the stylesheet in place on React 18", () => {
    const { container } = render(<CopilotKitStyles />);

    const styles = container.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(stylesheet);
    expect(styles[0]!.attributes).toHaveLength(0);
  });

  it("is rendered by CopilotChat, so apps don't import a stylesheet", () => {
    renderWithCopilotKit({
      agent: new MockStepwiseAgent(),
      children: <CopilotChat welcomeScreen={false} />,
    });

    expect(copilotKitStyles()).toHaveLength(1);
  });
});
