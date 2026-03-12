"""PDF text extraction utilities for large files."""

import io
import logging
from typing import Optional

from pypdf import PdfReader

logger = logging.getLogger("agent.pdf")


def extract_text_from_pdf(pdf_bytes: bytes, filename: str) -> Optional[str]:
    """Extract text from PDF bytes.

    Args:
        pdf_bytes: Raw PDF file content
        filename: Original filename for logging

    Returns:
        Extracted text or None if extraction fails
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages_text = []

        for i, page in enumerate(reader.pages):
            try:
                text = page.extract_text()
                if text:
                    pages_text.append(f"--- Page {i + 1} ---\n{text}")
            except Exception as e:
                logger.warning(f"Failed to extract page {i + 1} from {filename}: {e}")
                pages_text.append(f"--- Page {i + 1} ---\n[Extraction failed]")

        return "\n\n".join(pages_text)

    except Exception as e:
        logger.error(f"Failed to read PDF {filename}: {e}")
        return None


def format_extracted_files_as_xml(files: list[dict]) -> str:
    """Format multiple extracted file contents as XML.

    Args:
        files: List of {"name": str, "content": str} dicts

    Returns:
        XML-formatted string
    """
    parts = ["<documents>"]
    for f in files:
        # Escape XML special chars in content
        content = (
            f["content"]
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        # Escape quotes in filename for XML attribute
        safe_name = f["name"].replace('"', "&quot;")
        parts.append(f'<file name="{safe_name}">')
        parts.append(f"<content>{content}</content>")
        parts.append("</file>")
    parts.append("</documents>")
    return "\n".join(parts)
