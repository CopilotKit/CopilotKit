export interface CoagentState {
  name: string;
  state: any;
  running: boolean;
  active: boolean;
  threadId?: string;
  nodeName?: string;
  runId?: string;
}
