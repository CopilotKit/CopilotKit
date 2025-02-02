export type CoAgentStateRenderProps<T> = {
  state: T;
  nodeName: string;
  status: "inProgress" | "complete";
};

export type CoAgentStateRenderHandlerArguments<T> = {
  nodeName: string;
  state: T;
};

export interface CoAgentStateRender<T = any> {
  /**
   * The name of the coagent.
   */
  name: string;
  /**
   * The node name of the coagent.
   */
  nodeName?: string;
  /**
   * The handler function to handle the state of the agent.
   */
  handler?: (props: CoAgentStateRenderHandlerArguments<T>) => void | Promise<void>;
  /**
   * The render function to handle the state of the agent.
   */
  render?:
    | ((props: CoAgentStateRenderProps<T>) => string | React.ReactElement | undefined | null)
    | string;
}
