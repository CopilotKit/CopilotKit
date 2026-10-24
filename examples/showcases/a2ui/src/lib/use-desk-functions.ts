import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useGenerativeUIFunction } from "@copilotkit/react-core/v2/generative-ui";
import { AGENT_ID } from "./agent";
import { useDesk } from "./desk-store";
import { deskUI } from "./generative-ui";

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function toCsv(rows: Record<string, string | number | boolean | null>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.map(cell).join(","),
    ...rows.map((row) => columns.map((c) => cell(row[c])).join(",")),
  ].join("\n");
}

/**
 * The handlers behind the buttons the agent generates. Each name matches a
 * function declared in `deskUI`; a generated Button reaches one through
 * `{"functionCall": {"@call": "<name>", "args": {...}}}` in its onClick.
 */
export function useDeskFunctions() {
  const { addNote, announce } = useDesk();
  const { agent } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();

  useGenerativeUIFunction(deskUI, "saveNote", ({ title, text, sourceUrl }) => {
    addNote({
      title,
      text,
      sourceUrl: sourceUrl && isWebUrl(sourceUrl) ? sourceUrl : undefined,
    });
    announce(`Saved “${title}” to notes`);
    return { saved: true };
  });

  useGenerativeUIFunction(deskUI, "openSource", ({ url }) => {
    if (!isWebUrl(url)) {
      announce("That source has no web address to open");
      return { opened: false };
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return { opened: true };
  });

  useGenerativeUIFunction(deskUI, "copyText", async ({ text, label }) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      announce("The clipboard is not available here");
      return { copied: false };
    }
    announce(label ? `Copied ${label}` : "Copied to the clipboard");
    return { copied: true };
  });

  useGenerativeUIFunction(deskUI, "exportCsv", ({ filename, rows }) => {
    if (!rows.length) {
      announce("There is no data to export");
      return { exported: false };
    }
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href,
      download: `${
        filename.replace(/\.csv$/i, "").replace(/[^\w.-]+/g, "-") || "research"
      }.csv`,
    });
    link.click();
    // Some browsers start the download after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    announce(`Downloaded ${link.download}`);
    return { exported: true, rows: rows.length };
  });

  useGenerativeUIFunction(deskUI, "askFollowUp", async ({ question }) => {
    if (agent.isRunning) {
      announce("Wait for this answer to finish, then ask again");
      return { asked: false };
    }
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    });
    await copilotkit.runAgent({ agent });
    return { asked: true };
  });
}
