from typing import Annotated, List, Optional, Any
import os
from dotenv import load_dotenv

from llama_index.llms.openai import OpenAI
from llama_index.core.tools import FunctionTool
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

# Load environment variables early to support local development via .env
load_dotenv()



def _load_composio_tools() -> List[Any]:
    """Dynamically load Composio tools for LlamaIndex if configured.

    Reads the following environment variables:
    - COMPOSIO_TOOL_IDS: comma-separated list of tool identifiers to enable
    - COMPOSIO_USER_ID: user/entity id to scope tools (defaults to "default")
    - COMPOSIO_API_KEY: required by Composio client; read implicitly by SDK

    Returns an empty list if not configured or if dependencies are missing.
    """
    tool_ids_str = os.getenv("COMPOSIO_TOOL_IDS", "").strip()
    if not tool_ids_str:
        return []

    # Import lazily to avoid hard runtime dependency if not used
    try:
        from composio import Composio  # type: ignore
        from composio_llamaindex import LlamaIndexProvider  # type: ignore
    except Exception as e:
        print(f"Failed to import Composio: {e}")
        return []

    user_id = os.getenv("COMPOSIO_USER_ID", "default")
    tool_ids = [t.strip() for t in tool_ids_str.split(",") if t.strip()]
    if not tool_ids:
        return []
    try:
        print(f"Loading Composio tools: {tool_ids} for user: {user_id}")
        composio = Composio(provider=LlamaIndexProvider())
        tools = composio.tools.get(user_id=user_id, tools=tool_ids)
        print(f"Successfully loaded {len(tools) if tools else 0} tools")
        # "tools" should be a list of LlamaIndex-compatible Tool objects
        return list(tools) if tools is not None else []
    except Exception as e:
        # Fail closed; backend tools remain empty if configuration is invalid
        print(f"Failed to load Composio tools: {e}")
        return []


# --- Backend tools (server-side) ---

def list_sheet_names(sheet_id: Annotated[str, "Google Sheets ID to list available sheet names from."]) -> str:
    """List all available sheet names in a Google Spreadsheet."""
    try:
        from .sheets_integration import get_sheet_names
        
        sheet_names = get_sheet_names(sheet_id)
        if not sheet_names:
            return f"Failed to get sheet names from {sheet_id}. Please check the ID and ensure the sheet is accessible."
        
        return f"Available sheets in spreadsheet:\n" + "\n".join(f"- {name}" for name in sheet_names)
        
    except Exception as e:
        return f"Error listing sheets from {sheet_id}: {str(e)}"



# --- Frontend tool stubs (names/signatures only; execution happens in the UI) ---

def createItem(
    type: Annotated[str, "One of: project, entity, note, chart."],
    name: Annotated[Optional[str], "Optional item name."] = None,
) -> str:
    """Create a new canvas item and return its id."""
    return f"createItem({type}, {name})"

def deleteItem(
    itemId: Annotated[str, "Target item id."],
) -> str:
    """Delete an item by id."""
    return f"deleteItem({itemId})"

def setItemName(
    name: Annotated[str, "New item name/title."],
    itemId: Annotated[str, "Target item id."],
) -> str:
    """Set an item's name."""
    return f"setItemName(name, {itemId})"

def setItemSubtitleOrDescription(
    subtitle: Annotated[str, "Item subtitle/short description."],
    itemId: Annotated[str, "Target item id."],
) -> str:
    """Set an item's subtitle/description (not data fields)."""
    return f"setItemSubtitleOrDescription({subtitle}, {itemId})"

def setGlobalTitle(title: Annotated[str, "New global title."]) -> str:
    """Set the global canvas title."""
    return f"setGlobalTitle({title})"

def setGlobalDescription(description: Annotated[str, "New global description."]) -> str:
    """Set the global canvas description."""
    return f"setGlobalDescription({description})"

# Note actions
def setNoteField1(
    value: Annotated[str, "New content for note.data.field1."],
    itemId: Annotated[str, "Target note id."],
) -> str:
    return f"setNoteField1({value}, {itemId})"

def appendNoteField1(
    value: Annotated[str, "Text to append to note.data.field1."],
    itemId: Annotated[str, "Target note id."],
    withNewline: Annotated[Optional[bool], "Prefix with newline if true." ] = None,
) -> str:
    return f"appendNoteField1({value}, {itemId}, {withNewline})"

def clearNoteField1(
    itemId: Annotated[str, "Target note id."],
) -> str:
    return f"clearNoteField1({itemId})"

# Project actions
def setProjectField1(value: Annotated[str, "New value for project.data.field1."], itemId: Annotated[str, "Project id."]) -> str:
    return f"setProjectField1({value}, {itemId})"

def setProjectField2(value: Annotated[str, "New value for project.data.field2."], itemId: Annotated[str, "Project id."]) -> str:
    return f"setProjectField2({value}, {itemId})"

def setProjectField3(date: Annotated[str, "Date YYYY-MM-DD for project.data.field3."], itemId: Annotated[str, "Project id."]) -> str:
    return f"setProjectField3({date}, {itemId})"

