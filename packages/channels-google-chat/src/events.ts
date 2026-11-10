/**
 * Google Chat delivers HTTP events in two envelopes:
 *
 * - The Chat API "interaction event" (`{ type: "MESSAGE", space, message, … }`),
 *   used by Chat apps that are not built as Workspace add-ons.
 * - The Workspace add-on event (`{ commonEventObject, chat: { messagePayload } }`),
 *   used by Chat apps built as add-ons. This is the default for new HTTP apps.
 *
 * `normalizeEvent` turns either one into one shape, so the rest of the
 * adapter never branches on the envelope.
 */

export interface ChatUser {
  name?: string;
  displayName?: string;
  email?: string;
  type?: string;
}

export interface ChatSpace {
  name?: string;
  /** Legacy space type: "DM" | "ROOM". */
  type?: string;
  /** Current space type: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE". */
  spaceType?: string;
  singleUserBotDm?: boolean;
  displayName?: string;
}

export interface ChatAnnotation {
  type?: string;
  startIndex?: number;
  length?: number;
  userMention?: { user?: ChatUser; type?: string };
  slashCommand?: { commandName?: string; commandId?: string | number };
}

export interface ChatAttachment {
  name?: string;
  contentName?: string;
  contentType?: string;
  downloadUri?: string;
  attachmentDataRef?: { resourceName?: string };
  source?: string;
}

export interface ChatMessage {
  name?: string;
  text?: string;
  argumentText?: string;
  createTime?: string;
  lastUpdateTime?: string;
  sender?: ChatUser;
  thread?: { name?: string };
  space?: ChatSpace;
  annotations?: ChatAnnotation[];
  slashCommand?: { commandId?: string | number };
  attachment?: ChatAttachment[];
}

export type FormInputs = Record<
  string,
  { stringInputs?: { value?: string[] } }
>;

export type NormalizedKind =
  | "message"
  | "command"
  | "added"
  | "removed"
  | "click"
  | "unknown";

export interface NormalizedEvent {
  kind: NormalizedKind;
  /** True when the event arrived in the Workspace add-on envelope. */
  addOn: boolean;
  eventTime?: string;
  space?: ChatSpace;
  message?: ChatMessage;
  /** The user who caused the event. */
  user?: ChatUser;
  /** Card click: the function the button named. */
  invokedFunction?: string;
  /** Card click: the button's parameters. */
  parameters: Record<string, string>;
  /** Card click: current values of the card's inputs. */
  formInputs?: FormInputs;
  /**
   * Slash or quick command: the command name without the slash. When the
   * event names no command (a quick command carries only its ID), this is
   * the command ID from the Chat app configuration, for example "1".
   */
  command?: string;
  /** Command: the thread it was run in, when the event has no message. */
  thread?: string;
}

/** True for a one-to-one or group direct message, in either envelope. */
export function isDirectMessage(space: ChatSpace | undefined): boolean {
  return space?.type === "DM" || space?.spaceType === "DIRECT_MESSAGE";
}

