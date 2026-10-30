import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Controlled complete turns: SDK-persisted, no AG-UI or Intelligence connection. */
export function completedTurns(namespace) {
  const state = {
    todos: [
      {
        id: `${namespace}-todo`,
        title: "Review parity",
        description: "Keep this original description",
        status: "todo",
      },
    ],
  };
  const calls = [
    {
      id: `${namespace}-pie`,
      name: "pieChart",
      args: {
        title: "Native pie",
        description: "Original pie values",
        data: [
          { label: "A", value: 2 },
          { label: "B", value: 3 },
        ],
      },
      result: { rendered: true },
    },
    {
      id: `${namespace}-bar`,
      name: "barChart",
      args: {
        title: "Native bar",
        description: "Original bar values",
        data: [
          { label: "A", value: 4 },
          { label: "B", value: 8 },
        ],
      },
      result: { rendered: true },
    },
    {
      id: `${namespace}-ordinary`,
      name: "get_weather",
      args: { city: "Amsterdam" },
      result: { temperature: 18, unit: "C" },
    },
  ];
  return {
    user: "Remember the native charts and Review parity todo.",
    assistant: "The native charts and todo are saved.",
    state,
    calls,
  };
}

/** Write through the actual Mastra storage SDK, retaining complete native records. */
export async function seedMastra({
  LibSQLStore,
  directory,
  namespace,
  turns = completedTurns(namespace),
}) {
  await mkdir(directory, { recursive: true });
  const identity = {
    threadId: `${namespace}-rich`,
    agentId: `${namespace}-agent`,
    resourceId: `${namespace}-resource`,
    userId: `${namespace}-user`,
  };
  const url = pathToFileURL(join(directory, "native.db")).href;
  const store = new LibSQLStore({ id: namespace, url });
  await store.init();
  const memory = await store.getStore("memory");
  assert.ok(memory, "Mastra native memory domain missing");
  const now = new Date("2026-10-08T10:00:00Z");
  await memory.saveThread({
    thread: {
      id: identity.threadId,
      resourceId: identity.resourceId,
      title: "Controlled native-only rich turns",
      createdAt: now,
      updatedAt: now,
      metadata: { workingMemory: JSON.stringify(turns.state) },
    },
  });
  const messages = [
    {
      role: "user",
      content: { format: 2, parts: [{ type: "text", text: turns.user }] },
    },
    ...turns.calls.map((call) => ({
      role: "assistant",
      content: {
        format: 2,
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              state: "result",
              toolCallId: call.id,
              toolName: call.name,
              args: call.args,
              result: call.result,
            },
          },
        ],
      },
    })),
    {
      role: "assistant",
      content: { format: 2, parts: [{ type: "text", text: turns.assistant }] },
    },
  ].map((message, index) => ({
    ...message,
    id: `${namespace}-message-${index}`,
    threadId: identity.threadId,
    resourceId: identity.resourceId,
    createdAt: new Date(now.getTime() + index),
  }));
  await memory.saveMessages({ messages });
  const saved = await memory.listMessages({
    threadId: identity.threadId,
    perPage: 100,
    page: 0,
  });
  const thread = await memory.getThreadById({ threadId: identity.threadId });
  assert.equal(
    saved.messages.length,
    messages.length,
    "SDK did not persist complete turns",
  );
  await writeFile(
    join(directory, "native-envelope.json"),
    JSON.stringify(
      { thread, messages: saved.messages, suspendedRuns: [] },
      null,
      2,
    ),
  );
  await store.close();
  return {
    identity,
    turns,
    env: {
      MASTRA_IMPORT_SOURCE_ID: namespace,
      MASTRA_IMPORT_AGENT_ID: identity.agentId,
      MASTRA_IMPORT_RESOURCE_ID: identity.resourceId,
      MASTRA_IMPORT_BACKEND: "database",
      MASTRA_IMPORT_MEMORY_URL: url,
      MASTRA_IMPORT_WORKFLOW_URL: url,
      MASTRA_IMPORT_THREAD_IDS: identity.threadId,
      MASTRA_IMPORT_WORKING_MEMORY_SCOPE: "thread",
      MASTRA_IMPORT_END_USER_ID: identity.userId,
    },
    provenance:
      "Controlled complete tool turns saved and read using Mastra LibSQL SDK; no model/AG-UI run; completed history only",
  };
}

/** Save and restore with the Strands SDK's full session preset, including metadata. */
export async function seedStrands({
  Agent,
  SessionManager,
  LocalFileStorage,
  directory,
  namespace,
  turns = completedTurns(namespace),
}) {
  await mkdir(directory, { recursive: true });
  const identity = {
    threadId: `${namespace}-rich`,
    agentId: `${namespace}-agent`,
    userId: `${namespace}-user`,
  };
  const messages = [
    { role: "user", content: [{ text: turns.user }] },
    ...turns.calls.flatMap((call) => [
      {
        role: "assistant",
        content: [
          {
            toolUse: { toolUseId: call.id, name: call.name, input: call.args },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: call.id,
              status: "success",
              content: [{ json: call.result }],
            },
          },
        ],
      },
    ]),
    { role: "assistant", content: [{ text: turns.assistant }] },
  ];
  const storage = new LocalFileStorage(directory);
  const session = new SessionManager({ sessionId: identity.threadId, storage });
  const agent = new Agent({
    id: identity.agentId,
    messages,
    appState: turns.state,
    printer: false,
    sessionManager: session,
  });
  await session.saveSnapshot({ target: agent, isLatest: true });
  const snapshotPath = join(
    directory,
    "session",
    identity.threadId,
    "scopes",
    "agent",
    identity.agentId,
    "snapshots",
    "snapshot_latest.json",
  );
  const checkpoint = JSON.parse(await readFile(snapshotPath, "utf8"));
  const restored = new Agent({ id: identity.agentId, printer: false });
  restored.loadSnapshot(checkpoint);
  assert.deepEqual(
    restored.takeSnapshot({ preset: "session" }).data,
    checkpoint.data,
    "Native checkpoint failed SDK roundtrip",
  );
  await writeFile(
    join(directory, "native-envelope.json"),
    JSON.stringify(checkpoint, null, 2),
  );
  return {
    identity,
    turns,
    env: {
      STRANDS_TS_IMPORT_SOURCE_ID: namespace,
      STRANDS_TS_IMPORT_ROOT: directory,
      STRANDS_TS_IMPORT_LAYOUT: "unified",
      STRANDS_TS_IMPORT_SESSION_IDS: identity.threadId,
      STRANDS_TS_IMPORT_AGENT_IDS: identity.agentId,
      STRANDS_TS_IMPORT_END_USER_ID: identity.userId,
    },
    provenance:
      "Controlled complete native messages saved by SessionManager and restored by Agent; no model/AG-UI run; completed history only",
  };
}
