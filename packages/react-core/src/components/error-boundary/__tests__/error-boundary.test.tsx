import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { CopilotErrorBoundary } from "../error-boundary";

afterEach(() => {
  vi.restoreAllMocks();
});

class ConsumerErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div>Consumer caught: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

function ThrowingChild(): never {
  throw new Error("render failed");
}

describe("CopilotErrorBoundary", () => {
  it("lets non-CopilotKit render errors reach a consumer boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ConsumerErrorBoundary>
        <CopilotErrorBoundary>
          <ThrowingChild />
        </CopilotErrorBoundary>
      </ConsumerErrorBoundary>,
    );

    expect(screen.getByText("Consumer caught: render failed")).toBeTruthy();
  });
});
