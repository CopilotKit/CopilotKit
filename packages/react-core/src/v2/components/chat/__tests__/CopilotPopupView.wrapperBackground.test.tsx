/**
 * Regression test: the popup positioning wrapper must not paint a background.
 *
 * The outer `[data-copilotkit]` wrapper inherits `background-color` from the
 * default theme, but has no border-radius. The inner dialog uses `rounded-2xl`
 * on desktop viewports. An opaque wrapper background bleeds through the inner
 * dialog's rounded corners, making the popup appear rectangular on non-white
 * host pages.
 *
 * Fix: the wrapper carries `cpk:bg-transparent` so only the inner dialog
 * paints a background.
 *
 * This test renders a popup and asserts the outer wrapper includes the
 * transparent background class while the inner dialog retains its own
 * background.
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotPopup } from "../CopilotPopup";

class MockAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  clone(): MockAgent {
    const cloned = new MockAgent();
    cloned.agentId = this.agentId;
    (cloned as unknown as { subject: Subject<BaseEvent> }).subject =
      this.subject;
    return cloned;
  }
  async detachActiveRun(): Promise<void> {}
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

describe("CopilotPopupView wrapper background", () => {
  it("outer wrapper has transparent background, inner dialog has opaque background", () => {
    const agent = new MockAgent();
    const { container } = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotPopup defaultOpen />
      </CopilotKitProvider>,
    );

    const wrapper = container.querySelector("[data-copilotkit]");
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).toContain("cpk:bg-transparent");

    const dialog = container.querySelector("[data-copilot-popup]");
    expect(dialog).toBeTruthy();
    expect(dialog!.className).toContain("cpk:bg-background");
  });
});
