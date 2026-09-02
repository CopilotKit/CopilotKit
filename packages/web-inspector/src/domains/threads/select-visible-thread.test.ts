import { expect, test } from "vitest";

import { selectVisibleRealThreadId } from "./selectors.js";
import type { VisibleRealThreadCandidate } from "./selectors.js";

const DEFAULT_UPDATED_AT = "2026-08-03T12:00:00.000Z";
const DEFAULT_CREATED_AT = "2026-08-03T11:00:00.000Z";

function candidate(
  id: string,
  dates: Readonly<{
    updatedAt?: string | null;
    createdAt?: string | null;
  }> = {},
): VisibleRealThreadCandidate {
  return {
    id,
    updatedAt: DEFAULT_UPDATED_AT,
    createdAt: DEFAULT_CREATED_AT,
    ...dates,
  };
}

test("keeps an exact visible explicit selection even when it is older", () => {
  const threads = [
    candidate("newer", { updatedAt: "2026-08-03T13:00:00.000Z" }),
    candidate("explicit-older", { updatedAt: "2026-08-03T10:00:00.000Z" }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: "explicit-older",
  });

  expect(selected).toBe("explicit-older");
});

test("chooses the newest valid updated time from unsorted input", () => {
  const threads = [
    candidate("middle", { updatedAt: "2026-08-03T12:00:00.000Z" }),
    candidate("oldest", { updatedAt: "2026-08-03T10:00:00.000Z" }),
    candidate("newest", { updatedAt: "2026-08-03T14:00:00.000Z" }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("newest");
});

test("replaces a stale explicit selection with the visible fallback", () => {
  const threads = [
    candidate("older", { updatedAt: "2026-08-03T10:00:00.000Z" }),
    candidate("fallback", { updatedAt: "2026-08-03T14:00:00.000Z" }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: "stale-thread",
  });

  expect(selected).toBe("fallback");
});

test("does not preserve an example ID absent from the real candidates", () => {
  const threads = [candidate("real-thread")];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: "example-realtime-sync",
  });

  expect(selected).toBe("real-thread");
});

test("does not preserve a React or custom placeholder absent from the real candidates", () => {
  const threads = [candidate("persisted-thread")];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: "01953f65-6f00-7000-8000-placeholder",
  });

  expect(selected).toBe("persisted-thread");
});

test("returns null for empty real rows regardless of the explicit selection", () => {
  const threads: readonly VisibleRealThreadCandidate[] = [];

  const nullSelection = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });
  const exampleSelection = selectVisibleRealThreadId({
    threads,
    selectedThreadId: "example-realtime-sync",
  });
  const placeholderSelection = selectVisibleRealThreadId({
    threads,
    selectedThreadId: "01953f65-6f00-7000-8000-placeholder",
  });

  expect(nullSelection).toBeNull();
  expect(exampleSelection).toBeNull();
  expect(placeholderSelection).toBeNull();
});

test("ranks a valid updated time before invalid and missing updated times", () => {
  const threads = [
    candidate("invalid-updated", { updatedAt: "not-a-date" }),
    candidate("missing-updated", { updatedAt: undefined }),
    candidate("valid-updated", { updatedAt: "2020-01-01T00:00:00.000Z" }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("valid-updated");
});

test("uses the newest valid created time when updated times are equal", () => {
  const threads = [
    candidate("older-created", {
      createdAt: "2026-08-03T10:00:00.000Z",
    }),
    candidate("newer-created", {
      createdAt: "2026-08-03T11:00:00.000Z",
    }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("newer-created");
});

test("uses a valid created time when both updated times are invalid", () => {
  const threads = [
    candidate("older-created", {
      updatedAt: "invalid-one",
      createdAt: "2026-08-03T10:00:00.000Z",
    }),
    candidate("newer-created", {
      updatedAt: "invalid-two",
      createdAt: "2026-08-03T11:00:00.000Z",
    }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("newer-created");
});

test("ranks a valid created time before invalid and missing created times", () => {
  const threads = [
    candidate("invalid-created", {
      updatedAt: null,
      createdAt: "not-a-date",
    }),
    candidate("missing-created", {
      updatedAt: null,
      createdAt: undefined,
    }),
    candidate("valid-created", {
      updatedAt: null,
      createdAt: "2020-01-01T00:00:00.000Z",
    }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("valid-created");
});

test("treats equal updated instants with different timezone spellings as a tie", () => {
  const threads = [
    candidate("older-created", {
      updatedAt: "2026-08-03T12:00:00.000Z",
      createdAt: "2026-08-03T10:00:00.000Z",
    }),
    candidate("newer-created", {
      updatedAt: "2026-08-03T08:00:00.000-04:00",
      createdAt: "2026-08-03T11:00:00.000Z",
    }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("newer-created");
});

test("uses code-unit ascending ID after equal updated and created times", () => {
  const threads = [candidate("a"), candidate("Z")];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("Z");
});

test("uses code-unit ascending ID when all dates are invalid", () => {
  const threads = [
    candidate("z-last", { updatedAt: "bad", createdAt: null }),
    candidate("A-first", { updatedAt: null, createdAt: "also-bad" }),
  ];

  const selected = selectVisibleRealThreadId({
    threads,
    selectedThreadId: null,
  });

  expect(selected).toBe("A-first");
});

test("does not mutate a frozen candidate array or its frozen rows", () => {
  const newer = Object.freeze(
    candidate("newer", { updatedAt: "2026-08-03T14:00:00.000Z" }),
  );
  const older = Object.freeze(
    candidate("older", { updatedAt: "2026-08-03T10:00:00.000Z" }),
  );
  const threads = Object.freeze([older, newer]);
  const input = Object.freeze({ threads, selectedThreadId: null });
  const originalRows = threads.map((thread) => ({ ...thread }));

  const selected = selectVisibleRealThreadId(input);

  expect(selected).toBe("newer");
  expect(threads).toEqual([older, newer]);
  expect(threads.map((thread) => ({ ...thread }))).toEqual(originalRows);
});
