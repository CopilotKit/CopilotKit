/**
 * Regression cases for the composer's repair pass (model drift seen in real runs).
 *   pnpm dlx tsx --tsconfig tsconfig.json scripts/test-repair.ts
 */
import assert from "node:assert/strict";
import { repairComponent } from "../src/agent/repair";

const fix = (c: Record<string, unknown>) =>
  repairComponent(c as { id: string; component: string }).component as Record<
    string,
    unknown
  >;

assert.equal(
  fix({ id: "h", component: "Heading", text: "Hi", level: 2 }).level,
  "2",
  "number for enum string",
);
assert.equal(
  fix({ id: "h", component: "Heading", title: "Hi" }).text,
  "Hi",
  "alias title -> text",
);
assert.equal(
  fix({ id: "s", component: "Stat", label: "x", value: 3, trend: "UP" }).trend,
  "up",
  "enum case",
);
assert.ok(
  !(
    "tone" in
    fix({ id: "s", component: "Stat", label: "x", value: 3, tone: "nope" })
  ),
  "drop invalid optional",
);
assert.deepEqual(
  fix({
    id: "b",
    component: "BarChart",
    data: [{ x: "a", y: "4" }, { x: "b" }],
  }).data,
  [{ x: "a", y: 4 }],
  "coerce + drop bad row",
);
assert.deepEqual(
  fix({
    id: "k",
    component: "SankeyChart",
    links: {
      nodes: ["a"],
      links: [{ source: "a", target: "b", value: "$1,600" }],
    },
  }).links,
  [{ source: "a", target: "b", value: 1600 }],
  "unwrap object to array",
);
assert.deepEqual(
  fix({
    id: "c",
    component: "Combobox",
    label: "City",
    options: [],
    value: { "@path": "/form/city" },
  }).value,
  { "@path": "/form/city" },
  "1.0 bindings untouched",
);
assert.deepEqual(
  fix({
    id: "c",
    component: "Combobox",
    label: "City",
    options: [],
    value: { path: "/form/city" },
  }).value,
  { "@path": "/form/city" },
  "v0.9 binding upgraded",
);
assert.deepEqual(
  fix({
    id: "s",
    component: "Stat",
    label: "Total",
    value: {
      "@call": "formatCurrency",
      args: { value: 1200, currency: "USD" },
    },
  }).value,
  { "@call": "formatCurrency", args: { value: 1200, currency: "USD" } },
  "function call untouched",
);
const card = fix({
  id: "p",
  component: "EventCard",
  title: "Launch",
  date: "Oct 30",
  action: { event: { name: "rsvp" } },
});
assert.deepEqual(
  [card.onAction, "action" in card],
  [{ event: { name: "rsvp" } }, false],
  "v0.9 action -> onAction",
);
console.log("repair: all cases pass");
import { stripDashes } from "../src/agent/repair";
assert.equal(
  stripDashes("Fast — and cheap"),
  "Fast, and cheap",
  "em dash removed",
);
console.log("stripDashes: ok");
assert.equal(
  stripDashes("Route logic \u{1F5FA}️ here"),
  "Route logic here",
  "emoji removed",
);
console.log("emoji: ok");
