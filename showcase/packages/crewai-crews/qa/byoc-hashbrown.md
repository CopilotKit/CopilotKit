# QA: BYOC (Hashbrown) — CrewAI (Crews)

- [ ] Navigate to `/demos/byoc-hashbrown`.
- [ ] Verify the page root (`data-testid="byoc-hashbrown-root"`) renders.
- [ ] Verify three suggestion pills appear in the composer ("Sales
      dashboard" / "Revenue by category" / "Expense trend").
- [ ] Click "Sales dashboard". Verify the assistant emits JSON that
      streams into a MetricCard + PieChart + BarChart (plus a Markdown
      heading). Verify progressive rendering while the stream is mid-flight.
- [ ] Click "Revenue by category". Verify a PieChart with ≥4 segments and
      a legend shows up.
- [ ] Click "Expense trend". Verify a BarChart with one bar per month
      across six months renders.
- [ ] Verify the raw JSON envelope is NOT visible to the user (only the
      rendered components should appear in the message list).
