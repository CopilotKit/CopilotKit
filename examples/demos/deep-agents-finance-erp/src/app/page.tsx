"use client";

import { Shell } from "@/components/layout/shell";
import { Header } from "@/components/layout/header";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";

export default function DashboardPage() {
  return (
    <Shell>
      <Header title="Dashboard" subtitle="Financial overview and analytics" />
      <DashboardGrid />
    </Shell>
  );
}
