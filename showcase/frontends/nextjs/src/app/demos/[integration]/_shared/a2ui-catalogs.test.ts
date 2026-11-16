import { describe, expect, it } from "vitest";
import { definitions as fixedSchemaDefinitions } from "../a2ui-fixed-schema/a2ui/definitions";
import { demonstrationCatalogDefinitions } from "../beautiful-chat/declarative-generative-ui/definitions";
import { myDefinitions as salesDashboardDefinitions } from "./a2ui-sales-dashboard/definitions";

// The A2UI binder in @copilotkit/a2ui-renderer walks each component's props
// schema through zod 3 internals (`_def.typeName`) to find data bindings,
// template children and actions. A zod 4 schema has no `_def.typeName`, so
// every catalog in the app must build its props with zod 3.
const catalogs = {
  "a2ui-fixed-schema": fixedSchemaDefinitions,
  "beautiful-chat": demonstrationCatalogDefinitions,
  "a2ui-sales-dashboard": salesDashboardDefinitions,
};

describe("A2UI catalog definitions", () => {
  it.each(Object.entries(catalogs))(
    "%s builds every props schema with zod 3",
    (_, catalog) => {
      const typeNames = Object.entries(catalog).map(([name, component]) => [
        name,
        component.props._def.typeName,
      ]);

      for (const [name, typeName] of typeNames) {
        expect(typeName, name).toBe("ZodObject");
      }
    },
  );
});
