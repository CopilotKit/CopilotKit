import { getIntegrations } from "@/lib/registry";

export default function Home() {
  const integrations = getIntegrations();

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <main className="mx-auto max-w-5xl px-6 pt-12 pb-16">
        <header className="mb-8 border-b border-border pb-6">
          <p className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            CopilotKit Showcase
          </p>
          <h1 className="text-4xl font-bold tracking-tight">Demos</h1>
          <p className="mt-3 max-w-prose text-muted-foreground">
            Every demo of every integration. Each demo talks to the agent of the
            integration in its address.
          </p>
          <nav aria-label="Integrations" className="mt-4">
            <ul role="list" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {integrations.map((integration) => (
                <li key={integration.slug}>
                  <a
                    href={`#${integration.slug}`}
                    className="underline underline-offset-4"
                  >
                    {integration.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {integrations.map((integration) => (
          <section
            key={integration.slug}
            id={integration.slug}
            aria-labelledby={`${integration.slug}-heading`}
            className="mb-10 scroll-mt-6"
          >
            <h2
              id={`${integration.slug}-heading`}
              className="text-xl font-semibold tracking-tight"
            >
              {integration.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {integration.description}
            </p>
            <ul
              role="list"
              className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
            >
              {integration.demos.map((demo) => {
                const href = `/demos/${integration.slug}/${demo.id}`;
                return (
                  <li key={demo.id}>
                    <a href={href} className="demo-card">
                      <span className="block font-semibold">{demo.name}</span>
                      <span className="mt-2 block font-mono text-xs text-muted-foreground">
                        {href}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
