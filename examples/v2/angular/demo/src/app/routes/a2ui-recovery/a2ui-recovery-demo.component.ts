import { Component } from "@angular/core";
import { CopilotChat } from "@copilotkit/angular";

/**
 * Chat with the scripted `a2ui-recovery` agent (no API key needed). It
 * replays the lifecycle the A2UI middleware streams while validating and
 * retrying a generated surface, rendered by `<copilot-a2ui-recovery>`.
 */
@Component({
  selector: "a2ui-recovery-demo",
  imports: [CopilotChat],
  template: `
    <div class="layout">
      <aside class="explainer">
        <h1>A2UI recovery</h1>
        <p>
          When generated A2UI fails validation, the middleware retries and streams
          the lifecycle into one activity message. The chat shows it instead of a
          broken surface:
        </p>
        <ol>
          <li><strong>building</strong>: progress from streamed tokens</li>
          <li>
            <strong>retrying</strong>: the attempt count and the validation errors
          </li>
          <li>
            the <strong>surface</strong> once an attempt passes, or
            <strong>failed</strong> with developer details when none do
          </li>
        </ol>
        <p>Pick a suggestion below the chat to play either outcome.</p>
        <pre><code>{{ snippet }}</code></pre>
      </aside>
      <copilot-chat class="chat" agentId="a2ui-recovery" />
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 380px) 1fr;
      height: 100%;
    }
    .explainer {
      overflow: auto;
      padding: 24px;
      border-right: 1px solid #e5e7eb;
      font-size: 14px;
      line-height: 1.5;
    }
    h1 {
      margin-top: 0;
      font-size: 20px;
    }
    pre {
      overflow: auto;
      padding: 12px;
      border-radius: 8px;
      background: #f4f4f5;
      font-size: 12px;
    }
    .chat {
      display: block;
      min-width: 0;
      height: 100%;
    }
  `,
})
export class A2UIRecoveryDemoComponent {
  protected readonly snippet = `provideCopilotKit({
  a2ui: {
    catalog,
    recovery: {
      showAfterMs: 2000,     // hide quick retries
      showAfterAttempts: 2,  // or reveal from attempt 2
      debugExposure: "collapsed",
    },
  },
});`;
}
