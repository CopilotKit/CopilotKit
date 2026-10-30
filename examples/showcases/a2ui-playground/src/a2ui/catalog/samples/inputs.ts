import type { Sample } from "./types";
import type { ComponentName } from "../definitions";

export const inputsSamples: Partial<Record<ComponentName, Sample>> = {
  Combobox: {
    components: [
      {
        id: "root",
        component: "Combobox",
        label: "Timezone",
        value: { "@path": "/form/timezone" },
        placeholder: "Search timezones",
        options: [
          { value: "America/Los_Angeles", label: "Pacific Time, Los Angeles" },
          { value: "America/Denver", label: "Mountain Time, Denver" },
          { value: "America/Chicago", label: "Central Time, Chicago" },
          { value: "America/New_York", label: "Eastern Time, New York" },
          { value: "Europe/London", label: "London" },
          { value: "Europe/Berlin", label: "Berlin" },
          { value: "Asia/Kolkata", label: "India Standard Time, Kolkata" },
          { value: "Asia/Tokyo", label: "Tokyo" },
          { value: "Australia/Sydney", label: "Sydney" },
        ],
      },
    ],
    data: { form: { timezone: "Asia/Kolkata" } },
  },
  Switch: {
    components: [
      {
        id: "root",
        component: "Switch",
        label: "Auto-approve small refunds",
        value: { "@path": "/form/autoRefund" },
        description: "Refunds under $50 skip the review queue.",
      },
    ],
    data: { form: { autoRefund: false } },
  },
  DatePicker: {
    components: [
      {
        id: "root",
        component: "DatePicker",
        label: "Launch date",
        value: { "@path": "/form/launch" },
        placeholder: "Pick a date",
      },
    ],
    data: { form: { launch: "2026-11-12" } },
  },
  ButtonGroup: {
    components: [
      {
        id: "root",
        component: "ButtonGroup",
        label: "Billing period",
        value: { "@path": "/form/period" },
        options: [
          { value: "monthly", label: "Monthly" },
          { value: "quarterly", label: "Quarterly" },
          { value: "yearly", label: "Yearly" },
        ],
      },
    ],
    data: { form: { period: "yearly" } },
  },
  ChipSelect: {
    components: [
      {
        id: "root",
        component: "ChipSelect",
        label: "Notify me about",
        value: { "@path": "/form/topics" },
        options: [
          { value: "deploys", label: "Deploys" },
          { value: "incidents", label: "Incidents" },
          { value: "billing", label: "Billing" },
          { value: "security", label: "Security" },
          { value: "usage", label: "Usage spikes" },
        ],
      },
    ],
    data: { form: { topics: ["deploys", "incidents"] } },
  },
};
