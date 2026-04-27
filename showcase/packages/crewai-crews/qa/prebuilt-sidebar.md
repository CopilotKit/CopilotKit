# QA: Pre-Built Sidebar — CrewAI (Crews)

## Prerequisites

- Demo deployed; agent backend healthy.

## Test Steps

- [ ] Navigate to `/demos/prebuilt-sidebar`.
- [ ] Verify the main content heading "Sidebar demo — click the launcher" is visible.
- [ ] Verify the `<CopilotSidebar />` is open by default.
- [ ] Verify the sidebar has a launcher button.
- [ ] Send "Say hi" via the sidebar; verify an assistant message appears.
- [ ] Close the sidebar using the launcher; verify the sidebar collapses.
- [ ] Re-open the sidebar; verify messages persist.

## Expected Results

- Sidebar opens by default.
- Launcher toggles the sidebar without unmounting it.
- Main content remains visible alongside the sidebar.
