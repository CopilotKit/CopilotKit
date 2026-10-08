/** Local candidate control. Dependency paths are explicit; no global services or credentials. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  frontendToolObservations,
  strandsEnvelopes,
  nativeInterruptObservations,
} from "./tool-controls.mjs";
import { atPointer } from "./assertions.mjs";
import { readNativeJson, readNativeSqlite } from "./native-store.mjs";

const mediaTypes = [
  ["image", "image/png", "png"],
  ["document", "application/pdf", "pdf"],
  ["audio", "audio/wav", "wav"],
  ["video", "video/mp4", "mp4"],
];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const escape = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");
function leaves(value, pointer = "") {
  if (!value || typeof value !== "object") return [{ pointer, value }];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, `${pointer}/${escape(key)}`),
  );
}
async function filesUnder(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.name.endsWith(".json")) files.push(path);
  }
  return files;
}

export async function createFixture({ framework, outputDir }) {
  if (!["mastra", "strands-typescript"].includes(framework))
    throw new Error(
      "Local row2 control supports Mastra and Strands TS; supply other native fixture adapters explicitly",
    );
  const config = JSON.parse(
    await readFile(process.env.PNI597_DEPS_CONFIG, "utf8"),
  );
  const root = config[framework];
  const dependencyRequire = createRequire(join(root, "package.json"));
  const adapterName =
    framework === "mastra" ? "@ag-ui/mastra" : "@ag-ui/aws-strands";
  const adapterResolve = createRequire(dependencyRequire.resolve(adapterName));
  // Resolve SDK classes from the adapter's own graph: duplicate installations split lifecycle hook identities.
  const loader = async (name) =>
    import(
      pathToFileURL(
        (name.startsWith("@strands-agents/")
          ? adapterResolve
          : dependencyRequire
        ).resolve(name),
      )
    );
  const { LLMock } = await import(pathToFileURL(config.aimockEntry));
  const mock = new LLMock({
    host: "127.0.0.1",
    port: config.port ?? 0,
    strict: true,
  });
  mock.onMessage("row2 text control", {
    content: "row2 durable assistant reply",
  });
  mock.onMessage("row2 media control", { content: "row2 media acknowledged" });
  mock.onToolResult("row2-frontend-completed", {
    content: "row2 approval saved",
  });
  for (const state of ["pending", "completed"])
    mock.onMessage(`row2 frontend-${state} control`, {
      toolCalls: [
        {
          id: `row2-frontend-${state}`,
          name: "approve_record",
          arguments: { title: "Synthetic row2 approval", amount: 37 },
        },
      ],
    });
  mock.onToolResult("row2-native-completed", {
    content: "row2 native approval saved",
  });
  for (const state of ["pending", "completed"])
    mock.onMessage(`row2 native-${state} control`, {
      toolCalls: [
        {
          id: `row2-native-${state}`,
          name: "native_approve",
          arguments: { title: "Native synthetic approval", amount: 43 },
        },
      ],
    });
  const store = join(outputDir, "owned-native");
  await mkdir(store); // Deliberately refuse reuse: these must be genuinely fresh histories.
  const fixture = { row2: { coverage: {} } };
  const packages = {};
  for (const name of [
    adapterName,
    ...(framework === "mastra"
      ? ["@mastra/core", "@mastra/memory", "@mastra/libsql"]
      : ["@strands-agents/sdk"]),
  ]) {
    const resolver = name.startsWith("@strands-agents/")
      ? adapterResolve
      : dependencyRequire;
    const entry = resolver.resolve(name);
    let directory = dirname(entry);
    let version;
    while (directory !== dirname(directory)) {
      const manifest = join(directory, "package.json");
      if (existsSync(manifest)) {
        const metadata = JSON.parse(await readFile(manifest, "utf8"));
        if (metadata.name === name) {
          version = metadata.version;
          break;
        }
      }
      directory = dirname(directory);
    }
    if (!version) throw new Error(`Package identity not found for ${name}`);
    packages[name] = { version, entry, sha256: sha(await readFile(entry)) };
  }
  await writeFile(
    join(outputDir, "dependency-entries.json"),
    JSON.stringify(packages, null, 2),
  );

  async function makeAdapter(threadId, scenario) {
    if (framework === "mastra") {
      const { Agent } = await loader("@mastra/core/agent");
      const { Memory } = await loader("@mastra/memory");
      const { LibSQLStore } = await loader("@mastra/libsql");
      const { createOpenAI } = await loader("@ai-sdk/openai");
      const { MastraAgent } = await loader(adapterName);
      const { Mastra } = await loader("@mastra/core/mastra");
      const { createTool } = await loader("@mastra/core/tools");
      const { z } = await loader("zod");
      const nativeTools = scenario.startsWith("native-")
        ? {
            native_approve: createTool({
              id: "native_approve",
              description: "Synthetic approval",
              inputSchema: z.object({ title: z.string(), amount: z.number() }),
              requireApproval: true,
              execute: async () => "Approved native record 43",
            }),
          }
        : {};
      const path = join(store, `${threadId}.db`);
      const storage = new LibSQLStore({ id: threadId, url: `file:${path}` });
      const agent = new Agent({
        id: "row2",
        name: "row2",
        instructions: "Follow the user's request",
        tools: nativeTools,
        model: createOpenAI({
          baseURL: `${mock.url}/v1`,
          apiKey: "local-placeholder",
        }).chat("gpt-4o"),
        memory: new Memory({
          storage,
          options: { lastMessages: 100, generateTitle: false },
        }),
      });
      const mastra = new Mastra({ agents: { row2: agent }, storage });
      const adapter = new MastraAgent({
        agent: mastra.getAgent("row2"),
        resourceId: threadId,
      });
      return {
        async run(input, events) {
          await new Promise((resolve, reject) =>
            adapter.run(input).subscribe({
              next: (event) => events.push(event),
              error: reject,
              complete: resolve,
            }),
          );
        },
        read: () =>
          readNativeSqlite({
            path,
            queries: [
              {
                key: "messages",
                sql: "SELECT * FROM mastra_messages WHERE thread_id = ? ORDER BY createdAt, rowid",
                params: [threadId],
                jsonColumns: ["content"],
              },
              {
                key: "threads",
                sql: "SELECT * FROM mastra_threads WHERE id = ?",
                params: [threadId],
                jsonColumns: ["metadata"],
              },
              {
                key: "checkpoints",
                sql: "SELECT workflow_name, run_id, resourceId, json(snapshot) AS snapshot, createdAt, updatedAt FROM mastra_workflow_snapshot ORDER BY rowid",
                jsonColumns: ["snapshot"],
              },
              {
                key: "resources",
                sql: "SELECT * FROM mastra_resources WHERE id = ?",
                params: [threadId],
                jsonColumns: ["metadata"],
              },
            ],
          }),
        envelopes: (snapshot) =>
          snapshot.records.messages.map((value, index) => ({
            value,
            record: "messages",
            pointer: `/${index}`,
          })),
      };
    }
    const { Agent, SessionManager, FileStorage, tool } = await loader(
      "@strands-agents/sdk",
    );
    const { OpenAIModel } = await loader("@strands-agents/sdk/models/openai");
    const { StrandsAgent } = await loader(adapterName);
    const { z } = await loader("zod");
    const nativeTools = scenario.startsWith("native-")
      ? [
          tool({
            name: "native_approve",
            description: "Synthetic approval",
            inputSchema: z.object({ title: z.string(), amount: z.number() }),
            callback: (input, context) => {
              if (!context)
                throw new Error("Native interrupt context required");
              context.interrupt({ name: "native_approve", reason: input });
              return "Approved native record 43";
            },
          }),
        ]
      : [];
    const adapter = new StrandsAgent({
      agent: new Agent({
        id: "row2",
        tools: nativeTools,
        model: new OpenAIModel({
          api: "chat",
          modelId: "gpt-4o",
          apiKey: "local-placeholder",
          clientConfig: { baseURL: `${mock.url}/v1` },
        }),
      }),
      name: "row2",
      config: {
        sessionManagerProvider: (input) =>
          new SessionManager({
            sessionId: input.threadId,
            storage: { snapshot: new FileStorage(store) },
          }),
      },
    });
    return {
      async run(input, events) {
        for await (const event of adapter.run(input)) events.push(event);
      },
      async read() {
        return readNativeJson({
          root: store,
          files: (await filesUnder(join(store, threadId))).filter((file) =>
            file.endsWith("snapshot_latest.json"),
          ),
        });
      },
      envelopes: strandsEnvelopes,
    };
  }

  async function captureFresh() {
    const captures = [];
    for (const scenario of [
      "text",
      "media",
      "frontend-pending",
      "frontend-completed",
      "native-pending",
      "native-completed",
    ]) {
      const threadId = `pni597-${framework}-${scenario}-${randomUUID()}`;
      const prompt = `row2 ${scenario} control`;
      const content = [{ type: "text", text: prompt }];
      if (scenario === "media")
        for (const [type, mimeType, extension] of mediaTypes) {
          const bytes = await readFile(
            join(config.mediaDirectory, `cedar-${type}.${extension}`),
          );
          content.push({
            type,
            source: { type: "data", value: bytes.toString("base64"), mimeType },
            metadata: { filename: `row2-original-${type}.${extension}` },
          });
        }
      const input = {
        threadId,
        runId: randomUUID(),
        messages: [
          {
            id: randomUUID(),
            role: "user",
            content: scenario === "media" ? content : prompt,
          },
        ],
        state: {},
        context: [],
        forwardedProps: {},
        tools: scenario.startsWith("frontend-")
          ? [
              {
                name: "approve_record",
                description: "Ask user approval",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    amount: { type: "number" },
                  },
                  required: ["title", "amount"],
                },
              },
            ]
          : [],
      };
      const adapter = await makeAdapter(threadId, scenario);
      // New per-scenario store/UUID, and no source import/seeding. The directory was created exclusively above.
      const before = { records: {} };
      const events = [];
      let error;
      try {
        await adapter.run(input, events);
        if (scenario === "native-completed") {
          const interrupt = events.find(
            (event) =>
              event.type === "RUN_FINISHED" &&
              event.outcome?.type === "interrupt",
          )?.outcome.interrupts[0];
          if (!interrupt) throw new Error("Native interrupt was not emitted");
          const resumed = {
            ...input,
            runId: randomUUID(),
            resume: [
              {
                interruptId: interrupt.id,
                status: "resolved",
                payload: { approved: true },
              },
            ],
          };
          await writeFile(
            join(outputDir, `${scenario}-resume.json`),
            JSON.stringify(resumed, null, 2),
          );
          await adapter.run(resumed, events);
        }
        if (scenario === "frontend-completed") {
          const callEvent = events.find(
            (event) => event.toolCallId === "row2-frontend-completed",
          );
          if (!callEvent) throw new Error("Frontend call was not emitted");
          const resumed = {
            ...input,
            runId: randomUUID(),
            messages: [
              ...input.messages,
              {
                id: callEvent.parentMessageId ?? randomUUID(),
                role: "assistant",
                toolCalls: [
                  {
                    id: "row2-frontend-completed",
                    type: "function",
                    function: {
                      name: "approve_record",
                      arguments: JSON.stringify({
                        title: "Synthetic row2 approval",
                        amount: 37,
                      }),
                    },
                  },
                ],
              },
              {
                id: randomUUID(),
                role: "tool",
                toolCallId: "row2-frontend-completed",
                content: "Approved synthetic record 37",
              },
            ],
          };
          await writeFile(
            join(outputDir, `${scenario}-resume.json`),
            JSON.stringify(resumed, null, 2),
          );
          await adapter.run(resumed, events);
        }
      } catch (failure) {
        // Media can be durably saved before provider serialization fails. Preserve the error
        // and still inspect native storage; successful text/control paths are required below.
        error = failure.message;
      }
      await writeFile(
        join(outputDir, `${scenario}-input.json`),
        JSON.stringify(input, null, 2),
      );
      await writeFile(
        join(outputDir, `${scenario}-events.json`),
        JSON.stringify(
          {
            events,
            error,
            ...(scenario === "frontend-completed"
              ? { submittedResult: "Approved synthetic record 37" }
              : {}),
          },
          null,
          2,
        ),
      );
      const after = await adapter.read();
      const envelopes = adapter.envelopes(after);
      const user = envelopes.find((entry) => entry.value.role === "user");
      if (!user)
        throw new Error("Fresh user record absent from durable native store");
      const observations = [];
      const add = (category, name, entry, pointer, expected, source) =>
        observations.push({
          category,
          name,
          record: entry.record,
          pointer: `${entry.pointer}${pointer}`,
          expected,
          source,
        });
      const textPointer =
        leaves(user.value).find((leaf) => leaf.value === prompt)?.pointer ??
        "/missing-text";
      add("user-text", `${scenario}-user-text`, user, textPointer, prompt, {
        artifact: `${scenario}-input.json`,
        pointer: "/messages/0/content",
      });
      if (scenario === "text") {
        const assistant = envelopes.find(
          (entry) => entry.value.role === "assistant",
        );
        const expected = events
          .filter((event) =>
            ["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"].includes(event.type),
          )
          .map((event) => event.delta ?? "")
          .join("");
        if (!expected || !assistant)
          throw new Error(
            "Text control requires an emitted and stored assistant reply",
          );
        const pointer =
          leaves(assistant.value).find((leaf) => leaf.value === expected)
            ?.pointer ?? "/missing-text";
        add("assistant-text", "assistant-text", assistant, pointer, expected, {
          artifact: "text-events.json",
          pointer: "/events",
        });
        observations.push({
          name: "text-message-order",
          category: "assistant-text",
          record: user.record,
          pointers: envelopes.map((entry) => `${entry.pointer}/role`),
          expected: ["user", "assistant"],
          source: { artifact: "text-events.json", pointer: "/events" },
        });
        fixture.row2.coverage["user-text"] = { required: ["text-user-text"] };
        fixture.row2.coverage["assistant-text"] = {
          required: ["assistant-text", "text-message-order"],
        };
      }
      if (scenario.startsWith("frontend-") || scenario.startsWith("native-")) {
        observations.push(
          ...frontendToolObservations({
            framework,
            envelopes,
            category: scenario,
            callId: `row2-${scenario}`,
            name: scenario.startsWith("native-")
              ? "native_approve"
              : "approve_record",
            args: scenario.startsWith("native-")
              ? { title: "Native synthetic approval", amount: 43 }
              : { title: "Synthetic row2 approval", amount: 37 },
            ...(scenario.endsWith("completed")
              ? {
                  result: scenario.startsWith("native-")
                    ? "Approved native record 43"
                    : "Approved synthetic record 37",
                }
              : {}),
            eventsFile: `${scenario}-events.json`,
          }),
        );
        if (scenario.startsWith("native-"))
          observations.push(
            ...nativeInterruptObservations({
              framework,
              snapshot: after,
              events,
              category: scenario,
            }),
          );
        if (scenario.endsWith("completed")) {
          const expected = events
            .filter((event) =>
              ["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"].includes(
                event.type,
              ),
            )
            .map((event) => event.delta ?? "")
            .join("");
          if (!expected)
            throw new Error(
              "Completed control must emit a final assistant reply",
            );
          const assistant = envelopes
            .filter((entry) => entry.value.role === "assistant")
            .find((entry) =>
              leaves(entry.value).some((leaf) => leaf.value === expected),
            );
          const entry = assistant ?? user;
          add(
            scenario,
            `${scenario}-final-reply`,
            entry,
            leaves(entry.value).find((leaf) => leaf.value === expected)
              ?.pointer ?? "/missing-reply",
            expected,
            { artifact: `${scenario}-events.json`, pointer: "/events" },
          );
        }
        fixture.row2.coverage[scenario] = {
          required: observations
            .filter((observation) => observation.category === scenario)
            .map((observation) => observation.name),
        };
      }
      if (scenario === "media")
        for (const [index, part] of content.slice(1).entries()) {
          const candidate = leaves(user.value).find(
            (leaf) =>
              typeof leaf.value === "string" &&
              (leaf.value === part.source.value ||
                leaf.value.endsWith(`;base64,${part.source.value}`)),
          );
          const nativePart =
            candidate?.pointer
              .split("/")
              .slice(0, framework === "mastra" ? 4 : 3)
              .join("/") ?? "/missing-part";
          let filenamePointer =
            framework === "mastra"
              ? `${nativePart}/filename`
              : `${nativePart}/${part.type}/name`;
          if (framework === "strands-typescript") {
            const nativeIndex = Number(nativePart?.split("/").at(-1));
            const attachments =
              user.value.metadata?.custom?.["ag-ui"]?.attachments ?? [];
            const sidecarIndex = attachments.findIndex(
              (attachment) =>
                attachment.index === nativeIndex &&
                attachment.type === part.type,
            );
            if (sidecarIndex >= 0)
              filenamePointer = `/metadata/custom/ag-ui/attachments/${sidecarIndex}/filename`;
          }
          const mimePointer = `${nativePart}/mimeType`;
          const mime = atPointer(user.value, mimePointer);
          const bytes = Buffer.from(part.source.value, "base64");
          const formatPointer = candidate?.pointer.replace(
            /\/source\/bytes$/,
            "/format",
          );
          const format = formatPointer && atPointer(user.value, formatPointer);
          observations.push({
            category: `${part.type}:data`,
            name: `${part.type}-data`,
            record: user.record,
            pointer: user.pointer,
            source: {
              artifact: "media-input.json",
              pointer: `/messages/0/content/${index + 1}`,
            },
            media: {
              bytes: {
                pointer: candidate?.pointer ?? "/missing-bytes",
                encoding: candidate?.value.startsWith("data:")
                  ? "data-uri"
                  : "base64",
              },
              ...(mime
                ? { mimePointer }
                : candidate?.value.startsWith("data:")
                  ? {}
                  : format
                    ? { mimePointer: formatPointer, mimeEncoding: "format" }
                    : { mimePointer: "/missing-mime" }),
              filenamePointer,
              expected: {
                sha256: sha(bytes),
                byteLength: bytes.length,
                mime: part.source.mimeType,
                filename: part.metadata.filename,
              },
            },
          });
          // URL and provider-file variants remain explicitly unvalidated, so a sampled inline path cannot certify the category.
          fixture.row2.coverage[`${part.type}:data`] = {
            required: [`${part.type}-data`],
          };
        }
      captures.push({
        identity: { threadId, userId: threadId, agentId: "row2" },
        before,
        after,
        input,
        events,
        observations,
        provenance: {
          input: `${scenario}-input.json`,
          events: `${scenario}-events.json`,
          fixture:
            "real adapter + AIMock, direct native store; API fixture, no visible app or Intelligence connection",
          packages,
        },
        errors: error ? [error] : [],
      });
    }
    return captures;
  }
  await mock.start();
  return {
    fixture,
    services: { row2: { captureFresh } },
    cleanup: () => mock.stop(),
  };
}