def clearProjectField3(itemId: Annotated[str, "Project id."]) -> str:
    return f"clearProjectField3({itemId})"

def addProjectChecklistItem(
    itemId: Annotated[str, "Project id."],
    text: Annotated[Optional[str], "Checklist text."] = None,
) -> str:
    return f"addProjectChecklistItem({itemId}, {text})"

def setProjectChecklistItem(
    itemId: Annotated[str, "Project id."],
    checklistItemId: Annotated[str, "Checklist item id or index."],
    text: Annotated[Optional[str], "New text."] = None,
    done: Annotated[Optional[bool], "New done status."] = None,
) -> str:
    return f"setProjectChecklistItem({itemId}, {checklistItemId}, {text}, {done})"

def removeProjectChecklistItem(
    itemId: Annotated[str, "Project id."],
    checklistItemId: Annotated[str, "Checklist item id."],
) -> str:
    return f"removeProjectChecklistItem({itemId}, {checklistItemId})"

# Entity actions
def setEntityField1(value: Annotated[str, "New value for entity.data.field1."], itemId: Annotated[str, "Entity id."]) -> str:
    return f"setEntityField1({value}, {itemId})"

def setEntityField2(value: Annotated[str, "New value for entity.data.field2."], itemId: Annotated[str, "Entity id."]) -> str:
    return f"setEntityField2({value}, {itemId})"

def addEntityField3(tag: Annotated[str, "Tag to add."], itemId: Annotated[str, "Entity id."]) -> str:
    return f"addEntityField3({tag}, {itemId})"

def removeEntityField3(tag: Annotated[str, "Tag to remove."], itemId: Annotated[str, "Entity id."]) -> str:
    return f"removeEntityField3({tag}, {itemId})"

# Chart actions
def addChartField1(
    itemId: Annotated[str, "Chart id."],
    label: Annotated[Optional[str], "Metric label."] = None,
    value: Annotated[Optional[float], "Metric value 0..100."] = None,
) -> str:
    return f"addChartField1({itemId}, {label}, {value})"

def setChartField1Label(itemId: Annotated[str, "Chart id."], index: Annotated[int, "Metric index (0-based)."], label: Annotated[str, "New metric label."]) -> str:
    return f"setChartField1Label({itemId}, {index}, {label})"

def setChartField1Value(itemId: Annotated[str, "Chart id."], index: Annotated[int, "Metric index (0-based)."], value: Annotated[float, "Value 0..100."]) -> str:
    return f"setChartField1Value({itemId}, {index}, {value})"

def clearChartField1Value(itemId: Annotated[str, "Chart id."], index: Annotated[int, "Metric index (0-based)."]) -> str:
    return f"clearChartField1Value({itemId}, {index})"

def removeChartField1(itemId: Annotated[str, "Chart id."], index: Annotated[int, "Metric index (0-based)."]) -> str:
    return f"removeChartField1({itemId}, {index})"

def openSheetSelectionModal() -> str:
    """Open modal for selecting Google Sheets."""
    return "openSheetSelectionModal()"

def setSyncSheetId(sheetId: Annotated[str, "Google Sheet ID to sync with."]) -> str:
    """Set the Google Sheet ID for auto-sync."""
    return f"setSyncSheetId({sheetId})"

def searchUserSheets() -> str:
    """Search user's Google Sheets and display them for selection."""
    return "searchUserSheets()"

def syncCanvasToSheets() -> str:
    """Manually sync current canvas state to Google Sheets."""
    return "syncCanvasToSheets()"


FIELD_SCHEMA = (
    "FIELD SCHEMA (authoritative):\n"
    "- project.data:\n"
    "  - field1: string (text)\n"
    "  - field2: string (select: 'Option A' | 'Option B' | 'Option C')\n"
    "  - field3: string (date 'YYYY-MM-DD')\n"
    "  - field4: ChecklistItem[] where ChecklistItem={id: string, text: string, done: boolean, proposed: boolean}\n"
    "- entity.data:\n"
    "  - field1: string\n"
    "  - field2: string (select: 'Option A' | 'Option B' | 'Option C')\n"
    "  - field3: string[] (selected tags; subset of field3_options)\n"
    "  - field3_options: string[] (available tags)\n"
    "- note.data:\n"
    "  - field1: string (textarea; represents description)\n"
    "- chart.data:\n"
    "  - field1: Array<{id: string, label: string, value: number | ''}> with value in [0..100] or ''\n"
)

