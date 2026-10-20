import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { prefersReducedMotion } from "@/lib/wizard-scroll";

export type WizardStep = {
  readonly n: number;
  readonly label: string;
};

type ProgressProps = {
  steps: readonly WizardStep[];
  current: number;
  furthest: number;
  summaries: Readonly<Record<number, string>>;
  onJump: (step: number, pointerActivated: boolean) => void;
};

function ProgressControls({
  activeIndex,
  steps,
  furthest,
  onJump,
  mobile = false,
  placement = "bottom",
}: Pick<ProgressProps, "steps" | "furthest" | "onJump"> & {
  activeIndex: number;
  mobile?: boolean;
  placement?: "top" | "bottom";
}): React.JSX.Element {
  return (
    <div
      className={`wizard-rail-progress-footer wizard-rail-progress-footer--${mobile ? `mobile wizard-rail-progress-footer--${placement}` : "desktop"}`}
      role={mobile ? "navigation" : undefined}
      aria-label={
        mobile
          ? `${steps[activeIndex].label}, step ${activeIndex + 1} of ${steps.length}`
          : undefined
      }
    >
      <span>
        <span className="wizard-rail-progress-count">
          Step {activeIndex + 1} of {steps.length}
        </span>
        {mobile ? (
          <span className="wizard-rail-progress-title">
            {steps[activeIndex].label}
          </span>
        ) : null}
      </span>
      <span className="wizard-rail-progress-track" aria-hidden="true">
        <span
          style={{
            transform: `scaleX(${(activeIndex + 1) / steps.length})`,
          }}
        />
      </span>
      <div className="wizard-rail-arrows">
        <button
          type="button"
          aria-label="Previous step"
          disabled={activeIndex === 0}
          onClick={(event) =>
            onJump(steps[activeIndex - 1].n, event.detail > 0)
          }
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <button
          type="button"
          aria-label="Next visited step"
          disabled={
            activeIndex === steps.length - 1 ||
            steps[activeIndex + 1].n > furthest
          }
          onClick={(event) =>
            onJump(steps[activeIndex + 1].n, event.detail > 0)
          }
        >
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}

export function WizardRail({
  steps,
  current,
  furthest,
  summaries,
  selectedSteps,
  onJump,
  children,
}: ProgressProps & {
  selectedSteps: ReadonlySet<number>;
  children: React.ReactNode;
}): React.JSX.Element {
  const listRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = React.useRef(false);
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.n === current),
  );

  React.useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLButtonElement>(
      '[aria-current="step"]',
    );
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;

    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const left =
      list.scrollLeft +
      activeRect.left -
      listRect.left +
      activeRect.width / 2 -
      list.clientWidth / 2;
    list.scrollTo({
      left: Math.max(0, left),
      behavior: prefersReducedMotion() ? "instant" : "smooth",
    });
  }, [current]);

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="wizard-rail-layout">
      <nav className="wizard-rail-progress" aria-label="Setup steps">
        <div className="wizard-rail-progress-heading">Your setup</div>
        <div
          ref={listRef}
          className="wizard-rail-list-wrap"
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse" || event.button !== 0) return;
            suppressClickRef.current = false;
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startScrollLeft: event.currentTarget.scrollLeft,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const distance = event.clientX - drag.startX;
            if (!drag.moved && Math.abs(distance) < 5) return;
            if (!drag.moved) {
              drag.moved = true;
              suppressClickRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            event.preventDefault();
            event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
          }}
        >
          <span
            className="wizard-rail-active-marker"
            aria-hidden="true"
            style={{ transform: `translateY(${activeIndex * 4}rem)` }}
          />
          <ol>
            {steps.map((step, index) => {
              const reached = step.n <= furthest;
              const active = current === step.n;
              const selected = selectedSteps.has(step.n);
              return (
                <li key={step.n}>
                  <button
                    type="button"
                    disabled={!reached}
                    aria-current={active ? "step" : undefined}
                    data-selected={selected || undefined}
                    onClick={(event) => onJump(step.n, event.detail > 0)}
                  >
                    <span className="wizard-rail-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="wizard-rail-step-copy">
                      <span className="wizard-rail-step-label">
                        {step.label}
                      </span>
                      {selected && summaries[step.n] ? (
                        <span className="wizard-rail-step-summary">
                          {summaries[step.n]}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <ProgressControls
          activeIndex={activeIndex}
          steps={steps}
          furthest={furthest}
          onJump={onJump}
        />
      </nav>
      <ProgressControls
        activeIndex={activeIndex}
        steps={steps}
        furthest={furthest}
        onJump={onJump}
        mobile
        placement="top"
      />
      <div
        className="wizard-rail-stage"
        data-wizard-current-step=""
        data-wizard-step={current}
      >
        {children}
      </div>
      <span
        className="wizard-rail-progress-track wizard-rail-progress-track--mobile-edge"
        aria-hidden="true"
      >
        <span
          style={{ transform: `scaleX(${(activeIndex + 1) / steps.length})` }}
        />
      </span>
      <ProgressControls
        activeIndex={activeIndex}
        steps={steps}
        furthest={furthest}
        onJump={onJump}
        mobile
      />
    </div>
  );
}
