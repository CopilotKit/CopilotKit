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
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /save as fixture/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = screen.getByPlaceholderText(/fixture name/i);
    fireEvent.change(input, { target: { value: "my" } });
    expect(btn.disabled).toBe(false);
  });

  it("calls onLoad when a fixture is clicked", () => {
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
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={onLoad}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "hello" }));
    expect(onLoad).toHaveBeenCalledWith("/a.json");
  });

  it("shows replay badge when replayMode is true", () => {
    render(
      <ConversationSidebar
        fixtures={[]}
        currentFixtureName="saved-x"
        replayMode={true}
        models={[]}
        selectedModelId=""
        onSelectModel={vi.fn()}
        onNewChat={vi.fn()}
        onLoad={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/replay · saved-x/)).toBeDefined();
  });
});
