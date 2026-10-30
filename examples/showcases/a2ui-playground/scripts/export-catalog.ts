/**
 * Writes the playground's catalog as A2UI v1.0 catalog documents, with
 * CopilotKit's own `exportA2UICatalog`:
 *
 *  - `src/a2ui/export/catalog.json` (served at /catalog.json): what the client
 *    renders. Framework-agnostic: renderers outside React implement it.
 *  - `src/a2ui/export/inference-catalog.json`: what a model reads. The same
 *    components with the standard ones' styling props trimmed, plus the
 *    macros, which the server expands before anything reaches the client. The
 *    agent's Express compiler and the skill generator read this one.
 *
 *   pnpm catalog:export     (runs before `dev` and `build`)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createGenerativeUI,
  exportA2UICatalog,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import type { ComponentType } from "react";
import type { z } from "zod";
import { definitions } from "../src/a2ui/catalog/definitions";
import { ownEntries } from "../src/a2ui/catalog/entries";
import { CATALOG_ID } from "../src/a2ui/catalog/ids";
import {
  CATALOG_DESCRIPTION,
  CATALOG_TITLE,
  catalogInstructions,
} from "../src/a2ui/catalog/instructions";
import { firstSentence, STYLE_PROPS } from "../src/a2ui/catalog/prompt-trim";
import { MACROS } from "../src/a2ui/macros/macros";

type Schema = Record<string, unknown>;
type Entries = Record<
  string,
  { component: ComponentType<never>; props: z.ZodObject<z.ZodRawShape> }
>;
const Stub: ComponentType = () => null;

const headless = createGenerativeUI({
  id: CATALOG_ID,
  extends: [standardUI],
  components: ownEntries(() => Stub) as unknown as Entries,
});
const options = {
  title: CATALOG_TITLE,
  description: CATALOG_DESCRIPTION,
  instructions: catalogInstructions(),
};
const catalog = exportA2UICatalog(headless, options);

// Macros are described like components, so they export the same way.
const macroUI = createGenerativeUI({
  id: `${CATALOG_ID}/macros`,
  components: Object.fromEntries(
    MACROS.map((m) => [
      m.name,
      {
        component: Stub,
        description: m.description,
        props: m.props,
        ...(m.events ? { events: m.events } : {}),
      },
    ]),
  ) as unknown as Entries,
});
const macroComponents = exportA2UICatalog(macroUI).components as Record<
  string,
  Schema
>;

const own = new Set(Object.keys(definitions));
const trimmed = Object.fromEntries(
  Object.entries(catalog.components as Record<string, Schema>).map(
    ([name, schema]) => {
      if (own.has(name)) return [name, schema];
      const required = new Set((schema.required as string[]) ?? []);
      const properties = Object.fromEntries(
        Object.entries(schema.properties as Record<string, Schema>).filter(
          ([k]) => required.has(k) || !STYLE_PROPS.has(k),
        ),
      );
      const description =
        typeof schema.description === "string"
          ? firstSentence(schema.description)
          : undefined;
      return [
        name,
        { ...schema, ...(description ? { description } : {}), properties },
      ];
    },
  ),
);
for (const name of Object.keys(macroComponents)) {
  if (trimmed[name])
    throw new Error(`Macro ${name} has the name of a catalog component`);
}
const inferenceComponents = { ...trimmed, ...macroComponents };
const inference = {
  ...catalog,
  components: inferenceComponents,
  $defs: {
    ...catalog.$defs,
    anyComponent: {
      oneOf: Object.keys(inferenceComponents).map((n) => ({
        $ref: `#/components/${n}`,
      })),
      discriminator: { propertyName: "component" },
    },
  },
};

const dir = join(__dirname, "../src/a2ui/export");
mkdirSync(dir, { recursive: true });
const write = (file: string, value: unknown) => {
  const out = join(dir, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(value, null, 1)}\n`);
  return out.replace(`${process.cwd()}/`, "");
};
console.log(
  `catalog: ${Object.keys(catalog.components).length} components, ${Object.keys(catalog.functions).length} functions -> ${write("catalog.json", catalog)}`,
);
console.log(
  `inference catalog: + ${Object.keys(macroComponents).length} macros -> ${write("inference-catalog.json", inference)}`,
);
