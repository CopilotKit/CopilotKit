# QA: Beautiful Chat — CrewAI (Crews)

- [ ] Navigate to `/demos/beautiful-chat`.
- [ ] Verify the page root (`data-testid="beautiful-chat-root"`) renders.
- [ ] Verify the ExampleLayout (chat on the left, canvas on the right)
      and the theme toggle widget are present.
- [ ] Verify the pre-seeded suggestion pills render. The "Excalidraw
      Diagram (MCP App)" pill from the LangGraph reference is intentionally
      omitted on CrewAI (see src/app/demos/beautiful-chat/hooks/
      use-example-suggestions.tsx).
- [ ] Click "Pie Chart (Controlled Generative UI)"; verify a branded pie
      chart renders in the transcript.
- [ ] Click "Bar Chart (Controlled Generative UI)"; verify a bar chart
      renders in the transcript.
- [ ] Click "Schedule Meeting (Human In The Loop)"; verify a
      meeting-time picker renders and that selecting a slot is echoed
      back into the chat.
- [ ] Click "Search Flights (A2UI Fixed Schema)"; verify a flight card
      renders in the canvas.
- [ ] Click "Sales Dashboard (A2UI Dynamic)"; verify a dashboard renders
      with metrics + pie + bar chart.
- [ ] Click "Calculator App (Open Generative UI)"; verify a calculator
      renders inside the sandboxed iframe.
- [ ] Click "Toggle Theme (Frontend Tools)"; verify the theme flips.
- [ ] Click "Task Manager (Shared State)"; verify three todos appear in
      the app-mode canvas.
