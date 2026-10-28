import assert from "node:assert/strict";
import test from "node:test";
import {
  guideRequestSchema,
  resolveDocsGuideRequest,
} from "./docs-chat-guides";
import {
  deriveOnboardingGuide,
  onboardingGuideToMarkdown,
  onboardingSnapshotSchema,
  type OnboardingMessage,
  type OnboardingSnapshot,
} from "./docs-onboarding";

const empty: OnboardingSnapshot = {
  goal: "",
  frontend: null,
  framework: null,
  notes: [],
};
const project: OnboardingSnapshot = {
  goal: "Build a support assistant",
  frontend: "react",
  framework: "mastra",
  notes: [
    {
      title: "Open question: Approvals",
      detail: "How can a user review an action before it runs?",
    },
  ],
};
let sequence = 0;
function completed(
  name: string,
  args: unknown,
  result: unknown = args,
): OnboardingMessage[] {
  const id = `call-${++sequence}`;
  return [
    {
      role: "assistant",
      toolCalls: [{ id, function: { name, arguments: JSON.stringify(args) } }],
    },
    { role: "tool", toolCallId: id, content: JSON.stringify(result) },
  ];
}
function recommend(args: unknown) {
  return completed(
    "recommend_guides",
    args,
    resolveDocsGuideRequest(guideRequestSchema.parse(args)),
  );
}
function choose(kind: "frontend" | "framework", selection: string | null) {
  return completed(
    "choose_docs_stack",
    { kind, choices: selection ? [selection, "unused"] : ["react", "vue"] },
    { kind, selection },
  );
}

test("empty and unstructured conversations do not invent onboarding facts", () => {
  const expected = { ...empty, guides: [] };
  assert.deepEqual(deriveOnboardingGuide([]), expected);
  assert.deepEqual(
    deriveOnboardingGuide([{ role: "user", content: "Maybe React or Vue?" }]),
    expected,
  );
});

test("the latest full snapshot preserves open requests and applies corrections", () => {
  const corrected = {
    ...project,
    goal: "Build an internal support assistant",
    notes: [
      ...project.notes,
      {
        title: "Decision: Approval required",
        detail: "Ask the user before sending a reply.",
      },
    ],
  };
  const guide = deriveOnboardingGuide([
    ...completed("update_onboarding", project),
    ...completed("update_onboarding", corrected),
    ...choose("frontend", "vue"),
    ...choose("framework", null),
  ]);
  assert.deepEqual(guide, { ...corrected, frontend: "vue", guides: [] });
});

test("recommendations accumulate across turns in first-seen order without duplicates", () => {
  const guide = deriveOnboardingGuide([
    ...completed("update_onboarding", project),
    ...recommend({
      guides: ["quickstart", "chat"],
      frontend: "react",
      framework: "mastra",
    }),
    ...recommend({
      guides: ["shared-state", "learning", "streams"],
      frontend: "react",
      framework: "mastra",
    }),
    ...recommend({ guides: ["chat"], frontend: "react", framework: "mastra" }),
  ]);
  assert.deepEqual(
    guide.guides.map((item) => item.url),
    [
      "/mastra/quickstart",
      "/mastra/agentic-chat-ui",
      "/mastra/shared-state",
      "/learning",
      "/AG-UI-Streams",
    ],
  );
});

test("a corrected stack removes obsolete links but keeps global guides", () => {
  const guide = deriveOnboardingGuide([
    ...completed("update_onboarding", project),
    ...recommend({
      guides: ["chat", "learning"],
      frontend: "react",
      framework: "mastra",
    }),
    ...choose("framework", "langgraph-python"),
    ...recommend({ guides: ["chat"], frontend: "react", framework: "mastra" }),
    ...recommend({
      guides: ["chat"],
      frontend: "react",
      framework: "langgraph-python",
    }),
  ]);
  assert.equal(guide.framework, "langgraph-python");
  assert.deepEqual(
    guide.guides.map((item) => item.url),
    ["/learning", "/langgraph-python/agentic-chat-ui"],
  );
});

