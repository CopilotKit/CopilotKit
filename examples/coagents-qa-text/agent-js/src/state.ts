import { Annotation } from "@langchain/langgraph";
import { MessagesAnnotation } from "@langchain/langgraph";

// Define the AgentState annotation, extending MessagesState
export const AgentStateAnnotation = Annotation.Root({
  model: Annotation<string>,
  name: Annotation<string>,
  ...MessagesAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;