/** Convert either parameter shape (array of pairs or map) to a map. */
function paramMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const p of raw as Array<{ key?: unknown; value?: unknown }>) {
      if (typeof p?.key === "string" && typeof p.value === "string")
        out[p.key] = p.value;
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/**
 * The slash command a message invokes, without the slash. Chat names it in a
 * SLASH_COMMAND annotation; if that is missing, a leading "/word" in the text
 * names it.
 */
function commandOf(message: ChatMessage | undefined): string | undefined {
  if (!message) return undefined;
  const ann = message.annotations?.find((a) => a.type === "SLASH_COMMAND");
  const name = ann?.slashCommand?.commandName;
  if (name) return name.replace(/^\//, "");
  if (!message.slashCommand && !ann) return undefined;
  const m = /^\s*\/([^\s]+)/.exec(message.text ?? "");
  return m?.[1];
}

interface LegacyEvent {
  type?: string;
  appCommandMetadata?: { appCommandId?: number; appCommandType?: string };
  thread?: { name?: string };
  eventTime?: string;
  space?: ChatSpace;
  message?: ChatMessage;
  user?: ChatUser;
  action?: { actionMethodName?: string; parameters?: unknown };
  common?: {
    invokedFunction?: string;
    parameters?: unknown;
    formInputs?: FormInputs;
  };
}

interface AddOnEvent {
  commonEventObject?: {
    hostApp?: string;
    invokedFunction?: string;
    parameters?: unknown;
    formInputs?: FormInputs;
  };
  chat?: {
    user?: ChatUser;
    eventTime?: string;
    messagePayload?: { space?: ChatSpace; message?: ChatMessage };
    addedToSpacePayload?: { space?: ChatSpace };
    removedFromSpacePayload?: { space?: ChatSpace };
    buttonClickedPayload?: {
      space?: ChatSpace;
      message?: ChatMessage;
      user?: ChatUser;
    };
    appCommandPayload?: {
      space?: ChatSpace;
      message?: ChatMessage;
      thread?: { name?: string };
      appCommandMetadata?: { appCommandId?: number; appCommandType?: string };
    };
  };
}

/** Normalize a parsed webhook body. Unrecognized bodies return kind "unknown". */
export function normalizeEvent(body: unknown): NormalizedEvent {
  const raw = (body ?? {}) as LegacyEvent & AddOnEvent;

  if (raw.chat) {
    const c = raw.chat;
    const common = raw.commonEventObject ?? {};
    const base = {
      addOn: true,
      eventTime: c.eventTime,
      user: c.user,
      parameters: paramMap(common.parameters),
      formInputs: common.formInputs,
    };
    if (c.buttonClickedPayload || common.invokedFunction) {
      const p = c.buttonClickedPayload;
      return {
        ...base,
        kind: "click",
        space: p?.space,
        message: p?.message,
        user: p?.user ?? c.user,
        invokedFunction: common.invokedFunction,
      };
    }
    if (c.appCommandPayload) {
      const p = c.appCommandPayload;
      const message = p.message
        ? { ...p.message, thread: p.message.thread ?? p.thread }
        : undefined;
      return {
        ...base,
        kind: "command",
        space: p.space ?? message?.space,
        message,
        ...(p.thread?.name ? { thread: p.thread.name } : {}),
        command:
          commandOf(message) ??
          (p.appCommandMetadata?.appCommandId !== undefined
            ? String(p.appCommandMetadata.appCommandId)
            : undefined),
      };
    }
    if (c.messagePayload) {
      const { space, message } = c.messagePayload;
      const command = commandOf(message);
      return {
        ...base,
        kind: command ? "command" : "message",
        space: space ?? message?.space,
        message,
        command,
      };
    }
    if (c.addedToSpacePayload)
      return { ...base, kind: "added", space: c.addedToSpacePayload.space };
    if (c.removedFromSpacePayload)
      return {
        ...base,
        kind: "removed",
        space: c.removedFromSpacePayload.space,
      };
    return { ...base, kind: "unknown" };
  }

  const base = {
    addOn: false,
    eventTime: raw.eventTime,
    space: raw.space ?? raw.message?.space,
    message: raw.message,
    user: raw.user,
    parameters: {
      ...paramMap(raw.action?.parameters),
      ...paramMap(raw.common?.parameters),
    },
    formInputs: raw.common?.formInputs,
  };
  switch (raw.type) {
    case "MESSAGE": {
      const command = commandOf(raw.message);
      return { ...base, kind: command ? "command" : "message", command };
    }
    case "APP_COMMAND": {
      const id = raw.appCommandMetadata?.appCommandId;
      return {
        ...base,
        kind: "command",
        command:
          commandOf(raw.message) ?? (id !== undefined ? String(id) : undefined),
        ...(raw.thread?.name ? { thread: raw.thread.name } : {}),
      };
    }
    case "ADDED_TO_SPACE":
      return { ...base, kind: "added" };
    case "REMOVED_FROM_SPACE":
      return { ...base, kind: "removed" };
    case "CARD_CLICKED":
      return {
        ...base,
        kind: "click",
        invokedFunction:
          raw.common?.invokedFunction ?? raw.action?.actionMethodName,
      };
    default:
      return { ...base, kind: "unknown" };
  }
}
