"""Freely licensed pictures for the research desk's views.

Wikimedia Commons answers a plain search with direct image URLs, sized
thumbnails, and the author and license of every file, so a view can show a
picture and credit it without a key or a scraper.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia asks every client to identify itself.
USER_AGENT = "CopilotKitResearchDesk/0.1 (https://github.com/CopilotKit/CopilotKit)"
THUMB_WIDTH = 960
MAX_IMAGES = 8
PICTURE_TYPES = {"image/jpeg", "image/png", "image/webp"}

_TAGS = re.compile(r"<[^>]+>")


def _plain(value: str | None, limit: int = 140) -> str:
    """Commons metadata is HTML; keep its text, collapsed and trimmed."""
    if not value:
        return ""
    text = " ".join(html.unescape(_TAGS.sub(" ", value)).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def parse_images(payload: dict, count: int) -> list[dict]:
    """Turns a Commons generator=search response into image records."""
    pages = (payload.get("query") or {}).get("pages") or {}
    ranked = sorted(pages.values(), key=lambda page: page.get("index", 0))
    images: list[dict] = []
    for page in ranked:
        info = (page.get("imageinfo") or [{}])[0]
        if info.get("mime") not in PICTURE_TYPES:
            continue
        url = (info.get("thumburl") or info.get("url") or "").split("?")[0]
        if not url:
            continue
        meta = info.get("extmetadata") or {}
        title = page.get("title", "").removeprefix("File:")
        title = re.sub(r"\.(jpe?g|png|webp)$", "", title, flags=re.IGNORECASE)
        artist = _plain((meta.get("Artist") or {}).get("value"), 60)
        license_name = _plain((meta.get("LicenseShortName") or {}).get("value"), 40)
        images.append(
            {
                "url": url,
                "title": title,
                "description": _plain((meta.get("ImageDescription") or {}).get("value"))
                or title,
                "credit": " · ".join(
                    part for part in (artist, license_name, "Wikimedia Commons") if part
                ),
                "source": info.get("descriptionurl", ""),
                "width": info.get("thumbwidth") or info.get("width"),
                "height": info.get("thumbheight") or info.get("height"),
            }
        )
        if len(images) >= count:
            break
    return images


def _search(query: str, count: int) -> dict:
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"{query} filetype:bitmap",
        "gsrnamespace": "6",
        # Ask for extra: some hits are diagrams or files without a thumbnail.
        "gsrlimit": str(min(count * 3, 30)),
        "prop": "imageinfo",
        "iiprop": "url|mime|size|extmetadata",
        "iiurlwidth": str(THUMB_WIDTH),
        "iiextmetadatafilter": "Artist|LicenseShortName|ImageDescription",
    }
    request = urllib.request.Request(
        f"{COMMONS_API}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        return json.load(response)


async def find_images(query: str, count: int = 4) -> dict:
    """Find freely licensed photographs and illustrations of a subject.

    Use it when seeing the subject helps the reader: a place, a species, an
    artifact, a building, a person, a landscape, a historical event. Search
    for the concrete thing, not the idea ("Aral Sea 1989 satellite", not
    "environmental damage").

    Args:
        query: What the picture should show, in a few plain words.
        count: How many images to return, 1 to 8.

    Returns:
        A dict with "images": each has "url" (a direct image URL to use as
        is), "description", "credit" (author, license, Wikimedia Commons) and
        "source" (the file's page). Empty when nothing fits.
    """
    count = max(1, min(int(count or 4), MAX_IMAGES))
    try:
        payload = await asyncio.to_thread(_search, query, count)
    except Exception as error:  # noqa: BLE001 - network, HTTP or JSON trouble; the agent goes on without pictures
        logger.warning("find_images failed for %r: %s", query, error)
        return {"query": query, "images": [], "error": "Image search is unavailable"}
    return {"query": query, "images": parse_images(payload, count)}
