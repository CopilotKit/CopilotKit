import { useInterrupt } from "@copilotkit/react-core/v2";
import type { Interrupt } from "@ag-ui/client";
import { useState } from "react";
import { AGENT_ID } from "../lib/agent";
import { DESK_APPS, appIcon } from "../lib/apps";

/** The call ADK paused for the reader's yes, from ag-ui-adk's interrupt. */
interface PausedCall {
  name: string;
  args: Record<string, unknown>;
}

function pausedCall(interrupt: Interrupt | null): PausedCall | null {
  const metadata = interrupt?.metadata as
    | { adk?: { originalFunctionCall?: Partial<PausedCall> } }
    | undefined;
  const call = metadata?.adk?.originalFunctionCall;
  if (!call?.name) return null;
  return { name: call.name, args: call.args ?? {} };
}

/** What each action does, said as the button would say it. */
const ACTION_TITLES: Record<string, string> = {
  GMAIL_SEND_EMAIL: "Send this email",
  GMAIL_REPLY_TO_THREAD: "Send this reply",
  GOOGLECALENDAR_CREATE_EVENT: "Add this event",
  GOOGLECALENDAR_PATCH_EVENT: "Change this event",
  GOOGLECALENDAR_DELETE_EVENT: "Delete this event",
  GOOGLEDRIVE_CREATE_FILE_FROM_TEXT: "Create this file in Drive",
  GOOGLEDRIVE_CREATE_FOLDER: "Create this folder in Drive",
  GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN: "Create this doc",
  GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN: "Change this doc",
  GOOGLESHEETS_CREATE_GOOGLE_SHEET1: "Create this spreadsheet",
  GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND: "Add these rows",
  GOOGLESHEETS_VALUES_UPDATE: "Change these cells",
};

function appOf(toolName: string) {
  const prefix = toolName.split("_")[0].toLowerCase();
  return DESK_APPS.find((app) => app.id === prefix);
}

const label = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

function show(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object")) {
    return value.join(", ");
  }
  return JSON.stringify(value, null, 2);
}

function ConfirmationCard({
  call,
  onAnswer,
}: {
  call: PausedCall;
  onAnswer: (confirmed: boolean) => Promise<unknown>;
}) {
  const [answering, setAnswering] = useState<boolean | null>(null);
  const app = appOf(call.name);
  const fields = Object.entries(call.args).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const answer = (confirmed: boolean) => {
    setAnswering(confirmed);
    void onAnswer(confirmed);
  };

  return (
    <section className="confirm" aria-labelledby="confirm-title">
      <header className="confirm__head">
        {app && (
          <img
            src={appIcon(app)}
            alt=""
            width={18}
            height={18}
            className="confirm__icon"
          />
        )}
        <h2 id="confirm-title">
          {ACTION_TITLES[call.name] ?? `Run ${call.name}`}
        </h2>
        {app && <span className="confirm__app">{app.name}</span>}
      </header>
      <dl className="confirm__fields">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt>{label(key)}</dt>
            <dd>{show(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="confirm__actions">
        <button
          type="button"
          className="confirm__button confirm__button--quiet"
          disabled={answering !== null}
          onClick={() => answer(false)}
        >
          {answering === false ? "Cancelling…" : "Don't do it"}
        </button>
        <button
          type="button"
          className="confirm__button"
          disabled={answering !== null}
          onClick={() => answer(true)}
        >
          {answering === true ? "Working…" : "Confirm"}
        </button>
      </div>
    </section>
  );
}

/**
 * When the agent is about to act in the reader's apps, ADK pauses the run
 * and ag-ui-adk sends the paused call as an AG-UI interrupt. This shows the
 * reader exactly what will happen and resumes the run with their answer.
 */
export function useActionConfirmation() {
  useInterrupt({
    agentId: AGENT_ID,
    enabled: (event) =>
      (event.value as Interrupt | undefined)?.reason === "confirmation",
    render: ({ interrupt, resolve }) => {
      const call = pausedCall(interrupt);
      if (!call) return <></>;
      return (
        <ConfirmationCard
          call={call}
          onAnswer={(confirmed) => resolve({ confirmed })}
        />
      );
    },
  });
}
