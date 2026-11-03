import React from "react";
import { screen } from "@testing-library/react";
import { z } from "zod";
import type { ActivityMessage } from "@ag-ui/core";
import { useRenderActivityMessage } from "../use-render-activity-message";
import type { ReactActivityMessageRenderer } from "../../types";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

const progressRenderer: ReactActivityMessageRenderer<{ percent: number }> = {
  activityType: "progress",
  content: z.object({ percent: z.number() }),
  render: ({ content }) => <div data-testid="progress">{content.percent}%</div>,
};

function createActivityMessage(
  content: ActivityMessage["content"],
): ActivityMessage {
  return {
    id: "activity-1",
    role: "activity",
    activityType: "progress",
    content,
  };
}

const ActivityProbe: React.FC<{ message: ActivityMessage }> = ({ message }) => {
  const { renderActivityMessage } = useRenderActivityMessage();
  return (
    <div data-testid="activity-slot">{renderActivityMessage(message)}</div>
  );
};

function renderActivity(content: ActivityMessage["content"]) {
  return renderWithCopilotKit({
    renderActivityMessages: [progressRenderer],
    children: <ActivityProbe message={createActivityMessage(content)} />,
  });
}

describe("useRenderActivityMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the matching renderer with the validated content", () => {
    renderActivity({ percent: 40 });

    expect(screen.getByTestId("progress").textContent).toBe("40%");
  });

  it("draws nothing and warns when the content fails the renderer's schema", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderActivity({ percent: "forty" });

    expect(screen.getByTestId("activity-slot").textContent).toBe("");
    expect(warn).toHaveBeenCalledWith(
      "Failed to parse content for activity message 'progress':",
      expect.any(Array),
    );
  });
});
