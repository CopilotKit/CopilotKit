"""File Investigator Agent - Strands + AG-UI + CopilotKit Integration."""

import base64
import json
import logging
import os
import re
import uuid
from typing import List, Optional

# Enable Strands logging to see LLM calls and tool execution
class BinaryDataRedactingFilter(logging.Filter):
    """Redact binary/base64 data from log messages to keep logs readable."""

    # Match base64 strings (100+ chars)
    BASE64_PATTERN = re.compile(r'[A-Za-z0-9+/=]{100,}')
    # Match byte literals like b'...' with 50+ chars
    BYTES_LITERAL_PATTERN = re.compile(r"b'[^']{50,}'")
    # Match hex escapes like \x00\x01... (20+ escapes)
    HEX_ESCAPE_PATTERN = re.compile(r'(\\x[0-9a-fA-F]{2}){20,}')
    # Match PDF raw content patterns
    PDF_STREAM_PATTERN = re.compile(r'stream\s*[\s\S]{100,}?\s*endstream', re.IGNORECASE)

    def _redact(self, text: str) -> str:
        """Redact binary blobs from text."""
        if not isinstance(text, str):
            text = str(text)
        text = self.BASE64_PATTERN.sub('[BASE64_DATA]', text)
        text = self.BYTES_LITERAL_PATTERN.sub("[BYTES_DATA]", text)
        text = self.HEX_ESCAPE_PATTERN.sub('[HEX_DATA]', text)
        text = self.PDF_STREAM_PATTERN.sub('[PDF_STREAM]', text)
        return text

    def filter(self, record):
        try:
            # Redact msg if it's a string
            if hasattr(record, 'msg') and isinstance(record.msg, str):
                record.msg = self._redact(record.msg)

            # Redact args if present (handles % formatting)
            if hasattr(record, 'args') and record.args:
                if isinstance(record.args, dict):
                    record.args = {k: self._redact(v) if isinstance(v, str) else v
                                  for k, v in record.args.items()}
                elif isinstance(record.args, tuple):
                    record.args = tuple(self._redact(a) if isinstance(a, str) else a
                                       for a in record.args)
        except Exception:
            pass  # Don't break logging if redaction fails
        return True


# Custom formatter that also redacts
class RedactingFormatter(logging.Formatter):
    """Formatter that redacts binary data from final formatted message."""

    REDACT_PATTERNS = [
        (re.compile(r'[A-Za-z0-9+/=]{100,}'), '[BASE64_DATA]'),
        (re.compile(r"b'[^']{50,}'"), '[BYTES_DATA]'),
        (re.compile(r'(\\x[0-9a-fA-F]{2}){20,}'), '[HEX_DATA]'),
    ]

    def format(self, record):
        result = super().format(record)
        for pattern, replacement in self.REDACT_PATTERNS:
            result = pattern.sub(replacement, result)
        return result


logging.basicConfig(
    level=logging.INFO,  # Reduce noise - only INFO and above
    format="%(levelname)s - %(name)s - %(message)s",
)

# Apply redacting filter and formatter to all handlers
redact_filter = BinaryDataRedactingFilter()
redact_formatter = RedactingFormatter("%(levelname)s - %(name)s - %(message)s")
for handler in logging.root.handlers:
    handler.addFilter(redact_filter)
    handler.setFormatter(redact_formatter)

# Set specific loggers to INFO (less verbose than DEBUG)
logging.getLogger("strands").setLevel(logging.INFO)
logging.getLogger("ag_ui_strands").setLevel(logging.DEBUG)  # DEBUG for HITL tracing
# Keep our custom loggers at DEBUG for tracing
logging.getLogger("agent").setLevel(logging.DEBUG)

# Enable boto3/botocore logging for Bedrock API calls
logging.getLogger("boto3").setLevel(logging.INFO)
logging.getLogger("botocore").setLevel(logging.INFO)
logging.getLogger("botocore.credentials").setLevel(logging.WARNING)  # Reduce noise
# Apply redacting filter to boto3 loggers
logging.getLogger("boto3").addFilter(redact_filter)
logging.getLogger("botocore").addFilter(redact_filter)

from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from dotenv import load_dotenv
from pdf_utils import extract_text_from_pdf, format_extracted_files_as_xml
from pydantic import BaseModel, Field
from strands import Agent, tool
from strands.models import BedrockModel
from botocore.config import Config

load_dotenv()

# === Pydantic Models for Tool Arguments ===


