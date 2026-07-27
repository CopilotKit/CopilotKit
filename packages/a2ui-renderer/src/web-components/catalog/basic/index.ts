import { Catalog } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import type { LitComponentImplementation } from "../../types";
import { basicComponents } from "./components";

export * from "./components";
export {
  getBaseContainerStyle,
  getBaseLeafStyle,
  LEAF_MARGIN,
  mapAlign,
  mapJustify,
  STANDARD_BORDER,
  STANDARD_RADIUS,
} from "./utils";

export const basicCatalog = new Catalog<LitComponentImplementation>(
  "https://a2ui.org/specification/v0_9/basic_catalog.json",
  basicComponents,
  BASIC_FUNCTIONS,
);

export const fullCatalog = basicCatalog;
