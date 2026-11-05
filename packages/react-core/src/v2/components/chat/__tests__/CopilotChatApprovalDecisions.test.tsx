import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CopilotChatApprovalDecisions } from "../CopilotChatApprovalDecisions";

it("shows saved approve/decline without controls, then the recorded result after continuation", () => {
  const snapshot = {
    version: 1 as const,
    decisions: [
      {
        requestId: "a",
        toolCallId: "call-a",
        approved: true,
        status: "waiting" as const,
      },
      {
        requestId: "b",
        toolCallId: "call-b",
        approved: false,
        status: "waiting" as const,
      },
    ],
  };
  const view = render(
    <CopilotChatApprovalDecisions snapshot={snapshot} messages={[]} />,
  );
  expect(
    screen.getByText("Approved · Waiting for remaining decisions"),
  ).toBeTruthy();
  expect(
    screen.getByText("Declined · Waiting for remaining decisions"),
  ).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  view.rerender(
    <CopilotChatApprovalDecisions
      snapshot={snapshot}
      messages={[
        {
          id: "result",
          role: "tool",
          toolCallId: "call-a",
          content: "canonical",
        },
      ]}
    />,
  );
  expect(screen.getByText("Approved · Result recorded")).toBeTruthy();
  expect(
    screen.queryByText("Approved · Waiting for remaining decisions"),
  ).toBeNull();
  view.rerender(<CopilotChatApprovalDecisions messages={[]} />);
  expect(screen.queryByRole("region")).toBeNull();
});
it("shows invalid decision state as unavailable", () => {
  render(
    <CopilotChatApprovalDecisions snapshot={{ error: true }} messages={[]} />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be displayed",
  );
});
