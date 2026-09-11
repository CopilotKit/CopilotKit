import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LLMock } from "@copilotkit/aimock";

const adapter = process.argv[2];
assert(
  ["langgraph", "adk", "dotnet"].includes(adapter),
  "Choose langgraph, adk, or dotnet.",
);
for (const name of [
  "INTELLIGENCE_API_URL",
  "CPK_INTELLIGENCE_API_KEY",
  "CPK_INTELLIGENCE_LEARNING_CONTAINER_ID",
]) {
  assert(process.env[name], `Real delivery acceptance requires ${name}.`);
}
const root = fileURLToPath(new URL("../../", import.meta.url));
const mock = new LLMock({
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  strict: true,
});
const results = (request) =>
  request.messages.filter((message) => message.role === "tool");
mock.on(
  {
    predicate: (request) =>
      results(request).some((message) => message.tool_call_id === "read"),
  },
  { content: "Acceptance complete" },
);
mock.on(
  {
    predicate: (request) =>
      results(request).some((message) => message.tool_call_id === "load"),
  },
  {
    toolCalls: [
      {
        id: "read",
        name: "copilotkit_read_skill_file",
        arguments: JSON.stringify({
          skill_name: "refund",
          path: "references/policy.txt",
        }),
      },
    ],
  },
);
const description =
  "Use when refund is required. Do not use for unrelated work.";
const instructions = (request) =>
  request.messages
    .filter((message) => ["system", "developer"].includes(message.role))
    .map((message) => JSON.stringify(message.content))
    .join("\n");
mock.on(
  {
    userMessage: "Learned skill acceptance refund",
    predicate: (request) => instructions(request).includes(description),
  },
  {
    toolCalls: [
      {
        id: "load",
        name: "copilotkit_load_skill",
        arguments: JSON.stringify({ skill_name: "refund" }),
      },
    ],
  },
);
await mock.start();
try {
  const command =
    adapter === "dotnet"
      ? [
          "dotnet",
          "run",
          "--project",
          "tools/learned-skill-conformance/dotnet/Acceptance.csproj",
        ]
      : [
          "uv",
          "run",
          "--project",
          "tools/learned-skill-conformance",
          "python",
          "tools/learned-skill-conformance/python_driver.py",
          adapter,
        ];
  const child = spawn(command[0], command.slice(1), {
    cwd: root,
    env: { ...process.env, LEARNED_SKILL_AIMOCK_URL: mock.url },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.env.LEARNED_SKILL_ACCEPTANCE_GROUP !== "1",
  });
  // Avoid logging model prompts, skills, or credentials on an assertion failure.
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-16000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-16000);
  });
  const terminate = () => {
    // The server harness supplies its own group; direct invocations own the child group.
    const group =
      process.env.LEARNED_SKILL_ACCEPTANCE_GROUP === "1"
        ? process.pid
        : child.pid;
    try {
      process.kill(-group, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const deadline = setTimeout(terminate, 120_000);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `Native ${adapter} acceptance process failed (exit ${code}).`,
              ),
            ),
      );
    });
  } finally {
    clearTimeout(deadline);
  }
  for (const forbidden of [
    process.env.CPK_INTELLIGENCE_API_KEY,
    "Learned skill acceptance refund",
    "Refund €10",
    "Follow the learned procedure.",
  ]) {
    assert(
      !output.includes(forbidden),
      "The native process logged protected request or skill content.",
    );
  }
  const requests = mock.getRequests();
  assert.equal(
    requests.length,
    3,
    "Expected discovery, skill load, and supporting-file model turns.",
  );
  assert(
    requests.every((request) => request.response.status === 200),
    "AIMock received an unmatched request.",
  );
  const first = requests[0].body;
  const context = instructions(first);
  assert(
    context.includes("Developer policy"),
    "Developer instructions missing.",
  );
  assert(
    context.includes("<copilotkit_learned_skills>") &&
      context.includes(description),
    "Learned catalog missing.",
  );
  const tools = first.tools.map((tool) => tool.function.name).sort();
  assert.deepEqual(tools, [
    "copilotkit_load_skill",
    "copilotkit_read_skill_file",
  ]);
  assert(
    JSON.stringify(results(requests[1].body)).includes(
      "Follow the learned procedure.",
    ),
    "SKILL.md content did not reach the framework model.",
  );
  assert(
    JSON.stringify(results(requests[1].body)).includes("references/policy.txt"),
    "Skill load did not list the supporting file.",
  );
  assert(
    JSON.stringify(results(requests[2].body)).includes("Refund €10"),
    "Supporting file did not reach the framework model.",
  );
  console.log(
    `PASS ${adapter}: real delivery API and native AIMock discovery/load/read`,
  );
} finally {
  await mock.stop();
}
