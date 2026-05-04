import React from "react";
import { render, screen } from "@testing-library/react";
import { ThreadsProvider, useThreads } from "../threads-context";

function ThreadIdViewer() {
  const { threadId } = useThreads();
  return <div data-testid="threadId">{threadId}</div>;
}

describe("ThreadsProvider", () => {
  it("updates threadId when explicit prop becomes available", () => {
    const { rerender } = render(
      <ThreadsProvider>
        <ThreadIdViewer />
      </ThreadsProvider>,
    );

    expect(screen.getByTestId("threadId").textContent).toBe("mock-thread-id");

    rerender(
      <ThreadsProvider threadId="customer-thread">
        <ThreadIdViewer />
      </ThreadsProvider>,
    );

    expect(screen.getByTestId("threadId").textContent).toBe("customer-thread");
  });
});