class Finding(BaseModel):
    """A key finding from document analysis."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    title: str = Field(description="Short title of the finding")
    description: str = Field(description="Detailed description")
    severity: str = Field(description="low, medium, high, or critical")


class FindingsList(BaseModel):
    """List of findings to update in UI."""

    findings: List[Finding] = Field(description="List of key findings")


class RedactedItem(BaseModel):
    """A detected redaction with speculation."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    location: str = Field(description="Where in the document (page/section)")
    speculation: str = Field(description="What might be hidden")
    confidence: int = Field(description="Confidence 0-100")


class RedactedList(BaseModel):
    """List of redacted content."""

    redacted_items: List[RedactedItem] = Field(description="Found redactions")


class Tweet(BaseModel):
    """A generated tweet."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    content: str = Field(description="Tweet text (max 280 chars)")
    posted: bool = Field(default=False)


class TweetsList(BaseModel):
    """List of tweets."""

    tweets: List[Tweet] = Field(description="Generated tweets")


class SummaryContent(BaseModel):
    """Summary content."""

    summary: str = Field(description="Executive summary text")


# === Frontend Tools (update UI state) ===
# Note: These tools receive dict objects from ag_ui_strands, not Pydantic models.
# We accept dict and handle both dict and Pydantic model cases for robustness.


@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "findings_list": {
                    "type": "object",
                    "properties": {
                        "findings": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string", "description": "Short title"},
                                    "description": {"type": "string", "description": "Details"},
                                    "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]}
                                },
                                "required": ["title", "description", "severity"]
                            }
                        }
                    },
                    "required": ["findings"]
                }
            },
            "required": ["findings_list"]
        }
    }
)
def update_findings(findings_list: dict) -> Optional[str]:
    """Update the Key Findings panel in the dashboard."""
    findings = findings_list.get("findings", []) if isinstance(findings_list, dict) else []
    logging.getLogger("agent.frontend").info(f"update_findings called with {len(findings)} findings")
    return None


@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "redacted_list": {
                    "type": "object",
                    "properties": {
                        "redacted_items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "location": {"type": "string", "description": "Where in document"},
                                    "speculation": {"type": "string", "description": "What might be hidden"},
                                    "confidence": {"type": "integer", "description": "0-100"}
                                },
                                "required": ["location", "speculation", "confidence"]
                            }
                        }
                    },
                    "required": ["redacted_items"]
                }
            },
            "required": ["redacted_list"]
        }
    }
)
def update_redacted(redacted_list: dict) -> Optional[str]:
    """Update the Redacted Content panel in the dashboard."""
    items = redacted_list.get("redacted_items", []) if isinstance(redacted_list, dict) else []
    logging.getLogger("agent.frontend").info(f"update_redacted called with {len(items)} items")
    return None


@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "tweets_list": {
                    "type": "object",
                    "properties": {
                        "tweets": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "content": {"type": "string", "description": "Tweet text (max 280 chars)"}
                                },
                                "required": ["content"]
                            }
                        }
                    },
                    "required": ["tweets"]
                }
            },
            "required": ["tweets_list"]
        }
    }
)
def update_tweets(tweets_list: dict) -> Optional[str]:
    """Update the Tweets panel in the dashboard."""
    tweets = tweets_list.get("tweets", []) if isinstance(tweets_list, dict) else []
    logging.getLogger("agent.frontend").info(f"update_tweets called with {len(tweets)} tweets")
    return None


@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "summary_content": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string", "description": "Executive summary text"}
                    },
                    "required": ["summary"]
                }
            },
            "required": ["summary_content"]
        }
    }
)
def update_summary(summary_content: dict) -> Optional[str]:
    """Update the Summary panel in the dashboard."""
    summary = summary_content.get("summary", "") if isinstance(summary_content, dict) else ""
    logging.getLogger("agent.frontend").info(f"update_summary called with {len(summary)} chars")
    return None


# === State Context Builder ===


def build_investigator_prompt(input_data, user_message: str):
    """Inject files and analysis state into the prompt.

    Always extracts text from PDFs - never uses Bedrock document blocks.
    This avoids Bedrock's 5-document limit which applies across conversation history.
    """
    logger = logging.getLogger("agent.context")

    # Reset state accumulator at start of each request
    _reset_state_accumulator()

    state_dict = getattr(input_data, "state", None)
    logger.debug(f"State keys: {list(state_dict.keys()) if isinstance(state_dict, dict) else 'None'}")

    context_parts = []
    extracted_texts = []

    if isinstance(state_dict, dict):
        uploaded_files = state_dict.get("uploadedFiles", [])

        # Always extract text from ALL PDFs (no document blocks)
        for file_info in uploaded_files:
            file_name = file_info.get("name", "document.pdf")
            base64_data = file_info.get("base64", "")

            if not base64_data:
                continue

            try:
                pdf_bytes = base64.b64decode(base64_data)
                file_size_mb = len(pdf_bytes) / (1024 * 1024)
                logger.info(f"Extracting text from PDF: {file_name} ({file_size_mb:.1f}MB)")

                text = extract_text_from_pdf(pdf_bytes, file_name)
                if text:
                    extracted_texts.append({"name": file_name, "content": text})
                else:
                    context_parts.append(f"File: {file_name} - text extraction failed")

            except Exception as e:
                logger.error(f"Failed to process {file_name}: {e}")
                context_parts.append(f"File: {file_name} (error: {e})")

        # Add extracted text as XML
        if extracted_texts:
            xml_content = format_extracted_files_as_xml(extracted_texts)
            context_parts.append(f"Extracted text from {len(extracted_texts)} PDF(s):")
            context_parts.append(xml_content)

        status = state_dict.get("analysisStatus", "idle")
        context_parts.append(f"\nAnalysis status: {status}")

        if state_dict.get("findings"):
            context_parts.append(
                f"Current findings: {json.dumps(state_dict['findings'], indent=2)}"
            )

    text_context = "\n".join(context_parts) if context_parts else ""
    full_text = (
        f"{text_context}\n\nUser request: {user_message}"
        if text_context
        else user_message
    )

    logger.info(f"Returning text-only prompt ({len(full_text)} chars)")
    return full_text


# === State Extraction Functions ===
# IMPORTANT: state_from_args emits STATE_SNAPSHOT which REPLACES entire state.
# Therefore, we must merge our partial update with the current state to avoid
# wiping out other state properties.
#
# CRITICAL: When multiple update_* tools are called in parallel (same LLM response),
# each state_from_args sees the SAME original state from context.input_data.state.
# Without accumulation, each would overwrite the previous one's updates.
# Solution: Use a request-scoped accumulator to track pending updates.

# Request-scoped state accumulator for parallel tool calls
_state_accumulator: dict = {}


def _reset_state_accumulator():
    """Reset the accumulator (call at start of new request if needed)."""
    global _state_accumulator
    _state_accumulator = {}


def _get_current_state(context) -> dict:
    """Get current state merged with any accumulated updates from this batch."""
    global _state_accumulator
    # Start with the frontend's state
    base_state = getattr(context.input_data, "state", None)
    if base_state is None:
        base_state = {}
    else:
        base_state = dict(base_state)  # Copy to avoid mutation

    # Merge in any accumulated updates from previous tools in this batch
    base_state.update(_state_accumulator)
    return base_state


def _accumulate_state_update(key: str, value):
    """Add an update to the accumulator for this batch."""
    global _state_accumulator
    _state_accumulator[key] = value


async def findings_state_from_args(context):
    """Extract findings from update_findings call and merge with current state."""
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
        findings_data = tool_input.get("findings_list", tool_input)
        raw_findings = findings_data.get("findings", []) if isinstance(findings_data, dict) else []

        # Ensure each finding has required fields (id, title, description, severity)
        findings = []
        for f in raw_findings:
            if isinstance(f, dict):
                findings.append({
                    "id": f.get("id", str(uuid.uuid4())[:8]),
                    "title": f.get("title", "Finding"),
                    "description": f.get("description", ""),
                    "severity": f.get("severity", "medium"),
                })

        # Add to accumulator for parallel tool calls
        _accumulate_state_update("findings", findings)

        # Return full accumulated state
        current_state = _get_current_state(context)
        current_state["findings"] = findings
        return current_state
    except Exception as e:
        logging.getLogger("agent.state").warning(f"findings_state_from_args failed: {e}")
        return None


async def redacted_state_from_args(context):
    """Extract redacted content from update_redacted call and merge with current state."""
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
        redacted_data = tool_input.get("redacted_list", tool_input)
        raw_redacted = redacted_data.get("redacted_items", []) if isinstance(redacted_data, dict) else []

        # Ensure each redacted item has required fields (id, location, speculation, confidence)
        redacted = []
        for r in raw_redacted:
            if isinstance(r, dict):
                redacted.append({
                    "id": r.get("id", str(uuid.uuid4())[:8]),
                    "location": r.get("location", "Unknown"),
                    "speculation": r.get("speculation", ""),
                    "confidence": r.get("confidence", 50),
                })

        # Add to accumulator for parallel tool calls
        _accumulate_state_update("redactedContent", redacted)

        # Return full accumulated state
        current_state = _get_current_state(context)
        current_state["redactedContent"] = redacted
        return current_state
    except Exception as e:
        logging.getLogger("agent.state").warning(f"redacted_state_from_args failed: {e}")
        return None


async def tweets_state_from_args(context):
    """Extract tweets from update_tweets call and merge with current state."""
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
        tweets_data = tool_input.get("tweets_list", tool_input)
        raw_tweets = tweets_data.get("tweets", []) if isinstance(tweets_data, dict) else []

        # Ensure each tweet has required fields (id, content, posted)
        # LLM may not provide id or posted, so add defaults
        tweets = []
        for i, t in enumerate(raw_tweets):
            if isinstance(t, dict):
                tweets.append({
                    "id": t.get("id", str(uuid.uuid4())[:8]),
                    "content": t.get("content", ""),
                    "posted": t.get("posted", False),
                })
            else:
                tweets.append({"id": str(uuid.uuid4())[:8], "content": str(t), "posted": False})

        # Add to accumulator for parallel tool calls
        _accumulate_state_update("tweets", tweets)

        # Return full accumulated state
        current_state = _get_current_state(context)
        current_state["tweets"] = tweets
        return current_state
    except Exception as e:
        logging.getLogger("agent.state").warning(f"tweets_state_from_args failed: {e}")
        return None


async def summary_state_from_args(context):
    """Extract summary from update_summary call and merge with current state."""
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
        summary_data = tool_input.get("summary_content", tool_input)
        summary = summary_data.get("summary", "") if isinstance(summary_data, dict) else str(summary_data)

        # Add to accumulator for parallel tool calls
        _accumulate_state_update("summary", summary)

        # Return full accumulated state
        current_state = _get_current_state(context)
        current_state["summary"] = summary
        return current_state
    except Exception as e:
        logging.getLogger("agent.state").warning(f"summary_state_from_args failed: {e}")
        return None


# === Agent Configuration ===

config = StrandsAgentConfig(
    state_context_builder=build_investigator_prompt,
    tool_behaviors={
        "update_findings": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=findings_state_from_args,
        ),
        "update_redacted": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=redacted_state_from_args,
        ),
        "update_tweets": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=tweets_state_from_args,
        ),
        "update_summary": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=summary_state_from_args,
        ),
    },
)

# === Model & Agent Setup ===

# BedrockModel uses boto3, which reads AWS credentials from environment:
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
region = os.getenv("AWS_REGION", "us-west-1")

# Configure boto3 with 5-minute timeout (same as before for long PDF processing)
boto_config = Config(
    region_name=region,
    connect_timeout=300,  # 5 minutes
    read_timeout=300,     # 5 minutes
)

model = BedrockModel(
    model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",  # Bedrock format with regional prefix
    region_name=region,
    max_tokens=4096,
    boto_client_config=boto_config,
)

SYSTEM_PROMPT = """You are the File Investigator - a sardonic document analyst with dry humor.

