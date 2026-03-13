import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.tools import tool
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from tavily import TavilyClient
from pypdf import PdfReader
from typing import List, Dict, Any
from copilotkit import CopilotKitMiddleware
import json

load_dotenv()

MAIN_SYSTEM_PROMPT = """
You are a tool-using agent.

Hard rules:
- Never include job details, URLs, or JSON in assistant messages.
- Only output jobs via update_jobs_list(jobs_json).
- A valid job must be a single job detail page on an ATS or company careers page.
- Do NOT use job boards or listing/search pages.
- company MUST be the hiring company (never Lever/Greenhouse/Ashby/Workday/Talent.com/etc).

Schema (exact keys):
- company, title, location, url, goodMatch

Steps:
1) Call internet_search(query) exactly once.
2) From the returned results, select up to 5 valid individual job postings.
3) Call update_jobs_list(jobs_json) once.
4) Call finalize().
5) Output: Found N jobs.

If you cannot find 5 valid jobs, return as many valid ones as possible.
"""

JOB_SEARCH_PROMPT = (
    "Search and select 5 real postings that match the user's title, locations, and skills. "
    "Output ONLY this block format (no extra text before/after the wrapper):\n"
    "<JOBS>\n"
    '[{"company":"...","title":"...","location":"...","link":"https://...","Good Match":"one sentence"},'
    ' {"company":"...","title":"...","location":"...","link":"https://...","Good Match":"one sentence"},'
    ' {"company":"...","title":"...","location":"...","link":"https://...","Good Match":"one sentence"},'
    ' {"company":"...","title":"...","location":"...","link":"https://...","Good Match":"one sentence"},'
    ' {"company":"...","title":"...","location":"...","link":"https://...","Good Match":"one sentence"}]'
    "\n</JOBS>"
    "Each job MUST:"
    "- Be a single opening (not a job board, filter page or company jobs index)"
    "- Belong to a specific company with a dedicated job description page"
    "You must:"
    "- Use internet_search to find relevant jobs."
    "- Do NOT output job listings, JSON, or URLs in messages."
    "- Return everything ONLY by calling the parent tool `update_jobs_list` with a JSON string."
)


def parse_pdf_resume(file_path: str) -> str:
    """
    Parse PDF resume using pypdf.

    Args:
        file_path: Path to PDF file

    Returns:
        Extracted text from PDF
    """
    try:
        with open(file_path, "rb") as file:
            pdf_reader = PdfReader(file)
            text = ""
            for page in pdf_reader.pages:
                text += page.extract_text()
        return text
    except Exception as e:
        print(f"[ERROR] Failed to parse PDF: {str(e)}")
        return ""


def extract_skills_from_resume(resume_text: str) -> List[str]:
    """Extract technical skills from resume text"""
    skills_db = {
        "languages": ["Python", "JavaScript", "TypeScript", "Java", "Go", "Rust"],
        "frameworks": ["React", "Next.js", "FastAPI", "Django", "Express"],
        "ai_ml": ["LLM", "RAG", "PyTorch", "TensorFlow", "Transformers"],
        "databases": ["PostgreSQL", "MongoDB", "Redis", "Elasticsearch"],
        "cloud": ["AWS", "GCP", "Azure", "Docker", "Kubernetes"],
    }

    skills = set()
    resume_lower = resume_text.lower()

    for category, skill_list in skills_db.items():
        for skill in skill_list:
            if skill.lower() in resume_lower:
                skills.add(skill)

    return list(skills)


@tool
def update_jobs_list(jobs_json: str) -> Dict[str, Any]:
    """Send jobs list to UI state."""
    jobs = json.loads(jobs_json)
    print(f"[TOOL] update_jobs_list: {len(jobs)} jobs")
    return {"jobs_list": jobs}


@tool
def finalize() -> dict:
    """Signal completion."""
    print("[TOOL] finalize: Job search complete")
    return {"status": "done"}


BAD_URL_SUBSTRINGS = [
    "linkedin.com/jobs/search",
    "linkedin.com/jobs/",
    "builtin.com/jobs",
    "naukri.com",
    "glassdoor.",
    "/jobs/search",
    "/search?",
]


def _is_bad(url: str) -> bool:
    u = (url or "").lower()
    return any(p in u for p in BAD_URL_SUBSTRINGS)


@tool
def internet_search(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for jobs using Tavily API. Always returns up to 5 results.
    """
    tavily_key = os.environ.get("TAVILY_API_KEY")
    if not tavily_key:
        raise RuntimeError("TAVILY_API_KEY not set")

    client = TavilyClient(api_key=tavily_key)
    res = client.search(
        query=query,
        max_results=max_results * 3,  # get more, then filter
        include_raw_content=False,
        topic="general",
    )

    trimmed = []
    for r in res.get("results", []):
        url = r.get("url") or ""
        if _is_bad(url):
            continue
        trimmed.append(
            {
                "title": r.get("title"),
                "url": url,
                "content": (r.get("content") or "")[:400],
            }
        )
        if len(trimmed) == max_results:
            break

    print(f"[SEARCH] Returning {len(trimmed)} filtered results")
    print(trimmed)
    return trimmed


def build_agent():
    """Build Deep Agents graph with proper recursion limit"""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")

    llm = ChatOpenAI(
        model=os.environ.get("OPENAI_MODEL", "gpt-4-turbo"),
        temperature=0.7,
        api_key=api_key,
    )

    tools = [
        internet_search,
        update_jobs_list,
        finalize,
    ]

    subagents = [
        {
            "name": "job-search-agent",
            "description": "Finds relevant jobs and outputs <JOBS> JSON.",
            "system_prompt": JOB_SEARCH_PROMPT,
            "tools": [internet_search],
        },
    ]

    agent_graph = create_deep_agent(
        model=llm,
        system_prompt=MAIN_SYSTEM_PROMPT,
        tools=tools,
        subagents=subagents,
        middleware=[CopilotKitMiddleware()],
        checkpointer=MemorySaver(),
    )

    print("[AGENT] Deep Agents graph created")
    print(agent_graph)

    return agent_graph.with_config({"recursion_limit": 100})
