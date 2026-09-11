import { Component, useMemo, useRef, useState } from "react";
import type { ErrorInfo, MouseEvent, ReactNode } from "react";
import type { KnownBlock } from "@slack/types";
import { Renderer } from "@tightknitai/storybook-addon-slack-block-kit";
import type {
  SlackInteractionPayload,
  SlackPreviewTheme,
} from "@tightknitai/storybook-addon-slack-block-kit";
import type { Block } from "slack-blocks-to-jsx";

import { PLAYGROUND_EXAMPLES } from "./examples";
import { compileA2UIToSlackPreview } from "./pipeline";
import type { CompileA2UIResult, PlaygroundDiagnostic } from "./pipeline";

type PlaygroundExample = (typeof PLAYGROUND_EXAMPLES)[number];

type ActionLogEntry = {
  id: number;
  actionId: string;
  source: "direct click" | "renderer simulate";
  status: "pending" | "success" | "error";
  payload?: unknown;
  error?: string;
  timestamp: string;
};

type RendererBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type RendererBoundaryState = {
  error: Error | null;
};

class RendererBoundary extends Component<
  RendererBoundaryProps,
  RendererBoundaryState
> {
  state: RendererBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RendererBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Slack preview renderer failed", error, info);
  }

  componentDidUpdate(prevProps: RendererBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="renderer-error" role="alert">
          <strong>Slack preview could not render this payload.</strong>
          <span>{this.state.error.message}</span>
        </div>
      );
    }

    return this.props.children;
  }
}

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const compileInput = (input: unknown): CompileA2UIResult => {
  return compileA2UIToSlackPreview(input);
};

const emptyCompileResult = (): CompileA2UIResult => ({
  ir: [],
  blocks: [],
  diagnostics: [],
  actions: {},
});

const playgroundExamples: PlaygroundExample[] = PLAYGROUND_EXAMPLES;

const collectActionIds = (value: unknown, ids = new Set<string>()) => {
  if (!value || typeof value !== "object") return ids;

  if (Array.isArray(value)) {
    for (const item of value) collectActionIds(item, ids);
    return ids;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.action_id === "string") ids.add(record.action_id);

  for (const item of Object.values(record)) collectActionIds(item, ids);
  return ids;
};

const resolveActionId = (
  actionId: string | undefined,
  actions: Record<string, () => Promise<unknown>>,
) => {
  if (!actionId) return undefined;
  return Object.hasOwn(actions, actionId) ? actionId : undefined;
};

const makeActionDiagnostics = (
  blocks: KnownBlock[],
  actions: Record<string, () => Promise<unknown>>,
): PlaygroundDiagnostic[] => {
  const actionIds = collectActionIds(blocks);

  return [...actionIds]
    .filter((actionId) => !resolveActionId(actionId, actions))
    .map((actionId) => ({
      level: "warning",
      code: "UNMAPPED_ACTION",
      message: `Slack action "${actionId}" rendered without an A2UI action handler.`,
      path: `action_id:${actionId}`,
    }));
};