PERSONALITY: World-weary investigative journalist. Dry wit about redactions and bureaucracy.
Slightly conspiratorial but self-aware. Treat every document like it might hide secrets.

When analyzing PDFs (you may receive multiple files):

1. If multiple files, briefly acknowledge the collection
2. Look for connections and patterns across documents
3. Call the update_* tools to populate the dashboard panels

**KEY FINDINGS** (update_findings):
- MAX 3-5 truly important points across ALL documents
- Cross-reference between files when relevant
- One sentence each, be punchy

**REDACTED CONTENT** (update_redacted):
- Note actual redactions/gaps found in any document
- Specify which document contains each redaction
- Add wildly creative speculation about what's hidden

**TWEETS** (update_tweets):
- 3-4 viral-worthy tweets about the document collection
- Reference specific documents when juicy
- #NothingToSeeHere #TotallyNormal

**SUMMARY** (update_summary):
- 2-3 sentences about the overall document collection
- What's the story these documents tell together?

Keep humor absurdist and playful. Never mean-spirited.

NOTE: All PDFs are provided as extracted text in XML format.
"""

strands_agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
    tools=[
        update_findings,
        update_redacted,
        update_tweets,
        update_summary,
    ],
)

agui_agent = StrandsAgent(
    agent=strands_agent,
    name="file_investigator",
    description="An elite document analysis agent that investigates PDFs",
    config=config,
)

app = create_strands_app(agui_agent, "/")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
