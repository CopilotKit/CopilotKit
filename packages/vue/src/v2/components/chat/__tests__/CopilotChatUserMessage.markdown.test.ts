import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { UserMessage } from "@ag-ui/core";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

const message = (content: string): UserMessage => ({
  id: "user-1",
  role: "user",
  content,
});

describe("CopilotChatUserMessage markdown", () => {
  it("renders code, lists and emphasis, but keeps # lines and HTML literal", async () => {
    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message: message(
          "# Not a heading\n\nUse `map` on **users**:\n\n- one\n- two\n\n<div>raw</div>\n\n```js\nusers.map(u => u.name)\n```",
        ),
      },
    });
    await flushPromises();

    expect(wrapper.find("h1").exists()).toBe(false);
    expect(wrapper.text()).toContain("# Not a heading");
    expect(wrapper.find('[data-streamdown="inline-code"]').text()).toBe("map");
    expect(wrapper.find('[data-streamdown="strong"]').text()).toBe("users");
    expect(wrapper.findAll('[data-streamdown="li"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("<div>raw</div>");
    expect(wrapper.find('[data-streamdown="code-block"]').exists()).toBe(true);
  });

  it("updates when the content changes to text of the same length", async () => {
    const wrapper = mount(CopilotChatUserMessage, {
      props: { message: message("Test original") },
    });
    await wrapper.setProps({ message: message("Test override") });

    expect(wrapper.text()).toContain("Test override");
    expect(wrapper.text()).not.toContain("Test original");
  });
});
