"""
Google Sheets integration using Composio APIs.
Handles bidirectional sync between Google Sheets and canvas items.
"""

from typing import Dict, Any, List, Optional
import os
import json
from dotenv import load_dotenv

load_dotenv()

def get_sheet_names(sheet_id: str) -> Optional[List[str]]:
    """Get list of available sheet names in a spreadsheet."""
    composio, user_id = get_composio_client()
    if not composio or not user_id:
        return None
    
    try:
        result = composio.tools.execute(
            user_id=user_id,
            slug="GOOGLESHEETS_GET_SPREADSHEET_INFO",
            arguments={"spreadsheet_id": sheet_id}
        )
        
        if not result or not result.get("successful"):
            return None
            
        sheet_info = result.get("data", {}).get("response_data", {})
        sheets = sheet_info.get("sheets", [])
        
        return [s.get("properties", {}).get("title", "Untitled") for s in sheets]
        
    except Exception as e:
        print(f"Error getting sheet names: {e}")
        return None

def get_composio_client():
    """Initialize Composio client for direct API calls."""
    try:
        from composio import Composio
        user_id = os.getenv("COMPOSIO_USER_ID", "default")
        return Composio(), user_id
    except Exception as e:
        print(f"Failed to initialize Composio client: {e}")
        return None, None

