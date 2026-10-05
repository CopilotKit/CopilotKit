import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"),
);
export const scenario = Object.freeze(fixture.scenario);

/** Flatten only text sent to the model, including JSON-encoded Flue tool output. */
function textOf(request) {
  return request.messages
    .map(({ content }) => {
      const text =
        typeof content === "string"
          ? content
          : (content ?? []).map((part) => part.text ?? "").join("\n");
      if (text.startsWith('"')) {
        try {
          return JSON.parse(text);
        } catch {
          /* Match the original malformed text. */
        }
      }
      return text;
    })
    .join("\n");
}

/** Start AIMock with checked-in replies, no recording and no upstream provider. */
export async function startModel({ aimock, host = "127.0.0.1", port = 0 }) {
  const server = new aimock.LLMock({
    host,
    port,
    strict: true,
    journalMaxEntries: 0,
  });
  const phases = new Map();
  for (const phase of fixture.phases) {
    const entry = {
      match: {
        ...phase.match,
        predicate: (request) => {
          const tools = new Set(
            (request.tools ?? []).map((tool) => tool.function.name),
          );
          const text = textOf(request);
          return (
            phase.tools.every((name) => tools.has(name)) &&
            phase.requiredText.every((part) => text.includes(part))
          );
        },
      },
      response: aimock.normalizeResponse(phase.response),
    };
    const errors = aimock
      .validateFixtures([entry])
      .filter((result) => result.severity === "error");
    assert.deepEqual(errors, [], `Invalid ${phase.id} fixture`);
    server.addFixture(entry);
    phases.set(entry, phase.id);
  }
  await server.start();
  return {
    url: server.url,
    port: server.port,
    stop: () => server.stop(),
    requests: () =>
      server.getRequests().map((entry) => ({
        path: entry.path,
        body: entry.body,
        status: entry.response.status,
        phase: phases.get(entry.response.fixture) ?? null,
      })),
    evidence() {
      const requests = this.requests();
      assert.ok(
        requests.every((entry) => entry.status === 200 && entry.phase),
        "Unexpected or unmatched model request",
      );
      for (const phase of fixture.phases) {
        assert.equal(
          requests.filter((entry) => entry.phase === phase.id).length,
          1,
          `Missing or repeated model phase: ${phase.id}`,
        );
      }
      return { requests };
    },
  };
}
