"use client";

import { Fragment } from "react";
import type { DiffHunk } from "@/lib/diff";
import { useHighlightedHunks } from "@/lib/highlight";
import { cn } from "@/lib/cn";

const ROW: Record<"context" | "add" | "del", string> = {
  context: "",
  add: "bg-[var(--rd-add-bg)]",
  del: "bg-[var(--rd-del-bg)]",
};
const GUTTER: Record<"context" | "add" | "del", string> = {
  context: "text-faint/70",
  add: "bg-[var(--rd-add-gutter)] text-pass/80",
  del: "bg-[var(--rd-del-gutter)] text-fail/80",
};
const SIGN: Record<"context" | "add" | "del", string> = {
  context: " ",
  add: "+",
  del: "-",
};

/**
 * A unified diff with old and new line numbers and syntax colors. Long lines
 * wrap at spaces (a single token longer than the line breaks anywhere), so
 * nothing is hidden past the card's edge.
 */
export function DiffView({
  hunks,
  lang,
  className,
}: {
  hunks: DiffHunk[];
  lang: string | null;
  className?: string;
}) {
  const tokens = useHighlightedHunks(hunks, lang);

  return (
    <div
      className={cn(
        "scroll-thin font-mono text-[15px] leading-[24px]",
        className,
      )}
    >
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[52px]" />
          <col className="w-[52px]" />
          <col />
        </colgroup>
        <tbody>
          {hunks.map((hunk, h) => (
            <Fragment key={h}>
              {(h > 0 || hunk.header) && (
                <tr className="bg-tint-1 text-faint">
                  <td
                    colSpan={2}
                    className="select-none px-2 text-right text-[14px]"
                  >
                    ⋯
                  </td>
                  <td className="px-3 text-[14px]">{hunk.header}</td>
                </tr>
              )}
              {hunk.lines.map((line, i) => (
                <tr key={i} className={ROW[line.kind]}>
                  <td
                    className={cn(
                      "select-none px-2 align-top text-right tabular-nums",
                      GUTTER[line.kind],
                    )}
                  >
                    {line.oldNo ?? ""}
                  </td>
                  <td
                    className={cn(
                      "select-none pr-2 align-top text-right tabular-nums",
                      GUTTER[line.kind],
                    )}
                  >
                    {line.newNo ?? ""}
                  </td>
                  <td className="pr-4 pl-1">
                    <div className="flex">
                      <span
                        className={cn(
                          "w-4 flex-none select-none",
                          line.kind === "add"
                            ? "text-pass"
                            : line.kind === "del"
                              ? "text-fail"
                              : "",
                        )}
                      >
                        {SIGN[line.kind]}
                      </span>
                      <span className="wrap-code min-w-0 flex-1">
                        {tokens?.[h]?.[i] ? (
                          tokens[h]![i]!.map((token, t) => (
                            <span key={t} style={{ color: token.color }}>
                              {token.content}
                            </span>
                          ))
                        ) : (
                          <span className="text-text/85">{line.text}</span>
                        )}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
