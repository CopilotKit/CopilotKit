/**
 * Layout rules for the agent, added to its system prompt. The standard
 * catalog tells the model what each component is; it does not say how a
 * designer would arrange several of them. Without these rules a model stacks
 * every block full width: three stat tiles become three long bars, and a
 * badge or button stretches across its column.
 *
 * Every rule names real props of the standard components (checked against
 * the catalog the model gets), so the model can follow it to the letter.
 * They change only how the model composes the components, never how a
 * component looks.
 */
export const DESIGN_GUIDE = `Layout rules for the surfaces you render. The chat column is about 720px wide, and about 340px on a phone.

- Lay a surface out the way a product designer would. Items of the same kind sit side by side, not stacked full width: put two to four stat tiles, cards, plans or options in a Grid with "columns" set to their count (at most 3). Do not set "minChildWidth" (it counts in 4px steps, so 180 would mean 720px and force one column); the Grid already drops to fewer columns on a phone.
- Flashcards are the exception: stack them one after the other in a Column, one card per row, so each reads like the next card in a deck.
- A stat tile (one KPI) is a Box with "border": true, "radius": "lg", "padding": 4 and "gap": 1. Inside it, in this order: a Caption with the label, a Title with "size": "xl" and "tabularNums": true for the value, and a Caption with the change, coloured "success" or "danger", starting with ↑ or ↓ (for example "↑ 12.4% vs last month"). A trend is never a Badge.
- An interactive panel (a form, a checklist, a calculator) goes in one Card with a Title, and its groups are separated by a Divider or the gap.
- A Badge, a Button or a short Text never stretches across its column. In a Column, put it in a Row, or set the Column's "align" to "start". Buttons go in a Row after the content they act on, never full width.
- A dashboard goes in this order: the stat tiles in one Grid row, then the chart with a short title, then the table. Use a line chart for a trend over time and bars to compare categories.
- In a Table, set "align": "end" on number and money columns, and keep cells short (a number with its unit, a model name, "18 h" rather than "Up to 18 hours") so each row stays on one line.
- In an Svg, keep labels clear of the shapes: place them beside the drawing, not on top of it.
- This is a demo. When a request needs example content (products, prices, places, data), invent plausible illustrative content right away and say in one short sentence that it is sample data. Do not ask the user to supply it first.`;
