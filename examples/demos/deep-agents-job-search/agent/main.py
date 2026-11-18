import os
from fastapi import FastAPI, HTTPException, File, UploadFile
import uvicorn
from dotenv import load_dotenv
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from agent import build_agent, parse_pdf_resume, extract_skills_from_resume
import tempfile

load_dotenv()

app = FastAPI(
    title="Job Application Assistant",
    description="Find personalized job openings based on skills and preferences",
    version="1.0.0",
)

try:
    agent_graph = build_agent()
    print(agent_graph)
    add_langgraph_fastapi_endpoint(
        app=app,
        agent=LangGraphAGUIAgent(
            name="job_application_assistant",
            description="Job finder",
            graph=agent_graph,
        ),
        path="/",
    )
    print("[MAIN] Agent registered")
except Exception as e:
    print(f"[ERROR] Failed to build agent: {str(e)}")
    raise


@app.get("/healthz")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "job-application-assistant",
        "version": "1.0.0",
    }


@app.post("/api/upload-resume")
async def upload_resume(file: UploadFile = File(...)):
    """
    Upload and parse resume (PDF, DOCX, TXT).
    Returns extracted text and skills.
    """
    if not file:
        raise HTTPException(status_code=400, detail="No file provided")

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        if file.filename.endswith(".pdf"):
            resume_text = parse_pdf_resume(tmp_path)
        else:
            # for other formats, just read as text
            resume_text = content.decode("utf-8", errors="ignore")

        skills = extract_skills_from_resume(resume_text)

        os.unlink(tmp_path)

        return {
            "success": True,
            "text": resume_text[:1000],
            "skills": skills,
            "filename": file.filename,
        }

    except Exception as e:
        print(f"[ERROR] Resume upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def main():
    """Run server"""
    host = os.getenv("SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("SERVER_PORT", 8123))

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
