import assert from "node:assert/strict";
import { test } from "node:test";
import { expressProcessor, surfaceOf, toExpress } from "../src/agent/express";

import { compileExpress } from "./lib-express-test";

const reply =
  '<a2ui>\nroot = Column([hello])\nhello = Text("Hello world")\n</a2ui>';

test("Express emits canonical 1.0 operations and round-trips", () => {
  const result = compileExpress(reply, "test");
  assert.ok(result.messages.length);
  assert.ok(result.messages.every((message) => message.version === "1.0"));
  const decompiled = toExpress(result.messages);
  assert.match(decompiled, /Hello world/);
  assert.deepEqual(
    compileExpress(`<a2ui>${decompiled}</a2ui>`, "test").components,
    result.components,
  );
});

test("native streaming paints before a complete text string and finalizes identically", () => {
  const stream = expressProcessor("test").openStream();
  const messages = stream.feed(
    '<a2ui>\nroot = Column([hello])\nhello = Text("Hello',
  );
  const early = messages.flatMap((part) =>
    part.type === "a2ui" ? part.a2ui : [],
  );
  assert.equal(
    surfaceOf(early).components.find((c) => c.id === "hello")?.text,
    "Hello",
  );
  const rest = [...stream.feed(' world")\n</a2ui>'), ...stream.close()];
  assert.deepEqual(
    surfaceOf([
      ...early,
      ...rest.flatMap((part) => (part.type === "a2ui" ? part.a2ui : [])),
    ]),
    surfaceOf(compileExpress(reply, "test").messages),
  );
});

test("chunk boundaries, bindings and action contexts survive native streaming", () => {
  const source = `<a2ui>
root = Column([field, submit])
field = TextField(value=$/form/email, label="Email")
submit = Button("Send", onClick=Event("submit", {"email": $/form/email}))
$/form/email = "ada@example.com"
</a2ui>`;
  const expected = compileExpress(source, "form");
  assert.deepEqual(expected.components.find((c) => c.id === "field")?.value, {
    "@path": "/form/email",
  });
  assert.deepEqual(
    expected.components.find((c) => c.id === "submit")?.onClick,
    {
      event: { name: "submit", context: { email: { "@path": "/form/email" } } },
    },
  );
  for (const size of [1, 7, 31]) {
    const stream = expressProcessor("form").openStream();
    const parts = [];
    for (let i = 0; i < source.length; i += size)
      parts.push(...stream.feed(source.slice(i, i + size)));
    parts.push(...stream.close());
    assert.deepEqual(
      surfaceOf(
        parts.flatMap((part) => (part.type === "a2ui" ? part.a2ui : [])),
      ),
      surfaceOf(expected.messages),
    );
  }
});
