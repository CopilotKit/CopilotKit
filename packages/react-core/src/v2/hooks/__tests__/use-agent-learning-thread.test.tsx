import React, { useLayoutEffect } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import { useCopilotKit } from "../../context";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useAgent } from "../use-agent";

describe("useAgent Learning thread attribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["configuration", "explicit proxy"] as const)(
    "exposes the committed %s thread before passive effects",
    (mode) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
      );
      const observations: {
        declared: string;
        attributed: string | undefined;
      }[] = [];
      const agent = new MockStepwiseAgent();
      const agents = { remote: agent };

      function Probe({ threadId }: { threadId: string }) {
        const { isReady } = useAgent(
          mode === "explicit proxy"
            ? { agentId: "headless", runtimeAgentId: "remote", threadId }
            : { agentId: "remote" },
        );
        const { copilotkit } = useCopilotKit();
        useLayoutEffect(() => {
          if (isReady) {
            observations.push({
              declared: threadId,
              attributed: copilotkit.ɵlearningThreads.getThreadId(),
            });
          }
        }, [copilotkit, isReady, threadId]);
        return null;
      }

      function App({ threadId }: { threadId: string }) {
        return (
          <CopilotKitProvider
            runtimeUrl="http://localhost:59999/api"
            agents__unsafe_dev_only={agents}
            learning={false}
          >
            <CopilotChatConfigurationProvider
              agentId="remote"
              threadId={threadId}
            >
              <Probe threadId={threadId} />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        );
      }

      const { rerender } = render(<App threadId="thread-a" />);
      rerender(<App threadId="thread-b" />);

      expect(observations).toContainEqual({
        declared: "thread-a",
        attributed: "thread-a",
      });
      expect(observations).toContainEqual({
        declared: "thread-b",
        attributed: "thread-b",
      });
      expect(
        observations.every(
          ({ declared, attributed }) => declared === attributed,
        ),
      ).toBe(true);
    },
  );
});
