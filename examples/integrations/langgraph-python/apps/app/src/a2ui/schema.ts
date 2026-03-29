/**
 * A2UI Component Schema — defines what components the agent can generate.
 *
 * This is the contract between the app and the AI agent. The schema flows
 * to agents as context so they know what components are available.
 *
 * Components here are app-level: no dependency on the A2UI basic catalog.
 */
export const a2uiSchema = [
  {
    name: "Title",
    description: "A heading. Use for section titles and page headers.",
    props: {
      type: "object",
      properties: {
        text: { type: "string", description: "The heading text" },
        level: { type: "string", enum: ["h1", "h2", "h3"], description: "Heading level (default h2)" },
      },
      required: ["text"],
    },
  },
  {
    name: "Text",
    description: "Plain text content. Use for descriptions, labels, body copy.",
    props: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text content" },
        variant: { type: "string", enum: ["body", "caption", "bold"], description: "Text style variant" },
      },
      required: ["text"],
    },
  },
  {
    name: "Row",
    description: "Horizontal layout container. Children are laid out in a row. Use 'children' array with component IDs.",
    props: {
      type: "object",
      properties: {
        gap: { type: "number", description: "Gap between children in px (default 16)" },
        align: { type: "string", enum: ["start", "center", "end", "stretch"], description: "Vertical alignment" },
        justify: { type: "string", enum: ["start", "center", "end", "spaceBetween"], description: "Horizontal distribution" },
        children: { type: "array", items: { type: "string" }, description: "Array of child component IDs" },
      },
      required: ["children"],
    },
  },
  {
    name: "Column",
    description: "Vertical layout container. Children are laid out in a column. Use 'children' array with component IDs.",
    props: {
      type: "object",
      properties: {
        gap: { type: "number", description: "Gap between children in px (default 12)" },
        children: { type: "array", items: { type: "string" }, description: "Array of child component IDs" },
      },
      required: ["children"],
    },
  },
  {
    name: "DashboardCard",
    description: "A card container with title and optional subtitle. Has a 'child' slot for content (chart, metrics, etc). Use 'child' with a single component ID.",
    props: {
      type: "object",
      properties: {
        title: { type: "string", description: "Card title" },
        subtitle: { type: "string", description: "Optional subtitle or description" },
        child: { type: "string", description: "ID of the single child component to render inside the card" },
      },
      required: ["title"],
    },
  },
  {
    name: "Metric",
    description: "A key metric display with label, value, and optional trend indicator. Great for KPIs and stats.",
    props: {
      type: "object",
      properties: {
        label: { type: "string", description: "Metric label (e.g. 'Total Revenue')" },
        value: { type: "string", description: "Metric value (e.g. '$48,200')" },
        trend: { type: "string", enum: ["up", "down", "neutral"], description: "Trend direction" },
        trendValue: { type: "string", description: "Trend percentage (e.g. '+12%')" },
      },
      required: ["label", "value"],
    },
  },
  {
    name: "PieChart",
    description: "A pie/donut chart. Provide data as array of {label, value, color} objects.",
    props: {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
              color: { type: "string", description: "Hex color like #3b82f6" },
            },
          },
          description: "Chart data segments",
        },
        innerRadius: { type: "number", description: "Inner radius for donut style (0 for solid pie)" },
      },
      required: ["data"],
    },
  },
  {
    name: "BarChart",
    description: "A bar chart. Provide data as array of {label, value} objects.",
    props: {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
          },
          description: "Chart data bars",
        },
        color: { type: "string", description: "Bar color (hex)" },
      },
      required: ["data"],
    },
  },
  {
    name: "Badge",
    description: "A small status badge/tag. Use for labels, statuses, categories.",
    props: {
      type: "object",
      properties: {
        text: { type: "string", description: "Badge text" },
        variant: { type: "string", enum: ["success", "warning", "error", "info", "neutral"], description: "Color variant" },
      },
      required: ["text"],
    },
  },
  {
    name: "DataTable",
    description: "A data table with columns and rows. Columns define headers, rows provide data.",
    props: {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" } } },
          description: "Column definitions",
        },
        rows: {
          type: "array",
          items: { type: "object" },
          description: "Row data objects (keys match column keys)",
        },
      },
      required: ["columns", "rows"],
    },
  },
  {
    name: "Button",
    description: "An interactive button. Must have an action event for the agent to respond to.",
    props: {
      type: "object",
      properties: {
        label: { type: "string", description: "Button text" },
        variant: { type: "string", enum: ["primary", "secondary", "ghost"], description: "Button style" },
        action: {
          type: "object",
          properties: {
            event: {
              type: "object",
              properties: {
                name: { type: "string", description: "Action event name" },
                context: { type: "object", description: "Context data passed with the action" },
              },
              required: ["name"],
            },
          },
          description: "Action triggered on click",
        },
      },
      required: ["label"],
    },
  },
];
