import fs from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { parse } from "yaml";
import type { Metadata } from "next";

type Demo = { id: string; name: string; route?: string };
type Manifest = { demos: Demo[] };

let demoIndex: Map<string, string> | null = null;

function loadDemoIndex(): Map<string, string> {
  if (demoIndex) return demoIndex;
  const raw = fs.readFileSync(
    path.join(process.cwd(), "manifest.yaml"),
    "utf8",
  );
  const manifest = parse(raw) as Manifest;
  const map = new Map<string, string>();
  for (const demo of manifest.demos ?? []) {
    if (demo.route) {
      const slug = demo.route.replace(/^\/demos\//, "");
      // Last writer wins; manifest has duplicate routes (e.g., hitl-in-chat
      // shared by hitl-in-chat and hitl-in-chat-booking). Prefer the first
      // entry to keep titles stable.
      if (!map.has(slug)) map.set(slug, demo.name);
    }
  }
  demoIndex = map;
  return map;
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  const match = pathname.match(/^\/demos\/([^/]+)/);
  const slug = match?.[1];
  if (!slug) return { title: "LangChain - Python" };

  const index = loadDemoIndex();
  const demoName = index.get(slug) ?? titleCase(slug);
  return { title: `LangChain - Python - ${demoName}` };
}

export default function DemosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
