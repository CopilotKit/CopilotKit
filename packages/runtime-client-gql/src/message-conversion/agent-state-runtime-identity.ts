import type * as gql from "../client";
import type * as agui from "@copilotkit/shared";

type AgentStateRuntimeIdentityCarrier =
  | gql.AgentStateMessage
  | (agui.Message & Partial<AgentStateRuntimeIdentity>);

type AgentStateRuntimeIdentityKey =
  | "threadId"
  | "runId"
  | "nodeName"
  | "active";

export type AgentStateRuntimeIdentity = Pick<
  gql.AgentStateMessage,
  AgentStateRuntimeIdentityKey
>;

export function getAgentStateRuntimeIdentity(
  message: AgentStateRuntimeIdentityCarrier,
): Partial<AgentStateRuntimeIdentity> {
  const identity: Partial<AgentStateRuntimeIdentity> = {};

  if (message.threadId !== undefined) {
    identity.threadId = message.threadId;
  }
  if (message.runId !== undefined) {
    identity.runId = message.runId;
  }
  if (message.nodeName !== undefined) {
    identity.nodeName = message.nodeName;
  }
  if (message.active !== undefined) {
    identity.active = message.active;
  }

  return identity;
}
