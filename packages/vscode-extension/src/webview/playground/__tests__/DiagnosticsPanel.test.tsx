/** @vitest-environment jsdom */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagnosticsPanel } from "../DiagnosticsPanel";

describe("DiagnosticsPanel", () => {
  it("reports no mount errors and not-started runtime initially", () => {
    render(
      <DiagnosticsPanel
        mountErrors={[]}
        runtimeUrl={null}
        replayMode={false}
        fixtureName={null}
      />,
    );
    expect(screen.getByText(/not started/i)).toBeDefined();
    expect(screen.getByText(/none/i)).toBeDefined();
  });

  it("lists mount errors when present", () => {
    render(
      <DiagnosticsPanel
        mountErrors={[
          {
            componentName: "MyPage",
            filePath: "/x/MyPage.tsx",
            error: { message: "boom" },
          },
        ]}
        runtimeUrl="http://127.0.0.1:1234"
        replayMode={false}
        fixtureName={null}
      />,
    );
    expect(screen.getByText(/1 component/)).toBeDefined();
    expect(screen.getByText(/MyPage/)).toBeDefined();
    expect(screen.getByText(/boom/)).toBeDefined();
  });

  it("shows replay fixture name when replay mode is active", () => {
    render(
      <DiagnosticsPanel
        mountErrors={[]}
        runtimeUrl="http://127.0.0.1:1234"
        replayMode={true}
        fixtureName="saved-session"
      />,
    );
    expect(screen.getByText(/Replay \(saved-session\)/)).toBeDefined();
  });
});
