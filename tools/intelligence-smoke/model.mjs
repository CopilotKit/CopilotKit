import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"),
);
export const scenario = Object.freeze(fixture.scenario);

/** Bind the final model fixture's complete citation list to its harvested snapshot. */
export function expectedCitationIds(snapshotId) {
  const final = fixture.phases.find((phase) => phase.id === "reduce");
  return final.response.toolCalls[0].arguments.operations[0].evidenceRefs[0].messageIds.map(
    (id) => id.replace(`${scenario.threadId}:`, `${snapshotId}:`),
  );
}

/** Flatten only text sent to the model, including JSON-encoded Flue tool output. */
function textOf(request, role) {
  return request.messages
    .filter((message) => message.role === role)
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
  let nextPhase = 0;
  let snapshotId;
  const bind = (value, id = snapshotId) =>
    id
      ? JSON.parse(JSON.stringify(value).replaceAll(scenario.threadId, id))
      : value;
  for (const phase of fixture.phases) {
    const entry = {
      match: {
        ...phase.match,
        predicate: (request) => {
          const tools = new Set(
            (request.tools ?? []).map((tool) => tool.function.name),
          );
          if (fixture.phases[nextPhase] !== phase) return false;
          const text = textOf(
            request,
            phase.id === "candidate" ? "tool" : "user",
          );
          let observedId = snapshotId;
          if (phase.id === "candidate") {
            observedId =
              /^## Thread ([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\n/.exec(
                text,
              )?.[1];
            if (
              !observedId ||
              text !== bind(phase.requiredText, observedId).join("\n")
            )
              return false;
          }
          const matches =
            phase.tools.every((name) => tools.has(name)) &&
            bind(phase.requiredText, observedId).every((part) =>
              text.includes(part),
            );
          if (matches && phase.id === "candidate") snapshotId = observedId;
          return matches;
        },
      },
      response: aimock.normalizeResponse(phase.response),
    };
    const errors = aimock
      .validateFixtures([entry])
      .filter((result) => result.severity === "error");
    assert.deepEqual(errors, [], `Invalid ${phase.id} fixture`);
    const response = entry.response;
    entry.response = () => {
      nextPhase++;
      return bind(response);
    };
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
      assert.deepEqual(
        requests.map((request) => request.phase),
        fixture.phases.map((phase) => phase.id),
        "Model phases ran out of order",
      );
      return { snapshotId, requests };
    },
  };
}
