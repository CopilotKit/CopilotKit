import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

export const agenticChatAgent = new Agent({
  name: "Agentic Chat Agent",
  instructions: `
      You are a highly efficient and functional Assistant.
      You MUST call the 'changeBackgroundTool' function when the user asks you to change the background color of the chat window.
`,
  model: openai("gpt-4o"),
});

export const humanInTheLoopAgent = new Agent({
  name: "Human in the Loop Agent",
  instructions: `
        You are a helpful assistant that can perform any task.
        You MUST call the "generateTaskSteps" function when the user asks you to perform a task.
        When the function "generateTaskSteps" is called, the user will decide to enable or disable a step.
        After the user has decided which steps to perform, provide a textual description of how you are performing the task.
        If the user has disabled a step, you are not allowed to perform that step.
        However, you should find a creative workaround to perform the task, and if an essential step is disabled, you can even use
        some humor in the description of how you are performing the task.
        Don't just repeat a list of steps, come up with a creative but short description (3 sentences max) of how you are performing the task.
  `,
  model: openai("gpt-4o"),
});

export const toolBasedGenerativeUiAgent = new Agent({
  name: "Tool Based Generative UI Agent",
  instructions: `
      You assist the user in generating a haiku. When generating a haiku use the 'generateHaiku' tool.
  `,
  model: openai("gpt-4o"),
});
