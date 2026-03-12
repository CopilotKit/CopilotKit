import { Artifact, Part } from '@a2a-js/sdk';

/**
 * Represents a single message in the UI, either from the user or the agent.
 */
export interface UiMessage {
  readonly type: 'ui_message';
  /** Unique identifier for the message. */
  readonly id: string;
  /** Identifier for the conversation context. */
  readonly contextId: string;
  /** The role of the message sender (agent or user). */
  readonly role: Role;
  /** Array of content parts that make up this message. */
  readonly contents: UiMessageContent[];
  /** The current status of the message. */
  readonly status: UiMessageStatus;
  /** ISO timestamp of when the message was created. */
  readonly created: string;
  /** ISO timestamp of when the message was last updated. */
  readonly lastUpdated: string;
}

/**
 * Represents the sender of a message, either an agent or a user.
 */
export type Role = UiAgent | UiUser;

/**
 * Represents an agent sender.
 */
export interface UiAgent {
  readonly type: 'ui_agent';
  /** The name of the agent. */
  readonly name: string;
  /** The URL of the agent's icon. */
  readonly iconUrl: string;
  /** The display name of the sub-agent. */
  readonly subagentName?: string;
  /** The URL of the sub-agent's icon. */
  readonly subagentIconUrl?: string;
}

/**
 * Represents a user sender.
 */
export interface UiUser {
  readonly type: 'ui_user';
}

/**
 * Represents a single piece of content within a UiMessage.
 */
export interface UiMessageContent {
  readonly type: 'ui_message_content';
  /** Unique identifier for this content part. */
  readonly id: string;
  /** The raw A2A Part or Artifact data. */
  readonly data: Part | Artifact;
  /** The variant key used to determine how to render this content. */
  readonly variant: string;
}

/**
 * Possible statuses for a UiMessage.
 */
export type UiMessageStatus = 'completed' | 'pending' | 'cancelled';
