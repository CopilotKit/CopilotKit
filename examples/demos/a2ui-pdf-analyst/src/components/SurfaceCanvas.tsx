"use client";

import { useEffect, useRef, useState } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { useAgent } from "@copilotkit/react-core/v2";
import { catalog } from "@/a2ui/catalog";
import { surfaceBus } from "@/a2ui/surface-bus";

/* The big workspace pane. A page-level A2UIProvider subscribes to the
 * surface bus so any surface produced by chat renders here at canvas size.
 *
 * Critically, the provider's `onAction` callback forwards every chip / button
 * click in a rendered surface back to the agent as
 *   forwardedProps.a2uiAction.userAction = { name, surfaceId, context, ... }
 * The A2UI middleware on the backend sees this on the next run and injects
 * a `log_a2ui_event` tool result so the agent's reasoning step can react. */
export function SurfaceCanvas({
  channel,
  emptyState,
}: {
  channel: string;
  emptyState: React.ReactNode;
}) {
  const { agent } = useAgent({ agentId: channel });

  return (
    <A2UIProvider
      catalog={catalog}
      onAction={(message) => {
        console.log(
          `[surface-canvas] chip dispatch channel=${channel}`,
          message,
        );
        // `message` shape: { userAction: { name, surfaceId, context, ... } }
        // 1. Add a visible user message so the chat reflects the click .
        //    otherwise the action travels silently via forwardedProps and
        //    the user sees the agent respond without context.
        // 2. Run the agent with the action carried in forwardedProps so the
        //    A2UI middleware can inject the log_a2ui_event tool result.
        const ua = message?.userAction;
        const labelHint = readContextLabel(ua?.context);
        if (ua?.name) {
          agent.addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: humanizeAction(ua.name, labelHint),
          });
        }
        void agent
          .runAgent({
            forwardedProps: { a2uiAction: message },
          })
          .then(() =>
            console.log(`[surface-canvas] runAgent resolved for ${channel}`),
          )
          .catch((err) => {
            console.warn("[surface-canvas] runAgent failed", err);
          });
      }}
    >
      <CanvasInner channel={channel} emptyState={emptyState} />
    </A2UIProvider>
  );
}

function CanvasInner({
  channel,
  emptyState,
}: {
  channel: string;
  emptyState: React.ReactNode;
}) {
  const actions = useA2UIActions();
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const seenRef = useRef(0);
  const createdSurfacesRef = useRef<Set<string>>(new Set());

  /* The MessageProcessor THROWS on duplicate createSurface. Each agent call
   * to render_dashboard emits a fresh createSurface + updateComponents +
   * updateDataModel batch. the second batch's createSurface would crash
   * the batch and the data update never lands. Track which surfaceIds
   * we've already created and strip duplicate createSurface ops. */
  function applyOps(
    ops: typeof seenRef extends never ? never : Array<Record<string, unknown>>,
  ) {
    if (!ops.length) return;
    const out = ops.filter((op) => {
      const cs = op.createSurface as { surfaceId?: string } | undefined;
      if (cs?.surfaceId) {
        if (createdSurfacesRef.current.has(cs.surfaceId)) {
          console.log(
            `[surface-canvas] skip duplicate createSurface(${cs.surfaceId})`,
          );
          return false;
        }
        createdSurfacesRef.current.add(cs.surfaceId);
      }
      return true;
    });
    console.log(
      `[surface-canvas] processMessages channel=${channel} ` +
        `(${out.length} ops after dedupe, ${ops.length} raw)`,
    );
    try {
      actions.processMessages(out);
    } catch (err) {
      console.warn("[surface-canvas] processMessages threw:", err);
    }
  }

  useEffect(() => {
    const initial = surfaceBus.snapshot(channel);
    if (initial.ops.length) {
      applyOps(initial.ops as never);
      seenRef.current = initial.ops.length;
      setSurfaceId(initial.surfaceId);
    }
    return surfaceBus.subscribe(channel, (snap) => {
      const tail = snap.ops.slice(seenRef.current);
      console.log(
        `[surface-canvas] bus notify channel=${channel} ` +
          `(snap=${snap.ops.length} seen=${seenRef.current} tail=${tail.length} ` +
          `surfaceId=${snap.surfaceId ?? "null"})`,
      );
      if (tail.length) applyOps(tail as never);
      seenRef.current = snap.ops.length;
      if (snap.surfaceId) setSurfaceId(snap.surfaceId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, channel]);

  if (!surfaceId) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8">
        <A2UIRenderer surfaceId={surfaceId} />
      </div>
    </div>
  );
}

function readContextLabel(ctx: unknown): string | undefined {
  if (!ctx || typeof ctx !== "object") return undefined;
  const c = ctx as Record<string, unknown>;
  const v = c.value ?? c.label;
  return typeof v === "string" ? v : undefined;
}

function humanizeAction(name: string, hint?: string): string {
  if (name === "select_chip" && hint) return `Switch scope → ${prettify(hint)}`;
  if (hint) return `${prettify(name)} → ${prettify(hint)}`;
  return prettify(name);
}

function prettify(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

export function CanvasEmptyState({
  title,
  subtitle,
  hint,
}: {
  title: string;
  subtitle: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="max-w-md text-center flex flex-col items-center gap-3">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "var(--brand-gradient)", opacity: 0.85 }}
        aria-hidden
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0a0a0b"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight text-[var(--ink)]">
        {title}
      </h2>
      <p className="text-[14px] text-[var(--ink)] leading-relaxed">
        {subtitle}
      </p>
      {hint && <div className="mt-2">{hint}</div>}
    </div>
  );
}
