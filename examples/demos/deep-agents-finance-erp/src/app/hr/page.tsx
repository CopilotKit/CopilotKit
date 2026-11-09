"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { employees } from "@/lib/data";
import { formatCurrency, cn } from "@/lib/utils";
import { Plus, Mail } from "lucide-react";

export default function HRPage() {
  return (
    <Suspense>
      <HRContent />
    </Suspense>
  );
}

function HRContent() {
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";

  const departments = [...new Set(employees.map((e) => e.department))];

  const filtered =
    activeFilter === "all"
      ? employees
      : employees.filter(
          (e) => e.department.toLowerCase() === activeFilter.toLowerCase(),
        );

  const activeCount = employees.filter((e) => e.status === "active").length;
  const totalPayroll = employees
    .filter((e) => e.status === "active")
    .reduce((sum, e) => sum + e.salary, 0);

  return (
    <Shell>
      <Header title="Human Resources" subtitle="Team management and payroll" />

      <div className="space-y-6 p-8">
        {/* Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Active Employees
              </p>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {activeCount}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Departments
              </p>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {departments.length}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Annual Payroll
              </p>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {formatCurrency(totalPayroll)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {["all", ...departments].map((f) => (
              <Link
                key={f}
                href={
                  f === "all" ? "/hr" : `/hr?filter=${encodeURIComponent(f)}`
                }
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  activeFilter.toLowerCase() === f.toLowerCase()
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {f}
              </Link>
            ))}
          </div>
          <Button>
            <Plus className="h-4 w-4" />
            Add Employee
          </Button>
        </div>

        {/* Employee Cards Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((emp) => (
            <Card
              key={emp.id}
              size="sm"
              className="transition-all hover:shadow-lg"
            >
              <CardContent>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {emp.avatar}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {emp.role}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={emp.status} />
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Department</span>
                    <span className="text-foreground">{emp.department}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Start Date</span>
                    <span className="text-muted-foreground">
                      {emp.startDate}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Salary</span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(emp.salary)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 border-t border-border pt-3">
                  <a
                    href={`mailto:${emp.email}`}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"
                  >
                    <Mail className="h-3 w-3" />
                    {emp.email}
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Shell>
  );
}
