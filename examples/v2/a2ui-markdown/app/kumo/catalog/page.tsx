"use client";

import { CatalogView } from "../../catalog/catalog-view";
import { KUMO_COVERAGE } from "../../../kumo/coverage";
import { kumoTheme } from "../../../kumo/theme";
import { kumoUI } from "../../../kumo/ui";

export default function KumoCatalogPage() {
  return (
    <CatalogView
      ui={kumoUI}
      theme={kumoTheme}
      coverage={KUMO_COVERAGE}
      basePath="/kumo"
    />
  );
}
