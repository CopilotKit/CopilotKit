import { LangGraphInterruptEvent } from "@copilotkit/runtime-client-gql";
import { AgentSession } from "../context/copilot-context";

export interface LangGraphInterruptRender<TEventValue = any> {
  id: string;
  /**
   * The handler function to handle the event.
   */
  handler?: (props: {
    event: LangGraphInterruptEvent<TEventValue>;
    resolve: (resolution: string) => void;
  }) => unknown | Promise<unknown>;
  /**
   * The render function to handle the event.
   */
  render?: (props: {
    result: unknown;
    event: LangGraphInterruptEvent<TEventValue>;
    resolve: (resolution: string) => void;
  }) => string | React.ReactElement;
  /**
   * Method that returns a boolean, indicating if the interrupt action should run
   * Useful when using multiple interrupts
   */
  enabled?: (args: { eventValue: TEventValue; agentMetadata: AgentSession }) => boolean;
}

export type LangGraphInterruptAction = LangGraphInterruptRender & {
  event?: LangGraphInterruptEvent;
};

export type LangGraphInterruptActionSetterArgs =
  | (Partial<LangGraphInterruptRender> & { event?: Partial<LangGraphInterruptEvent> })
  | null;
export type LangGraphInterruptActionSetter = (action: LangGraphInterruptActionSetterArgs) => void;
