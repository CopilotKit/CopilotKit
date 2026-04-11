import { DashboardShell } from "@/components/dashboard-shell";
import { DeveloperDashboard } from "@/components/developer-dashboard";

export default function Home() {
  return (
    <DashboardShell>
      <DeveloperDashboard />
    </DashboardShell>
  );
}
