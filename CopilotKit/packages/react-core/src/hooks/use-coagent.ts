import { useState } from "react";

export function useCoagent<T = any>(options: UseCoagentOptions<T>): UseCoagentReturnType<T> {
  throw new Error("Not implemented");
}

const [appState, setAppState] = useState({
  story: "dasfsdf",
});

const [story, setStory] = useState({
  story: "dasfsdf",
});

const { nodeName } = useCoagent({
  name: "myAgent",
});

// what do we need from useCoagent?
// - nodeName
// - threadId
// - running
// - state

export function useCopilotAction<T = any>(coagentAction: CoagentAction<T>) {
  throw new Error("Not implemented");
}

// <CopilotKit agent="lockedInAgentName" />

export interface UseCoagentOptions<T> {
  name: string;
  initialState?: T;
  state?: T;
  setState?: (newState: T | ((prevState: T | undefined) => T)) => void;
}

export interface UseCoagentReturnType<T> {
  name: string;
  nodeName?: string;
  threadId?: string;
  running: boolean;
  state: T;
  setState: (newState: T | ((prevState: T | undefined) => T)) => void;
  start: () => void;
  stop: () => void;
}

export interface CoagentActionRenderProps<T> {
  status: "executing" | "complete" | "in_progress";
  args: T;
  result: any;
}

export interface CoagentAction<T> {
  name: string;
  nodeName?: string;
  handler?: (args: T) => any | Promise<any>;
  render?: (props: CoagentActionRenderProps<T>) => string | React.ReactElement;
}
