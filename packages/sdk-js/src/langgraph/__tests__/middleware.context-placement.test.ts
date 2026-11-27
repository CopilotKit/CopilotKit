import { describe, expect, it } from "vitest";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { createCopilotkitMiddleware } from "../middleware";

type Captured = {
  systemMessage?: SystemMessage;
  systemPrompt?: string;
  messages: any[];
  tools: any[];
};

const history = (turns: number) => {
  const messages: any[] = [];
  for (let i = 1; i <= turns; i++) {
    messages.push(new HumanMessage({ content: `Question ${i}`, id: `h${i}` }));
    if (i < turns) messages.push(new AIMessage(`Answer ${i}`));
  }
  return messages;
};

const frontendTool = (name: string) => ({
  type: "function",
  function: { name, description: name, parameters: {} },
});

// One model call of turn `n`. The page, the state and the order of the
// frontend tools change between turns, as they do in a real app.
async function modelCall(
  n: number,
  options: Parameters<typeof createCopilotkitMiddleware>[0],
): Promise<Captured> {
  const middleware = createCopilotkitMiddleware(options);
  const request = {
    state: {
      selected: `c-${n}`,
      copilotkit: {
        context: [{ description: "Current page", value: `/page-${n}` }],
        actions:
          n % 2 === 0
            ? [frontendTool("a_tool"), frontendTool("b_tool")]
            : [frontendTool("b_tool"), frontendTool("a_tool")],
      },
    },
    model: {},
    tools: [],
    messages: history(n),
    runtime: {},
    systemMessage: new SystemMessage("You are a CRM assistant."),
  };
  let received: Captured = request;
  await (middleware as any).wrapModelCall(request, async (req: Captured) => {
    received = req;
    return new AIMessage("ok");
  });
  return received;
}

describe("CopilotKitMiddleware contextPlacement", () => {
  it('keeps the system message and the earlier messages the same across turns with "message"', async () => {
    const options = { contextPlacement: "message" as const, exposeState: true };
    const first = await modelCall(1, options);
    const second = await modelCall(2, options);

    expect(second.systemMessage?.text).toBe(first.systemMessage?.text);
    expect(second.systemMessage?.text).toBe("You are a CRM assistant.");
    // The earlier human message goes to the model without its old context.
    expect(second.messages[0].content).toBe("Question 1");
  });

  it('puts the app context and the state at the start of the newest human message with "message"', async () => {
    const call = await modelCall(2, {
      contextPlacement: "message",
      exposeState: true,
    });
    const newest = call.messages.at(-1);

    expect(HumanMessage.isInstance(newest)).toBe(true);
    expect(newest.id).toBe("h2");
    expect(newest.content).toContain("App Context:");
    expect(newest.content).toContain("/page-2");
    expect(newest.content).toContain("Current agent state:");
    expect(newest.content).toContain("c-2");
    expect(newest.content.endsWith("Question 2")).toBe(true);
  });

  it("keeps the app context in the system message by default", async () => {
    const call = await modelCall(2, { exposeState: true });

    expect(call.systemMessage?.text).toContain("/page-2");
    expect(call.systemMessage?.text).toContain("c-2");
    expect(call.messages.at(-1).content).toBe("Question 2");
  });

  it("keeps the app context in the system message when no human message can carry it", async () => {
    const middleware = createCopilotkitMiddleware({
      contextPlacement: "message",
    });
    const request = {
      state: { copilotkit: { context: "Page: /contacts" } },
      model: {},
      tools: [],
      messages: [new AIMessage("Welcome")],
      runtime: {},
      systemMessage: new SystemMessage("You are a CRM assistant."),
    };
    let received: Captured = request;
    await (middleware as any).wrapModelCall(request, async (req: Captured) => {
      received = req;
      return new AIMessage("ok");
    });

    expect(received.systemMessage?.text).toContain("/contacts");
  });

  it("sorts the frontend tools by name", async () => {
    const odd = await modelCall(1, {});
    const even = await modelCall(2, {});

    expect(odd.tools.map((t) => t.function.name)).toEqual(["a_tool", "b_tool"]);
    expect(even.tools.map((t) => t.function.name)).toEqual([
      "a_tool",
      "b_tool",
    ]);
  });
});
