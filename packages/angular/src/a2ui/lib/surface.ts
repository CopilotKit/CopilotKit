import { NgComponentOutlet } from "@angular/common";
import {
  Component,
  effect,
  inject,
  input,
  isDevMode,
  output,
  signal,
  untracked,
  OnDestroy,
  Type,
} from "@angular/core";
import { MessageProcessor, SurfaceModel } from "@a2ui/web_core/v0_9";
import {
  A2UIOperationApplier,
  A2UISurfaceDiagnostics,
} from "@copilotkit/a2ui-renderer/engine";
import { A2UIClientEventMessage, A2UISurfaceError } from "@copilotkit/angular";
import { A2UI_SURFACE_REVISION, CopilotA2UINode } from "./node";
import { CopilotA2UICatalog } from "./catalog";
import { CopilotA2UICatalogEntry } from "./types";

type Surface = SurfaceModel<CopilotA2UICatalogEntry>;

/**
 * Renders A2UI operations with a {@link CopilotA2UICatalog}. Place it directly in
 * a template to render operations outside the chat.
 *
 * @example
 * ```html
 * <copilot-a2ui-surface
 *   [operations]="operations()"
 *   [catalog]="dashboardCatalog"
 *   (action)="onAction($event)"
 * />
 * ```
 */
@Component({
  selector: "copilot-a2ui-surface",
  imports: [NgComponentOutlet, CopilotA2UINode],
  providers: [{ provide: A2UI_SURFACE_REVISION, useFactory: () => signal(0) }],
  template: `
    @if (errorMessage(); as message) {
      <div class="copilot-a2ui-surface-error" role="alert" data-testid="a2ui-error">
        A2UI render error: {{ message }}
      </div>
    } @else if (surfaces().length === 0) {
      @if (loadingComponent(); as loading) {
        <ng-container *ngComponentOutlet="loading" />
      } @else {
        <div
          class="copilot-a2ui-surface-loading"
          data-testid="a2ui-loading"
          aria-busy="true"
        >
          <div class="copilot-a2ui-surface-loading-label">
            <span
              class="copilot-a2ui-surface-loading-dot"
              data-testid="a2ui-loading-dot"
            ></span>
            <span>Generating UI...</span>
          </div>
          @for (width of [80, 60, 40]; track $index) {
            <div
              class="copilot-a2ui-surface-loading-bar"
              data-testid="a2ui-loading-bar"
              [style.width.%]="width"
              [style.animation-delay.ms]="$index * 150"
            ></div>
          }
        </div>
      }
    } @else {
      <div class="copilot-a2ui-surfaces" data-testid="a2ui-activity-renderer">
        @for (surface of surfaces(); track surface.id) {
          <div
            class="copilot-a2ui-surface-item"
            [attr.data-surface-id]="surface.id"
          >
            <div
              class="a2ui-surface"
              [attr.data-surface-id]="surface.id"
              [style.--a2ui-color-primary]="surface.theme?.primaryColor"
            >
              <copilot-a2ui-node [surface]="surface" componentId="root" />
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 100%;
    }
    .copilot-a2ui-surfaces {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
    }
    .copilot-a2ui-surface-item {
      display: flex;
      width: 100%;
      flex-direction: column;
    }
    /* A flex row, so a full-width root shrinks to fit its margins. */
    .a2ui-surface {
      display: flex;
      flex: 1;
    }
    .copilot-a2ui-surface-error {
      border: 1px solid var(--copilot-kit-error-border, #fecaca);
      border-radius: 0.5rem;
      background: var(--copilot-kit-error-background, #fef2f2);
      padding: 0.75rem;
      font-size: 0.875rem;
      color: var(--copilot-kit-error-text, #b91c1c);
    }
    .copilot-a2ui-surface-loading {
      display: flex;
      min-height: 120px;
      flex-direction: column;
      gap: 0.5rem;
      border: 1px solid var(--a2ui-color-placeholder, #f3f4f6);
      border-radius: 0.75rem;
      background: color-mix(
        in srgb,
        var(--a2ui-color-placeholder, #f9fafb) 50%,
        transparent
      );
      padding: 1.25rem;
    }
    .copilot-a2ui-surface-loading-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--a2ui-color-muted, #9ca3af);
    }
    .copilot-a2ui-surface-loading-dot {
      height: 0.75rem;
      width: 0.75rem;
      border-radius: 9999px;
      background: var(--a2ui-color-placeholder-highlight, #e5e7eb);
      animation: copilot-a2ui-pulse 1.5s ease-in-out infinite;
    }
    .copilot-a2ui-surface-loading-bar {
      height: 0.75rem;
      border-radius: 0.25rem;
      background: color-mix(
        in srgb,
        var(--a2ui-color-placeholder-highlight, #e5e7eb) 70%,
        transparent
      );
      animation: copilot-a2ui-pulse 1.5s ease-in-out infinite;
    }
    @keyframes copilot-a2ui-pulse {
      0%,
      100% {
        opacity: 0.4;
      }
      50% {
        opacity: 1;
      }
    }
  `,
})
export class CopilotA2UISurface implements OnDestroy {
  /** A2UI operations in v0.9 or legacy shape. */
  readonly operations = input<readonly unknown[]>([]);
  readonly catalog = input.required<CopilotA2UICatalog>();
  /** Theme for surfaces the renderer creates itself. */
  readonly theme = input<Record<string, unknown>>();
  /** Shown until the first surface renders. */
  readonly loadingComponent = input<Type<unknown>>();

