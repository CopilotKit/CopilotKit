import React, { useEffect } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { A2UIProvider } from "../core/A2UIProvider";
import { useA2UI } from "../hooks/useA2UI";

/**
 * The A2UI processor keeps the operation objects it is given as its data
 * model and edits them as the user interacts. Operations come from an agent
 * message's content, so the provider must hand over a copy: otherwise form
 * input would be written into the conversation history.
 */

const operations = [
  {
    version: "v0.9",
    createSurface: {
      surfaceId: "surface",
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
    },
  },
  {
    version: "v0.9",
    updateDataModel: { surfaceId: "surface", value: { name: "original" } },
  },
];

function Process({ ops }: { ops: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(ops as any);
  }, [processMessages, ops]);
  return null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("A2UIProvider.processMessages", () => {
  it("hands the processor a copy of the operations, not the agent's objects", () => {
    const received: unknown[][] = [];
    vi.spyOn(MessageProcessor.prototype, "processMessages").mockImplementation(
      function (messages: unknown[]) {
        received.push(messages);
      } as any,
    );

    render(
      <A2UIProvider>
        <Process ops={operations} />
      </A2UIProvider>,
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(operations);
    expect(received[0]).not.toBe(operations);
    expect((received[0]![1] as any).updateDataModel.value).not.toBe(
      operations[1]!.updateDataModel!.value,
    );
  });
});
