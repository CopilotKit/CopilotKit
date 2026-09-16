"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Terminal } from "lucide-react";

const COMMAND = "npx copilotkit@latest create";

export function PartnerCliSetup({
  project,
  quickstartHref,
}: {
  project: string | null;
  quickstartHref: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <details className="partner-cli">
      <summary>
        <Terminal size={18} aria-hidden="true" /> Prefer the CLI?
      </summary>
      <p>
        {project === "yes"
          ? "Create a separate starter app to explore the integration."
          : "Create a starter app from your terminal. The CLI will walk you through the available frameworks."}
      </p>
      <div className="partner-cli-command">
        <code>{COMMAND}</code>
        <button
          type="button"
          aria-label={copied ? "Command copied" : "Copy CLI command"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(COMMAND);
              setCopied(true);
              setFailed(false);
            } catch {
              setFailed(true);
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      {failed && (
        <p role="status">
          Copy blocked. Select the command above and copy it manually.
        </p>
      )}
      {project === "yes" && (
        <Link href={quickstartHref}>
          Follow the guide to add CopilotKit to your existing app →
        </Link>
      )}
    </details>
  );
}
