import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

const TEST_THREAD_ID = "test-thread";

const BANNER_OFFSET_VAR = "var(--copilotkit-license-banner-offset, 0px)";
const SAFE_AREA_VAR = "var(--copilotkit-input-safe-area, 12px)";

function renderInput(props: React.ComponentProps<typeof CopilotChatInput>) {
  return render(
    <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
      <CopilotChatInput {...props} />
    </CopilotChatConfigurationProvider>,
  );
}

describe("CopilotChatInput bottom padding", () => {
  it('reserves license-banner offset when positioning="absolute" and bottomAnchored=false', () => {
    const { container } = renderInput({ positioning: "absolute" });
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingBottom).toBe(BANNER_OFFSET_VAR);
  });

  it('reserves license-banner offset when positioning="absolute" and bottomAnchored=true', () => {
    const { container } = renderInput({
      positioning: "absolute",
      bottomAnchored: true,
    });
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingBottom).toBe(BANNER_OFFSET_VAR);
  });

  it('reserves license-banner offset when positioning="static" and bottomAnchored=true', () => {
    const { container } = renderInput({
      positioning: "static",
      bottomAnchored: true,
    });
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingBottom).toBe(BANNER_OFFSET_VAR);
  });

  it('reserves safe-area padding when positioning="static" and bottomAnchored=false (welcome / in-flow)', () => {
    const { container } = renderInput({ positioning: "static" });
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingBottom).toBe(SAFE_AREA_VAR);
  });
});
