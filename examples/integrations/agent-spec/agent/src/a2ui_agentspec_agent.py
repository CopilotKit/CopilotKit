from __future__ import annotations

import os

import dotenv
dotenv.load_dotenv()

from pyagentspec.agent import Agent
from pyagentspec.llms import OpenAiCompatibleConfig
from pyagentspec.serialization import AgentSpecSerializer
from pyagentspec.tools import ServerTool, ClientTool
from pyagentspec.property import StringProperty
from pyagentspec.llms.openaiconfig import OpenAIAPIType
from pyagentspec.llms.llmgenerationconfig import LlmGenerationConfig
from pathlib import Path
from datetime import datetime
import json

a2ui_prompts_folder = Path(__file__).resolve().parent / "a2ui_prompts"
A2UI_JSON_SCHEMA = (a2ui_prompts_folder / "a2ui_schema.json").read_text(encoding="utf-8")
A2UI_PROMPT = (a2ui_prompts_folder / "a2ui_prompt.txt").read_text(encoding="utf-8")

A2UI_JSON_SCHEMA_PROMPT = f"""
# JSON Schema Reference
---BEGIN A2UI JSON SCHEMA---
{A2UI_JSON_SCHEMA}
---END A2UI JSON SCHEMA---
"""


_today = datetime.now()
_today_str = _today.strftime("%Y-%m-%d")
_today_day = _today.strftime("%A")

