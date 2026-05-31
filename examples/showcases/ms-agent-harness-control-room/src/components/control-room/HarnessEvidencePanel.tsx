"use client";

import {
  Brain,
  CheckCircle2,
  ClipboardList,
  Database,
  FileCode2,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useControlRoomAgentState,
  useControlRoomLocal,
} from "@/hooks/use-control-room-state";
import { cn } from "@/lib/utils";

export function HarnessEvidencePanel() {
  const agentState = useControlRoomAgentState();
  const { localState } = useControlRoomLocal();
  const observers = agentState.observers;
  const approvals = agentState.approvals;
  const skills = agentState.skills ?? [];
  const featureSupport = localState.featureSupport;

  return (
    <div className="flex h-full w-full min-w-0 max-w-full flex-col gap-3 overflow-hidden p-4">
      <EvidenceMetric
        icon={<Brain size={16} />}
        label="Mode"
        value={agentState.mode}
        tone={
          agentState.mode === "Act"
            ? "emerald"
            : agentState.mode === "Review"
              ? "cyan"
              : "amber"
        }
        detail="AgentModeProvider"
      />
      <EvidenceMetric
        icon={<ClipboardList size={16} />}
        label="Todos"
        value={`${agentState.todos.filter((todo) => todo.status === "completed").length}/${agentState.todos.length}`}
        detail={
          agentState.todos.length === 0
            ? "Awaiting plan"
            : agentState.todos.map((todo) => todo.label).slice(0, 2).join(" · ")
        }
      />
      <EvidenceMetric
        icon={<FileCode2 size={16} />}
        label="Files"
        value={String(observers?.repo_file_count ?? 0)}
        detail="FileAccessProvider sandbox"
      />
      <EvidenceMetric
        icon={<TestTube2 size={16} />}
        label="Last Test"
        value={observers?.latest_test_command ?? "—"}
        tone={
          observers?.latest_test_success == null
            ? undefined
            : observers.latest_test_success
              ? "emerald"
              : "red"
        }
        detail={
          observers?.latest_test_success == null
            ? "No result yet"
            : observers.latest_test_success
              ? "Passing"
              : "Needs attention"
        }
      />
      <EvidenceMetric
        icon={<ShieldCheck size={16} />}
        label="Approvals"
        value={String(approvals?.total ?? 0)}
        tone={(approvals?.pending ?? 0) > 0 ? "amber" : undefined}
        detail={
          approvals?.total
            ? `${approvals.approved} approved · ${approvals.rejected} rejected · ${approvals.pending} waiting${approvals.lastToolName ? ` · ${approvals.lastToolName}` : ""}`
            : "ToolApprovalAgent will pause risky actions"
        }
      />
      <EvidenceMetric
        icon={<Database size={16} />}
        label="Memory"
        value={String(agentState.memory.length)}
        detail={
          agentState.memory.length === 0
            ? "No post-mortem saved yet"
            : agentState.memory
                .map((entry) => entry.key)
                .slice(0, 2)
                .join(" · ")
        }
      />
      <EvidenceMetric
        icon={<CheckCircle2 size={16} />}
        label="Skills"
        value={String(skills.length)}
        detail={
          skills.length === 0
            ? "Available in Advanced"
            : skills
                .map((skill) => `${skill.name} ${skill.lastActivity}`)
                .slice(0, 2)
                .join(" · ")
        }
      />

      <Card className="min-w-0 max-w-full">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Feature support</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <FeatureChips label="Native" items={featureSupport?.native ?? []} />
          <div className="mt-3">
            <FeatureChips
              label="Live wrappers"
              items={featureSupport?.live_wrappers ?? []}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EvidenceMetric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "amber" | "emerald" | "cyan" | "red";
}) {
  return (
    <Card size="sm" className="min-w-0 max-w-full px-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {detail}
          </div>
        </div>
        <EvidenceBadge tone={tone}>{value}</EvidenceBadge>
      </div>
    </Card>
  );
}

function EvidenceBadge({
  tone,
  children,
}: {
  tone?: "amber" | "emerald" | "cyan" | "red";
  children: ReactNode;
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-700"
          : tone === "cyan"
            ? "border-cyan-200 bg-cyan-50 text-cyan-700"
            : "";
  return (
    <Badge
      variant="outline"
      className={cn("min-w-0 max-w-[8rem] shrink justify-start", className)}
      title={typeof children === "string" ? children : undefined}
    >
      <span className="min-w-0 truncate">{children}</span>
    </Badge>
  );
}

function FeatureChips({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cr-muted-2)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        {label}
      </div>
      {items.length === 0 ? (
        <p
          className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Awaiting health probe
        </p>
      ) : (
        <ul className="mt-1.5 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden">
          {items.slice(0, 6).map((item) => (
            <li key={item} className="min-w-0 max-w-full">
              <Badge
                variant="outline"
                className={cn(
                  "max-w-full justify-start",
                  label === "Native"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : undefined,
                )}
                title={item}
              >
                <span className="min-w-0 truncate">{item}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
