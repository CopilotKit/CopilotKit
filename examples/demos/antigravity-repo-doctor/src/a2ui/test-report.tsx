"use client";

import { useState } from "react";
import { CircleCheck, CircleX, FileCode2 } from "lucide-react";
import { StatusPill, TestBar } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { FailedTestData, FileResultData } from "./definitions";

// The binder resolves `{ path }` bindings before render; these narrow the
// literal-or-binding prop types to the resolved values.
export const num = (value: unknown): number =>
  typeof value === "number" ? value : 0;
export const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
export const list = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const VISIBLE_FAILURES = 4;
const VISIBLE_FILES = 4;

export interface TestReportProps {
  run: number;
  status: "passed" | "failed" | "error";
  headline: string;
  command: string;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  durationSeconds: number;
  files: FileResultData[];
  failures: FailedTestData[];
  summary: string;
}

/** The live report card for one test run, painted from an A2UI surface. */
export function TestReport(props: TestReportProps) {
  const [showAll, setShowAll] = useState(false);
  const broken = props.failed + props.errors;
  const failingFiles = props.files.filter((f) => f.failed > 0);
  const passingFiles = props.files.filter((f) => f.failed === 0);
  const failures = showAll
    ? props.failures
    : props.failures.slice(0, VISIBLE_FAILURES);
  const counted = props.passed + broken + props.skipped > 0;
  // Runners whose output could not be parsed into files or failures.
  const showOutput =
    props.summary !== "" &&
    props.files.length === 0 &&
    props.status !== "passed";

  return (
    <section
      className="card enter w-full overflow-hidden"
      data-chat-block="card"
      data-testid="test-report"
      data-status={props.status}
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <StatusPill status={props.status} />
          <span className="text-[15px] text-dim">Test run {props.run}</span>
        </div>
        <span className="font-mono text-[14px] text-faint">
          {props.command} · {props.durationSeconds.toFixed(1)}s
        </span>
      </header>

      <div className="px-4 pt-2.5 pb-3.5">
        <p
          className="text-[18px] font-semibold tracking-tight"
          data-testid="test-report-headline"
        >
          {props.headline}
        </p>
        {counted && (
          <TestBar passed={props.passed} failed={broken} className="mt-3" />
        )}
        {counted && (
          <p className="mt-2 flex gap-3 text-[15px] text-dim tabular-nums">
            <span>
              <span className="text-pass">{props.passed}</span> passed
            </span>
            {broken > 0 && (
              <span>
                <span className="text-fail">{broken}</span> failed
              </span>
            )}
            {props.skipped > 0 && <span>{props.skipped} skipped</span>}
          </p>
        )}
      </div>

      {showOutput && (
        <div className="border-t border-line px-4 py-3">
          <p className="eyebrow mb-2">Runner output</p>
          <pre className="wrap-code scroll-thin max-h-56 overflow-y-auto rounded-lg border border-line bg-bg/70 px-3 py-2 font-mono text-[14px] leading-relaxed text-dim">
            {props.summary}
          </pre>
        </div>
      )}

      {props.files.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="eyebrow mb-2">Files</p>
          <ul className="space-y-1">
            {failingFiles.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
            {(failingFiles.length === 0
              ? passingFiles.slice(0, VISIBLE_FILES)
              : []
            ).map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          {passingFiles.length > 0 && (
            <p className="mt-1.5 text-[15px] text-faint">
              {failingFiles.length > 0
                ? `${passingFiles.length} other files pass`
                : passingFiles.length > VISIBLE_FILES
                  ? `and ${passingFiles.length - VISIBLE_FILES} more files`
                  : null}
            </p>
          )}
        </div>
      )}

      {props.failures.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="eyebrow mb-2">Failures</p>
          <ul className="space-y-2">
            {failures.map((failure) => (
              <li key={failure.id} className="flex gap-2">
                <CircleX
                  className="mt-[3px] size-4 flex-none text-fail"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p
                    className="truncate font-mono text-[15px] text-text/90"
                    title={failure.id}
                  >
                    {failure.id.split("::").slice(1).join(" › ") || failure.id}
                  </p>
                  {failure.message && (
                    <p className="mt-0.5 line-clamp-2 font-mono text-[14px] leading-relaxed text-fail/85">
                      {failure.message}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {props.failures.length > VISIBLE_FAILURES && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-[15px] text-dim hover:text-text"
            >
              {showAll
                ? "Show fewer"
                : `Show ${props.failures.length - VISIBLE_FAILURES} more`}
            </button>
          )}
        </div>
      )}

      {props.status === "passed" && (
        <div className="flex items-center gap-2 border-t border-line bg-pass/[0.04] px-4 py-2.5 text-[15px] text-pass">
          <CircleCheck className="size-4" aria-hidden />
          {counted
            ? "Every test passes on this run."
            : "The test command finished without errors."}
        </div>
      )}
    </section>
  );
}

function FileRow({ file }: { file: FileResultData }) {
  const total = file.passed + file.failed;
  return (
    <li className="flex items-center gap-2.5 text-[15.5px]">
      <FileCode2 className="size-4 flex-none text-faint" aria-hidden />
      <span
        className="min-w-0 flex-1 truncate font-mono text-[15px] text-text/85"
        title={file.path}
      >
        {file.path}
      </span>
      <span
        className={cn(
          "tabular-nums",
          file.failed > 0 ? "text-fail" : "text-faint",
        )}
      >
        {file.failed > 0 ? `${file.failed} of ${total} fail` : `${total} pass`}
      </span>
    </li>
  );
}
