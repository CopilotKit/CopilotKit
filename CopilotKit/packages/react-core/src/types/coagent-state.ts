export interface CoagentState {
  name: string;
  state: any;
  running: boolean;
  active: boolean;
  threadId?: string;
  config?: {
    configurable?: Record<string, any>;
    [key: string]: any;
  };
  nodeName?: string;
  runId?: string;
}
