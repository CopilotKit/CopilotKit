import React from "react";
import { render, screen } from "@testing-library/react";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";

const renderView = (
  props: Partial<React.ComponentProps<typeof CopilotChatView>>,
) =>
  render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId="intro">
        <CopilotChatView messages={[]} {...props} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

describe("CopilotChatView intro animation", () => {
  it("is on by default", () => {
    renderView({});
    expect(screen.getByTestId("copilot-chat").hasAttribute("data-intro")).toBe(
      true,
    );
  });

  it("can be turned off", () => {
    renderView({ introAnimation: false });
    expect(screen.getByTestId("copilot-chat").hasAttribute("data-intro")).toBe(
      false,
    );
  });
});
