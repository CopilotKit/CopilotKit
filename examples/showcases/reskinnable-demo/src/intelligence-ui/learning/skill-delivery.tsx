import { useId, useState } from 'react';
import { CopyButton } from '../ui/data-display';
import { Dialog } from '../ui/overlays';
import { Button } from '../ui/primitives';
import styles from './skill-delivery.module.css';
import { SkillDeliveryToggle } from './skill-delivery-toggle';

/** Builds one repository-aware setup prompt; the coding agent selects the native integration. */
export function skillDeliveryTask(containerId: string): string {
  return `Connect this application's agent to published Skills from Learning Space ${JSON.stringify(containerId)}.

Inspect the repository and use the supported CopilotKit Intelligence SDK integration for its language and framework. Check the current official docs and installed exports; report any unsupported integration. Python LangChain uses create_skill_registry_middleware with create_agent and async invocation; ADK uses SkillRegistry + SkillToolset on LlmAgent; .NET uses SkillRegistryContextProvider.CreateAgent or AddCopilotKitIntelligenceSkills.

Reuse the project's server-side Intelligence endpoint and API key. Set the container ID, follow the latest published revision, and keep credentials out of browser code. Preserve existing instructions, tools, authentication, and routing.

Verify a new agent invocation can discover published Skills, load SKILL.md, and read a supporting file. Use the SDK's refresh and denial handling; don't execute Skill scripts. Report the files changed and verification results.`;
}

/** Presents publication, SDK setup, and delivery as distinct user actions. */
export function SkillDelivery(props: {
  readonly containerId: string;
  readonly onLoadDelivery?: (signal: AbortSignal) => Promise<boolean | null>;
  readonly onSetDelivery: (enabled: boolean) => Promise<void>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={styles.delivery} aria-labelledby={`${id}-title`}>
      <div className={styles.overview}>
        <SkillDeliveryToggle
          key={props.containerId}
          titleId={`${id}-title`}
          onLoad={props.onLoadDelivery}
          onSave={props.onSetDelivery}
        />
        <div className={styles.actions}>
          <Button onClick={() => setOpen(true)}>Set up skill delivery</Button>
        </div>
      </div>
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
    </section>
  );
}