A2UI_SYSTEM_PROMPT = f"""You are a helpful Scheduling Assistant that helps users manage their calendar and emails.

Today's date: {_today_str} ({_today_day}). When the user asks a question without a specific date, assume they mean today.

# Rendering Rules

## Calendar Display
When the user asks to see their schedule or calendar:
1. Call get_user_schedule to retrieve the schedule data.
2. After receiving the result, you MUST call render_calendar. NEVER stop after only writing text. Call render_calendar with:
   - date: today's date "{_today_str}"
   - dayName: "{_today_day}"
   - events: a JSON array STRING where each object has:
     - "startTime": start time like "08:00"
     - "endTime": end time like "09:00" (or "" if open-ended)
     - "title": the event name
     - "isAvailable": true if the slot is available, false otherwise
     - "guests": (optional) array of guest objects with "email" and "status" ("accepted", "declined", "maybe", "pending")

   Example events value: '[{{"startTime":"08:00","endTime":"09:00","title":"Morning Meeting","isAvailable":false,"guests":[{{"email":"sarah@co.org","status":"accepted"}}]}},{{"startTime":"09:00","endTime":"10:00","title":"Available","isAvailable":true}}]'

3. DO NOT use send_a2ui_json_to_client for calendar display. Always use render_calendar.
4. When updating the schedule (adding/removing events), call render_calendar again with the FULL updated event list.

## Inbox Display
When the user asks to check their inbox or emails:
1. Call check_user_inbox to retrieve emails.
2. After receiving the result, you MUST call render_inbox. NEVER stop after only writing text. Call render_inbox with:
   - emails: a JSON array STRING where each object has:
     - "from": sender email address
     - "subject": email subject line
     - "body": email body text
     - "date": date/time string
     - "isRead": boolean (false for unread)

   Example emails value: '[{{"from":"david@company.org","subject":"Quick Sync","body":"Hey, need to set up a meeting...","date":"10:30 AM","isRead":false}}]'

3. DO NOT use send_a2ui_json_to_client for inbox display. Always use render_inbox.

## Email Compose
When composing, drafting, replying to, or sending an email, use the render_email_compose tool.
Pass a JSON object STRING with these fields:
  - "to": recipient email address
  - "subject": email subject (use "Re: ..." for replies)
  - "body": the full email body text (greeting, message, closing, and signature all combined as natural text)

Example email value: '{{"to":"david@company.org","subject":"Re: Quick Sync","body":"Hi David,\\n\\nThanks for reaching out. I\\'m available today 10:00-11:00 or 13:00-14:00. Let me know what works.\\n\\nBest,\\n[Your Name]"}}'

DO NOT use send_a2ui_json_to_client for email compose. Always use render_email_compose.

## Daily Brief Dashboard
When the user asks for their daily brief, daily summary, or dashboard:
1. First call get_daily_brief to retrieve the combined data.
2. Then call render_daily_brief with root="root", plus components and data as JSON strings.

### A2UI Component Rules
Each component is {{"id":"<id>","component":{{<Type>:{{...}}}}}}. ONE key per component object.
To give a component flex-grow, add "weight":<n> at the ITEM level (sibling of "id" and "component"), NOT inside type properties.

Available component types:
- Card: {{"child":"<child-id>"}}
- Column: {{"children":{{"explicitList":["id1","id2",...]}}, "alignment":"start"|"center"|"end"|"stretch"}}
- Row: {{"children":{{"explicitList":["id1","id2",...]}}, "alignment":"start"|"center"|"end", "distribution":"start"|"center"|"end"|"spaceBetween"|"spaceEvenly"}}
- Text: {{"text":{{"path":"/<key>"}} or {{"literalString":"value"}}, "usageHint":"h1"|"h2"|"h3"|"h4"|"body"|"caption"}}
- Icon: {{"name":{{"literalString":"calendarToday"|"mail"|"event"|"person"|"schedule"|"inbox"}}}}
- Divider: {{}}
- Modal: {{"entryPointChild":"<entry-id>","contentChild":"<content-id>"}} — click entry to open detail dialog

### Data Binding
- ALL dynamic values MUST use path binding: {{"path":"/<key>"}}
- Only static labels use {{"literalString":"..."}}
- Data object has flat keys matching the path bindings (without leading /)

### Layout
The dashboard uses 3 separate Card components inside a root Column:
1. **Summary card**: title, date, stats row, executive summary paragraph
2. **Schedule card**: section header + event rows (each wrapped in a Modal for detail view)
3. **Inbox card**: section header + email rows (each wrapped in a Modal for detail view)

### Typography
- h2: dashboard title; h1: big metric numbers; h4: section headings
- body: event titles, email subjects, executive summary, guest labels
- caption: date, metric labels, timestamps, sender names (use *italic* wrapping)

### Concrete Template
Copy and populate dynamic values from get_daily_brief results.

components:
[
  {{"id":"root","component":{{"Column":{{"children":{{"explicitList":["summary-card","schedule-card","inbox-card"]}}}}}}}},
  {{"id":"summary-card","component":{{"Card":{{"child":"summary-col"}}}}}},
  {{"id":"summary-col","component":{{"Column":{{"children":{{"explicitList":["title","subtitle","div1","metrics-row","div2","exec-summary"]}}}}}}}},
  {{"id":"title","component":{{"Text":{{"text":{{"path":"/title"}},"usageHint":"h2"}}}}}},
  {{"id":"subtitle","component":{{"Text":{{"text":{{"path":"/subtitle"}},"usageHint":"caption"}}}}}},
  {{"id":"div1","component":{{"Divider":{{}}}}}},
  {{"id":"metrics-row","component":{{"Row":{{"children":{{"explicitList":["m-meetings","m-unread","m-hours"]}},"distribution":"spaceEvenly"}}}}}},
  {{"id":"m-meetings","component":{{"Column":{{"children":{{"explicitList":["m-meetings-v","m-meetings-l"]}},"alignment":"center"}}}}}},
  {{"id":"m-meetings-v","component":{{"Text":{{"text":{{"path":"/meetingCount"}},"usageHint":"h1"}}}}}},
  {{"id":"m-meetings-l","component":{{"Text":{{"text":{{"literalString":"*Meetings*"}},"usageHint":"caption"}}}}}},
  {{"id":"m-unread","component":{{"Column":{{"children":{{"explicitList":["m-unread-v","m-unread-l"]}},"alignment":"center"}}}}}},
  {{"id":"m-unread-v","component":{{"Text":{{"text":{{"path":"/unreadCount"}},"usageHint":"h1"}}}}}},
  {{"id":"m-unread-l","component":{{"Text":{{"text":{{"literalString":"*Unread*"}},"usageHint":"caption"}}}}}},
  {{"id":"m-hours","component":{{"Column":{{"children":{{"explicitList":["m-hours-v","m-hours-l"]}},"alignment":"center"}}}}}},
  {{"id":"m-hours-v","component":{{"Text":{{"text":{{"path":"/availableHours"}},"usageHint":"h1"}}}}}},
  {{"id":"m-hours-l","component":{{"Text":{{"text":{{"literalString":"*Hours Free*"}},"usageHint":"caption"}}}}}},
  {{"id":"div2","component":{{"Divider":{{}}}}}},
  {{"id":"exec-summary","component":{{"Text":{{"text":{{"path":"/execSummary"}},"usageHint":"body"}}}}}},
  {{"id":"schedule-card","component":{{"Card":{{"child":"sched-col"}}}}}},
  {{"id":"sched-col","component":{{"Column":{{"children":{{"explicitList":["sched-hdr","modal-e1","ed1","modal-e2","ed2","modal-e3","ed3","modal-e4","ed4","modal-e5"]}}}}}}}},
  {{"id":"sched-hdr","component":{{"Row":{{"children":{{"explicitList":["sched-icon","sched-text"]}},"alignment":"center"}}}}}},
  {{"id":"sched-icon","component":{{"Icon":{{"name":{{"literalString":"event"}}}}}}}},
  {{"id":"sched-text","component":{{"Text":{{"text":{{"literalString":"Schedule"}},"usageHint":"h4"}}}}}},
  {{"id":"modal-e1","component":{{"Modal":{{"entryPointChild":"e1-row","contentChild":"e1-detail"}}}}}},
  {{"id":"e1-row","component":{{"Row":{{"children":{{"explicitList":["e1-time","e1-title","e1-gc"]}},"alignment":"center"}}}}}},
  {{"id":"e1-time","component":{{"Text":{{"text":{{"path":"/event1Time"}},"usageHint":"caption"}}}}}},
  {{"id":"e1-title","weight":1,"component":{{"Text":{{"text":{{"path":"/event1Title"}},"usageHint":"body"}}}}}},
  {{"id":"e1-gc","component":{{"Row":{{"children":{{"explicitList":["e1-pi","e1-gn"]}},"alignment":"center"}}}}}},
  {{"id":"e1-pi","component":{{"Icon":{{"name":{{"literalString":"person"}}}}}}}},
  {{"id":"e1-gn","component":{{"Text":{{"text":{{"path":"/event1Guests"}},"usageHint":"caption"}}}}}},
  {{"id":"e1-detail","component":{{"Column":{{"children":{{"explicitList":["e1-dt","e1-dtm","e1-dd","e1-dgl","e1-dgn"]}}}}}}}},
  {{"id":"e1-dt","component":{{"Text":{{"text":{{"path":"/event1Title"}},"usageHint":"h4"}}}}}},
  {{"id":"e1-dtm","component":{{"Text":{{"text":{{"path":"/event1TimeFull"}},"usageHint":"caption"}}}}}},
  {{"id":"e1-dd","component":{{"Divider":{{}}}}}},
  {{"id":"e1-dgl","component":{{"Text":{{"text":{{"path":"/event1GuestsLabel"}},"usageHint":"body"}}}}}},
  {{"id":"e1-dgn","component":{{"Text":{{"text":{{"path":"/event1GuestNames"}},"usageHint":"caption"}}}}}},
  {{"id":"ed1","component":{{"Divider":{{}}}}}},
  {{"id":"modal-e2","component":{{"Modal":{{"entryPointChild":"e2-row","contentChild":"e2-detail"}}}}}},
  {{"id":"e2-row","component":{{"Row":{{"children":{{"explicitList":["e2-time","e2-title","e2-gc"]}},"alignment":"center"}}}}}},
  {{"id":"e2-time","component":{{"Text":{{"text":{{"path":"/event2Time"}},"usageHint":"caption"}}}}}},
  {{"id":"e2-title","weight":1,"component":{{"Text":{{"text":{{"path":"/event2Title"}},"usageHint":"body"}}}}}},
  {{"id":"e2-gc","component":{{"Row":{{"children":{{"explicitList":["e2-pi","e2-gn"]}},"alignment":"center"}}}}}},
  {{"id":"e2-pi","component":{{"Icon":{{"name":{{"literalString":"person"}}}}}}}},
  {{"id":"e2-gn","component":{{"Text":{{"text":{{"path":"/event2Guests"}},"usageHint":"caption"}}}}}},
  {{"id":"e2-detail","component":{{"Column":{{"children":{{"explicitList":["e2-dt","e2-dtm","e2-dd","e2-dgl","e2-dgn"]}}}}}}}},
  {{"id":"e2-dt","component":{{"Text":{{"text":{{"path":"/event2Title"}},"usageHint":"h4"}}}}}},
  {{"id":"e2-dtm","component":{{"Text":{{"text":{{"path":"/event2TimeFull"}},"usageHint":"caption"}}}}}},
  {{"id":"e2-dd","component":{{"Divider":{{}}}}}},
  {{"id":"e2-dgl","component":{{"Text":{{"text":{{"path":"/event2GuestsLabel"}},"usageHint":"body"}}}}}},
  {{"id":"e2-dgn","component":{{"Text":{{"text":{{"path":"/event2GuestNames"}},"usageHint":"caption"}}}}}},
  {{"id":"ed2","component":{{"Divider":{{}}}}}},
  {{"id":"modal-e3","component":{{"Modal":{{"entryPointChild":"e3-row","contentChild":"e3-detail"}}}}}},
  {{"id":"e3-row","component":{{"Row":{{"children":{{"explicitList":["e3-time","e3-title","e3-gc"]}},"alignment":"center"}}}}}},
  {{"id":"e3-time","component":{{"Text":{{"text":{{"path":"/event3Time"}},"usageHint":"caption"}}}}}},
  {{"id":"e3-title","weight":1,"component":{{"Text":{{"text":{{"path":"/event3Title"}},"usageHint":"body"}}}}}},
  {{"id":"e3-gc","component":{{"Row":{{"children":{{"explicitList":["e3-pi","e3-gn"]}},"alignment":"center"}}}}}},
  {{"id":"e3-pi","component":{{"Icon":{{"name":{{"literalString":"person"}}}}}}}},
  {{"id":"e3-gn","component":{{"Text":{{"text":{{"path":"/event3Guests"}},"usageHint":"caption"}}}}}},
  {{"id":"e3-detail","component":{{"Column":{{"children":{{"explicitList":["e3-dt","e3-dtm","e3-dd","e3-dgl","e3-dgn"]}}}}}}}},
  {{"id":"e3-dt","component":{{"Text":{{"text":{{"path":"/event3Title"}},"usageHint":"h4"}}}}}},
  {{"id":"e3-dtm","component":{{"Text":{{"text":{{"path":"/event3TimeFull"}},"usageHint":"caption"}}}}}},
  {{"id":"e3-dd","component":{{"Divider":{{}}}}}},
  {{"id":"e3-dgl","component":{{"Text":{{"text":{{"path":"/event3GuestsLabel"}},"usageHint":"body"}}}}}},
  {{"id":"e3-dgn","component":{{"Text":{{"text":{{"path":"/event3GuestNames"}},"usageHint":"caption"}}}}}},
  {{"id":"ed3","component":{{"Divider":{{}}}}}},
  {{"id":"modal-e4","component":{{"Modal":{{"entryPointChild":"e4-row","contentChild":"e4-detail"}}}}}},
  {{"id":"e4-row","component":{{"Row":{{"children":{{"explicitList":["e4-time","e4-title","e4-gc"]}},"alignment":"center"}}}}}},
  {{"id":"e4-time","component":{{"Text":{{"text":{{"path":"/event4Time"}},"usageHint":"caption"}}}}}},
  {{"id":"e4-title","weight":1,"component":{{"Text":{{"text":{{"path":"/event4Title"}},"usageHint":"body"}}}}}},
  {{"id":"e4-gc","component":{{"Row":{{"children":{{"explicitList":["e4-pi","e4-gn"]}},"alignment":"center"}}}}}},
  {{"id":"e4-pi","component":{{"Icon":{{"name":{{"literalString":"person"}}}}}}}},
  {{"id":"e4-gn","component":{{"Text":{{"text":{{"path":"/event4Guests"}},"usageHint":"caption"}}}}}},
  {{"id":"e4-detail","component":{{"Column":{{"children":{{"explicitList":["e4-dt","e4-dtm","e4-dd","e4-dgl","e4-dgn"]}}}}}}}},
  {{"id":"e4-dt","component":{{"Text":{{"text":{{"path":"/event4Title"}},"usageHint":"h4"}}}}}},
  {{"id":"e4-dtm","component":{{"Text":{{"text":{{"path":"/event4TimeFull"}},"usageHint":"caption"}}}}}},
  {{"id":"e4-dd","component":{{"Divider":{{}}}}}},
  {{"id":"e4-dgl","component":{{"Text":{{"text":{{"path":"/event4GuestsLabel"}},"usageHint":"body"}}}}}},
  {{"id":"e4-dgn","component":{{"Text":{{"text":{{"path":"/event4GuestNames"}},"usageHint":"caption"}}}}}},
  {{"id":"ed4","component":{{"Divider":{{}}}}}},
  {{"id":"modal-e5","component":{{"Modal":{{"entryPointChild":"e5-row","contentChild":"e5-detail"}}}}}},
  {{"id":"e5-row","component":{{"Row":{{"children":{{"explicitList":["e5-time","e5-title","e5-gc"]}},"alignment":"center"}}}}}},
  {{"id":"e5-time","component":{{"Text":{{"text":{{"path":"/event5Time"}},"usageHint":"caption"}}}}}},
  {{"id":"e5-title","weight":1,"component":{{"Text":{{"text":{{"path":"/event5Title"}},"usageHint":"body"}}}}}},
  {{"id":"e5-gc","component":{{"Row":{{"children":{{"explicitList":["e5-pi","e5-gn"]}},"alignment":"center"}}}}}},
  {{"id":"e5-pi","component":{{"Icon":{{"name":{{"literalString":"person"}}}}}}}},
  {{"id":"e5-gn","component":{{"Text":{{"text":{{"path":"/event5Guests"}},"usageHint":"caption"}}}}}},
  {{"id":"e5-detail","component":{{"Column":{{"children":{{"explicitList":["e5-dt","e5-dtm","e5-dd","e5-dgl","e5-dgn"]}}}}}}}},
  {{"id":"e5-dt","component":{{"Text":{{"text":{{"path":"/event5Title"}},"usageHint":"h4"}}}}}},
  {{"id":"e5-dtm","component":{{"Text":{{"text":{{"path":"/event5TimeFull"}},"usageHint":"caption"}}}}}},
  {{"id":"e5-dd","component":{{"Divider":{{}}}}}},
  {{"id":"e5-dgl","component":{{"Text":{{"text":{{"path":"/event5GuestsLabel"}},"usageHint":"body"}}}}}},
  {{"id":"e5-dgn","component":{{"Text":{{"text":{{"path":"/event5GuestNames"}},"usageHint":"caption"}}}}}},
  {{"id":"inbox-card","component":{{"Card":{{"child":"inbox-col"}}}}}},
  {{"id":"inbox-col","component":{{"Column":{{"children":{{"explicitList":["inbox-hdr","modal-em1","emd1","modal-em2"]}}}}}}}},
  {{"id":"inbox-hdr","component":{{"Row":{{"children":{{"explicitList":["inbox-icon","inbox-text"]}},"alignment":"center"}}}}}},
  {{"id":"inbox-icon","component":{{"Icon":{{"name":{{"literalString":"mail"}}}}}}}},
  {{"id":"inbox-text","component":{{"Text":{{"text":{{"literalString":"Unread Messages"}},"usageHint":"h4"}}}}}},
  {{"id":"modal-em1","component":{{"Modal":{{"entryPointChild":"em1-row","contentChild":"em1-detail"}}}}}},
  {{"id":"em1-row","component":{{"Row":{{"children":{{"explicitList":["em1-icon","em1-col"]}},"alignment":"center"}}}}}},
  {{"id":"em1-icon","component":{{"Icon":{{"name":{{"literalString":"mail"}}}}}}}},
  {{"id":"em1-col","weight":1,"component":{{"Column":{{"children":{{"explicitList":["em1-subject","em1-from"]}}}}}}}},
  {{"id":"em1-subject","component":{{"Text":{{"text":{{"path":"/email1Subject"}},"usageHint":"body"}}}}}},
  {{"id":"em1-from","component":{{"Text":{{"text":{{"path":"/email1From"}},"usageHint":"caption"}}}}}},
  {{"id":"em1-detail","component":{{"Column":{{"children":{{"explicitList":["em1-ds","em1-df","em1-dd","em1-db"]}}}}}}}},
  {{"id":"em1-ds","component":{{"Text":{{"text":{{"path":"/email1Subject"}},"usageHint":"h4"}}}}}},
  {{"id":"em1-df","component":{{"Text":{{"text":{{"path":"/email1From"}},"usageHint":"caption"}}}}}},
  {{"id":"em1-dd","component":{{"Divider":{{}}}}}},
  {{"id":"em1-db","component":{{"Text":{{"text":{{"path":"/email1Body"}},"usageHint":"body"}}}}}},
  {{"id":"emd1","component":{{"Divider":{{}}}}}},
  {{"id":"modal-em2","component":{{"Modal":{{"entryPointChild":"em2-row","contentChild":"em2-detail"}}}}}},
  {{"id":"em2-row","component":{{"Row":{{"children":{{"explicitList":["em2-icon","em2-col"]}},"alignment":"center"}}}}}},
  {{"id":"em2-icon","component":{{"Icon":{{"name":{{"literalString":"mail"}}}}}}}},
  {{"id":"em2-col","weight":1,"component":{{"Column":{{"children":{{"explicitList":["em2-subject","em2-from"]}}}}}}}},
  {{"id":"em2-subject","component":{{"Text":{{"text":{{"path":"/email2Subject"}},"usageHint":"body"}}}}}},
  {{"id":"em2-from","component":{{"Text":{{"text":{{"path":"/email2From"}},"usageHint":"caption"}}}}}},
  {{"id":"em2-detail","component":{{"Column":{{"children":{{"explicitList":["em2-ds","em2-df","em2-dd","em2-db"]}}}}}}}},
  {{"id":"em2-ds","component":{{"Text":{{"text":{{"path":"/email2Subject"}},"usageHint":"h4"}}}}}},
  {{"id":"em2-df","component":{{"Text":{{"text":{{"path":"/email2From"}},"usageHint":"caption"}}}}}},
  {{"id":"em2-dd","component":{{"Divider":{{}}}}}},
  {{"id":"em2-db","component":{{"Text":{{"text":{{"path":"/email2Body"}},"usageHint":"body"}}}}}}
]

data (populate from get_daily_brief results):
{{
  "title": "Daily Brief",
  "subtitle": "*Monday, February 2, 2026*",
  "meetingCount": "5",
  "unreadCount": "2",
  "availableHours": "4",
  "execSummary": "You have 5 meetings today with 4 hours of free time between them. 2 unread messages need attention — David is requesting a quick sync to set up a new project, and Sarah shared the Q1 report for review before Thursday's meeting.",
  "event1Time": "*8:00–9:00 AM*",
  "event1Title": "Morning Meeting",
  "event1Guests": "3",
  "event1TimeFull": "*8:00 AM – 9:00 AM*",
  "event1GuestsLabel": "3 guests",
  "event1GuestNames": "*Sarah Chen, Mike Johnson, Jessica Park*",
  "event2Time": "*9:00–10:00 AM*",
  "event2Title": "Project Work",
  "event2Guests": "2",
  "event2TimeFull": "*9:00 AM – 10:00 AM*",
  "event2GuestsLabel": "2 guests",
  "event2GuestNames": "*David Dave, Sarah Chen*",
  "event3Time": "*11:00–11:30 AM*",
  "event3Title": "Client Call",
  "event3Guests": "3",
  "event3TimeFull": "*11:00 AM – 11:30 AM*",
  "event3GuestsLabel": "3 guests",
  "event3GuestNames": "*Alex Rivera, Sarah Chen, Nathan Ward*",
  "event4Time": "*2:00–3:00 PM*",
  "event4Title": "Team Sync",
  "event4Guests": "5",
  "event4TimeFull": "*2:00 PM – 3:00 PM*",
  "event4GuestsLabel": "5 guests",
  "event4GuestNames": "*Sarah Chen, Mike Johnson, Jessica Park, David Dave, Anmol Kapoor*",
  "event5Time": "*4:00–4:30 PM*",
  "event5Title": "Report Review",
  "event5Guests": "1",
  "event5TimeFull": "*4:00 PM – 4:30 PM*",
  "event5GuestsLabel": "1 guest",
  "event5GuestNames": "*Sarah Chen*",
  "email1Subject": "Quick Sync",
  "email1From": "*david.dave@company.org*",
  "email1Body": "Hey, I need to loop you in with some colleagues for a meeting to set up a new project. When would you be available? Please reply asap",
  "email2Subject": "Q1 Report Review",
  "email2From": "*sarah.chen@company.org*",
  "email2Body": "Hi team, I've attached the Q1 report for your review. Please take a look before our meeting on Thursday and come prepared with feedback."
}}

Adjust the number of event rows and email rows based on actual data. Add or remove Modal+row+detail groups and update the parent Column's explicitList.

IMPORTANT: Use render_daily_brief, NOT send_a2ui_json_to_client for the daily brief.

# CRITICAL: Required Tool-Calling Sequences
You MUST follow these exact sequences. NEVER skip the render step.

- Calendar: ALWAYS call get_user_schedule, then ALWAYS call render_calendar
- Inbox: ALWAYS call check_user_inbox, then ALWAYS call render_inbox
- Email compose: ALWAYS call render_email_compose
- Daily brief: ALWAYS call get_daily_brief, then ALWAYS call render_daily_brief

# CRITICAL: Text Output Rules
- Write ONE short sentence BEFORE calling the render tool (e.g. "Here's your schedule for today.")
- After calling the render tool, STOP. Do NOT write any more text. Your turn is DONE.
- NEVER write text both before AND after a render tool call.
- NEVER repeat or rephrase the same sentence after a tool call. If you already said it, do not say it again.
- NEVER summarize or list the data as text — the component displays it.
- NEVER skip the render tool and just describe the data in text.
- Always generate valid JSON with double-quoted property names.
- When updating the schedule, include ALL events in the render_calendar call (existing + new).

## Example: Correct flow for "check my inbox"
1. You write: "I'll pull up your inbox now."
2. You call check_user_inbox
3. You receive the inbox data
4. You call render_inbox with the email data
5. You STOP. No more text. Do NOT repeat "I'll pull up your inbox now." or any variation.
"""

