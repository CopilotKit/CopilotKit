import React from "react";

const tasks = [
  { title: "Q3 launch plan", meta: "Updated 2h ago", status: "In review" },
  { title: "Onboarding revamp", meta: "Updated yesterday", status: "Draft" },
  { title: "Pricing page copy", meta: "Updated 3d ago", status: "Shipped" },
  { title: "Customer interviews", meta: "Updated last week", status: "Draft" },
];

/**
 * A plain host application used behind sidebars, popups and toggle buttons,
 * so layout components can be judged in context.
 */
export const HostPage: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="flex h-14 items-center gap-3 border-b border-border px-6">
      <div className="size-6 rounded-md bg-primary" />
      <span className="text-sm font-semibold">Acme Workspace</span>
      <nav className="ml-6 hidden gap-5 text-sm text-muted-foreground sm:flex">
        <span className="text-foreground">Projects</span>
        <span>Docs</span>
        <span>Team</span>
      </nav>
    </header>
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Draft updates, summarize discussions and track action items with the
        assistant while you stay in context.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {tasks.map((task) => (
          <article
            key={task.title}
            className="rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{task.title}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {task.status}
              </span>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">{task.meta}</p>
          </article>
        ))}
      </div>
    </main>
    {children}
  </div>
);
