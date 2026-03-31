import { ActivityMessage } from "@ag-ui/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { StandardSchemaV1 } from "@copilotkit/shared";

export interface ReactActivityMessageRenderer<TActivityContent> {
  /**
   * Activity type to match when rendering. Use "*" as a wildcard renderer.
   */
  activityType: string;
  /**
   * Optional agent ID to scope the renderer to a particular agent.
   */
  agentId?: string;
  /**
   * Schema describing the activity content payload.
   */
  content: StandardSchemaV1<any, TActivityContent>;
  /**
   * React component invoked to render the activity message.
   */
  render: React.ComponentType<{
    activityType: string;
    content: TActivityContent;
    message: ActivityMessage;
    agent: AbstractAgent | undefined;
  }>;
}
