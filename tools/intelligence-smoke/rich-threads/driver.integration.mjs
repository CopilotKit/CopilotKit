import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectEvents } from "./capture/project.mjs";
import { createBrowser } from "./browser/session.mjs";
import { runtimeSocket } from "./capture/socket.mjs";
import { Socket as EsmSocket } from "./dependencies/node_modules/phoenix/priv/static/phoenix.mjs";
import { captureFramework, readCapture } from "./capture/runtime-agent.mjs";
import { loadDriverDependencies } from "./bootstrap.mjs";

import {
  createMastraBackend,
  loadRunAgentInputSchema,
} from "./application/mastra-backend.mjs";

const require = createRequire(
  new URL("./dependencies/package.json", import.meta.url),
);
const { HttpAgent } = require("@ag-ui/client");
const { tap } = require("rxjs");
const { chromium, AbstractAgent, from } = await loadDriverDependencies();

test("ingestion hook selects the runtime's ESM Socket, never the separate CJS class", async () => {
  const Socket = await runtimeSocket(
    new URL("./dependencies/package.json", import.meta.url),
  );
  assert.equal(Socket, EsmSocket);
  assert.notEqual(Socket, require("phoenix").Socket);
});

test("native capture survives the actual HttpAgent clone used by runtimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rich-clone-control-"));
  const source = [
    { type: "RUN_STARTED", threadId: "thread", runId: "run" },
    { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
  ];
  try {
    const agent = captureFramework({
      agent: new HttpAgent({
        url: "http://fixture.invalid",
        threadId: "thread",
        fetch: async () =>
          new Response(
            source
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            { headers: { "content-type": "text/event-stream" } },
          ),
      }),
      directory,
      tap,
    });
    await agent.clone().runAgent({ runId: "run" });
    const captured = readCapture(directory, "thread");
    assert.equal(captured.frameworkRuns.length, 1);
    assert.deepEqual(captured.frameworkRuns[0].events, source);
    assert.equal(captured.frameworkRuns[0].complete, true);
  } finally {
    await rm(directory, { recursive: true });
  }
});

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

for (const framework of ["mastra", "strands-typescript"]) {
  test(`real ${framework} browser waits for cold composer readiness and awaits native absence hook before POST`, async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "rich-browser-control-"));
    let permitted = false;
    let posted = false;
    let posts = 0;
    const events = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST") {
        assert.equal(
          permitted,
          true,
          "Framework request raced the absence check",
        );
        posted = true;
        posts++;
        for await (const chunk of req) void chunk;
        events.push({ type: "RUN_STARTED", runId: "run", threadId: "thread" });
        setTimeout(
          () =>
            events.push({
              type: "RUN_FINISHED",
              runId: "run",
              threadId: "thread",
            }),
          framework === "mastra" ? 1700 : 0,
        );
        res.end("done");
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(
        `<textarea data-testid="copilot-chat-textarea"></textarea><button data-testid="copilot-send-button" disabled>Send</button><div data-testid="thread-selection"></div><input data-testid="open-thread-id"><button data-testid="open-thread">Open thread</button><script>
      const selected=document.querySelector('[data-testid="thread-selection"]');
      selected.setAttribute('data-active-thread-id',new URL(location.href).searchParams.get('threadId')??'initial');
      document.querySelector('[data-testid="open-thread"]').onclick=()=>setTimeout(()=>selected.setAttribute('data-active-thread-id',document.querySelector('input').value),50);
      // Cold SSR markup is visible before React hydrates. Hydration replaces
      // pre-hydration input with controlled state, then runtime discovery enables send.
      setTimeout(()=>{
        const input=document.querySelector('textarea'),send=document.querySelector('[data-testid="copilot-send-button"]');
        input.value='';
        input.oninput=()=>{send.disabled=!input.value.trim()};
        send.onclick=async()=>{send.disabled=true;await fetch('/agent/beautiful-chat/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({threadId:'thread',runId:'run',messages:[{id:'u',role:'user',content:input.value}]})});};
      },800);</script>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser, instance;
    try {
      instance = await chromium.launch({ headless: true });
      browser = await createBrowser({
        chromium,
        instance,
        scope: {
          agentId: "beautiful-chat",
          framework,
          applicationUrl: `http://127.0.0.1:${server.address().port}`,
        },
        outputDir,
        capture: { read: async () => ({ events }) },
        signal: AbortSignal.timeout(10_000),
        composerTimeoutMs: 1500,
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
      assert.equal(
        new URL(thread.page.url()).searchParams.get("framework"),
        framework,
      );
      await browser.send(thread, "hello");
      const observed = await browser.snapshot(thread);
      assert.equal(posted, true);
      assert.equal(posts, 1, "Readiness must not retry submission");
      assert.equal(observed.fresh, true);
      assert.equal(observed.threadId, "thread");
      assert.equal(observed.screenshots.length, 1);
      await browser.closeThread(thread);
      assert.equal(instance.contexts().length, 0);
      await browser.close();
      assert.equal(
        instance.isConnected(),
        true,
        "Row cleanup must preserve the shared browser",
      );
    } finally {
      await browser?.close();
      await instance?.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(outputDir, { recursive: true });
    }
  });
}

