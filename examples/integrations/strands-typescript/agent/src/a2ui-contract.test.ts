import assert from "node:assert/strict";
import test from "node:test";

import {
  buildA2uiOperations,
  DYNAMIC_A2UI_COMPONENT_NAMES,
  DYNAMIC_A2UI_SYSTEM_PROMPT,
  parseRenderA2uiArguments,
  RENDER_A2UI_TOOL,
} from "./a2ui-contract.js";

test("requires the renderer wire contract in the model tool schema", () => {
  const itemSchema =
    RENDER_A2UI_TOOL.function.parameters.properties.components.items;

  assert.deepEqual(itemSchema.required, ["id", "component"]);
  assert.deepEqual(
    itemSchema.properties.component.enum,
    DYNAMIC_A2UI_COMPONENT_NAMES,
  );
  assert.match(DYNAMIC_A2UI_SYSTEM_PROMPT, /DashboardCard/);
  assert.doesNotMatch(
    DYNAMIC_A2UI_SYSTEM_PROMPT,
    /StatusBadge|InfoRow|PrimaryButton/,
  );
});

test("builds create-surface before update-components for a valid surface", () => {
  const args = parseRenderA2uiArguments(
    JSON.stringify({
      surfaceId: "sales-dashboard",
      components: [
        { id: "root", component: "Column", children: ["revenue"] },
        {
          id: "revenue",
          component: "Metric",
          label: "Revenue",
          value: "$1.2M",
        },
      ],
    }),
  );

  const operations = buildA2uiOperations(args);
  assert.ok("createSurface" in operations[0]);
  assert.ok("updateComponents" in operations[1]);
});

test("rejects malformed components before renderer operations are built", () => {
  assert.throws(
    () =>
      parseRenderA2uiArguments(
        JSON.stringify({
          surfaceId: "sales-dashboard",
          components: [{ id: "root", type: "Column" }],
        }),
      ),
    /Invalid A2UI generation contract: components\.0\.component/,
  );

  assert.throws(
    () =>
      parseRenderA2uiArguments(
        JSON.stringify({
          surfaceId: "sales-dashboard",
          components: [
            { id: "root", component: "Column" },
            { id: "root", component: "Metric" },
          ],
        }),
      ),
    /exactly one component with id "root"/,
  );

  assert.throws(
    () =>
      parseRenderA2uiArguments(
        JSON.stringify({
          surfaceId: "sales-dashboard",
          components: [{ id: "root", component: "StatusBadge" }],
        }),
      ),
    /Invalid option/,
  );
});
