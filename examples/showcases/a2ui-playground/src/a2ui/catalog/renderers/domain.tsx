"use client";

import { useId, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ChefHat,
  Clock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  CreditCard,
  Droplets,
  Globe,
  Mail,
  MapPin,
  Phone,
  Receipt,
  Star,
  Sun,
  Thermometer,
  Users,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { asArray } from "./format";
import type { RendererMap } from "./types";

/* ───────────────────────────── helpers ───────────────────────────── */

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function money(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function initials(name?: string) {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const weatherIcons: Record<string, LucideIcon> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

/** Icon key from an explicit `icon`, or guessed from free-text condition. */
function weatherKey(icon?: string, condition?: string): string {
  const k = (icon ?? "").toLowerCase().trim();
  if (weatherIcons[k]) return k;
  const t = `${k} ${condition ?? ""}`.toLowerCase();
  if (/thunder|storm|lightning/.test(t)) return "storm";
  if (/snow|sleet|flurr/.test(t)) return "snow";
  if (/drizzle|shower/.test(t)) return "drizzle";
  if (/rain/.test(t)) return "rain";
  if (/fog|mist|haze|smoke/.test(t)) return "fog";
  if (/partly|mostly sunny|cloud-sun|few clouds/.test(t)) return "cloud-sun";
  if (/cloud|overcast/.test(t)) return "cloud";
  return "sun";
}

const weatherTint: Record<string, { glow: string; icon: string }> = {
  sun: { glow: "oklch(0.83 0.14 78 / 22%)", icon: "text-amber-300" },
  "cloud-sun": { glow: "oklch(0.83 0.12 78 / 15%)", icon: "text-amber-200" },
  cloud: { glow: "oklch(0.75 0.03 260 / 14%)", icon: "text-slate-300" },
  fog: { glow: "oklch(0.75 0.02 260 / 12%)", icon: "text-slate-300" },
  drizzle: { glow: "oklch(0.76 0.12 225 / 16%)", icon: "text-sky-300" },
  rain: { glow: "oklch(0.7 0.14 240 / 20%)", icon: "text-sky-300" },
  snow: { glow: "oklch(0.9 0.04 230 / 16%)", icon: "text-sky-100" },
  storm: { glow: "oklch(0.65 0.17 292 / 22%)", icon: "text-violet-300" },
};

function WeatherIcon({ icon, className }: { icon?: string; className?: string }) {
  const key = weatherKey(icon);
  const Icon = weatherIcons[key];
  return <Icon className={cn(weatherTint[key].icon, className)} strokeWidth={1.75} />;
}

function Img({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn("block size-full object-cover", className)} />;
}

const chip = "inline-flex items-center gap-1 rounded-full border border-[var(--a2-line)] bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted-foreground";

/** Parses "2026-11-14", "Nov 14 2026", ISO timestamps. Falls back to null for free text. */
function parseDate(input?: string): Date | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ───────────────────────────── renderers ───────────────────────────── */

type DomainKeys = "WeatherCard" | "ProfileCard" | "ReceiptCard" | "EventCard" | "StockTicker" | "RecipeCard";

export const domainRenderers: RendererMap<DomainKeys> = {
  WeatherCard: ({ props }) => {
    const key = weatherKey(props.icon, props.condition);
    const unit = props.unit ?? "C";
    const temp = num(props.temp);
    const hourly = asArray<{ label: string; temp: number; icon?: string; precip?: number }>(props.hourly).filter((h) => h && num(h.temp) != null);
    const daily = asArray<{ label: string; min: number; max: number; icon?: string; precip?: number }>(props.daily).filter(
      (d) => d && num(d.min) != null && num(d.max) != null,
    );
    const lo = daily.length ? Math.min(...daily.map((d) => d.min)) : 0;
    const hi = daily.length ? Math.max(...daily.map((d) => d.max)) : 1;
    const span = Math.max(hi - lo, 1);
    const details = [
      num(props.feels) != null ? { icon: Thermometer, label: "Feels like", value: `${Math.round(props.feels as number)}°` } : null,
      num(props.humidity) != null ? { icon: Droplets, label: "Humidity", value: `${Math.round(props.humidity as number)}%` } : null,
      num(props.wind) != null ? { icon: Wind, label: "Wind", value: `${Math.round(props.wind as number)} ${unit === "F" ? "mph" : "km/h"}` } : null,
    ].filter(Boolean) as { icon: LucideIcon; label: string; value: string }[];

    return (
      <div className="a2-card a2-enter relative w-full min-w-0 overflow-hidden">
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full blur-3xl"
          style={{ background: weatherTint[key].glow }}
        />
        <div className="relative flex items-start justify-between gap-4 px-5 pb-4 pt-4">
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1 text-[12.5px] font-medium text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{props.location}</span>
            </span>
            <div className="mt-1.5 flex items-start">
              <span className="text-[56px] font-semibold leading-[0.95] tracking-[-0.04em] tabular-nums">{temp != null ? Math.round(temp) : "--"}</span>
              <span className="mt-1.5 text-[20px] font-medium text-muted-foreground">°{unit}</span>
            </div>
            <span className="mt-2 text-[14px] font-medium">{props.condition}</span>
            {num(props.high) != null || num(props.low) != null ? (
              <span className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
                {num(props.high) != null ? `H ${Math.round(props.high as number)}°` : ""}
                {num(props.high) != null && num(props.low) != null ? "  ·  " : ""}
                {num(props.low) != null ? `L ${Math.round(props.low as number)}°` : ""}
              </span>
            ) : null}
          </div>
          <WeatherIcon icon={key} className="size-[72px] shrink-0 drop-shadow-[0_6px_24px_rgba(0,0,0,0.35)]" />
        </div>

        {details.length ? (
          <div className="relative grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2 px-4 pb-4">
            {details.map((d) => (
              <div key={d.label} className="a2-well flex min-w-0 items-center gap-2 px-2.5 py-2">
                <d.icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[10.5px] text-muted-foreground">{d.label}</span>
                  <span className="whitespace-nowrap text-[13px] font-medium tabular-nums">{d.value}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {hourly.length ? (
          <div className="relative border-t border-[var(--a2-line)] px-2 py-3">
            <div className="flex gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
              {hourly.map((h, i) => (
                <div
                  key={`${h.label}-${i}`}
                  className={cn(
                    "flex min-w-[52px] flex-1 flex-col items-center gap-1.5 rounded-[10px] py-2",
                    i === 0 && "bg-white/[0.045] ring-1 ring-[var(--a2-line)]",
                  )}
                >
                  <span className={cn("text-[11px] text-muted-foreground", i === 0 && "font-medium text-foreground")}>{h.label}</span>
                  <WeatherIcon icon={weatherKey(h.icon)} className="size-[18px]" />
                  <span className="text-[13px] font-medium tabular-nums">{Math.round(h.temp)}°</span>
                  <span className={cn("h-3 text-[10px] tabular-nums text-sky-300", !(h.precip && h.precip > 0) && "opacity-0")}>
                    {Math.round(h.precip ?? 0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {daily.length ? (
          <div className="relative flex flex-col border-t border-[var(--a2-line)] px-4 py-2">
            {daily.map((d, i) => {
              const left = ((d.min - lo) / span) * 100;
              const width = Math.max(((d.max - d.min) / span) * 100, 4);
              return (
                <div key={`${d.label}-${i}`} className="grid grid-cols-[44px_22px_34px_32px_minmax(0,1fr)_32px] items-center gap-2 py-[7px]">
                  <span className="text-[13px] font-medium">{d.label}</span>
                  <WeatherIcon icon={weatherKey(d.icon)} className="size-4" />
                  <span className="text-[10.5px] tabular-nums text-sky-300">{d.precip ? `${Math.round(d.precip)}%` : ""}</span>
                  <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">{Math.round(d.min)}°</span>
                  <span className="relative h-[5px] rounded-full bg-white/[0.07]">
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: "linear-gradient(90deg, oklch(0.78 0.12 220), oklch(0.83 0.14 120) 55%, oklch(0.8 0.15 70))",
                      }}
                    />
                  </span>
                  <span className="text-[12.5px] font-medium tabular-nums">{Math.round(d.max)}°</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  },

  ProfileCard: ({ props }) => {
    const tags = asArray<string>(props.tags).filter((t) => typeof t === "string");
    const stats = asArray<{ label: string; value: string }>(props.stats).filter((s) => s && s.label);
    const contacts = [
      props.email ? { icon: Mail, value: props.email, href: `mailto:${props.email}` } : null,
      props.phone ? { icon: Phone, value: props.phone, href: `tel:${props.phone.replace(/[^+\d]/g, "")}` } : null,
      props.website ? { icon: Globe, value: props.website.replace(/^https?:\/\//, ""), href: /^https?:/.test(props.website) ? props.website : `https://${props.website}` } : null,
    ].filter(Boolean) as { icon: LucideIcon; value: string; href: string }[];
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        <div className="relative h-16 overflow-hidden bg-[linear-gradient(120deg,oklch(0.42_0.14_292),oklch(0.32_0.09_250)_55%,oklch(0.25_0.04_285))]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_-20%,oklch(1_0_0/18%),transparent_55%)]" />
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-8 flex items-end justify-between gap-3">
            <Avatar className="size-16 ring-4 ring-[var(--a2-surface)]">
              {props.avatar ? <AvatarImage src={props.avatar} alt={props.name ?? ""} /> : null}
              <AvatarFallback className="bg-violet-500/20 text-[18px] font-semibold text-violet-200">{initials(props.name)}</AvatarFallback>
            </Avatar>
            {props.location ? (
              <span className="mb-1 flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{props.location}</span>
              </span>
            ) : null}
          </div>
          <div className="mt-2.5 flex min-w-0 flex-col">
            <span className="truncate text-[16px] font-semibold tracking-tight">{props.name}</span>
            {props.role || props.company ? (
              <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground">
                <span className="truncate">{props.role}</span>
                {props.company ? (
                  <>
                    {props.role ? <span className="text-muted-foreground/50">at</span> : null}
                    <span className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground/85">
                      <Building2 className="size-3 shrink-0" />
                      <span className="truncate">{props.company}</span>
                    </span>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          {props.bio ? <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/80">{props.bio}</p> : null}
          {tags.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className={chip}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {stats.length ? (
            <div className="mt-3.5 grid gap-px overflow-hidden rounded-[10px] border border-[var(--a2-line)] bg-[var(--a2-line)]" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}>
              {stats.slice(0, 4).map((s) => (
                <div key={s.label} className="flex min-w-0 flex-col items-center bg-[var(--a2-surface)] px-2 py-2.5">
                  <span className="text-[15px] font-semibold tabular-nums tracking-tight">{s.value}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          ) : null}
          {contacts.length ? (
            <div className="mt-3.5 flex flex-col gap-0.5">
              {contacts.map((c) => (
                <a
                  key={c.href}
                  href={c.href}
                  target={c.href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                  className="group flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/[0.05]">
                    <c.icon className="size-3.5" />
                  </span>
                  <span className="truncate">{c.value}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  },

  ReceiptCard: ({ props }) => {
    const currency = props.currency ?? "USD";
    const items = asArray<{ name: string; qty?: number; price: number; note?: string }>(props.items).filter((i) => i && num(i.price) != null);
    const subtotal = items.reduce((s, i) => s + i.price * (num(i.qty) ?? 1), 0);
    const tax = num(props.tax) ?? 0;
    const shipping = num(props.shipping) ?? 0;
    const discount = Math.abs(num(props.discount) ?? 0);
    const total = subtotal + tax + shipping - discount;
    const status = str(props.status);
    const statusTone = !status
      ? ""
      : /paid|complete|deliver|success|confirm/i.test(status)
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
        : /refund|cancel|fail/i.test(status)
          ? "border-rose-400/25 bg-rose-400/10 text-rose-300"
          : "border-amber-300/25 bg-amber-300/10 text-amber-200";
    const rows = [
      { label: "Subtotal", value: money(subtotal, currency) },
      shipping ? { label: "Shipping", value: money(shipping, currency) } : num(props.shipping) === 0 ? { label: "Shipping", value: "Free" } : null,
      discount ? { label: "Discount", value: `-${money(discount, currency)}`, tone: "text-emerald-300" } : null,
      tax ? { label: "Tax", value: money(tax, currency) } : null,
    ].filter(Boolean) as { label: string; value: string; tone?: string }[];
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--a2-line)] bg-white/[0.04]">
              <Receipt className="size-4 text-violet-300" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14.5px] font-semibold tracking-tight">{props.merchant}</span>
              <span className="truncate text-[11.5px] text-muted-foreground">
                {[props.orderId ? `Order ${props.orderId}` : null, props.date].filter(Boolean).join("  ·  ")}
              </span>
            </span>
          </div>
          {status ? <Badge className={cn("shrink-0 border text-[11px] capitalize", statusTone)}>{status}</Badge> : null}
        </div>
        <Separator className="bg-[var(--a2-line)]" />
        <div className="flex flex-col px-4 py-2">
          {items.length === 0
            ? [0, 1].map((i) => <div key={i} className="a2-shimmer my-1.5 h-8 rounded-md" />)
            : items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="flex items-start justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-px flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] px-1 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                      {num(it.qty) ?? 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-medium">{it.name}</span>
                      {it.note ? <span className="text-[11.5px] text-muted-foreground">{it.note}</span> : null}
                    </span>
                  </div>
                  <span className="shrink-0 text-[13px] tabular-nums">{money(it.price * (num(it.qty) ?? 1), currency)}</span>
                </div>
              ))}
        </div>
        <div className="mx-4 border-t border-dashed border-white/12" />
        <div className="flex flex-col gap-1.5 px-4 py-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-[12.5px]">
              <span className="text-muted-foreground">{r.label}</span>
              <span className={cn("tabular-nums", r.tone)}>{r.value}</span>
            </div>
          ))}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-[var(--a2-line)] pt-2.5">
            <span className="text-[13px] font-semibold">Total</span>
            <span className="text-[18px] font-semibold tabular-nums tracking-tight">{money(total, currency)}</span>
          </div>
        </div>
        {props.payment ? (
          <div className="flex items-center gap-2 border-t border-[var(--a2-line)] bg-white/[0.015] px-4 py-2.5 text-[12px] text-muted-foreground">
            <CreditCard className="size-3.5" />
            {props.payment}
          </div>
        ) : null}
      </div>
    );
  },

  EventCard: ({ props }) => {
    const d = parseDate(props.date);
    const tags = asArray<string>(props.tags).filter((t) => typeof t === "string");
    const attendees = num(props.attendees);
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        {props.image ? (
          <div className="relative h-32 overflow-hidden bg-white/[0.03]">
            <Img src={props.image} alt={props.title ?? ""} />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--a2-surface)] via-transparent to-transparent" />
          </div>
        ) : null}
        <div className={cn("flex gap-3.5 px-4 pb-4", props.image ? "-mt-7 pt-0" : "pt-4")}>
          <div className="relative flex w-14 shrink-0 flex-col items-center self-start overflow-hidden rounded-[12px] border border-[var(--a2-line-strong)] bg-[var(--a2-surface-2)] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.6)]">
            <span className="w-full bg-(--a2-accent) py-[3px] text-center text-[11px] font-semibold leading-tight text-[oklch(0.16_0.02_292)]">
              {d ? d.toLocaleDateString("en-US", { month: "short" }) : "Date"}
            </span>
            <span className="pb-1 pt-1 text-[22px] font-semibold leading-none tabular-nums">{d ? d.getDate() : "?"}</span>
            <span className="pb-1.5 text-[10px] text-muted-foreground">{d ? d.toLocaleDateString("en-US", { weekday: "short" }) : ""}</span>
          </div>
          <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", props.image && "pt-8")}>
            <span className="text-[15px] font-semibold leading-snug tracking-tight">{props.title}</span>
            <div className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
              {props.time || (!d && props.date) ? (
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5 shrink-0" />
                  {[!d ? props.date : null, props.time].filter(Boolean).join(", ")}
                </span>
              ) : null}
              {props.venue ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">{props.venue}</span>
                </span>
              ) : null}
              {props.host ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Users className="size-3.5 shrink-0" />
                  <span className="truncate">Hosted by {props.host}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {props.description ? <p className="px-4 pb-3 text-[13px] leading-relaxed text-foreground/80">{props.description}</p> : null}
        {tags.length ? (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3.5">
            {tags.map((t) => (
              <span key={t} className={chip}>
                {t}
              </span>
            ))}
          </div>
        ) : null}
        {attendees != null || props.action ? (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--a2-line)] px-4 py-3">
            {attendees != null ? (
              <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="flex -space-x-1.5">
                  {[11, 32, 47].map((n, i) => (
                    <span
                      key={n}
                      className="size-5 rounded-full ring-2 ring-[var(--a2-surface)]"
                      style={{ background: `linear-gradient(135deg, var(--ts-chart-${i + 1}), var(--ts-chart-${i + 2}))` }}
                    />
                  ))}
                </span>
                <span className="tabular-nums">{attendees.toLocaleString("en-US")} going</span>
              </span>
            ) : (
              <span />
            )}
            {props.action ? (
              <Button size="sm" className="h-8 px-4 text-[12.5px]" onClick={() => props.action?.()}>
                {props.actionLabel ?? "RSVP"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },

  StockTicker: ({ props }) => {
    const gid = useId().replace(/:/g, "");
    const price = num(props.price);
    const change = num(props.change);
    const pct = num(props.changePct);
    const series = asArray<number>(props.series).filter((n) => num(n) != null);
    const up = (change ?? pct ?? (series.length > 1 ? series[series.length - 1] - series[0] : 0)) >= 0;
    const stats = asArray<{ label: string; value: string }>(props.stats).filter((s) => s && s.label);
    const currency = props.currency ?? "USD";
    const fmt = (v: number) => {
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
      } catch {
        return v.toFixed(2);
      }
    };
    const color = up ? "var(--a2-positive)" : "var(--a2-negative)";
    const spark = useMemo(() => {
      if (series.length < 2) return null;
      const W = 320, H = 72, P = 4;
      const min = Math.min(...series), max = Math.max(...series);
      const r = max - min || 1;
      const pts = series.map((v, i) => [(i / (series.length - 1)) * W, P + (1 - (v - min) / r) * (H - P * 2)] as const);
      const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      const base = P + (1 - (series[0] - min) / r) * (H - P * 2);
      return { W, H, line, area: `${line} L${W},${H} L0,${H} Z`, last: pts[pts.length - 1], base };
    }, [series]);
    return (
      <div className="a2-card a2-enter @container w-full min-w-0 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="hidden h-8 min-w-8 shrink-0 items-center justify-center rounded-[9px] border border-[var(--a2-line)] bg-white/[0.05] px-1.5 font-mono text-[10.5px] font-bold @[300px]:flex">
              {(props.symbol ?? "").slice(0, 4)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-[14px] font-semibold tracking-tight">{props.symbol}</span>
              {props.name ? <span className="truncate text-[11.5px] text-muted-foreground">{props.name}</span> : null}
            </span>
          </div>
          {props.sample ? (
            <Badge className="shrink-0 border border-amber-300/25 bg-amber-300/10 text-[10.5px] text-amber-200">Sample data</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
          <span className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{price != null ? fmt(price) : "--"}</span>
          {change != null || pct != null ? (
            <span className={cn("inline-flex items-center gap-0.5 text-[13px] font-medium tabular-nums", up ? "text-emerald-400" : "text-rose-400")}>
              {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
              {change != null ? `${up ? "+" : ""}${change.toFixed(2)}` : ""}
              {pct != null ? ` (${up ? "+" : ""}${pct.toFixed(2)}%)` : ""}
            </span>
          ) : null}
        </div>
        {spark ? (
          <svg viewBox={`0 0 ${spark.W} ${spark.H}`} preserveAspectRatio="none" className="mt-3 block h-[72px] w-full" aria-hidden>
            <defs>
              <linearGradient id={`sg-${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" x2={spark.W} y1={spark.base} y2={spark.base} stroke="oklch(1 0 0 / 14%)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            <path d={spark.area} fill={`url(#sg-${gid})`} />
            <path d={spark.line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className="h-4" />
        )}
        {stats.length ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-4 border-t border-[var(--a2-line)] px-4 py-3">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                <span className="truncate text-muted-foreground">{s.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  },

  RecipeCard: ({ props }) => {
    const ingredients = asArray<string>(props.ingredients).filter((s) => typeof s === "string");
    const steps = asArray<string>(props.steps).filter((s) => typeof s === "string");
    const tags = asArray<string>(props.tags).filter((t) => typeof t === "string");
    const [done, setDone] = useState<Set<number>>(() => new Set());
    const toggle = (i: number) =>
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    const meta = [
      props.time ? { icon: Clock, value: props.time } : null,
      props.servings != null ? { icon: Users, value: `${props.servings} servings` } : null,
      props.difficulty ? { icon: ChefHat, value: props.difficulty } : null,
    ].filter(Boolean) as { icon: LucideIcon; value: string }[];
    return (
      <div className="a2-card a2-enter @container w-full min-w-0 overflow-hidden">
        {props.image ? (
          <div className="relative h-40 overflow-hidden bg-white/[0.03]">
            <Img src={props.image} alt={props.title ?? ""} />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--a2-surface)] via-[oklch(0.172_0.005_285/45%)] to-[oklch(0.172_0.005_285/10%)]" />
          </div>
        ) : null}
        <div className={cn("flex flex-col gap-2 px-4", props.image ? "-mt-10 relative" : "pt-4")}>
          <span className="text-[16px] font-semibold leading-snug tracking-tight">{props.title}</span>
          {meta.length ? (
            <div className="flex flex-wrap gap-1.5">
              {meta.map((m) => (
                <span key={m.value} className={chip}>
                  <m.icon className="size-3" />
                  {m.value}
                </span>
              ))}
              {tags.map((t) => (
                <span key={t} className={cn(chip, "border-violet-400/20 bg-violet-500/10 text-violet-200")}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 pb-4 pt-3.5 @[520px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] @[520px]:gap-5">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="a2-label">Ingredients</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {done.size}/{ingredients.length}
              </span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-violet-400 transition-[width] duration-300" style={{ width: `${ingredients.length ? (done.size / ingredients.length) * 100 : 0}%` }} />
            </div>
            <ul className="flex flex-col">
              {ingredients.map((ing, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-white/[0.03]">
                    <Checkbox checked={done.has(i)} onCheckedChange={() => toggle(i)} className="mt-px" />
                    <span className={cn("text-[13px] leading-snug transition-colors", done.has(i) && "text-muted-foreground line-through decoration-white/30")}>{ing}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="a2-label">Steps</span>
            <ol className="flex flex-col gap-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10 text-[10.5px] font-semibold tabular-nums text-violet-200">
                    {i + 1}
                  </span>
                  <span className="text-[13px] leading-relaxed text-foreground/85">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    );
  },
};
