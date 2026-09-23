import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { CopilotChatView } from "../CopilotChatView";
import { ScrollPinnedContext } from "../scroll-pinned-context";

/**
 * `ScrollPinnedContext` tells the virtualizer when the pin-to-bottom
 * behaviour owns the scroll position, so it must follow the flag the pin's
 * animation loop actually checks — `state.isAtBottom` — and not the context's
 * `isAtBottom`, which is `isAtBottom || isNearBottom`. Those two disagree
 * exactly when the reader has scrolled up a little but is still inside the
 * near-bottom band: the pin has stood down, the combined flag has not.
 *
 * use-stick-to-bottom is stubbed so both flags can be set independently; its
 * real values come out of scroll geometry that jsdom does not have.
 */

const pin = vi.hoisted(() => ({
  isAtBottom: true,
  stateIsAtBottom: true,
}));

vi.mock("use-stick-to-bottom", () => {
  const context = {
    get isAtBottom() {
      return pin.isAtBottom;
    },
    state: {
      get isAtBottom() {
        return pin.stateIsAtBottom;
      },
    },
    scrollRef: { current: null },
    contentRef: { current: null },
    scrollToBottom: vi.fn(),
    stopScroll: vi.fn(),
    escapedFromLock: false,
  };
  const StickToBottom = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="stick-to-bottom">{children}</div>
  );
  StickToBottom.Content = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="stick-to-bottom-content">{children}</div>
  );
  return {
    StickToBottom,
    useStickToBottom: () => context,
    useStickToBottomContext: () => context,
  };
});

/** Stands in for the message view and reports the context it was given. */
function PinnedProbe() {
  const isPinned = React.useContext(ScrollPinnedContext);
  return <div data-testid="pinned">{String(isPinned)}</div>;
}

function renderChatView() {
  renderWithCopilotKit({
    children: (
      <CopilotChatView messageView={PinnedProbe} welcomeScreen={false} />
    ),
  });
}

afterEach(() => {
  cleanup();
  pin.isAtBottom = true;
  pin.stateIsAtBottom = true;
});

describe("CopilotChatView / ScrollPinnedContext", () => {
  it("reports pinned while the pin is following the bottom", () => {
    renderChatView();
    expect(screen.getByTestId("pinned").textContent).toBe("true");
  });

  it("reports not pinned once the pin has stood down", () => {
    pin.isAtBottom = false;
    pin.stateIsAtBottom = false;
    renderChatView();
    expect(screen.getByTestId("pinned").textContent).toBe("false");
  });

  it("reports not pinned inside the near-bottom band the pin has released", () => {
    // Scrolled up a little: still near the bottom, so the combined flag the
    // scroll-to-bottom button uses stays true, but the pin's animation loop
    // has already stopped moving anything.
    pin.isAtBottom = true;
    pin.stateIsAtBottom = false;
    renderChatView();
    expect(screen.getByTestId("pinned").textContent).toBe("false");
  });
});
