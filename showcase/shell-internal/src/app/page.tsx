import Link from "next/link";
import { FeatureGrid } from "@/components/feature-grid";
import { SingleCell } from "@/components/cell-single";

export default function Page() {
  return (
    <>
      <FeatureGrid title="Feature Matrix" renderCell={SingleCell} />
      <VariantLinks />
      <Legend />
    </>
  );
}

function VariantLinks() {
  const options = [
    { href: "/variants-stack", label: "Variants · Stacked" },
    { href: "/variants-tabs", label: "Variants · Tabs" },
    { href: "/variants-aggregate", label: "Variants · Aggregate" },
    { href: "/variants-grid", label: "Variants · Mini-grid" },
    { href: "/variants-strip", label: "Variants · Strip" },
  ];
  return (
    <div className="px-8 mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text-secondary)]">
        Variant layouts (experimental):
      </span>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className="text-[var(--accent)] hover:underline"
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="px-8 pb-8 mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--accent)] font-medium">Demo ↗</span>/
        <span className="text-[var(--accent)] font-medium">Code {"</>"}</span>
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
        live health probe → hosted URL
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
  );
}
