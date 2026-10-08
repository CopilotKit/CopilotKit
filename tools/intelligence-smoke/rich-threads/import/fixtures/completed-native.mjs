import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { seedMastra, seedStrands } from "./native-sources.mjs";
import { createImporter } from "../cli.mjs";
import { replayInBrowser } from "../browser.mjs";

function text(id, payload, role) {
  return { id, kind: "text", role, payload };
}
function call(id, name, args) {
  return { id, kind: "call", payload: { name, args } };
}
function result(callId, payload) {
  return { id: `${callId}:result`, kind: "result", callId, payload };
}

/** Independent projection for the explicitly controlled completed fixture only. */
export function inspectMastra(envelope) {
  const items = [];
  for (const message of envelope.messages)
    for (const part of message.content.parts) {
      if (part.type === "text")
        items.push(text(message.id, part.text, message.role));
      else if (part.type === "tool-invocation") {
        const tool = part.toolInvocation;
        assert.equal(
          tool.state,
          "result",
          "This source factory covers completed turns only",
        );
        items.push(
          call(tool.toolCallId, tool.toolName, tool.args),
          result(tool.toolCallId, tool.result),
        );
      } else throw new Error(`Uncovered Mastra source part: ${part.type}`);
    }
  return {
    items,
    state: JSON.parse(envelope.thread.metadata.workingMemory),
    pending: [],
  };
}
export function inspectStrands(envelope) {
  const items = [];
  for (const message of envelope.data.messages)
    for (const part of message.content) {
      if (part.text !== undefined)
        items.push(text(message.trackingId, part.text, message.role));
      else if (part.toolUse)
        items.push(
          call(part.toolUse.toolUseId, part.toolUse.name, part.toolUse.input),
        );
      else if (part.toolResult) {
        assert.equal(part.toolResult.content.length, 1);
        items.push(
          result(part.toolResult.toolUseId, part.toolResult.content[0].json),
        );
      } else
        throw new Error(`Uncovered Strands source part: ${Object.keys(part)}`);
    }
  assert.deepEqual(
    envelope.data.interrupts.interrupts,
    {},
    "Completed source cannot omit native interrupts",
  );
  return { items, state: envelope.data.state, pending: [] };
}
export function inspectTranscript(messages) {
  const items = [];
  for (const message of messages) {
    if (message.role === "tool")
      items.push(result(message.toolCallId, JSON.parse(message.content)));
    else {
      if (message.content) {
        assert.equal(
          typeof message.content,
          "string",
          "Uncovered media must not silently disappear",
        );
        const encoded = /^native:("(?:[^"\\]|\\.)*"):segment:0$/.exec(
          message.id,
        );
        items.push(
          text(
            encoded ? JSON.parse(encoded[1]) : message.id,
            message.content,
            message.role,
          ),
        );
      }
      for (const tool of message.toolCalls ?? [])
        items.push(call(tool.id, tool.name, JSON.parse(tool.args)));
    }
  }
  return items;
}

