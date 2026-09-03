import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { startCurrentTimeUpdates } from "./lib/current-time.mjs";

const pageSource = readFileSync(
  new URL("./app/page.tsx", import.meta.url),
  "utf8",
);

test("refreshes the current time until the subscriber stops", () => {
  mock.timers.enable({ apis: ["setInterval"] });

  try {
    let updateCount = 0;
    const stopUpdates = startCurrentTimeUpdates(() => {
      updateCount += 1;
    });

    mock.timers.tick(999);
    assert.equal(updateCount, 0);

    mock.timers.tick(1);
    assert.equal(updateCount, 1);

    stopUpdates();
    mock.timers.tick(1_000);
    assert.equal(updateCount, 1);
  } finally {
    mock.timers.reset();
  }
});

test("isolates current-time updates in a null-rendering child", () => {
  const currentTimeContextSource = pageSource.match(
    /function CurrentTimeContext\(\) \{([\s\S]*?)\n\}/,
  )?.[1];
  const homeContentSource = pageSource.match(
    /function HomeContent\(\) \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(
    currentTimeContextSource,
    "expected a CurrentTimeContext component",
  );
  assert.match(currentTimeContextSource, /startCurrentTimeUpdates/);
  assert.match(currentTimeContextSource, /useAgentContext/);
  assert.match(currentTimeContextSource, /return null/);

  assert.ok(homeContentSource, "expected a HomeContent component");
  assert.match(homeContentSource, /<CurrentTimeContext \/>/);
  assert.match(homeContentSource, /<Dashboard \/>/);
  assert.match(homeContentSource, /<CopilotSidebar/);
  assert.doesNotMatch(
    homeContentSource,
    /useState|useEffect|useAgentContext|startCurrentTimeUpdates/,
  );
});
