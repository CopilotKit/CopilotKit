import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  MarkdownRendererProvider,
  useMarkdownRenderer,
} from "../MarkdownRendererContext";

function Probe() {
  const Renderer = useMarkdownRenderer();
  return <div data-testid="probe">{Renderer ? "has" : "none"}</div>;
}

describe("MarkdownRendererContext", () => {
  it("returns undefined with no provider", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("none");
  });

  it("returns the supplied renderer", () => {
    const Custom = ({ content }: { content: string }) => <span>{content}</span>;
    render(
      <MarkdownRendererProvider renderer={Custom}>
        <Probe />
      </MarkdownRendererProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("has");
  });
});
