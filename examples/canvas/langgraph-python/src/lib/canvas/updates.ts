import { ChartData, ProjectData } from "@/lib/canvas/types";

export function projectAddField4Item(data: ProjectData, text?: string): { next: ProjectData; createdId: string } {
  const existing = data.field4 ?? [];
  const nextCount = (data.field4_id ?? 0) + 1;
  const id = String(nextCount).padStart(3, "0");
  const next = [...existing, { id, text: text ?? "", done: false, proposed: false }];
  return { next: { ...data, field4: next, field4_id: nextCount }, createdId: id };
}

export function projectSetField4ItemText(data: ProjectData, checklistItemId: string, text: string): ProjectData {
  const next = (data.field4 ?? []).map((item) => (item.id === checklistItemId ? { ...item, text } : item));
  return { ...data, field4: next } as ProjectData;
}

export function projectSetField4ItemDone(data: ProjectData, checklistItemId: string, done: boolean): ProjectData {
  const next = (data.field4 ?? []).map((item) => (item.id === checklistItemId ? { ...item, done } : item));
  return { ...data, field4: next } as ProjectData;
}

export function projectRemoveField4Item(data: ProjectData, checklistItemId: string): ProjectData {
  const next = (data.field4 ?? []).filter((item) => item.id !== checklistItemId);
  return { ...data, field4: next } as ProjectData;
}

export function chartAddField1Metric(data: ChartData, label?: string, value?: number | ""): { next: ChartData; createdId: string } {
  const existing = data.field1 ?? [];
  const nextCount = (data.field1_id ?? 0) + 1;
  const id = String(nextCount).padStart(3, "0");
  const safe: number | "" = typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : value === "" ? "" : 0;
  const next = [...existing, { id, label: label ?? "", value: safe }];
  return { next: { ...data, field1: next, field1_id: nextCount }, createdId: id };
}

export function chartSetField1Label(data: ChartData, index: number, label: string): ChartData {
  const next = [...(data.field1 ?? [])];
  if (index >= 0 && index < next.length) {
    next[index] = { ...next[index], label };
    return { ...data, field1: next } as ChartData;
  }
  return data;
}

export function chartSetField1Value(data: ChartData, index: number, value: number | ""): ChartData {
  const next = [...(data.field1 ?? [])];
  if (index >= 0 && index < next.length) {
    if (value === "") {
      next[index] = { ...next[index], value: "" };
    } else {
      const clamped = Math.max(0, Math.min(100, value));
      next[index] = { ...next[index], value: clamped };
    }
    return { ...data, field1: next } as ChartData;
  }
  return data;
}

export function chartRemoveField1Metric(data: ChartData, index: number): ChartData {
  const next = [...(data.field1 ?? [])];
  if (index >= 0 && index < next.length) {
    next.splice(index, 1);
    return { ...data, field1: next } as ChartData;
  }
  return data;
}


