import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";
import { CopilotKitStyles } from "../copilot-kit-styles";

describe("CopilotKitStyles in the browser", () => {
  it("adds one copy of the stylesheet to document.head", () => {
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
  });

  it("is rendered by CopilotChat, so apps don't import a stylesheet", () => {
    renderWithCopilotKit({
      agent: new MockStepwiseAgent(),
      children: <CopilotChat welcomeScreen={false} />,
    });

    expect(
      document.head.querySelectorAll('style[data-href="copilotkit"]'),
    ).toHaveLength(1);
  });
});
