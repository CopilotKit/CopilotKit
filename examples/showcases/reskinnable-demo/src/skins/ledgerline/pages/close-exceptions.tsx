"use client";

import { useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  FileSignature,
  Loader2,
  Lock,
  MessageSquareText,
  Receipt as ReceiptIcon,
  Split,
  Tags,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "../data/format";
import { attendeeSplit } from "../data/recon-seed";
import type {
  CardAccount,
  CardTransaction,
  CompanyEvent,
  Department,
  GlAccount,
} from "../data/recon-seed";
import { reconActions } from "../data/recon-client";
import type { PairResult, ResolutionView } from "../data/recon-client";
import {
  Avatar,
  Money,
  primaryButton,
  secondaryButton,
} from "../components/ui";
import { useToast } from "../components/toast";
import { emitChoice, emitScreenContext } from "../learning/recorder";

/**
 * The exceptions on a month-end close: the charges Ledgerline cannot clear by
 * matching a receipt. Each has its own small workflow, the way a person clears
 * it in a spend platform: allocate an offsite across the departments that came,
 * reclass a miscoded charge in a soft-locked month, mark a personal charge for
 * repayment, sign a missing-receipt affidavit.
 */

const usd = (n: number) => formatMoney(n);

const MCC: Record<string, string> = {
  "5734": "Software",
  "7399": "Event venue",
  "5811": "Caterer",
  "4121": "Rideshare",
  "7523": "Parking",
  "5812": "Restaurant",
  "4899": "Streaming",
};

const KIND = {
  split: {
    icon: Split,
    title: "Split across departments",
    action: "Split",
  },
  reclass: {
    icon: Tags,
    title: "Coded to the wrong account",
    action: "Reclass",
  },
  personal: {
    icon: UserRound,
    title: "Flagged personal by the cardholder",
    action: "Mark personal",
  },
  missing_receipt: {
    icon: ReceiptIcon,
    title: "No receipt on file",
    action: "Missing receipt",
  },
} as const;

export interface ExceptionRefs {
  card: CardAccount;
  events: CompanyEvent[];
  departments: Department[];
  glAccounts: GlAccount[];
}

export function ExceptionCard({
  t,
  refs,
  resolution,
  result,
  closed,
  busy,
  onResolved,
}: {
  t: CardTransaction;
  refs: ExceptionRefs;
  resolution: ResolutionView | null;
  result?: PairResult;
  closed: boolean;
  busy: boolean;
  onResolved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const x = t.exception!;
  const k = KIND[x.kind];
  const gl = (code: string) =>
    refs.glAccounts.find((a) => a.code === code)?.name ?? code;
  const ev =
    x.kind === "split" ? refs.events.find((e) => e.id === x.eventId) : null;

  const toggle = () => {
    if (resolution || closed) return;
    const next = !open;
    setOpen(next);
    if (!next) return;
    // What the person sees when they open it: the context the API never joins up.
    if (x.kind === "split" && ev)
      emitScreenContext(`Split: ${t.descriptor}`, {
        view: "close.split",
        transactionId: t.id,
        text: `${ev.name}, ${formatDate(ev.date)} at ${ev.location}: ${ev.attendees.map((a) => `${dept(refs, a.departmentId)} ${a.count}`).join(", ")}. Split by attendees allocates ${usd(t.amount)} by headcount.`,
      });
    else if (x.kind === "reclass")
      emitScreenContext(`Reclass: ${t.descriptor}`, {
        view: "close.reclass",
        transactionId: t.id,
        text: `Coded to ${t.glAccount} ${gl(t.glAccount)}; suggested ${x.suggestedAccount} ${gl(x.suggestedAccount)}. ${refs.card.periodLabel} is soft-locked for coding, so the fix posts a reclass entry.`,
      });
    else if (x.kind === "personal")
      emitScreenContext(`Personal: ${t.descriptor}`, {
        view: "close.personal",
        transactionId: t.id,
        text: `${x.note.author}: "${x.note.text}" Personal charges are repaid, by payroll deduction unless the cardholder pays the card.`,
      });
    else
      emitScreenContext(`Missing receipt: ${t.descriptor}`, {
        view: "close.missing_receipt",
        transactionId: t.id,
        text: `No receipt on file. A missing-receipt affidavit with the business purpose goes to ${refs.card.holder} to attest.`,
      });
  };

  return (
    <li
      data-txn={t.id}
      data-testid="close-exception"
      className={cn(
        "overflow-hidden rounded-[10px] border bg-surface transition-[border-color,box-shadow] duration-150",
        result && !result.valid
          ? "border-negative/40"
          : resolution
            ? "border-positive/30"
            : open
              ? "border-brand/40 shadow-[0_4px_16px_-8px_hsl(225_40%_30%/0.25)]"
              : "border-hairline",
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <DateTile date={t.postedAt} />
        <div className="min-w-0 flex-1">
          <div className="ll-mono truncate text-[12.5px] font-medium tracking-[0.01em]">
            {t.descriptor}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[hsl(var(--ll-faint))]">
            <span>{MCC[t.mcc] ?? "Card charge"}</span>
            <span>·</span>
            <span className="ll-mono">
              {t.glAccount} {gl(t.glAccount)}
            </span>
          </div>
        </div>
        <Money value={t.amount} className="text-[14px] font-semibold" />
        {result ? (
          result.valid ? (
            <CheckCircle2
              aria-label="Valid"
              className="h-4 w-4 shrink-0 text-positive"
            />
          ) : (
            <CircleAlert
              aria-label="Not valid"
              className="h-4 w-4 shrink-0 text-negative"
            />
          )
        ) : null}
      </div>

      {resolution ? (
        <Resolved t={t} refs={refs} r={resolution} closed={closed} />
      ) : (
        <div className="flex items-center gap-2.5 border-t border-hairline bg-[hsl(var(--ll-amber)/0.06)] px-3.5 py-2">
          <k.icon className="h-3.5 w-3.5 shrink-0 text-[hsl(32_80%_36%)]" />
          <div className="min-w-0 flex-1 text-[12.5px]">
            <span className="font-medium text-[hsl(32_70%_28%)]">
              {k.title}
            </span>
            <span className="text-ink-muted">
              {" "}
              {x.kind === "split" && ev
                ? `· ${ev.name}, ${ev.attendees.reduce((n, a) => n + a.count, 0)} attendees`
                : x.kind === "reclass"
                  ? `· suggested ${x.suggestedAccount} ${gl(x.suggestedAccount)}`
                  : x.kind === "personal"
                    ? `· ${x.note.author.split(" ")[0]} left a note`
                    : "· needs an affidavit"}
            </span>
          </div>
          {closed ? null : (
            <button
              type="button"
              aria-expanded={open}
              data-action={`${k.action}: ${t.descriptor}`}
              disabled={busy}
              onClick={toggle}
              className={cn(
                open ? secondaryButton : primaryButton,
                "h-7 px-2.5 text-[12px]",
              )}
            >
              {open ? "Cancel" : k.action}
            </button>
          )}
        </div>
      )}

      {open && !resolution ? (
        <div className="ll-pop-in border-t border-hairline px-3.5 pb-3.5 pt-3">
          {x.kind === "split" && ev ? (
            <SplitEditor
              t={t}
              ev={ev}
              refs={refs}
              onDone={async () => {
                setOpen(false);
                await onResolved();
              }}
            />
          ) : x.kind === "reclass" ? (
            <ReclassEditor
              t={t}
              suggested={x.suggestedAccount}
              why={x.why}
              refs={refs}
              onDone={async () => {
                setOpen(false);
                await onResolved();
              }}
            />
          ) : x.kind === "personal" ? (
            <PersonalEditor
              t={t}
              note={x.note}
              refs={refs}
              onDone={async () => {
                setOpen(false);
                await onResolved();
              }}
            />
          ) : x.kind === "missing_receipt" ? (
            <AffidavitEditor
              t={t}
              hint={x.memoHint}
              refs={refs}
              onDone={async () => {
                setOpen(false);
                await onResolved();
              }}
            />
          ) : null}
        </div>
      ) : null}

      {result && !result.valid ? (
        <div
          role="alert"
          data-testid="recon-reason"
          className="flex items-start gap-2 border-t border-negative/20 bg-negative-soft px-3.5 py-2 text-[12.5px] text-negative"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {result.code === "WRONG_ACCOUNT"
            ? "This reclass goes to the wrong account."
            : result.code === "WRONG_SPLIT"
              ? "This split does not follow who came to the event."
              : "This exception is not cleared yet."}
        </div>
      ) : null}
    </li>
  );
}

const dept = (refs: ExceptionRefs, id: string) =>
  refs.departments.find((d) => d.id === id)?.name ?? id;

function DateTile({ date }: { date: string }) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center rounded-md border border-hairline py-1 leading-none">
      <span className="text-[9.5px] font-medium uppercase tracking-wide text-[hsl(var(--ll-faint))]">
        {formatDate(date).split(" ")[0]}
      </span>
      <span className="ll-num text-[15px] font-semibold">
        {formatDate(date).split(" ")[1]}
      </span>
    </div>
  );
}

const BAR = [
  "bg-brand",
  "bg-[hsl(262_60%_58%)]",
  "bg-[hsl(170_55%_40%)]",
  "bg-[hsl(32_85%_52%)]",
];

function SplitEditor({
  t,
  ev,
  refs,
  onDone,
}: {
  t: CardTransaction;
  ev: CompanyEvent;
  refs: ExceptionRefs;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  // Until a person splits it, the whole charge sits with the cardholder's team.
  const [lines, setLines] = useState<
    { departmentId: string; amount: number }[]
  >([{ departmentId: ev.attendees.at(-1)!.departmentId, amount: t.amount }]);
  const [saving, setSaving] = useState(false);
  const total = Math.round(lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  const left = Math.round((t.amount - total) * 100) / 100;
  const heads = ev.attendees.reduce((n, a) => n + a.count, 0);
  const count = (id: string) =>
    ev.attendees.find((a) => a.departmentId === id)?.count;

  const save = async () => {
    setSaving(true);
    const label = lines
      .map((l) => `${dept(refs, l.departmentId)} ${usd(l.amount)}`)
      .join(", ");
    const out = await reconActions.split(t, lines, label);
    setSaving(false);
    if (!out.ok) {
      toast({
        tone: "error",
        title: "The split was not saved",
        body: out.message,
      });
      return;
    }
    toast({ tone: "ok", title: `${t.descriptor} split ${lines.length} ways` });
    await onDone();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline bg-surface-muted/60 px-3 py-2 text-[12px]">
        <Users className="h-3.5 w-3.5 text-ink-muted" />
        <span className="font-medium text-ink">{ev.name}</span>
        <span className="text-ink-muted">
          {formatDate(ev.date)} · {ev.location}
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          {ev.attendees.map((a) => (
            <span
              key={a.departmentId}
              className="rounded-[5px] bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted ring-1 ring-hairline"
            >
              {dept(refs, a.departmentId)}{" "}
              <span className="ll-num font-medium text-ink">{a.count}</span>
            </span>
          ))}
        </span>
      </div>

      <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted">
        {lines.map((l, i) => (
          <span
            key={l.departmentId}
            className={cn(
              "h-full transition-[width] duration-300",
              BAR[i % BAR.length],
            )}
            style={{ width: `${(l.amount / t.amount) * 100}%` }}
          />
        ))}
      </div>

      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] font-medium text-[hsl(var(--ll-faint))]">
            <th className="pb-1 font-medium">Department</th>
            <th className="pb-1 font-medium">Attendees</th>
            <th className="pb-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.departmentId} className="border-t border-hairline">
              <td className="py-1.5">
                <span className="flex items-center gap-2">
                  <span
                    className={cn("h-2 w-2 rounded-full", BAR[i % BAR.length])}
                  />
                  {dept(refs, l.departmentId)}
                </span>
              </td>
              <td className="ll-num py-1.5 text-ink-muted">
                {count(l.departmentId) ?? "-"}
                {count(l.departmentId) ? (
                  <span className="text-[hsl(var(--ll-faint))]">
                    {" "}
                    of {heads}
                  </span>
                ) : null}
              </td>
              <td className="py-1.5 text-right">
                <label className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-0.5 focus-within:border-brand">
                  <span className="text-[hsl(var(--ll-faint))]">$</span>
                  <input
                    aria-label={`${dept(refs, l.departmentId)} amount`}
                    inputMode="decimal"
                    value={l.amount.toFixed(2)}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/[^0-9.]/g, ""));
                      if (!Number.isFinite(v)) return;
                      setLines((ls) =>
                        ls.map((x) =>
                          x.departmentId === l.departmentId
                            ? { ...x, amount: v }
                            : x,
                        ),
                      );
                    }}
                    className="ll-num w-20 bg-transparent text-right outline-none"
                  />
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          data-action={`Split by attendees: ${t.descriptor}`}
          onClick={() => setLines(attendeeSplit(t.amount, ev))}
          className={cn(secondaryButton, "h-7 px-2.5 text-[12px]")}
        >
          <Wand2 className="h-3.5 w-3.5 text-brand" /> Split by attendees
        </button>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "ll-num text-[12px]",
              Math.abs(left) < 0.005
                ? "text-positive"
                : "text-[hsl(32_80%_36%)]",
            )}
          >
            {Math.abs(left) < 0.005
              ? `${usd(t.amount)} allocated`
              : `${usd(Math.abs(left))} ${left > 0 ? "left to allocate" : "over"}`}
          </span>
          <button
            type="button"
            data-action={`Save split: ${t.descriptor} (${lines.map((l) => `${dept(refs, l.departmentId)} ${usd(l.amount)}`).join(", ")})`}
            disabled={saving || Math.abs(left) >= 0.005 || lines.length < 2}
            onClick={() => void save()}
            className={cn(primaryButton, "h-7 px-2.5 text-[12px]")}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save split
          </button>
        </div>
      </div>
    </div>
  );
}

