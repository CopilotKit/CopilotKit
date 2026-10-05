import { CopyButton } from '../ui/data-display';

import styles from './learning-page.module.css';

/** The command that adds a Learning model to a local evaluation stack. */
export const LEARNING_SETUP_COMMAND = 'copilotkit local setup';

/**
 * Tells the evaluator how to connect a model: the command, what it asks for,
 * and the reload that picks it up, with a copy button for the command.
 *
 * @returns The fix line for the readiness card.
 */
export function LearningModelMissingHint(): React.JSX.Element {
  return (
    <div className={styles.modelHint}>
      <p>
        To connect one, run this in your app folder, choose OpenAI, Anthropic,
        or a compatible endpoint, and enter its API key:
      </p>
      <div className={styles.modelCommand} data-command-row>
        <code>{LEARNING_SETUP_COMMAND}</code>
        <CopyButton
          value={LEARNING_SETUP_COMMAND}
          label="Copy command"
          copiedLabel="Copied"
          size="icon-sm"
          variant="ghost"
        />
      </div>
      <p>Then reload this page.</p>
    </div>
  );
}
