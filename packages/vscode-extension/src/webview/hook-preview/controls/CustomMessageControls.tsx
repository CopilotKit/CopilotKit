import type { CustomMessagesControls as Values } from "../adapters/types";

const ROLES = ["user", "assistant", "system", "tool"];

export function CustomMessageControls({
  values,
  onChange,
}: {
  values: Values;
  onChange: (v: Values) => void;
}) {
  return (
    <div className="hook-controls">
      <label className="hook-control-row">
        <span>Role</span>
        <select
          aria-label="Role"
          value={values.message.role}
          onChange={(e) =>
            onChange({
              ...values,
              message: { ...values.message, role: e.target.value },
            })
          }
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="hook-control-row">
        <span>ID</span>
        <input
          aria-label="ID"
          type="text"
          value={values.message.id}
          onChange={(e) =>
            onChange({
              ...values,
              message: { ...values.message, id: e.target.value },
            })
          }
        />
      </label>
      <label className="hook-control-row">
        <span>Content</span>
        <textarea
          aria-label="Content"
          value={values.message.content}
          onChange={(e) =>
            onChange({
              ...values,
              message: { ...values.message, content: e.target.value },
            })
          }
        />
      </label>
    </div>
  );
}
