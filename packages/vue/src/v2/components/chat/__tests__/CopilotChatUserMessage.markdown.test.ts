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

  it("shows HTML as typed wherever it appears", async () => {
    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message: message(
          "Wrap it in <b>bold</b>, see <https://copilotkit.ai>\n\n`<i>x</i>``\n\n````\n```\n````\n<u>after</u>\n\n    <s>indented</s>",
        ),
      },
    });
    await flushPromises();

    const text = wrapper.text();
    expect(wrapper.find("b, i, u, s").exists()).toBe(false);
    expect(text).not.toContain("&lt;");
    expect(text).toContain("Wrap it in <b>bold</b>");
    // Autolinks still link.
    expect(wrapper.find("a").attributes("href")).toMatch(
      /^https:\/\/copilotkit\.ai\/?$/,
    );
    // Unequal backtick runs are not a code span.
    expect(text).toContain("`<i>x</i>``");
    // A shorter fence inside a longer one doesn't close it.
    expect(text).toContain("<u>after</u>");
    expect(text).toContain("<s>indented</s>");
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

describe("CopilotChatUserMessage plain text", () => {
  it("shows the text as typed with markdown={false}", async () => {
    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message: message("Use **bold**\n  - not a list"),
        markdown: false,
      },
    });
    await flushPromises();

    const bubble = wrapper.find("[data-multiline]");
    expect(bubble.text()).toBe("Use **bold**\n  - not a list");
    expect(bubble.classes()).toContain("cpk:whitespace-pre-wrap");
    expect(wrapper.find("[data-streamdown]").exists()).toBe(false);
  });

  it("marks multiline bubbles with data-multiline", async () => {
    const single = mount(CopilotChatUserMessage, {
      props: { message: message("One line") },
    });
    const multi = mount(CopilotChatUserMessage, {
      props: { message: message("Two\nlines") },
    });
    await flushPromises();

    expect(single.find("[data-multiline]").exists()).toBe(false);
    expect(multi.find("[data-multiline]").attributes("data-multiline")).toBe(
      "true",
    );
  });

  it("shows the toolbar on hover and when a toolbar button has keyboard focus", () => {
    const wrapper = mount(CopilotChatUserMessage, {
      props: { message: message("Hi") },
    });
    const toolbar = wrapper.get("[data-testid='copilot-user-toolbar']");
    expect(toolbar.classes()).toContain("cpk:opacity-0");
    expect(toolbar.classes()).toContain("cpk:group-hover:opacity-100");
    expect(toolbar.classes()).toContain("cpk:focus-within:opacity-100");
    // visibility: hidden would take the buttons out of the tab order.
    expect(toolbar.classes()).not.toContain("cpk:invisible");
  });
});
