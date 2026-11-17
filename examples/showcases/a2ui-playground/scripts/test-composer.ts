import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import OpenAI from "openai";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import { A2UI_VERSION } from "@copilotkit/shared";
import type { GenerativeUIManifest } from "@copilotkit/shared";
import { ownEntries } from "../src/a2ui/catalog/entries";
import { CATALOG_ID } from "../src/a2ui/catalog/ids";
import { MACRO_SAMPLES } from "../src/a2ui/macros/samples";
import { macros } from "../src/a2ui/macros/macros";
import { compose } from "../src/agent/composer";
import type { ComposeInput } from "../src/agent/composer";
import { composeExpress } from "../src/agent/compose-express";
import { pendingChildren, toExpress } from "../src/agent/express";
import { compileExpress } from "./lib-express-test";
import { EventQueue } from "../src/agent/events";
import { MODELS } from "../src/agent/models";

const ui = createGenerativeUI({
  id: CATALOG_ID,
  extends: [standardUI],
  components: ownEntries(() => () => null) as never,
});
const manifest: GenerativeUIManifest = {
  catalogId: CATALOG_ID,
  catalogIds: [CATALOG_ID],
  components: ui.manifestComponents,
  functions: {},
  targets: [],
  surfaces: {},
};

function inputFor(replies: string[], prior?: ComposeInput["prior"]) {
  let calls = 0;
  const q = new EventQueue();
  const input: ComposeInput = {
    brief: "Show a greeting",
    conversation: "user: Show a greeting",
    manifest,
    toolCallId: "test-greeting",
    t0: performance.now(),
    q,
    model: MODELS.gemini,
    signal: new AbortController().signal,
    prior,
    client: new OpenAI({
      apiKey: "test-only",
      fetch: async () => {
        const text = replies[calls++];
        assert.ok(text, "unexpected model retry");
        const chunks = [];
        for (let i = 0; i < text.length; i += 9)
          chunks.push(
            `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 9) } }] })}\n\n`,
          );
        return new Response(`${chunks.join("")}data: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    }),
  };
  return {
    input,
    calls: () => calls,
    events: async () => {
      q.close();
      const events = [];
      for await (const event of q) events.push(event);
      return events;
    },
  };
}
const valid = '<a2ui>\nroot = Text("Hello world")\n</a2ui>';
const invalid = "<a2ui>\nroot = Missing()\n</a2ui>";

test("Blueprint refs preserve pending children without replacing written children", () => {
  assert.deepEqual(
    pendingChildren(
      [{ id: "root", component: "Column", children: ["card"] }],
      manifest,
    ),
    ["card"],
  );
  assert.deepEqual(
    pendingChildren(
      [
        { id: "root", component: "Column", children: ["card"] },
        { ...MACRO_SAMPLES.ProductCard, id: "card" },
      ],
      manifest,
    ),
    [],
  );
});

test("Blueprint frames include nested tab children before they arrive", () => {
  assert.deepEqual(
    pendingChildren(
      [
        {
          id: "root",
          component: "Tabs",
          tabs: [{ title: "Overview", child: "body" }],
        },
      ],
      manifest,
    ),
    ["body"],
  );
});

test("Express macros compile, expand and preserve action context", async () => {
  const written = { ...MACRO_SAMPLES.FlightCard, id: "root" };
  const source = toExpress([
    {
      version: "1.0",
      createSurface: {
        surfaceId: "flight",
        catalogId: CATALOG_ID,
        components: [written],
      },
    },
  ]);
  const compiled = compileExpress(`<a2ui>${source}</a2ui>`, "flight");
  const expanded = await macros.expand(compiled.components);
  assert.ok(expanded.components.length > 1);
  assert.ok(expanded.components.every((c) => !macros.isMacro(c.component)));
  assert.ok(JSON.stringify(expanded.components).includes("select_flight"));
});

test("Express retries once, keeps canonical activities and update semantics", async () => {
  const fixture = inputFor([invalid, valid]);
  const result = await composeExpress(fixture.input);
  assert.equal(fixture.calls(), 2);
  assert.equal(result.components[0].text, "Hello world");
  const events = await fixture.events();
  const ops = events.flatMap((event) => {
    const record = event as unknown as {
      content?: { operations?: Array<{ version: string }> };
      patch?: Array<{ path: string; value: { version?: string } }>;
    };
    return [
      ...(record.content?.operations ?? []),
      ...(record.patch
        ?.filter((patch) => patch.path === "/operations/-")
        .map((patch) => patch.value) ?? []),
    ];
  });
  assert.ok(ops.length > 1);
  assert.ok(ops.every((op) => op.version === "1.0"));
  const update = inputFor([valid], { surfaceId: "existing", components: [] });
  const updated = await composeExpress(update.input);
  assert.equal(updated.surfaceId, "existing");
  assert.ok(
    (await update.events()).every(
      (event) => event.type !== "ACTIVITY_SNAPSHOT",
    ),
  );
});

test("a second Express failure falls back to JSON on the same surface", async () => {
  const fixture = inputFor([
    invalid,
    invalid,
    '{"components":[{"id":"root","component":"Text","text":"Recovered"}]}',
  ]);
  const result = await composeExpress(fixture.input);
  assert.equal(fixture.calls(), 3);
  assert.equal(result.stats.format, "json");
  assert.equal(result.surfaceId, "ui-eeting");
  assert.equal(result.components[0].text, "Recovered");
});

test("JSON composer keeps canonical bindings and event contexts", async () => {
  const fixture = inputFor([
    JSON.stringify({
      components: [
        { id: "root", component: "Column", children: ["field", "button"] },
        {
          id: "field",
          component: "TextField",
          label: "Email",
          value: { "@path": "/form/email" },
        },
        {
          id: "button",
          component: "Button",
          label: "Submit",
          onClick: {
            event: {
              name: "submit",
              context: { email: { "@path": "/form/email" } },
            },
          },
        },
      ],
      data: { form: { email: "ada@example.com" } },
    }),
  ]);
  const result = await compose(fixture.input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.components.find((c) => c.id === "field")?.value, {
    "@path": "/form/email",
  });
  assert.ok(JSON.stringify(result.components).includes('"name":"submit"'));
});

test("every recorded replay operation uses the canonical wire version", () => {
  assert.equal(
    A2UI_VERSION,
    "1.0",
    "requires the coordinated CopilotKit release containing #8155",
  );
  for (const filename of [
    "replay.json",
    "replay-weather.json",
    "replay-tokyo.json",
  ]) {
    const replay = JSON.parse(readFileSync(`src/data/${filename}`, "utf8"));
    let count = 0;
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if ("version" in value) {
        assert.equal(value.version, "1.0", filename);
        count++;
      }
      for (const item of Object.values(value)) visit(item);
    };
    visit(replay);
    assert.ok(count > 0, filename);
  }
});

test("a truncated Express stream is retried even when its prefix compiles", async () => {
  const fixture = inputFor(['<a2ui>\nroot = Text("Truncated")\n', valid]);
  const result = await composeExpress(fixture.input);
  assert.equal(fixture.calls(), 2);
  assert.equal(result.components[0].text, "Hello world");
});