agent_llm = OpenAiCompatibleConfig(
    name="my_llm",
    model_id=os.environ.get("OPENAI_MODEL", "gpt-5.2"),
    url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    api_type=OpenAIAPIType.RESPONSES,
    default_generation_parameters=LlmGenerationConfig(reasoning={"effort": "low"})
)

send_a2ui_json_to_client_tool = ClientTool(
    name="send_a2ui_json_to_client",
    description="Legacy fallback for rendering raw A2UI JSON. Do not use directly — use render_calendar, render_inbox, render_email_compose, or render_daily_brief instead.",
    inputs=[StringProperty(title="a2ui_json", description="Valid A2UI JSON Schema to send to the client.")]
)

render_calendar_tool = ClientTool(
    name="render_calendar",
    description="Renders a rich calendar day-view on the client. "
    "Call this after retrieving the user's schedule with get_user_schedule. "
    "Pass the date, day name, and events as a JSON array string.",
    inputs=[
        StringProperty(title="date", description="The date, e.g. '2026-02-02'"),
        StringProperty(title="dayName", description="The day name, e.g. 'Monday'"),
        StringProperty(title="events", description="JSON array string of event objects with startTime, endTime, title, isAvailable fields"),
    ]
)

render_email_compose_tool = ClientTool(
    name="render_email_compose",
    description="Renders a Gmail-style email compose view on the client. "
    "Call this when the user wants to compose, draft, or reply to an email. "
    "Pass a JSON object string with to, subject, and body fields.",
    inputs=[
        StringProperty(title="email", description="JSON object string with to, subject, body fields"),
    ]
)