function ReclassEditor({
  t,
  suggested,
  why,
  refs,
  onDone,
}: {
  t: CardTransaction;
  suggested: string;
  why: string;
  refs: ExceptionRefs;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [to, setTo] = useState(suggested);
  const [saving, setSaving] = useState(false);
  const gl = (code: string) =>
    refs.glAccounts.find((a) => a.code === code)?.name ?? code;
  const memo = why.split(".")[0] + ".";
  const save = async () => {
    setSaving(true);
    const label = `${t.glAccount} ${gl(t.glAccount)} to ${to} ${gl(to)}`;
    const out = await reconActions.reclass(t, to, memo, label);
    setSaving(false);
    if (!out.ok) {
      toast({
        tone: "error",
        title: "The reclass did not post",
        body: out.message,
      });
      return;
    }
    toast({ tone: "ok", title: `Reclass posted: ${to} ${gl(to)}` });
    await onDone();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="ll-mono rounded-md border border-hairline bg-surface-muted px-2 py-1 text-ink-muted line-through decoration-[hsl(var(--ll-faint))]">
          {t.glAccount} {gl(t.glAccount)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-[hsl(var(--ll-faint))]" />
        <div
          role="listbox"
          aria-label="GL account"
          className="flex flex-wrap gap-1.5"
        >
          {refs.glAccounts
            .filter((a) => a.code !== t.glAccount)
            .filter((a) => ["6420", "6500", "6610", suggested].includes(a.code))
            .filter(
              (a, i, all) => all.findIndex((b) => b.code === a.code) === i,
            )
            .map((a) => (
              <button
                key={a.code}
                type="button"
                role="option"
                aria-selected={to === a.code}
                data-action={`GL account: ${a.code} ${a.name}`}
                onClick={() => {
                  setTo(a.code);
                  emitChoice(`GL account: ${a.code} ${a.name}`, {
                    transactionId: t.id,
                  });
                }}
                className={cn(
                  "ll-mono flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors",
                  to === a.code
                    ? "border-brand bg-brand-soft text-brand-indigo"
                    : "border-hairline text-ink hover:bg-surface-muted",
                )}
              >
                {a.code} {a.name}
                {a.code === suggested ? (
                  <span className="rounded-[4px] bg-brand px-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-white">
                    Suggested
                  </span>
                ) : null}
              </button>
            ))}
        </div>
      </div>
      <p className="text-[12px] text-ink-muted">{why}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted/70 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <Lock className="h-3 w-3" /> {refs.card.periodLabel} coding is
          soft-locked for the preliminary close, so this posts a reclass entry.
        </span>
        <button
          type="button"
          data-action={`Post reclass: ${t.descriptor} to ${to}`}
          disabled={saving}
          onClick={() => void save()}
          className={cn(primaryButton, "h-7 px-2.5 text-[12px]")}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Post reclass
        </button>
      </div>
    </div>
  );
}

function PersonalEditor({
  t,
  note,
  refs,
  onDone,
}: {
  t: CardTransaction;
  note: { author: string; text: string; at: string };
  refs: ExceptionRefs;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [method, setMethod] = useState<"payroll_deduction" | "card_payment">(
    "payroll_deduction",
  );
  const [saving, setSaving] = useState(false);
  const first = refs.card.holder.split(" ")[0];
  const save = async () => {
    setSaving(true);
    const out = await reconActions.personal(t, method);
    setSaving(false);
    if (!out.ok) {
      toast({ tone: "error", title: "Not marked personal", body: out.message });
      return;
    }
    toast({
      tone: "ok",
      title: `${usd(t.amount)} marked personal`,
      body:
        method === "payroll_deduction"
          ? `Deducted from ${first}'s next payroll.`
          : `${first} will pay it back to the card.`,
    });
    await onDone();
  };
  const options = [
    {
      id: "payroll_deduction" as const,
      label: `Deduct from ${first}'s next payroll`,
      sub: "Default for personal charges under $500",
    },
    {
      id: "card_payment" as const,
      label: `${first} pays it back to the card`,
      sub: "Due in 14 days",
    },
  ];
  return (
    <div className="space-y-3">
      <NoteBubble note={note} />
      <div
        role="radiogroup"
        aria-label="Repayment"
        className="grid gap-1.5 @[560px]:grid-cols-2"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={method === o.id}
            data-action={`Repayment: ${o.label}`}
            onClick={() => setMethod(o.id)}
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
              method === o.id
                ? "border-brand bg-brand-soft/50"
                : "border-hairline hover:bg-surface-muted",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                method === o.id
                  ? "border-brand"
                  : "border-[hsl(var(--ll-faint))]",
              )}
            >
              {method === o.id ? (
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              ) : null}
            </span>
            <span>
              <span className="block text-[12.5px] font-medium">{o.label}</span>
              <span className="block text-[11.5px] text-ink-muted">
                {o.sub}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          data-action={`Confirm personal: ${t.descriptor}`}
          disabled={saving}
          onClick={() => void save()}
          className={cn(primaryButton, "h-7 px-2.5 text-[12px]")}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Mark personal
        </button>
      </div>
    </div>
  );
}

function AffidavitEditor({
  t,
  hint,
  refs,
  onDone,
}: {
  t: CardTransaction;
  hint: string;
  refs: ExceptionRefs;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [memo, setMemo] = useState(
    hint.split(". ")[0]!.replace(/\.$/, "") + ".",
  );
  const [phase, setPhase] = useState<"idle" | "sending" | "waiting">("idle");
  const first = refs.card.holder.split(" ")[0];
  const send = async () => {
    setPhase("sending");
    const out = await reconActions.affidavit(t, memo);
    if (!out.ok) {
      setPhase("idle");
      toast({
        tone: "error",
        title: "The affidavit was not sent",
        body: out.message,
      });
      return;
    }
    setPhase("waiting");
    // The cardholder signs on their phone; in the demo it lands a beat later.
    await new Promise((r) => setTimeout(r, 1100));
    toast({
      tone: "ok",
      title: `${first} signed the affidavit`,
      body: `${t.descriptor}, ${usd(t.amount)}`,
    });
    await onDone();
  };
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-muted">{hint}</p>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-[hsl(var(--ll-faint))]">
          Business purpose
        </span>
        <textarea
          aria-label="Business purpose"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-brand"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <Avatar name={refs.card.holder} size="sm" /> {refs.card.holder} signs
          it in the Ledgerline app
        </span>
        <button
          type="button"
          data-action={`Request affidavit: ${t.descriptor}`}
          disabled={phase !== "idle" || memo.trim().length < 12}
          onClick={() => void send()}
          className={cn(primaryButton, "h-7 px-2.5 text-[12px]")}
        >
          {phase === "idle" ? (
            <FileSignature className="h-3.5 w-3.5" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {phase === "waiting" ? `Waiting for ${first}` : "Request affidavit"}
        </button>
      </div>
    </div>
  );
}

function NoteBubble({
  note,
}: {
  note: { author: string; text: string; at: string };
}) {
  return (
    <div className="flex items-start gap-2">
      <Avatar name={note.author} size="sm" />
      <div className="rounded-[10px] rounded-tl-[3px] bg-surface-muted px-3 py-2 text-[12.5px]">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-[hsl(var(--ll-faint))]">
          <MessageSquareText className="h-3 w-3" />
          <span className="font-medium text-ink-muted">{note.author}</span>
          {formatDate(note.at.slice(0, 10))}
        </div>
        {note.text}
      </div>
    </div>
  );
}

function Resolved({
  t,
  refs,
  r,
  closed,
}: {
  t: CardTransaction;
  refs: ExceptionRefs;
  r: ResolutionView;
  closed: boolean;
}) {
  const gl = (code: string) =>
    refs.glAccounts.find((a) => a.code === code)?.name ?? code;
  const chips: string[] =
    r.kind === "split"
      ? r.lines.map((l) => `${dept(refs, l.departmentId)} ${usd(l.amount)}`)
      : r.kind === "reclass"
        ? [
            `${r.fromAccount} to ${r.toAccount} ${gl(r.toAccount)}`,
            `Entry ${r.entryId}`,
          ]
        : r.kind === "personal"
          ? [
              r.method === "payroll_deduction"
                ? "Payroll deduction"
                : "Cardholder pays the card",
              `Repayment ${r.repaymentId}`,
            ]
          : [`Signed by ${r.attestedBy}`, `Affidavit ${r.affidavitId}`];
  const label =
    r.kind === "split"
      ? `Split ${r.lines.length} ways by attendees`
      : r.kind === "reclass"
        ? "Reclassed"
        : r.kind === "personal"
          ? `Personal, ${usd(t.amount)} repaid`
          : "Missing-receipt affidavit";
  return (
    <div className="ll-pop-in flex items-center gap-2.5 border-t border-hairline px-3.5 py-2">
      <BadgeCheck className="h-4 w-4 shrink-0 text-positive" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium">{label}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center rounded-[5px] bg-positive-soft px-1.5 py-0.5 text-[11px] font-medium text-positive"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      {closed ? (
        <Lock className="h-3.5 w-3.5 text-[hsl(var(--ll-faint))]" />
      ) : null}
    </div>
  );
}