test("recommendation defaults never become confirmed choices", () => {
  const recommendations = recommend({ guides: ["chat"] });
  const guide = deriveOnboardingGuide(recommendations);
  assert.equal(guide.frontend, null);
  assert.equal(guide.framework, null);
  assert.deepEqual(
    guide.guides.map((item) => item.url),
    ["/agentic-chat-ui"],
  );
  assert.deepEqual(
    deriveOnboardingGuide([...recommendations, ...choose("frontend", "vue")])
      .guides,
    [],
  );
});

test("a new-stack recommendation can finish before its confirming snapshot", () => {
  const messages = [
    ...completed("update_onboarding", project),
    ...recommend({ guides: ["chat"], frontend: "vue", framework: "mastra" }),
  ];
  assert.deepEqual(deriveOnboardingGuide(messages).guides, []);
  const guide = deriveOnboardingGuide([
    ...messages,
    ...completed("update_onboarding", { ...project, frontend: "vue" }),
  ]);
  assert.deepEqual(
    guide.guides.map((item) => item.url),
    ["/vue/mastra/prebuilt-components/chat"],
  );
});

test("malformed, incomplete, orphaned, and failed calls do not change the record", () => {
  const failed = completed("update_onboarding", project);
  failed[1].error = "Request failed";
  const pending = completed("update_onboarding", project).slice(0, 1);
  const partialArgs = completed("update_onboarding", project);
  partialArgs[0].toolCalls![0].function.arguments = '{"goal":';
  const malformedResult = completed("update_onboarding", project);
  malformedResult[1].content = "not JSON";
  const invalidChoice = completed(
    "choose_docs_stack",
    { kind: "frontend", choices: ["react", "vue"] },
    { kind: "frontend", selection: "angular" },
  );
  const guide = deriveOnboardingGuide([
    ...failed,
    ...pending,
    ...partialArgs,
    ...malformedResult,
    ...invalidChoice,
    {
      role: "tool",
      toolCallId: "missing-call",
      content: JSON.stringify(project),
    },
  ]);
  assert.deepEqual(guide, { ...empty, guides: [] });
});

test("guide results cannot insert arbitrary URLs or unrequested catalog IDs", () => {
  const args = { guides: ["chat"], frontend: "react", framework: "mastra" };
  const guide = deriveOnboardingGuide(
    completed("recommend_guides", args, [
      {
        id: "chat",
        url: "https://example.com/phishing",
        title: "Trusted guide",
      },
      { id: "learning", url: "/learning" },
    ]),
  );
  assert.deepEqual(guide.guides, []);
});

test("clearing a confirmed stack and New chat discard stale scoped data", () => {
  const messages = [
    ...completed("update_onboarding", project),
    ...recommend({
      guides: ["chat", "streams"],
      frontend: "react",
      framework: "mastra",
    }),
    ...completed("update_onboarding", { ...project, frontend: null }),
  ];
  assert.deepEqual(
    deriveOnboardingGuide(messages).guides.map((item) => item.url),
    ["/AG-UI-Streams"],
  );
  assert.deepEqual(deriveOnboardingGuide([]), { ...empty, guides: [] });
});

test("snapshots require explicit nullable stack fields and bounded notes", () => {
  assert.equal(
    onboardingSnapshotSchema.safeParse({ goal: "Test", notes: [] }).success,
    false,
  );
  assert.equal(
    onboardingSnapshotSchema.safeParse({
      ...empty,
      framework: "not-a-framework",
    }).success,
    false,
  );
  assert.equal(
    onboardingSnapshotSchema.safeParse({
      ...empty,
      notes: Array(7).fill(project.notes[0]),
    }).success,
    false,
  );
  assert.equal(onboardingSnapshotSchema.safeParse(empty).success, true);
});

test("Markdown includes retained questions and portable validated guide links", () => {
  const guide = deriveOnboardingGuide([
    ...completed("update_onboarding", project),
    ...recommend({ guides: ["chat"], frontend: "react", framework: "mastra" }),
  ]);
  const markdown = onboardingGuideToMarkdown(guide);
  assert.match(markdown, /Frontend: React/);
  assert.match(markdown, /Open question: Approvals/);
  assert.match(
    markdown,
    /https:\/\/docs\.copilotkit\.ai\/mastra\/agentic-chat-ui/,
  );
});