render_inbox_tool = ClientTool(
    name="render_inbox",
    description="Renders a Gmail-style inbox view on the client. "
    "Call this after checking the user's inbox with check_user_inbox. "
    "Pass the emails as a JSON array string.",
    inputs=[
        StringProperty(title="emails", description="JSON array string of email objects with from, subject, body, date, isRead fields"),
    ]
)

check_user_inbox_tool = ServerTool(
    name="check_user_inbox",
    description="Checks the user's inbox. Returns a JSON array of emails. Optionally searches based on keywords.",
    inputs=[StringProperty(title="search_query")],
    outputs=[StringProperty(title="email_content")],
)

get_user_schedule_tool = ServerTool(
    name="get_user_schedule",
    description="Retrieves the user's schedule for today. Returns a JSON array of time slots with events.",
    outputs=[StringProperty(title="schedule_data")],
)

send_email_tool = ServerTool(
    name="send_email",
    description="Sends an email out. Accepts a single argument as the entire email, including the sender, recipients, subject, body, etc.",
    inputs=[StringProperty(title="payload")],
    outputs=[StringProperty(title="result")],
)

get_daily_brief_tool = ServerTool(
    name="get_daily_brief",
    description="Retrieves the user's daily brief including schedule summary, inbox highlights, and action items.",
    outputs=[StringProperty(title="brief_data")],
)

