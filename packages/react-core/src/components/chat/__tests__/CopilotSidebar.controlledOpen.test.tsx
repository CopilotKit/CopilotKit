/**
 * `<CopilotSidebar>` / `<CopilotPopup>` controlled open state (issue #3334).
 *
 * v1 exposed `open` + `onSetOpen`, so a host could open and close the chat from
 * its own UI. v2 shipped only `defaultOpen`, which made the open state
 * reachable exclusively from inside the chat subtree. These tests cover the
 * restored controlled contract:
 *
 * - `open` is rendered from the first frame (no open-then-close flash).
 * - A request from inside (toggle button) is reported through `onOpenChange`
 *   and does NOT move the surface on its own.
 * - The uncontrolled `defaultOpen` path is unchanged.
 * - Flipping `open` does not remount the chat subtree (the element-type churn
 *   trap already fixed for popup resize; see CopilotPopup.resizeRemount).
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotSidebar } from "../CopilotSidebar";
import { CopilotPopup } from "../CopilotPopup";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import type CopilotChatInput from "../CopilotChatInput";
import type { CopilotChatInputProps } from "../CopilotChatInput";

function getSidebar(container: HTMLElement): Element {
  const sidebar = container.querySelector("[data-copilot-sidebar]");
  if (!sidebar) throw new Error("sidebar aside not found");
  return sidebar;
}

function isSurfaceOpen(element: Element): boolean {
  return element.getAttribute("aria-hidden") !== "true";
}

// The popup mounts its window only while open, so "closed" is absence.
function isPopupRendered(container: HTMLElement): boolean {
  return container.querySelector('[data-testid="copilot-popup"]') !== null;
}

function clickToggle(): void {
  fireEvent.click(screen.getByTestId("copilot-chat-toggle"));
}

type SidebarHarnessProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  input?: React.ComponentType<CopilotChatInputProps>;
};

function SidebarHarness({
  open,
  onOpenChange,
  defaultOpen,
  input,
}: SidebarHarnessProps) {
  const agent = React.useMemo(() => new MockStepwiseAgent(), []);
  return (
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      <CopilotSidebar
        open={open}
        onOpenChange={onOpenChange}
        defaultOpen={defaultOpen}
        input={input as unknown as typeof CopilotChatInput}
      />
    </CopilotKitProvider>
  );
}

describe("CopilotSidebar controlled open state (#3334)", () => {
  it("renders closed on the first frame when open={false}", () => {
    const { container } = render(<SidebarHarness open={false} />);

    // Asserted on the first committed frame: a fix that opened first and
    // corrected afterwards would leave a visible flash.
    expect(isSurfaceOpen(getSidebar(container))).toBe(false);
  });

  it("renders open when open={true}", () => {
    const { container } = render(<SidebarHarness open={true} />);

    expect(isSurfaceOpen(getSidebar(container))).toBe(true);
  });

  it("opens and closes as the host flips open", () => {
    const { container, rerender } = render(<SidebarHarness open={false} />);
    expect(isSurfaceOpen(getSidebar(container))).toBe(false);

    rerender(<SidebarHarness open={true} />);
    expect(isSurfaceOpen(getSidebar(container))).toBe(true);

    rerender(<SidebarHarness open={false} />);
    expect(isSurfaceOpen(getSidebar(container))).toBe(false);
  });

  it("reports a toggle request through onOpenChange without moving on its own", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <SidebarHarness open={false} onOpenChange={onOpenChange} />,
    );

    clickToggle();

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Controlled contract: the host ignored the request, so nothing moved.
    expect(isSurfaceOpen(getSidebar(container))).toBe(false);
  });

  it("reports a close request through onOpenChange while staying open", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <SidebarHarness open={true} onOpenChange={onOpenChange} />,
    );

    clickToggle();

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(isSurfaceOpen(getSidebar(container))).toBe(true);
  });

  it("drives the surface when the host echoes onOpenChange back into open", () => {
    function ControlledHost() {
      const [open, setOpen] = React.useState(false);
      const agent = React.useMemo(() => new MockStepwiseAgent(), []);
      return (
        <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
          <button data-testid="host-open" onClick={() => setOpen(true)}>
            open
          </button>
          <CopilotSidebar open={open} onOpenChange={setOpen} />
        </CopilotKitProvider>
      );
    }

    const { container } = render(<ControlledHost />);
    expect(isSurfaceOpen(getSidebar(container))).toBe(false);

    // A button OUTSIDE the sidebar drives it: the case reported in #3334.
    fireEvent.click(screen.getByTestId("host-open"));
    expect(isSurfaceOpen(getSidebar(container))).toBe(true);

    // And the built-in toggle closes it through the same state.
    clickToggle();
    expect(isSurfaceOpen(getSidebar(container))).toBe(false);
  });

  describe("uncontrolled path is unchanged", () => {
    it("honors defaultOpen={false} and still toggles from inside", () => {
      const { container } = render(<SidebarHarness defaultOpen={false} />);
      expect(isSurfaceOpen(getSidebar(container))).toBe(false);

      clickToggle();
      expect(isSurfaceOpen(getSidebar(container))).toBe(true);
    });

    it("defaults to open when neither open nor defaultOpen is given", () => {
      const { container } = render(<SidebarHarness />);
      expect(isSurfaceOpen(getSidebar(container))).toBe(true);
    });

    it("stays put when the host stops controlling open", () => {
      const { container, rerender } = render(<SidebarHarness open={false} />);
      expect(isSurfaceOpen(getSidebar(container))).toBe(false);

      // Handing control back must not jump to defaultOpen (which is `true`):
      // the underlying state was seeded from `open`.
      rerender(<SidebarHarness />);
      expect(isSurfaceOpen(getSidebar(container))).toBe(false);
    });

    it("reports through onOpenChange and still moves when open is omitted", () => {
      const onOpenChange = vi.fn();
      const { container } = render(
        <SidebarHarness defaultOpen={false} onOpenChange={onOpenChange} />,
      );

      clickToggle();

      // onOpenChange alone is a notification, not a takeover: the sidebar
      // still owns its state, so it moved.
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(isSurfaceOpen(getSidebar(container))).toBe(true);
    });
  });
});

// Counts MOUNTS (not renders) of a component inside the chat subtree.
let inputMountCount = 0;
function MountCountingInput(_props: CopilotChatInputProps) {
  React.useEffect(() => {
    inputMountCount++;
  }, []);
  return <div data-testid="mount-probe" />;
}

describe("CopilotSidebar open changes do not remount the chat subtree", () => {
  beforeEach(() => {
    inputMountCount = 0;
  });

  it("keeps the chat subtree mounted across open flips", async () => {
    const { rerender } = render(
      <SidebarHarness open={true} input={MountCountingInput} />,
    );

    expect(await screen.findByTestId("mount-probe")).toBeTruthy();
    expect(inputMountCount).toBe(1);

    rerender(<SidebarHarness open={false} input={MountCountingInput} />);
    rerender(<SidebarHarness open={true} input={MountCountingInput} />);
    rerender(<SidebarHarness open={false} input={MountCountingInput} />);

    // Threading `open` through the memoized chatView override would mint a new
    // element type per flip and remount the subtree, resetting scroll state.
    expect(inputMountCount).toBe(1);
  });
});

describe("CopilotPopup controlled open state (#3334)", () => {
  function PopupHarness({
    open,
    onOpenChange,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) {
    const agent = React.useMemo(() => new MockStepwiseAgent(), []);
    return (
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotPopup open={open} onOpenChange={onOpenChange} />
      </CopilotKitProvider>
    );
  }

  it("renders closed on the first frame when open={false}", () => {
    const { container } = render(<PopupHarness open={false} />);

    expect(isPopupRendered(container)).toBe(false);
  });

  it("renders open when open={true}", () => {
    const { container } = render(<PopupHarness open={true} />);

    expect(isPopupRendered(container)).toBe(true);
  });

  it("defaults to open when neither open nor defaultOpen is given", () => {
    const { container } = render(<PopupHarness />);

    expect(isPopupRendered(container)).toBe(true);
  });

  it("reports a toggle request through onOpenChange without moving on its own", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <PopupHarness open={false} onOpenChange={onOpenChange} />,
    );

    clickToggle();

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(isPopupRendered(container)).toBe(false);
  });
});
