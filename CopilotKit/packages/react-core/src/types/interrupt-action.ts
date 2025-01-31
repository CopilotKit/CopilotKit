import { LangGraphInterruptEvent } from "@copilotkit/runtime-client-gql";
import { Condition } from "@copilotkit/shared";

export interface LangGraphInterruptRender {
  id: string;
  /**
   * The handler function to handle the event.
   */
  handler?: (props: {
    event: LangGraphInterruptEvent;
    resolve: (resolution: string) => void;
  }) => unknown | Promise<unknown>;
  /**
   * The render function to handle the event.
   */
  render?: (props: {
    result: unknown;
    event: LangGraphInterruptEvent;
    resolve: (resolution: string) => void;
  }) => string | React.ReactElement;
  /**
   * Conditions to render based on.
   * Useful when using multiple interrupts
   */
  conditions?: Condition[];
}

export type LangGraphInterruptAction = LangGraphInterruptRender & {
  event?: LangGraphInterruptEvent;
};

export type LangGraphInterruptActionSetterArgs =
  | (Partial<LangGraphInterruptRender> & { event?: Partial<LangGraphInterruptEvent> })
  | null;
export type LangGraphInterruptActionSetter = (action: LangGraphInterruptActionSetterArgs) => void;
