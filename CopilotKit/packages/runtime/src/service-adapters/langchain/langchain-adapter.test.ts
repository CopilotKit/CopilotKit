import { LangChainAdapter } from "./langchain-adapter";
import { RuntimeEventSource } from "../events";

describe("LangChainAdapter", () => {
  let serviceAdapter: LangChainAdapter;

  const chainFn = jest.fn();
  const chainStreamFn = jest.fn();

  it("should invoke a chain stream FN when the model is streaming", async () => {
    const eventSource = new RuntimeEventSource();
    serviceAdapter = new LangChainAdapter({
      chainStreamFn,
    });

    await serviceAdapter.process({ messages: [], actions: [], eventSource });

    expect(chainStreamFn).toHaveBeenCalledWith({
      messages: [],
      model: undefined,
      runId: undefined,
      tools: [],
    });
  });

  it("should invoke a chain FN when the model is not streaming", async () => {
    const eventSource = new RuntimeEventSource();
    serviceAdapter = new LangChainAdapter({
      chainFn,
    });

    await serviceAdapter.process({ messages: [], actions: [], eventSource });

    expect(chainFn).toHaveBeenCalledWith({
      messages: [],
      model: undefined,
      runId: undefined,
      tools: [],
    });
  });

  it("should invoke a chain stream FN as a default", async () => {
    const eventSource = new RuntimeEventSource();
    serviceAdapter = new LangChainAdapter({
      chainFn,
      chainStreamFn,
    });

    await serviceAdapter.process({ messages: [], actions: [], eventSource });

    expect(chainStreamFn).toHaveBeenCalledWith({
      messages: [],
      model: undefined,
      runId: undefined,
      tools: [],
    });
  });
});
