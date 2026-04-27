/**
 * Tests that useFrontendTool registers tools via useLayoutEffect (not useEffect).
 *
 * useLayoutEffect runs synchronously after React commit, before any useEffect
 * in the same render cycle. This guarantees that tools registered by
 * useFrontendTool are available in copilotkit.tools by the time sibling
 * components' useEffect callbacks fire (e.g., CopilotChat's connectAgent).
 *
 * This is critical for cross-page navigation: when a page mounts with both
 * tool-registering hooks and CopilotChat, the connect request must include
 * all frontend tools — even though everything mounts in the same render.
 */
import React, { useEffect, useRef } from "react";
import { waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";

describe("useFrontendTool timing", () => {
  it("tool is visible in copilotkit.tools during sibling useEffect", async () => {
    const agent = new MockStepwiseAgent();

    /**
     * Records whether the tool was present in copilotkit.tools at the time
     * this component's useEffect ran. If useFrontendTool uses useLayoutEffect,
     * the tool will be present. If it uses useEffect, the result depends on
     * component ordering and may be absent.
     */
    const observations: { toolPresentInEffect: boolean }[] = [];

    function ToolRegistrar() {
      useFrontendTool({
        name: "timingTestTool",
        description: "Tool for timing test",
        parameters: z.object({}),
        handler: async () => "ok",
      });
      return null;
    }

    function EffectObserver() {
      const { copilotkit } = useCopilotKit();
      const hasRun = useRef(false);

      useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const toolNames = copilotkit.tools.map((t) => t.name);
        observations.push({
          toolPresentInEffect: toolNames.includes("timingTestTool"),
        });
      }, [copilotkit]);

      return null;
    }

    renderWithCopilotKit({
      agent,
      children: (
        <>
          <ToolRegistrar />
          <EffectObserver />
        </>
      ),
    });

    await waitFor(() => {
      expect(observations.length).toBeGreaterThanOrEqual(1);
    });

    // The tool must be present when the sibling useEffect fires.
    // This only works if useFrontendTool registers via useLayoutEffect.
    expect(observations[0].toolPresentInEffect).toBe(true);
  });
});
