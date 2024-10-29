export type CoAgentStateRenderProps<T> = {
  state: T;
  nodeName: string;
  status: "inProgress" | "complete";
};

export type CoAgentStateRenderHandlerArguments<T> = {
  nodeName: string;
  state: T;
};

export type CoAgentStateRender<T = any> = {
  name: string;
  nodeName?: string;
  handler?: (props: CoAgentStateRenderHandlerArguments<T>) => void | Promise<void>;
  render?:
    | ((props: CoAgentStateRenderProps<T>) => string | React.ReactElement | undefined | null)
    | string;
};
