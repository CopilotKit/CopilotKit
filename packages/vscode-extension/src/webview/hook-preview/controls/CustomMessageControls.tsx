import type { CustomMessagesControls as Values } from "../adapters/types";

const ROLES = ["user", "assistant", "system", "tool"];

const DEFAULT_MESSAGE = {
  id: "m1",
  role: "assistant",
  content: "",
};

const LABEL_CLS =
  "text-[11px] font-medium uppercase tracking-[0.12em] text-white/50";
const INPUT_CLS =
  "w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50";

export function CustomMessageControls({
  values,
  onChange,
}: {
  values: Values;
  onChange: (v: Values) => void;
}) {
  // Defensive: if the outer `controls` hasn't been seeded yet (first render
  // after a cross-kind hook switch), `values` may have the previous kind's
  // shape and `values.message` is undefined. Fall back to the default so we
  // never read `.role` off undefined. Matches the seeding defaults in
  // controlsFor().
  const message = values?.message ?? DEFAULT_MESSAGE;

  const setMessage = (patch: Partial<typeof DEFAULT_MESSAGE>) =>
    onChange({
      ...(values ?? ({} as Values)),
      message: { ...message, ...patch },
    });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className={LABEL_CLS}>Role</span>
        <select
          aria-label="Role"
          value={message.role}
          onChange={(e) => setMessage({ role: e.target.value })}
          className={INPUT_CLS}
        >
          {ROLES.map((r) => (
            <option key={r} value={r} className="bg-neutral-900">
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL_CLS}>ID</span>
        <input
          aria-label="ID"
          type="text"
          value={message.id}
          onChange={(e) => setMessage({ id: e.target.value })}
          className={INPUT_CLS}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL_CLS}>Content</span>
        <textarea
          aria-label="Content"
          value={message.content}
          onChange={(e) => setMessage({ content: e.target.value })}
          rows={4}
          spellCheck={false}
          className="block w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-sky-400/60 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
          style={{ minHeight: 96 }}
        />
      </label>
    </div>
  );
}
