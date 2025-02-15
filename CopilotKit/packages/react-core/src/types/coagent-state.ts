export interface CoagentState {
  name: string;
  state: any;
  running: boolean;
  active: boolean;
  threadId?: string;
  configurable?: Record<string, any>;
  nodeName?: string;
  runId?: string;
}
