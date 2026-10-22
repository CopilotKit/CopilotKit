import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallStatus } from "@copilotkit/core";
import { WildcardToolCallRender } from "../WildcardToolCallRender";

const RenderComponent = WildcardToolCallRender.render as React.ComponentType<{
  name: string;
  toolCallId: string;
  args: unknown;
  status: ToolCallStatus;
  result: string | undefined;
}>;

describe("WildcardToolCallRender", () => {
  it("registers as the wildcard renderer", () => {
    expect(WildcardToolCallRender.name).toBe("*");
  });

  it("starts collapsed and toggles the args/result panel on click", () => {
    render(
      <RenderComponent
        name="searchDocs"
        toolCallId="tc-1"
        args={{ query: "hooks" }}
        status={ToolCallStatus.Complete}
        result="3 matches"
      />,
    );

    expect(screen.getByText("searchDocs")).toBeTruthy();
    expect(screen.getByText(String(ToolCallStatus.Complete))).toBeTruthy();
    expect(screen.queryByText("Arguments")).toBeNull();

    fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Arguments")).toBeTruthy();
    expect(screen.getByText(/"query": "hooks"/)).toBeTruthy();
    expect(screen.getByText("3 matches")).toBeTruthy();

    fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.queryByText("Arguments")).toBeNull();
  });

  it("keeps its expanded state across status updates", () => {
    const { rerender } = render(
      <RenderComponent
        name="searchDocs"
        toolCallId="tc-1"
        args={{ query: "hooks" }}
        status={ToolCallStatus.InProgress}
        result={undefined}
      />,
    );

    fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Arguments")).toBeTruthy();
    expect(screen.queryByText("Result")).toBeNull();

    rerender(
      <RenderComponent
        name="searchDocs"
        toolCallId="tc-1"
        args={{ query: "hooks" }}
        status={ToolCallStatus.Complete}
        result="done"
      />,
    );

    expect(screen.getByText("Arguments")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });
});
