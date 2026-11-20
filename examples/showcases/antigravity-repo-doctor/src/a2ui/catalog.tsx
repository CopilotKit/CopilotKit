"use client";

import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import { definitions } from "./definitions";
import type {
  Definitions,
  FailedTestData,
  FileResultData,
} from "./definitions";
import { TestReport, list, num, str } from "./test-report";

/** Must match CATALOG_ID in agent/src/repo_doctor/a2ui.py. */
export const CATALOG_ID = "https://repo-doctor.dev/a2ui/catalog/v1";

const renderers: CatalogRenderers<Definitions> = {
  TestReport: ({ props }) => {
    const status = str(props.status);
    return (
      <TestReport
        run={num(props.run)}
        status={status === "passed" || status === "error" ? status : "failed"}
        headline={str(props.headline)}
        command={str(props.command)}
        passed={num(props.passed)}
        failed={num(props.failed)}
        errors={num(props.errors)}
        skipped={num(props.skipped)}
        durationSeconds={num(props.durationSeconds)}
        files={list<FileResultData>(props.files)}
        failures={list<FailedTestData>(props.failures)}
        summary={str(props.summary)}
      />
    );
  },
};

export const catalog = createCatalog(definitions, renderers, {
  catalogId: CATALOG_ID,
  includeBasicCatalog: false,
});
