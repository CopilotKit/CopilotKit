// Note: this file uses the `.bench.tsx` extension and is NOT picked up by the
// vitest `include` glob (`**/*.{test,spec}.{ts,tsx}`). It is a manual-only
// benchmark — run with `npx vitest bench` directly. It documents the
// post-fix baseline but provides no CI regression protection.
import { bench, describe } from "vitest";

// Realistic message shape — only id matters for the dedup map, but content adds
// weight to reflect real-world object sizes.
function makeMsgs(n: number) {
  const roles = ["user", "assistant"] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `msg-${i}`,
    role: roles[i % 2],
    content: `Message content for index ${i}. `.repeat(3),
  }));
}

const messages100 = makeMsgs(100);
const messages1000 = makeMsgs(1000);

// These benchmarks document the post-fix baseline for the deduplication path in
// CopilotChatMessageView. Before fix #2 the Map was reconstructed on every render;
// after fix #2 it is guarded by useMemo([messages]).
describe("CopilotChatMessageView deduplication", () => {
  bench("dedup map — 100 messages", () => {
    void [...new Map(messages100.map((m) => [m.id, m])).values()];
  });

  bench("dedup map — 1000 messages", () => {
    void [...new Map(messages1000.map((m) => [m.id, m])).values()];
  });
});
