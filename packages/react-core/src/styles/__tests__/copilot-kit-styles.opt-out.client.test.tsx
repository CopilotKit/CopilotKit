import React from "react";
import { describe, expect, it } from "vitest";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";

// Its own file, so no earlier test has put a hoisted style in <head>.
describe("CopilotKitProvider injectStyles={false}", () => {
  it("adds no style tag, for apps that import styles.css", () => {
    renderWithCopilotKit({
      agent: new MockStepwiseAgent(),
      injectStyles: false,
      children: <CopilotChat welcomeScreen={false} />,
    });

    expect(document.querySelector("[data-copilotkit]")).not.toBeNull();
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });
});
