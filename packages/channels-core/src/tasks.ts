import { chat } from "@tanstack/ai";
import type { AnyTextAdapter, JSONSchema } from "@tanstack/ai";
import type { ApplicationUser, ProviderActor } from "@copilotkit/channels-ui";
import type { ReplyTarget } from "./platform-adapter.js";
import type { ChannelTool } from "./tools.js";

/** Minimal provider actor snapshot kept for Task audit context. */
export interface ChannelTaskActor {
  id: string;
  kind: "human" | "bot" | "app";
  displayName?: string;
  handle?: string;
}

/** Audit context that grants no Task authority. */
export type ChannelTaskCreator =
  | { kind: "provider_actor"; actor: ChannelTaskActor }
  | { kind: "application"; applicationId: string };

/** Event or schedule condition for one Channel Task. */
export type ChannelTaskWhen =
  | {
      kind: "event";
      event: "message" | "reaction_added";
      rule: string;
    }
  | {
      kind: "schedule";
      cron: string;
      timeZone: string;
    };

/** Public Intelligence Channel Task. */
export interface ChannelTask {
  id: string;
  surfaceId: string;
  goal: string;
  when: ChannelTaskWhen;
  enabled: boolean;
  createdBy: ChannelTaskCreator;
  createdAt: string;
  updatedAt: string;
}

/** Enabled scheduled Task carried by one live scheduled delivery. */
export type ChannelScheduledTask = ChannelTask & {
  when: Extract<ChannelTaskWhen, { kind: "schedule" }>;
  enabled: true;
};

/** Normalized new-message input sent to the Task matcher. */
export interface ChannelMessageEvent {
  kind: "message";
  text: string;
  mentioned: boolean;
  messageId: string;
  occurredAt: string;
}

/** Normalized reaction-added input sent to the Task matcher. */
export interface ChannelReactionAddedEvent {
  kind: "reaction_added";
  emoji: string;
  rawEmoji: string;
  messageId: string;
  occurredAt: string;
}

/** V1 event input eligible for Task matching. */
export type ChannelTaskEvent = ChannelMessageEvent | ChannelReactionAddedEvent;

/** Why one Task handler invocation ran. */
export type ChannelTaskCause =
  | {
      kind: "event";
      event: ChannelTaskEvent;
      actor: ProviderActor;
    }
  | {
      kind: "schedule";
      scheduledAt: string;
      actor: null;
    };

/** One TanStack AI text model used for event matching. */
export interface ChannelTasksConfig {
  model: AnyTextAdapter;
}

export interface CreateChannelTaskInput {
  surfaceId: string;
  goal: string;
  when: ChannelTaskWhen;
}

export interface ListChannelTasksInput {
  surfaceId: string;
  event?: "message" | "reaction_added";
  enabled?: boolean;
}

export interface UpdateChannelTaskInput {
  taskId: string;
  goal?: string;
  when?: ChannelTaskWhen;
  enabled?: boolean;
}

export interface DeleteChannelTaskInput {
  taskId: string;
}

/** Trusted ingress context attached by Channels core to an adapter Task call. */
export interface ChannelTaskOperationContext {
  replyTarget?: ReplyTarget;
  actor?: ProviderActor | null;
  user?: ApplicationUser | null;
}

/** Adapter-owned Task persistence client. Managed Intelligence implements it. */
export interface ChannelTaskAdapter {
  create(
    input: CreateChannelTaskInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelTask>;
  list(
    input: ListChannelTasksInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelTask[]>;
  update(
    input: UpdateChannelTaskInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelTask>;
  delete(
    input: DeleteChannelTaskInput,
    context?: ChannelTaskOperationContext,
  ): Promise<void>;
}

/** Programmatic Task operations exposed by one Channel. */
export interface ChannelTasksClient {
  /** Agent tools applications may opt into for trusted surface-scoped CRUD. */
  readonly tools: readonly ChannelTool[];
  create(input: CreateChannelTaskInput): Promise<ChannelTask>;
  list(input: ListChannelTasksInput): Promise<ChannelTask[]>;
  update(input: UpdateChannelTaskInput): Promise<ChannelTask>;
  delete(input: DeleteChannelTaskInput): Promise<void>;
}

const TASK_SELECTION_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    taskId: { type: ["string", "null"] },
  },
  required: ["taskId"],
  additionalProperties: false,
};

/**
 * Select at most one stored Task in one structured-output model call.
 * Malformed or unknown output is treated as no selection.
 */
export async function selectChannelTask(input: {
  model: AnyTextAdapter;
  event: ChannelTaskEvent;
  candidates: readonly ChannelTask[];
}): Promise<ChannelTask | undefined> {
  if (input.candidates.length === 0) return undefined;
  const result: unknown = await chat({
    adapter: input.model,
    stream: false,
    outputSchema: TASK_SELECTION_SCHEMA,
    systemPrompts: [
      "Select at most one candidate Task for this normalized Channel event. " +
        "Return its exact stored taskId, or null when none match. Do not invent IDs.",
    ],
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          event: input.event,
          candidates: input.candidates.map((candidate) => ({
            id: candidate.id,
            goal: candidate.goal,
            rule:
              candidate.when.kind === "event" ? candidate.when.rule : undefined,
          })),
        }),
      },
    ],
  });
  if (!isTaskSelection(result)) return undefined;
  if (result.taskId === null) return undefined;
  return input.candidates.find((candidate) => candidate.id === result.taskId);
}

/** Return true only for the exact structured output accepted by the matcher. */
function isTaskSelection(
  value: unknown,
): value is { readonly taskId: string | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "taskId") return false;
  const taskId = (value as { taskId?: unknown }).taskId;
  return taskId === null || typeof taskId === "string";
}
