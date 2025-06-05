export const initialPrompt = {
    agenticChat: `This is the simplest chat agent.

It can be built with CopilotKit's headless UI, or with CopilotKit's customizable pre-built components.

This agent also supports frontend tool calls: try to ask it to 'Set the background to a pink-yellow gradient'.`,

    humanInTheLoop: `This agent demonstrates human-in-the-loop (HITL). Ask it to do anything (e.g. 'Go to mars') and it will respond with a checklist plan that the user can edit and comment on.

HITL support is fully open-ended: the input & output of the HITL interaction are both generic JSON objects, and the rendered UI is a fully custom react component. HITL is supported both inside the chat and outside the chat. Check useLangGraphInterrupt(...) hook for details.

Go ahead and try it out! e.g. say 'go to mars!'.`,

    agenticGenerativeUI: `This agent demonstrates agentic generative UI: rendering of the agent's state. Ask it to perform some task ('Go to mars') and it will simulate going through the motions of the task.

Agentic generative UI is useful both to keep users engaged during agent execution, and to allow for agent-steering (allow users to bring the agent back on track if it goes down the wrong path).

Agentic generative UI is fully open-ended: simply return any custom react component as it runs. Check the useCoAgentStateRender(...) hook for details..`,

    toolCallingGenerativeUI: `This agent demonstrates tool-calling generative UI. Ask it to 'Generate a haiku about AI'

Agentic generative UI is fully open-ended, and  seamlessly supports in-chat and outside-chat experiences. See useCopilotAction(...) for details.`,

    sharedState: `This example demonstrates shared state between the agent and the application. Shared state binds the frontend and the agent into a single coherent system: Whatever changes the agent makes to its internal state, are reflected in the application state, and vice-versa.

Try to ask it for some recipe, e.g. 'Create a recipe for a spicy pasta dish.', and watch as the state updates. You can then modify the state manually, and chat with the agent to observe it 'sees' your edits.`,

    predictiveStateUpdates : `This agent demonstrates predictive state updates: updates of the agent state prior to execution end. Ask the agent to tell you a short story about pirates - then accept its suggestions. Then ask it to change the pirate's name to George and see what happens.`
}


export const chatSuggestions = {
    agenticChat: `Provide suggestions to change the background color of the chat like "Set the background to a green gradient". Make sure to always list the "Set the background to a pink-yellow gradient" suggestion as the first suggestion.`,
    humanInTheLoop: `Provide some suggested actions to perform like "Go to mars". Make sure to always have a "Go to mars" action in suggestions and strictly show it as the first action.`,
    agenticGenerativeUI: `Provide some suggested actions to perform like "Go to mars". Make sure to always have a "Go to mars" action in suggestions and strictly show it as the first action.`,
    toolCallingGenerativeUI: `Provide some suggested actions to perform like "Generate a haiku about AI". Make sure to always have a "Generate a haiku about AI" action in suggestions and strictly show it as the first action. Make sure to always have the word Haiku on all suggestions.`,
    sharedState: `Provide suggestions to make different recipes. Make the responses vivid and creative. Make sure to always list the "Create a recipe for a spicy pasta dish." suggestion as the first suggestion.`,
    predictiveStateUpdates: `When user initates the first chat, provide suggestions to generate stories on specific topics. Strictly include "pirate story" as the first suggestion and when clicks the pirate story, the second set of suggestions should include "change the name of the pirate to George". When a story is generated, provide suggestions to change the story like change characters' name, change the story's setting, etc.`,
}

export const instructions = {
    toolCallingGenerativeUI: `You are a haiku generator. You generate haiku based on the user's input. When creating you must use the tools provided effectively. Make sure to have an array of 3 english sentences and an array of 3 japanese sentences and you must give an array of 3 relevant image names based on the haiku. Strictly use only the provided image names : {IMAGE_NAMES}. Once generated, you must use the generate_haiku tool for sure.`,
    agenticGenerativeUI: `You are a helpful assistant assisting with any task. Make up 10 steps (only a couple of words per step) that are required for a task that user asks. The step should be in gerund form (i.e. Digging hole, opening door, ...). Make sure to have an array of 10 objects. Each object should have a description and a status. The description should be in gerund form and the status should be "pending". You MUST NOT repeat the steps in your next response to the user. Just give a very brief summary (one sentence) of what you did with some emojis. Always say you actually did the steps, not merely generated them.`,
    predictiveStateUpdates: `You are a helpful assistant for writing documents. 
    To write the document, you MUST use the write_document tool.
    You MUST write the full document, even when changing only a few words.
    When you wrote the document, DO NOT repeat it as a message. 
    Just briefly summarize the changes you made. 2 sentences max.
    You MUST call the confirm_changes action to confirm the changes after you successfully made the tool call to write_document tool at the end of your response.`,
    humanInTheLoop: `You are a helpful assistant for planning tasks. Make up 10 steps (only a couple of words per step) that are required for a task that user asks. The step should be in imperative form (i.e. Dig hole, Open door, ...). Make sure to have an array of 10 objects. Each object should have a description and a status. The description should be in imperative form and the status should be "enabled". You MUST NOT repeat the steps in your next response to the user. Just give a very brief summary (one sentence) of what you did with some emojis. Always say you actually did the steps, not merely generated them. While summarizing, include the steps that user added as well.`,
}
