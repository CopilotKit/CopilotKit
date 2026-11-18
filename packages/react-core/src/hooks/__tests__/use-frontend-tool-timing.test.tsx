/**
 * `useFrontendTool` must register its tool before any sibling's `useEffect`
 * runs, not merely before some siblings'.
 *
 * React flushes passive effects (`useEffect`) child-first in tree order, so a
 * consumer mounted BEFORE the registering component sees an empty tool list.
 * That is the cross-page-navigation failure: a page mounts `CopilotChat` and
 * its tool-registering components in one commit, `CopilotChat`'s connect
 * effect fires first, and the connect request carries no frontend tools.
 *
 * Layout effects run during commit, ahead of every passive effect regardless
 * of order, so registering in `useLayoutEffect` closes the window.
 *
 * The consumer is deliberately mounted FIRST here. Mounting it second passes
 * with either hook and proves nothing.
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

describe("useFrontendTool registration timing", () => {
  it("registers the tool before an earlier-mounted sibling's useEffect runs", async () => {
    const agent = new MockStepwiseAgent();
    const observed: string[][] = [];

    /** Mounted FIRST — stands in for CopilotChat's connect effect. */
    function EarlyConsumer() {
      const { copilotkit } = useCopilotKit();
      const done = useRef(false);
      useEffect(() => {
        if (done.current) return;
        done.current = true;
        observed.push(copilotkit.tools.map((t) => t.name));
      }, [copilotkit]);
      return null;
    }

    /** Mounted SECOND — stands in for a page's tool-registering component. */
    function LateRegistrar() {
      useFrontendTool({
        name: "timingTestTool",
        description: "Tool for timing test",
        parameters: z.object({}),
        handler: async () => "ok",
      });
      return null;
    }

    renderWithCopilotKit({
      agent,
      children: (
        <>
          <EarlyConsumer />
          <LateRegistrar />
        </>
      ),
    });

    await waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1));
    expect(observed[0]).toContain("timingTestTool");
  });
});
