/**
 * The apps a reader can connect so the agent can act in them, through
 * Composio. Each id is the Composio toolkit slug; the agent loads the tools of
 * the apps the reader has connected (see `agent/src/research_desk/actions.py`,
 * which keeps the same list).
 */
export interface DeskApp {
  id: string;
  name: string;
  /** What the agent can do once it is connected, in the reader's words. */
  can: string;
}

export const DESK_APPS: DeskApp[] = [
  {
    id: "gmail",
    name: "Gmail",
    can: "Find and read mail, draft replies, and send the email you approve.",
  },
  {
    id: "googlecalendar",
    name: "Google Calendar",
    can: "See your schedule, find free time, and add the events you approve.",
  },
  {
    id: "googledrive",
    name: "Google Drive",
    can: "Find files and folders, and read what is in them.",
  },
  {
    id: "googledocs",
    name: "Google Docs",
    can: "Read documents, and write an answer up as a new doc.",
  },
  {
    id: "googlesheets",
    name: "Google Sheets",
    can: "Read spreadsheets, and put a table from an answer into a sheet.",
  },
];

/** The app's own logo, from Composio's logo service. */
export const appIcon = (app: DeskApp) =>
  `https://logos.composio.dev/api/${app.id}`;