/** Explicit local configuration; no automatic discovery of services, credentials or reference data. */
export async function createFixture({ framework, outputDir }) {
  assert.ok(
    process.env.RICH_IMPORT_CONFIG,
    "Set RICH_IMPORT_CONFIG to your owned service configuration",
  );
  const config = JSON.parse(
    await readFile(process.env.RICH_IMPORT_CONFIG, "utf8"),
  );
  const require = createRequire(config.dependencyPackageJson);
  const { Pool } = require("pg");
  const db = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  let browser;
  try {
    const directory = join(outputDir, "native-source");
    const namespace = config.namespace;
    assert.match(namespace, /^[a-zA-Z0-9_-]+$/);
    let seed;
    let inspect;
    if (framework === "mastra") {
      seed = await seedMastra({
        LibSQLStore: require("@mastra/libsql").LibSQLStore,
        directory,
        namespace,
      });
      inspect = inspectMastra;
    } else if (framework === "strands-typescript") {
      const sdk = await import(pathToFileURL(config.strandsSdk));
      const storage = await import(pathToFileURL(config.strandsStorage));
      seed = await seedStrands({ ...sdk, ...storage, directory, namespace });
      inspect = inspectStrands;
    } else
      throw new Error(
        `No completed native fixture adapter configured for ${framework}`,
      );
    const envelope = JSON.parse(
      await readFile(join(directory, "native-envelope.json"), "utf8"),
    );
    const expected = inspect(envelope);
    const source = {
      id: namespace,
      nativeIdentity: seed.identity,
      expected,
      provenance: {
        nativeOnly: true,
        durable: true,
        completeCheckpoint: true,
        description: seed.provenance,
      },
      coverage: [
        "user-text",
        "assistant-text",
        "chart-pie",
        "chart-bar",
        "ordinary-tool",
        "shared-state-write",
      ],
      replay: config.browser?.expected ?? [
        { name: "required-browser", value: "not configured" },
      ],
    };
    const agentMap = join(outputDir, "agent-map.json");
    await writeFile(
      agentMap,
      JSON.stringify({ [seed.identity.agentId]: config.destinationAgentId }),
    );
    const importSource = createImporter({
      cli: config.cli,
      source: framework,
      apiUrl: config.apiUrl,
      agentMap,
      env: {
        ...process.env,
        ...seed.env,
        CPK_INTELLIGENCE_API_KEY: config.apiKey,
      },
      outputDir,
      secrets: [config.apiKey],
    });
    const findImported = async () =>
      (
        await db.query(
          "SELECT * FROM cpki.threads WHERE organization_id=$1 AND project_id=$2 AND import_metadata->>'backendThreadId'=$3",
          [config.organizationId, config.projectId, seed.identity.threadId],
        )
      ).rows;
    const api = async (path) => {
      const response = await fetch(`${config.apiUrl}${path}`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(
        response.status,
        200,
        `Intelligence API ${path} returned ${response.status}`,
      );
      return response.json();
    };
    return {
      fixture: { importLimitations: {} },
      services: {
        importReplay: {
          sources: async () => [source],
          inspectNative: async () => ({
            identity: seed.identity,
            ...inspect(envelope),
            rawCheckpoint: envelope,
          }),
          findImported,
          importSource,
          readImported: async (_source, destination) => {
            const transcript = await api(
              `/api/threads/${destination.thread_id}/messages?endUserId=${encodeURIComponent(seed.identity.userId)}`,
            );
            const events = (
              await db.query(
                "SELECT e.raw FROM cpki.run_events e JOIN cpki.agent_runs r ON r.id=e.run_id AND r.organization_id=e.organization_id WHERE r.thread_id=$1 AND r.organization_id=$2 ORDER BY COALESCE(e.event_seq,e.id),e.id",
                [destination.thread_id, config.organizationId],
              )
            ).rows.map((row) => row.raw);
            const stateEvent = events.findLast(
              (event) => event.type === "STATE_SNAPSHOT",
            );
            const native = destination.import_metadata.nativeSource;
            const nativeIdentity = {
              threadId: destination.import_metadata.backendThreadId,
              agentId: native.agentId,
              userId: destination.end_user_id,
              ...(native.resourceId ? { resourceId: native.resourceId } : {}),
            };
            return {
              threadId: destination.thread_id,
              nativeIdentity,
              items: inspectTranscript(transcript.messages),
              state: stateEvent?.snapshot,
              pending: [],
              raw: { destination, transcript, events },
            };
          },
          replay: async (_source, destination) => {
            if (!config.browser)
              throw Object.assign(
                new Error("Owned browser replay is not configured"),
                { code: "RICH_IMPORT_SETUP" },
              );
            const { chromium } = await import(pathToFileURL(config.playwright));
            browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            return replayInBrowser(page, {
              ...config.browser,
              url: config.browser.url.replace(
                "{threadId}",
                destination.threadId,
              ),
              screenshot: join(outputDir, "replay.png"),
            });
          },
        },
      },
      async cleanup() {
        if (browser) await browser.close();
        await db.end();
      },
    };
  } catch (error) {
    await db.end();
    throw error;
  }
}
