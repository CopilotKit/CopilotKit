import type { Sample, SampleComponent } from "./types";

/**
 * Previews for the Gen UI 2.0 standard components (`standardUI`), keyed by
 * component name. Only components with a sensible minimal example are here:
 * media, maps and link previews load from the network, and Spacer, Radio and
 * Pressable mean little on their own, so their pages show props only.
 * A part that only renders inside its parent (GridItem, TableRow...) shares
 * the parent's sample.
 */
const text = (id: string, value: string, extra: Record<string, unknown> = {}): SampleComponent => ({ id, component: "Text", text: value, ...extra });
const caption = (id: string, value: string): SampleComponent => ({ id, component: "Caption", text: value });
const title = (id: string, value: string, size?: string): SampleComponent => ({ id, component: "Title", text: value, ...(size ? { size } : {}) });

const gridItems: Sample = {
  components: [
    { id: "root", component: "Grid", columns: 3, gap: 3, children: ["wide", "narrow"] },
    { id: "wide", component: "GridItem", span: 2, children: ["wide_t", "wide_c"] },
    title("wide_t", "Pipeline"),
    caption("wide_c", "Spans two of three columns."),
    { id: "narrow", component: "GridItem", children: ["narrow_t", "narrow_c"] },
    title("narrow_t", "Owner"),
    caption("narrow_c", "One column."),
  ],
};

const carousel: Sample = {
  components: [
    { id: "root", component: "Carousel", label: "Release highlights", visibleItems: 2, children: ["s1", "s2", "s3"] },
    ...[
      ["s1", "Faster deploys", "Builds start in under ten seconds."],
      ["s2", "Audit log", "Every change, who made it and when."],
      ["s3", "Usage alerts", "A heads-up before you reach a limit."],
    ].flatMap(([id, t, c]) => [{ id, component: "CarouselItem", children: [`${id}_t`, `${id}_c`] }, title(`${id}_t`, t), caption(`${id}_c`, c)]),
  ],
};

const popover: Sample = {
  components: [
    { id: "root", component: "Popover", children: ["trigger", "content"] },
    { id: "trigger", component: "PopoverTrigger", children: ["trigger_t"] },
    text("trigger_t", "What counts as an active seat?", { color: "primary" }),
    { id: "content", component: "PopoverContent", children: ["content_t"] },
    text("content_t", "Anyone who signed in during the billing month."),
  ],
};

const tableParts: Sample = {
  components: [
    { id: "root", component: "Table", caption: "Open incidents", children: ["head", "body"] },
    { id: "head", component: "TableSection", header: true, children: ["head_row"] },
    { id: "head_row", component: "TableRow", children: ["h1", "h2"] },
    { id: "h1", component: "TableCell", header: true, text: "Service" },
    { id: "h2", component: "TableCell", header: true, text: "Status" },
    { id: "body", component: "TableSection", children: ["r1", "r2"] },
    { id: "r1", component: "TableRow", children: ["r1a", "r1b"] },
    { id: "r1a", component: "TableCell", text: "Search" },
    { id: "r1b", component: "TableCell", children: ["r1b_badge"] },
    { id: "r1b_badge", component: "Badge", label: "Degraded", color: "warning" },
    { id: "r2", component: "TableRow", children: ["r2a", "r2b"] },
    { id: "r2a", component: "TableCell", text: "Billing" },
    { id: "r2b", component: "TableCell", children: ["r2b_badge"] },
    { id: "r2b_badge", component: "Badge", label: "Resolved", color: "success" },
  ],
};

const listItems: Sample = {
  components: [
    { id: "root", component: "List", marker: "none", children: ["i1", "i2", "i3"] },
    { id: "i1", component: "ListItem", icon: "users", label: "Seats", value: "24 of 30" },
    { id: "i2", component: "ListItem", icon: "hard-drive", label: "Storage", value: "61 GB" },
    { id: "i3", component: "ListItem", icon: "calendar", label: "Renews", value: "Dec 1" },
  ],
};

