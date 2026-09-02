import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { DirectiveResult } from "lit/directive.js";

import type { HomeHeroAction, HomeModel } from "./model.js";
import {
  getIntelligenceOnboardingPrompt,
  INTELLIGENCE_STORY_BEATS,
} from "./intelligence-state.js";
import type { HomeIntelligenceState } from "./intelligence-state.js";

const STORY_THREADS = [
  { title: "Reschedule the Tuesday sync", meta: "2 min ago", failed: false },
  {
    title: "Book time with the design team",
    meta: "18 min ago",
    failed: false,
  },
  { title: "Booked the wrong slot", meta: "Needs a look", failed: true },
] as const;

const STORY_RULES = [
  "Check both calendars.",
  "Propose several times.",
  "Ask before booking.",
] as const;

const STORY_SIGNALS = [
  "Check our calendars and find a time for both of us.",
  "Could you share a few options?",
  "Ask me before you book it.",
] as const;

const STORY_SKILL_FILE = "meeting-scheduling/SKILL.md";

const STORY_CHAIN = [
  { icon: "MessagesSquare", name: "Threads", detail: "Every conversation" },
  { icon: "Lightbulb", name: "Insights", detail: "Backed by evidence" },
  { icon: "FileText", name: "Skills", detail: "You approve" },
  { icon: "Wand2", name: "Your agent", detail: "Starts from what worked" },
] as const;

export type HomeIntelligenceIconName =
  | "ArrowRight"
  | "ArrowUpRight"
  | "Check"
  | "ChevronRight"
  | "ClipboardCopy"
  | "FileText"
  | "Lightbulb"
  | "MessagesSquare"
  | "Sparkles"
  | "Wand2";

export type HomeIntelligenceViewActions = Readonly<{
  copyPrompt: (event: Event) => void;
  openHeroAction: (action: HomeHeroAction) => void;
  pinStoryBeat: (index: number) => void;
}>;

export type HomeIntelligenceViewOptions = Readonly<{
  intelligenceLogoUrl: string;
  renderIcon: (
    name: HomeIntelligenceIconName,
  ) => TemplateResult | DirectiveResult | typeof nothing;
  state: HomeIntelligenceState;
}>;

function storyPosition(activeIndex: number, index: number) {
  if (index === activeIndex) return "active";
  return index < activeIndex ? "before" : "after";
}

