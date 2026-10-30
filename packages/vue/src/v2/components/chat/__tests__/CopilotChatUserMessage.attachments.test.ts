import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { fireEvent, render, screen, within } from "@testing-library/vue";
import type { UserMessage } from "@ag-ui/core";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

const message = {
  id: "user-media",
  role: "user",
  content: [
    { type: "text", text: "Look at these" },
    {
      type: "image",
      source: { type: "url", value: "https://example.com/cat.png" },
    },
    {
      type: "document",
      source: {
        type: "data",
        value: "JVBERi0=",
        mimeType: "application/pdf",
      },
      metadata: { filename: "report.pdf" },
    },
  ],
} as unknown as UserMessage;

describe("CopilotChatUserMessage attachments", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders media parts in the attachments row before the bubble", () => {
    const { container } = render(CopilotChatUserMessage, {
      props: { message },
    });

    const attachments = container.querySelector(
      ".cpk-user-message-attachments",
    );
    expect(attachments).not.toBeNull();
    const bubble = container.querySelector(".cpk-user-message-bubble");
    expect(
      attachments!.compareDocumentPosition(bubble!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bubble!.textContent?.trim()).toBe("Look at these");

    const image = within(attachments as HTMLElement).getByRole("img", {
      name: "Image attachment",
    });
    expect(image.getAttribute("src")).toBe("https://example.com/cat.png");

    // The filename comes from the part's metadata.
    const link = within(attachments as HTMLElement).getByRole("link", {
      name: "report.pdf",
    });
    expect(link.getAttribute("href")).toBe(
      "data:application/pdf;base64,JVBERi0=",
    );
    expect(link.getAttribute("download")).toBe("report.pdf");
  });

  it("renders no attachments row for a text-only message", () => {
    const { container } = render(CopilotChatUserMessage, {
      props: {
        message: { id: "u", role: "user", content: "Hi" } as UserMessage,
      },
    });
    expect(container.querySelector(".cpk-user-message-attachments")).toBeNull();
  });

  it("opens an attached image in the lightbox", async () => {
    render(CopilotChatUserMessage, { props: { message } });

    await fireEvent.click(
      screen.getByRole("button", { name: "Image attachment" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Image attachment" });
    expect(
      dialog.querySelector(".cpk-attachment-renderer-lightbox-image"),
    ).not.toBeNull();
  });

  it("does not mark a multiline bubble with data-multiline, as React", () => {
    const { container } = render(CopilotChatUserMessage, {
      props: {
        message: {
          id: "u",
          role: "user",
          content: "one\ntwo",
        } as UserMessage,
      },
    });
    const bubble = container.querySelector(".cpk-user-message-bubble");
    expect(bubble!.hasAttribute("data-multiline")).toBe(false);
  });
});

describe("CopilotChatUserMessage toolbar tooltips", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the copy and edit labels as tooltips, not as title", async () => {
    render(CopilotChatUserMessage, {
      props: {
        message: { id: "u", role: "user", content: "Hi" } as UserMessage,
        onEditMessage: () => {},
      },
    });

    const copy = screen.getByRole("button", { name: "Copy" });
    const edit = screen.getByTestId("copilot-edit-button");
    expect(copy.hasAttribute("title")).toBe(false);
    expect(edit.hasAttribute("title")).toBe(false);

    await fireEvent.focus(copy);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Copy");
    expect(tooltip.getAttribute("data-side")).toBe("bottom");
    expect(copy.getAttribute("aria-describedby")).toBe(tooltip.id);
    await fireEvent.blur(copy);
    await nextTick();

    await fireEvent.focus(edit);
    expect(screen.getByRole("tooltip").textContent).toContain("Edit");
  });

  it("gives the branch buttons no tooltip or title, as React", async () => {
    render(CopilotChatUserMessage, {
      props: {
        message: { id: "u", role: "user", content: "Hi" } as UserMessage,
        numberOfBranches: 2,
        onSwitchToBranch: () => {},
      },
    });
    const next = screen.getByRole("button", { name: "Next branch" });
    expect(next.hasAttribute("title")).toBe(false);
    await fireEvent.focus(next);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
