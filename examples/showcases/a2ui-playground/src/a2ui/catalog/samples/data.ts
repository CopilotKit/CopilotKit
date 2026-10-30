import type { Sample } from "./types";
import type { ComponentName } from "../definitions";

export const dataSamples: Partial<Record<ComponentName, Sample>> = {
  Stat: {
    components: [{ id: "root", component: "Stat", label: "Monthly recurring revenue", value: "$48.2k", delta: "+12.4%", caption: "vs. September, 1,284 active accounts", icon: "trending-up", tone: "default" }],
  },
  StatGroup: {
    wide: true,
    components: [
      {
        id: "root",
        component: "StatGroup",
        items: [
          { label: "Visitors", value: "84,210", delta: "+8.1%" },
          { label: "Signups", value: 2318, delta: "+14.6%" },
          { label: "Conversion", value: "2.75%", delta: "-0.3%", trend: "down" },
          { label: "Avg. session", value: "4m 12s", delta: "0.0%", trend: "flat" },
        ],
      },
    ],
  },
  Avatar: {
    components: [{ id: "root", component: "Avatar", name: "Maya Okafor", subtitle: "Staff engineer, Platform", size: "lg", status: "online" }],
  },
  AvatarGroup: {
    components: [
      {
        id: "root",
        component: "AvatarGroup",
        max: 5,
        label: "9 reviewers on this PR",
        people: [
          { name: "Maya Okafor" },
          { name: "Leo Brandt" },
          { name: "Priya Raman" },
          { name: "Tomás Herrera" },
          { name: "Ines Duval" },
          { name: "Sam Whitaker" },
          { name: "Kenji Mori" },
          { name: "Ana Silva" },
          { name: "Ravi Patel" },
        ],
      },
    ],
  },
  DataTable: {
    wide: true,
    components: [
      {
        id: "root",
        component: "DataTable",
        title: "Top accounts",
        searchable: true,
        pageSize: 5,
        columns: [
          { key: "account", label: "Account" },
          { key: "plan", label: "Plan", format: "badge" },
          { key: "status", label: "Status", format: "badge" },
          { key: "mrr", label: "MRR", format: "currency" },
          { key: "growth", label: "Growth", format: "percent" },
          { key: "seats", label: "Seats", format: "number" },
          { key: "renewal", label: "Renewal", format: "date" },
        ],
        rows: [
          { account: "Northwind Labs", plan: "Enterprise", status: "Active", mrr: 12400, growth: 18.2, seats: 240, renewal: "2027-02-14" },
          { account: "Kestrel Robotics", plan: "Scale", status: "Active", mrr: 6850, growth: 9.4, seats: 96, renewal: "2026-12-01" },
          { account: "Helix Health", plan: "Enterprise", status: "Pending", mrr: 9800, growth: 4.1, seats: 180, renewal: "2026-11-20" },
          { account: "Lumen Studio", plan: "Pro", status: "Active", mrr: 1240, growth: 22.7, seats: 18, renewal: "2027-01-09" },
          { account: "Orbit Freight", plan: "Scale", status: "Overdue", mrr: 4300, growth: -3.6, seats: 64, renewal: "2026-10-30" },
          { account: "Kestrel AI", plan: "Pro", status: "Trial", mrr: 890, growth: 41.0, seats: 12, renewal: "2026-11-05" },
          { account: "Bramble Foods", plan: "Starter", status: "Active", mrr: 320, growth: 6.5, seats: 5, renewal: "2027-03-22" },
          { account: "Quarry Finance", plan: "Enterprise", status: "Active", mrr: 15100, growth: 11.8, seats: 310, renewal: "2027-05-01" },
        ],
      },
    ],
  },
  KeyValueList: {
    components: [
      {
        id: "root",
        component: "KeyValueList",
        title: "Order #A-20481",
        items: [
          { label: "Placed", value: "Oct 14, 2026", hint: "9:42 AM PT" },
          { label: "Items", value: 3 },
          { label: "Shipping", value: "Express, 2 days" },
          { label: "Subtotal", value: "$218.00" },
          { label: "Total", value: "$236.40", hint: "Incl. $18.40 tax" },
        ],
      },
    ],
  },
  Timeline: {
    components: [
      {
        id: "root",
        component: "Timeline",
        items: [
          { title: "Order confirmed", time: "Oct 14, 9:42 AM", status: "done" },
          { title: "Packed at Reno warehouse", time: "Oct 14, 4:10 PM", description: "3 items in one box, 2.4 kg.", status: "done" },
          { title: "In transit", time: "Oct 15, 7:05 AM", description: "Left the Sacramento hub, next stop Oakland.", status: "current", icon: "truck" },
          { title: "Out for delivery", time: "Est. Oct 16", status: "upcoming" },
          { title: "Delivered", status: "upcoming" },
        ],
      },
    ],
  },
  Progress: {
    components: [{ id: "root", component: "Progress", label: "Storage used", value: 72, caption: "72 GB of 100 GB, resets Nov 1", tone: "accent" }],
  },
  RadialProgress: {
    components: [{ id: "root", component: "RadialProgress", label: "Sprint 42 completion", value: 68, display: "68%", tone: "positive" }],
  },
  Rating: {
    components: [{ id: "root", component: "Rating", value: 4.6, count: 1284, label: "Customer rating" }],
  },
  TagList: {
    components: [{ id: "root", component: "TagList", tags: ["TypeScript", "React 19", "Edge runtime", "Postgres", "OpenTelemetry", "Tailwind", "pnpm"] }],
  },
  Agenda: {
    wide: true,
    components: [
      {
        id: "root",
        component: "Agenda",
        title: "This week",
        days: [
          {
            date: "2026-10-15",
            label: "Today",
            events: [
              { time: "9:30 AM", title: "Design review: billing page", location: "Room 4B", tone: "accent" },
              { time: "1:00 PM", title: "Lunch with Priya", location: "Tartine, Mission St", tone: "positive" },
              { time: "4:30 PM", title: "Incident retro", location: "Zoom", tone: "warning" },
            ],
          },
          {
            date: "2026-10-16",
            events: [
              { time: "10:00 AM", title: "Q4 planning", location: "Main conference room", tone: "info" },
              { time: "3:00 PM", title: "1:1 with Leo", tone: "accent" },
            ],
          },
          { date: "2026-10-17", events: [] },
        ],
      },
    ],
  },
  ComparisonTable: {
    wide: true,
    components: [
      {
        id: "root",
        component: "ComparisonTable",
        title: "Pick a plan",
        options: ["Starter", "Pro", "Enterprise"],
        highlight: 1,
        rows: [
          { feature: "Price per seat", values: ["$0", "$24/mo", "Custom"] },
          { feature: "Projects", values: [3, "Unlimited", "Unlimited"] },
          { feature: "SSO and SAML", values: [false, true, true] },
          { feature: "Audit log", values: [false, true, true] },
          { feature: "Dedicated support", values: [false, false, true] },
          { feature: "Uptime SLA", values: ["", "99.9%", "99.99%"] },
        ],
      },
    ],
  },
};
