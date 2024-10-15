export type CoagentActionRenderProps<T> = {
  state: T;
  nodeName: string;
  status: "inProgress" | "complete";
};

export type CoagentActionHandlerArguments<T> = {
  nodeName: string;
  state: T;
};

export type CoagentAction<T = any> = {
  name: string;
  nodeName?: string;
  handler?: (props: CoagentActionHandlerArguments<T>) => void | Promise<void>;
  render?:
    | ((props: CoagentActionRenderProps<T>) => string | React.ReactElement | undefined | null)
    | string;
};
