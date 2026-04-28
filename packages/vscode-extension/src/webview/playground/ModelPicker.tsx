import * as React from "react";

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  vendor: string;
}

interface Props {
  models: ModelInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function ModelPicker({
  models,
  selectedId,
  onSelect,
}: Props): React.JSX.Element | null {
  if (models.length === 0) return null;
  return (
    <div className="playground-model-picker">
      <label htmlFor="copilotkit-model-picker">Model</label>
      <select
        id="copilotkit-model-picker"
        value={selectedId || models[0].id}
        onChange={(e) => onSelect(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.vendor}: {m.family})
          </option>
        ))}
      </select>
    </div>
  );
}
