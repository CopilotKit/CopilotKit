/**
 * Starter surfaces for the JSON editor, so hand-editing works with no model
 * at all. Each one lays out a few catalog samples (`src/a2ui/catalog/samples`)
 * under a small standard-component layout. The ids of each sample get a
 * prefix so several samples fit on one surface. A sample that leaves the
 * catalog simply drops out of its starter.
 */
import { A2UI_VERSION } from "@copilotkit/shared";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { samples } from "@/a2ui/catalog/samples";
import type { SampleComponent } from "@/a2ui/catalog/samples/types";
import type { A2UIOp } from "@/lib/run-store";

export type Starter = { id: string; label: string; ops: A2UIOp[] };

type Node = SampleComponent;
type Part = { id: string; nodes: Node[]; data?: Record<string, unknown> };

/** The sample of `name`, its root renamed to `id` and its other ids prefixed with `id-`. */
function sample(name: string, id: string): Part | null {
  const s = samples[name as keyof typeof samples];
  if (!s) return null;
  const own = new Set(s.components.map((c) => c.id));
  const rename = (ref: unknown) => (typeof ref === "string" && own.has(ref) ? (ref === "root" ? id : `${id}-${ref}`) : ref);
  const nodes = s.components.map((c) => {
    const out: Node = { ...c, id: rename(c.id) as string };
    if (Array.isArray(c.children)) out.children = c.children.map(rename);
    if (typeof c.child === "string") out.child = rename(c.child);
    return out;
  });
  return { id, nodes, data: s.data };
}

/** A node of the layout around the samples. */
const node = (id: string, component: string, props: Record<string, unknown> = {}): Part => ({ id, nodes: [{ id, component, ...props }] });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const series = (name: string, values: number[]) => values.map((y, i) => ({ x: MONTHS[i], y, series: name }));

/** A container whose children are the parts that exist. */
function container(id: string, component: string, props: Record<string, unknown>, parts: Array<Part | null>): Part {
  const kept = parts.filter((p): p is Part => !!p);
  return {
    id,
    nodes: [{ id, component, ...props, children: kept.map((p) => p.id) }, ...kept.flatMap((p) => p.nodes)],
    data: collectData(kept),
  };
}

function collectData(parts: Part[]) {
  return parts.reduce<Record<string, unknown>>((acc, p) => (p.data ? merge(acc, p.data) : acc), {});
}

/** Deep-merges the data models of the samples (the form samples all write under `/form`). */
function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [k, v] of Object.entries(source)) {
    const t = target[k];
    target[k] = t && typeof t === "object" && !Array.isArray(t) && v && typeof v === "object" && !Array.isArray(v) ? merge({ ...(t as Record<string, unknown>) }, v as Record<string, unknown>) : v;
  }
  return target;
}

function surface(surfaceId: string, root: Part, extraData?: Record<string, unknown>): A2UIOp[] {
  const data = merge(merge({}, root.data ?? {}), extraData ?? {});
  return [{ version: A2UI_VERSION, createSurface: { surfaceId, catalogId: CATALOG_ID, components: root.nodes, ...(Object.keys(data).length ? { dataModel: data } : {}) } }];
}

function build(): Starter[] {
  const dashboard = container("root", "Column", { gap: 4 }, [
    container("header", "Column", { gap: 1 }, [
      node("title", "Title", { text: "Q3 revenue review", size: "lg" }),
      node("subtitle", "Text", { text: "Billing data, refreshed hourly. Edit any value on the left and watch it re-render.", size: "sm", color: "secondary" }),
    ]),
    sample("StatGroup", "kpis"),
    // Neutral series, matching the plans in the accounts table below.
    node("revenue", "AreaChart", {
      title: "Revenue by plan",
      subtitle: "Stacked monthly revenue, USD",
      format: "currency",
      stacked: true,
      data: [
        ...series("Enterprise", [4200, 4800, 5600, 6100, 7300, 8100, 8900, 9400, 10800, 11600, 12900, 14100]),
        ...series("Scale", [2100, 2600, 3300, 3900, 4400, 5200, 6100, 6900, 7400, 8300, 9100, 9800]),
        ...series("Pro", [900, 950, 1100, 1180, 1260, 1400, 1520, 1610, 1700, 1820, 1950, 2080]),
      ],
    }),
    sample("DataTable", "accounts"),
  ]);

  const charts = container("root", "Column", { gap: 4 }, [
    node("title", "Title", { text: "Infrastructure at a glance", size: "lg" }),
    container("pair", "Grid", { columns: 2, gap: 4 }, [sample("Gauge", "gpu"), sample("PieChart", "traffic")]),
    sample("LineChart", "wau"),
    sample("Heatmap", "requests"),
  ]);

  const formParts = [sample("Combobox", "timezone"), sample("DatePicker", "launch"), sample("ButtonGroup", "period"), sample("ChipSelect", "topics"), sample("Switch", "refunds")];
  const form = container("root", "Card", { gap: 4 }, [
    container("header", "Column", { gap: 1 }, [
      node("title", "Title", { text: "Workspace settings" }),
      node("caption", "Text", { text: "Changes apply to everyone in Northwind Labs.", size: "sm", color: "secondary" }),
    ]),
    node("name", "TextField", { label: "Workspace name", value: { "@path": "/form/workspace" }, placeholder: "Acme Inc." }),
    ...formParts,
    container("actions", "Row", { gap: 2, justify: "end" }, [
      node("cancel", "Button", { label: "Cancel", onClick: { event: { name: "cancel_settings" } } }),
      node("save", "Button", { label: "Save changes", variant: "primary", onClick: { event: { name: "save_settings", context: { settings: { "@path": "/form" } } } } }),
    ]),
  ]);

  const tracker = container("root", "Column", { gap: 4 }, [
    sample("Section", "week"),
    sample("Progress", "storage"),
    sample("Timeline", "shipment"),
    sample("KeyValueList", "order"),
  ]);

  return [
    { id: "dashboard", label: "Revenue dashboard", ops: surface("starter-dashboard", dashboard) },
    { id: "charts", label: "Chart wall", ops: surface("starter-charts", charts) },
    { id: "form", label: "Settings form", ops: surface("starter-form", form, { form: { workspace: "Northwind Labs" } }) },
    { id: "tracker", label: "Order tracker", ops: surface("starter-tracker", tracker) },
  ];
}

let cache: Starter[] | null = null;
export function starters(): Starter[] {
  return (cache ??= build());
}
