"use client";

import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { CatalogView } from "./catalog-view";

export default function CatalogPage() {
  return <CatalogView ui={standardUI} basePath="" />;
}
