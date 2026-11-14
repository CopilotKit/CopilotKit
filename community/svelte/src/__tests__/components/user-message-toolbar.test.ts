import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import CopilotChatUserMessage from "../../components/chat/CopilotChatUserMessage.svelte";
import UserMessageToolbarHarness from "./user-message-toolbar-harness.svelte";
import type { UserMessage } from "@ag-ui/core";

const message: UserMessage = { id: "user-1", role: "user", content: "hello" };

describe("CopilotChatUserMessage toolbar", () => {
  it("keeps copy keyboard reachable without rendering the unimplemented default edit action", () => {
    const view = render(CopilotChatUserMessage, { props: { message } });
    const copy = view.getByRole("button", { name: "Copy" });
    expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
    const toolbar = copy.parentElement?.parentElement;
    expect(toolbar?.className).not.toContain("invisible");
    copy.focus();
    expect(document.activeElement).toBe(copy);
    view.unmount();
  });

  it("still renders a consumer-provided edit button snippet", () => {
    const view = render(UserMessageToolbarHarness);
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
    view.unmount();
  });
});
