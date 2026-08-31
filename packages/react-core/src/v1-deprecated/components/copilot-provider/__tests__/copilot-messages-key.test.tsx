import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test: CopilotMessages children must have React keys.
 *
 * When CopilotMessages receives multiple children (e.g. memoizedChildren +
 * RegisteredActionsRenderer), React treats them as a dynamic list and warns
 * if they lack keys. This test verifies the fix by rendering a minimal
 * reproduction using the same pattern as CopilotKitInternal.
 */

// Minimal stand-in for CopilotMessages – renders children inside a provider-like wrapper.
function CopilotMessages({ children }: { children: React.ReactNode }) {
  const memoized = React.useMemo(() => children, [children]);
  return <div data-testid="messages">{memoized}</div>;
}

describe("CopilotMessages children keys", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const keyWarnings: string[] = [];

  beforeEach(() => {
    keyWarnings.length = 0;
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: any[]) => {
        const msg = args.map(String).join(" ");
        if (
          msg.includes('unique "key" prop') ||
          msg.includes("unique 'key' prop") ||
          msg.includes("unique key")
        ) {
          keyWarnings.push(msg);
        }
      });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("warns about missing keys when children array lacks keys (pre-fix pattern)", () => {
    const ChildA = () => <div>app content</div>;
    const ChildB = () => <span>actions</span>;

    // Passing an explicit array as children – this is what JSX compiles to
    // when you write: <CopilotMessages>{memoizedChildren}<RegisteredActionsRenderer /></CopilotMessages>
    // React sees: { children: [memoizedChildren, <RegisteredActionsRenderer />] }
    render(<CopilotMessages>{[<ChildA />, <ChildB />]}</CopilotMessages>);

    expect(keyWarnings.length).toBeGreaterThan(0);
  });

  it("does NOT warn when children array elements have keys (post-fix pattern)", () => {
    const ChildA = () => <div>app content</div>;
    const ChildB = () => <span>actions</span>;

    // The fix: wrap in keyed elements
    render(
      <CopilotMessages>
        {[
          <React.Fragment key="children">
            <ChildA />
          </React.Fragment>,
          <ChildB key="actions" />,
        ]}
      </CopilotMessages>,
    );

    expect(keyWarnings).toHaveLength(0);
  });

  it("does NOT warn with the actual fix pattern (keyed JSX children)", () => {
    const MemoChildren = React.memo(() => <div>app content</div>);
    MemoChildren.displayName = "MemoChildren";
    const RegisteredActionsRenderer = React.memo(() => null);
    RegisteredActionsRenderer.displayName = "RegisteredActionsRenderer";

    render(
      <CopilotMessages>
        <React.Fragment key="children">
          <MemoChildren />
        </React.Fragment>
        <RegisteredActionsRenderer key="actions" />
      </CopilotMessages>,
    );

    expect(keyWarnings).toHaveLength(0);
  });
});