render_daily_brief_tool = ClientTool(
    name="render_daily_brief",
    description="Renders a daily brief dashboard in the canvas workspace using A2UI components. "
    "Pass the A2UI component definitions, data, and root component ID as JSON strings.",
    inputs=[
        StringProperty(title="components", description="JSON array string of A2UI ComponentInstance objects"),
        StringProperty(title="data", description="JSON object string with data values for the dashboard"),
        StringProperty(title="root", description="ID of the root component"),
    ]
)

agent = Agent(
    name="a2ui_chat_agent",
    llm_config=agent_llm,
    system_prompt=A2UI_SYSTEM_PROMPT,
    tools=[
        send_a2ui_json_to_client_tool,
        render_calendar_tool,
        render_inbox_tool,
        render_email_compose_tool,
        render_daily_brief_tool,
        check_user_inbox_tool,
        get_user_schedule_tool,
        get_daily_brief_tool,
        send_email_tool,
    ]
)

a2ui_chat_json = AgentSpecSerializer().to_json(agent)

demo_schedule = [
    {
        "startTime": "08:00", "endTime": "09:00", "title": "Morning Meeting", "isAvailable": False,
        "guests": [
            {"email": "sarah.chen@company.org", "status": "accepted"},
            {"email": "mike.johnson@company.org", "status": "accepted"},
            {"email": "jessica.park@company.org", "status": "maybe"},
        ],
    },
    {
        "startTime": "09:00", "endTime": "10:00", "title": "Project Work", "isAvailable": False,
        "guests": [
            {"email": "david.dave@company.org", "status": "accepted"},
            {"email": "sarah.chen@company.org", "status": "accepted"},
        ],
    },
    {"startTime": "10:00", "endTime": "11:00", "title": "Available", "isAvailable": True},
    {
        "startTime": "11:00", "endTime": "11:30", "title": "Client Call", "isAvailable": False,
        "guests": [
            {"email": "alex.rivera@client.com", "status": "accepted"},
            {"email": "sarah.chen@company.org", "status": "declined"},
            {"email": "nathan.ward@company.org", "status": "pending"},
        ],
    },
    {"startTime": "12:00", "endTime": "13:00", "title": "Lunch Break", "isAvailable": False},
    {"startTime": "13:00", "endTime": "14:00", "title": "Available", "isAvailable": True},
    {
        "startTime": "14:00", "endTime": "15:00", "title": "Team Sync", "isAvailable": False,
        "guests": [
            {"email": "sarah.chen@company.org", "status": "accepted"},
            {"email": "mike.johnson@company.org", "status": "accepted"},
            {"email": "jessica.park@company.org", "status": "accepted"},
            {"email": "david.dave@company.org", "status": "declined"},
            {"email": "anmol.kapoor@company.org", "status": "pending"},
        ],
    },
    {"startTime": "15:00", "endTime": "16:00", "title": "Available", "isAvailable": True},
    {
        "startTime": "16:00", "endTime": "16:30", "title": "Report Review", "isAvailable": False,
        "guests": [
            {"email": "sarah.chen@company.org", "status": "accepted"},
        ],
    },
    {"startTime": "17:00", "endTime": "", "title": "Available", "isAvailable": True},
]

