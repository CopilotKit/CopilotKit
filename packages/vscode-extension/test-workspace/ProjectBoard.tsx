import { z } from "zod";
import {
  createCatalog,
  type CatalogRenderers,
} from "@copilotkit/a2ui-renderer";
import React from "react";

const definitions = {
  BoardHeader: {
    description: "Project board header with title and description",
    props: z.object({
      title: z.string(),
      description: z.string().optional(),
      totalTasks: z.number().optional(),
      completedTasks: z.number().optional(),
    }),
  },

  KanbanColumn: {
    description: "A kanban column with a title and count",
    props: z.object({
      title: z.string(),
      count: z.number(),
      color: z.string().optional(),
      children: z.array(z.string()).optional(),
    }),
  },

  TaskCard: {
    description: "A task card with title, assignee, priority, and labels",
    props: z.object({
      title: z.string(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      labels: z.array(z.string()).optional(),
      dueDate: z.string().optional(),
    }),
  },

  MilestoneBar: {
    description: "A milestone progress bar",
    props: z.object({
      name: z.string(),
      dueDate: z.string(),
      progress: z.number(),
      status: z.enum(["on-track", "at-risk", "behind"]).optional(),
    }),
  },

  TeamMember: {
    description: "A team member avatar with name and task count",
    props: z.object({
      members: z.array(
        z.object({
          name: z.string(),
          initials: z.string(),
          tasks: z.number(),
          color: z.string().optional(),
        }),
      ),
    }),
  },
};

const priorityConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  low: { label: "Low", color: "text-slate-400", bg: "bg-slate-700/50" },
  medium: { label: "Med", color: "text-blue-400", bg: "bg-blue-900/40" },
  high: { label: "High", color: "text-orange-400", bg: "bg-orange-900/40" },
  critical: { label: "Crit", color: "text-red-400", bg: "bg-red-900/40" },
};

const renderers: CatalogRenderers<typeof definitions> = {
  // Tailwind
  BoardHeader: ({ props }) => {
    const pct =
      props.totalTasks && props.completedTasks
        ? Math.round((props.completedTasks / props.totalTasks) * 100)
        : null;
    return (
      <div className="bg-gradient-to-r from-emerald-950 to-teal-950 border border-emerald-800/30 rounded-2xl p-6">
        <h1 className="text-xl font-bold text-white m-0">{props.title}</h1>
        {props.description && (
          <p className="text-sm text-emerald-300/70 mt-1 m-0">
            {props.description}
          </p>
        )}
        {pct !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-emerald-400 mb-1">
              <span>
                {props.completedTasks}/{props.totalTasks} tasks
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 bg-emerald-900/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  },

  // Inline styles
  KanbanColumn: ({ props, children }) => (
    <div
      style={{
        background: "#161616",
        border: "1px solid #2a2a2a",
        borderRadius: "12px",
        padding: "16px",
        minWidth: "250px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: props.color ?? "#666",
            }}
          />
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#e5e5e5" }}>
            {props.title}
          </span>
        </div>
        <span
          style={{
            fontSize: "11px",
            color: "#737373",
            background: "#262626",
            padding: "2px 8px",
            borderRadius: "10px",
          }}
        >
          {props.count}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {props.children?.map((childId) => children(childId))}
      </div>
    </div>
  ),

  // Tailwind
  TaskCard: ({ props }) => {
    const pri = props.priority ? priorityConfig[props.priority] : null;
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 hover:border-neutral-600 transition-colors">
        <div className="text-sm text-neutral-200 font-medium leading-snug">
          {props.title}
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {pri && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${pri.bg} ${pri.color}`}
            >
              {pri.label}
            </span>
          )}
          {props.labels?.map((label, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400"
            >
              {label}
            </span>
          ))}
        </div>
        <div className="flex justify-between items-center mt-3 text-xs text-neutral-500">
          {props.assignee && <span>{props.assignee}</span>}
          {props.dueDate && <span>{props.dueDate}</span>}
        </div>
      </div>
    );
  },

  // Tailwind
  MilestoneBar: ({ props }) => {
    const statusColors: Record<string, string> = {
      "on-track": "text-green-400",
      "at-risk": "text-yellow-400",
      behind: "text-red-400",
    };
    const barColors: Record<string, string> = {
      "on-track": "bg-green-500",
      "at-risk": "bg-yellow-500",
      behind: "bg-red-500",
    };
    const s = props.status ?? "on-track";
    return (
      <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-neutral-200">
            {props.name}
          </span>
          <span className={`text-xs ${statusColors[s]} capitalize`}>
            {s.replace("-", " ")}
          </span>
        </div>
        <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full rounded-full ${barColors[s]}`}
            style={{ width: `${props.progress}%` }}
          />
        </div>
        <div className="text-xs text-neutral-500">Due: {props.dueDate}</div>
      </div>
    );
  },

  // Inline styles
  TeamMember: ({ props }) => (
    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
      {props.members.map((m, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: "10px",
            padding: "10px 14px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: m.color ?? "#4f46e5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: 700,
              color: "white",
            }}
          >
            {m.initials}
          </div>
          <div>
            <div
              style={{ fontSize: "13px", fontWeight: 500, color: "#e5e5e5" }}
            >
              {m.name}
            </div>
            <div style={{ fontSize: "11px", color: "#737373" }}>
              {m.tasks} tasks
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const catalog = createCatalog(definitions, renderers, {
  catalogId: "copilotkit://project-board",
  includeBasicCatalog: true,
});

export default catalog;
