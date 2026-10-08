/** Local candidate control. Dependency paths are explicit; no global services or credentials. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
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
  const resolve = createRequire(join(root, "package.json"));
  const adapterName =
    framework === "mastra" ? "@ag-ui/mastra" : "@ag-ui/aws-strands";
  const adapterResolve = createRequire(resolve.resolve(adapterName));
  // Resolve SDK classes from the adapter's own graph: duplicate installations split lifecycle hook identities.
  const loader = async (name) =>
    import(
      pathToFileURL(
        (name.startsWith("@strands-agents/")
          ? adapterResolve
          : resolve
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
  await mock.start();
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
      : resolve;
    const entry = resolver.resolve(name);
    packages[name] = { entry, sha256: sha(await readFile(entry)) };
  }
  await writeFile(
    join(outputDir, "dependency-entries.json"),
    JSON.stringify(packages, null, 2),
  );

  async function makeAdapter(threadId) {
    if (framework === "mastra") {
      const { Agent } = await loader("@mastra/core/agent");
      const { Memory } = await loader("@mastra/memory");
      const { LibSQLStore } = await loader("@mastra/libsql");
      const { createOpenAI } = await loader("@ai-sdk/openai");
      const { MastraAgent } = await loader(adapterName);
      const path = join(store, `${threadId}.db`);
      const storage = new LibSQLStore({ id: threadId, url: `file:${path}` });
      const agent = new Agent({
        id: "row2",
        name: "row2",
        instructions: "Follow the user's request",
        model: createOpenAI({
          baseURL: `${mock.url}/v1`,
          apiKey: "local-placeholder",
        }).chat("gpt-4o"),
        memory: new Memory({
          storage,
          options: { lastMessages: 100, generateTitle: false },
        }),
      });
      const adapter = new MastraAgent({ agent, resourceId: threadId });
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
    const { Agent, SessionManager, FileStorage } = await loader(
      "@strands-agents/sdk",
    );
    const { OpenAIModel } = await loader("@strands-agents/sdk/models/openai");
    const { StrandsAgent } = await loader(adapterName);
    const adapter = new StrandsAgent({
      agent: new Agent({
        id: "row2",
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
      envelopes: (snapshot) =>
        Object.entries(snapshot.records).flatMap(([record, session]) =>
          (session.data?.messages ?? []).map((value, index) => ({
            value,
            record,
            pointer: `/data/messages/${index}`,
          })),
        ),
    };
  }

  async function captureFresh() {
    const captures = [];
    for (const scenario of ["text", "media"]) {
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
            content: scenario === "text" ? prompt : content,
          },
        ],
        state: {},
        context: [],
        forwardedProps: {},
        tools: [],
      };
      const adapter = await makeAdapter(threadId);
      // New per-scenario store/UUID, and no source import/seeding. The directory was created exclusively above.
      const before = { records: {} };
      const events = [];
      let error;
      try {
        await adapter.run(input, events);
      } catch (failure) {
        error = failure.message;
      }
      await writeFile(
        join(outputDir, `${scenario}-input.json`),
        JSON.stringify(input, null, 2),
      );
      await writeFile(
        join(outputDir, `${scenario}-events.json`),
        JSON.stringify({ events, error }, null, 2),
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
      add("text", `${scenario}-user-text`, user, textPointer, prompt, {
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
        add("text", "assistant-text", assistant, pointer, expected, {
          artifact: "text-events.json",
          pointer: "/events",
        });
        fixture.row2.coverage.text = {
          required: ["text-user-text", "assistant-text"],
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
          const filename = leaves(user.value).find(
            (leaf) => leaf.value === part.metadata.filename,
          );
          const mime = leaves(user.value).find(
            (leaf) => leaf.value === part.source.mimeType,
          );
          const bytes = Buffer.from(part.source.value, "base64");
          const formatPointer = candidate?.pointer.replace(
            /\/source\/bytes$/,
            "/format",
          );
          const format = formatPointer && atPointer(user.value, formatPointer);
          observations.push({
            category: part.type,
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
                ? { mimePointer: mime.pointer }
                : candidate?.value.startsWith("data:")
                  ? {}
                  : format
                    ? { mimePointer: formatPointer, mimeEncoding: "format" }
                    : { mimePointer: "/missing-mime" }),
              filenamePointer: filename?.pointer ?? "/missing-filename",
              expected: {
                sha256: sha(bytes),
                byteLength: bytes.length,
                mime: part.source.mimeType,
                filename: part.metadata.filename,
              },
            },
          });
          // URL and provider-file variants remain explicitly unvalidated, so a sampled inline path cannot certify the category.
          fixture.row2.coverage[part.type] = {
            required: [
              `${part.type}-data`,
              `${part.type}-url`,
              `${part.type}-file`,
            ],
          };
        }
      captures.push({
        identity: { threadId, userId: threadId, agentId: "row2" },
        before,
        after,
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
  return {
    fixture,
    services: { row2: { captureFresh } },
    cleanup: () => mock.stop(),
  };
}
