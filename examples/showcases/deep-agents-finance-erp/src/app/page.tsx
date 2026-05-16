"use client";

import { Header } from "@/components/layout/header";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";

export default function DashboardPage() {
  return (
    <>
      <Header title="Dashboard" subtitle="Financial overview and analytics" />
      <DashboardGrid />
    </>
  );
}