function renderStory(
  state: HomeIntelligenceState,
  actions: HomeIntelligenceViewActions,
  options: HomeIntelligenceViewOptions,
) {
  const activeBeat = INTELLIGENCE_STORY_BEATS[state.storyBeat];
  const position = (id: string) =>
    storyPosition(
      state.storyBeat,
      INTELLIGENCE_STORY_BEATS.findIndex((beat) => beat.id === id),
    );

  return html`
    <section
      class="inspector-intelligence-story"
      data-inspector-intelligence-story
      data-beat=${activeBeat?.id ?? "threads"}
    >
      <div
        class="inspector-intelligence-copy"
        data-inspector-intelligence-copy
        data-beat=${activeBeat?.id ?? "threads"}
        aria-hidden="true"
      >
        ${INTELLIGENCE_STORY_BEATS.map(
          (beat, index) => html`<div
            class="inspector-intelligence-copy-slide"
            data-beat-id=${beat.id}
            data-active=${index === state.storyBeat}
            data-position=${storyPosition(state.storyBeat, index)}
          >
            <strong>${beat.lead}</strong><span>${beat.support}</span>
          </div>`,
        )}
      </div>
      <div class="inspector-intelligence-story-stage" aria-hidden="true">
        <div
          class="inspector-intelligence-beat"
          data-beat-id="threads"
          data-position=${position("threads")}
        >
          <div class="inspector-intelligence-threads">
            ${STORY_THREADS.map(
              (thread, index) => html`<span
                class="inspector-intelligence-thread"
                data-failed=${thread.failed}
                style="--thread-index:${index}"
              >
                <i></i><strong>${thread.title}</strong><small>${thread.meta}</small>
              </span>`,
            )}
          </div>
        </div>
        <div
          class="inspector-intelligence-beat"
          data-beat-id="learning"
          data-position=${position("learning")}
        >
          <div class="inspector-intelligence-beat-col">
            <span class="inspector-intelligence-beat-label">
              Signals from ${STORY_SIGNALS.length} threads
            </span>
            ${STORY_SIGNALS.map(
              (signal, index) => html`<span
                class="inspector-intelligence-signal"
                style="--signal-index:${index}"
                >${signal}</span
              >`,
            )}
          </div>
          <div class="inspector-intelligence-beat-flow">
            ${options.renderIcon("ArrowRight")}
          </div>
          <div class="inspector-intelligence-beat-col">
            <span class="inspector-intelligence-beat-label">Reusable pattern</span>
            ${STORY_RULES.map(
              (rule, index) => html`<span
                class="inspector-intelligence-rule"
                style="--rule-index:${index}"
              >
                <i>${options.renderIcon("Check")}</i>${rule}
              </span>`,
            )}
          </div>
        </div>
        <div
          class="inspector-intelligence-beat"
          data-beat-id="skill"
          data-position=${position("skill")}
        >
          <div class="inspector-intelligence-skill-file">
            <header>
              ${options.renderIcon("FileText")}
              <strong>${STORY_SKILL_FILE}</strong><em>Pending review</em>
            </header>
            <div class="inspector-intelligence-skill-code">
              <span data-line="1"><b># Meeting scheduling</b></span>
              <span data-line="2">When planning a meeting:</span>
              ${STORY_RULES.map(
                (rule, index) => html`<span
                  data-line=${index + 3}
                  style="--rule-index:${index}"
                  >${index + 1}. ${rule}</span
                >`,
              )}
            </div>
          </div>
        </div>
        <div
          class="inspector-intelligence-beat"
          data-beat-id="intelligence"
          data-position=${position("intelligence")}
        >
          <div class="inspector-intelligence-chain">
            ${STORY_CHAIN.map(
              (step, index) => html`<span
                  class="inspector-intelligence-chain-step"
                  style="--step-index:${index}"
                >
                  <i>${options.renderIcon(step.icon)}</i>
                  <strong>${step.name}</strong><small>${step.detail}</small>
                </span>
                ${
                  index === STORY_CHAIN.length - 1
                    ? nothing
                    : html`<span
                      class="inspector-intelligence-chain-arrow"
                      style="--step-index:${index}"
                      >${options.renderIcon("ChevronRight")}</span
                    >`
                }`,
            )}
          </div>
          <span class="inspector-intelligence-chain-proof">
            ${options.renderIcon("Sparkles")} Next run starts with
            <code>${STORY_SKILL_FILE}</code>
          </span>
        </div>
      </div>
      <div
        class="inspector-intelligence-story-rail"
        role="group"
        aria-label="What Intelligence adds"
      >
        ${INTELLIGENCE_STORY_BEATS.map(
          (beat, index) => html`<button
            type="button"
            class="inspector-intelligence-story-tab"
            aria-pressed=${index === state.storyBeat}
            data-active=${index === state.storyBeat}
            @click=${() => actions.pinStoryBeat(index)}
          >
            ${beat.label}
          </button>`,
        )}
      </div>
    </section>
  `;
}

function renderAction(
  action: HomeHeroAction,
  actions: HomeIntelligenceViewActions,
  options: HomeIntelligenceViewOptions,
  className: string,
) {
  return html`<a
    class=${className}
    data-inspector-home-intelligence-action=${action.kind}
    href=${action.url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="${action.label} (opens in a new tab)"
    @click=${() => actions.openHeroAction(action)}
  >
    ${action.label} ${options.renderIcon("ArrowUpRight")}
  </a>`;
}

