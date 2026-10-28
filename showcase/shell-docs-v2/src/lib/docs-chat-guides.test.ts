import assert from "node:assert/strict";
import test from "node:test";
import {
  guideRequestSchema,
  resolveDocsGuideRequest,
} from "./docs-chat-guides";

test("guide requests reject arbitrary destinations and unavailable frameworks", () => {
  assert.equal(
    guideRequestSchema.safeParse({ guides: ["https://example.com"] }).success,
    false,
  );
  assert.equal(
    guideRequestSchema.safeParse({
      guides: ["quickstart"],
      framework: "google-antigravity",
    }).success,
    false,
  );
});

test("React recommendations retain the selected agent framework", () => {
  const guides = resolveDocsGuideRequest({
    guides: ["quickstart", "shared-state"],
    frontend: "react",
    framework: "mastra",
  });
  assert.deepEqual(
    guides.map((guide) => guide.url),
    ["/mastra/quickstart", "/mastra/shared-state"],
  );
});

test("non-React setup separates frontend instructions from the backend quickstart", () => {
  const guides = resolveDocsGuideRequest({
    guides: ["quickstart"],
    frontend: "vue",
    framework: "mastra",
  });
  assert.deepEqual(
    guides.map((guide) => guide.url),
    ["/vue", "/mastra/quickstart"],
  );
  assert.equal(guides[0].title, "Set up Vue");
  assert.match(guides[1].description, /React quickstart/);
});

test("feature cards use frontend-specific guides and native references", () => {
  const angular = resolveDocsGuideRequest({
    guides: ["shared-state", "human-in-the-loop"],
    frontend: "angular",
    framework: "built-in-agent",
  });
  assert.deepEqual(
    angular.map((guide) => guide.url),
    ["/angular/guides/shared-state", "/angular/guides/human-in-the-loop"],
  );
  const native = resolveDocsGuideRequest({
    guides: ["shared-state"],
    frontend: "react-native",
    framework: "mastra",
  });
  assert.deepEqual(
    native.map((guide) => guide.url),
    ["/reference/react-native/hooks/useAgent"],
  );
});

test("Angular setup stays integrated and channels use their connect guide", () => {
  assert.deepEqual(
    resolveDocsGuideRequest({
      guides: ["quickstart"],
      frontend: "angular",
      framework: "mastra",
    }).map((guide) => guide.url),
    ["/angular/mastra/quickstart"],
  );
  assert.deepEqual(
    resolveDocsGuideRequest({
      guides: ["quickstart"],
      frontend: "slack",
      framework: "mastra",
    }).map((guide) => guide.url),
    ["/slack/mastra/connect"],
  );
});
