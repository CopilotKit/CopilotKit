"use client";

import { createGenerativeUI } from "@copilotkit/react-core/generative-ui";
import { definitions } from "./definitions";
import { TestReport } from "./test-report";

/** Must match CATALOG_ID in agent/src/repo_doctor/a2ui.py. */
export const CATALOG_ID = "https://repo-doctor.dev/a2ui/catalog/v1";

/**
 * The UI the provider gets (`generativeUI={{ ui: catalog }}`). Generative UI
 * resolves the surface's `{ path }` bindings and checks them against the
 * schema, so `TestReport` gets its props as plain values.
 */
export const catalog = createGenerativeUI({
  id: CATALOG_ID,
  components: {
    TestReport: {
      component: TestReport,
      ...definitions.TestReport,
    },
  },
});
