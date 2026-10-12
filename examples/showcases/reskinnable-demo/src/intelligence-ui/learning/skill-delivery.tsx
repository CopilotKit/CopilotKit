import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { CopyButton } from "../ui/data-display";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/layout";
import { Dialog } from "../ui/overlays";
import { Button } from "../ui/primitives";
import { learningNoticeStyles } from "./learning-notice";
import styles from "./skill-delivery.module.css";
import { SkillDeliveryToggle } from "./skill-delivery-toggle";

/** Builds one repository-aware setup prompt; the coding agent selects the native integration. */
export function skillDeliveryTask(containerId: string): string {
  return `Connect this application's agent to published Skills from Learning Space ${JSON.stringify(containerId)}.

Inspect the repository and use the supported CopilotKit Intelligence SDK integration for its language and framework. Check the current official docs and installed exports; report any unsupported integration. Python LangChain uses create_skill_registry_middleware with create_agent and async invocation; ADK uses SkillRegistry + SkillToolset on LlmAgent; .NET uses SkillRegistryContextProvider.CreateAgent or AddCopilotKitIntelligenceSkills.

Reuse the project's server-side Intelligence endpoint and API key. Set the container ID, follow the latest published revision, and keep credentials out of browser code. Preserve existing instructions, tools, authentication, and routing.

Verify a new agent invocation can discover published Skills, load SKILL.md, and read a supporting file. Use the SDK's refresh and denial handling; don't execute Skill scripts. Report the files changed and verification results.`;
}

/**
 * Presents publication, SDK setup, and delivery as distinct user actions.
 *
 * `banner` is the Skills tab notice (label and switch inline, status below,
 * setup action on the right). `card` is the Settings card, with the switch in
 * the card header and any caller `details` below the setup action.
 *
 * @param props - Container, delivery reads and writes, layout, and card details.
 * @returns The delivery control and its setup dialog.
 */
export function SkillDelivery(props: {
  readonly containerId: string;
  readonly details?: ReactNode;
  readonly onLoadDelivery?: (signal: AbortSignal) => Promise<boolean | null>;
  readonly onSetDelivery: (enabled: boolean) => Promise<void>;
  readonly variant?: "banner" | "card";
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  const headingId = `${id}-heading`;
  const notice = learningNoticeStyles;
  const setup = (
    <Button onClick={() => setOpen(true)} size="sm" variant="outline">
      Set up delivery
      <ArrowRight aria-hidden="true" size={14} />
    </Button>
  );
  return (
    <>
      <SkillDeliveryToggle
        key={props.containerId}
        titleId={`${id}-title`}
        onLoad={props.onLoadDelivery}
        onSave={props.onSetDelivery}
      >
        {(parts) =>
          props.variant === "card" ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className={styles.heading} id={headingId}>
                    Automatic delivery
                  </h2>
                </CardTitle>
                <CardDescription>
                  {parts.status} {parts.note}
                </CardDescription>
                <CardAction>{parts.control}</CardAction>
              </CardHeader>
              <CardContent className={styles.cardBody}>
                {parts.recovery}
                <div>{setup}</div>
                {props.details}
              </CardContent>
            </Card>
          ) : (
            <section aria-labelledby={headingId} className={notice.notice}>
              <div className={notice.text}>
                <div className={styles.label}>
                  <h2 className={notice.title} id={headingId}>
                    Automatic delivery
                  </h2>
                  {parts.control}
                </div>
                <p className={notice.description}>
                  {parts.status} {parts.note}
                </p>
                {parts.recovery}
              </div>
              <div className={notice.aside}>{setup}</div>
            </section>
          )
        }
      </SkillDeliveryToggle>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Connect skill delivery"
        description="Paste the setup prompt into your coding agent."
        footer={
          <CopyButton
            label="Copy setup prompt"
            value={skillDeliveryTask(props.containerId)}
          />
        }
      >
        <div className={styles.setup}>
          <details className={styles.task}>
            <summary>View setup prompt</summary>
            <pre tabIndex={0} aria-label="Skill delivery setup prompt">
              <code>{skillDeliveryTask(props.containerId)}</code>
            </pre>
          </details>
        </div>
      </Dialog>
    </>
  );
}
