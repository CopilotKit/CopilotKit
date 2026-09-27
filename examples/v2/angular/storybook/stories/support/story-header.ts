import { ChangeDetectionStrategy, Component } from "@angular/core";

/**
 * A custom title for `headerComponent`: rendered in the header's centered
 * title column, between the threads launcher and the close button.
 */
@Component({
  selector: "story-modal-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="title">Workspace Copilot</div>
    <div class="subtitle">
      <span class="dot" aria-hidden="true"></span> Replies in a few seconds
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      text-align: center;
    }
    .title {
      overflow: hidden;
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--foreground);
    }
    .subtitle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      margin-top: 0.25rem;
      font-size: 0.75rem;
      white-space: nowrap;
      color: var(--muted-foreground);
    }
    .dot {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 999px;
      background: var(--success);
    }
  `,
})
export class StoryModalHeader {}
