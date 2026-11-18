/** A 1.x React app that uses exports that CopilotKit 2.0 removed. */
import {
  CopilotTask,
  ThreadsProvider,
  useCopilotAction,
  useCopilotChat,
} from "@copilotkit/react-core";
import type { FrontendAction } from "@copilotkit/react-core";
import { useLearningContainers } from "@copilotkit/react-core/v2";

export function Greeter() {
  // A call of a removed hook.
  // @ts-expect-error Use useFrontendTool from @copilotkit/react-core
  useCopilotAction({ name: "sayHello", handler: () => "Hello" });
  // A call without arguments.
  // @ts-expect-error Use useAgent from @copilotkit/react-core
  useCopilotChat();
  // A name that the deprecated /v2 alias lost.
  // @ts-expect-error Set getLearningContainerId on CopilotKitIntelligence
  useLearningContainers();
  return null;
}

export function runTask() {
  // `new` on a removed class.
  // @ts-expect-error Run the agent from code
  return new CopilotTask({ instructions: "Summarize the sales data" });
}

export function App() {
  return (
    // A render of a removed component.
    // @ts-expect-error Pass threadId to CopilotChat
    <ThreadsProvider>
      <Greeter />
    </ThreadsProvider>
  );
}

// A value of a removed type.
// @ts-expect-error Use ReactFrontendTool from @copilotkit/react-core
export const greet: FrontendAction = { name: "greet", handler: () => "Hi" };
