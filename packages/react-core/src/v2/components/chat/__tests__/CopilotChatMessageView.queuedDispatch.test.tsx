import React, { useEffect, useState } from "react";
import { act, cleanup } from "@testing-library/react";
import type { UserMessage } from "@ag-ui/client";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import {
  createScrollableElement,
  drainAnimationFrames,
  userMessages,
} from "../../../__tests__/utils/virtualization";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";

/**
 * A queued message renders after the virtualized list. When it dispatches it
 * joins the list as its last row, and pin-to-send looks for it by id in the
 * effects of that same commit, without retrying. So for a reader still at
 * the bottom, the row has to be mounted in the commit it joins.
 */
const mounted = (id: string) =>
  document.querySelector(`[data-message-id="${id}"]`) !== null;

describe("CopilotChatMessageView: a queued message joining a virtualized list", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("mounts its row in the commit it joins, for a reader at the bottom", async () => {
    const { element, scrollTo } = createScrollableElement();
    const queued: UserMessage = {
      id: "queued",
      role: "user",
      content: "queued",
    };
    let dispatch!: () => void;
    let atJoin: { queued: boolean; first: boolean } | undefined;

    const Probe = ({ joined }: { joined: boolean }) => {
      useEffect(() => {
        if (joined && !atJoin)
          atJoin = { queued: mounted("queued"), first: mounted("m-0") };
      });
      return null;
    };
    const Chat = () => {
      const [sent, setSent] = useState(false);
      dispatch = () => setSent(true);
      return (
        <ScrollElementContext.Provider value={element}>
          <CopilotChatMessageView
            messages={sent ? [...userMessages(60), queued] : userMessages(60)}
            queuedMessages={sent ? [] : [queued]}
          />
          <Probe joined={sent} />
        </ScrollElementContext.Provider>
      );
    };

    renderWithCopilotKit({ children: <Chat /> });
    await drainAnimationFrames();
    await scrollTo(60 * 100 - 600);
    await act(async () => dispatch());

    // The list is virtualized (its first row is not mounted), and the
    // dispatched row is.
    expect(atJoin).toEqual({ queued: true, first: false });
    await drainAnimationFrames();
  });
});
