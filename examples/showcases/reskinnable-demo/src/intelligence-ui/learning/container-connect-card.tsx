import { useCopyToClipboard } from "../ui/data-display";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/layout";
import { Button } from "../ui/primitives";

import { LearningNotice } from "./learning-notice";
import styles from "./learning-page.module.css";
import importStyles from "./learning-thread-binding.module.css";

/**
 * Builds the Runtime wiring prompt for one Container.
 *
 * Written as a prompt for a coding agent rather than as a snippet because the
 * change lands inside an existing `CopilotRuntime` setup that this page cannot
 * see. Naming what must stay unchanged is the part a snippet gets wrong.
 *
 * @param containerId - Stable Container id to bind new Threads to.
 * @returns The copyable prompt text.
 */
export function runtimeIntegrationPrompt(containerId: string): string {
  return `Route future CopilotKit Threads to the Learning Space \`${containerId}\`.

Find the server-side \`CopilotKitIntelligence\` instance passed to \`CopilotRuntime\`. Add:

getLearningContainerId: () => '${containerId}',

to its existing config. Keep the current API key, endpoints, agents, user identity, auth, and Thread setup unchanged.

Add a focused test, then verify the change by creating and completing one brand-new Thread. This callback applies to new Threads. Threads can belong to multiple spaces. Import existing Threads that are not already in this space from the Learning UI.`;
}

/**
 * Renders wiring instructions until a Container receives a direct app Thread.
 *
 * @param props - Container to bind Threads to.
 * @returns The connect-your-Runtime card.
 */
export function ContainerConnectCard(props: {
  readonly containerId: string;
  readonly containerName: string;
  /** Settings layout: a shared Card with the copy action in its header. */
  readonly card?: boolean;
  readonly compact?: boolean;
  readonly inline?: boolean;
}): React.JSX.Element {
  const prompt = runtimeIntegrationPrompt(props.containerId);
  const promptCopy = useCopyToClipboard({ resetKey: prompt });
  // An unavailable clipboard gets the same select-the-text fallback.
  const copyFailed =
    promptCopy.status === "failed" || promptCopy.status === "unavailable";
  const announced =
    promptCopy.announcedStatus === "unavailable"
      ? "failed"
      : promptCopy.announcedStatus;

  const copy = (): void => {
    promptCopy.copy(prompt);
  };

  const copyStatus = (
    <p
      role="status"
      className={
        announced === "idle" ? "cpki-visually-hidden" : importStyles.copyStatus
      }
    >
      {announced === "copied"
        ? "Integration prompt copied."
        : announced === "failed"
          ? "Copy failed. Open the integration prompt below and select the text."
          : ""}
    </p>
  );
  const promptDetails = (
    <details
      className={importStyles.integrationDetails}
      open={copyFailed || undefined}
    >
      <summary>View integration prompt</summary>
      <pre aria-label="Runtime integration prompt" tabIndex={0}>
        <code>{prompt}</code>
      </pre>
    </details>
  );

  if (props.card) {
    return (
      <Card className={styles.connectSettingsCard}>
        <CardHeader>
          <CardTitle>
            <h2 className={styles.cardHeading}>
              Connect your agent to this Learning Space
            </h2>
          </CardTitle>
          <CardDescription>
            Send new conversations here automatically. We haven’t received a new
            thread directly from your app yet.
          </CardDescription>
          <CardAction>
            <Button onClick={copy} size="sm" variant="primary">
              Copy integration prompt
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className={styles.connectSettingsBody}>
          <small>Paste it into your coding agent to connect your app.</small>
          {copyStatus}
          {promptDetails}
        </CardContent>
      </Card>
    );
  }

  if (props.inline) {
    // The tab reminder is a Learning notice like the readiness strip below
    // it, with a quieter action so the page keeps one primary.
    return (
      <div className={importStyles.sdkReminder}>
        <LearningNotice
          aria-label="Connect your agent"
          action={
            <Button onClick={copy} size="sm" variant="outline">
              Copy integration prompt
            </Button>
          }
          description="Send new conversations here automatically. We haven’t received a new thread directly from your app yet."
          headingLevel={2}
          title="Connect your agent"
        />
        {copyStatus}
        {promptDetails}
      </div>
    );
  }

  if (props.compact) {
    return (
      <section
        className={importStyles.sdkSetup}
        aria-label="Connect your agent"
      >
        <div className={importStyles.sdkSetupCopy}>
          <span className={importStyles.setupIcon} aria-hidden="true">
            &lt;/&gt;
          </span>
          <h2>Connect your agent</h2>
          <p>
            Send new conversations to this space. Learning turns completed
            threads into Insights and Skills.
          </p>
          <Button onClick={copy} variant="primary">
            Copy integration prompt
          </Button>
          <small>Paste it into your coding agent to connect your app.</small>
          {copyStatus}
        </div>
        {promptDetails}
      </section>
    );
  }
  return (
    <div className={styles.connectGrid}>
      <section
        aria-labelledby="connect-steps-title"
        className={styles.connectCopy}
      >
        <p className={styles.connectEyebrow}>{props.containerName}</p>
        <h3 id="connect-steps-title">No Threads yet</h3>
        <p>
          Send completed Threads to this space, then analyze them to find
          evidence-backed Insights and Skill candidates.
        </p>
        <ol className={styles.setupList}>
          <li>
            <strong>Connect your app</strong>
            <span>
              Return this space ID from your Runtime for new Threads. Import
              existing Threads from the Learning UI.
            </span>
          </li>
          <li>
            <strong>Complete new Threads</strong>
            <span>
              Each newly completed Thread joins this space&apos;s next analysis.
            </span>
          </li>
          <li>
            <strong>Analyze Threads</strong>
            <span>
              Review the Insights and Skill candidates Learning finds.
            </span>
          </li>
        </ol>
      </section>
      <section
        aria-labelledby="connect-container-title"
        className={styles.connectCard}
      >
        <span aria-hidden="true" className={styles.connectMark}>
          &lt;/&gt;
        </span>
        <h3 id="connect-container-title">Connect this space</h3>
        <p>Copy this prompt into the coding agent you use for this app.</p>
        <pre
          aria-label="Runtime integration prompt"
          className={styles.integrationCode}
          tabIndex={0}
        >
          <code>{prompt}</code>
        </pre>
        <Button
          className={styles.connectAction}
          onClick={copy}
          variant="primary"
        >
          Copy integration prompt
        </Button>
        <p
          className={
            announced === "idle" ? "cpki-visually-hidden" : styles.help
          }
          role="status"
        >
          {announced === "copied"
            ? "Integration prompt copied."
            : announced === "failed"
              ? "Copy failed. Select the text instead."
              : ""}
        </p>
      </section>
    </div>
  );
}