export const standardSamples: Record<string, Sample> = {
  /* ---------- layout ---------- */
  Box: { components: [{ id: "root", component: "Box", gap: 1, children: ["t", "c"] }, title("t", "Box"), caption("c", "A flex column by default. Set direction to \"row\" for a row.")] },
  Column: { components: [{ id: "root", component: "Column", children: ["t", "b", "c"] }, title("t", "Weekly summary"), text("b", "Deploys finished **12% faster** than last week."), caption("c", "Updated 5 minutes ago")] },
  Row: { components: [{ id: "root", component: "Row", justify: "spaceBetween", align: "center", children: ["k", "v"] }, caption("k", "Plan"), text("v", "Team, billed yearly", { fontWeight: "semibold" })] },
  Grid: {
    components: [
      { id: "root", component: "Grid", columns: 2, gap: 4, children: ["a", "b", "c", "d"] },
      ...[
        ["a", "Visitors", "48.2K"],
        ["b", "Signups", "1,284"],
        ["c", "Trials", "312"],
        ["d", "Paid", "96"],
      ].flatMap(([id, k, v]) => [{ id, component: "Column", gap: 1, children: [`${id}_k`, `${id}_v`] }, caption(`${id}_k`, k), title(`${id}_v`, v, "xl")]),
    ],
  },
  GridItem: gridItems,
  Card: {
    components: [
      { id: "root", component: "Card", children: ["t", "c", "email", "send"] },
      title("t", "Invite a teammate"),
      caption("c", "They get an email with a sign-in link."),
      { id: "email", component: "TextField", label: "Email", variant: "email", placeholder: "name@company.com", value: { "@path": "/invite/email" } },
      { id: "send", component: "Button", label: "Send invite", variant: "primary" },
    ],
    data: { invite: { email: "" } },
  },
  Carousel: carousel,
  CarouselItem: carousel,
  Divider: { components: [{ id: "root", component: "Column", children: ["a", "line", "b"] }, text("a", "Order #4821 shipped on Monday."), { id: "line", component: "Divider" }, text("b", "Expected delivery: Thursday.")] },
  Tabs: {
    components: [
      { id: "root", component: "Tabs", tabs: [{ title: "Overview", child: "p1" }, { title: "Specs", child: "p2" }] },
      text("p1", "A light travel backpack with a padded laptop sleeve."),
      text("p2", "22 liters, 1.1 kg, fits a 16-inch laptop."),
    ],
  },

  /* ---------- text ---------- */
  Title: { components: [title("root", "Quarterly review", "xl")] },
  Text: { components: [text("root", "Deploys finished **12% faster** this week, and no release was rolled back.")] },
  Caption: { components: [caption("root", "Updated 5 minutes ago")] },
  Label: { components: [{ id: "root", component: "Label", text: "Email address" }] },
  Bold: { components: [{ id: "root", component: "Bold", text: "Ships on Friday" }] },
  Italic: { components: [{ id: "root", component: "Italic", text: "Draft, not reviewed yet" }] },
  Underline: { components: [{ id: "root", component: "Underline", text: "Read before you sign" }] },
  Strikethrough: { components: [{ id: "root", component: "Strikethrough", text: "$49 per month" }] },
  Badge: {
    components: [
      { id: "root", component: "Row", gap: 2, children: ["a", "b", "c"] },
      { id: "a", component: "Badge", label: "Active", color: "success" },
      { id: "b", component: "Badge", label: "Pending", color: "warning" },
      { id: "c", component: "Badge", label: "Failed", color: "danger" },
    ],
  },
  Blockquote: { components: [{ id: "root", component: "Blockquote", text: "Ship small changes often, and **measure** each one." }] },
  Code: { components: [{ id: "root", component: "Code", language: "ts", text: 'const total = items.reduce((sum, item) => sum + item.price, 0);\nconsole.log(`Total: ${total}`);' }] },
  Markdown: { components: [{ id: "root", component: "Markdown", text: "**Next steps**\n\n1. Confirm the venue\n2. Send the invites\n3. Book travel by *Friday*" }] },
  Math: { components: [{ id: "root", component: "Math", value: "\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i", block: true }] },
  ShimmerText: { components: [{ id: "root", component: "ShimmerText", text: "Searching flights..." }] },
  Link: { components: [{ id: "root", component: "Link", text: "Read the standard catalog docs", href: "https://docs.copilotkit.ai/generative-ui/components/standard-catalog" }] },
  Tooltip: {
    components: [
      { id: "root", component: "Row", gap: 2, align: "center", children: ["label", "tip"] },
      text("label", "Audit log"),
      { id: "tip", component: "Tooltip", trigger: "badge", content: "tip_text" },
      { id: "badge", component: "Badge", label: "Beta", color: "info" },
      text("tip_text", "Available to every workspace in December."),
    ],
  },

  /* ---------- inputs ---------- */
  Button: {
    components: [
      { id: "root", component: "Row", gap: 2, children: ["cancel", "save"] },
      { id: "cancel", component: "Button", label: "Cancel" },
      { id: "save", component: "Button", label: "Save changes", variant: "primary" },
    ],
  },
  Form: {
    components: [
      { id: "root", component: "Form", label: "Newsletter", children: ["email", "submit"] },
      { id: "email", component: "TextField", label: "Email", variant: "email", placeholder: "name@company.com", value: { "@path": "/form/email" } },
      { id: "submit", component: "Button", label: "Subscribe", variant: "primary", submit: true },
    ],
    data: { form: { email: "" } },
  },
  TextField: { components: [{ id: "root", component: "TextField", label: "Work email", variant: "email", placeholder: "name@company.com", value: { "@path": "/form/email" } }], data: { form: { email: "" } } },
  TextArea: { components: [{ id: "root", component: "TextArea", label: "What could be better?", placeholder: "Tell us in a sentence or two", rows: 3, value: { "@path": "/form/feedback" } }], data: { form: { feedback: "" } } },
  Select: {
    components: [{ id: "root", component: "Select", label: "Region", value: { "@path": "/form/region" }, options: [{ value: "us", label: "United States" }, { value: "eu", label: "Europe" }, { value: "apac", label: "Asia Pacific" }] }],
    data: { form: { region: "eu" } },
  },
  CheckBox: { components: [{ id: "root", component: "CheckBox", label: "Email me a weekly summary", value: { "@path": "/form/digest" } }], data: { form: { digest: true } } },
  RadioGroup: {
    components: [{ id: "root", component: "RadioGroup", label: "Plan", direction: "col", value: { "@path": "/form/plan" }, options: [{ value: "free", label: "Free" }, { value: "team", label: "Team", description: "Up to 30 seats" }, { value: "enterprise", label: "Enterprise" }] }],
    data: { form: { plan: "team" } },
  },
  Slider: { components: [{ id: "root", component: "Slider", label: "Monthly budget", min: 0, max: 5000, step: 100, value: { "@path": "/form/budget" } }], data: { form: { budget: 1800 } } },
  SegmentedControl: { components: [{ id: "root", component: "SegmentedControl", label: "Range", options: ["Day", "Week", "Month"], value: { "@path": "/form/range" } }], data: { form: { range: "Week" } } },
  ChoicePicker: {
    components: [{ id: "root", component: "ChoicePicker", label: "Notify me about", variant: "multipleSelection", displayStyle: "chips", options: ["Deploys", "Incidents", "Billing", "New members"], value: { "@path": "/form/topics" } }],
    data: { form: { topics: ["Deploys", "Incidents"] } },
  },
  DateTimeInput: { components: [{ id: "root", component: "DateTimeInput", label: "Meeting time", enableTime: true, value: { "@path": "/form/meeting" } }], data: { form: { meeting: "2026-11-12T14:30" } } },

  /* ---------- feedback and overlays ---------- */
  PulseIndicator: { components: [{ id: "root", component: "Row", gap: 2, align: "center", children: ["dot", "t"] }, { id: "dot", component: "PulseIndicator" }, text("t", "Live: 1,204 visitors now")] },
  FlashcardFlip: { components: [{ id: "root", component: "FlashcardFlip", front: "What does HTTP status 429 mean?", back: "Too many requests: the client hit a rate limit.", hint: "Click to flip" }] },
  Popover: popover,
  PopoverTrigger: popover,
  PopoverContent: popover,
  Modal: {
    components: [
      { id: "root", component: "Modal", title: "Refund policy", trigger: "open", content: "body" },
      { id: "open", component: "Button", label: "Read the refund policy" },
      text("body", "Refunds under $50 are approved at once. Larger ones take up to two business days."),
    ],
  },

  /* ---------- data ---------- */
  Table: {
    components: [
      {
        id: "root",
        component: "Table",
        caption: "Top pages",
        columns: ["Page", { label: "Views", align: "end" }, { label: "Bounce", align: "end" }],
        rows: [
          ["/pricing", 18420, "31%"],
          ["/docs/quickstart", 12950, "24%"],
          ["/blog/launch", 9310, "47%"],
        ],
      },
    ],
  },
  TableSection: tableParts,
  TableRow: tableParts,
  TableCell: tableParts,
  List: { components: [{ id: "root", component: "List", marker: "number", items: ["Connect your repository", "Pick a framework preset", "Deploy the main branch"] }] },
  ListItem: listItems,
  Chart: {
    components: [
      {
        id: "root",
        component: "Chart",
        chartType: "bar",
        title: "Signups by week",
        xKey: "week",
        series: [{ key: "signups", label: "Signups" }],
        data: [
          { week: "W1", signups: 120 },
          { week: "W2", signups: 164 },
          { week: "W3", signups: 151 },
          { week: "W4", signups: 208 },
        ],
      },
    ],
  },
  Icon: {
    components: [
      { id: "root", component: "Row", gap: 4, align: "center", children: ["a", "b", "c", "d"] },
      { id: "a", component: "Icon", name: "rocket", size: "lg", label: "Launch" },
      { id: "b", component: "Icon", name: "calendar", size: "lg", label: "Calendar" },
      { id: "c", component: "Icon", name: "map-pin", size: "lg", label: "Location" },
      { id: "d", component: "Icon", name: "bell", size: "lg", label: "Alerts" },
    ],
  },
  Svg: {
    components: [
      {
        id: "root",
        component: "Svg",
        label: "A sun over two hills",
        viewBox: "0 0 120 60",
        size: 180,
        circles: [{ cx: 88, cy: 20, r: 10, fill: "warning" }],
        paths: [
          { d: "M0 60 Q30 20 60 60 Z", fill: "success" },
          { d: "M40 60 Q75 28 120 60 Z", fill: "info" },
        ],
      },
    ],
  },
  HtmlView: { components: [{ id: "root", component: "HtmlView", title: "Release notes", html: "<h3 style=\"font-family: sans-serif\">Release 4.2</h3><ul style=\"font-family: sans-serif\"><li>Faster search</li><li>New audit log</li></ul>" }] },
  FollowUp: { components: [{ id: "root", component: "FollowUp", title: "Try next", items: ["Compare with last quarter", "Break down by region", "Export as CSV"] }] },
  EntityCard: {
    components: [
      {
        id: "root",
        component: "EntityCard",
        title: "Trailhead Daypack 22L",
        subtitle: "Backpacks",
        description: "A light pack with a padded laptop sleeve and a rain cover.",
        meta: "$89",
        badge: { label: "In stock", color: "success" },
        rating: 4.6,
        ratingCount: 312,
      },
    ],
  },
};
