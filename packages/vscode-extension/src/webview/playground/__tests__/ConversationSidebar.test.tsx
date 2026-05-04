/** @vitest-environment jsdom */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConversationSidebar } from "../ConversationSidebar";

describe("ConversationSidebar", () => {
  it("renders an empty state when no fixtures", () => {
    render(
      <ConversationSidebar
        fixtures={[]}
        currentFixtureName={null}
        replayMode={false}
        models={[]}
        selectedModelId=""
        collapsed={false}
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/no saved fixtures/i)).toBeDefined();
  });

  it("disables save button when name is empty, enables when filled", () => {
    render(
      <ConversationSidebar
        fixtures={[]}
        currentFixtureName={null}
        replayMode={false}
        models={[]}
        selectedModelId=""
        collapsed={false}
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /^save$/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = screen.getByPlaceholderText(/name this conversation/i);
    fireEvent.change(input, { target: { value: "my" } });
    expect(btn.disabled).toBe(false);
  });

  it("calls onLoad when the replay button is clicked", () => {
    const onLoad = vi.fn();
    render(
      <ConversationSidebar
        fixtures={[
          {
            filePath: "/a.json",
            metadata: {
              name: "hello",
              createdAt: "2026-04-23T12:00:00Z",
              modelId: "gpt-4o-mini",
              modelVendor: "openai",
              version: 2,
            },
          },
        ]}
        currentFixtureName={null}
        replayMode={false}
        models={[]}
        selectedModelId=""
        collapsed={false}
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={onLoad}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /replay hello/i }));
    expect(onLoad).toHaveBeenCalledWith("/a.json");
  });

  it("requires a second click on the delete button to confirm before firing onDelete", () => {
    const onDelete = vi.fn();
    render(
      <ConversationSidebar
        fixtures={[
          {
            filePath: "/a.json",
            metadata: {
              name: "hello",
              createdAt: "2026-04-23T12:00:00Z",
              modelId: "gpt-4o-mini",
              modelVendor: "openai",
              version: 2,
            },
          },
        ]}
        currentFixtureName={null}
        replayMode={false}
        models={[]}
        selectedModelId=""
        collapsed={false}
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const deleteBtn = screen.getByRole("button", { name: /delete hello/i });
    fireEvent.click(deleteBtn);
    expect(onDelete).not.toHaveBeenCalled();
    // After first click the label flips to "confirm delete …".
    const confirmBtn = screen.getByRole("button", {
      name: /confirm delete hello/i,
    });
    fireEvent.click(confirmBtn);
    expect(onDelete).toHaveBeenCalledWith("/a.json");
  });

  it("shows replay badge when replayMode is true", () => {
    render(
      <ConversationSidebar
        fixtures={[]}
        currentFixtureName="saved-x"
        replayMode={true}
        models={[]}
        selectedModelId=""
        collapsed={false}
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // The Recording section shows a "replay" badge plus the fixture
    // name inline in the help text. Look for the badge specifically
    // (multiple elements contain "replay" — the badge, the help text,
    // and the heading).
    expect(document.querySelector(".badge-replay")).not.toBeNull();
    expect(screen.getByText(/saved-x/)).toBeDefined();
  });
});
