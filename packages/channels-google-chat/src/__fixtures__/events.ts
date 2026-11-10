/**
 * Webhook bodies in the shapes Google Chat sends. Names and ids are made up;
 * the structure follows the Chat API `Event` reference and the Workspace
 * add-on event reference.
 */
export const HUMAN = {
  name: "users/111",
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  type: "HUMAN",
};
export const APP = { name: "users/999", displayName: "Helper", type: "BOT" };
export const ROOM = {
  name: "spaces/ROOM1",
  type: "ROOM",
  spaceType: "SPACE",
  displayName: "Team",
};
export const DM = {
  name: "spaces/DM1",
  type: "DM",
  spaceType: "DIRECT_MESSAGE",
  singleUserBotDm: true,
};
const THREAD = { name: "spaces/ROOM1/threads/T1" };
const MENTION = {
  type: "USER_MENTION",
  startIndex: 0,
  length: 7,
  userMention: { user: APP, type: "MENTION" },
};

/** Legacy envelope: an @-mention in a space. */
export const legacyMention = {
  type: "MESSAGE",
  eventTime: "2026-11-10T10:00:00Z",
  space: ROOM,
  user: HUMAN,
  message: {
    name: "spaces/ROOM1/messages/M1",
    sender: HUMAN,
    createTime: "2026-11-10T10:00:00Z",
    text: "@Helper what is 2+2?",
    argumentText: " what is 2+2?",
    annotations: [MENTION],
    thread: THREAD,
    space: ROOM,
  },
};

/** Legacy envelope: a direct message. */
export const legacyDm = {
  type: "MESSAGE",
  eventTime: "2026-11-10T10:01:00Z",
  space: DM,
  user: HUMAN,
  message: {
    name: "spaces/DM1/messages/D1",
    sender: HUMAN,
    text: "hello there",
    argumentText: "hello there",
    thread: { name: "spaces/DM1/threads/DT1" },
    space: DM,
  },
};

/** Legacy envelope: a slash command. */
export const legacySlash = {
  type: "MESSAGE",
  space: ROOM,
  user: HUMAN,
  message: {
    name: "spaces/ROOM1/messages/M2",
    sender: HUMAN,
    text: "/summarize last week",
    argumentText: " last week",
    annotations: [
      {
        type: "SLASH_COMMAND",
        startIndex: 0,
        length: 10,
        slashCommand: {
          bot: APP,
          type: "INVOKE",
          commandName: "/summarize",
          commandId: "1",
        },
      },
    ],
    slashCommand: { commandId: "1" },
    thread: THREAD,
    space: ROOM,
  },
};

/** Legacy envelope: a card button click. `common.parameters` is a map. */
export function legacyClick(params: Record<string, string>, fn = "ck:legacy") {
  return {
    type: "CARD_CLICKED",
    space: ROOM,
    user: HUMAN,
    message: {
      name: "spaces/ROOM1/messages/BOTMSG",
      sender: APP,
      thread: THREAD,
      space: ROOM,
    },
    action: {
      actionMethodName: fn,
      parameters: Object.entries(params).map(([key, value]) => ({
        key,
        value,
      })),
    },
    common: { invokedFunction: fn, parameters: params },
  };
}

/** Legacy envelope: the app was added to a space. */
export const legacyAdded = {
  type: "ADDED_TO_SPACE",
  space: DM,
  user: HUMAN,
};

/** Add-on envelope: an @-mention in a space. */
export const addOnMention = {
  commonEventObject: { hostApp: "CHAT", platform: "WEB", userLocale: "en" },
  authorizationEventObject: { systemIdToken: "redacted" },
  chat: {
    user: HUMAN,
    eventTime: "2026-11-10T10:02:00Z",
    messagePayload: {
      space: ROOM,
      message: {
        name: "spaces/ROOM1/messages/M3",
        sender: HUMAN,
        createTime: "2026-11-10T10:02:00Z",
        text: "@Helper hi",
        argumentText: " hi",
        annotations: [MENTION],
        thread: THREAD,
        space: { name: ROOM.name },
      },
    },
  },
};

/** Add-on envelope: a button click (parameters arrive as a map). */
export function addOnClick(
  params: Record<string, string>,
  formInputs?: Record<string, { stringInputs: { value: string[] } }>,
) {
  return {
    commonEventObject: {
      hostApp: "CHAT",
      platform: "WEB",
      invokedFunction: "https://bot.example.com/google-chat",
      parameters: params,
      ...(formInputs ? { formInputs } : {}),
    },
    chat: {
      user: HUMAN,
      eventTime: "2026-11-10T10:03:00Z",
      buttonClickedPayload: {
        space: ROOM,
        message: {
          name: "spaces/ROOM1/messages/BOTMSG",
          sender: APP,
          thread: THREAD,
          space: { name: ROOM.name },
        },
        user: HUMAN,
      },
    },
  };
}

/** Add-on envelope: a slash command. */
export const addOnSlash = {
  commonEventObject: { hostApp: "CHAT" },
  chat: {
    user: HUMAN,
    appCommandPayload: {
      appCommandMetadata: { appCommandId: 1, appCommandType: "SLASH_COMMAND" },
      space: ROOM,
      thread: THREAD,
      message: {
        name: "spaces/ROOM1/messages/M4",
        sender: HUMAN,
        text: "/summarize today",
        argumentText: " today",
        annotations: legacySlash.message.annotations,
      },
    },
  },
};

/** Add-on envelope: the app was added to a space. */
export const addOnAdded = {
  commonEventObject: { hostApp: "CHAT" },
  chat: { user: HUMAN, addedToSpacePayload: { space: DM } },
};
