import { describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { UserMessage } from "@ag-ui/core";
import { CopilotChatDefaultLabels } from "../../../providers/types";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

describe("CopilotChatUserMessage", () => {
  it("renders flattened text content from structured message parts", () => {
    const message = {
      id: "user-1",
      role: "user",
      timestamp: new Date(),
      content: [
        { type: "text", text: "Line one" },
        { type: "tool-call", id: "ignore" },
        { type: "text", text: "Line two" },
      ],
    } as unknown as UserMessage;

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
      },
    });

    expect(wrapper.text()).toContain("Line one");
    expect(wrapper.text()).toContain("Line two");
    expect(wrapper.text()).not.toContain("ignore");
  });

  it("emits edit-message exactly once when edit button is clicked", async () => {
    const onEditMessage = vi.fn();
    const message: UserMessage = {
      id: "user-2",
      role: "user",
      timestamp: new Date(),
      content: "Can you edit this?",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        onEditMessage,
      },
    });

    const editButton = wrapper.find(
      `[aria-label="${CopilotChatDefaultLabels.userMessageToolbarEditMessageLabel}"]`,
    );
    expect(editButton.exists()).toBe(true);

    await editButton.trigger("click");

    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith({ message });
    expect(wrapper.emitted("edit-message")?.[0]).toEqual([{ message }]);
  });

  it("hides edit button when edit callback is not provided", () => {
    const message: UserMessage = {
      id: "user-3",
      role: "user",
      timestamp: new Date(),
      content: "No edit action",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
      },
    });

    expect(
      wrapper.find(`[aria-label="${CopilotChatDefaultLabels.userMessageToolbarEditMessageLabel}"]`).exists(),
    ).toBe(false);
  });

  it("renders branch navigation and emits switch payload exactly once", async () => {
    const onSwitchToBranch = vi.fn();
    const message: UserMessage = {
      id: "user-4",
      role: "user",
      timestamp: new Date(),
      content: "Branch message",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        branchIndex: 1,
        numberOfBranches: 3,
        onSwitchToBranch,
      },
    });

    expect(wrapper.text()).toContain("2/3");

    const nextButton = wrapper.find('[aria-label="Next branch"]');
    await nextButton.trigger("click");

    expect(onSwitchToBranch).toHaveBeenCalledTimes(1);
    expect(onSwitchToBranch).toHaveBeenCalledWith({
      branchIndex: 2,
      numberOfBranches: 3,
      message,
    });
    expect(wrapper.emitted("switch-to-branch")?.[0]).toEqual([
      {
        branchIndex: 2,
        numberOfBranches: 3,
        message,
      },
    ]);
  });

  it("disables unavailable branch navigation controls", () => {
    const message: UserMessage = {
      id: "user-5",
      role: "user",
      timestamp: new Date(),
      content: "First branch",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        branchIndex: 0,
        numberOfBranches: 2,
        onSwitchToBranch: vi.fn(),
      },
    });

    expect(wrapper.find('[aria-label="Previous branch"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[aria-label="Next branch"]').attributes("disabled")).toBeUndefined();
  });

  it("supports custom message-renderer slot", () => {
    const message: UserMessage = {
      id: "user-6",
      role: "user",
      timestamp: new Date(),
      content: "Custom slot message",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: { message },
      slots: {
        "message-renderer": ({ content }: { content: string }) =>
          h("div", { "data-testid": "custom-message-renderer" }, `slot:${content}`),
      },
    });

    expect(wrapper.find("[data-testid='custom-message-renderer']").text()).toBe("slot:Custom slot message");
  });

  it("supports custom copy/edit/branch slots and forwards handlers", async () => {
    const onEditMessage = vi.fn();
    const onSwitchToBranch = vi.fn();
    const message: UserMessage = {
      id: "user-7",
      role: "user",
      timestamp: new Date(),
      content: "Custom controls",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        onEditMessage,
        onSwitchToBranch,
        branchIndex: 1,
        numberOfBranches: 3,
      },
      slots: {
        "copy-button": ({ onCopy, copied }: { onCopy: () => Promise<void>; copied: boolean }) =>
          h(
            "button",
            { "data-testid": "custom-copy-button", onClick: onCopy },
            copied ? "copied" : "copy",
          ),
        "edit-button": ({ onEdit }: { onEdit: () => void }) =>
          h("button", { "data-testid": "custom-edit-button", onClick: onEdit }, "edit"),
        "branch-navigation": ({ goNext }: { goNext: () => void }) =>
          h("button", { "data-testid": "custom-branch-next", onClick: goNext }, "next"),
      },
    });

    await wrapper.get("[data-testid='custom-copy-button']").trigger("click");
    await nextTick();
    expect(wrapper.get("[data-testid='custom-copy-button']").text()).toBe("copied");

    await wrapper.get("[data-testid='custom-edit-button']").trigger("click");
    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith({ message });

    await wrapper.get("[data-testid='custom-branch-next']").trigger("click");
    expect(onSwitchToBranch).toHaveBeenCalledTimes(1);
    expect(onSwitchToBranch).toHaveBeenCalledWith({
      branchIndex: 2,
      numberOfBranches: 3,
      message,
    });
  });

  it("supports custom layout slot with all control callbacks", async () => {
    const onEditMessage = vi.fn();
    const onSwitchToBranch = vi.fn();
    const message: UserMessage = {
      id: "user-8",
      role: "user",
      timestamp: new Date(),
      content: "Layout slot content",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        onEditMessage,
        onSwitchToBranch,
        branchIndex: 0,
        numberOfBranches: 2,
      },
      slots: {
        layout: ({
          content,
          onCopy,
          onEdit,
          goNext,
          hasEditAction,
          showBranchNavigation,
        }: {
          content: string;
          onCopy: () => Promise<void>;
          onEdit: () => void;
          goNext: () => void;
          hasEditAction: boolean;
          showBranchNavigation: boolean;
        }) =>
          h("div", { "data-testid": "custom-layout" }, [
            h("div", { "data-testid": "layout-content" }, content),
            h("div", { "data-testid": "layout-flags" }, `${hasEditAction}:${showBranchNavigation}`),
            h("button", { "data-testid": "layout-copy", onClick: onCopy }, "copy"),
            h("button", { "data-testid": "layout-edit", onClick: onEdit }, "edit"),
            h("button", { "data-testid": "layout-next", onClick: goNext }, "next"),
          ]),
      },
    });

    expect(wrapper.get("[data-testid='layout-content']").text()).toBe("Layout slot content");
    expect(wrapper.get("[data-testid='layout-flags']").text()).toBe("true:true");

    await wrapper.get("[data-testid='layout-copy']").trigger("click");
    await wrapper.get("[data-testid='layout-edit']").trigger("click");
    await wrapper.get("[data-testid='layout-next']").trigger("click");

    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith({ message });
    expect(onSwitchToBranch).toHaveBeenCalledTimes(1);
    expect(onSwitchToBranch).toHaveBeenCalledWith({
      branchIndex: 1,
      numberOfBranches: 2,
      message,
    });
  });
});
