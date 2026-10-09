"use client";

/**
 * One recorded generative UI step, drawn with Ledgerline's real component,
 * inside the trajectory view (which embeds this page in an iframe per step).
 *
 * Read-only by construction:
 *  - the card sits in an `inert` subtree, so nothing in it can be clicked,
 *    focused or typed into;
 *  - the page's `fetch` refuses every `/api/` call without leaving the page,
 *    so a replay can never validate, close or approve anything.
 *
 * The page reports its height to the trajectory view so the frame fits the card.
 */
import { useEffect, useLayoutEffect } from "react";
// The Ledgerline skin's token block (`.theme-ledgerline`), as the app loads it.
import "@/skins/ledgerline/theme.css";
import { GENUI } from "./registry";
import { ChatGptWidget } from "./chatgpt-widget";

let patched = false;

function refuseWrites() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (!path.startsWith("/api/")) return real(input, init);
    return Response.json(
      {
        error: "READ_ONLY",
        message: "A recorded trajectory is read-only. Nothing was sent.",
      },
      { status: 403 },
    );
  };
}

function useReportHeight(id: string) {
  useEffect(() => {
    const post = () =>
      window.parent.postMessage(
        {
          type: "ledgerline-genui-height",
          id,
          height: Math.ceil(
            document.getElementById("genui-root")?.getBoundingClientRect()
              .height ?? document.body.scrollHeight,
          ),
        },
        window.location.origin,
      );
    post();
    const observer = new ResizeObserver(post);
    const root = document.getElementById("genui-root");
    if (root) observer.observe(root);
    const t = window.setTimeout(post, 400);
    return () => {
      observer.disconnect();
      window.clearTimeout(t);
    };
  }, [id]);
}

export function GenUiView(props: {
  readonly frameId: string;
  readonly component: string;
  readonly props: Record<string, unknown>;
  readonly widgetHtml?: string | null;
}) {
  // Layout effects run before any card's passive effect, so no card can reach
  // the API before it is refused.
  useLayoutEffect(() => {
    refuseWrites();
    document.documentElement.classList.add("theme-ledgerline");
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);
  useReportHeight(props.frameId);
  const render = GENUI[props.component];
  return (
    // `data-copilotkit`: the chat surface's own scope (font, chat tokens), so a
    // card here reads exactly as it does in Ledgerline's chat column.
    <div
      id="genui-root"
      data-copilotkit=""
      className="theme-ledgerline text-ink"
      style={{ padding: "1px 2px 10px 1px", background: "transparent" }}
    >
      {props.component === "LedgerlineAppWidget" ? (
        <ChatGptWidget
          html={props.widgetHtml ?? null}
          tool={String(props.props.tool ?? "")}
          structuredContent={
            props.props.structuredContent as Record<string, unknown>
          }
        />
      ) : render ? (
        <div inert>{render(props.props)}</div>
      ) : null}
    </div>
  );
}
