import { html } from "lit";
import type { TemplateResult } from "lit";

const PRIVATE_CONTENT = [
  "Message content",
  "Agent state",
  "Prompts",
  "Completions",
] as const;

type SettingsIcon =
  | "ArrowUpRight"
  | "Check"
  | "Clock"
  | "EyeOff"
  | "ShieldCheck"
  | "ShieldOff";

export function renderSettingsPanel(options: {
  optedOut: boolean;
  telemetryDocsUrl: string;
  renderIcon: (name: SettingsIcon) => unknown;
  onDismissForWeek: () => void;
}): TemplateResult {
  const { optedOut } = options;
  return html`
    <div
      class="inspector-settings"
      data-inspector-settings
      data-state=${optedOut ? "disabled" : "enabled"}
    >
      <header class="inspector-settings-header">
        <h1 class="inspector-settings-title">Settings</h1>
        <p class="inspector-settings-subtitle">
          Understand how the Inspector handles analytics and private content.
        </p>
      </header>

      <section
        class="inspector-settings-section"
        aria-labelledby="inspector-settings-privacy-title"
      >
        <div class="inspector-settings-section-heading">
          <span class="inspector-settings-section-icon" aria-hidden="true">
            ${options.renderIcon(optedOut ? "ShieldOff" : "ShieldCheck")}
          </span>
          <div>
            <h2 id="inspector-settings-privacy-title">Privacy</h2>
            <p>Analytics without access to your agent content.</p>
          </div>
        </div>

        <div
          class="inspector-settings-privacy"
          data-state=${optedOut ? "disabled" : "enabled"}
        >
          <div class="inspector-settings-status-row">
            <div>
              <h3>Anonymous usage analytics</h3>
              <p>
                ${optedOut
                  ? "Anonymous Inspector interaction data collection is disabled for this runtime."
                  : "CopilotKit collects anonymous Inspector interactions to understand which features people use."}
              </p>
            </div>
            <span class="inspector-settings-status">
              ${optedOut ? "Analytics off" : "Analytics on"}
            </span>
          </div>

          <div class="inspector-settings-private-content">
            <strong>Content stays private</strong>
            <p>CopilotKit never collects:</p>
            <ul aria-label="Content CopilotKit never collects">
              ${PRIVATE_CONTENT.map(
                (item) => html`
                  <li>
                    <span aria-hidden="true"
                      >${options.renderIcon("Check")}</span
                    >
                    ${item}
                  </li>
                `,
              )}
            </ul>
          </div>

          <a
            class="inspector-settings-policy-link"
            href=${options.telemetryDocsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the telemetry policy
            <span aria-hidden="true"
              >${options.renderIcon("ArrowUpRight")}</span
            >
          </a>
        </div>
      </section>

      <section
        class="inspector-settings-section"
        aria-labelledby="inspector-settings-visibility-title"
      >
        <div class="inspector-settings-section-heading">
          <span class="inspector-settings-section-icon" aria-hidden="true">
            ${options.renderIcon("EyeOff")}
          </span>
          <div>
            <h2 id="inspector-settings-visibility-title">Visibility</h2>
            <p>Temporarily hide the Inspector on this domain.</p>
          </div>
        </div>

        <div class="inspector-settings-visibility">
          <div>
            <h3>Take a break from the Inspector</h3>
            <p>
              Hide the Inspector for seven days. It will return automatically
              when the week is over.
            </p>
          </div>
          <button
            type="button"
            class="inspector-settings-dismiss"
            data-cpk-dismiss-inspector="week"
            @click=${options.onDismissForWeek}
          >
            <span aria-hidden="true">${options.renderIcon("Clock")}</span>
            Hide Inspector for one week
          </button>
        </div>
      </section>
    </div>
  `;
}
