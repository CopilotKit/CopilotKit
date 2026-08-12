import React, { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotContext } from "../../../context/copilot-context";
import { useCopilotReadable } from "../../../hooks/use-copilot-readable";
import { useCopilotKit } from "../../../v2";
import { CopilotKit, defaultCopilotContextCategories } from "../copilotkit";

const userProfile = { name: "Ada" };

function ReadableContextProbe({
  onContext,
}: {
  onContext: (value: string) => void;
}) {
  useCopilotReadable({
    description: "User profile",
    value: userProfile,
  });

  const { getContextString } = useCopilotContext();

  useEffect(() => {
    onContext(getContextString([], defaultCopilotContextCategories));
  }, [getContextString, onContext]);

  return null;
}

function ScopedContextProbe({
  onContext,
}: {
  onContext: (value: string) => void;
}) {
  const { copilotkit } = useCopilotKit();
  const { getContextString } = useCopilotContext();

  useEffect(() => {
    const contextId = copilotkit.addContext({
      description: "Other agent secret",
      value: "classified",
      agentIds: ["other-agent"],
    });
    return () => copilotkit.removeContext(contextId);
  }, [copilotkit]);

  useEffect(() => {
    onContext(getContextString([], defaultCopilotContextCategories));
  }, [getContextString, onContext]);

  return null;
}

describe("v1 CopilotTask readable context bridge", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes useCopilotReadable entries in the context string", async () => {
    let contextString = "";

    render(
      <CopilotKit publicApiKey="test-key">
        <ReadableContextProbe
          onContext={(nextContext) => {
            contextString = nextContext;
          }}
        />
      </CopilotKit>,
    );

    await waitFor(() => {
      expect(contextString).toContain('User profile:\n{"name":"Ada"}');
    });
  });

  it("excludes context scoped to another agent", async () => {
    let contextString: string | undefined;

    render(
      <CopilotKit publicApiKey="test-key">
        <ScopedContextProbe
          onContext={(nextContext) => {
            contextString = nextContext;
          }}
        />
      </CopilotKit>,
    );

    await waitFor(() => {
      expect(contextString).toBeDefined();
      expect(contextString ?? "").not.toContain("Other agent secret");
    });
  });
});
