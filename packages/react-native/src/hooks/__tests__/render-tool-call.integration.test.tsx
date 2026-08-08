import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { useRenderTool } from "../useRenderTool";
import { useComponent, useRenderToolCall } from "../../headless";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";

/**
 * Regression assertions ported from PR #6346 (David McKay). That PR verified
 * these against RN's own registry with `vi.mock`; here they run through the real
 * CopilotKitCoreReact registry, so they also prove the convergence itself.
 */

/** Renders one tool call and reports the props the registered renderer saw. */
function renderCall(
  args: string | undefined,
  toolMessage?: { content?: string },
) {
  let seen: any = null;

  function Probe() {
    useRenderTool({
      name: "showAbout",
      description: "Show about",
      parameters: z.object({ dataId: z.string() }),
      render: (props) => {
        seen = props;
        return null;
      },
    });
    const renderToolCall = useRenderToolCall();
    return (
      <>
        {renderToolCall({
          toolCall: {
            id: "tc-1",
            type: "function",
            function: { name: "showAbout", arguments: args as string },
          },
          toolMessage: toolMessage as never,
        })}
      </>
    );
  }

  render(
    <TestCopilotKit messages={[]}>
      <Probe />
    </TestCopilotKit>,
  );
  return seen;
}

describe("useRenderToolCall on React Native", () => {
  it("renders a registered component for a tool call", () => {
    const props = renderCall('{"dataId":"zosch"}');
    expect(props).not.toBeNull();
    expect(props.args).toEqual({ dataId: "zosch" });
  });

  it("exposes PARTIAL args with status inProgress while arguments are incomplete", () => {
    const props = renderCall('{"dataId":"neues-mus');
    expect(props.status).toBe("inProgress");
    expect(props.args).toEqual({ dataId: "neues-mus" });
  });

  it("does not throw on a fragment with no complete key yet", () => {
    const props = renderCall('{"places":[{"title":"Roof');
    expect(props.status).toBe("inProgress");
    expect(props.args).toBeTypeOf("object");
  });

  it("reports complete and passes the result through when a tool message exists", () => {
    const props = renderCall('{"dataId":"zosch"}', { content: "ok" });
    expect(props.status).toBe("complete");
    expect(props.result).toBe("ok");
  });

  it("treats absent arguments as an empty object, not a crash", () => {
    const props = renderCall(undefined);
    expect(props.args).toEqual({});
  });

  it("returns null for a tool with no registered renderer", () => {
    let out: unknown = "unset";
    function Probe() {
      const renderToolCall = useRenderToolCall();
      out = renderToolCall({
        toolCall: {
          id: "x",
          type: "function",
          function: { name: "notRegistered", arguments: "{}" },
        },
      });
      return null;
    }
    render(
      <TestCopilotKit messages={[]}>
        <Probe />
      </TestCopilotKit>,
    );
    expect(out).toBeNull();
  });
});

describe("useComponent on React Native", () => {
  it("renders on a custom surface — the bug this convergence fixes", () => {
    // Before: react-core's useComponent wrote to core's registry while RN's chat
    // read RN's Map, so a component registered this way rendered NOWHERE on RN.
    let received: any = null;

    function Probe() {
      useComponent({
        name: "showCity",
        parameters: z.object({ city: z.string() }),
        render: (props: any) => {
          received = props;
          return null;
        },
      });
      const renderToolCall = useRenderToolCall();
      return (
        <>
          {renderToolCall({
            toolCall: {
              id: "tc-2",
              type: "function",
              function: { name: "showCity", arguments: '{"city":"Berlin"}' },
            },
          })}
        </>
      );
    }

    render(
      <TestCopilotKit messages={[]}>
        <Probe />
      </TestCopilotKit>,
    );

    // Props are the tool arguments, spread — the component needs no CopilotKit knowledge.
    expect(received).toMatchObject({ city: "Berlin" });
  });
});
