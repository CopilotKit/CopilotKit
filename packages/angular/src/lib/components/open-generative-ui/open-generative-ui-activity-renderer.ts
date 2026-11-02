import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  type OnChanges,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
  InjectionToken,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import {
  ɵOpenGenerativeUIController,
  ɵloadWebsandbox,
  type ɵWebsandboxLoader,
} from "@copilotkit/core";
import type { ActivityRenderer } from "../../activity-renderer";
import {
  OpenGenerativeUIContentSchema,
  type OpenGenerativeUIContent,
} from "../../open-generative-ui";
import { injectCopilotKitConfig } from "../../config";

/** Loads the websandbox class. Provide a fake in tests. */
export const OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER =
  new InjectionToken<ɵWebsandboxLoader>(
    "OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER",
    {
      providedIn: "root",
      factory: () => ɵloadWebsandbox,
    },
  );

function parseOpenGenerativeUIContent(
  content: unknown,
): OpenGenerativeUIContent {
  const parsed = OpenGenerativeUIContentSchema.safeParse(content);
  return parsed.success ? parsed.data : {};
}

@Component({
  selector: "copilot-open-generative-ui-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #container
      data-testid="open-generative-ui-renderer"
      class="copilot-open-generative-ui-container"
      [style.height.px]="height()"
      [class.has-visible-sandbox]="hasVisibleSandbox()"
    >
      @if (!hasVisibleSandbox() && isGenerating()) {
        <div
          data-testid="open-generative-ui-placeholder"
          class="copilot-open-generative-ui-placeholder"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            class="copilot-open-generative-ui-spinner"
          >
            <circle cx="12" cy="12" r="10" stroke="#e0e0e0" stroke-width="3" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="#999"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </div>
      }
      @if (hasVisibleSandbox() && isGenerating()) {
        <div
          data-testid="open-generative-ui-progress-overlay"
          class="copilot-open-generative-ui-overlay"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            class="copilot-open-generative-ui-spinner"
          >
            <circle cx="12" cy="12" r="10" stroke="#e0e0e0" stroke-width="3" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="#999"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .copilot-open-generative-ui-container {
        position: relative;
        width: 100%;
        border-radius: 8px;
        background-color: #f5f5f5;
        border: 1px solid #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .copilot-open-generative-ui-container.has-visible-sandbox {
        background-color: transparent;
        border: none;
        display: block;
      }

      .copilot-open-generative-ui-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .copilot-open-generative-ui-overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        pointer-events: all;
        background-color: rgba(255, 255, 255, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .copilot-open-generative-ui-spinner {
        animation: copilot-open-generative-ui-spin 1s linear infinite;
      }

      @keyframes copilot-open-generative-ui-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class CopilotOpenGenerativeUIRenderer implements OnChanges {
  readonly content = input.required<OpenGenerativeUIContent>();

  private readonly containerRef = viewChild<
    unknown,
    ElementRef<HTMLDivElement>
  >("container", { read: ElementRef });
  private readonly controller = new ɵOpenGenerativeUIController({
    loadWebsandbox: inject(OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER),
  });
  private readonly state = signal(this.controller.getState());

  protected readonly hasVisibleSandbox = computed(
    () => this.state().phase !== "placeholder",
  );
  protected readonly isGenerating = computed(() => this.state().generating);
  protected readonly height = computed(() => this.state().height);

  constructor() {
    this.controller.setSandboxFunctions(
      injectCopilotKitConfig().openGenerativeUI?.sandboxFunctions ?? [],
    );
    const unsubscribe = this.controller.subscribe(() =>
      this.state.set(this.controller.getState()),
    );
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.controller.destroy();
    });

    afterRenderEffect({
      write: () => {
        this.controller.setHost(this.containerRef()?.nativeElement ?? null);
      },
    });
  }

  /** Applies input updates synchronously before the matching render pass. */
  ngOnChanges(): void {
    this.controller.setContent(parseOpenGenerativeUIContent(this.content()));
  }
}

@Component({
  selector: "copilot-open-generative-ui-activity-renderer",
  imports: [CopilotOpenGenerativeUIRenderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-open-generative-ui-renderer [content]="content()" />
  `,
})
export class CopilotOpenGenerativeUIActivityRenderer implements ActivityRenderer<OpenGenerativeUIContent> {
  readonly activityType = input.required<string>();
  readonly content = input.required<OpenGenerativeUIContent>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}
