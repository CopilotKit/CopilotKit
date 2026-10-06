// Print an AIMock journal's A2UI turn order: time, status, advertised tools,
// message count, forwarded headers and the fixture that matched.
// usage: node adk-journal-a2ui.mjs <journal.json>
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const e of j) {
  const tools = (e.body?.tools ?? []).map((t) => t.function?.name ?? t.name);
  const n = (e.body?.messages ?? []).length;
  const h = e.headers ?? {};
  console.log(
    new Date(e.timestamp).toISOString().slice(11, 23),
    e.response?.status,
    `tools=[${tools.join(",")}]`,
    `msgs=${n}${n === 0 ? " (body not journaled)" : ""}`,
    `ctx=${h["x-aimock-context"]} strict=${h["x-aimock-strict"]} test-id=${h["x-test-id"] ? "yes" : "no"}`,
    `match=${JSON.stringify(e.response?.fixture?.match)}`,
  );
}