export default function App() {
  const firstExample = playgroundExamples[0];
  const [selectedExampleId, setSelectedExampleId] = useState(firstExample.id);
  const [editorValue, setEditorValue] = useState(() =>
    formatJson(firstExample.input),
  );
  const [renderedJson, setRenderedJson] = useState(() =>
    formatJson(firstExample.input),
  );
  const [compileResult, setCompileResult] = useState(() =>
    compileInput(firstExample.input),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewIssue, setPreviewIssue] = useState<string | null>(null);
  const [previewTheme, setPreviewTheme] = useState<SlackPreviewTheme>("light");
  const [logEntries, setLogEntries] = useState<ActionLogEntry[]>([]);
  const [irOpen, setIrOpen] = useState(true);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const nextLogId = useRef(1);

  const selectedExample = useMemo(
    () =>
      playgroundExamples.find((example) => example.id === selectedExampleId) ??
      firstExample,
    [firstExample, selectedExampleId],
  );

  const actionDiagnostics = useMemo(
    () => makeActionDiagnostics(compileResult.blocks, compileResult.actions),
    [compileResult],
  );
  const diagnostics = useMemo(
    () => [...compileResult.diagnostics, ...actionDiagnostics],
    [actionDiagnostics, compileResult.diagnostics],
  );
  const renderedIrJson = useMemo(
    () => formatJson(compileResult.ir),
    [compileResult.ir],
  );
  const renderedBlocksJson = useMemo(
    () => formatJson(compileResult.blocks),
    [compileResult.blocks],
  );
  const hasStaleEdits = editorValue !== renderedJson;
  const hasErrors =
    diagnostics.some((diagnostic) => diagnostic.level === "error") ||
    Boolean(parseError) ||
    Boolean(previewIssue);

  const renderPreview = () => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(editorValue) as unknown;
    } catch (error) {
      const message = `Invalid JSON: ${getErrorMessage(error)}`;
      setCompileResult(emptyCompileResult());
      setParseError(message);
      setPreviewIssue(message);
      setRenderedJson(editorValue);
      return;
    }

    try {
      setCompileResult(compileInput(parsed));
      setRenderedJson(editorValue);
      setParseError(null);
      setPreviewIssue(null);
    } catch (error) {
      const message = getErrorMessage(error);
      setCompileResult(emptyCompileResult());
      setParseError(null);
      setPreviewIssue(message);
      setRenderedJson(editorValue);
    }
  };

  const loadExample = (exampleId: string) => {
    const example =
      playgroundExamples.find((item) => item.id === exampleId) ?? firstExample;
    const json = formatJson(example.input);

    setSelectedExampleId(example.id);
    setEditorValue(json);
    setRenderedJson(json);
    setCompileResult(compileInput(example.input));
    setParseError(null);
    setPreviewIssue(null);
    setBlocksOpen(false);
  };

  const runAction = async (
    actionId: string | undefined,
    source: ActionLogEntry["source"],
  ) => {
    const resolvedActionId = resolveActionId(actionId, compileResult.actions);
    if (!actionId && !resolvedActionId) return;

    const action = resolvedActionId
      ? compileResult.actions[resolvedActionId]
      : undefined;
    const timestamp = new Date().toLocaleTimeString();
    const logId = nextLogId.current;
    nextLogId.current += 1;

    if (!action) {
      setLogEntries((entries) => [
        {
          id: logId,
          actionId: actionId ?? "unknown",
          source,
          status: "error",
          error: "No A2UI action handler was produced for this action_id.",
          timestamp,
        },
        ...entries,
      ]);
      return;
    }

    setLogEntries((entries) => [
      {
        id: logId,
        actionId: resolvedActionId ?? actionId ?? "unknown",
        source,
        status: "pending",
        timestamp,
      },
      ...entries,
    ]);

    try {
      const payload = await action();
      setLogEntries((entries) =>
        entries.map((entry) =>
          entry.id === logId ? { ...entry, status: "success", payload } : entry,
        ),
      );
    } catch (error) {
      setLogEntries((entries) =>
        entries.map((entry) =>
          entry.id === logId
            ? { ...entry, status: "error", error: getErrorMessage(error) }
            : entry,
        ),
      );
    }
  };

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(
      "button.slack_blocks_to_jsx__button_element",
    );
    const actionId = button?.getAttribute("id") ?? undefined;

    if (!actionId) return;
    void runAction(actionId, "direct click");
  };

  const handleInteraction = (payload: SlackInteractionPayload) => {
    void runAction(payload.action_id, "renderer simulate");
  };

  return (
    <main className="playground-shell">
      <section
        className="workspace"
        aria-label="A2UI to Slack Block Kit playground"
      >
        <div className="editor-pane">
          <div className="pane-header">
            <div>
              <p className="eyebrow">A2UI v0.9 source</p>
              <h1>A2UI to Slack preview</h1>
            </div>
            <span
              className={hasStaleEdits ? "status-pill dirty" : "status-pill"}
            >
              {hasStaleEdits ? "Edited" : "Rendered"}
            </span>
          </div>

          <label className="field-label" htmlFor="example-select">
            Example
          </label>
          <select
            id="example-select"
            value={selectedExampleId}
            onChange={(event) => loadExample(event.target.value)}
          >
            {playgroundExamples.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </select>
          <p className="example-description">{selectedExample.description}</p>

          <label className="field-label" htmlFor="a2ui-json">
            A2UI JSON
          </label>
          <textarea
            id="a2ui-json"
            value={editorValue}
            spellCheck={false}
            onChange={(event) => setEditorValue(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                renderPreview();
              }
            }}
          />

          <div className="editor-actions">
            <button
              className="primary-button"
              type="button"
              onClick={renderPreview}
            >
              Render preview
            </button>
            {hasStaleEdits ? (
              <span className="stale-note">
                Preview is using the last rendered JSON.
              </span>
            ) : null}
          </div>
        </div>

        <div className="preview-pane">
          <div className="pane-header compact">
            <div>
              <p className="eyebrow">Slack Block Kit output</p>
              <h2>Preview and conversion</h2>
            </div>
            <label className="theme-control">
              Preview theme
              <select
                value={previewTheme}
                onChange={(event) =>
                  setPreviewTheme(event.target.value as SlackPreviewTheme)
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>

          <section
            className="slack-preview-card"
            aria-label="Slack preview"
            onClickCapture={handlePreviewClick}
          >
            {previewIssue ? (
              <div className="renderer-error" role="alert">
                <strong>Preview is unavailable for the current input.</strong>
                <span>{previewIssue}</span>
              </div>
            ) : (
              <RendererBoundary resetKey={renderedBlocksJson}>
                <Renderer
                  blocks={compileResult.blocks as unknown as Block[]}
                  theme={previewTheme}
                  surface="message"
                  name="A2UI Preview"
                  validate
                  onInteraction={handleInteraction}
                />
              </RendererBoundary>
            )}
          </section>

          <section
            className="json-panel intermediate-panel"
            aria-labelledby="channels-ui-title"
          >
            <details
              open={irOpen}
              onToggle={(event) => setIrOpen(event.currentTarget.open)}
            >
              <summary>
                <h3 id="channels-ui-title">Intermediate Channels UI</h3>
              </summary>
              <div className="intermediate-panel-heading">
                <p className="eyebrow">A2UI → Channels UI → Block Kit</p>
                <p className="empty-state">
                  Resolved component tree used to generate the Block Kit below.
                </p>
              </div>
              <pre tabIndex={0}>
                <code>{renderedIrJson}</code>
              </pre>
            </details>
          </section>

          <details
            className="json-panel"
            aria-label="Generated Block Kit JSON"
            open={blocksOpen}
            onToggle={(event) => setBlocksOpen(event.currentTarget.open)}
          >
            <summary>Generated Block Kit JSON</summary>
            <pre tabIndex={0}>{renderedBlocksJson}</pre>
          </details>

          <section
            className="diagnostics-panel"
            aria-label="Conversion diagnostics"
          >
            <div className="panel-title-row">
              <h3>Conversion diagnostics</h3>
              <span
                className={hasErrors ? "health-badge error" : "health-badge"}
              >
                {hasErrors ? "Needs attention" : "No blocking errors"}
              </span>
            </div>
            {previewIssue && !parseError ? (
              <DiagnosticItem
                diagnostic={{
                  level: "error",
                  code: "COMPILE_ERROR",
                  message: previewIssue,
                }}
              />
            ) : null}
            {parseError ? (
              <DiagnosticItem
                diagnostic={{
                  level: "error",
                  code: "INVALID_JSON",
                  message: parseError,
                }}
              />
            ) : null}
            {diagnostics.length > 0 ? (
              diagnostics.map((diagnostic, index) => (
                <DiagnosticItem
                  key={`${diagnostic.code}-${diagnostic.path ?? index}`}
                  diagnostic={diagnostic}
                />
              ))
            ) : (
              <p className="empty-state">
                The current A2UI payload compiled cleanly.
              </p>
            )}
          </section>

          <section className="action-log" aria-label="Action log">
            <div className="panel-title-row">
              <h3>Action log</h3>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setLogEntries([])}
              >
                Clear action log
              </button>
            </div>
            {logEntries.length > 0 ? (
              <ol>
                {logEntries.map((entry) => (
                  <li key={entry.id} className={`log-entry ${entry.status}`}>
                    <div>
                      <strong>{entry.actionId}</strong>
                      <span>
                        {entry.source} at {entry.timestamp}
                      </span>
                    </div>
                    <pre>
                      {entry.status === "pending"
                        ? "Waiting for A2UI payload..."
                        : formatJson(entry.payload ?? entry.error)}
                    </pre>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-state">
                Click a rendered Slack button, or use the renderer simulator, to
                inspect the returned A2UI payload.
              </p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function DiagnosticItem({ diagnostic }: { diagnostic: PlaygroundDiagnostic }) {
  return (
    <article className={`diagnostic ${diagnostic.level}`}>
      <span>{diagnostic.level}</span>
      <div>
        <strong>{diagnostic.code}</strong>
        <p>{diagnostic.message}</p>
        {diagnostic.path ? <code>{diagnostic.path}</code> : null}
      </div>
    </article>
  );
}
