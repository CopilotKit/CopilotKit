import { LangGraphInterruptEvent } from "@copilotkit/runtime-client-gql";
import { AgentSession } from "../context/copilot-context";

export interface LangGraphInterruptRenderHandlerProps<TEventValue = any> {
  event: LangGraphInterruptEvent<TEventValue>;
  resolve: (resolution: string) => void;
}

export interface LangGraphInterruptRenderProps<TEventValue = any> {
  result: unknown;
  event: LangGraphInterruptEvent<TEventValue>;
  resolve: (resolution: string) => void;
}

export interface LangGraphInterruptRender<TEventValue = any> {
  id: string;
  /**
   * The handler function to handle the event.
   */
  handler?: (props: LangGraphInterruptRenderHandlerProps<TEventValue>) => any | Promise<any>;
  /**
   * The render function to handle the event.
   */
  render?: (props: LangGraphInterruptRenderProps<TEventValue>) => string | React.ReactElement;
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
