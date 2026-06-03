"""Python mirror of the A2UI catalog. Lives in sync with
web/src/a2ui/definitions.ts. The agent reads CATALOG_PROMPT to know
which components exist; createSurface uses CATALOG_ID so the runtime
resolves to our renderers on the frontend.
"""

CATALOG_ID = "copilotkit://stocks-catalog"

CATALOG_PROMPT = """\
## Available A2UI components. CopilotKit custom catalog

Use ONLY these components. Exactly one component must have id="root".
All other components must be reachable from "root" via children/child.

### Layout
- **Stack** { children: [ids], gap?: xs|sm|md|lg|xl }
    Vertical layout. Default container.
- **Row** { children: [ids], gap?: xs|sm|md|lg }
    Horizontal layout.
- **Grid** { children: [ids], columns?: 1-4, gap?: xs|sm|md|lg }
    Responsive grid. Use for cards arranged in columns.

### Content
- **Heading** { text: string, level?: "1"|"2"|"3" }
- **Text** { text: string, tone?: default|muted }
- **Overline** { text: string }
    Tiny ALL-CAPS mono label above a heading.

### Domain
- **StockCard** { ticker: string }
    Renders a full stock card. Tickers: AAPL, MSFT, GOOG, NVDA, TSLA, AMZN.
"""
