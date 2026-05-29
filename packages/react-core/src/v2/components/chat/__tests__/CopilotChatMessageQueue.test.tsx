import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom";
import { CopilotChatMessageQueue } from "../CopilotChatMessageQueue";
import type { QueuedMessage } from "../../../hooks/use-message-queue";

const textItem = (id: string, text: string): QueuedMessage => ({
  id,
  content: [{ type: "text", text }],
});

describe("CopilotChatMessageQueue", () => {
  it("renders nothing when messages is empty", () => {
    const { container } = render(
      <CopilotChatMessageQueue
        messages={[]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        dispatch="sequential"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per message with text preview", () => {
    render(
      <CopilotChatMessageQueue
        messages={[textItem("1", "first"), textItem("2", "second")]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        dispatch="sequential"
      />,
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("shows an attachment count indicator when content has non-text parts", () => {
    const item: QueuedMessage = {
      id: "1",
      content: [
        { type: "text", text: "with files" },
        { type: "image", source: { type: "url", value: "https://x/a.png" } },
        { type: "image", source: { type: "url", value: "https://x/b.png" } },
      ],
    };
    render(
      <CopilotChatMessageQueue
        messages={[item]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        dispatch="sequential"
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("onRemove fires with the pill id when remove button clicked", () => {
    const onRemove = vi.fn();
    render(
      <CopilotChatMessageQueue
        messages={[textItem("msg-a", "hi")]}
        onEdit={vi.fn()}
        onRemove={onRemove}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        dispatch="sequential"
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove queued message"));
    expect(onRemove).toHaveBeenCalledWith("msg-a");
  });

  it("moveUp and moveDown fire with the pill id; disabled at ends", () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <CopilotChatMessageQueue
        messages={[
          textItem("a", "first"),
          textItem("b", "middle"),
          textItem("c", "last"),
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        dispatch="sequential"
      />,
    );

    const upButtons = screen.getAllByLabelText("Move up");
    const downButtons = screen.getAllByLabelText("Move down");

    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[2]).toBeDisabled();

    fireEvent.click(upButtons[1]);
    expect(onMoveUp).toHaveBeenCalledWith("b");

    fireEvent.click(downButtons[0]);
    expect(onMoveDown).toHaveBeenCalledWith("a");
  });

  it("applies className to the root container", () => {
    const { container } = render(
      <CopilotChatMessageQueue
        messages={[textItem("1", "hi")]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        dispatch="sequential"
        className="my-custom-class"
      />,
    );
    expect(container.querySelector(".my-custom-class")).not.toBeNull();
  });

  describe("collapse / expand", () => {
    it("collapses when more than 3 messages; shows first 3 + toggle", () => {
      render(
        <CopilotChatMessageQueue
          messages={[
            textItem("1", "first"),
            textItem("2", "second"),
            textItem("3", "third"),
            textItem("4", "fourth"),
            textItem("5", "fifth"),
          ]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );

      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
      expect(screen.getByText("third")).toBeInTheDocument();
      expect(screen.queryByText("fourth")).toBeNull();
      expect(screen.queryByText("fifth")).toBeNull();

      const toggle = screen.getByRole("button", {
        name: /Show 2 more/,
      });
      expect(toggle).toBeInTheDocument();
    });

    it("expands when toggle is clicked; collapses again on second click", () => {
      render(
        <CopilotChatMessageQueue
          messages={[
            textItem("1", "first"),
            textItem("2", "second"),
            textItem("3", "third"),
            textItem("4", "fourth"),
            textItem("5", "fifth"),
          ]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /Show 2 more/ }));

      expect(screen.getByText("fourth")).toBeInTheDocument();
      expect(screen.getByText("fifth")).toBeInTheDocument();
      const showLess = screen.getByRole("button", { name: /Collapse/ });
      expect(showLess).toBeInTheDocument();

      fireEvent.click(showLess);
      expect(screen.queryByText("fourth")).toBeNull();
    });

    it("does NOT collapse when exactly 3 messages", () => {
      render(
        <CopilotChatMessageQueue
          messages={[
            textItem("1", "first"),
            textItem("2", "second"),
            textItem("3", "third"),
          ]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );

      expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("third")).toBeInTheDocument();
    });
  });

  describe("inline edit", () => {
    it("clicking edit icon expands a textarea with the current text", () => {
      render(
        <CopilotChatMessageQueue
          messages={[textItem("1", "original")]}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );
      fireEvent.click(screen.getByLabelText("Edit queued message"));
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(textarea.value).toBe("original");
    });

    it("Enter commits the edit and fires onEdit with updated content", () => {
      const onEdit = vi.fn();
      render(
        <CopilotChatMessageQueue
          messages={[textItem("msg-1", "original")]}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );
      fireEvent.click(screen.getByLabelText("Edit queued message"));
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "edited" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onEdit).toHaveBeenCalledWith("msg-1", [
        { type: "text", text: "edited" },
      ]);
    });

    it("Escape cancels and does not fire onEdit", () => {
      const onEdit = vi.fn();
      render(
        <CopilotChatMessageQueue
          messages={[textItem("msg-1", "original")]}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );
      fireEvent.click(screen.getByLabelText("Edit queued message"));
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "edited" } });
      fireEvent.keyDown(textarea, { key: "Escape" });

      expect(onEdit).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByText("original")).toBeInTheDocument();
    });

    it("Save (check) button commits the edit", () => {
      const onEdit = vi.fn();
      render(
        <CopilotChatMessageQueue
          messages={[textItem("msg-1", "original")]}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );
      fireEvent.click(screen.getByLabelText("Edit queued message"));
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "saved via check" } });
      fireEvent.click(screen.getByLabelText("Save edit"));

      expect(onEdit).toHaveBeenCalledWith("msg-1", [
        { type: "text", text: "saved via check" },
      ]);
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("Cancel (X) button cancels the edit", () => {
      const onEdit = vi.fn();
      render(
        <CopilotChatMessageQueue
          messages={[textItem("msg-1", "original")]}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );
      fireEvent.click(screen.getByLabelText("Edit queued message"));
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "discarded" } });
      fireEvent.click(screen.getByLabelText("Cancel edit"));

      expect(onEdit).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByText("original")).toBeInTheDocument();
    });

    it("edit preserves attachment parts, only text part is replaced", () => {
      const onEdit = vi.fn();
      const item: QueuedMessage = {
        id: "msg-1",
        content: [
          { type: "text", text: "hi" },
          { type: "image", source: { type: "url", value: "https://x/a.png" } },
        ],
      };
      render(
        <CopilotChatMessageQueue
          messages={[item]}
          onEdit={onEdit}
          onRemove={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          dispatch="sequential"
        />,
      );
      fireEvent.click(screen.getByLabelText("Edit queued message"));
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "hello" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onEdit).toHaveBeenCalledWith("msg-1", [
        { type: "text", text: "hello" },
        { type: "image", source: { type: "url", value: "https://x/a.png" } },
      ]);
    });
  });
});