def get_sheet_data(sheet_id: str, sheet_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Fetch sheet data using Composio's GOOGLESHEETS tools.
    
    Args:
        sheet_id: Google Sheets ID
        sheet_name: Optional specific sheet name to import from
        
    Returns:
        Dictionary containing sheet data or None if failed
    """
    composio, user_id = get_composio_client()
    if not composio or not user_id:
        return None
    
    try:
        # First, get spreadsheet info
        result = composio.tools.execute(
            user_id=user_id,
            slug="GOOGLESHEETS_GET_SPREADSHEET_INFO",
            arguments={"spreadsheet_id": sheet_id}
        )
        
        if not result or not result.get("successful"):
            print(f"Failed to get spreadsheet info: {result}")
            return None
            
        sheet_info = result.get("data", {}).get("response_data", {})
        print(f"Got sheet info: {sheet_info.get('properties', {}).get('title', 'Unknown')}")
        print(f"Sheet info keys: {list(sheet_info.keys())}")  # Debug what fields are available
        
        # Get available sheets
        sheets = sheet_info.get("sheets", [])
        if not sheets:
            print("No sheets found in spreadsheet")
            return None
        
        # Select sheet to import from
        if sheet_name:
            # Use specified sheet name
            selected_sheet = next((s for s in sheets if s.get("properties", {}).get("title") == sheet_name), None)
            if not selected_sheet:
                available_names = [s.get("properties", {}).get("title", "Untitled") for s in sheets]
                print(f"Sheet '{sheet_name}' not found. Available sheets: {available_names}")
                return None
            target_sheet_name = sheet_name
        else:
            # Default to first sheet if no specific sheet requested
            selected_sheet = sheets[0]
            target_sheet_name = selected_sheet.get("properties", {}).get("title", "Sheet1")
        
        # Get all data from selected sheet
        values_result = composio.tools.execute(
            user_id=user_id,
            slug="GOOGLESHEETS_BATCH_GET",
            arguments={
                "spreadsheet_id": sheet_id,
                "ranges": [f"{target_sheet_name}!A:Z"]  # Get all columns A to Z
            }
        )
        
        if not values_result or not values_result.get("successful"):
            print(f"Failed to get sheet values: {values_result}")
            return None
        
        values_data = values_result.get("data", {})
        sheet_ranges = values_data.get("valueRanges", [])
        
        if not sheet_ranges:
            print("No data found in sheet")
            return None
        
        rows = sheet_ranges[0].get("values", [])
        
        return {
            "spreadsheet_info": sheet_info,
            "sheet_name": target_sheet_name,
            "rows": rows,
            "title": sheet_info.get("properties", {}).get("title", "Untitled"),
            "available_sheets": [s.get("properties", {}).get("title", "Untitled") for s in sheets],
        }
        
    except Exception as e:
        print(f"Error fetching sheet data: {e}")
        return None

def convert_sheet_to_canvas_items(sheet_data: Dict[str, Any], original_sheet_id: str = "") -> Dict[str, Any]:
    """
    Convert sheet data to canvas format.
    
    Args:
        sheet_data: Data returned from get_sheet_data()
        original_sheet_id: The original sheet ID passed to get_sheet_data()
        
    Returns:
        Dictionary with canvas state structure
    """
    if not sheet_data or not sheet_data.get("rows"):
        return {
            "items": [],
            "globalTitle": sheet_data.get("title", "Imported Sheet") if sheet_data else "Empty Sheet",
            "globalDescription": "Imported from Google Sheets",
            "syncSheetId": original_sheet_id or sheet_data.get("spreadsheet_info", {}).get("spreadsheet_id", "") if sheet_data else "",
            "syncSheetName": sheet_data.get("sheet_name", "") if sheet_data else "",
        }
    
    rows = sheet_data["rows"]
    items = []
    
    # Skip empty rows
    valid_rows = [row for row in rows if row and any(cell.strip() for cell in row if cell)]
    
    if not valid_rows:
        return {
            "items": [],
            "globalTitle": sheet_data.get("title", "Empty Sheet"),
            "globalDescription": "No data found in sheet",
            "syncSheetId": original_sheet_id or sheet_data.get("spreadsheet_info", {}).get("spreadsheet_id", ""),
            "syncSheetName": sheet_data.get("sheet_name", ""),
        }
    
    # Determine if first row is headers
    first_row = valid_rows[0]
    has_headers = len(first_row) > 1 and all(
        isinstance(cell, str) and not cell.strip().replace('.', '').replace('-', '').isdigit() 
        for cell in first_row[:3] if cell
    )
    
    headers = []
    data_rows = valid_rows
    
    if has_headers:
        headers = [str(cell).strip() for cell in first_row]
        data_rows = valid_rows[1:]
    else:
        # Create generic headers
        max_cols = max(len(row) for row in valid_rows) if valid_rows else 0
        headers = [f"Column {i+1}" for i in range(max_cols)]
    
    # Convert each data row to a canvas item
    for idx, row in enumerate(data_rows):
        if not row or not any(cell.strip() for cell in row if cell):
            continue
            
        # Pad row to match headers length
        padded_row = [str(cell).strip() if cell else "" for cell in row]
        while len(padded_row) < len(headers):
            padded_row.append("")
        
        # Parse any spreadsheet format intelligently
        item_type = determine_item_type(padded_row, headers)
        name = next((cell for cell in padded_row if cell), f"Item {idx + 1}")
        data = create_item_data(item_type, padded_row, headers)
        
        item = {
            "id": str(idx + 1).zfill(4),
            "type": item_type,
            "name": name,
            "subtitle": padded_row[1] if len(padded_row) > 1 and padded_row[1] else "",
            "data": data
        }
        
        items.append(item)
    
    sync_sheet_id = original_sheet_id or sheet_data.get("spreadsheet_info", {}).get("spreadsheet_id", "")
    sync_sheet_name = sheet_data.get("sheet_name", "")
    
    
    result = {
        "items": items,
        "globalTitle": sheet_data.get("title", "Imported Sheet"),
        "globalDescription": f"Imported from Google Sheets • {len(items)} items",
        "syncSheetId": sync_sheet_id,
        "syncSheetName": sync_sheet_name,
    }
    
    
    return result

def create_default_data(item_type: str) -> Dict[str, Any]:
    """Create default empty data structure for a given item type."""
    if item_type == "project":
        return {
            "field1": "",
            "field2": "",
            "field3": "",
            "field4": [],
            "field4_id": 0,
        }
    elif item_type == "entity":
        return {
            "field1": "",
            "field2": "",
            "field3": [],
            "field3_options": ["Tag 1", "Tag 2", "Tag 3"],
        }
    elif item_type == "note":
        return {
            "field1": "",
        }
    elif item_type == "chart":
        return {
            "field1": [],
            "field1_id": 0,
        }
    else:
        return {"field1": ""}

def determine_item_type(row: List[str], headers: List[str]) -> str:
    """
    Determine the best canvas item type based on row content.
    
    Args:
        row: List of cell values
        headers: List of header names
        
    Returns:
        One of: 'project', 'entity', 'note', 'chart'
    """
    # Look for date patterns - suggests project
    date_indicators = ['date', 'due', 'deadline', 'start', 'end', 'created']
    if any(indicator in ' '.join(headers).lower() for indicator in date_indicators):
        return "project"
    
    # Look for numeric data - suggests chart
    numeric_count = sum(1 for cell in row if cell and cell.replace('.', '').replace('-', '').isdigit())
    if numeric_count >= 2:
        return "chart"
    
    # Look for long text content - suggests note
    long_text = any(len(cell) > 100 for cell in row if cell)
    if long_text:
        return "note"
    
    # Default to entity for structured data
    return "entity"

def create_item_data(item_type: str, row: List[str], headers: List[str]) -> Dict[str, Any]:
    """
    Create item data structure based on type and row content.
    
    Args:
        item_type: Type of canvas item
        row: List of cell values
        headers: List of header names
        
    Returns:
        Data structure appropriate for the item type
    """
    if item_type == "project":
        return {
            "field1": row[2] if len(row) > 2 else "",  # Description/details
            "field2": "",  # Select option (empty by default)
            "field3": find_date_in_row(row),  # Date field
            "field4": [],  # Checklist (empty)
            "field4_id": 0,
        }
    
    elif item_type == "entity":
        return {
            "field1": row[2] if len(row) > 2 else "",  # Description
            "field2": "",  # Select option (empty by default)
            "field3": extract_tags_from_row(row),  # Tags
            "field3_options": ["Import", "Data", "Sheet", "Tag 1", "Tag 2"],  # Default options
        }
    
    elif item_type == "note":
        # Combine all non-empty cells into a note
        content_parts = []
        for i, (header, cell) in enumerate(zip(headers, row)):
            if cell:
                if i == 0:  # First cell is already the name
                    continue
                content_parts.append(f"{header}: {cell}" if header else cell)
        
        return {
            "field1": "\n".join(content_parts) if content_parts else row[1] if len(row) > 1 else "",
        }
    
    elif item_type == "chart":
        metrics = []
        metric_id = 1
        
        # Create metrics from numeric data
        for i, (header, cell) in enumerate(zip(headers, row)):
            if cell and (cell.replace('.', '').replace('-', '').isdigit() or is_percentage(cell)):
                value = parse_numeric_value(cell)
                if value is not None:
                    metrics.append({
                        "id": str(metric_id).zfill(3),
                        "label": header or f"Metric {i+1}",
                        "value": min(100, max(0, value))  # Clamp to 0-100
                    })
                    metric_id += 1
        
        return {
            "field1": metrics,
            "field1_id": metric_id - 1,
        }
    
    # Default fallback
    return {"field1": ""}

def find_date_in_row(row: List[str]) -> str:
    """Find and parse date from row cells."""
    import re
    from datetime import datetime
    
    date_pattern = r'\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b'
    
    for cell in row:
        if not cell:
            continue
            
        # Look for date patterns
        match = re.search(date_pattern, cell)
        if match:
            try:
                date_str = match.group()
                # Try to parse and normalize
                if '/' in date_str:
                    date_str = date_str.replace('/', '-')
                
                # Parse different formats
                for fmt in ['%Y-%m-%d', '%m-%d-%Y', '%d-%m-%Y']:
                    try:
                        dt = datetime.strptime(date_str, fmt)
                        return dt.strftime('%Y-%m-%d')
                    except ValueError:
                        continue
            except Exception:
                continue
    
    return ""

def extract_tags_from_row(row: List[str]) -> List[str]:
    """Extract tags from row cells."""
    tags = []
    
    for cell in row[2:]:  # Skip first two cells (name and subtitle)
        if not cell:
            continue
            
        # Split on common delimiters and clean
        potential_tags = []
        for delimiter in [',', ';', '|', '\n']:
            if delimiter in cell:
                potential_tags.extend(cell.split(delimiter))
                break
        else:
            # Single tag
            potential_tags = [cell]
        
        # Clean and add tags
        for tag in potential_tags:
            cleaned = tag.strip()
            if cleaned and len(cleaned) <= 20:  # Reasonable tag length
                tags.append(cleaned)
    
    return tags[:5]  # Limit to 5 tags

def is_percentage(value: str) -> bool:
    """Check if value is a percentage."""
    return value.endswith('%') and value[:-1].replace('.', '').isdigit()

def parse_numeric_value(value: str) -> Optional[float]:
    """Parse numeric value from string."""
    try:
        if is_percentage(value):
            return float(value[:-1])
        elif value.replace('.', '').replace('-', '').isdigit():
            return float(value)
    except ValueError:
        pass
    return None


def sync_canvas_to_sheet(sheet_id: str, canvas_state: Dict[str, Any], sheet_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Sync canvas state to Google Sheets with proper deletion of removed items.
    
    Args:
        sheet_id: Google Sheets ID
        canvas_state: Canvas state with items, globalTitle, etc.
        sheet_name: Optional sheet name to sync to. If not provided, uses first sheet.
        
    Returns:
        Dictionary with sync result status
    """
    composio, user_id = get_composio_client()
    if not composio or not user_id:
        return {"success": False, "error": "Failed to initialize Composio client"}
    
    try:
        items = canvas_state.get("items", [])
        
        # Determine which sheet to sync to
        target_sheet_name = sheet_name
        if not target_sheet_name:
            # Get available sheets and use the first one
            sheet_names = get_sheet_names(sheet_id)
            if not sheet_names:
                return {"success": False, "error": "Failed to get sheet names from spreadsheet"}
            target_sheet_name = sheet_names[0]
        
        print(f"Syncing to sheet: {target_sheet_name}")
        
        # First, get current sheet data to determine how many rows need to be deleted
        current_sheet_data = get_sheet_data(sheet_id, target_sheet_name)
        current_row_count = 0
        if current_sheet_data and current_sheet_data.get("rows"):
            current_row_count = len(current_sheet_data["rows"])
        
        print(f"Current sheet has {current_row_count} rows")
        print(f"Canvas has {len(items)} items to sync")
        
        # Prepare new sheet data
        headers = ["id", "type", "name", "subtitle", "data"]
        new_rows = [headers]  # Start with headers
        
        for item in items:
            item_data_json = json.dumps(item.get("data", {}))
            row = [
                str(item.get("id", "")),
                str(item.get("type", "")),
                str(item.get("name", "")),
                str(item.get("subtitle", "")),
                item_data_json
            ]
            new_rows.append(row)
        
        new_row_count = len(new_rows)  # Including header
        
        # Step 1: Delete extra rows if the new data has fewer rows than current
        if current_row_count > new_row_count:
            rows_to_delete = current_row_count - new_row_count
            print(f"Deleting {rows_to_delete} rows from sheet (current: {current_row_count}, new: {new_row_count})")
            
            # Get the sheet's internal ID for deletion
            sheet_info_result = composio.tools.execute(
                user_id=user_id,
                slug="GOOGLESHEETS_GET_SPREADSHEET_INFO",
                arguments={"spreadsheet_id": sheet_id}
            )
            
            internal_sheet_id = 0  # Default fallback
            if sheet_info_result and sheet_info_result.get("successful"):
                sheets = sheet_info_result.get("data", {}).get("response_data", {}).get("sheets", [])
                for sheet in sheets:
                    if sheet.get("properties", {}).get("title") == target_sheet_name:
                        internal_sheet_id = sheet.get("properties", {}).get("sheetId", 0)
                        break
            
            print(f"Using internal sheet ID: {internal_sheet_id} for deletion")
            
            delete_result = composio.tools.execute(
                user_id=user_id,
                slug="GOOGLESHEETS_DELETE_DIMENSION",
                arguments={
                    "spreadsheet_id": sheet_id,
                    "delete_dimension_request": {
                        "range": {
                            "dimension": "ROWS",
                            "end_index": current_row_count,
                            "sheet_id": internal_sheet_id,
                            "start_index": new_row_count
                        }
                    }
                }
            )
            
            if not delete_result or not delete_result.get("successful"):
                print(f"Warning: Failed to delete rows: {delete_result}")
                # Continue anyway - the batch update might still work
        
        # Step 2: Update the sheet with new data
        print(f"Updating sheet with {len(new_rows)} rows (including header)")
        print(f"First few rows: {new_rows[:3]}")
        
        result = composio.tools.execute(
            user_id=user_id,
            slug="GOOGLESHEETS_BATCH_UPDATE",
            arguments={
                "spreadsheet_id": sheet_id,
                "sheet_name": target_sheet_name,
                "first_cell_location": "A1",
                "values": new_rows,
                "valueInputOption": "USER_ENTERED"
            }
        )
        
        print(f"Batch update result: {result}")
        
        if result and result.get("successful"):
            return {
                "success": True,
                "message": f"Synced {len(items)} items to Google Sheets (deleted {max(0, current_row_count - new_row_count)} rows)",
                "items_synced": len(items),
                "sheet_id": sheet_id,
                "rows_deleted": max(0, current_row_count - new_row_count)
            }
        else:
            error_msg = result.get("error", "Unknown error") if result else "No response"
            return {
                "success": False,
                "error": f"Failed to sync to Google Sheets: {error_msg}"
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": f"Exception during sync: {str(e)}"
        }

def create_new_sheet(title: str = "Canvas Data") -> Dict[str, Any]:
    """
    Create a new Google Sheet for canvas sync.
    
    Args:
        title: Title for the new sheet
        
    Returns:
        Dictionary with new sheet info
    """
    composio, user_id = get_composio_client()
    if not composio or not user_id:
        return {"success": False, "error": "Failed to initialize Composio client"}
    
    try:
        result = composio.tools.execute(
            user_id=user_id,
            slug="GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
            arguments={
                "title": title
            }
        )
        
        print(f"Composio API result for sheet creation: {result}")
        
        if result and result.get("successful"):
            sheet_data = result.get("data", {}).get("response_data", {})
            sheet_id = sheet_data.get("spreadsheet_id", "")  # Changed from "spreadsheetId"
            # Construct the sheet URL from the ID since it's not provided directly
            sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit" if sheet_id else ""
            
            print(f"Successfully extracted sheet_id: {sheet_id}, sheet_url: {sheet_url}")
            
            return {
                "success": True,
                "sheet_id": sheet_id,
                "sheet_url": sheet_url,
                "title": title
            }
        else:
            error_msg = result.get("error", "Unknown error") if result else "No response"
            print(f"Sheet creation failed with result: {result}")
            return {
                "success": False,
                "error": f"Failed to create sheet: {error_msg}"
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": f"Exception during sheet creation: {str(e)}"
        }

if __name__ == "__main__":
    # Test with a sample sheet ID
    test_sheet_id = input("Enter Google Sheets ID to test: ")
    if test_sheet_id:
        print("Fetching sheet data...")
        data = get_sheet_data(test_sheet_id)
        if data:
            print(f"Found {len(data.get('rows', []))} rows")
            canvas_data = convert_sheet_to_canvas_items(data, test_sheet_id)
            print(f"Converted to {len(canvas_data['items'])} canvas items")
            print(json.dumps(canvas_data, indent=2))
        else:
            print("Failed to fetch sheet data")
