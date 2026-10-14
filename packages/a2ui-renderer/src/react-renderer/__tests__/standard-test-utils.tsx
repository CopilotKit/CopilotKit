import React, { useEffect } from "react";
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { OnActionCallback } from "../types";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";
import {
  standardCatalog,
  STANDARD_CATALOG_ID,
} from "../a2ui-react/catalog/standard";

export const STANDARD_TEST_SURFACE_ID = "s";

function Surface({ ops }: { ops: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(ops as Array<Record<string, unknown>>);
  }, [processMessages, ops]);
  return <A2UIRenderer surfaceId={STANDARD_TEST_SURFACE_ID} />;
}

/**
 * Render a surface with the standard catalog. Components are the
 * `updateComponents.components` list; `data` (optional) is written to "/".
 */
export function renderStandard(
  components: unknown[],
  data?: Record<string, unknown>,
  onAction?: OnActionCallback,
): RenderResult {
  const surfaceId = STANDARD_TEST_SURFACE_ID;
  const ops: unknown[] = [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: STANDARD_CATALOG_ID },
    },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
  if (data) {
    ops.push({
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: data },
    });
  }
  return render(
    <A2UIProvider catalog={standardCatalog} onAction={onAction}>
      <Surface ops={ops} />
    </A2UIProvider>,
  );
}
