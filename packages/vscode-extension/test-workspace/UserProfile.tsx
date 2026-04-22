import { z } from "zod";
import {
  createCatalog,
  type CatalogRenderers,
} from "@copilotkit/a2ui-renderer";
import React from "react";

const definitions = {
  ProfileHeader: {
    description: "User profile header with avatar, name, and bio",
    props: z.object({
      name: z.string(),
      role: z.string().optional(),
      bio: z.string().optional(),
      avatarUrl: z.string().optional(),
      initials: z.string().optional(),
    }),
  },

  StatRow: {
    description: "A row of statistics",
    props: z.object({
      stats: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      ),
    }),
  },

  ActivityItem: {
    description: "A single activity/timeline entry",
    props: z.object({
      action: z.string(),
      target: z.string(),
      time: z.string(),
      icon: z.enum(["commit", "pr", "review", "deploy", "comment"]).optional(),
    }),
  },

  SkillTag: {
    description: "A skill or technology tag",
    props: z.object({
      skills: z.array(z.string()),
    }),
  },

  ContactCard: {
    description: "Contact information card",
    props: z.object({
      items: z.array(
        z.object({
          type: z.string(),
          value: z.string(),
        }),
      ),
    }),
  },
};

const activityIcons: Record<string, string> = {
  commit: "\uD83D\uDCBB",
  pr: "\uD83D\uDD00",
  review: "\uD83D\uDC41\uFE0F",
  deploy: "\uD83D\uDE80",
  comment: "\uD83D\uDCAC",
};

const renderers: CatalogRenderers<typeof definitions> = {
  // Tailwind
  ProfileHeader: ({ props }) => (
    <div className="flex items-center gap-5 p-6 bg-gradient-to-r from-indigo-950 to-slate-900 rounded-2xl border border-indigo-800/30">
      <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
        {props.initials ?? props.name.slice(0, 2).toUpperCase()}
      </div>
      <div>
        <h2 className="text-xl font-bold text-white m-0">{props.name}</h2>
        {props.role && (
          <div className="text-sm text-indigo-300 mt-0.5">{props.role}</div>
        )}
        {props.bio && (
          <p className="text-sm text-slate-400 mt-2 m-0 leading-relaxed">
            {props.bio}
          </p>
        )}
      </div>
    </div>
  ),

  // Tailwind
  StatRow: ({ props }) => (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${props.stats.length}, 1fr)` }}
    >
      {props.stats.map((stat, i) => (
        <div
          key={i}
          className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center"
        >
          <div className="text-2xl font-bold text-white">{stat.value}</div>
          <div className="text-xs text-slate-400 mt-1 uppercase tracking-wider">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  ),

  // Inline styles
  ActivityItem: ({ props }) => {
    const icon = activityIcons[props.icon ?? "commit"];
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          padding: "12px 0",
          borderBottom: "1px solid #262626",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span style={{ fontSize: "18px", marginTop: "2px" }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", color: "#e5e5e5" }}>
            <strong>{props.action}</strong>{" "}
            <span style={{ color: "#818cf8" }}>{props.target}</span>
          </div>
          <div style={{ fontSize: "11px", color: "#737373", marginTop: "2px" }}>
            {props.time}
          </div>
        </div>
      </div>
    );
  },

  // Tailwind
  SkillTag: ({ props }) => (
    <div className="flex flex-wrap gap-2">
      {props.skills.map((skill, i) => (
        <span
          key={i}
          className="px-3 py-1 bg-indigo-900/50 border border-indigo-700/50 rounded-full text-xs text-indigo-300 font-medium"
        >
          {skill}
        </span>
      ))}
    </div>
  ),

  // Inline styles
  ContactCard: ({ props }) => (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a4a",
        borderRadius: "12px",
        padding: "16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {props.items.map((item, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom:
              i < props.items.length - 1 ? "1px solid #2a2a4a" : "none",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              color: "#8888aa",
              textTransform: "uppercase",
            }}
          >
            {item.type}
          </span>
          <span style={{ fontSize: "13px", color: "#c4c4ff" }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  ),
};

export const catalog = createCatalog(definitions, renderers, {
  catalogId: "copilotkit://user-profile",
  includeBasicCatalog: true,
});

export default catalog;
