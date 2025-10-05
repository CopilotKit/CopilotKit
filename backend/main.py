from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow frontend to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or ["http://localhost:5173"] for stricter
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/summarize")
async def summarize_email(payload: dict):
    email_text = payload.get("email_text", "")
    # Fake summary logic for now
    summary = email_text[:50] + "..." if len(email_text) > 50 else email_text
    return {"summary": summary}