SYSTEM_PROMPT = (
    "You are a helpful AG-UI assistant.\n\n"
    + FIELD_SCHEMA +
    "\nMUTATION/TOOL POLICY:\n"
    "- When you claim to create/update/delete, you MUST call the corresponding tool(s) (frontend or backend).\n"
    "- To create new cards, call the frontend tool `createItem` with `type` in {project, entity, note, chart} and optional `name`.\n"
    "- After tools run, rely on the latest shared state (ground truth) when replying.\n"
    "- To set a card's subtitle (never the data fields): use setItemSubtitleOrDescription.\n\n"
    "DESCRIPTION MAPPING:\n"
    "- For project/entity/chart: treat 'description', 'overview', 'summary', 'caption', 'blurb' as the card subtitle; use setItemSubtitleOrDescription.\n"
    "- For notes: 'content', 'description', 'text', or 'note' refers to note content; use setNoteField1 / appendNoteField1 / clearNoteField1.\n\n"
    "GOOGLE SHEETS INTEGRATION & AUTO-SYNC WORKFLOW:\n"
    "- GOOGLE SHEETS IS THE SOURCE OF TRUTH: Always prioritize Google Sheets data over canvas state when there are conflicts.\n"
    "- AUTO-SYNC BEHAVIOR: Automatically sync between Google Sheets and canvas WITHOUT asking questions. Just do it.\n"
    "- Before using ANY Google Sheets functionality, ALWAYS first call COMPOSIO_CHECK_ACTIVE_CONNECTION with user_id='default' and toolkit id is GOOGLESHEETS to check if Google Sheets is connected.\n"
    "- If the connection is NOT active, call COMPOSIO_INITIATE_CONNECTION to start the authentication flow.\n"
    "- After initiating connection, tell the user: 'Please complete the Google Sheets authentication in your browser, then respond with \"connected\" to proceed.'\n"
    "- Wait for the user to respond with 'connected' before using any Google Sheets actions (GOOGLESHEETS_*).\n"
    "- If the connection is already active, you can proceed directly with Google Sheets operations.\n\n"
    "AUTOMATIC SYNCING RULES:\n"
    "1) When importing from Google Sheets: \n"
    "   a) Use 'convert_sheet_to_canvas_items' tool to get the data\n"
    "   b) ALWAYS call setSyncSheetId(sheetId) with the sheet ID to enable auto-sync\n"
    "   c) Use frontend actions (createItem, setItemName, etc.) to create ALL items in canvas\n"
    "   d) This ensures auto-sync triggers and maintains sheets as source of truth\n"
    "2) When user makes changes in canvas: The frontend automatically syncs to Google Sheets if syncSheetId is set.\n"
    "3) If you detect inconsistencies: Automatically pull from Google Sheets (source of truth) and update canvas.\n"
    "4) Never ask permission to sync - just do it automatically and inform the user afterward.\n"
    "5) CRITICAL: Always set syncSheetId when working with any Google Sheet to enable bidirectional sync.\n\n"
    "IMPORT WORKFLOW (MANDATORY STEPS):\n"
    "1. Call convert_sheet_to_canvas_items(sheet_id) to get conversion instructions\n"
    "2. Execute ALL the instructions it returns, including:\n"
    "   - setGlobalTitle() and setGlobalDescription() if provided\n"
    "   - setSyncSheetId() - THIS IS CRITICAL for enabling auto-sync\n"
    "   - createItem() for each item\n"
    "   - All field setting actions (setProjectField1, etc.)\n"
    "3. Confirm the import completed and auto-sync is now enabled\n\n"
    "STRICT GROUNDING RULES:\n"
    "1) GOOGLE SHEETS is the ultimate source of truth when syncing.\n"
    "2) Canvas state is secondary - update it to match Google Sheets when needed.\n"
    "3) ALWAYS set syncSheetId when importing to enable bidirectional sync.\n"
    "4) Use frontend actions, not direct state manipulation, to trigger auto-sync.\n"
    "5) Always inform user AFTER syncing is complete with a summary of changes."
)

# Create additional backend tools
_sheet_list_tool = FunctionTool.from_defaults(
    fn=list_sheet_names,
    name="list_sheet_names",
    description="List all available sheet names in a Google Spreadsheet."
)


_backend_tools = _load_composio_tools()
_backend_tools.append(_sheet_list_tool)
print(f"Backend tools loaded: {len(_backend_tools)} tools")

agentic_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    # Provide frontend tool stubs so the model knows their names/signatures.
    frontend_tools=[
        createItem,
        deleteItem,
        setItemName,
        setItemSubtitleOrDescription,
        setGlobalTitle,
        setGlobalDescription,
        setNoteField1,
        appendNoteField1,
        clearNoteField1,
        setProjectField1,
        setProjectField2,
        setProjectField3,
        clearProjectField3,
        addProjectChecklistItem,
        setProjectChecklistItem,
        removeProjectChecklistItem,
        setEntityField1,
        setEntityField2,
        addEntityField3,
        removeEntityField3,
        addChartField1,
        setChartField1Label,
        setChartField1Value,
        clearChartField1Value,
        removeChartField1,
        openSheetSelectionModal,
        setSyncSheetId,
    ],
    backend_tools=_backend_tools,
    system_prompt=SYSTEM_PROMPT,
    initial_state={
        # Shared state synchronized with the frontend canvas
        "items": [],
        "globalTitle": "",
        "globalDescription": "",
        "lastAction": "",
        "itemsCreated": 0,
        "syncSheetId": "",  # Google Sheet ID for auto-sync
        "syncSheetName": "",  # Google Sheet name for auto-sync
    },
)