  readonly action = output<A2UIClientEventMessage>();
  readonly error = output<A2UISurfaceError>();
  /** Emits after each applied batch of operations. */
  readonly rendered = output<void>();

  protected readonly surfaces = signal<Surface[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  private readonly revision = inject(A2UI_SURFACE_REVISION);

  private processor: MessageProcessor<CopilotA2UICatalogEntry> | null = null;
  private applier: A2UIOperationApplier<CopilotA2UICatalogEntry> | null = null;
  private applierKey: { catalog: CopilotA2UICatalog; theme: string } | null =
    null;
  private lastSurfaces: readonly Surface[] = [];
  private readonly diagnostics = isDevMode()
    ? new A2UISurfaceDiagnostics({ warn: (message) => console.warn(message) })
    : null;

  constructor() {
    effect(() => {
      const catalog = this.catalog();
      const operations = this.operations();
      const theme = this.theme();
      untracked(() => this.process(catalog, operations, theme));
    });
  }

  ngOnDestroy(): void {
    this.reset();
  }

  /** Drops the processor and everything rendered from it. */
  private reset(): void {
    this.diagnostics?.dispose();
    this.processor?.model.dispose();
    this.processor = null;
    this.applier = null;
    this.applierKey = null;
    this.lastSurfaces = [];
    this.surfaces.set([]);
  }

  /** The applier for this catalog and theme; a change of either starts over. */
  private getApplier(
    catalog: CopilotA2UICatalog,
    theme: Record<string, unknown> | undefined,
  ): A2UIOperationApplier<CopilotA2UICatalogEntry> {
    const themeKey = JSON.stringify(theme ?? null);
    const key = this.applierKey;
    if (this.applier && key?.catalog === catalog && key.theme === themeKey) {
      return this.applier;
    }
    this.reset();
    const processor = new MessageProcessor([catalog], (userAction) => {
      this.action.emit({ userAction });
    });
    this.processor = processor;
    this.applier = new A2UIOperationApplier(processor, catalog.id, theme);
    this.applierKey = { catalog, theme: themeKey };
    return this.applier;
  }

  private process(
    catalog: CopilotA2UICatalog,
    operations: readonly unknown[],
    theme: Record<string, unknown> | undefined,
  ): void {
    if (operations.length === 0) {
      // Start over, so the next operations cannot patch stale surfaces.
      this.reset();
      this.errorMessage.set(null);
      return;
    }

    try {
      const applier = this.getApplier(catalog, theme);
      const surfaces = applier.apply(operations);
      // The applier returns the same array when nothing changed.
      if (surfaces === this.lastSurfaces) return;
      this.lastSurfaces = surfaces;
      this.revision.update((value) => value + 1);
      this.surfaces.set([...surfaces]);
      this.errorMessage.set(null);
      if (this.processor) {
        this.diagnostics?.check(operations, this.processor.model);
      }
      this.rendered.emit();
    } catch (error) {
      // A failed batch may have partially mutated the model; replay on recovery.
      this.reset();
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage.set(message);
      this.error.emit({ error, message });
    }
  }
}
