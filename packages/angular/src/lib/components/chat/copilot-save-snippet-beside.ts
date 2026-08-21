import { NgStyle } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import {
  findOverflowAncestor,
  measureSaveSnippetSide,
  SAVE_SNIPPET_BESIDE_BODY_CLASS,
  SAVE_SNIPPET_BESIDE_SAVE_CLASS,
  SAVE_SNIPPET_BESIDE_WRAP_CLASS,
  saveSnippetBesideStyle,
} from "./save-snippet-beside";

@Component({
  selector: "copilot-save-snippet-beside",
  imports: [NgStyle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <div
      #wrap
      [class]="enabled() ? wrapClass : null"
      [attr.data-save-snippet-side]="enabled() ? side() : null"
    >
      <div #body [class]="enabled() ? bodyClass : null">
        <ng-content />
      </div>
      <div
        [class]="enabled() ? saveClass : null"
        [hidden]="!enabled()"
        [ngStyle]="enabled() ? saveStyle() : null"
      >
        <ng-content select="[saveSnippet]" />
      </div>
    </div>
  `,
})
export class CopilotSaveSnippetBeside {
  readonly enabled = input(false);

  protected readonly wrapClass = SAVE_SNIPPET_BESIDE_WRAP_CLASS;
  protected readonly bodyClass = SAVE_SNIPPET_BESIDE_BODY_CLASS;
  protected readonly saveClass = SAVE_SNIPPET_BESIDE_SAVE_CLASS;
  protected readonly side = signal<"left" | "right">("right");
  protected readonly saveStyle = () => saveSnippetBesideStyle(this.side());

  private readonly wrap = viewChild<ElementRef<HTMLElement>>("wrap");
  private readonly body = viewChild<ElementRef<HTMLElement>>("body");
  private readonly destroyRef = inject(DestroyRef);
  private observer: ResizeObserver | undefined;

  constructor() {
    const onResize = () => this.measure();
    afterNextRender(() => {
      this.bindObserver();
      window.addEventListener("resize", onResize);
    });
    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      window.removeEventListener("resize", onResize);
    });
  }

  private bindObserver(): void {
    this.observer?.disconnect();
    const wrap = this.wrap()?.nativeElement;
    const body = this.body()?.nativeElement;
    if (!this.enabled() || !wrap || !body) {
      return;
    }
    this.measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(wrap);
    this.observer.observe(body);
    const clip = findOverflowAncestor(wrap);
    if (clip !== wrap) {
      this.observer.observe(clip);
    }
  }

  private measure(): void {
    const wrap = this.wrap()?.nativeElement;
    const body = this.body()?.nativeElement;
    if (!wrap || !body) {
      return;
    }
    this.side.set(measureSaveSnippetSide(wrap, body));
  }
}
