import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectEvents } from "./capture/project.mjs";
import { createBrowser } from "./browser/session.mjs";

const require = createRequire(
  new URL("./dependencies/package.json", import.meta.url),
);
const { AbstractAgent } = require("@ag-ui/client");
const { from } = require("rxjs");
const { chromium } = require("playwright");

test("source projection consumes real AG-UI text/state streams without a destination reader", async () => {
  const events = [
    {
      type: "RUN_STARTED",
      threadId: "thread",
      runId: "run",
      input: {
        threadId: "thread",
        runId: "run",
        messages: [{ id: "user", role: "user", content: "hello" }],
        state: {},
        context: [],
        tools: [],
        forwardedProps: {},
      },
    },
    {
      type: "TEXT_MESSAGE_START",
      messageId: "reply",
      role: "assistant",
      runId: "run",
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "reply",
      delta: "hello ",
      runId: "run",
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "reply",
      delta: "again",
      runId: "run",
    },
    { type: "TEXT_MESSAGE_END", messageId: "reply", runId: "run" },
    { type: "STATE_SNAPSHOT", snapshot: { counter: 2 }, runId: "run" },
    { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
  ];
  const original = structuredClone(events);
  const actual = await projectEvents({ events, AbstractAgent, from });
  assert.equal(actual.messages[1].content, "hello again");
  assert.deepEqual(actual.state, { counter: 2 });
  assert.deepEqual(events, original);
});

test("real browser awaits native absence hook before POST and retains its screenshot", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "rich-browser-control-"));
  let permitted = false;
  let posted = false;
  const events = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      assert.equal(
        permitted,
        true,
        "Framework request raced the absence check",
      );
      posted = true;
      for await (const chunk of req) void chunk;
      events.push(
        { type: "RUN_STARTED", runId: "run", threadId: "thread" },
        { type: "RUN_FINISHED", runId: "run", threadId: "thread" },
      );
      res.end("done");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      `<textarea></textarea><script>document.querySelector('textarea').onkeydown=async e=>{if(e.key==='Enter'){e.preventDefault();await fetch('/agent/beautiful-chat/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({threadId:'thread',runId:'run',messages:[{id:'u',role:'user',content:e.target.value}]})});}}</script>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await createBrowser({
      chromium,
      scope: {
        agentId: "beautiful-chat",
        applicationUrl: `http://127.0.0.1:${server.address().port}`,
      },
      outputDir,
      capture: { read: async () => ({ events }) },
    });
    const thread = await browser.newThread({
      scenarioId: "race-control",
      beforeRun: async (input) => {
        assert.equal(posted, false);
        assert.equal(input.threadId, "thread");
        await new Promise((resolve) => setTimeout(resolve, 50));
        permitted = true;
      },
    });
    await browser.send(thread, "hello");
    const observed = await browser.snapshot(thread);
    assert.equal(posted, true);
    assert.equal(observed.fresh, true);
    assert.equal(observed.threadId, "thread");
    assert.equal(observed.screenshots.length, 1);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(outputDir, { recursive: true });
  }
});
