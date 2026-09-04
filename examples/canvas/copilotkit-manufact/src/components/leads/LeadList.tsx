"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import type { Lead, Segment } from "@/lib/leads/types";
import {
  segmentDotClass,
  techLevelClass,
  workshopClass,
} from "@/lib/leads/derive";

interface LeadListProps {
  leads: Lead[];
  segments: Segment[];
  selectedLeadId: string | null;
  highlightedLeadIds: string[];
  onSelect: (id: string) => void;
  /** Phase 04: ids of leads with an in-flight Notion write. */
  syncingIds?: Set<string>;
  /** Phase 04: ids of leads whose write just landed (~800ms ring flash). */
  justSyncedIds?: Set<string>;
}

export function LeadList({
  leads,
  segments,
  selectedLeadId,
  highlightedLeadIds,
  onSelect,
  syncingIds,
  justSyncedIds,
}: LeadListProps) {
  const highlighted = new Set(highlightedLeadIds);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Role / Company</th>
            <th className="px-3 py-2 font-semibold">Workshop</th>
            <th className="px-3 py-2 font-semibold">Level</th>
            <th className="px-3 py-2 font-semibold">Tools</th>
            <th className="px-3 py-2 font-semibold">Opt-in</th>
            <th className="px-3 py-2 font-semibold">Segments</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <AnimatePresence initial={false}>
            {leads.map((lead) => {
              const memberOf = segments.filter((s) =>
                s.leadIds.includes(lead.id),
              );
              const isSelected = selectedLeadId === lead.id;
              const isHighlighted = highlighted.has(lead.id);
              const isSyncing = syncingIds?.has(lead.id) ?? false;
              const isJustSynced = justSyncedIds?.has(lead.id) ?? false;
              return (
                <motion.tr
                  key={lead.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  onClick={() => onSelect(lead.id)}
                  data-syncing={isSyncing ? "true" : undefined}
                  data-just-synced={isJustSynced ? "true" : undefined}
                  className={`relative cursor-pointer hover:bg-muted/30 ${
                    isSelected
                      ? "bg-primary/5"
                      : isHighlighted
                        ? "bg-amber-400/10"
                        : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    {lead.name}
                    <div className="text-[11px] text-muted-foreground">
                      {lead.email}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {lead.role}
                    {lead.company ? (
                      <span className="text-foreground/70"> · {lead.company}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${workshopClass(
                        lead.workshop,
                      )}`}
                    >
                      {lead.workshop}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${techLevelClass(
                        lead.technical_level,
                      )}`}
                    >
                      {lead.technical_level}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {lead.tools.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className={`rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ${
                            t === "CopilotKit"
                              ? "ring-1 ring-primary/40 text-foreground"
                              : ""
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                      {lead.tools.length > 3 ? (
                        <span className="text-[10px] text-muted-foreground">
                          +{lead.tools.length - 3}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {lead.opt_in ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {memberOf.length === 0 ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        memberOf.map((s) => (
                          <span
                            key={s.id}
                            title={s.name}
                            className={`size-2 rounded-full ${segmentDotClass(s.color)}`}
                          />
                        ))
                      )}
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}
