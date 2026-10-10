import type { LearningEvidenceStep } from "./learning-api";
import styles from "./evidence-step.module.css";

/*
 * Demo: cited evidence drawn the way the trajectory view
 * (src/intelligence-ui/trajectory-view/index.html) draws the same moments: the
 * agent bubble with its avatar, the user's dark bubble, and the product and
 * agent-trace event cards with their Material Symbols tiles. The markup and
 * the styles follow that page's `.msg` and `.ev-card` rules; only the layout
 * is stacked for the drawer's narrow column.
 */

/** The trajectory view's own icon font request, so both share one download. */
const SYMBOLS_HREF =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=add,ads_click,arrow_forward,auto_awesome,build,call_split,check,check_circle,checklist,chevron_right,close,code,content_copy,download,error,event,expand_less,expand_more,flight,forum,gesture,home,info,key_vertical,lightbulb,lock,menu_book,model_training,monitoring,neurology,pending,person,psychology,receipt_long,route,screenshot_monitor,sell,smart_toy,sync_alt,touch_app,unfold_less,unfold_more,upload,visibility,widgets&display=block";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Wall-clock time as the trajectory view prints it (HH:MM:SS, local). */
function clock(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const duration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms} ms`;

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

function Icon(props: { readonly name: string }): React.JSX.Element {
  return (
    <span aria-hidden="true" className={styles.ms}>
      {props.name}
    </span>
  );
}

/** Loads the trajectory view's icon font once; React hoists and dedupes it. */
export function EvidenceSymbols(): React.JSX.Element {
  return <link href={SYMBOLS_HREF} precedence="default" rel="stylesheet" />;
}

/** One event card: a tinted tile, the title, then its facts on their own line. */
function EventCard(props: {
  readonly at: number;
  readonly children: React.ReactNode;
  readonly icon: string;
  readonly meta?: React.ReactNode;
  readonly side?: React.ReactNode;
  readonly tone: "prod" | "trace";
}): React.JSX.Element {
  return (
    <li className={`${styles.row} ${styles.event} ${styles[props.tone]}`}>
      <div className={styles.card}>
        <span className={styles.tile}>
          <Icon name={props.icon} />
        </span>
        <div className={styles.main}>
          <div className={styles.title}>{props.children}</div>
          <div className={styles.facts}>
            {props.meta ? (
              <span className={styles.meta}>{props.meta}</span>
            ) : null}
            {props.side}
            <span className={styles.time}>{clock(props.at)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Draws one cited step in the trajectory view's look. */
export function EvidenceStep(props: {
  readonly step: LearningEvidenceStep;
}): React.JSX.Element {
  const step = props.step;
  switch (step.kind) {
    case "message":
      if (step.role === "user") {
        return (
          <li className={`${styles.row} ${styles.user}`}>
            <span aria-hidden="true" className={styles.uNode}>
              {initials(step.who)}
            </span>
            <div className={styles.who}>
              <b>{step.who}</b>
              <span>
                {step.surface === "chatgpt"
                  ? "ChatGPT via MCP"
                  : "In-app agent"}
              </span>
              <span className={styles.num}>{clock(step.at)}</span>
            </div>
            <div className={styles.bubble}>{step.text}</div>
          </li>
        );
      }
      return (
        <li className={`${styles.row} ${styles.agent}`}>
          <span aria-hidden="true" className={styles.avatar}>
            <Icon name={step.surface === "chatgpt" ? "forum" : "smart_toy"} />
          </span>
          <div className={styles.who}>
            <b>{`${step.who} · ${step.surface === "chatgpt" ? "ChatGPT via MCP" : "in app"}`}</b>
            <span className={styles.num}>{clock(step.at)}</span>
          </div>
          <div className={styles.aBubble}>
            {step.text
              .split(/\n+/)
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
          </div>
        </li>
      );
    case "interaction":
      return (
        <EventCard
          at={step.at}
          icon="ads_click"
          meta={
            step.tag ? <span className={styles.mono}>{step.tag}</span> : null
          }
          tone="prod"
        >
          {`${step.verb} “${step.target}”`}
        </EventCard>
      );
    case "network":
      return (
        <EventCard
          at={step.at}
          icon="sync_alt"
          meta={
            step.summary ? (
              <span className={step.status >= 400 ? styles.bad : undefined}>
                {step.summary}
              </span>
            ) : null
          }
          side={
            <>
              <span
                className={`${styles.status}${step.status >= 400 ? ` ${styles.statusBad}` : ""}`}
              >
                {step.status}
              </span>
              {step.durationMs === null ? null : (
                <span className={styles.time}>{duration(step.durationMs)}</span>
              )}
            </>
          }
          tone="prod"
        >
          <span className={styles.method}>{step.method}</span>
          <span className={styles.mono}>{step.path}</span>
        </EventCard>
      );
    case "screen":
      return (
        <EventCard
          at={step.at}
          icon="screenshot_monitor"
          meta={
            <>
              {step.how}
              {step.route ? (
                <>
                  {" · "}
                  <span className={styles.mono}>{step.route}</span>
                </>
              ) : null}
            </>
          }
          tone="prod"
        >
          {step.title}
          {step.detail ? (
            <span className={styles.detail}>{step.detail}</span>
          ) : null}
        </EventCard>
      );
    case "tool":
      return (
        <EventCard
          at={step.at}
          icon="build"
          meta={step.summary}
          side={
            <>
              {step.error ? (
                <span className={`${styles.status} ${styles.statusBad}`}>
                  {step.error}
                </span>
              ) : null}
              {step.durationMs === null ? null : (
                <span className={styles.time}>{duration(step.durationMs)}</span>
              )}
            </>
          }
          tone="trace"
        >
          <span className={styles.mono}>{step.name}</span>
        </EventCard>
      );
  }
}

/** The timeline that holds the cited steps, joined by the trajectory view's rail. */
export function EvidenceTimeline(props: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ol className={styles.timeline}>{props.children}</ol>;
}
