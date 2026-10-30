import type { ReactNode } from "react";
import { KumoProviders } from "../../kumo/providers";
// The Kumo stylesheet, compiled for apps without Tailwind. It includes a
// global reset, so only the /kumo pages load it.
import "@cloudflare/kumo/styles/standalone";
import "../../kumo/day-picker.css";
import "../../kumo/kumo.css";

export default function KumoLayout({ children }: { children: ReactNode }) {
  return <KumoProviders>{children}</KumoProviders>;
}