for (const blocked of ["fill", "enabled", "click"]) {
  for (const cancellation of ["deadline", "abort"]) {
    test(`composer ${cancellation} cancels blocked ${blocked} without a late POST`, async () => {
      let posts = 0;
      const server = createServer((req, res) => {
        if (req.method === "POST") posts++;
        res.setHeader("content-type", "text/html");
        res.end(`<textarea data-testid="copilot-chat-textarea" ${blocked === "fill" ? "disabled" : ""}></textarea>
          <button ${blocked === "enabled" ? "" : 'data-testid="copilot-send-button"'}>Send</button>
          ${blocked === "click" ? '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>' : ""}
          <script>document.querySelector('button').onclick=()=>fetch('/agent/beautiful-chat/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({threadId:'thread',runId:'run',messages:[{role:'user',content:'hello'}]})});</script>`);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const controller = new AbortController();
      let browser, watchdog, abortTimer;
      try {
        browser = await createBrowser({
          chromium,
          scope: {
            agentId: "beautiful-chat",
            framework: "mastra",
            applicationUrl: `http://127.0.0.1:${server.address().port}`,
          },
          outputDir: tmpdir(),
          capture: { read: async () => ({ events: [] }) },
          signal: controller.signal,
          composerTimeoutMs: cancellation === "deadline" ? 250 : 90_000,
        });
        const thread = await browser.newThread({
          scenarioId: "blocked-composer",
        });
        if (cancellation === "abort")
          abortTimer = setTimeout(
            () => controller.abort(new Error("cancel composer")),
            250,
          );
        const started = Date.now();
        await assert.rejects(
          Promise.race([
            browser.send(thread, "hello"),
            new Promise((_, reject) => {
              watchdog = setTimeout(
                () => reject(new Error("watchdog: action did not cancel")),
                1500,
              );
            }),
          ]),
          (error) => {
            assert.doesNotMatch(error.message, /watchdog/);
            assert.match(
              error.message,
              cancellation === "abort"
                ? /cancel composer|abort/i
                : /timeout|deadline/i,
            );
            return true;
          },
        );
        assert.ok(
          Date.now() - started < 1200,
          "The whole action must respect its budget",
        );
        await thread.page.evaluate(() => {
          document.querySelector("textarea").disabled = false;
          document.querySelector("button").dataset.testid =
            "copilot-send-button";
          document.querySelector("#overlay")?.remove();
        });
        await new Promise((resolve) => setTimeout(resolve, 350));
        assert.equal(
          posts,
          0,
          "Cancelled actions must not submit after unblocking",
        );
        assert.deepEqual(thread.interactions, []);
      } finally {
        clearTimeout(watchdog);
        clearTimeout(abortTimer);
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  }
}

test("cancellation during beforeRun prevents the deferred POST", async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST") posts++;
    res.setHeader("content-type", "text/html");
    res.end(
      `<textarea data-testid="copilot-chat-textarea"></textarea><button data-testid="copilot-send-button" onclick="fetch('/agent/beautiful-chat/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({threadId:'thread',runId:'run',messages:[{role:'user',content:'hello'}]})})">Send</button>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  let releaseHook, enteredHook;
  const entered = new Promise((resolve) => {
    enteredHook = resolve;
  });
  const held = new Promise((resolve) => {
    releaseHook = resolve;
  });
  let browser;
  try {
    browser = await createBrowser({
      chromium,
      scope: {
        agentId: "beautiful-chat",
        framework: "mastra",
        applicationUrl: `http://127.0.0.1:${server.address().port}`,
      },
      outputDir: tmpdir(),
      capture: { read: async () => ({ events: [] }) },
      signal: controller.signal,
    });
    const thread = await browser.newThread({
      scenarioId: "cancel-hook",
      beforeRun: async () => {
        enteredHook();
        await held;
      },
    });
    const sending = browser.send(thread, "hello");
    const rejected = assert.rejects(sending, /abort|cancel hook/i);
    await entered;
    controller.abort(new Error("cancel hook"));
    releaseHook();
    await rejected;
    await thread.page.waitForTimeout(350);
    assert.equal(
      posts,
      0,
      "Aborting the absence hook must prevent request admission",
    );
  } finally {
    releaseHook();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("composer deadline during beforeRun prevents the deferred POST", async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST") posts++;
    res.setHeader("content-type", "text/html");
    res.end(
      `<textarea data-testid="copilot-chat-textarea"></textarea><button data-testid="copilot-send-button" onclick="fetch('/agent/beautiful-chat/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({threadId:'thread',runId:'run',messages:[{role:'user',content:'hello'}]})})">Send</button>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  let releaseHook, enteredHook;
  const entered = new Promise((resolve) => {
    enteredHook = resolve;
  });
  const held = new Promise((resolve) => {
    releaseHook = resolve;
  });
  let browser;
  try {
    browser = await createBrowser({
      chromium,
      scope: {
        agentId: "beautiful-chat",
        framework: "mastra",
        applicationUrl: `http://127.0.0.1:${server.address().port}`,
      },
      outputDir: tmpdir(),
      capture: { read: async () => ({ events: [] }) },
      signal: controller.signal,
      composerTimeoutMs: 250,
    });
    const thread = await browser.newThread({
      scenarioId: "cancel-hook",
      beforeRun: async () => {
        enteredHook();
        await held;
      },
    });
    const sending = browser.send(thread, "hello");
    const rejected = assert.rejects(sending, /deadline/i);
    await entered;
    await assert.rejects(
      browser.send(thread, "overlap"),
      /already awaiting admission/,
    );
    await Promise.race([
      rejected,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("deadline watchdog")), 1000),
      ),
    ]);
    await assert.rejects(browser.send(thread, "retry"), /deadline/i);
    releaseHook();
    await thread.page.waitForTimeout(350);
    assert.equal(
      posts,
      0,
      "Aborting the absence hook must prevent request admission",
    );
  } finally {
    controller.abort(new Error("test cleanup"));
    releaseHook();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Mastra backend validates HTTP requests using the pinned AG-UI schema export", async (t) => {
  assert.equal(require("@ag-ui/core/package.json").version, "1.0.2");
  const RunAgentInputSchema = await loadRunAgentInputSchema(require);
  const inputs = [];
  const server = createMastraBackend({
    mastra: { getAgent: () => ({}) },
    MastraAgent: class {
      run(input) {
        inputs.push(input);
        return {
          subscribe(observer) {
            observer.next({
              type: "RUN_STARTED",
              threadId: input.threadId,
              runId: input.runId,
            });
            observer.next({
              type: "RUN_FINISHED",
              threadId: input.threadId,
              runId: input.runId,
            });
            observer.complete();
            return { unsubscribe() {} };
          },
        };
      }
    },
    RunAgentInputSchema,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/rich`;
  const input = {
    threadId: "thread",
    runId: "run",
    state: {},
    messages: [{ id: "user", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert.match(body, /RUN_FINISHED/);
  assert.deepEqual(inputs, [input]);
  const invalid = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, messages: "invalid" }),
  });
  assert.equal(invalid.status, 400, await invalid.text());
  assert.equal(inputs.length, 1, "Invalid input must not invoke the adapter");
});
