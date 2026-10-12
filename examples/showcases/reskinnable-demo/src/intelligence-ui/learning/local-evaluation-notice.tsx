import styles from "./local-evaluation-notice.module.css";

export interface LocalEvaluationStatus {
  readonly modelConfigured: boolean;
  readonly expired: boolean;
}

/** Shows installation setup facts without claiming that a model run succeeded. */
export function LocalEvaluationNotice(props: {
  readonly status?: LocalEvaluationStatus;
}): React.JSX.Element | null {
  if (props.status === undefined) return null;
  if (props.status.expired) {
    return (
      <section aria-label="Local evaluation expired" className={styles.notice}>
        <h2>Local evaluation expired</h2>
        <p>
          New licensed runs are blocked. Saved Threads and Learning results
          remain available. Renew this installation with{" "}
          <code>copilotkit local renew</code>, then reload this page.
        </p>
      </section>
    );
  }
  if (props.status.modelConfigured) {
    return (
      <section aria-label="Learning model configured" className={styles.notice}>
        <h2>Learning model configured</h2>
        <p>
          Configuration does not verify model access. Run Learning and inspect
          its results to confirm that this installation can use the model.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="No AI model connected" className={styles.notice}>
      <h2>No AI model connected</h2>
      <p>
        Automatic Learning uses a model from your own provider. No model or
        model credentials are bundled. Connect one with{" "}
        <code>copilotkit local setup</code>, then reload this page. Your saved
        data remains available.
      </p>
    </section>
  );
}