demo_inbox = [
    {
        "from": "david.dave@company.org",
        "subject": "Quick Sync",
        "body": "Hey, I need to loop you in with some colleagues for a meeting to set up a new project. When would you be available? Please reply asap",
        "date": "10:30 AM",
        "isRead": False,
    },
    {
        "from": "sarah.chen@company.org",
        "subject": "Q1 Report Review",
        "body": "Hi team, I've attached the Q1 report for your review. Please take a look before our meeting on Thursday and come prepared with feedback.",
        "date": "9:15 AM",
        "isRead": False,
    },
    {
        "from": "mike.johnson@company.org",
        "subject": "Lunch plans?",
        "body": "Anyone up for trying that new sushi place on 5th street? I heard they have great lunch specials this week.",
        "date": "Yesterday",
        "isRead": True,
    },
    {
        "from": "hr@company.org",
        "subject": "Benefits Enrollment Reminder",
        "body": "This is a reminder that open enrollment for benefits closes on February 15th. Please review your options in the employee portal.",
        "date": "Yesterday",
        "isRead": True,
    },
    {
        "from": "jessica.park@company.org",
        "subject": "Design Review Feedback",
        "body": "Great work on the new dashboard mockups! I have a few suggestions for the navigation layout that I think could improve the UX.",
        "date": "Feb 1",
        "isRead": True,
    },
]


