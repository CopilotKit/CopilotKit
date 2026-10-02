import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const frontendToolSample = readme.match(
  /### Frontend Tool[\s\S]*?```tsx\n([\s\S]*?)\n```/,
)?.[1];

describe("README frontend tool sample", () => {
  it("uses shared validation and form-update helpers", () => {
    expect(frontendToolSample).toBeDefined();
    expect(frontendToolSample).toContain(
      'import { applyIncidentReportFormValues } from "@/lib/apply-incident-report-form-values";',
    );
    expect(frontendToolSample).toContain(
      'import { fillIncidentReportFormParameters } from "@/lib/incident-report-tool";',
    );
    expect(frontendToolSample).toContain("isIncidentDateAllowed,");
    expect(frontendToolSample).toContain('from "@/lib/incident-date";');
    expect(frontendToolSample).toContain(
      "parameters: fillIncidentReportFormParameters,",
    );
    expect(frontendToolSample).toContain(
      "!incidentDate || !isIncidentDateAllowed(incidentDate)",
    );
    expect(frontendToolSample).toContain("from January 1, 1900 through today");
    expect(frontendToolSample).toContain(
      "applyIncidentReportFormValues(form.setValue, {",
    );
    expect(frontendToolSample).not.toContain("form.setValue(");
    expect(frontendToolSample).not.toContain("parameters: z.object(");
  });
});