export function renderHomeIntelligence(
  model: HomeModel,
  actions: HomeIntelligenceViewActions,
  options: HomeIntelligenceViewOptions,
) {
  const project = model.project;
  const connected = model.hero.connection === "connected";
  const action = model.hero.action;
  const renewing = action?.kind === "renew";
  const installing = !connected && !renewing;
  const copied = options.state.promptCopyState === "copied";
  const failed = options.state.promptCopyState === "failed";

  return html`
    <section
      class="inspector-home-section inspector-intelligence-hud"
      data-inspector-home-card="intelligence"
      data-state=${connected ? "connected" : "disconnected"}
      data-mode=${connected ? "connected" : renewing ? "renew" : "install"}
      aria-label="Intelligence ${
        connected ? "connected" : renewing ? "plan expired" : "not enabled"
      }"
    >
      <header class="inspector-intelligence-hud-header">
        <div class="inspector-intelligence-hud-heading">
          <h2 class="inspector-home-section-title">
            ${
              installing
                ? html`<img
                  class="inspector-intelligence-mark"
                  src=${options.intelligenceLogoUrl}
                  alt=""
                  aria-hidden="true"
                />`
                : nothing
            }
            ${connected ? "Intelligence" : model.hero.title}
          </h2>
          ${
            connected
              ? nothing
              : installing
                ? html`<p class="inspector-intelligence-sr-summary">
                  ${model.hero.body}
                </p>`
                : html`<p class="inspector-intelligence-hud-description">
                  ${model.hero.body}
                </p>`
          }
        </div>
        <div class="inspector-intelligence-hud-header-actions">
          ${
            connected || renewing
              ? html`<span
                class="inspector-intelligence-hud-state"
                data-tone=${connected ? "success" : "checking"}
              >
                <span aria-hidden="true"></span>
                ${connected ? "Connected" : "Plan expired"}
              </span>`
              : nothing
          }
          ${
            renewing && action
              ? renderAction(
                  action,
                  actions,
                  options,
                  "inspector-intelligence-hud-action inspector-intelligence-hud-connect-action",
                )
              : nothing
          }
          ${
            installing
              ? html`<div
                class="inspector-intelligence-install"
                data-copy-state=${options.state.promptCopyState}
              >
                ${
                  options.state.promptCopyState === "idle"
                    ? action
                      ? html`<a
                        class="inspector-intelligence-install-secondary"
                        data-inspector-home-intelligence-action=${action.kind}
                        href=${action.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Set Intelligence up yourself (opens in a new tab)"
                        @click=${() => actions.openHeroAction(action)}
                      >
                        Set it up yourself ${options.renderIcon("ArrowUpRight")}
                      </a>`
                      : nothing
                    : html`<p
                      class="inspector-intelligence-install-hint"
                      data-tone=${failed ? "error" : "success"}
                      role="status"
                    >
                      ${
                        failed
                          ? "Clipboard blocked — copy the prompt below."
                          : "Paste it into your coding agent."
                      }
                    </p>`
                }
                <button
                  type="button"
                  class="inspector-intelligence-hud-action inspector-intelligence-install-copy"
                  data-inspector-intelligence-copy-prompt
                  aria-label=${
                    copied
                      ? "Install prompt copied to clipboard. Paste it into your coding agent."
                      : "Copy the Intelligence install prompt"
                  }
                  @click=${actions.copyPrompt}
                >
                  ${options.renderIcon(copied ? "Check" : "ClipboardCopy")}
                  ${copied ? "Prompt copied" : "Copy setup prompt"}
                </button>
              </div>`
              : nothing
          }
        </div>
      </header>

      ${
        installing && failed
          ? html`<code class="inspector-intelligence-install-fallback" tabindex="0"
            >${getIntelligenceOnboardingPrompt(options.state)}</code
          >`
          : nothing
      }
      ${installing ? renderStory(options.state, actions, options) : nothing}

      ${
        connected
          ? html`<div
            class="inspector-intelligence-hud-details"
            role="group"
            aria-label="Intelligence account details"
          >
            <section
              class="inspector-intelligence-hud-project"
              data-inspector-metadata=${
                model.projectLinked && project ? "identity" : nothing
              }
              aria-label=${
                model.projectLinked && project
                  ? "Inspector account details"
                  : nothing
              }
            >
              <span class="inspector-intelligence-hud-detail-label">Project</span>
              <strong class="inspector-intelligence-hud-detail-value">
                ${
                  model.projectLinked && project
                    ? html`<span>${project.projectName}</span>`
                    : "Not linked"
                }
              </strong>
              ${
                model.projectLinked && project
                  ? html`<span class="inspector-intelligence-hud-detail-subvalue">
                    ${project.organizationName}
                  </span>`
                  : nothing
              }
            </section>
            <section class="inspector-intelligence-hud-plan">
              <div class="inspector-intelligence-hud-plan-summary">
                <span class="inspector-intelligence-hud-detail-label">Plan</span>
                <strong class="inspector-intelligence-hud-detail-value">
                  ${
                    project?.planLabel
                      ? html`<span data-inspector-metadata="plan"
                        >${project.planLabel}</span
                      >`
                      : "No plan"
                  }
                </strong>
                ${
                  project
                    ? html`<span class="inspector-intelligence-hud-detail-subvalue">
                      License ${project.license}
                    </span>`
                    : nothing
                }
                ${
                  action
                    ? renderAction(
                        action,
                        actions,
                        options,
                        "inspector-intelligence-hud-action inspector-intelligence-hud-plan-action",
                      )
                    : nothing
                }
              </div>
              <div
                class="inspector-intelligence-hud-usage"
                role="group"
                aria-label="Threads usage"
              >
                <span class="inspector-intelligence-hud-detail-label"
                  >Threads usage</span
                >
                <strong class="inspector-intelligence-hud-detail-value">
                  ${project?.usage?.limitLabel ?? "Unavailable"}
                </strong>
                ${
                  project?.usage?.ratio !== undefined
                    ? html`<span class="inspector-home-usage-bar" aria-hidden="true"
                      ><span
                        style="width:${Math.min(
                          100,
                          Math.round(project.usage.ratio * 100),
                        )}%"
                      ></span
                    ></span>`
                    : nothing
                }
              </div>
            </section>
          </div>`
          : nothing
      }
    </section>
  `;
}
