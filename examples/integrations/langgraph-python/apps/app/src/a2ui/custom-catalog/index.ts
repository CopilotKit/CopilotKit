import { Catalog } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/react/v0_9";
import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { ReactStarRating } from "./ReactStarRating";

export const CUSTOM_CATALOG_ID =
  "https://a2ui.org/demos/dojo/custom_catalog.json";

export const customCatalog = new Catalog<ReactComponentImplementation>(
  CUSTOM_CATALOG_ID,
  [...Array.from(basicCatalog.components.values()), ReactStarRating],
  Array.from(basicCatalog.functions.values()),
);
