import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "showcase-document-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="document-view" aria-labelledby="document-title">
      <header>
        <div>
          <h2 id="document-title">Document</h2>
          @if (isStreaming()) {
            <span data-testid="document-live-badge" role="status"
              ><i aria-hidden="true"></i> Live</span
            >
          }
        </div>
        <span data-testid="document-char-count">{{ content().length }} chars</span>
      </header>
      <div class="document-body">
        @if (content().length === 0 && !isStreaming()) {
          <p>
            Ask the agent to write something — its output will stream here token by
            token.
          </p>
        } @else {
          <div data-testid="document-content">
            {{ content() }}
            @if (isStreaming()) {
              <i aria-hidden="true"></i>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    section {
      display: grid;
      min-height: 30rem;
      grid-template-rows: auto minmax(0, 1fr);
      border: 1px solid light-dark(#dbe3eb, #303136);
      background: light-dark(#fff, #191a1e);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.8rem 1.2rem;
      border-bottom: 1px solid light-dark(#e2e8f0, #303136);
      background: light-dark(#f8fafc, #242529);
    }
    header > div {
      display: flex;
      align-items: center;
      gap: 0.7rem;
    }
    h2 {
      margin: 0;
      font-size: 1rem;
    }
    [data-testid="document-live-badge"] {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.45rem;
      border-radius: 999px;
      color: #fff;
      background: #dc2626;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    [data-testid="document-live-badge"] i {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 50%;
      background: #fff;
      animation: pulse 1s ease-in-out infinite;
    }
    [data-testid="document-char-count"] {
      color: light-dark(#64748b, #adadb2);
      font:
        0.75rem ui-monospace,
        monospace;
    }
    .document-body {
      padding: 1.4rem;
      overflow: auto;
    }
    .document-body p {
      color: light-dark(#64748b, #adadb2);
      font-style: italic;
    }
    [data-testid="document-content"] {
      white-space: pre-wrap;
      color: light-dark(#14213d, #fafafa);
      font:
        1rem/1.7 Georgia,
        serif;
    }
    [data-testid="document-content"] i {
      display: inline-block;
      width: 0.45rem;
      height: 1.1rem;
      margin-left: 0.15rem;
      vertical-align: text-bottom;
      background: light-dark(#14213d, #fafafa);
      animation: pulse 1s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      i {
        animation: none !important;
      }
    }
  `,
})
export class DocumentPanelComponent {
  readonly content = input.required<string>();
  readonly isStreaming = input(false);
}
