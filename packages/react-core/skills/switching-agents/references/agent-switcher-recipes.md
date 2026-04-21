# Agent Switcher Recipes

Three copy-paste patterns for multi-agent UIs. All subscribe to
`copilotkit.subscribe({ onAgentsChanged })` for live agent discovery — there
is no `useAgents()` hook.

## Recipe 1 — Dropdown switcher

```tsx
"use client";
import { CopilotChat, useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

export function DropdownAgentSwitcher() {
  const { copilotkit } = useCopilotKit();
  const [agentIds, setAgentIds] = useState<string[]>(() =>
    Object.keys(copilotkit.agents ?? {}),
  );
  const [activeAgent, setActiveAgent] = useState<string>(
    () => Object.keys(copilotkit.agents ?? {})[0] ?? "default",
  );

  useEffect(() => {
    const sub = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => {
        setAgentIds(Object.keys(agents ?? {}));
      },
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);

  return (
    <div className="flex flex-col gap-3">
      <select
        value={activeAgent}
        onChange={(e) => setActiveAgent(e.target.value)}
      >
        {agentIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <CopilotChat key={activeAgent} agentId={activeAgent} />
    </div>
  );
}
```

## Recipe 2 — Tabs switcher

```tsx
"use client";
import { CopilotChat, useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

export function TabsAgentSwitcher() {
  const { copilotkit } = useCopilotKit();
  const [agentIds, setAgentIds] = useState<string[]>(() =>
    Object.keys(copilotkit.agents ?? {}),
  );
  const [activeAgent, setActiveAgent] = useState<string>(
    () => agentIds[0] ?? "default",
  );

  useEffect(() => {
    const sub = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => {
        const ids = Object.keys(agents ?? {});
        setAgentIds(ids);
        if (!ids.includes(activeAgent) && ids.length > 0) {
          setActiveAgent(ids[0]);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [copilotkit, activeAgent]);

  return (
    <div>
      <div role="tablist" className="flex gap-2 border-b">
        {agentIds.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === activeAgent}
            onClick={() => setActiveAgent(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <CopilotChat key={activeAgent} agentId={activeAgent} />
    </div>
  );
}
```

## Recipe 3 — Keyboard shortcut switcher

Cycles through agents with `Cmd/Ctrl + Shift + A`.

```tsx
"use client";
import { CopilotChat, useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

export function KeyboardAgentSwitcher() {
  const { copilotkit } = useCopilotKit();
  const [agentIds, setAgentIds] = useState<string[]>(() =>
    Object.keys(copilotkit.agents ?? {}),
  );
  const [activeAgent, setActiveAgent] = useState<string>(
    () => agentIds[0] ?? "default",
  );

  useEffect(() => {
    const sub = copilotkit.subscribe({
      onAgentsChanged: ({ agents }) => setAgentIds(Object.keys(agents ?? {})),
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCombo = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "A";
      if (!isCombo || agentIds.length === 0) return;
      e.preventDefault();
      const idx = agentIds.indexOf(activeAgent);
      const next = agentIds[(idx + 1) % agentIds.length];
      setActiveAgent(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentIds, activeAgent]);

  return (
    <div>
      <div className="text-xs opacity-60">
        Active: {activeAgent} — press ⌘/Ctrl+Shift+A to cycle
      </div>
      <CopilotChat key={activeAgent} agentId={activeAgent} />
    </div>
  );
}
```

## Key rules across all three recipes

- Use `copilotkit.subscribe({ onAgentsChanged })` — there is no `useAgents()` hook.
- Always `key={activeAgent}` on `<CopilotChat>` so thread state doesn't leak when swapping agents in the same slot.
- Clean up the subscription with `sub.unsubscribe()` in the effect cleanup.
