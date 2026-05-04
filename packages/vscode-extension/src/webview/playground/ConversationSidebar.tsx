import * as React from "react";
import type { FixtureListEntry } from "../../extension/playground/fixture-store";
import { ModelPicker, type ModelInfo } from "./ModelPicker";
import { ResizeHandle } from "./ResizeHandle";

interface Props {
  fixtures: FixtureListEntry[];
  currentFixtureName: string | null;
  replayMode: boolean;
  models: ModelInfo[];
  selectedModelId: string;
  /**
   * Whether the sidebar is collapsed. The collapse chevron itself
   * lives at the layout root (in App.tsx) so it stays visible when
   * the sidebar is fully hidden; we only consume the flag here to
   * suppress the resize handle in collapsed state.
   */
  collapsed: boolean;
  onSelectModel: (id: string) => void;
  onNewChat: () => void;
  onLoad: (filePath: string) => void;
  onSave: (name: string) => void;
  onDelete: (filePath: string) => void;
}

export function ConversationSidebar({
  fixtures,
  currentFixtureName,
  replayMode,
  models,
  selectedModelId,
  collapsed,
  onSelectModel,
  onNewChat,
  onLoad,
  onSave,
  onDelete,
}: Props): React.JSX.Element {
  const [saveName, setSaveName] = React.useState("");

  return (
    <aside className="playground-sidebar">
      {!collapsed && (
        <ResizeHandle
          cssVar="--playground-sidebar-w"
          side="right"
          min={160}
          max={400}
          defaultPx={200}
          storageKey="copilotkit.playground.sidebar-width"
          className="playground-sidebar-resize"
        />
      )}
      <div className="playground-sidebar-scroll">
        {/* MODEL — picks which vscode.lm chat model the playground
            sends requests to. Always its own card so it's visually
            distinct from the recording / replay controls below. */}
        <section className="playground-sidebar-section playground-sidebar-section-model">
          <div className="playground-sidebar-section-title">Model</div>
          <ModelPicker
            models={models}
            selectedId={selectedModelId}
            onSelect={onSelectModel}
          />
        </section>

        {/* RECORDING — the live chat is being recorded; user can save
            the conversation as a fixture for later replay. In replay
            mode this section explains that recording is paused. */}
        <section className="playground-sidebar-section">
          <div className="playground-sidebar-section-title">
            <span>Recording</span>
            {replayMode ? (
              <span className="badge badge-replay">replay</span>
            ) : (
              <span className="badge badge-live">live</span>
            )}
          </div>
          {replayMode ? (
            <p className="playground-sidebar-help">
              Replaying <code>{currentFixtureName}</code>. Start a new chat to
              record again.
            </p>
          ) : (
            <p className="playground-sidebar-help">
              Save this conversation to replay it later — fixtures are stored
              under <code>.copilotkit/fixtures/</code> in your workspace.
            </p>
          )}
          {!replayMode && (
            <div className="playground-sidebar-save">
              <input
                type="text"
                placeholder="Name this conversation…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <button
                type="button"
                className="playground-sidebar-save-button"
                disabled={!saveName.trim()}
                onClick={() => {
                  onSave(saveName.trim());
                  setSaveName("");
                }}
              >
                Save
              </button>
            </div>
          )}
          <button
            type="button"
            className="playground-sidebar-newchat"
            onClick={onNewChat}
          >
            + New chat
          </button>
        </section>

        {/* SAVED — list of replayable fixtures. Click ▶ to play a
            recording back in the chat surface; click ✕ (twice) to
            delete one. */}
        <section className="playground-sidebar-section">
          <div className="playground-sidebar-section-title">Saved replays</div>
          {fixtures.length === 0 ? (
            <p className="playground-sidebar-help">No saved fixtures yet.</p>
          ) : (
            <ul className="playground-sidebar-fixtures">
              {fixtures.map((f) => (
                <FixtureRow
                  key={f.filePath}
                  fixture={f}
                  onLoad={onLoad}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

interface FixtureRowProps {
  fixture: FixtureListEntry;
  onLoad: (filePath: string) => void;
  onDelete: (filePath: string) => void;
}

/**
 * Single row in the saved-fixtures list. Each row has:
 *   - Fixture name (read-only label, with model info on hover via `title`)
 *   - ▶ Replay button — drives the chat into replay mode for this fixture
 *   - ✕ Delete button — two-click confirm: first click flips to a "Confirm?"
 *     state, second click within 4s actually deletes. Avoids the
 *     `window.confirm` modal which is awkward inside a webview.
 */
function FixtureRow({
  fixture,
  onLoad,
  onDelete,
}: FixtureRowProps): React.JSX.Element {
  const [confirming, setConfirming] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleDeleteClick = (): void => {
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 4000);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    onDelete(fixture.filePath);
  };

  const modelLabel = `${fixture.metadata.modelVendor} ${fixture.metadata.modelId}`;

  return (
    <li className="playground-sidebar-fixture">
      <span
        className="playground-sidebar-fixture-name"
        title={`Recorded with ${modelLabel}`}
      >
        {fixture.metadata.name}
      </span>
      <button
        type="button"
        className="playground-sidebar-fixture-action playground-sidebar-fixture-action-play"
        aria-label={`Replay ${fixture.metadata.name}`}
        title="Replay in chat"
        onClick={() => onLoad(fixture.filePath)}
      >
        ▶
      </button>
      <button
        type="button"
        className={
          "playground-sidebar-fixture-action danger" +
          (confirming ? " confirming" : "")
        }
        aria-label={
          confirming
            ? `Confirm delete ${fixture.metadata.name}`
            : `Delete ${fixture.metadata.name}`
        }
        title={confirming ? "Click again to confirm" : "Delete"}
        onClick={handleDeleteClick}
      >
        {confirming ? "?" : "✕"}
      </button>
    </li>
  );
}
