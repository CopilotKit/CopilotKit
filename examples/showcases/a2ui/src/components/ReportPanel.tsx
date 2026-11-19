import { GenerativeUISurface } from "@copilotkit/react-core/v2/generative-ui";
import { Braces, FileText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deskUI } from "../lib/generative-ui";
import { useArrivalCascade } from "../lib/use-arrival-cascade";
import { useTargetSurface } from "../lib/use-surfaces";
import { A2UISource } from "./A2UISource";

export const REPORT_TARGET = "report";

/** Tells the agent where the report sheet is and what goes in it. */
const REPORT_DESCRIPTION =
  "The report sheet, beside the chat. Write here when the reader asks for a report, a briefing, a write-up, or a document they can keep: " +
  'a Title (size "lg") and a one-line Caption with the date and scope, then short sections, each a Title (size "sm") over a Markdown block of a few paragraphs, ' +
  "with the one chart or table that carries the evidence and pictures from find_images where they help, and the sources at the end. " +
  "Write symbols and units as plain text (Q, CO2e, °C), never LaTeX. One component per line, top to bottom: the reader watches it render as you write. Answer in the chat in one or two sentences that point to the report.";

/**
 * The report artifact: a sheet beside the chat that the agent writes a
 * longer document into, line by line, while the chat keeps the conversation.
 * The target is always mounted, so the agent always knows it can write
 * here; the sheet opens when a report starts and folds away when closed.
 */
export function ReportPanel() {
  const surface = useTargetSurface(REPORT_TARGET);
  const writing = surface?.status === "streaming";
  // The report the reader closed; a new or updated report opens again.
  const [closed, setClosed] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  useArrivalCascade(page, writing);
  useEffect(() => {
    if (writing) setClosed(null);
  }, [writing]);

  const open = !!surface && closed !== surface.key;

  return (
    <>
      <aside
        className="report"
        data-open={open || undefined}
        data-writing={writing || undefined}
        aria-label="Report"
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="report__frame">
          <header className="report__bar">
            <span className="report__label">
              <FileText size={15} strokeWidth={2} aria-hidden />
              Report
              {writing && <span className="report__writing">Writing</span>}
            </span>
            <span className="report__actions">
              <button
                type="button"
                className="report__source-toggle"
                aria-pressed={showSource}
                onClick={() => setShowSource((value) => !value)}
              >
                <Braces size={13} strokeWidth={2} aria-hidden />
                A2UI
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Close the report"
                onClick={() => surface && setClosed(surface.key)}
              >
                <X size={16} aria-hidden />
              </button>
            </span>
          </header>
          <div className="report__scroll">
            {showSource && surface ? (
              <div className="report__plate">
                <A2UISource value={surface.operations} />
              </div>
            ) : null}
            <div ref={page} className="report__page" hidden={showSource}>
              <GenerativeUISurface
                id={REPORT_TARGET}
                ui={deskUI}
                autoScroll={false}
                className="report__surface"
                description={REPORT_DESCRIPTION}
              />
            </div>
          </div>
        </div>
      </aside>
      {surface && !open && (
        <button
          type="button"
          className="report__reopen"
          onClick={() => setClosed(null)}
        >
          <FileText size={15} strokeWidth={2} aria-hidden />
          Report
        </button>
      )}
    </>
  );
}
