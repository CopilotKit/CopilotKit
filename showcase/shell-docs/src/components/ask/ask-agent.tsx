"use client";

import { useCallback } from "react";
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
import { StackAgent, useToolStatus } from "@/components/ai/docs-agent";
import {
  FRAMEWORKS,
  FRONTENDS,
  frameworkById,
  type FrontendId,
} from "@/proto/data";
import { useFrontend } from "@/proto/frontend";
import { useLastFramework } from "@/proto/last-framework";
import { useQuickstartSetup } from "./quickstart-setup";

/**
 * What the full-page chat gives the agent: the reader's stack (the frontend
 * chips and the framework the docs remember) with a tool to switch it, the
 * same status lines as the docs' chat, the quickstart's setup questions,
 * and the welcome's suggestions. Three of them write a guide; "Build your
 * quickstart" asks about the reader's setup first.
 */
export function AskAgent() {
  const { frontend, setFrontend } = useFrontend();
  const [framework, setFramework] = useLastFramework();

  const onSwitch = useCallback(
    (nextFrontend: string, nextFramework: string) => {
      setFrontend(nextFrontend as FrontendId);
      setFramework(nextFramework);
      const name = frameworkById(nextFramework)?.name ?? nextFramework;
      return `Switched the reader's stack to ${name} on ${nextFrontend}.`;
    },
    [setFrontend, setFramework],
  );

  useToolStatus();
  useQuickstartSetup();

  useConfigureSuggestions(
    {
      available: "before-first-message",
      suggestions: [
        {
          title: "Build your quickstart",
          message: "Build my quickstart.",
        },
        {
          title: "Add generative UI",
          message: "Show me how to add generative UI to my app.",
        },
        {
          title: "Add human approval",
          message: "Show me how to add a human approval step to my app.",
        },
        {
          title: "How AG-UI works",
          message: "How does AG-UI connect my app to my agent? Keep it short.",
        },
      ],
    },
    [],
  );

  return (
    <StackAgent
      frontend={frontend}
      agentFramework={framework}
      frontends={FRONTENDS}
      frameworks={FRAMEWORKS}
      onSwitch={onSwitch}
    />
  );
}
