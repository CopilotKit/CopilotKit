/**
 * Regression test: resizing CopilotPopup must NOT remount the chat subtree.
 *
 * Root cause (pre-fix): CopilotPopup built its `chatView` override component
 * inside a `useMemo` keyed on `width`/`height`. Every resize commit produced a
 * NEW component function; rendering a new element *type* at that position makes
 * React unmount and remount the whole chat subtree. The remount reset the
 * scroll container's scrollTop to 0, after which `initial="smooth"` animated
 * the message list from top to bottom — the visible "scrolls from top to
 * bottom on every resize, from any scroll position" bug reported by consumers
 * driving width/height from a drag handle (e.g. Amazon's InkAgenticUITools
 * `useResize`).
 *
 * Fix: the override component identity is now stable (defined at module scope);
 * popup shell props flow through React context instead of the memo deps. A
 * resize is a plain re-render / style update — no remount.
 *
 * This test injects a mount-counting component through the `input` slot (which
 * renders inside the chat subtree) and asserts its mount count stays at 1
 * across width/height changes. On unfixed code the count increments on every
 * resize, reproducing the bug.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotPopup } from "../CopilotPopup";
import type { CopilotChatInputProps } from "../CopilotChatInput";

// Minimal agent so the popup renders a real chat subtree without a runtime.
class MockAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  clone(): MockAgent {
    const cloned = new MockAgent();
    cloned.agentId = this.agentId;
    (cloned as unknown as { subject: Subject<BaseEvent> }).subject =
      this.subject;
    return cloned;
  }
  async detachActiveRun(): Promise<void> {}
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

// Counts how many times it MOUNTS (not renders). A remount of the chat subtree
// unmounts the previous instance and mounts a fresh one, incrementing this.
let inputMountCount = 0;
function MountCountingInput(_props: CopilotChatInputProps) {
  React.useEffect(() => {
    inputMountCount++;
  }, []);
  return <div data-testid="mount-probe" />;
}

// Wrapper that lets the test drive width/height the way a resize handle would.
function Harness({ width, height }: { width: number; height: number }) {
  const agent = React.useMemo(() => new MockAgent(), []);
  return (
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      <CopilotPopup
        defaultOpen
        width={width}
        height={height}
        input={
          MountCountingInput as unknown as typeof import("../CopilotChatInput").default
        }
      />
    </CopilotKitProvider>
  );
}

describe("CopilotPopup resize does not remount the chat subtree", () => {
  beforeEach(() => {
    inputMountCount = 0;
  });

  it("keeps the chat subtree mounted across width/height changes", async () => {
    const { rerender } = render(<Harness width={420} height={560} />);

    // Subtree mounted once.
    expect(await screen.findByTestId("mount-probe")).toBeTruthy();
    expect(inputMountCount).toBe(1);

    // Simulate several resize commits (as a drag handle would on mouseup).
    rerender(<Harness width={500} height={600} />);
    rerender(<Harness width={360} height={700} />);
    rerender(<Harness width={420} height={560} />);

    // Regression guard: the subtree must NOT have remounted. On unfixed code
    // inputMountCount would be > 1 (one extra mount per resize).
    expect(inputMountCount).toBe(1);
  });
});
