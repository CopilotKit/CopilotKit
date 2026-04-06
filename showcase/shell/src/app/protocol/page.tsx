export default function ProtocolPage() {
    return (
        <div className="mx-auto max-w-3xl px-6 py-16">
            <h1 className="text-2xl font-semibold text-[var(--text)] tracking-tight mb-3">
                AG-UI Protocol
            </h1>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-8">
                The AG-UI protocol defines how AI agents communicate with frontend
                applications through a standardized event stream. This section covers
                the architecture, event types, and design principles.
            </p>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-8 text-center">
                <p className="text-sm text-[var(--text-muted)]">
                    Protocol documentation is being migrated from{" "}
                    <a
                        href="https://docs.ag-ui.com"
                        className="text-[var(--violet)] underline"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        docs.ag-ui.com
                    </a>
                    . Full content coming soon.
                </p>
            </div>
        </div>
    );
}
