import { describe, expect, it } from "vitest";

import {
  MAX_REGION_LINES,
  OVERSIZE_REGION_BASELINE,
  findOversizeRegions,
  findWorkspaceOnlyImportRegions,
  regionBodyKey,
} from "../demo-region-guard.js";
import type { RegionBodySource } from "../demo-region-guard.js";

function region(over: Partial<RegionBodySource> = {}): RegionBodySource {
  return {
    demoKey: "mastra::a2ui-fixed-schema",
    regionName: "backend-render-operations",
    file: "src/mastra/tools/a2ui-generate.ts",
    code: "export const generateA2uiTool = createTool({});",
    ...over,
  };
}

describe("findWorkspaceOnlyImportRegions", () => {
  it("flags the OSS-901 import that only resolves through tsconfig paths", () => {
    const findings = findWorkspaceOnlyImportRegions([
      region({
        code: [
          "import { createTool } from '@mastra/core/tools';",
          "import { generateA2uiImpl } from '@copilotkit/showcase-shared-tools';",
        ].join("\n"),
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain("@copilotkit/showcase-shared-tools");
  });

  it("passes a body whose imports are all installable or file-local", () => {
    expect(
      findWorkspaceOnlyImportRegions([
        region({
          code: [
            "import { createTool } from '@mastra/core/tools';",
            "import { generateText } from 'ai';",
            "import { readForwardedA2uiContext } from './a2ui-context';",
          ].join("\n"),
        }),
      ]),
    ).toEqual([]);
  });

  it("catches any showcase-only alias, not just the shared-tools one", () => {
    expect(
      findWorkspaceOnlyImportRegions([
        region({ code: "import x from '@copilotkit/showcase-frontend';" }),
      ]),
    ).toHaveLength(1);
  });

  it("does not mistake a published package for a workspace alias", () => {
    expect(
      findWorkspaceOnlyImportRegions([
        region({
          code: "import { CopilotKit } from '@copilotkit/react-core';",
        }),
      ]),
    ).toEqual([]);
  });
});

describe("findOversizeRegions", () => {
  const oversizeCode = Array.from(
    { length: MAX_REGION_LINES + 1 },
    (_, i) => `const line${i} = ${i};`,
  ).join("\n");

  it("flags a region that publishes more than the limit", () => {
    const findings = findOversizeRegions([region({ code: oversizeCode })]);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain(`${MAX_REGION_LINES + 1} lines`);
  });

  it("passes a region exactly at the limit", () => {
    const atLimit = Array.from(
      { length: MAX_REGION_LINES },
      (_, i) => `const line${i} = ${i};`,
    ).join("\n");

    expect(findOversizeRegions([region({ code: atLimit })])).toEqual([]);
  });

  it("exempts a baselined region so known debt does not block the build", () => {
    expect(
      findOversizeRegions([
        region({
          demoKey: "strands::subagents",
          regionName: "supervisor-delegation-tools",
          file: "src/agents/agent.py",
          code: oversizeCode,
        }),
      ]),
    ).toEqual([]);
  });

  it("still flags a baselined region name when a different file grows", () => {
    const findings = findOversizeRegions([
      region({
        demoKey: "strands::subagents",
        regionName: "supervisor-delegation-tools",
        file: "src/agents/some_new_module.py",
        code: oversizeCode,
      }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it("keys the baseline by integration slug, not by demo", () => {
    // The same backend file feeds every demo of an integration, so an entry
    // written for one demo must cover the rest.
    expect(
      OVERSIZE_REGION_BASELINE.has(
        regionBodyKey(
          "strands",
          "supervisor-delegation-tools",
          "src/agents/agent.py",
        ),
      ),
    ).toBe(true);
  });

  it("does not baseline the regions this change fixed", () => {
    for (const key of [
      regionBodyKey(
        "mastra",
        "backend-render-operations",
        "src/mastra/tools/index.ts",
      ),
      regionBodyKey(
        "mastra",
        "backend-render-operations",
        "src/mastra/tools/a2ui-generate.ts",
      ),
      regionBodyKey(
        "strands",
        "backend-render-operations",
        "src/agents/agent.py",
      ),
      regionBodyKey(
        "strands",
        "backend-render-operations",
        "src/agents/a2ui_generate.py",
      ),
      regionBodyKey(
        "mastra",
        "weather-tool-backend",
        "src/mastra/tools/index.ts",
      ),
    ]) {
      expect(OVERSIZE_REGION_BASELINE.has(key)).toBe(false);
    }
  });
});
