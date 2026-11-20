"use client";

import { useRef, useState } from "react";
import type { ComponentType } from "react";
import { clsx } from "clsx";
import {
  ChartColumnIncreasing,
  ChevronLeft,
  ChevronRight,
  Languages,
  LayoutDashboard,
  Minimize2,
  Moon,
  Sun,
} from "lucide-react";
import { GenerativeUISurface } from "@copilotkit/react-core/v2/generative-ui";
import { CANVAS_DESCRIPTION, CANVAS_ID, QUICK_PROMPTS } from "@/lib/canvas";
import { pathById } from "@/lib/models";
import { useCanvasVersions } from "@/lib/use-canvas-versions";
import { useChangeHighlight } from "@/lib/use-change-highlight";
import { useModel } from "@/lib/use-model";
import { useSendPrompt } from "@/lib/use-send-prompt";
import { StoredVersion } from "./stored-version";

/**
 * The right side of the page: the live A2UI surface the agent draws into,
 * version arrows to step through earlier versions, and quick actions.
 */
export function Canvas() {
  const { surface, versions, viewing, setViewing, streaming, repairing } =
    useCanvasVersions();
  const { send, running } = useSendPrompt();
  const { path } = useModel();
  const [dark, setDark] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  const total = versions.length;
  const current = viewing ?? total - 1;
  const busy = running || streaming || repairing;
  const hasCanvas = Boolean(surface);
  const stored = viewing === null ? undefined : versions[viewing];

  const show = (index: number) => setViewing(index >= total - 1 ? null : index);

  // Outline what each edit changes, once there is a canvas to edit.
  useChangeHighlight(sheet, total > 0 && viewing === null);

  const status = repairing
    ? "Fixing part of the canvas…"
    : busy
      ? total > 0
        ? "Updating the canvas…"
        : "Drawing the canvas…"
      : "Canvas";

  return (
    <section className={clsx("canvas", dark && "dark")} aria-label="Canvas">
      <header className="canvas-bar">
        <div className="canvas-status" data-state={busy ? "busy" : "idle"}>
          <span className="canvas-status-dot" aria-hidden />
          <span aria-live="polite">{status}</span>
          <span className="canvas-path" title={pathById(path).note}>
            {path === "express" ? "Express" : "Antigravity"}
          </span>
        </div>
        {total > 0 && (
          <div className="canvas-versions" aria-label="Versions">
            <button
              type="button"
              aria-label="Previous version"
              disabled={busy || current <= 0}
              onClick={() => show(current - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              v{current + 1} of {total}
            </span>
            <button
              type="button"
              aria-label="Next version"
              disabled={busy || current >= total - 1}
              onClick={() => show(current + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="canvas-scroll">
        {stored && viewing !== null && (
          <div className="canvas-sheet canvas-sheet-old" inert>
            <StoredVersion version={stored} index={viewing} />
          </div>
        )}
        {/* Stays mounted while an older version is on screen: unmounting it
            would take the "canvas" target away from the agent. */}
        <div
          ref={sheet}
          className="canvas-sheet"
          data-busy={busy || undefined}
          hidden={Boolean(stored) || !hasCanvas}
        >
          {/* No auto-scroll: the surface fills this pane, and scrolling it
              into view on every render pushed the sheet's top (and often
              the title) up under the bar. */}
          <GenerativeUISurface
            id={CANVAS_ID}
            description={CANVAS_DESCRIPTION}
            autoScroll={false}
          />
        </div>
        {!hasCanvas && (busy ? <CanvasSkeleton /> : <EmptyCanvas />)}
      </div>

      {stored && (
        <div className="canvas-banner" role="status">
          You are looking at v{current + 1}.
          <button type="button" onClick={() => setViewing(null)}>
            Back to the latest
          </button>
        </div>
      )}

      <div className="canvas-actions" aria-label="Quick actions">
        <QuickAction
          icon={Minimize2}
          label="Compact"
          disabled={!hasCanvas || busy}
          onClick={() => send(QUICK_PROMPTS.compact)}
        />
        <QuickAction
          icon={ChartColumnIncreasing}
          label="Add chart"
          disabled={!hasCanvas || busy}
          onClick={() => send(QUICK_PROMPTS.chart)}
        />
        <QuickAction
          icon={dark ? Sun : Moon}
          label={dark ? "Light" : "Dark"}
          pressed={dark}
          onClick={() => setDark((value) => !value)}
        />
        <QuickAction
          icon={Languages}
          label="Translate"
          disabled={!hasCanvas || busy}
          onClick={() => send(QUICK_PROMPTS.translate)}
        />
      </div>
    </section>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className="canvas-action"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

/** The shape of a dashboard, shimmering, until the first piece arrives. */
function CanvasSkeleton() {
  return (
    <div className="canvas-sheet canvas-skeleton" aria-hidden>
      <div className="sk sk-title" />
      <div className="sk sk-caption" />
      <div className="sk-row">
        <div className="sk sk-tile" />
        <div className="sk sk-tile" />
        <div className="sk sk-tile" />
      </div>
      <div className="sk sk-chart" />
      <div className="sk-row">
        <div className="sk sk-card" />
        <div className="sk sk-card" />
      </div>
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="canvas-empty">
      <div className="canvas-empty-icon" aria-hidden>
        <LayoutDashboard size={22} />
      </div>
      <p className="canvas-empty-title">Your canvas is empty</p>
      <p className="canvas-empty-text">
        Pick a starter prompt, or describe a dashboard, form or report. The
        agent builds it here with A2UI, and you can keep changing it.
      </p>
    </div>
  );
}
