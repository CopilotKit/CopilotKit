import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SetupWizardProps } from "@/components/setup-wizard";

const setupWizardSpy = vi.hoisted(() =>
  vi.fn((_props: SetupWizardProps) => null),
);

vi.mock("@/components/setup-wizard", () => ({
  SetupWizard: setupWizardSpy,
}));

import { DocsSetupWizard } from "../docs-setup-wizard";
import {
  agentPicks,
  frontendPicks,
  COPILOTKIT_CAPABILITIES,
} from "@/lib/homepage-map";

describe("DocsSetupWizard", () => {
  it("hands the wizard exactly the lib's own frontends, capabilities and backends", () => {
    renderToStaticMarkup(<DocsSetupWizard />);

    expect(setupWizardSpy).toHaveBeenCalledTimes(1);
    const props = setupWizardSpy.mock.calls[0][0];

    expect(props.frontends).toEqual(frontendPicks());
    expect(props.capabilities).toEqual(COPILOTKIT_CAPABILITIES);
    expect(props.backends).toEqual(agentPicks());
  });

  it("puts frontends and backends in the slots the wizard expects, not swapped", () => {
    renderToStaticMarkup(<DocsSetupWizard />);

    const props = setupWizardSpy.mock.calls[0][0];
    const frontends = frontendPicks();
    const backends = agentPicks();

    // A distinctive id from each list, asserted against its own slot — a
    // test that only compared lengths would still pass if the two props
    // were swapped.
    expect(props.frontends.some((pick) => pick.id === frontends[0]!.id)).toBe(
      true,
    );
    expect(props.backends.some((pick) => pick.id === backends[0]!.id)).toBe(
      true,
    );
    expect(props.frontends.some((pick) => pick.id === backends[0]!.id)).toBe(
      false,
    );
  });

  it('carries no "use client" directive', () => {
    const source = readFileSync(
      new URL("../docs-setup-wizard.tsx", import.meta.url),
      "utf8",
    );

    // A directive, not just the phrase: it must open the file (only
    // comments/blank lines may precede it) as its own quoted statement.
    // A plain substring check would also trip on this file's own prose
    // explaining that it deliberately has no such directive.
    const directive = /^\s*(?:\/\/[^\n]*\n|\s*\n)*["']use client["'];?/;
    expect(directive.test(source)).toBe(false);
  });
});
