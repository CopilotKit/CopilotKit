import * as React from "react";
import type { FixtureListEntry } from "../../extension/playground/fixture-store";
import { ModelPicker, type ModelInfo } from "./ModelPicker";

interface Props {
  fixtures: FixtureListEntry[];
  currentFixtureName: string | null;
  replayMode: boolean;
  models: ModelInfo[];
  selectedModelId: string;
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
  onSelectModel,
  onNewChat,
  onLoad,
  onSave,
  onDelete,
}: Props): React.JSX.Element {
  const [saveName, setSaveName] = React.useState("");

  return (
    <aside className="playground-sidebar">
      <ModelPicker
        models={models}
        selectedId={selectedModelId}
        onSelect={onSelectModel}
      />
      <header>
        <h3>Conversations</h3>
        <button type="button" onClick={onNewChat}>
          + New chat
        </button>
      </header>
      <section className="playground-sidebar-current">
        <div className="playground-sidebar-current-header">
          <strong>Current</strong>
          {replayMode ? (
            <span className="badge badge-replay">
              replay · {currentFixtureName}
            </span>
          ) : (
            <span className="badge badge-live">live</span>
          )}
        </div>
        {!replayMode && (
          <div className="playground-sidebar-save">
            <input
              type="text"
              placeholder="Fixture name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <button
              type="button"
              disabled={!saveName.trim()}
              onClick={() => {
                onSave(saveName.trim());
                setSaveName("");
              }}
            >
              Save as fixture
            </button>
          </div>
        )}
      </section>
      <section className="playground-sidebar-list">
        <h4>Saved</h4>
        {fixtures.length === 0 ? (
          <p className="muted">No saved fixtures yet.</p>
        ) : (
          <ul>
            {fixtures.map((f) => (
              <li key={f.filePath}>
                <button
                  type="button"
                  className="link"
                  onClick={() => onLoad(f.filePath)}
                >
                  {f.metadata.name}
                </button>
                <span className="muted">
                  {" "}
                  — {f.metadata.modelVendor} {f.metadata.modelId}
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${f.metadata.name}`}
                  className="danger"
                  onClick={() => onDelete(f.filePath)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
