import { Catalog, createFunctionImplementation } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import type { LitComponentImplementation } from "../../types";
import { minimalComponents } from "./components";

export * from "./components";

export const minimalCatalog = new Catalog<LitComponentImplementation>(
  "https://a2ui.org/specification/v0_9/catalogs/minimal/minimal_catalog.json",
  minimalComponents,
  [
    createFunctionImplementation(
      {
        name: "capitalize",
        returnType: "string",
        schema: z.object({
          value: z.unknown(),
        }),
      },
      (args) => {
        const val = args.value;
        if (typeof val === "string") {
          return val.toUpperCase();
        }
        return val as string;
      },
    ),
  ],
);
