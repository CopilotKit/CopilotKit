import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/**
 * Presentational loading placeholder shown while an A2UI tool call is still
 * streaming. Renders an animated skeleton card whose rows reveal as the
 * estimated token count climbs through `phase`.
 */
@Component({
  selector: "copilot-a2ui-progress",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="copilot-a2ui-progress"
      data-testid="a2ui-progress"
      role="status"
      aria-live="polite"
    >
      <div class="copilot-a2ui-progress-card">
        <div class="copilot-a2ui-topbar">
          <div class="copilot-a2ui-dot-group">
            <span class="copilot-a2ui-dot"></span>
            <span class="copilot-a2ui-dot"></span>
            <span class="copilot-a2ui-dot"></span>
          </div>
          <span [class]="topbarBarClass()"></span>
        </div>

        <div class="copilot-a2ui-lines">
          <div [class]="rowClass(0, 'cpk:[transition-delay:0s]')">
            <span
              class="copilot-a2ui-bar cpk:w-[36px] cpk:h-[7px] cpk:bg-[rgba(147,197,253,0.7)] cpk:[animation-delay:0s]"
            ></span>
            <span
              class="copilot-a2ui-bar cpk:w-20 cpk:h-[7px] cpk:bg-[rgba(219,234,254,0.8)] cpk:[animation-delay:0.2s]"
            ></span>
          </div>

          <div [class]="rowClass(0, 'cpk:[transition-delay:0.1s]')">
            <span class="copilot-a2ui-spacer"></span>
            <span class="copilot-a2ui-dot"></span>
            <span
              class="copilot-a2ui-bar cpk:w-[100px] cpk:h-[7px] cpk:bg-[rgba(24,24,27,0.2)] cpk:[animation-delay:0.3s]"
            ></span>
          </div>

          <div [class]="rowClass(1, 'cpk:[transition-delay:0.15s]')">
            <span class="copilot-a2ui-spacer"></span>
            <span
              class="copilot-a2ui-bar cpk:w-12 cpk:h-[7px] cpk:bg-[rgba(24,24,27,0.15)] cpk:[animation-delay:0.1s]"
            ></span>
            <span
              class="copilot-a2ui-bar cpk:w-10 cpk:h-[7px] cpk:bg-[rgba(153,246,228,0.6)] cpk:[animation-delay:0.5s]"
            ></span>
            <span
              class="copilot-a2ui-bar cpk:w-14 cpk:h-[7px] cpk:bg-[rgba(147,197,253,0.6)] cpk:[animation-delay:0.3s]"
            ></span>
          </div>

          <div [class]="rowClass(1, 'cpk:[transition-delay:0.2s]')">
            <span class="copilot-a2ui-spacer"></span>
            <span class="copilot-a2ui-dot"></span>
            <span
              class="copilot-a2ui-bar cpk:w-[60px] cpk:h-[7px] cpk:bg-[rgba(24,24,27,0.15)] cpk:[animation-delay:0.4s]"
            ></span>
          </div>

          <div [class]="rowClass(2, 'cpk:[transition-delay:0.25s]')">
            <span
              class="copilot-a2ui-bar cpk:w-10 cpk:h-[7px] cpk:bg-[rgba(153,246,228,0.5)] cpk:[animation-delay:0.2s]"
            ></span>
            <span class="copilot-a2ui-dot"></span>
            <span
              class="copilot-a2ui-bar cpk:w-12 cpk:h-[7px] cpk:bg-[rgba(24,24,27,0.15)] cpk:[animation-delay:0.6s]"
            ></span>
            <span
              class="copilot-a2ui-bar cpk:w-16 cpk:h-[7px] cpk:bg-[rgba(147,197,253,0.5)] cpk:[animation-delay:0.1s]"
            ></span>
          </div>

          <div [class]="rowClass(2, 'cpk:[transition-delay:0.3s]')">
            <span
              class="copilot-a2ui-bar cpk:w-[36px] cpk:h-[7px] cpk:bg-[rgba(147,197,253,0.6)] cpk:[animation-delay:0.5s]"
            ></span>
            <span
              class="copilot-a2ui-bar cpk:w-[36px] cpk:h-[7px] cpk:bg-[rgba(24,24,27,0.12)] cpk:[animation-delay:0.7s]"
            ></span>
          </div>

          <div [class]="rowClass(3, 'cpk:[transition-delay:0.35s]')">
            <span class="copilot-a2ui-dot"></span>
            <span
              class="copilot-a2ui-bar cpk:w-11 cpk:h-[7px] cpk:bg-[rgba(24,24,27,0.18)] cpk:[animation-delay:0.3s]"
            ></span>
            <span class="copilot-a2ui-dot"></span>
            <span
              class="copilot-a2ui-bar cpk:w-14 cpk:h-[7px] cpk:bg-[rgba(153,246,228,0.5)] cpk:[animation-delay:0.8s]"
            ></span>
            <span
              class="copilot-a2ui-bar cpk:w-12 cpk:h-[7px] cpk:bg-[rgba(147,197,253,0.5)] cpk:[animation-delay:0.4s]"
            ></span>
          </div>
        </div>

        <div class="copilot-a2ui-shimmer"></div>
      </div>

      <div class="copilot-a2ui-label">
        <span>{{ label() }}</span>
        @if (tokens() > 0) {
          <span class="copilot-a2ui-token-count">
            ~{{ tokens().toLocaleString() }} tokens
          </span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .copilot-a2ui-progress {
        margin: 12px 0;
        max-width: 320px;
      }

      .copilot-a2ui-progress-card {
        position: relative;
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid rgba(228, 228, 231, 0.8);
        background-color: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        padding: 16px 18px 14px;
      }

      .copilot-a2ui-topbar,
      .copilot-a2ui-row,
      .copilot-a2ui-label,
      .copilot-a2ui-dot-group {
        display: flex;
        align-items: center;
      }

      .copilot-a2ui-topbar {
        gap: 8px;
        margin-bottom: 12px;
      }

      .copilot-a2ui-dot-group,
      .copilot-a2ui-row {
        gap: 6px;
      }

      .copilot-a2ui-lines {
        display: grid;
        gap: 7px;
      }

      .copilot-a2ui-row {
        transition-property: opacity;
        transition-duration: 0.4s;
      }

      .copilot-a2ui-dot {
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        background-color: #d4d4d8;
        flex-shrink: 0;
      }

      .copilot-a2ui-spacer {
        width: 12px;
        flex: 0 0 12px;
      }

      .copilot-a2ui-bar {
        display: inline-flex;
        border-radius: 9999px;
        animation: copilot-a2ui-fade 2.4s ease-in-out infinite;
      }

      .copilot-a2ui-shimmer {
        pointer-events: none;
        position: absolute;
        inset: 0;
        background: linear-gradient(
          105deg,
          transparent 0%,
          transparent 40%,
          rgba(255, 255, 255, 0.6) 50%,
          transparent 60%,
          transparent 100%
        );
        background-size: 250% 100%;
        animation: copilot-a2ui-sweep 3s ease-in-out infinite;
      }

      .copilot-a2ui-label {
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
        font-size: 12px;
        color: #a1a1aa;
      }

      .copilot-a2ui-token-count {
        font-size: 11px;
        color: #d4d4d8;
        font-variant-numeric: tabular-nums;
      }

      @keyframes copilot-a2ui-fade {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      @keyframes copilot-a2ui-sweep {
        0% {
          background-position: 250% 0;
        }
        100% {
          background-position: -250% 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .copilot-a2ui-bar,
        .copilot-a2ui-shimmer {
          animation: none;
        }
      }
    `,
  ],
})
export class CopilotA2UIProgress {
  readonly phase = input.required<number>();
  readonly tokens = input(0);
  readonly label = input("Building interface");

  protected topbarBarClass(): string {
    return [
      "copilot-a2ui-bar",
      "cpk:w-16",
      "cpk:h-1.5",
      "cpk:bg-[#e4e4e7]",
      this.phase() >= 1 ? "cpk:opacity-100" : "cpk:opacity-40",
    ].join(" ");
  }

  protected rowClass(phase: number, delayClass: string): string {
    return [
      "copilot-a2ui-row",
      delayClass,
      this.phase() >= phase ? "cpk:opacity-100" : "cpk:opacity-0",
    ].join(" ");
  }
}