def user_schedule_tool(*args, **kwargs):
    return json.dumps(demo_schedule)


def check_inbox_tool(*args, **kwargs):
    return json.dumps(demo_inbox)


def send_email_tool_fn(*args, **kwargs):
    return "Email sent successfully!"


def get_daily_brief_fn(*args, **kwargs):
    meetings = [e for e in demo_schedule if not e["isAvailable"] and e["title"] != "Lunch Break"]
    available_slots = [e for e in demo_schedule if e["isAvailable"]]
    unread_emails = [e for e in demo_inbox if not e["isRead"]]

    available_hours = 0
    for slot in available_slots:
        if slot["endTime"]:
            sh, sm = map(int, slot["startTime"].split(":"))
            eh, em = map(int, slot["endTime"].split(":"))
            available_hours += (eh * 60 + em - sh * 60 - sm) / 60
        else:
            available_hours += 1

    brief = {
        "summary": {
            "meetingCount": len(meetings),
            "unreadCount": len(unread_emails),
            "availableHours": int(available_hours),
        },
        "upcomingEvents": [
            {
                "title": e["title"],
                "startTime": e["startTime"],
                "endTime": e["endTime"],
                "guestCount": len(e.get("guests", [])),
                "guestNames": ", ".join(
                    " ".join(p.capitalize() for p in g["email"].split("@")[0].split("."))
                    for g in e.get("guests", [])
                ),
            }
            for e in meetings
        ],
        "priorityEmails": [
            {
                "from": e["from"],
                "subject": e["subject"],
                "preview": e["body"][:80] + "..." if len(e["body"]) > 80 else e["body"],
                "body": e["body"],
                "date": e["date"],
            }
            for e in unread_emails
        ],
    }
    return json.dumps(brief)


a2ui_demo_tool_registry = {
    "check_user_inbox": check_inbox_tool,
    "get_user_schedule": user_schedule_tool,
    "get_daily_brief": get_daily_brief_fn,
    "send_email": send_email_tool_fn,
}
