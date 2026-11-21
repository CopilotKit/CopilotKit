import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CopilotChatSuggestionView from "../../components/chat/CopilotChatSuggestionView.svelte";

describe("CopilotChatSuggestionView", () => {
  it("renders suggestions with duplicate messages", () => {
    const view = render(CopilotChatSuggestionView, {
      props: {
        suggestions: [
          { title: "First", message: "Same message", isLoading: false },
          { title: "Second", message: "Same message", isLoading: false },
        ],
        onSelectSuggestion: vi.fn(),
      },
    });

    expect(view.getAllByRole("button")).toHaveLength(2);
  });
});
