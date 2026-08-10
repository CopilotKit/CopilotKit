import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { ToolMessage } from "@ag-ui/client";
import { useRenderTool } from "../useRenderTool";
import type { RenderToolProps } from "../render-tool-types";
import { useComponent, useRenderToolCall } from "../../headless";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";
import { toolMessage } from "../../__mocks__/tool-fixtures";

/**
 * Regression assertions ported from PR #6346 (David McKay). That PR verified
 * these against RN's own registry with `vi.mock`; here they run through the real
 * CopilotKitCoreReact registry, so they also prove the convergence itself.
 */

/** Args the probe's tool declares, so its render props are typed rather than `any`. */
type AboutArgs = { dataId: string };

/**
 * Renders one tool call and reports the props the registered renderer saw.
 *
 * `resultMessage` is a full `ToolMessage`, NOT a `{ content }` stub: the
 * `toolCallId` it carries is what production correlates a result to a call by.
 * `useRenderToolCall` renders whatever message it is handed and never checks
 * that id itself — the map that does is `CopilotChat`'s, exercised in
 * `components/__tests__/CopilotChatToolCalls.test.tsx` — so a stub here would
 * assert a `result` arriving for a tool call nothing ever tied it to.
 */
function renderCall(
  args: string | undefined,
  resultMessage?: ToolMessage,
): RenderToolProps<AboutArgs> {
  // A mutable box rather than a `let`, so the captured value keeps its declared
  // type after `render()` instead of being narrowed to the `null` initializer.
  const seen: { props?: RenderToolProps<AboutArgs> } = {};

  function Probe() {
    useRenderTool<AboutArgs>({
      name: "showAbout",
      description: "Show about",
      parameters: z.object({ dataId: z.string() }),
      render: (props) => {
        seen.props = props;
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
            // The `arguments` field is a `string` in the AG-UI type; `undefined`
            // is the degenerate runtime input one test below deliberately feeds
            // it, which the type cannot express.
            function: { name: "showAbout", arguments: args as string },
          },
          toolMessage: resultMessage,
        })}
      </>
    );
  }

  render(
    <TestCopilotKit messages={[]}>
      <Probe />
    </TestCopilotKit>,
  );

  if (!seen.props) {
    throw new Error("the registered renderer was never invoked");
  }
  return seen.props;
}

describe("useRenderToolCall on React Native", () => {
  it("renders a registered component for a tool call", () => {
    // `renderCall` throws if the renderer never ran, so reaching this line is
    // itself the "it rendered" assertion.
    const props = renderCall('{"dataId":"zosch"}');
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
    const props = renderCall(
      '{"dataId":"zosch"}',
      // Correlated to the tool call this probe renders ("tc-1"), so the fixture
      // states the relationship the assertion below depends on instead of
      // leaving it to a cast.
      toolMessage("tc-1", "ok"),
    );
    expect(props.status).toBe("complete");
    expect(props.result).toBe("ok");
    // Ties the two together: the id the renderer reports is the same id the
    // result above was filed under, so this really is that call's result.
    expect(props.toolCallId).toBe("tc-1");
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
    // Same mutable-box reason as `renderCall` above: a `let` assigned only inside
    // the render callback stays narrowed to its initializer for the type-checker.
    const received: { props?: { city: string } } = {};

    function Probe() {
      useComponent({
        name: "showCity",
        parameters: z.object({ city: z.string() }),
        render: (props) => {
          received.props = props;
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
    expect(received.props).toMatchObject({ city: "Berlin" });
  });
});
