import { describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import { z as z3 } from "zod";
import { registerA2UICatalogContext } from "../A2UICatalogContext";
import type { CopilotKitCoreVue } from "../../../lib/vue-core";

/**
 * A schema shaped like Zod v4, without adding a second copy of Zod to the
 * workspace — an aliased `zod@4` devDependency re-resolves the `zod` peer of
 * unrelated packages across the whole monorepo.
 *
 * Faithful in the two respects this conversion depends on: v4 renamed
 * `_def.typeName` to `_def.type`, which is the lookup `zodToJsonSchema` uses to
 * recognise a schema, and v4 implements Standard JSON Schema V1. Passing this to
 * `zodToJsonSchema` returns a bare `{ $schema }` — no `properties`, no
 * `required`, and no error — exactly as a real v4 schema does.
 */
function zodV4Like() {
  return {
    _def: { type: "object" },
    "~standard": {
      version: 1,
      vendor: "zod",
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => ({
          type: "object",
          properties: {
            filingId: { type: "string" },
            status: { type: "string" },
            risk: { type: "string" },
          },
          required: ["filingId", "status", "risk"],
        }),
      },
    },
  };
}

/**
 * An application may build its A2UI catalog with Zod v4 while this package pins
 * Zod v3. `zodToJsonSchema` understands v3 internals only and returns a bare
 * `{ $schema }` for a v4 schema — no `properties`, no error — which silently
 * strips every prop from the catalog schema the model is shown.
 */
interface RegisteredContext {
  description: string;
  value: string;
}

function collectRegisteredContext(catalog: unknown): RegisteredContext[] {
  const registered: RegisteredContext[] = [];
  const core = {
    a2uiAgents: undefined,
    addContext: (entry: RegisteredContext) => {
      registered.push(entry);
      return `ctx-${registered.length}`;
    },
    removeContext: () => {},
  };

  registerA2UICatalogContext(
    shallowRef(core) as unknown as ReturnType<
      typeof shallowRef<CopilotKitCoreVue>
    >,
    {
      enabled: () => true,
      catalog: () => catalog as never,
      includeSchema: () => true,
    },
  );

  return registered;
}

function filingCardSchemaFor(catalog: unknown) {
  const schemaEntry = collectRegisteredContext(catalog).find((entry) =>
    entry.description.startsWith("A2UI Component Schema"),
  );
  expect(schemaEntry, "schema context was never registered").toBeDefined();

  const parsed = JSON.parse(schemaEntry!.value) as {
    components: Record<
      string,
      {
        allOf: Array<{
          properties?: Record<string, unknown>;
          required?: string[];
        }>;
      }
    >;
  };
  return parsed.components.FilingCard.allOf[1];
}

const makeCatalog = (schema: unknown) => ({
  id: "filing-tracker-catalog",
  components: new Map([["FilingCard", { schema, render: () => null }]]),
});

describe("registerA2UICatalogContext", () => {
  const expectedProps = ["component", "filingId", "status", "risk"];

  it("keeps a Zod v3 component's props in the emitted catalog schema", () => {
    const shape = filingCardSchemaFor(
      makeCatalog(
        z3.object({
          filingId: z3.string(),
          status: z3.string(),
          risk: z3.string(),
        }),
      ),
    );

    expect(Object.keys(shape.properties ?? {})).toEqual(expectedProps);
    expect(shape.required).toEqual(expectedProps);
  });

  it("keeps a Zod v4 component's props in the emitted catalog schema", () => {
    const shape = filingCardSchemaFor(makeCatalog(zodV4Like()));

    // Without the conversion fix this is `["component"]` alone — the model is
    // told the component exists but takes no props at all.
    expect(Object.keys(shape.properties ?? {})).toEqual(expectedProps);
    expect(shape.required).toEqual(expectedProps);
  });
});
