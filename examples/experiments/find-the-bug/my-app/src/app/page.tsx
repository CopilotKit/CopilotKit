"use client";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import Head from "next/head";
import { useState } from "react";

export default function Home() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <Head>
        <title>CopilotKit - Find the Bug - hard mode</title>
      </Head>
      <div>
        <TestNavigation />
      </div>
      <CopilotSidebar defaultOpen={true} clickOutsideToClose={false} />
    </CopilotKit>
  );
}

function TestNavigation() {
  const [path, setPath] = useState<string>("");
  useCopilotAction({
    name: "navigate",
    description: "Navigate to a path",
    parameters: [{ name: "path", type: "string" }],
    handler: async ({ path }) => {
      setPath(path);
    },
  });
  if (path === "") {
    return <div>Test Navigation (no path)</div>;
  } else {
    return <Path path={path} />;
  }
}

function Path({ path }: { path: string }) {
  useCopilotAction({
    name: "alertPath",
    description: "Show the current path to the user by alerting it.",
    handler: () => {
      alert(path);
    },
  });

  return <div>Path: {path}</div>;
}
