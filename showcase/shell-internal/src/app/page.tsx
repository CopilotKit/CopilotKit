import { Fragment } from "react";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
} from "@/lib/registry";
import {
  bundleGeneratedAt,
  getDemoStatus,
  healthBadge,
  isBundleStale,
  qaBadge,
  testBadge,
  type BadgeTone,
} from "@/lib/status";

const SHELL_URL = process.env.NEXT_PUBLIC_SHELL_URL || "http://localhost:3000";

const TONE_CLASS: Record<BadgeTone, string> = {
  green: "text-[var(--ok)]",
  amber: "text-[var(--amber)]",
  red: "text-[var(--danger)]",
  gray: "text-[var(--text-muted)]",
  blue: "text-[var(--accent)]",
};

function Badge({
  name,
  state,
  href,
  title,
}: {
  name: string;
  state: { label: string; tone: BadgeTone };
  href?: string;
  title?: string;
}) {
  const cls = `tabular-nums ${TONE_CLASS[state.tone]}`;
  const inner = (
    <span className="whitespace-nowrap" title={title}>
      <span className="text-[var(--text-muted)]">{name}</span>{" "}
      <span className={cls}>{state.label}</span>
    </span>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

function HealthDot({
  state,
  title,
}: {
  state: { label: string; tone: BadgeTone };
  title?: string;
}) {
  const dotColor: Record<BadgeTone, string> = {
    green: "bg-[var(--ok)]",
    amber: "bg-[var(--amber)]",
    red: "bg-[var(--danger)]",
    gray: "bg-[var(--text-muted)]",
    blue: "bg-[var(--accent)]",
  };
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      title={title}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotColor[state.tone]}`}
      />
      <span className={`tabular-nums ${TONE_CLASS[state.tone]}`}>
        {state.label}
      </span>
    </span>
  );
}

export default function InternalMatrixPage() {
  const integrations = getIntegrations();
  const features = getFeatures();
  const categories = getFeatureCategories();
  const bundleStale = isBundleStale();
  const generatedAt = bundleGeneratedAt();

  const featuresByCategory = categories
    .map((cat) => ({
      ...cat,
      features: features.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  return (
    <div className="p-8 max-w-[100vw]">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Feature Matrix</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {features.length} features × {integrations.length} integrations.{" "}
          <span
            className={
              bundleStale ? "text-[var(--danger)]" : "text-[var(--text-muted)]"
            }
          >
            Status bundle: {new Date(generatedAt).toLocaleString()}
            {bundleStale && " (stale — signals shown as ?)"}
          </span>
        </p>
      </header>

      <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-[var(--bg-muted)] px-4 py-3 text-left min-w-[260px] border-b border-[var(--border)]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Feature
                </span>
              </th>
              {integrations.map((integration) => (
                <th
                  key={integration.slug}
                  className="sticky top-0 z-20 bg-[var(--bg-muted)] px-3 py-3 text-left min-w-[220px] border-b border-l border-[var(--border)] font-normal"
                >
                  <div className="text-xs font-semibold text-[var(--text)]">
                    {integration.name}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {integration.language}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {featuresByCategory.map((cat) => (
              <Fragment key={cat.id}>
                <tr>
                  <td
                    colSpan={integrations.length + 1}
                    className="sticky left-0 px-4 pt-5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-surface)]"
                  >
                    {cat.name}
                  </td>
                </tr>
                {cat.features.map((feature) => (
                  <tr
                    key={feature.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]"
                  >
                    <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-2 border-r border-[var(--border)]">
                      <div
                        className="font-medium text-[var(--text)]"
                        title={feature.description}
                      >
                        {feature.name}
                      </div>
                    </td>
                    {integrations.map((integration) => {
                      const supported = integration.features.includes(
                        feature.id,
                      );
                      const demo = integration.demos.find(
                        (d) => d.id === feature.id,
                      );
                      return (
                        <td
                          key={integration.slug}
                          className="border-l border-[var(--border)] px-3 py-2 align-middle text-left"
                        >
                          {supported && demo ? (
                            <DemoCell
                              slug={integration.slug}
                              featureId={feature.id}
                              bundleStale={bundleStale}
                            />
                          ) : supported ? (
                            <div
                              className="text-center text-[11px] text-[var(--text-muted)]"
                              title="Feature supported but no demo yet"
                            >
                              —
                            </div>
                          ) : (
                            <div
                              className="text-center text-base text-[var(--danger)]"
                              title="Not supported"
                            >
                              ✗
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--accent)] font-medium">demo · code</span>
          open hosted preview / source
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">E2E ✓</span>/
          <span className="text-[var(--amber)]">amber</span>/
          <span className="text-[var(--danger)]">✗</span>
          end-to-end (green &lt;6h · amber older · red fail/none)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">Smoke ✓</span>
          smoke test, same color rules
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">QA 3d</span>
          days since human QA (green &lt;7d · amber &lt;30d · red older/never)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--ok)]" />
            up
          </span>
          live health probe
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">?</span>
          status bundle is stale
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">—</span>
          supported, no demo yet
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--danger)]">✗</span>
          not supported
        </div>
      </div>
    </div>
  );
}

function DemoCell({
  slug,
  featureId,
  bundleStale,
}: {
  slug: string;
  featureId: string;
  bundleStale: boolean;
}) {
  const s = getDemoStatus(slug, featureId);
  const e2e = testBadge(s?.e2e ?? null, bundleStale);
  const smoke = testBadge(s?.smoke ?? null, bundleStale);
  const qa = qaBadge(s?.qa ?? null, bundleStale);
  const health = healthBadge(
    s?.health ?? { status: "unknown", checked_at: "" },
    bundleStale,
  );

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-2 text-xs font-medium">
        <a
          href={`${SHELL_URL}/integrations/${slug}/${featureId}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
        >
          demo
        </a>
        <span className="text-[var(--border-strong)]">·</span>
        <a
          href={`${SHELL_URL}/integrations/${slug}/${featureId}/code`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
        >
          code
        </a>
      </div>
      <div className="flex items-center gap-2.5">
        <Badge
          name="E2E"
          state={e2e}
          href={s?.e2e?.url}
          title={
            s?.e2e?.ran_at
              ? `Last run ${new Date(s.e2e.ran_at).toLocaleString()} — ${s.e2e.status}`
              : "No E2E suite"
          }
        />
        <Badge
          name="Smoke"
          state={smoke}
          href={s?.smoke?.url}
          title={
            s?.smoke?.ran_at
              ? `Last run ${new Date(s.smoke.ran_at).toLocaleString()} — ${s.smoke.status}`
              : "No smoke test"
          }
        />
        <Badge
          name="QA"
          state={qa}
          href={s?.qa?.url}
          title={
            s?.qa?.reviewed_at
              ? `Last reviewed ${new Date(s.qa.reviewed_at).toLocaleString()}`
              : "Never reviewed"
          }
        />
        <HealthDot
          state={health}
          title={
            s?.health?.checked_at
              ? `Health probed ${new Date(s.health.checked_at).toLocaleString()} — ${s.health.status}`
              : "No health probe"
          }
        />
      </div>
    </div>
  );
}
