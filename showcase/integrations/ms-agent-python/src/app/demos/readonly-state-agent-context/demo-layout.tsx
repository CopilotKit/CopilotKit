"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./_components/card";
import { Badge } from "./_components/badge";
import { Input } from "./_components/input";
import { Select } from "./_components/select";
import { Checkbox } from "./_components/checkbox";
import { Label } from "./_components/label";

export const TIMEZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export const ACTIVITIES = [
  "Viewed the pricing page",
  "Added 'Pro Plan' to cart",
  "Watched the product demo video",
  "Started the 14-day free trial",
  "Invited a teammate",
];

interface DemoLayoutProps {
  userName: string;
  userTimezone: string;
  recentActivity: string[];
  onUserNameChange: (next: string) => void;
  onUserTimezoneChange: (next: string) => void;
  onToggleActivity: (activity: string) => void;
}

export function DemoLayout({
  userName,
  userTimezone,
  recentActivity,
  onUserNameChange,
  onUserTimezoneChange,
  onToggleActivity,
}: DemoLayoutProps) {
  const publishedContext = {
    name: userName,
    timezone: userTimezone,
    recentActivity,
  };

  return (
    <main className="min-h-screen w-full bg-neutral-50 px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <Badge variant="info">Read-only Agent Context</Badge>
            <Badge variant="muted">useAgentContext</Badge>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">
            Agent Context Inspector
          </h1>
          <p className="mt-3 max-w-2xl text-base text-neutral-600">
            Edit fields below and watch the data flow into the agent. The agent
            can read this context, but{" "}
            <span className="font-medium text-neutral-800">cannot modify</span>{" "}
            it. Open the popup chat in the corner and ask the agent what it
            knows about you.
          </p>
        </header>

        <div
          data-testid="context-card"
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          {/* Identity card */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Identity</CardTitle>
                <Badge variant="outline">live</Badge>
              </div>
              <CardDescription>
                Basic profile fields broadcast to the agent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ctx-name-input">Name</Label>
                <Input
                  id="ctx-name-input"
                  data-testid="ctx-name"
                  type="text"
                  value={userName}
                  onChange={(e) => onUserNameChange(e.target.value)}
                  placeholder="e.g. Atai"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="ctx-tz-select">Timezone</Label>
                <Select
                  id="ctx-tz-select"
                  data-testid="ctx-timezone"
                  value={userTimezone}
                  onChange={(e) => onUserTimezoneChange(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Avatar
                  </span>
                  <Badge variant="secondary">
                    {userTimezone.split("/")[0]}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div
                    data-testid="identity-avatar"
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-2xl font-semibold text-indigo-700"
                  >
                    {userName.charAt(0).toUpperCase() || "?"}
                  </div>
                  <div>
                    <div
                      data-testid="identity-name"
                      className="text-base font-semibold text-neutral-900"
                    >
                      {userName || "Anonymous"}
                    </div>
                    <div
                      data-testid="identity-timezone"
                      className="text-xs text-neutral-500"
                    >
                      {userTimezone}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activity card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Activity</CardTitle>
                <Badge variant="info">{recentActivity.length} selected</Badge>
              </div>
              <CardDescription>
                Toggle activities to update what the agent sees about your
                recent actions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ACTIVITIES.map((activity) => {
                  const selected = recentActivity.includes(activity);
                  const slug = activity
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "");
                  return (
                    <label
                      key={activity}
                      data-testid={`activity-${slug}`}
                      className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                        selected
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-neutral-200 bg-white hover:bg-neutral-50"
                      }`}
                    >
                      <Checkbox
                        checked={selected}
                        onChange={() => onToggleActivity(activity)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-neutral-900">
                          {activity}
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">
                          {selected
                            ? "Visible to the agent"
                            : "Hidden from the agent"}
                        </div>
                      </div>
                      {selected && <Badge variant="success">on</Badge>}
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Published context — full-width JSON viewer */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Published Context</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">read-only</Badge>
                  <Badge variant="success">streamed</Badge>
                </div>
              </div>
              <CardDescription>
                The exact JSON payload broadcast to the agent on every render.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <ContextStat label="Name" value={userName || "—"} />
                <ContextStat label="Timezone" value={userTimezone} />
                <ContextStat
                  label="Activity items"
                  value={String(recentActivity.length)}
                />
              </div>
              <pre
                data-testid="ctx-state-json"
                className="bg-neutral-900 text-neutral-100 rounded-lg p-5 text-sm font-mono overflow-x-auto leading-relaxed"
              >
                {JSON.stringify(publishedContext, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-neutral-900 truncate">
        {value}
      </div>
    </div>
  );
}
